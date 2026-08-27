import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCaptureScriptArguments,
  discoverSimulatorTools,
  resolveSimulatorScript
} from "../packages/garmin-simulator/src/index.js";

describe("simulator tool discovery", () => {
  it("discovers connectiq and monkeydo next to monkeyc", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-sdk-"));
    const bin = path.join(root, "bin");
    await mkdir(bin);
    const suffix = process.platform === "win32" ? ".bat" : "";
    const monkeyc = path.join(bin, `monkeyc${suffix}`);
    await Promise.all([
      writeFile(monkeyc, ""),
      writeFile(path.join(bin, `connectiq${suffix}`), ""),
      writeFile(path.join(bin, `monkeydo${suffix}`), "")
    ]);
    const tools = await discoverSimulatorTools({ monkeycPath: monkeyc });
    expect(tools?.connectiqPath).toContain("connectiq");
    expect(tools?.monkeydoPath).toContain("monkeydo");
  });
});

describe("simulator screenshot preparation", () => {
  it("passes deterministic window bounds to the capture script", () => {
    const args = buildCaptureScriptArguments({
      scriptPath: "capture.ps1",
      outputPath: "window.png",
      windowTitle: "CIQ Simulator",
      windowBounds: { x: 12, y: 34, width: 1200, height: 1000 }
    });

    expect(args).toEqual(expect.arrayContaining([
      "-WindowX", "12",
      "-WindowY", "34",
      "-WindowWidth", "1200",
      "-WindowHeight", "1000"
    ]));
  });
});

describe("simulator helper discovery", () => {
  it("resolves bundled scripts independently of the current working directory", async () => {
    const originalDirectory = process.cwd();
    const externalDirectory = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-project-"));
    try {
      process.chdir(externalDirectory);
      const waitScript = await resolveSimulatorScript("wait-simulator.ps1");
      const captureScript = await resolveSimulatorScript("capture-simulator.ps1");
      await expect(access(waitScript)).resolves.toBeUndefined();
      await expect(access(captureScript)).resolves.toBeUndefined();
      expect(waitScript).not.toContain(externalDirectory);
      expect(captureScript).not.toContain(externalDirectory);
    } finally {
      process.chdir(originalDirectory);
    }
  });
});
