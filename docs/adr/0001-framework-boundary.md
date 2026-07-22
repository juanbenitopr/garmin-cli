# ADR 0001: External CLI with a small Monkey Barrel

Status: accepted

## Context

Executing arbitrary Monkey C outside Garmin would require a parser, interpreter, Toybox implementation, resource pipeline, and renderer before CIQ Forge could deliver reliable value.

## Decision

The first CIQ Forge architecture uses:

- a Node.js and TypeScript CLI for orchestration;
- the official Garmin compiler for real PRGs;
- declarative YAML for devices and scenarios;
- a small Monkey Barrel for injectable services and diagnostics.

The barrel wraps selected Toybox calls. It does not replace Toybox modules or attempt to emulate the Garmin VM.

## Consequences

The framework can validate and automate real projects early. Deterministic scenario execution requires watchfaces to consume the injected service boundary. Simulator control, screenshot capture, and fixture transport remain separate future capabilities.

