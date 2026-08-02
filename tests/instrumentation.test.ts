import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateScenarioArtifacts, renderScenarioSource, type MatrixJob } from "@ciq-forge/core";

const job: MatrixJob = {
  id: "venu3__training",
  device: {
    id: "venu3",
    garminProductId: "venu3",
    family: "venu3",
    display: { width: 454, height: 454, technology: "amoled" },
    capabilities: {}
  },
  scenario: {
    name: "training",
    time: "2026-07-21T09:42:30+02:00",
    system: { battery: 18, notifications: 3 },
    activity: { steps: 8432, bodyBattery: 67, weeklyDistanceMeters: 28400 },
    weather: { temperatureCelsius: 31, condition: "sunny" },
    settings: { mode: "low-power", theme: "dark" },
    budgets: {}
  }
};

describe("scenario instrumentation", () => {
  it("renders deterministic Monkey C fixture source", () => {
    const first = renderScenarioSource(job);
    const second = renderScenarioSource(job);
    expect(first).toBe(second);
    expect(first).toContain("new CiqForge.FixtureActivity");
    expect(first).toContain("new CiqForge.FixtureDisplayMode(true)");
    expect(first).toContain('new CiqForge.Diagnostics("venu3__training", true)');
    expect(first).toContain("private var _context = null");
    expect(first).toContain("if (_context == null)");
    expect(first).toContain("return _context");
  });

  it("writes an overlay Jungle that excludes production bootstrap", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-generated-"));
    const generated = await generateScenarioArtifacts(job, root, "C:/project/monkey.jungle");
    const jungle = await readFile(generated.junglePath, "utf8");
    expect(jungle).toContain("forgeProduction");
    expect(generated.combinedJunglePath).toContain("C:/project/monkey.jungle;");
  });
});
