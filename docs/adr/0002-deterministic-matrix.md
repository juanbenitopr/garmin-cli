# ADR 0002: Stable matrices and bounded compiler concurrency

Status: accepted

## Context

CI output must be reproducible even when input files are discovered in different filesystem orders. Garmin compiler processes may also contend for SDK resources.

## Decision

Devices, scenarios, and result collections are sorted deterministically. Matrix identifiers use `device__scenario`. Work is scheduled through a bounded concurrency helper, while official builds use the stricter `compiler.maxConcurrency` setting and distinct output directories.

## Consequences

Reports remain ordered regardless of completion order. A slow job does not reorder results, and compilation concurrency can default to one until SDK behavior is proven safe.

