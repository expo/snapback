# Add check-module-ownership to the always-run pre-push tier

**Opened:** 2026-08-09

Three times today, concurrent sessions landed changes that left the
module-ownership gate red on main without knowing it:

1. A bypassed push added unassigned->kernel and cross-owner edges absent from
   the baseline (absorbed at the slice-2 re-baseline).
2. af32e2c06 added `src/spike_trace.rs` with no manifest assignment (gate hard-
   red on main until 11271cc95 fixed forward).
3. The S1/S2 wave added five modules (`admin_agent_destroy`, `server/oauth`,
   `server/remote_mcp`, `storage/auth_integrations`, `storage/declared_clients`)
   with no manifest assignment (caught and fixed forward at the slice-8
   landing).

Root cause: `scripts/check-module-ownership.mjs` runs in the local-proof
selection (LLP 0175 D2.3) but is NOT in the pre-push drift-gate hook's
selected set, so sessions that never run the local proof push reds freely.

Proposal: add the ownership gate to the pre-push hook's fast fail-closed core
tier unconditionally. It is pure-textual, no dependencies beyond node, and
runs in ~30-50ms on the full tree — negligible against the multi-minute
carrier gates. It blocks exactly two failure shapes: a new Rust module with no
manifest assignment, and a new forbidden-direction edge (LLP 0199 OQ5's
"prevent collapse" criterion, which currently only binds sessions that
volunteer to run it).

Owner note: touches `.githooks/pre-push` and/or the gate-selection policy —
a deliberate frozen-record-policy change, so it lands via the normal review
path, not as a drive-by.
