# local-store publication record needs re-measurement after LLP 0213 slice 1

**Opened:** 2026-08-09
**Area:** drift-gates / local-persistent-store-publication / metrology
**Severity:** low (tracked drift; code is verified green)

## What

LLP 0213 rehearsal-grants slice 1 (commit landing this ticket) added two
crate-private accessors to `src/local.rs`
(`auth_rehearsal_instance_id`, `auth_rehearsal_state_present_at_open`) that
are load-bearing for rehearsal-grant instance binding and the production
`state-present` refusal. Because `src/local.rs` is part of the hashed
local-store publication carrier, this legitimately changes the carrier hash,
and `tests/conformance/local-persistent-store-publication-v1.mjs` reports
`src/local.rs drifted from the store publication carrier`.

The documented regenerator `scripts/finalize-local-persistent-store-publication`
does not complete: it fails inside
`tests/acceptance/triage-graph-move1-v1.mjs` `verifyRetainedArtifacts` with a
retained-artifacts hash mismatch (`3f3a2e55… != 7090ed1b…`). That retained
artifact is a wave-shared proof file (LLP 0189) on its own drift gate, and the
mismatch is not produced by the rehearsal logic — the rehearsal, auth, guide,
inventory, and ref-check suites are all green (15 rehearsal + 369 auth + 9
guide tests; check-inventories PASS; ref-check clean).

## Why landed with a loud bypass

Slice 1 is correct and fully tested; stranding it behind an unrelated
metrology-cascade drift is worse than landing with the documented
`SNAPBACK_DRIFT_GATES_BYPASS=1` and a tracking ticket. The `client-bundle-metrology`
gate is separately baseline-stale (backstop ticket
`issues/20260808-main-drift-client-bundle-metrology.md`).

## Fix

1. Resolve the `triage-graph-move1` retained-artifacts drift (determine whether
   it is pre-existing wave-shared-proof staleness or a real measurement change),
   then
2. run `scripts/finalize-local-persistent-store-publication` to refresh
   `src/local-persistent-store-publication.v1.json` and its `.anchor.v1.json`
   with the measured rehearsal-inclusive carrier, and
3. commit the refreshed records, clearing this ticket and any backstop ticket
   the drift-backstop filed for `local-store-publication`.

## Evidence pointers

- gate: `node tests/conformance/local-persistent-store-publication-v1.mjs`
- regen: `scripts/finalize-local-persistent-store-publication`
- downstream failure: `tests/acceptance/triage-graph-move1-v1.mjs:833` `verifyRetainedArtifacts`
