# CIQ Forge

> Deterministic scaffolding, builds, simulator runs, profiling, and visual regression testing for Garmin Connect IQ projects.

[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-5FA04E?style=flat-square)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square)](https://www.typescriptlang.org/)
[![Garmin Connect IQ](https://img.shields.io/badge/Garmin-Connect%20IQ-00A3E0?style=flat-square)](https://developer.garmin.com/connect-iq/)

CIQ Forge turns the fragmented Connect IQ development loop into one explicit CLI workflow. It creates self-contained watch face and device app projects, validates their inputs, compiles isolated device targets with Garmin's official SDK, injects deterministic scenarios, drives simulator runs, and produces machine-readable evidence for CI.

It does **not** emulate Monkey C or replace Garmin's simulator. CIQ Forge orchestrates the official tools and makes their results repeatable.

[Project website](./docs/index.html) · [Commands](#commands) · [Configuration](#configuration) · [Contributing](#development)

## Highlights

- Interactive and non-interactive project scaffolding.
- Watch face and device app templates with a generated manifest UUID.
- Self-contained projects with a vendored CIQ Forge Monkey Barrel.
- Strict validation for Forge, device, and scenario YAML.
- Stable `device × scenario` execution matrices.
- Garmin SDK discovery and official `monkeyc` compilation.
- **Parallel Store Packaging (`ciq-forge package`)**: Compiles target devices concurrently across CPU workers and binds them into signed `.iq` store archives via Java bridge (`IqPackagerBridge`).
- **Concurrent Headless Multi-Simulator Matrix (`ciq-forge run --parallel --headless`)**: Runs multiple simulator instances simultaneously on dedicated TCP ports (`12340..12399`) with mutex unlocking.
- **Event-Driven Screenshot Capture**: Triggers visual capture automatically on the first `render.complete` event from the watch face lifecycle, guaranteeing rendered dials without timing heuristics.
- Fixture-backed time, system, activity, weather, settings, and low-power state.
- Simulator lifecycle assertions and structured diagnostics.
- Screenshot normalization, approved baselines, and pixel diffs.
- Binary size, memory, render-time, and relative energy budgets.
- JSON, JUnit, HTML, log, metric, and image artifacts.

## Requirements

- Node.js 20 or newer.
- Garmin Connect IQ SDK for real builds and simulator runs.
- A Garmin developer key for signed PRGs.

The SDK and developer key remain local. They are not included in the npm package and key material is never printed by the CLI.

## Install

After the first npm release, run CIQ Forge without a permanent installation:

```powershell
npx ciq-forge --help
```

Or install it globally:

```powershell
npm install --global ciq-forge
ciq-forge --help
```

For repository development, see [Development](#development).

## Quick start

Launch the mini assistant:

```powershell
ciq-forge new
```

Or create a watch face non-interactively:

```powershell
ciq-forge new solar-face `
  --type watchface `
  --name "Solar Face" `
  --devices fenix7,forerunner965,venu3 `
  --min-api 3.2.0 `
  --yes
```

Create a device app:

```powershell
ciq-forge new trail-notes --type app --name "Trail Notes" --devices venu3 --yes
```

The generated project is ready for inspection:

```powershell
cd solar-face
ciq-forge inspect
ciq-forge doctor
```

### Generated project

```text
solar-face/
├── source/
│   ├── SolarFaceApp.mc
│   ├── SolarFaceView.mc
│   └── ForgeBootstrap.mc
├── resources/
│   ├── drawables/
│   └── strings/
├── devices/
├── scenarios/
├── vendor/ciq-forge/
├── manifest.xml
├── monkey.jungle
├── forge.yml
└── README.md
```

The generator refuses to overwrite a non-empty destination.

## Commands

| Command | Purpose |
| --- | --- |
| `ciq-forge new [directory]` | Create a watch face or device app project. |
| `ciq-forge inspect` | Validate the project, manifest, devices, scenarios, and matrix. |
| `ciq-forge matrix` | Print the stable device/scenario job matrix. |
| `ciq-forge doctor` | Check the Garmin SDK, simulator tools, and developer key. |
| `ciq-forge build` | Compile one isolated PRG per selected device. |
| `ciq-forge package` | Compile and package signed release `.iq` archives in parallel across all CPU cores. |
| `ciq-forge run` | Build and execute instrumented simulator jobs (supports `--parallel`, `--headless`, `--screenshot`). |
| `ciq-forge profile` | Collect memory, render-time, binary, and energy metrics. |
| `ciq-forge screenshot` | Capture the visible Garmin Simulator window. |
| `ciq-forge baseline approve` | Explicitly approve a captured visual baseline. |

Every command supports `--help` for its complete options.

### Validate the local toolchain

```powershell
ciq-forge doctor --developer-key C:\path\to\developer_key
```

The key can be supplied without storing its path in the project:

```powershell
$env:CIQ_DEVELOPER_KEY = "C:\path\to\developer_key"
ciq-forge doctor --compile-probe
```

SDK discovery order:

1. `compiler.path` in `forge.yml`.
2. `CIQ_MONKEYC`.
3. Garmin SDK Manager's `current-sdk.cfg`.
4. The newest SDK in the standard Windows SDK directory.

### Build and run

```powershell
ciq-forge run
ciq-forge run --parallel -j 2 --headless --screenshot
ciq-forge run -d venu3 -s normal,night --parallel --headless --screenshot
ciq-forge package --parallel --developer-key "$env:CIQ_DEVELOPER_KEY"
```

Build outputs and reports are written below `.ciq-forge/results/` by default.

### Parallel Headless Execution and Event-Driven Screenshots

CIQ Forge orchestrates multiple headless simulator instances concurrently:
- **Event-Driven Capture**: The runner automatically listens to the Connect IQ stdout stream for the `render.complete` event from `ForgeBootstrap` and triggers screenshot capture only once the watchface has finished drawing its first frame.
- **Headless Win32 Capture**: Simulator windows are positioned off-screen (`-32000, -32000`) preserving the DWM GDI surface, captured via `PrintWindow`, and cleanly normalized.
- **Anti-Hang Lifecycle**: Dedicated Java bridge sockets auto-terminate upon completion, preventing lingering TCP handles or simulator process deadlocks.
- **Parallel IQ Packaging**: `ciq-forge package --parallel` compiles all target device binaries concurrently and packs them into official signed `.iq` archives.

### Lifecycle and fixture injection

Generated projects extend the CIQ Forge lifecycle classes instead of adding diagnostics inside Garmin callbacks:

```monkeyc
class SolarFaceApp extends CiqForge.AppBase {
    function createForgeContext() {
        return ForgeBootstrap.context();
    }

    function createInitialView(forgeContext) {
        return [new SolarFaceView(forgeContext)];
    }
}

class SolarFaceView extends CiqForge.WatchFace {
    function onForgeUpdate(dc) {
        var battery = forge().systemService.getBattery();
        // Render the view using real services or scenario fixtures.
    }
}
```

`CiqForge.AppBase`, `CiqForge.View`, and `CiqForge.WatchFace` own the real lifecycle methods. Their `onForge...` hooks keep application code free of profiling calls. `ForgeBootstrap.context()` is cached once per run: production builds inject real services, while scenario builds replace the production bootstrap with deterministic fixtures.

### Profile budgets

Scenarios can turn performance regressions into CI failures:

```yaml
budgets:
  compileWarnings: 0
  binaryBytes: 100000
  memoryPeakBytes: 90000
  memoryPeakPercent: 80
  renderAverageMs: 10
  energyScore: 15
```

The reported `energy.relativeScore` is a regression proxy based on active render time. It is not a physical battery-life estimate.

### Visual baselines

```powershell
ciq-forge run -d venu3 -s normal --parallel --headless --screenshot
ciq-forge baseline approve --run venu3__normal
```

`run` never overwrites an approved baseline. Changed pixels are highlighted and the job fails when the configured difference threshold is exceeded.

## Configuration

`forge.yml` is the entrypoint for a project:

```yaml
project:
  root: .
  jungle: monkey.jungle
  manifest: manifest.xml

inputs:
  devicesDir: devices
  scenariosDir: scenarios

execution:
  workers: 4
  timeoutMs: 30000
  output: .ciq-forge/results

compiler:
  maxConcurrency: 1

visual:
  baselinesDir: baselines
  differenceThreshold: 0.001
  pixelThreshold: 16
```

Unknown properties are rejected so misspelled configuration cannot silently alter a run.

## How instrumentation works

Instrumented builds generate an isolated `ForgeBootstrap.mc` for each matrix job and add it through a temporary Jungle overlay. The production bootstrap is excluded by annotation, while the generated bootstrap provides fixture-backed services to the same app code.

Runtime diagnostics use versioned lines such as:

```text
CIQ_FORGE_EVENT|1|venu3__normal|view.update|09:42
```

This keeps application behavior on Garmin's runtime while making external state deterministic and assertions parseable.

## Development

This repository uses pnpm 11 workspaces.

```powershell
pnpm.cmd install
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
```

Run the TypeScript entrypoint during development:

```powershell
pnpm.cmd ciq-forge inspect
```

Repository layout:

```text
packages/
  cli/               command surface and project scaffolding
  core/              schemas, loaders, matrix, reporting, and instrumentation
  garmin-compiler/   SDK discovery and monkeyc adapter
  garmin-simulator/  simulator launch and screenshot capture
barrels/ciq-forge/   Monkey C integration barrel
examples/            example watch face
devices/             device definitions
scenarios/           deterministic fixture definitions
docs/                GitHub Pages website
tests/               Vitest suite
```

## npm release

Inspect and test the exact package before publishing:

```powershell
npm pack --dry-run
npm pack
npm install --global .\ciq-forge-0.1.0.tgz
ciq-forge --version
```

`prepack` rebuilds `dist`; `prepublishOnly` runs the test suite and typecheck.

```powershell
npm login
npm publish
```

## GitHub Pages

The static website lives in `docs/`. The workflow at `.github/workflows/pages.yml` deploys it after pushes to `main` or `master`.

After pushing the repository for the first time:

1. Open **Settings → Pages** in GitHub.
2. Set **Source** to **GitHub Actions**.
3. Run **Deploy GitHub Pages** from the Actions tab, or push a change under `docs/`.

## Current limitations

- Real compilation and simulator runs require Garmin's local Connect IQ tools.
- Screenshot automation currently requires an interactive Windows desktop.
- Device-specific capture coordinates are recommended for stable visual baselines.
- Energy profiling is relative; calibrated battery estimates require physical-device measurements.
- The Jungle loader handles direct `sourcePath` and `resourcePath` values, not complete Jungle evaluation.

## Project status

CIQ Forge is an early-stage project. The command surface and configuration may evolve before `1.0.0`. See [ROADMAP.md](./ROADMAP.md) for planned work.
