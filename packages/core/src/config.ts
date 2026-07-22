import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { deviceSchema, forgeConfigSchema, scenarioSchema } from "./schemas.js";
import type { DeviceDefinition, ForgeConfig, ScenarioDefinition } from "./types.js";

async function readYaml(filePath: string): Promise<unknown> {
  return parse(await readFile(filePath, "utf8"));
}

function resolveFrom(base: string, value: string): string {
  return path.resolve(base, value);
}

export async function loadForgeConfig(configPath: string): Promise<ForgeConfig> {
  const absoluteConfig = path.resolve(configPath);
  const base = path.dirname(absoluteConfig);
  const parsed = forgeConfigSchema.parse(await readYaml(absoluteConfig));
  const projectRoot = resolveFrom(base, parsed.project.root);

  return {
    project: {
      root: projectRoot,
      jungle: resolveFrom(projectRoot, parsed.project.jungle),
      manifest: resolveFrom(projectRoot, parsed.project.manifest),
      ...(parsed.project.developerKey
        ? { developerKey: resolveFrom(base, parsed.project.developerKey) }
        : {})
    },
    inputs: {
      devicesDir: resolveFrom(base, parsed.inputs.devicesDir),
      scenariosDir: resolveFrom(base, parsed.inputs.scenariosDir)
    },
    execution: {
      workers: parsed.execution.workers,
      timeoutMs: parsed.execution.timeoutMs,
      output: resolveFrom(base, parsed.execution.output)
    },
    compiler: {
      maxConcurrency: parsed.compiler.maxConcurrency,
      ...(parsed.compiler.path ? { path: resolveFrom(base, parsed.compiler.path) } : {})
    },
    simulator: {
      startupTimeoutMs: parsed.simulator.startupTimeoutMs,
      captureDelayMs: parsed.simulator.captureDelayMs,
      windowTitle: parsed.simulator.windowTitle,
      window: parsed.simulator.window,
      ...(parsed.simulator.connectiqPath
        ? { connectiqPath: resolveFrom(base, parsed.simulator.connectiqPath) }
        : {}),
      ...(parsed.simulator.monkeydoPath
        ? { monkeydoPath: resolveFrom(base, parsed.simulator.monkeydoPath) }
        : {})
    },
    visual: {
      baselinesDir: resolveFrom(base, parsed.visual.baselinesDir),
      differenceThreshold: parsed.visual.differenceThreshold,
      pixelThreshold: parsed.visual.pixelThreshold
    }
  };
}

async function loadYamlDirectory<T>(
  directory: string,
  parser: (value: unknown) => T
): Promise<T[]> {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(entries.map(async (entry) => parser(await readYaml(path.join(directory, entry.name)))));
}

export function loadDevices(directory: string): Promise<DeviceDefinition[]> {
  return loadYamlDirectory(directory, (value) => deviceSchema.parse(value));
}

export function loadScenarios(directory: string): Promise<ScenarioDefinition[]> {
  return loadYamlDirectory(directory, (value) => scenarioSchema.parse(value));
}
