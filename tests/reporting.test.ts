import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeRunReports, type RunResult } from "@ciq-forge/core";

describe("matrix reporting", () => {
  it("writes canonical JSON, JUnit and HTML outputs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ciq-forge-report-"));
    const stage = { status: "passed" as const, durationMs: 1 };
    const result: RunResult = {
      id: "venu3__normal",
      device: "venu3",
      scenario: "normal",
      status: "passed",
      stages: {
        build: stage,
        launch: stage,
        scenario: stage,
        assertions: stage,
        profile: stage,
        screenshot: { status: "skipped", durationMs: 0 },
        diff: { status: "skipped", durationMs: 0 }
      },
      events: [],
      assertions: [],
      metrics: { binaryBytes: 1234 },
      artifacts: { jobDirectory: root, logs: path.join(root, "run.log") },
      warnings: []
    };
    await writeRunReports([result], root);
    expect(JSON.parse(await readFile(path.join(root, "results.json"), "utf8"))).toHaveLength(1);
    expect(await readFile(path.join(root, "junit.xml"), "utf8")).toContain("<testsuite");
    expect(await readFile(path.join(root, "report.html"), "utf8")).toContain("venu3__normal");
  });
});
