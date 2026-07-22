import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
