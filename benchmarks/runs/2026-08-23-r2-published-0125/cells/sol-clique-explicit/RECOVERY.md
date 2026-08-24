# Deterministic retained-attempt recovery

This directory is the independently valid evidence graph for the first and
only `sol-clique-explicit` attempt retained read-only at
`/Users/ccheever/bench-matrix-20260823-r2/cells/sol-clique-explicit`. No model
session or product command was rerun.

The copied `metering-manifest.json`, `terminal-boundaries.json`, native Codex
rollout, controller observations, suite status, receipts, acceptance receipts,
and human reports are byte-identical to that retained attempt. Metering uses
the versioned rules documented in the repository metering README:

- `codex-rollout-jsonl.v2` records and ignores the Codex CLI 0.149.0 malformed
  advisory total on unchanged cumulative native ordinal 710; it creates no turn
  and no charge.
- `social-messenger-r2-native-cli-driver.v1-observation-terminal.v1` preserves
  the original boundary artifact while advancing the effective terminals to
  each milestone's latest hash-bound controller observation. The record carries
  all original/effective timestamps and clock evidence under
  `meteringProvenance.driver.compatibilityEvents`.

`record-base.json` differs from the private retained base only by remapping its
17 correction-loop evidence pointers from the private raw harness stdout to
the copied, normalized, hash-bound controller observation stream. The summaries,
attributions, counts, orientation, caps, and all other base fields are
unchanged. Raw harness stdout, application/build output, dependencies, stores,
credentials, caches, and private runtime state are not copied.

`cell.json` remains the preregistered immutable slot identity. The historical
BLOCKED report in the parent run directory remains unchanged; this recovery
adds the record that the original driver could not finalize and does not imply
that any campaign cell 2–8 ran.
