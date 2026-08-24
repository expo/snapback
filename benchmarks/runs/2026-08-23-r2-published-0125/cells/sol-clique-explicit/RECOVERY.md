# Deterministic retained-attempt recovery

This directory is the independently valid evidence graph for the first and
only `sol-clique-explicit` attempt retained read-only at
`/Users/ccheever/bench-matrix-20260823-r2/cells/sol-clique-explicit`. No model
session or product command was rerun.

The native Codex rollout, controller observations, suite/choreography streams,
terminal-boundary artifact, original instrument snapshot, acceptance receipts,
and human reports remain byte-identical to that retained attempt. Derived
`metering-manifest.json`, `metering.json`, `record.json`, `validation.json`, and
the additive recovery evidence are versioned finalization outputs; they are not
presented as original driver bytes.

The recovery applies two narrow, replayable rules:

- `codex-rollout-jsonl.v2` retains and ignores the Codex CLI 0.149.0 malformed
  advisory total on unchanged cumulative native record index 711 (zero-based
  ordinal 710). It creates no turn and no charge and does not apply outside
  that native version and exact shape.
- `social-messenger-r2-native-cli-driver.v1-codex-signal-settlement.v2`
  replaces the rejected observation-terminal projection with native ordering.
  M1 uses successful signal ordinal 1229 and settled token-count ordinal 1231
  (`09:54:54.157Z`); M2 uses 1413/1415 (`10:02:30.911Z`); closing M3 uses its
  successful signal at 1557 and the final native token count at ordinal 1564
  (`10:10:21.856Z`) before `task_complete` ordinal 1565. Next-milestone
  controller setup overlaps are retained explicitly and do not move token
  turns. The controller's `10:10:23.123Z` final host-load sample remains in the
  immutable stream but is explicitly outside the native-settled authoring
  window.

Commandless native `FileChange` completions are recovered into the additive
`events/codex-file-change-observations.jsonl` stream as `edit` or `generate`
actions. The first product edit is native ordinal 222 at
`2026-08-24T09:12:14.377Z`, changing `package.json`; its item/session/stream
provenance is hash-bound in `first-product-edit.json`. Orientation bytes were
not measured, so the marker records `null` and LLP 0295 makes the efficiency
scorecard ineligible. No orientation counter was fabricated.

`record-base.json` differs from the private retained base only by remapping its
17 correction-loop evidence pointers from private raw harness stdout to the
copied, normalized, hash-bound controller observation stream. Raw harness
stdout, application/build output, dependencies, stores, credentials, caches,
and private runtime state are not copied.

`cell.json` now truthfully records one recovered/finalized attempt. The parent
`recovery-resume.v2.json` transition preserves the original instrument and
controller registrations, identifies `sol-clique-familiar` as the next exact
cell, and keeps all eleven later slots pristine. Historical BLOCKED reports
remain immutable historical artifacts.
