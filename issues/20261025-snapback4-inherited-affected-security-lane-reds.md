# Snapback 4: inherited affected-check failures observed in SEC10

Status: Open
Date: 2026-10-25
Scope: affected verification of origin/main 4c6b386072
Related: LLP 0232; LLP 3000.036.004.000 §10

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
