import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDevices, loadForgeConfig, loadProject, loadScenarios } from "@ciq-forge/core";
import { classNameFrom, createScaffold } from "../packages/cli/src/scaffold.js";

describe("Connect IQ project scaffolding", () => {
  it("creates a self-contained watch face accepted by the project loaders", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-scaffold-"));
    const directory = path.join(temporary, "solar-face");
    const result = await createScaffold({
      directory,
      name: "Solar Face",
      type: "watchface",
      devices: ["fenix7", "venu3"],
      minApiLevel: "3.2.0"
    });

    const config = await loadForgeConfig(path.join(directory, "forge.yml"));
    const [project, devices, scenarios] = await Promise.all([
      loadProject({ root: config.project.root, junglePath: config.project.jungle, manifestPath: config.project.manifest }),
      loadDevices(config.inputs.devicesDir),
      loadScenarios(config.inputs.scenariosDir)
    ]);

    expect(result.className).toBe("SolarFace");
    expect(result.applicationId).toMatch(/^[a-f0-9]{32}$/);
    expect(project.applicationType).toBe("watchface");
    expect(project.products).toEqual(["fenix7", "venu3"]);
    expect(devices.map((device) => device.id)).toEqual(["fenix7", "venu3"]);
    expect(scenarios.map((scenario) => scenario.name)).toEqual(["normal"]);
    const app = await readFile(path.join(directory, "source", "SolarFaceApp.mc"), "utf8");
    const view = await readFile(path.join(directory, "source", "SolarFaceView.mc"), "utf8");
    const bootstrap = await readFile(path.join(directory, "source", "ForgeBootstrap.mc"), "utf8");
    const barrel = await readFile(path.join(directory, "vendor", "ciq-forge", "CiqForge.mc"), "utf8");
    expect(app).toContain("extends CiqForge.AppBase");
    expect(app).toContain("return ForgeBootstrap.context()");
    expect(app).toContain("createInitialView(forgeContext)");
    expect(view).toContain("extends CiqForge.WatchFace");
    expect(view).toContain("function onForgeUpdate(dc)");
    expect(view).not.toContain("function onUpdate(dc)");
    expect(bootstrap).toContain("private var _context = null");
    expect(barrel).toContain("module CiqForge");
    expect(barrel).toContain("class WatchFace extends Ui.WatchFace");
  });

  it("creates a device app with a valid Monkey C class name", async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-scaffold-"));
    const directory = path.join(temporary, "123 app");
    const result = await createScaffold({
      directory,
      name: "123 Steps & More",
      type: "app",
      devices: ["forerunner965"],
      minApiLevel: "4.0.0"
    });
    const manifest = await readFile(path.join(directory, "manifest.xml"), "utf8");
    const view = await readFile(path.join(directory, "source", `${result.className}View.mc`), "utf8");

    expect(result.className).toBe("App123StepsMore");
    expect(manifest).toContain('type="watch-app"');
    expect(view).toContain("extends CiqForge.View");
    expect(view).toContain("function onForgeUpdate(dc)");
    expect(view).toContain('var text = "123 Steps & More";');
    expect(classNameFrom("---")).toBe("ConnectIq");
  });

  it("refuses to overwrite a non-empty destination", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-scaffold-"));
    await writeFile(path.join(directory, "keep.txt"), "mine", "utf8");
    await expect(createScaffold({
      directory,
      name: "No overwrite",
      type: "watchface",
      devices: ["venu3"],
      minApiLevel: "3.2.0"
    })).rejects.toThrow("Destination is not empty");
  });
});
