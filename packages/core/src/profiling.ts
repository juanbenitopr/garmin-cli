import type { AssertionResult, ForgeEvent, ProfileMetrics } from "./types.js";

function fields(payload: string): Record<string, string> {
  return Object.fromEntries(payload.split(";").flatMap((part) => {
    const index = part.indexOf("=");
    return index < 1 ? [] : [[part.slice(0, index), part.slice(index + 1)]];
  }));
}

function finite(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rounded(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function collectProfileMetrics(input: {
  events: ForgeEvent[];
  binaryBytes?: number;
  lowPower: boolean;
}): ProfileMetrics {
  const metrics: ProfileMetrics = {};
  if (input.binaryBytes !== undefined) metrics.binaryBytes = input.binaryBytes;

  const memory = input.events
    .filter((event) => event.name === "runtime.stats")
    .map((event) => fields(event.payload))
    .map((value) => ({ used: finite(value.usedMemory), total: finite(value.totalMemory) }))
    .filter((value): value is { used: number; total: number } => value.used !== undefined && value.total !== undefined && value.total > 0);
  if (memory.length) {
    const initial = memory[0] as { used: number; total: number };
    const final = memory[memory.length - 1] as { used: number; total: number };
    const peakBytes = Math.max(...memory.map((sample) => sample.used));
    metrics.memory = {
      initialBytes: initial.used,
      peakBytes,
      finalBytes: final.used,
      totalBytes: final.total,
      peakPercent: rounded((peakBytes / final.total) * 100),
      samples: memory.length
    };
  }

  const durations = input.events
    .filter((event) => event.name === "render.sample")
    .map((event) => finite(fields(event.payload).durationMs))
    .filter((value): value is number => value !== undefined && value >= 0);
  if (durations.length) {
    const averageRenderMs = durations.reduce((total, value) => total + value, 0) / durations.length;
    const updateIntervalSeconds = input.lowPower ? 60 : 1;
    const activeSecondsPerDay = averageRenderMs * (86_400 / updateIntervalSeconds) / 1_000;
    metrics.performance = {
      renderSamples: durations.length,
      averageRenderMs: rounded(averageRenderMs),
      maxRenderMs: rounded(Math.max(...durations))
    };
    metrics.energy = {
      method: "cpu-time-proxy",
      updateIntervalSeconds,
      activeSecondsPerDay: rounded(activeSecondsPerDay),
      relativeScore: rounded(activeSecondsPerDay)
    };
  }
  return metrics;
}

const BUDGETS: Record<string, { read: (metrics: ProfileMetrics) => number | undefined; label: string }> = {
  binaryBytes: { read: (metrics) => metrics.binaryBytes, label: "binary bytes" },
  memoryPeakBytes: { read: (metrics) => metrics.memory?.peakBytes, label: "peak memory bytes" },
  memoryPeakPercent: { read: (metrics) => metrics.memory?.peakPercent, label: "peak memory percent" },
  renderAverageMs: { read: (metrics) => metrics.performance?.averageRenderMs, label: "average render milliseconds" },
  energyScore: { read: (metrics) => metrics.energy?.relativeScore, label: "relative energy score" }
};

export function assertProfileBudgets(metrics: ProfileMetrics, budgets: Record<string, number>): AssertionResult[] {
  const results: AssertionResult[] = [];
  for (const [name, limit] of Object.entries(budgets)) {
    const budget = BUDGETS[name];
    if (!budget) continue;
    const actual = budget.read(metrics);
    if (actual === undefined) {
      results.push({ name: `budget.${name}`, status: "failed", message: `No ${budget.label} metric was collected.` });
    } else if (actual <= limit) {
      results.push({ name: `budget.${name}`, status: "passed" });
    } else {
      results.push({ name: `budget.${name}`, status: "failed", message: `${actual} exceeds ${limit} (${budget.label}).` });
    }
  }
  return results;
}
