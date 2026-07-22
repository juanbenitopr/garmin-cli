import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertLifecycle,
  assertLayoutBounds,
  assertProfileBudgets,
  collectProfileMetrics,
  comparePngs,
  generateScenarioArtifacts,
  inspectPng,
  normalizeScreenshot,
  parseForgeEvents,
  writeRunReports,
  type ForgeConfig,
  type MatrixJob,
  type RunResult,
  type StageResult
} from "../../core/src/index.js";
import { GarminCompilerAdapter } from "../../garmin-compiler/src/index.js";
import {
  captureSimulatorWindow,
  discoverSimulatorTools,
  SimulatorController
} from "../../garmin-simulator/src/index.js";

const skipped = (message: string): StageResult => ({ status: "skipped", durationMs: 0, message });

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function warningsFrom(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => /\bWARNING\b/i.test(line));
}

export async function executeRunMatrix(input: {
  config: ForgeConfig;
  jobs: MatrixJob[];
  compilerPath: string;
  developerKey: string;
  screenshot: boolean;
}): Promise<RunResult[]> {
  const tools = await discoverSimulatorTools({
    monkeycPath: input.compilerPath,
    ...(input.config.simulator.connectiqPath ? { connectiqPath: input.config.simulator.connectiqPath } : {}),
    ...(input.config.simulator.monkeydoPath ? { monkeydoPath: input.config.simulator.monkeydoPath } : {})
  });
  if (!tools) throw new Error("connectiq and monkeydo could not be found next to the configured SDK.");
  const compiler = new GarminCompilerAdapter();
  const controller = new SimulatorController(tools);
  const results: RunResult[] = [];
  let simulatorStarted = false;

  try {
    for (const job of input.jobs) {
      const jobDirectory = path.join(input.config.execution.output, "runs", job.id);
      const prgPath = path.join(jobDirectory, "app.prg");
      const logsPath = path.join(jobDirectory, "run.log");
      const actualPath = path.join(jobDirectory, "current.png");
      const rawScreenshotPath = path.join(jobDirectory, "window.png");
      const diffPath = path.join(jobDirectory, "diff.png");
      const baselinePath = path.join(input.config.visual.baselinesDir, job.device.id, `${job.scenario.name}.png`);
      await mkdir(jobDirectory, { recursive: true });
      const generated = await generateScenarioArtifacts(job, jobDirectory, input.config.project.jungle);
      const compile = await compiler.compile({
        compilerPath: input.compilerPath,
        junglePath: generated.combinedJunglePath,
        developerKey: input.developerKey,
        deviceId: job.device.garminProductId,
        outputPath: prgPath,
        timeoutMs: input.config.execution.timeoutMs,
        buildStats: true
      });
      const buildStage: StageResult = {
        status: compile.status,
        durationMs: compile.durationMs,
        ...(compile.status === "passed" ? {} : { message: compile.stderr.trim() || "Compilation failed." })
      };
      const base: RunResult = {
        id: job.id,
        device: job.device.id,
        scenario: job.scenario.name,
        status: "failed",
        stages: {
          build: buildStage,
          launch: skipped("Build did not pass."),
          scenario: skipped("Application was not launched."),
          assertions: skipped("No runtime events."),
          profile: skipped("No runtime metrics."),
          screenshot: skipped(input.screenshot ? "Application was not launched." : "Screenshots disabled."),
          diff: skipped("No screenshot available.")
        },
        events: [],
        assertions: [],
        metrics: {},
        artifacts: {
          jobDirectory,
          prg: prgPath,
          logs: logsPath,
          ...(await exists(baselinePath) ? { baseline: baselinePath } : {})
        },
        warnings: warningsFrom(`${compile.stdout}\n${compile.stderr}`)
      };

      if (compile.status !== "passed") {
        await writeFile(logsPath, `${compile.stdout}${compile.stderr}`, "utf8");
        results.push(base);
        continue;
      }

      try {
        if (!simulatorStarted) {
          await controller.start(input.config.simulator.startupTimeoutMs, input.config.simulator.windowTitle);
          simulatorStarted = true;
        }
        const run = await controller.run({
          prgPath,
          deviceId: job.device.garminProductId,
          timeoutMs: input.config.execution.timeoutMs,
          captureDelayMs: input.config.simulator.captureDelayMs,
          ...(input.screenshot
            ? {
                capture: () => captureSimulatorWindow({
                  outputPath: rawScreenshotPath,
                  windowTitle: input.config.simulator.windowTitle,
                  windowBounds: input.config.simulator.window
                })
              }
            : {})
        });
        const combinedOutput = `${run.stdout}\n${run.stderr}`;
        await writeFile(logsPath, combinedOutput, "utf8");
        const events = parseForgeEvents(combinedOutput);
        const binaryBytes = (await stat(prgPath)).size;
        const metrics = collectProfileMetrics({
          events,
          binaryBytes,
          lowPower: job.scenario.settings.mode === "low-power" || job.scenario.settings.mode === true
        });
        const assertions = [
          ...assertLifecycle(events),
          ...assertLayoutBounds({
            events,
            width: job.device.display.width,
            height: job.device.display.height,
            shape: job.device.display.shape ?? "round"
          }),
          ...assertProfileBudgets(metrics, job.scenario.budgets)
        ];
        const hasEvents = events.some((event) => event.runId === job.id);
        const launchPassed = run.status === "passed" || (run.status === "timed-out" && hasEvents);
        base.stages.launch = {
          status: launchPassed ? "passed" : run.status,
          durationMs: run.durationMs,
          ...(run.status === "timed-out" && hasEvents ? { message: "Persistent watchface stopped after the configured capture timeout." } : {}),
          ...(!launchPassed ? { message: run.stderr.trim() || "monkeydo failed." } : {})
        };
        base.events = events;
        base.assertions = assertions;
        base.metrics = metrics;
        base.stages.scenario = {
          status: hasEvents ? "passed" : "failed",
          durationMs: 0,
          ...(!hasEvents ? { message: `No events received for ${job.id}.` } : {})
        };
        const failedAssertions = assertions.filter((assertion) => assertion.status === "failed");
        base.stages.assertions = {
          status: failedAssertions.length ? "failed" : "passed",
          durationMs: 0,
          ...(failedAssertions.length ? { message: failedAssertions.map((item) => item.name).join(", ") } : {})
        };
        base.stages.profile = metrics.memory
          ? { status: "passed", durationMs: 0, ...(!metrics.energy ? { message: "Memory collected; call diagnostics.beginRender()/endRender() to collect the energy proxy." } : {}) }
          : { status: "failed", durationMs: 0, message: "No runtime memory snapshots were collected." };

        if (input.screenshot) {
          if (run.screenshotError || !(await exists(rawScreenshotPath))) {
            base.stages.screenshot = { status: "failed", durationMs: 0, message: run.screenshotError ?? "Screenshot was not created." };
          } else {
            await normalizeScreenshot({
              sourcePath: rawScreenshotPath,
              outputPath: actualPath,
              width: job.device.display.width,
              height: job.device.display.height,
              shape: job.device.display.shape ?? "round",
              ...(job.device.capture ? { crop: job.device.capture } : {})
            });
            const inspected = await inspectPng(actualPath);
            base.artifacts.current = actualPath;
            base.stages.screenshot = {
              status: inspected.empty ? "failed" : "passed",
              durationMs: 0,
              ...(inspected.empty ? { message: "Screenshot appears empty." } : {})
            };
            if (await exists(baselinePath)) {
              const visual = await comparePngs({
                actualPath,
                baselinePath,
                diffPath,
                pixelThreshold: input.config.visual.pixelThreshold,
                differenceThreshold: input.config.visual.differenceThreshold
              });
              base.artifacts.baseline = baselinePath;
              if (visual.diffPath) base.artifacts.diff = visual.diffPath;
              base.stages.diff = {
                status: visual.status,
                durationMs: 0,
                message: visual.message ?? `${(visual.differencePercent * 100).toFixed(3)}% pixels differ.`
              };
            } else {
              base.stages.diff = skipped("No approved baseline exists.");
            }
          }
        }
      } catch (error) {
        base.stages.launch = {
          status: "failed",
          durationMs: 0,
          message: error instanceof Error ? error.message : String(error)
        };
        await writeFile(logsPath, base.stages.launch.message ?? "Simulator failed.", "utf8");
      }

      const requiredStages = [base.stages.build, base.stages.launch, base.stages.scenario, base.stages.assertions, base.stages.profile, base.stages.screenshot];
      base.status = requiredStages.some((stage) => stage.status === "failed" || stage.status === "timed-out") || base.stages.diff.status === "failed"
        ? "failed"
        : "passed";
      results.push(base);
    }
  } finally {
    await controller.stop();
  }

  await writeRunReports(results, input.config.execution.output);
  return results;
}
