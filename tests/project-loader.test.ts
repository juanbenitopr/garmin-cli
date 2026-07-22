import { describe, expect, it } from "vitest";
import { loadForgeConfig, loadProject } from "@ciq-forge/core";

describe("Connect IQ project loader", () => {
  it("reads manifest products and basic Jungle paths", async () => {
    const config = await loadForgeConfig("forge.yml");
    const project = await loadProject({
      root: config.project.root,
      junglePath: config.project.jungle,
      manifestPath: config.project.manifest
    });
    expect(project.applicationType).toBe("watchface");
    expect(project.products).toEqual(["fenix7", "fr965", "venu3"]);
    expect(project.sourcePaths[0]).toMatch(/basic-watchface[\\/]source$/);
    expect(project.resourcePaths[0]).toMatch(/basic-watchface[\\/]resources$/);
  });
});
