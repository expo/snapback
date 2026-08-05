# Telemetry phase-1 evidence receipt needs a Linux re-mint

**Status:** Resolved 2026-08-05
**Found:** 2026-08-04, by the capability-publication landing's proof run

## Origin

`scripts/verify-telemetry-phase1-proof --check` failed on
`SNAPBACK_TELEMETRY_PHASE1_EVIDENCE_INVALID: source closure unchanged since
measured revision`. The retained receipt at source revision `2485729318e`
bound a 412-file source closure, while the P1, LLP 0167, and Move-4 landings
had changed 70 bound files without the required Linux re-mint.

Main run `30974150301` at `589bee2cc103c0330ebdfe89e87a63907cf8ef57`
confirmed this was one of exactly two KEEP-GOING failures; the other was the
independently attributed client-bundle provenance carrier.

## Resolution

The full Linux producer ran from exact source revision
`305dd0081f81fbc1a1fa82ebbc9112059949c5a3` on the `expo-build-1000`
fleet host. Work, caches, and temporary files stayed on its user-writable
secondary volume. The coded `scripts/bootstrap-ibex-runtime` path initialized
the vendored runtime, linked and launched the exact binary, and qualified the
restricted handler VM before the telemetry smoke, release benchmark, and idle
witness ran. No administrator-owned machine state, curl fallback, stale
binary, or reduced proof profile was used.

The first replay exposed one additional proof-machinery defect: the idle
sampler spawned an unpinned system `sqlite3` CLI for two read-only lifecycle
queries. The qualified Ubuntu host did not carry that executable, and adding
it required administrator access. The sampler now runs the unchanged queries
through the pinned Node 24 `node:sqlite` `DatabaseSync`, opened read-only. It
preserves the CLI's default/tab separators and bounded `database is locked`
retry without changing the witness.

The final full receipt records:

- source-closure digest
  `4bf171fab89c55e95c3e09cead373a5f7b54c9c2b70fb29234d0194707e8679a`;
- receipt SHA-256
  `2b33ac4b4677312e08fdc6ccfbe4ae8dd60d24c73b90d1c5acabbc11574e8f73`;
- producer transcript: 668 lines, SHA-256
  `5c493cd4c87c293f9a81d87e443e927c998f82298a0235b9d5f06a035102be9d`;
- every release benchmark below its frozen ceiling;
- a 120,000 ms idle window with zero storage mutations, zero read-byte and
  write-byte deltas, 8 CPU ticks against a ceiling of 10, and zero RSS-page
  growth against a ceiling of 8.

Main later advanced through `917b16e7c`; those landings did not intersect the
receipt's enumerated source closure. The receipt therefore remains the exact
measured artifact, rather than a re-labelled or locally synthesized carrier.

After this receipt was produced, an independent full run on the Minisforum
fleet lane measured 12 CPU ticks twice against the same 10-tick ceiling. That
cross-host correctness discrepancy is preserved in the still-open
`issues/20260804-idle-cpu-regression.md`; this ticket's resolution records only
that the stale evidence carrier was honestly re-minted by the required full
producer. It does not retract the Minisforum measurements, claim that every
Linux host meets the ceiling, or widen the ceiling.

## Verification

- `scripts/verify-telemetry-phase1-proof --full` — pass on Linux;
- `node --test scripts/telemetry-phase1-evidence.test.mjs` — pass;
- `./ref-check --verbose` — pass before the carrier commit.
