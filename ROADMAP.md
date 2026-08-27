# CIQ Forge roadmap

## Completed foundation

- TypeScript workspace and compiled CLI.
- Strict Forge, device, and scenario schemas.
- Basic manifest and Jungle inspection.
- Deterministic device/scenario matrix.
- Bounded asynchronous scheduler.
- Garmin SDK discovery and official compiler adapter.
- Per-device build outputs, timeouts, and ordered JSON results.
- Initial Monkey Barrel and example watchface.
- Three devices, five scenarios, tests, and architecture decisions.
- Scenario-to-Monkey-C transport format.
- Fixture context construction in the example app.
- Structured diagnostic parser in the CLI.
- Simulator launch and `monkeydo` adapter.
- Lifecycle event assertions.
- Reliable simulator screenshot capture.
- PNG normalization and deterministic naming.
- Baseline update command and pixel diffs.
- JSON and JUnit reporting.
- HTML matrix report.
- Windows descendant-process termination on timeout.
- Deterministic simulator window restoration, placement, sizing and foreground activation before capture.
- Parallel Store Packaging (`ciq-forge package --parallel`) via multi-worker compilation and `IqPackagerBridge` (ADR 0004).
- Multi-simulator concurrent matrix transport (`ciq-forge run --parallel --headless`) with dynamic `SHELL_SERVER_PORT`, single-instance mutex clearing, and monotonic port assignment.
- Event-driven headless screenshot capture triggered on `render.complete` event stream with DWM GDI composition buffer.
- Auto-terminating Java socket bridge (`PortMonkeyDo.java`) and unreferenced child processes for zero-leak lifecycle management.

## Next: harden real-project execution

- Resolve the local SDK 9.1.0 generic Monkey C file-read failure detected by `doctor --compile-probe`.
- Calibrate simulator crop coordinates for the target device catalog.
- Add renderer element-bound events for overlap and edge assertions.
- Exercise instrumented runs against AtelierDigitalSport.
- Add simulator reuse/ownership detection when a user-started simulator already exists.

## Later

- Compile and runtime budgets.
- Calibrated physical-device battery benchmarks (relative memory and simulator energy metrics are available).
- Device capability catalog.
- Connect IQ Store release and metadata sync.

