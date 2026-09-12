# snapback2 low-severity execution/misc batch (rehearsal copy, effects runner, cert hash)

**Status:** Resolved
**Priority:** P3 (batch of lows; split out if any grows)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/.../rehearsal.rs:94`; effects `runner.rs`; `packages/evaluator/src/test.ts:426`, `:443`

## What was reported

- `rehearsal.rs:94` — `Snapshot::capture` copies the whole store file per
  `--dry-run`/`--plan`: O(DB) I/O per dry run. Fix: copy-on-write snapshot
  or delta capture.
- Effects `runner.rs` — clock error after a host failure settles terminal
  `Failed`, losing the retryable error; `merge_drained` drops
  `Drained.claimed` (harmless today, always 0); a panic in `host.run`
  skips the Ibex discard (possibly-corrupt runtime reused); host-channel
  `Message` failure retains the runtime (`retry, contaminated=false,
  quiescent=true`) vs. discard elsewhere — a stuck running runtime
  poisons until the 50-job rotation; `initialize` ignores `stop` and
  replays `thens`. Fixes: preserve the original error, propagate
  `claimed`, discard on panic/unwind, uniform discard policy, honor `stop`.
- `evaluator test.ts:426/443` — `certificate.schema_hash =
  sha256(JSON.stringify(schema))` uses non-canonical JSON; works only via
  the `BTreeMap`-order round-trip. Fix: canonical JSON helper shared with
  production code.

Each item needs independent reproduction before fixing; split into its own
ticket if the fix turns out non-trivial.

## Acceptance

- Dry runs avoid full-store copies (or document why not); runner error
  paths preserve retryability and discard policy is uniform and tested;
  schema-hash helper is canonical and shared.

## Resolution (2026-09-12)

Runner fixes preserve retryability if the post-failure clock read fails, propagate drained claim counts, clear cached runtimes after host panics, discard on host-channel failure, and honor stop before startup pending-then replay. Focused regressions for each behavior pass in the full Hermes effects suite: 81/81, 6.54s.

The evaluator's predecessor/successor schema-hash fixtures now use the production canonicalSchemaJson helper (implemented by the evaluator lane). Validation: evaluator suite passed 266 corpus cases, skipped 27 serverOnly cases, and passed the indexed/authority/canonical-schema regression groups and delivery 10/10 with the fresh owner.

Rehearsal retains a complete SQLite backup to provide an isolated, WAL-consistent writable database for real execution. Filesystem copy-on-write cannot portably capture that transaction boundary; delta execution would require replacing SQLite's read/write semantics. The guide now states the full-copy cost, satisfying the explicit documentation alternative in this ticket. `--plan` already uses counts and does not capture a snapshot. A 64MiB payload probe produced a 67,207,168-byte isolated backup in 368.69ms; deleting live rows left the backup intact. This is a documented limit, not a claim that dry-run copying was eliminated.
