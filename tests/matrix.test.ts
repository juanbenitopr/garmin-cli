import { describe, expect, it } from "vitest";
import { createMatrix, mapConcurrent, type DeviceDefinition, type ScenarioDefinition } from "@ciq-forge/core";

const device = (id: string): DeviceDefinition => ({
  id,
  garminProductId: id,
  family: id,
  display: { width: 100, height: 100, technology: "mip" },
  capabilities: {}
});

const scenario = (name: string): ScenarioDefinition => ({
  name,
  time: "2026-07-21T09:00:00+02:00",
  system: {},
  activity: {},
  weather: {},
  settings: {},
  budgets: {}
});

describe("execution matrix", () => {
  it("is deterministic regardless of input ordering", () => {
    const first = createMatrix([device("z"), device("a")], [scenario("night"), scenario("day")]);
    const second = createMatrix([device("a"), device("z")], [scenario("day"), scenario("night")]);
    expect(first.map((job) => job.id)).toEqual(second.map((job) => job.id));
    expect(first.map((job) => job.id)).toEqual(["a__day", "a__night", "z__day", "z__night"]);
  });

  it("respects concurrency and preserves result ordering", async () => {
    let active = 0;
    let peak = 0;
    const results = await mapConcurrent([30, 5, 15, 1], 2, async (delay, index) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return index;
    });
    expect(peak).toBe(2);
    expect(results).toEqual([0, 1, 2, 3]);
  });
});
