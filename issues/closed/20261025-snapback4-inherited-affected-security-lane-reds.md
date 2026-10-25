# Snapback 4: inherited affected-check failures observed in SEC10

Status: Closed (tracking consolidated)
Date: 2026-10-25
Scope: historical baseline 4c6b386072; refreshed baseline origin/main b2959e2455
Related: LLP 0232; LLP 3000.036.004.000 §10

## Resolution: tracking consolidated, not a product fix

The final conflict-free SEC10 integration includes main b2959e2455. Its canonical
open ticket is [G7.2 adapter classifications](../20261025-snapback4-g72-store-port-ratchet-adapter-types.md).
All seven other historical failures were fixed upstream; the remaining lexical
ratchet failure is tracked there instead of in two open tickets. The ratchet
still fails with five sites on an independently compiled, unmodified b2959e2455
archive. Both reported files exactly match the integrated SEC10 files; no
allowance or enforcement was weakened. Current proof:
`~/sb4-loop/sec10-w27-mainb295-ratchet-proof.json` and `.log`.

## Current baseline refresh

The integrated 20a45b73cb baseline has a different remaining lexical ratchet
failure: `program_batch.rs` has one production-pattern match and
`program_pipeline.rs` has four. An unmodified main source archive, its original
ratchet and token lexer, compiled independently with Rust 1.97, reproduces the
same five matches and exit 101. Both reported files are byte-identical in SEC10.
This is a lexical boundary failure; the scan alone does not establish that each
match is a database connection. G7.2 owns these imported implementation files.
Preserve the zero-production-access rule and inspect the typed calls before any
repair. No allowance is raised by SEC10.

Evidence: `~/sb4-loop/sec10-w27-main20a-ratchet-proof.json` and its `.log`.
The earlier seven other failures below no longer reproduce in the integrated
affected run. The old six-site ratchet signature has also changed; it must not
be reported as the current result. Final qualification/counts remain in
WORKSTREAM-REPORT.md.

## Historical baseline

SEC10's independent baseline controls reproduce eight existing failures. The
files and emitting implementation sites are byte-identical to that main commit.
Do not weaken security checks or increase a ratchet allowance to clear them.

- Four maintained_columns activation fixtures install foreign SQLite tripwire
  triggers. Managed-relation interception now rejects those triggers before the
  fixtures can exercise their intended behavior.
- expiry_writes::stores::refused_legacy_counter_upgrade_preserves_bytes_and_accepted_upgrade_runs_once
  likewise installs no_counter_rebuild and is rejected by
  SNAPBACK_MANAGED_RELATION_INTERCEPTION. Update the test instrumentation without
  admitting hostile store interception.
- store_port_ratchet reports six production access sites: command.rs (1),
  revision_cache.rs (4), serve_start.rs (1). Route them through the sanctioned
  store abstraction; preserve the zero-production-access requirement.
- guide::deploy's compact-card test and surf4_guide's release-json discoverability
  test share the same size assertions. The unchanged deploy card has 181
  operational lines against 150 and 312 total against 280. Coordinate the guide
  repair with DX9, which owns navigation/output in this wave.

Baseline source hashes and canonical Rust 1.97 control results are retained in
`~/sb4-loop/sec10-inherited-baseline-proof.json` and its named logs. Final SEC10
qualification and exact counts belong to WORKSTREAM-REPORT.md. These are
fix-forward follow-ups, not claimed green checks or newly introduced failures.
