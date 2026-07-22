import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
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
  const waitScript = path.resolve("scripts", "wait-simulator.ps1");
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
  windowTitle: string;
  scriptPath?: string;
  windowBounds?: SimulatorWindowBounds;
}): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Automatic simulator screenshots are currently implemented only on Windows.");
  }
  const scriptPath = input.scriptPath ?? path.resolve("scripts", "capture-simulator.ps1");
  const bounds = input.windowBounds ?? DEFAULT_SIMULATOR_WINDOW_BOUNDS;
  const result = await runProcess(
    "powershell.exe",
    buildCaptureScriptArguments({
      scriptPath,
      outputPath: input.outputPath,
      windowTitle: input.windowTitle,
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
