import { describe, expect, it } from "vitest";
import { assertProfileBudgets, collectProfileMetrics, parseForgeEvents } from "@ciq-forge/core";

describe("runtime profiling", () => {
  it("aggregates memory, render timing and a low-power energy proxy", () => {
    const events = parseForgeEvents([
      "CIQ_FORGE_EVENT|1|run|runtime.stats|checkpoint=app.start;usedMemory=40000;freeMemory=60000;totalMemory=100000;battery=80;timerMs=10",
      "CIQ_FORGE_EVENT|1|run|render.sample|durationMs=4",
      "CIQ_FORGE_EVENT|1|run|runtime.stats|checkpoint=render.complete;usedMemory=48000;freeMemory=52000;totalMemory=100000;battery=80;timerMs=20",
      "CIQ_FORGE_EVENT|1|run|render.sample|durationMs=6"
    ].join("\n"));
    const metrics = collectProfileMetrics({ events, binaryBytes: 12345, lowPower: true });
    expect(metrics.memory?.peakBytes).toBe(48000);
    expect(metrics.memory?.peakPercent).toBe(48);
    expect(metrics.performance?.averageRenderMs).toBe(5);
    expect(metrics.energy?.activeSecondsPerDay).toBe(7.2);
  });

  it("fails configured budgets when a metric is missing or over its limit", () => {
    const results = assertProfileBudgets(
      { binaryBytes: 2000, memory: { initialBytes: 10, peakBytes: 80, finalBytes: 70, totalBytes: 100, peakPercent: 80, samples: 2 } },
      { binaryBytes: 1000, memoryPeakPercent: 90, energyScore: 5 }
    );
    expect(results.find((result) => result.name === "budget.binaryBytes")?.status).toBe("failed");
    expect(results.find((result) => result.name === "budget.memoryPeakPercent")?.status).toBe("passed");
    expect(results.find((result) => result.name === "budget.energyScore")?.status).toBe("failed");
  });
});
