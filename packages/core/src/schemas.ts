import { z } from "zod";

const unknownMap = z.record(z.string(), z.unknown()).default({});

export const deviceSchema = z.strictObject({
  id: z.string().min(1),
  garminProductId: z.string().min(1),
  family: z.string().min(1),
  display: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    technology: z.enum(["amoled", "mip"]),
    shape: z.enum(["round", "rectangle"]).default("round")
  }),
  capabilities: z.record(z.string(), z.boolean()).default({}),
  capture: z.strictObject({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive()
  }).optional()
});

export const scenarioSchema = z.strictObject({
  name: z.string().min(1),
  time: z.iso.datetime({ offset: true }),
  system: unknownMap,
  activity: unknownMap,
  weather: unknownMap,
  settings: unknownMap,
  budgets: z.record(z.string(), z.number().nonnegative()).default({})
});

export const forgeConfigSchema = z.strictObject({
  project: z.strictObject({
    root: z.string().default("."),
    jungle: z.string().default("monkey.jungle"),
    manifest: z.string().default("manifest.xml"),
    developerKey: z.string().optional()
  }),
  inputs: z.strictObject({
    devicesDir: z.string().default("devices"),
    scenariosDir: z.string().default("scenarios")
  }),
  execution: z.strictObject({
    workers: z.number().int().min(1).max(64).default(4),
    timeoutMs: z.number().int().positive().default(30_000),
    output: z.string().default(".ciq-forge/results")
  }),
  compiler: z.strictObject({
    path: z.string().optional(),
    maxConcurrency: z.number().int().min(1).max(16).default(1)
  }).default({ maxConcurrency: 1 }),
  simulator: z.strictObject({
    connectiqPath: z.string().optional(),
    monkeydoPath: z.string().optional(),
    startupTimeoutMs: z.number().int().positive().default(15_000),
    captureDelayMs: z.number().int().nonnegative().default(2_000),
    windowTitle: z.string().min(1).default("Connect IQ Device Simulator"),
    window: z.strictObject({
      x: z.number().int().default(0),
      y: z.number().int().default(0),
      width: z.number().int().positive().default(1_200),
      height: z.number().int().positive().default(1_000)
    }).default({ x: 0, y: 0, width: 1_200, height: 1_000 })
  }).default({
    startupTimeoutMs: 15_000,
    captureDelayMs: 2_000,
    windowTitle: "Connect IQ Device Simulator",
    window: { x: 0, y: 0, width: 1_200, height: 1_000 }
  }),
  visual: z.strictObject({
    baselinesDir: z.string().default("baselines"),
    differenceThreshold: z.number().min(0).max(1).default(0.001),
    pixelThreshold: z.number().int().min(0).max(255).default(16)
  }).default({
    baselinesDir: "baselines",
    differenceThreshold: 0.001,
    pixelThreshold: 16
  })
});
