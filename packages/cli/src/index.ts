#!/usr/bin/env node
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import {
  createMatrix,
  approveBaseline,
  generateScenarioArtifacts,
  loadDevices,
  loadForgeConfig,
  loadProject,
  loadScenarios,
  mapConcurrent
} from "../../core/src/index.js";
import {
  discoverMonkeyc,
  GarminCompilerAdapter,
  type CompileResult
} from "../../garmin-compiler/src/index.js";
import { captureSimulatorWindow, discoverSimulatorTools } from "../../garmin-simulator/src/index.js";
import { executeRunMatrix } from "./pipeline.js";
import { createScaffold, parseDeviceList, scaffoldDevices, type ScaffoldType } from "./scaffold.js";

const program = new Command()
  .name("ciq-forge")
  .description("Deterministic automation for Garmin Connect IQ projects")
  .version("0.1.0");

function json(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function resolveDeveloperKey(configured: string | undefined, option: string | undefined): string | undefined {
  const candidate = option ?? process.env.CIQ_DEVELOPER_KEY ?? configured;
  return candidate ? path.resolve(candidate) : undefined;
}

function projectNameFromDirectory(directory: string): string {
  const base = path.basename(path.resolve(directory));
  const words = base.match(/[A-Za-z0-9]+/g) ?? ["Connect", "IQ", "App"];
  return words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}

async function loadWorkspace(configPath: string) {
  const config = await loadForgeConfig(configPath);
  const [project, devices, scenarios] = await Promise.all([
    loadProject({
      root: config.project.root,
      junglePath: config.project.jungle,
      manifestPath: config.project.manifest
    }),
    loadDevices(config.inputs.devicesDir),
    loadScenarios(config.inputs.scenariosDir)
  ]);
  return { config, project, devices, scenarios };
}

program
  .command("new [directory]")
  .description("Create a new Connect IQ watch face or device app")
  .option("-t, --type <type>", "Project type: watchface or app")
  .option("-n, --name <name>", "Display name")
  .option("-d, --devices <ids>", `Comma-separated devices: ${scaffoldDevices.map((device) => device.id).join(", ")}`)
  .option("--min-api <version>", "Minimum Connect IQ API level")
  .option("-y, --yes", "Accept defaults and do not prompt")
  .action(async (directoryOption: string | undefined, options: {
    type?: string;
    name?: string;
    devices?: string;
    minApi?: string;
    yes?: boolean;
  }) => {
    const interactive = !options.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const prompt = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
    const ask = async (label: string, fallback: string): Promise<string> => {
      if (!prompt) return fallback;
      const answer = (await prompt.question(`${label} (${fallback}): `)).trim();
      return answer || fallback;
    };

    try {
      const directory = directoryOption ?? await ask("Destination", "connect-iq-app");
      const name = options.name ?? await ask("Project name", projectNameFromDirectory(directory));
      const typeValue = options.type ?? await ask("Type [watchface/app]", "watchface");
      if (typeValue !== "watchface" && typeValue !== "app") {
        throw new Error(`Unknown project type: ${typeValue}. Use watchface or app.`);
      }
      const defaultDevices = scaffoldDevices.map((device) => device.id).join(",");
      const deviceValue = options.devices ?? await ask("Devices", defaultDevices);
      const minApiLevel = options.minApi ?? await ask("Minimum API", "3.2.0");
      const result = await createScaffold({
        directory,
        name,
        type: typeValue as ScaffoldType,
        devices: parseDeviceList(deviceValue),
        minApiLevel
      });
      json({ status: "created", ...result });
    } finally {
      prompt?.close();
    }
  });

program
  .command("inspect")
  .description("Inspect the project and validate all declarative inputs")
  .option("-c, --config <path>", "Forge configuration", "forge.yml")
  .action(async ({ config: configPath }) => {
    const workspace = await loadWorkspace(configPath);
    json({
      project: workspace.project,
      devices: workspace.devices,
      scenarios: workspace.scenarios.map((scenario) => ({
        name: scenario.name,
        time: scenario.time,
        budgets: scenario.budgets
      })),
      matrixJobs: createMatrix(workspace.devices, workspace.scenarios).length
    });
  });

program
  .command("matrix")
  .description("Print the deterministic device and scenario execution matrix")
  .option("-c, --config <path>", "Forge configuration", "forge.yml")
  .action(async ({ config: configPath }) => {
    const { devices, scenarios } = await loadWorkspace(configPath);
    json(createMatrix(devices, scenarios).map((job) => ({
      id: job.id,
      device: job.device.garminProductId,
      scenario: job.scenario.name
    })));
  });

program
  .command("doctor")
  .description("Check local Garmin SDK and project prerequisites")
  .option("-c, --config <path>", "Forge configuration", "forge.yml")
  .option("--developer-key <path>", "Developer key (or set CIQ_DEVELOPER_KEY)")
  .option("--compile-probe", "Compile the first device/scenario as a real SDK health check")
  .action(async ({ config: configPath, developerKey: developerKeyOption, compileProbe }) => {
    const workspace = await loadWorkspace(configPath);
    const { config } = workspace;
    const compilerPath = await discoverMonkeyc(config.compiler.path);
    const developerKey = resolveDeveloperKey(config.project.developerKey, developerKeyOption);
    const simulatorTools = compilerPath
      ? await discoverSimulatorTools({
          monkeycPath: compilerPath,
          ...(config.simulator.connectiqPath ? { connectiqPath: config.simulator.connectiqPath } : {}),
          ...(config.simulator.monkeydoPath ? { monkeydoPath: config.simulator.monkeydoPath } : {})
        })
      : undefined;
    const checks = {
      monkeyc: compilerPath ? { status: "ok", path: compilerPath } : { status: "missing" },
      connectiq: simulatorTools ? { status: "ok", path: simulatorTools.connectiqPath } : { status: "missing" },
      monkeydo: simulatorTools ? { status: "ok", path: simulatorTools.monkeydoPath } : { status: "missing" },
      developerKey: developerKey
        ? await stat(developerKey).then(
            () => ({ status: "ok" }),
            () => ({ status: "missing" })
          )
        : { status: "not-configured" },
      compileProbe: { status: "skipped" as "skipped" | "passed" | "failed", message: "Use --compile-probe to execute." }
    };
    if (compileProbe && compilerPath && developerKey) {
      const job = createMatrix(workspace.devices, workspace.scenarios)[0];
      if (!job) throw new Error("The matrix is empty.");
      const probeDirectory = path.join(config.execution.output, "doctor-probe", job.id);
      const generated = await generateScenarioArtifacts(job, probeDirectory, config.project.jungle);
      const result = await new GarminCompilerAdapter().compile({
        compilerPath,
        junglePath: generated.combinedJunglePath,
        developerKey,
        deviceId: job.device.garminProductId,
        outputPath: path.join(probeDirectory, "probe.prg"),
        timeoutMs: config.execution.timeoutMs
      });
      checks.compileProbe = {
        status: result.status === "passed" ? "passed" : "failed",
        message: result.status === "passed" ? `Compiled ${job.id}.` : result.stderr.trim()
      };
    }
    json(checks);
    if (!compilerPath || !simulatorTools || checks.developerKey.status !== "ok" || checks.compileProbe.status === "failed") process.exitCode = 1;
  });

program
  .command("run")
  .description("Build and run an instrumented device/scenario matrix")
  .option("-c, --config <path>", "Forge configuration", "forge.yml")
  .option("-d, --device <id>", "Only run one Forge device id")
  .option("-s, --scenario <name>", "Only run one scenario")
  .option("--screenshot", "Capture and compare simulator screenshots")
  .option("--developer-key <path>", "Developer key (or set CIQ_DEVELOPER_KEY)")
  .action(async ({ config: configPath, device, scenario, screenshot, developerKey: developerKeyOption }) => {
    const workspace = await loadWorkspace(configPath);
    const compilerPath = await discoverMonkeyc(workspace.config.compiler.path);
    const developerKey = resolveDeveloperKey(workspace.config.project.developerKey, developerKeyOption);
    if (!compilerPath) throw new Error("monkeyc was not found. Run doctor.");
    if (!developerKey) throw new Error("A developer key is required.");
    const jobs = createMatrix(workspace.devices, workspace.scenarios).filter((job) =>
      (!device || job.device.id === device) && (!scenario || job.scenario.name === scenario));
    if (!jobs.length) throw new Error("No matrix jobs matched the requested device and scenario.");
    const results = await executeRunMatrix({
      config: workspace.config,
      jobs,
      compilerPath,
      developerKey,
      screenshot: Boolean(screenshot)
    });
    json(results);
    if (results.some((result) => result.status === "failed")) process.exitCode = 1;
  });

program
  .command("profile")
  .description("Collect memory, render-time and relative energy metrics")
  .option("-c, --config <path>", "Forge configuration", "forge.yml")
  .option("-d, --device <id>", "Only profile one Forge device id")
  .option("-s, --scenario <name>", "Only profile one scenario")
  .option("--developer-key <path>", "Developer key (or set CIQ_DEVELOPER_KEY)")
  .action(async ({ config: configPath, device, scenario, developerKey: developerKeyOption }) => {
    const workspace = await loadWorkspace(configPath);
    const compilerPath = await discoverMonkeyc(workspace.config.compiler.path);
    const developerKey = resolveDeveloperKey(workspace.config.project.developerKey, developerKeyOption);
    if (!compilerPath) throw new Error("monkeyc was not found. Run doctor.");
    if (!developerKey) throw new Error("A developer key is required.");
    const jobs = createMatrix(workspace.devices, workspace.scenarios).filter((job) =>
      (!device || job.device.id === device) && (!scenario || job.scenario.name === scenario));
    if (!jobs.length) throw new Error("No matrix jobs matched the requested device and scenario.");
    const results = await executeRunMatrix({
      config: workspace.config,
      jobs,
      compilerPath,
      developerKey,
      screenshot: false
    });
    json(results.map(({ id, status, metrics, assertions }) => ({
      id,
      status,
      metrics,
      budgets: assertions.filter((assertion) => assertion.name.startsWith("budget."))
    })));
    if (results.some((result) => result.status === "failed")) process.exitCode = 1;
  });

program
  .command("screenshot")
  .description("Capture the currently visible Garmin Simulator window")
  .requiredOption("-o, --output <path>", "Output PNG")
  .option("-c, --config <path>", "Forge configuration", "forge.yml")
  .action(async ({ config: configPath, output }) => {
    const config = await loadForgeConfig(configPath);
    await captureSimulatorWindow({
      outputPath: path.resolve(output),
      windowTitle: config.simulator.windowTitle,
      windowBounds: config.simulator.window
    });
    json({ status: "passed", output: path.resolve(output) });
  });

const baseline = program.command("baseline").description("Manage approved visual baselines");
baseline
  .command("approve")
  .description("Explicitly approve a captured run image")
  .requiredOption("--run <id>", "Run id, e.g. venu3__normal")
  .option("-c, --config <path>", "Forge configuration", "forge.yml")
  .action(async ({ config: configPath, run }) => {
    const config = await loadForgeConfig(configPath);
    const [device, ...scenarioParts] = String(run).split("__");
    const scenario = scenarioParts.join("__");
    if (!device || !scenario) throw new Error("Run id must use device__scenario.");
    const actual = path.join(config.execution.output, "runs", run, "current.png");
    const target = path.join(config.visual.baselinesDir, device, `${scenario}.png`);
    await approveBaseline(actual, target);
    json({ status: "approved", run, baseline: target });
  });

program
  .command("build")
  .description("Compile one isolated PRG per configured device")
  .option("-c, --config <path>", "Forge configuration", "forge.yml")
  .option("-d, --device <id>", "Only build one Forge device id")
  .option("--developer-key <path>", "Developer key (or set CIQ_DEVELOPER_KEY)")
  .action(async ({ config: configPath, device: requestedDevice, developerKey: developerKeyOption }) => {
    const { config, devices } = await loadWorkspace(configPath);
    const compilerPath = await discoverMonkeyc(config.compiler.path);
    const developerKey = resolveDeveloperKey(config.project.developerKey, developerKeyOption);
    if (!compilerPath) throw new Error("monkeyc was not found. Run ciq-forge doctor.");
    if (!developerKey) {
      throw new Error("A developer key is required. Use --developer-key or CIQ_DEVELOPER_KEY.");
    }
    const selected = requestedDevice
      ? devices.filter((device) => device.id === requestedDevice)
      : devices;
    if (requestedDevice && selected.length === 0) throw new Error(`Unknown device: ${requestedDevice}`);

    const compiler = new GarminCompilerAdapter();
    const results = await mapConcurrent(selected, config.compiler.maxConcurrency, async (device) => {
      const outputPath = path.join(config.execution.output, "build", device.id, "app.prg");
      try {
        return await compiler.compile({
          compilerPath,
          junglePath: config.project.jungle,
          developerKey,
          deviceId: device.garminProductId,
          outputPath,
          timeoutMs: config.execution.timeoutMs
        });
      } catch (error) {
        return {
          deviceId: device.garminProductId,
          status: "failed",
          outputPath,
          durationMs: 0,
          exitCode: null,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error)
        } satisfies CompileResult;
      }
    });
    await mkdir(config.execution.output, { recursive: true });
    await writeFile(
      path.join(config.execution.output, "build-results.json"),
      JSON.stringify(results, null, 2),
      "utf8"
    );
    json(results);
    if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
  });

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`CIQ Forge: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
