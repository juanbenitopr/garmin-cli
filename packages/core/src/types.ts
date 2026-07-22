export interface DeviceDefinition {
  id: string;
  garminProductId: string;
  family: string;
  display: {
    width: number;
    height: number;
    technology: "amoled" | "mip";
    shape?: "round" | "rectangle";
  };
  capture?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | undefined;
  capabilities: Record<string, boolean>;
}

export interface ScenarioDefinition {
  name: string;
  time: string;
  system: Record<string, unknown>;
  activity: Record<string, unknown>;
  weather: Record<string, unknown>;
  settings: Record<string, unknown>;
  budgets: Record<string, number>;
}

export interface ForgeConfig {
  project: {
    root: string;
    jungle: string;
    manifest: string;
    developerKey?: string;
  };
  inputs: {
    devicesDir: string;
    scenariosDir: string;
  };
  execution: {
    workers: number;
    timeoutMs: number;
    output: string;
  };
  compiler: {
    path?: string;
    maxConcurrency: number;
  };
  simulator: {
    connectiqPath?: string;
    monkeydoPath?: string;
    startupTimeoutMs: number;
    captureDelayMs: number;
    windowTitle: string;
    window: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  visual: {
    baselinesDir: string;
    differenceThreshold: number;
    pixelThreshold: number;
  };
}

export type StageStatus = "passed" | "failed" | "timed-out" | "skipped";

export interface StageResult {
  status: StageStatus;
  durationMs: number;
  message?: string;
}

export interface ForgeEvent {
  version: number;
  runId: string;
  name: string;
  payload: string;
  raw: string;
}

export interface AssertionResult {
  name: string;
  status: "passed" | "failed";
  message?: string;
}

export interface ProfileMetrics {
  binaryBytes?: number;
  memory?: {
    initialBytes: number;
    peakBytes: number;
    finalBytes: number;
    totalBytes: number;
    peakPercent: number;
    samples: number;
  };
  performance?: {
    renderSamples: number;
    averageRenderMs: number;
    maxRenderMs: number;
  };
  energy?: {
    method: "cpu-time-proxy";
    updateIntervalSeconds: number;
    activeSecondsPerDay: number;
    relativeScore: number;
  };
}

export interface RunArtifacts {
  jobDirectory: string;
  prg?: string;
  current?: string;
  baseline?: string;
  diff?: string;
  logs: string;
}

export interface RunResult {
  id: string;
  device: string;
  scenario: string;
  status: "passed" | "failed";
  stages: {
    build: StageResult;
    launch: StageResult;
    scenario: StageResult;
    assertions: StageResult;
    profile: StageResult;
    screenshot: StageResult;
    diff: StageResult;
  };
  events: ForgeEvent[];
  assertions: AssertionResult[];
  metrics: ProfileMetrics;
  artifacts: RunArtifacts;
  warnings: string[];
}

export interface MatrixJob {
  id: string;
  device: DeviceDefinition;
  scenario: ScenarioDefinition;
}

export interface LoadedProject {
  root: string;
  junglePath: string;
  manifestPath: string;
  applicationId?: string;
  applicationType?: string;
  products: string[];
  sourcePaths: string[];
  resourcePaths: string[];
}
