# Snapback 4: Device meter is missing heap/output/index ceilings

Status: Open
Severity: major
Priority: P1
Area: correctness
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)
Related: `20260912-snapback4-query-output-budget` (server-side output enforcement — this is the device-side gap)

## Problem and reproduction

The server meter enforces six ceilings including `heap_bytes` (16 MiB),
`output_bytes` (1 MiB) and `index_entries`
([meter.rs](../snapback4/crates/snapback4-core/src/meter.rs):16-23,42-46,
plus `charge_output` in runner.rs and `IndexEntries` charges in write.rs).
The device `Ceilings` has only four fields —
[interpreter.ts](../snapback4/packages/snapback4/src/replica/interpreter.ts):44-45
`{ examined, ruleProbes, steps, rowsWritten }` — and `charge()` (:172)
tracks only `examined`/`probes` (plus `rowsWritten` at :831-840). A read
that materializes more than 1 MiB of output reports `complete: true`
locally while the server cuts the same read: offline results lie about
their own completeness, and the online path masks the difference via the
local fallback. Reasoning from the code: nothing on the device measures
heap growth, serialized output size, or index entries touched.

## Implementation locations

- [packages/snapback4/src/replica/interpreter.ts](../snapback4/packages/snapback4/src/replica/interpreter.ts) (`Ceilings`, `charge`, merge/scan materialization)
- [crates/snapback4-core/src/meter.rs](../snapback4/crates/snapback4-core/src/meter.rs) (reference ceilings)

## Suggestion

Mirror the server ceilings on the device (at least output bytes and heap),
charge result serialization, and add a parity test: a >1 MiB read must
report the same `complete: false` cut locally and on the server.
