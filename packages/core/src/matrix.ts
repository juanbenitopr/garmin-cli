import type { DeviceDefinition, MatrixJob, ScenarioDefinition } from "./types.js";

export function createMatrix(
  devices: DeviceDefinition[],
  scenarios: ScenarioDefinition[]
): MatrixJob[] {
  return [...devices]
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((device) =>
      [...scenarios]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((scenario) => ({
          id: `${device.id}__${scenario.name}`,
          device,
          scenario
        }))
    );
}

export async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await task(values[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}
