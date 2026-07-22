import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDevices, loadForgeConfig, loadScenarios } from "@ciq-forge/core";

describe("declarative configuration", () => {
  it("loads the repository configuration and five scenarios", async () => {
    const config = await loadForgeConfig("forge.yml");
    const [devices, scenarios] = await Promise.all([
      loadDevices(config.inputs.devicesDir),
      loadScenarios(config.inputs.scenariosDir)
    ]);
    expect(devices.map((value) => value.id)).toEqual(["fenix7", "forerunner965", "venu3"]);
    expect(scenarios).toHaveLength(5);
    expect(config.project.developerKey).toBeUndefined();
    expect(config.simulator.window).toEqual({ x: 0, y: 0, width: 1200, height: 1000 });
  });

  it("rejects unknown device fields", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-"));
    await mkdir(path.join(root, "devices"));
    await writeFile(
      path.join(root, "devices", "bad.yml"),
      "id: bad\ngarminProductId: bad\nfamily: bad\ndisplay: { width: 1, height: 1, technology: mip }\ncapabilities: {}\ntypo: true\n"
    );
    await expect(loadDevices(path.join(root, "devices"))).rejects.toThrow();
  });
});
