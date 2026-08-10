# Add check-module-ownership to the always-run pre-push tier

**Opened:** 2026-08-09
**Resolved:** 2026-08-10 — landed as proposed. `module-ownership` is now a
registered drift-prone gate (records: ownership.manifest.json +
ownership.baseline.json; triggers: the ownership authorities +
`src/` prefixes) and the first member of a new validated
`driftAlwaysRunGates` policy tier that `selectDriftProneGates` unions into
every pre-push selection, so every push with commits runs it regardless of
path selection. It is also listed in `driftFailClosedCoreGates`. The landing
had to fix forward a fourth occurrence of the failure shape this ticket
predicted: the LLP 0204 S5 wave left five modules unmanifested
(`server/effects`, `storage/capability_links`, `storage/pending_effects`,
`storage/watches`, `watches`) and four unbaselined edges; assignments +
re-baseline landed with the gate, growth recorded in
`issues/20260809-0199-ownership-ratchet-worklist.md`.

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

## Author ruling — 2026-08-10

Approved. Add `scripts/check-module-ownership.mjs` to the pre-push hook's
fast fail-closed core tier unconditionally, landing via the normal review
path as a deliberate frozen-record-policy change. This gate is also the
enforcement arm of the commissioned core-modularization Decision
(`issues/20260808-core-modularization-decision.md`).
