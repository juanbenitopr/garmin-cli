# 4. Parallel Store Packaging and Multi-Simulator Transport

Date: 2026-08-27

## Status

Accepted

## Context

1. **Connect IQ Store Packaging Bottleneck**: Garmin's `monkeyc -e` command compiles all target devices sequentially in a single thread. For applications supporting 40+ devices, sequential packaging takes multiple minutes.
2. **Matrix Execution Throughput**: Driving visual scenario matrix executions (`ciq-forge run`) through a single simulator instance on default port `1234` is strictly serial.
3. **Connect IQ Packaging Internals**: Analysis of the Garmin SDK reveals:
   - `bin/monkeybrains.jar` provides the official Java packaging entry point `com.garmin.monkeybrains.compiler2.packager.IqPackager`.
   - Release `.iq` files are 7z (LZMA) archives structured by hardware part number (`006-BXXXX-00/`), containing `.prg`, `debug.xml`, settings JSON, and signed by `manifest.sig2` (RSA-SHA256).
4. **Simulator Internals**:
   - `simulator.exe` and `shell.exe` support port configuration via the `SHELL_SERVER_PORT` environment variable and `--transport_args=127.0.0.1:<PORT>`.
   - `simulator.exe` enforces a single instance via wxWidgets mutex `\Sessions\<Id>\BaseNamedObjects\Sim-<Username>`, which can be safely unhooked to run concurrent simulator processes on isolated ports.

## Decision

1. **Implement Parallel Packaging (`ciq-forge package`)**:
   - Compiles `.prg` binaries in parallel across a bounded worker pool:
     `concurrency = Math.max(1, os.cpus().length - 4)` (leaving 4 cores for OS and IDE headroom).
   - Annotates target devices with Garmin part numbers and invokes `IqPackager.packageApp` from `monkeybrains.jar`.
   - Supports dynamic manifest version injection (`--app-version <semver>`).
2. **Implement Concurrent Multi-Simulator Matrix Testing (`ciq-forge run --parallel`)**:
   - Assigns dynamic TCP ports (e.g. `12340..12399`) per test worker.
   - Spawns isolated `simulator.exe` instances with `SHELL_SERVER_PORT` and clears `Sim-<Username>` mutex via `SimUnlocker.cs`.
   - Executes off-screen (`-32000, -32000`) for headless CI/CD execution while preserving DWM GDI surface for `PrintWindow` window captures.
   - Drives parallel scenario testing, screenshot captures, and profiling without interference.
3. **Anti-Hang Lifecycle & Fast Execution Standard**:
   - `PortMonkeyDo.java` receives explicit `durationSec` and bounds execution time, shutting down `shell.exe` via JVM shutdown hooks to prevent TCP socket / thread leaks.
   - Early Exit pattern halts scenarios immediately upon screenshot capture or `render.complete` event stream reception.
   - Child processes are unreferenced (`child.unref()`) to prevent Node.js event-loop deadlocks.

## Consequences

- **10x-20x Speedup**: Packaging 40+ device projects drops from ~120 seconds to ~15 seconds.
- **Fast Deterministic Matrix Execution**: 4-device regression run (build + 4 headless simulators + 4 screenshots + profiling) executes in ~43 seconds (~10.9s per device).
- **Full Compatibility**: By delegating final assembly and signing to Garmin's `IqPackager`, 100% store compatibility and signature validation are preserved.
- **Zero Orphaned Processes**: Strict process tree and port slot lifecycle management prevents simulator hangs and zombie socket connections.