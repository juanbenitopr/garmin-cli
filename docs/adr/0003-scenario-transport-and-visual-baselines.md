# ADR 0003: Compile-time scenarios and explicit visual baselines

Status: accepted

## Context

`monkeydo` executes a PRG for a device but does not provide an arbitrary scenario argument channel. Automating the simulator's persistent-storage editor would couple deterministic runs to GUI state.

## Decision

CIQ Forge generates a `ForgeBootstrap.mc` and overlay Jungle for every device/scenario job. The overlay excludes the production bootstrap through the `forgeProduction` annotation and supplies fixture-backed services. Simulator execution remains serial initially.

Screenshots are captured from the visible Windows simulator window, cropped and normalized before comparison. Baselines can only be changed through `ciq-forge baseline approve`; failed runs never update them.

## Consequences

The first implementation recompiles for each scenario, trading speed for deterministic and inspectable inputs. Visual capture requires an interactive desktop. Device-specific crop coordinates may be needed for pixel-stable results across simulator skins.
