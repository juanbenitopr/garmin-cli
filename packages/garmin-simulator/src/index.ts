import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "../../garmin-compiler/src/index.js";

export interface SimulatorTools {
  connectiqPath: string;
  monkeydoPath: string;
}

export interface SimulatorRunResult {
  status: "passed" | "failed" | "timed-out";
  durationMs: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  screenshotError?: string;
}

export interface SimulatorWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_SIMULATOR_WINDOW_BOUNDS: SimulatorWindowBounds = {
  x: 0,
  y: 0,
  width: 1_200,
  height: 1_000
};

async function fileExists(value: string): Promise<boolean> {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

export async function resolveSimulatorScript(name: "wait-simulator.ps1" | "capture-simulator.ps1" | "unlock-simulator.ps1" | "hide-simulator.ps1"): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDirectory, "../../../../scripts", name),
    path.resolve(moduleDirectory, "../../../scripts", name),
    path.resolve(moduleDirectory, "../../scripts", name)
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error(`CIQ Forge simulator helper is missing: ${name}`);
}

export async function discoverSimulatorTools(input: {
  monkeycPath: string;
  connectiqPath?: string;
  monkeydoPath?: string;
}): Promise<SimulatorTools | undefined> {
  const bin = path.dirname(input.monkeycPath);
  const suffix = process.platform === "win32" ? ".bat" : "";
  const connectiqPath = input.connectiqPath ?? path.join(bin, `connectiq${suffix}`);
  const monkeydoPath = input.monkeydoPath ?? path.join(bin, `monkeydo${suffix}`);
  return (await fileExists(connectiqPath)) && (await fileExists(monkeydoPath))
    ? { connectiqPath, monkeydoPath }
    : undefined;
}

function quoteWindowsArgument(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Process arguments cannot contain control characters.");
  return `"${value.replace(/"/g, '""')}"`;
}

function spawnTool(command: string, args: string[], hidden: boolean): ChildProcess {
  const isWindowsScript = process.platform === "win32" && /\.(bat|cmd)$/i.test(command);
  const commandLine = isWindowsScript
    ? `"${[command, ...args].map(quoteWindowsArgument).join(" ")}"`
    : undefined;
  return spawn(
    isWindowsScript ? (process.env.ComSpec ?? "cmd.exe") : command,
    isWindowsScript ? ["/d", "/s", "/c", commandLine as string] : args,
    {
      windowsHide: hidden,
      shell: false,
      windowsVerbatimArguments: isWindowsScript,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function killProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await runProcess("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], 10_000).catch(() => undefined);
  } else {
    child.kill("SIGTERM");
  }
}

export class SimulatorController {
  private simulator: ChildProcess | undefined;
  private simulatorWindowPid: number | undefined;
  private ownsSimulator = false;

  constructor(private readonly tools: SimulatorTools) {}

  async start(startupTimeoutMs: number, windowTitle: string): Promise<void> {
    if (this.simulator && this.simulator.exitCode === null) return;
    if (process.platform === "win32") {
      const existing = await waitForSimulatorWindow(windowTitle, 300);
      if (existing !== undefined) {
        this.simulatorWindowPid = existing;
        this.ownsSimulator = false;
        return;
      }
    }
    const child = spawnTool(this.tools.connectiqPath, [], false);
    this.simulator = child;
    this.ownsSimulator = true;
    let startupError = "";
    child.stderr?.on("data", (chunk) => (startupError += String(chunk)));
    const delay = Math.min(1_000, startupTimeoutMs);
    await wait(delay);
    if (child.exitCode !== null && child.exitCode !== 0) {
      throw new Error(`Garmin Simulator exited during startup: ${startupError.trim()}`);
    }
    if (process.platform === "win32") {
      const readyPid = await waitForSimulatorWindow(windowTitle, startupTimeoutMs);
      if (readyPid === undefined) throw new Error("Garmin Simulator did not become ready.");
      this.simulatorWindowPid = readyPid;
    }
  }

  async run(input: {
    prgPath: string;
    deviceId: string;
    timeoutMs: number;
    captureDelayMs: number;
    capture?: () => Promise<void>;
  }): Promise<SimulatorRunResult> {
    const started = performance.now();
    const runPromise = runProcess(
      this.tools.monkeydoPath,
      [input.prgPath, input.deviceId],
      input.timeoutMs
    );
    let screenshotError: string | undefined;
    if (input.capture) {
      await wait(input.captureDelayMs);
      try {
        await input.capture();
      } catch (error) {
        screenshotError = error instanceof Error ? error.message : String(error);
      }
    }
    const result = await runPromise;
    return {
      status: result.timedOut ? "timed-out" : result.exitCode === 0 ? "passed" : "failed",
      durationMs: Math.round(performance.now() - started),
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(screenshotError ? { screenshotError } : {})
    };
  }

  async stop(): Promise<void> {
    if (!this.ownsSimulator) return;
    if (process.platform === "win32" && this.simulatorWindowPid) {
      await runProcess("taskkill.exe", ["/PID", String(this.simulatorWindowPid), "/T", "/F"], 10_000).catch(() => undefined);
    } else if (this.simulator) {
      await killProcessTree(this.simulator);
    }
    this.simulator = undefined;
    this.simulatorWindowPid = undefined;
    this.ownsSimulator = false;
  }
}

async function waitForSimulatorWindow(windowTitle: string, timeoutMs: number): Promise<number | undefined> {
  const waitScript = await resolveSimulatorScript("wait-simulator.ps1");
  const result = await runProcess(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", waitScript, "-WindowTitle", windowTitle, "-TimeoutMs", String(timeoutMs)],
    timeoutMs + 2_000
  );
  if (result.timedOut || result.exitCode !== 0) return undefined;
  const pid = Number(result.stdout.trim().split(/\s+/).at(-1));
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export async function captureSimulatorWindow(input: {
  outputPath: string;
  windowTitle?: string | undefined;
  processId?: number | undefined;
  scriptPath?: string | undefined;
  windowBounds?: SimulatorWindowBounds | undefined;
}): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Automatic simulator screenshots are currently implemented only on Windows.");
  }
  const scriptPath = input.scriptPath ?? await resolveSimulatorScript("capture-simulator.ps1");
  const bounds = input.windowBounds ?? DEFAULT_SIMULATOR_WINDOW_BOUNDS;
  const result = await runProcess(
    "powershell.exe",
    buildCaptureScriptArguments({
      scriptPath,
      outputPath: input.outputPath,
      windowTitle: input.windowTitle ?? "CIQ Simulator",
      processId: input.processId,
      windowBounds: bounds
    }),
    15_000
  );
  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Simulator screenshot failed.");
  }
}

export function buildCaptureScriptArguments(input: {
  scriptPath: string;
  outputPath: string;
  windowTitle: string;
  processId?: number | undefined;
  windowBounds: SimulatorWindowBounds;
}): string[] {
  return [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    input.scriptPath,
    "-OutputPath",
    input.outputPath,
    "-WindowTitle",
    input.windowTitle,
    ...(input.processId ? ["-ProcessId", String(input.processId)] : []),
    "-WindowX",
    String(input.windowBounds.x),
    "-WindowY",
    String(input.windowBounds.y),
    "-WindowWidth",
    String(input.windowBounds.width),
    "-WindowHeight",
    String(input.windowBounds.height)
  ];
}

export interface SimulatorInstance {
  port: number;
  process: ChildProcess;
  pid: number;
  busy: boolean;
}

export interface ParallelSimulatorRunRequest {
  prgPath: string;
  deviceId: string;
  timeoutMs: number;
  captureDelayMs?: number | undefined;
  capture?: (() => Promise<void>) | undefined;
  headless?: boolean | undefined;
}

export class SimulatorPool {
  private instances: Map<number, SimulatorInstance> = new Map();
  private basePort = 12340;
  private portCounter = 0;

  constructor(
    private readonly simulatorExePath: string,
    private readonly maxConcurrent: number = 2
  ) {}

  async acquireInstance(headless: boolean = false): Promise<SimulatorInstance> {
    while (this.instances.size >= this.maxConcurrent) {
      await wait(200);
    }

    const port = this.basePort + (this.portCounter++ % 100);
    const inst = await this.spawnSimulatorInstance(port, headless);
    this.instances.set(port, inst);
    return inst;
  }

  private async spawnSimulatorInstance(port: number, headless: boolean): Promise<SimulatorInstance> {
    const isWindows = process.platform === "win32";
    const child = spawn(
      this.simulatorExePath,
      [],
      {
        env: { ...process.env, SHELL_SERVER_PORT: String(port) },
        windowsHide: false,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    child.unref();
    const pid = child.pid!;
    const inst: SimulatorInstance = { port, process: child, pid, busy: true };

    await wait(2500);

    if (isWindows) {
      const unlockScript = await resolveSimulatorScript("unlock-simulator.ps1").catch(() => undefined);
      if (unlockScript) {
        await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", unlockScript, "-ProcessId", String(pid)], 5000).catch(() => undefined);
      }
      if (headless) {
        const hideScript = await resolveSimulatorScript("hide-simulator.ps1").catch(() => undefined);
        if (hideScript) {
          await runProcess("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", hideScript, "-ProcessId", String(pid)], 5000).catch(() => undefined);
        }
      }
    }

    return inst;
  }

  async runOnPort(
    inst: SimulatorInstance,
    input: ParallelSimulatorRunRequest
  ): Promise<SimulatorRunResult> {
    const started = performance.now();
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidateScripts = [
      path.resolve(moduleDir, "../../../../scripts"),
      path.resolve(moduleDir, "../../../scripts"),
      path.resolve(moduleDir, "../../scripts")
    ];
    let scriptsDir = candidateScripts[0] as string;
    for (const c of candidateScripts) {
      if (await fileExists(path.join(c, "PortMonkeyDo.java")) || await fileExists(path.join(c, "tools", "PortMonkeyDo.class"))) {
        scriptsDir = c;
        break;
      }
    }

    const sdkBin = path.dirname(this.simulatorExePath);
    const jar = path.join(sdkBin, "monkeybrains.jar");
    const cpSeparator = process.platform === "win32" ? ";" : ":";
    const isWindows = process.platform === "win32";
    const durationSec = input.capture
      ? Math.ceil(((input.captureDelayMs ?? 4000) + 1500) / 1000)
      : Math.min(6, Math.ceil(input.timeoutMs / 1000));

    const child = spawn(
      "java",
      [
        "-cp",
        `${scriptsDir}${cpSeparator}${jar}`,
        "tools.PortMonkeyDo",
        String(inst.port),
        input.prgPath,
        input.deviceId,
        String(durationSec)
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    child.unref();

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    let screenshotError: string | undefined;
    let timedOut = false;
    let completed = false;

    const stopProcess = async () => {
      if (completed) return;
      completed = true;
      if (isWindows && child.pid) {
        await runProcess("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], 3000).catch(() => undefined);
      } else {
        child.kill("SIGTERM");
      }
    };

    const processPromise = new Promise<{ exitCode: number | null }>((resolve) => {
      child.on("close", (code) => {
        completed = true;
        resolve({ exitCode: code });
      });
      child.on("error", () => {
        completed = true;
        resolve({ exitCode: 1 });
      });
    });

    // 1. Event-Driven Capture and Early Exit workflow
    if (input.capture) {
      let captured = false;
      const doCapture = async () => {
        if (captured || completed) return;
        captured = true;
        // Wait 800ms after render.complete to ensure wxWidgets/DWM has fully composited heavy bitmaps
        await wait(800);
        try {
          await input.capture!();
        } catch (error) {
          screenshotError = error instanceof Error ? error.message : String(error);
        }
        await wait(300);
        await stopProcess();
      };

      // Poll every 50ms for the first rendered frame event
      const checkInterval = setInterval(() => {
        if (stdout.includes("render.complete") || stdout.includes("view.update") || stdout.includes("runtime.stats")) {
          clearInterval(checkInterval);
          doCapture();
        }
      }, 50);

      // Fallback timer in case the application does not emit Forge instrumentation events
      const fallbackTimer = setTimeout(() => {
        clearInterval(checkInterval);
        doCapture();
      }, input.captureDelayMs ?? 7000);

      child.on("close", () => {
        clearInterval(checkInterval);
        clearTimeout(fallbackTimer);
      });
    } else {
      const checkInterval = setInterval(async () => {
        if (stdout.includes("render.complete") || stdout.includes("runtime.stats")) {
          clearInterval(checkInterval);
          await wait(400);
          await stopProcess();
        }
      }, 100);
      child.on("close", () => clearInterval(checkInterval));
    }

    // Safety timeout
    const timeoutTimer = setTimeout(async () => {
      if (!completed) {
        timedOut = true;
        await stopProcess();
      }
    }, input.timeoutMs);

    const result = await processPromise;
    clearTimeout(timeoutTimer);
    
    // Clean up simulator instance for this worker slot
    try {
      if (inst.pid) {
        if (isWindows) {
          await runProcess("taskkill.exe", ["/PID", String(inst.pid), "/T", "/F"], 3000).catch(() => undefined);
        } else {
          inst.process.kill("SIGKILL");
        }
      }
    } finally {
      this.instances.delete(inst.port);
    }

    return {
      status: timedOut ? "timed-out" : (result.exitCode === 0 || stdout.includes("CIQ_FORGE_EVENT|")) ? "passed" : "failed",
      durationMs: Math.round(performance.now() - started),
      exitCode: result.exitCode,
      stdout,
      stderr,
      ...(screenshotError ? { screenshotError } : {})
    };
  }

  async stopAll(): Promise<void> {
    for (const inst of this.instances.values()) {
      if (inst.pid) {
        if (process.platform === "win32") {
          await runProcess("taskkill.exe", ["/PID", String(inst.pid), "/T", "/F"], 5000).catch(() => undefined);
        } else {
          inst.process.kill("SIGKILL");
        }
      }
    }
    this.instances.clear();
  }
}
