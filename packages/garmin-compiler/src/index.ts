import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CompileRequest {
  compilerPath: string;
  junglePath: string;
  developerKey: string;
  deviceId: string;
  outputPath: string;
  timeoutMs: number;
  buildStats?: boolean;
}

export interface CompileResult {
  deviceId: string;
  status: "passed" | "failed" | "timed-out";
  outputPath: string;
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (
  command: string,
  args: string[],
  timeoutMs: number
) => Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>;

export const runProcess: ProcessRunner = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const isWindowsScript = process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
    const windowsCommandLine = isWindowsScript
      ? `"${[command, ...args].map(quoteWindowsArgument).join(" ")}"`
      : undefined;
    const child = spawn(
      isWindowsScript ? (process.env.ComSpec ?? "cmd.exe") : command,
      isWindowsScript
        ? ["/d", "/s", "/c", windowsCommandLine as string]
        : args,
      {
      windowsHide: true,
      shell: false,
      windowsVerbatimArguments: isWindowsScript
      }
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) {
        spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      } else {
        child.kill("SIGTERM");
      }
      settled = true;
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (!settled) resolve({ exitCode, stdout, stderr, timedOut: false });
    });
  });

function quoteWindowsArgument(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Compiler arguments cannot contain control characters.");
  return `"${value.replace(/"/g, '""')}"`;
}

export class GarminCompilerAdapter {
  constructor(private readonly runner: ProcessRunner = runProcess) {}

  async compile(request: CompileRequest): Promise<CompileResult> {
    await mkdir(path.dirname(request.outputPath), { recursive: true });
    const started = performance.now();
    const processResult = await this.runner(
      request.compilerPath,
      [
        "-d", request.deviceId,
        "-f", request.junglePath,
        "-o", request.outputPath,
        "-y", request.developerKey,
        ...(request.buildStats ? ["--build-stats", "0"] : [])
      ],
      request.timeoutMs
    );

    return {
      deviceId: request.deviceId,
      status: processResult.timedOut
        ? "timed-out"
        : processResult.exitCode === 0
          ? "passed"
          : "failed",
      outputPath: request.outputPath,
      durationMs: Math.round(performance.now() - started),
      exitCode: processResult.exitCode,
      stdout: processResult.stdout,
      stderr: processResult.stderr
    };
  }
}

async function existing(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  try {
    await access(filePath);
    return path.resolve(filePath);
  } catch {
    return undefined;
  }
}

async function discoverFromSdkConfig(): Promise<string | undefined> {
  const configCandidates = process.platform === "win32"
    ? [path.join(process.env.APPDATA ?? "", "Garmin", "ConnectIQ", "current-sdk.cfg")]
    : [path.join(os.homedir(), ".Garmin", "ConnectIQ", "current-sdk.cfg")];

  for (const configPath of configCandidates) {
    try {
      const sdkRoot = (await readFile(configPath, "utf8")).trim();
      const executable = process.platform === "win32" ? "monkeyc.bat" : "monkeyc";
      const found = await existing(path.join(sdkRoot, "bin", executable));
      if (found) return found;
    } catch {
      // The SDK manager config is optional.
    }
  }
  return undefined;
}

async function discoverLatestWindowsSdk(): Promise<string | undefined> {
  if (process.platform !== "win32" || !process.env.APPDATA) return undefined;
  const sdksRoot = path.join(process.env.APPDATA, "Garmin", "ConnectIQ", "Sdks");
  try {
    const entries = (await readdir(sdksRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    for (const entry of entries) {
      const found = await existing(path.join(sdksRoot, entry.name, "bin", "monkeyc.bat"));
      if (found) return found;
    }
  } catch {
    // SDK root is optional.
  }
  return undefined;
}

export async function discoverMonkeyc(configuredPath?: string): Promise<string | undefined> {
  return (
    (await existing(configuredPath)) ??
    (await existing(process.env.CIQ_MONKEYC)) ??
    (await discoverFromSdkConfig()) ??
    (await discoverLatestWindowsSdk())
  );
}

export interface PackageIqRequest {
  appName: string;
  junglePath: string;
  manifestPath: string;
  developerKey: string;
  devices: string[];
  outputIqPath: string;
  compilerPath: string;
  concurrency?: number | undefined;
  appVersion?: string | undefined;
  timeoutMs?: number | undefined;
  stageDir?: string | undefined;
  onProgress?: ((event: { deviceId: string; index: number; total: number; status: "started" | "passed" | "failed" }) => void) | undefined;
}

export interface PackageIqResult {
  status: "passed" | "failed";
  outputIqPath: string;
  durationMs: number;
  devicesCompiled: number;
  iqSizeBytes?: number | undefined;
  deviceResults: CompileResult[];
  error?: string | undefined;
}

export async function packageIqParallel(
  request: PackageIqRequest,
  compiler: GarminCompilerAdapter = new GarminCompilerAdapter()
): Promise<PackageIqResult> {
  const started = performance.now();
  const stage = request.stageDir ?? path.resolve(path.dirname(request.outputIqPath), ".iq-stage");
  await mkdir(stage, { recursive: true });

  const cpus = typeof os.cpus === "function" ? (os.cpus()?.length ?? 4) : 4;
  const concurrency = request.concurrency && request.concurrency > 0
    ? request.concurrency
    : Math.max(1, cpus - 4);

  const deviceResults: CompileResult[] = new Array(request.devices.length);
  let cursor = 0;
  let hasFailure = false;

  const compileWorker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= request.devices.length) return;
      const deviceId = request.devices[index] as string;
      const devStage = path.join(stage, deviceId);
      const prgOut = path.join(devStage, `${request.appName}.prg`);

      request.onProgress?.({ deviceId, index: index + 1, total: request.devices.length, status: "started" });

      const result = await compiler.compile({
        compilerPath: request.compilerPath,
        junglePath: request.junglePath,
        developerKey: request.developerKey,
        deviceId,
        outputPath: prgOut,
        timeoutMs: request.timeoutMs ?? 120_000
      });

      deviceResults[index] = result;
      if (result.status !== "passed") {
        hasFailure = true;
        request.onProgress?.({ deviceId, index: index + 1, total: request.devices.length, status: "failed" });
      } else {
        request.onProgress?.({ deviceId, index: index + 1, total: request.devices.length, status: "passed" });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, request.devices.length) }, compileWorker)
  );

  if (hasFailure) {
    const failedList = deviceResults.filter((r) => r && r.status !== "passed").map((r) => r.deviceId);
    return {
      status: "failed",
      outputIqPath: request.outputIqPath,
      durationMs: Math.round(performance.now() - started),
      devicesCompiled: deviceResults.filter((r) => r && r.status === "passed").length,
      deviceResults,
      error: `Compilation failed for devices: ${failedList.join(", ")}`
    };
  }

  // Java IqPackager Bridge execution
  const sdkBin = path.dirname(request.compilerPath);
  const monkeybrainsJar = path.join(sdkBin, "monkeybrains.jar");
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidateScripts = [
    path.resolve(moduleDir, "../../../../scripts"),
    path.resolve(moduleDir, "../../../scripts"),
    path.resolve(moduleDir, "../../scripts")
  ];
  let scriptsDir = candidateScripts[0] as string;
  for (const c of candidateScripts) {
    if (await existing(path.join(c, "IqPackagerBridge.java")) || await existing(path.join(c, "tools", "IqPackagerBridge.class"))) {
      scriptsDir = c;
      break;
    }
  }

  const devicesDir = process.platform === "win32"
    ? path.join(process.env.APPDATA ?? "", "Garmin", "ConnectIQ", "Devices")
    : path.join(os.homedir(), ".Garmin", "ConnectIQ", "Devices");
  const projectDir = path.dirname(request.manifestPath);
  const outputDir = path.dirname(request.outputIqPath);

  const cpSeparator = process.platform === "win32" ? ";" : ":";
  const javaArgs = [
    "-cp",
    `${scriptsDir}${cpSeparator}${monkeybrainsJar}`,
    "com.atelier.tools.IqPackagerBridge",
    "--projectDir", projectDir,
    "--manifest", request.manifestPath,
    "--outputDir", outputDir,
    "--key", request.developerKey,
    "--devicesDir", devicesDir,
    "--stageDir", stage,
    "--appName", request.appName
  ];

  const packResult = await runProcess("java", javaArgs, 60_000);
  if (packResult.exitCode !== 0) {
    return {
      status: "failed",
      outputIqPath: request.outputIqPath,
      durationMs: Math.round(performance.now() - started),
      devicesCompiled: deviceResults.length,
      deviceResults,
      error: `IqPackager failed: ${packResult.stderr || packResult.stdout}`
    };
  }

  let iqSizeBytes: number | undefined;
  try {
    const s = await readFile(request.outputIqPath);
    iqSizeBytes = s.byteLength;
  } catch {
    // optional stat
  }

  return {
    status: "passed",
    outputIqPath: request.outputIqPath,
    durationMs: Math.round(performance.now() - started),
    devicesCompiled: deviceResults.length,
    iqSizeBytes,
    deviceResults
  };
}
