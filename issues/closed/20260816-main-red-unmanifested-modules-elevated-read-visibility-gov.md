# main red: two Rust modules exist but are missing from the ownership manifest

**Status:** Resolved 2026-08-19
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Ownership gate, Tests
**Date:** 2026-08-16
**Found while:** landing LLP 0189 piece 3; the drift_prone_gates_v0 suite's
ownership-gate fixtures fail on the ambient strays.

## Problem

`crates/snapback/src/elevated_read_trace.rs` and `crates/snapback/src/visibility_governance.rs` exist as
tracked files on `origin/main` but are absent from `ownership.manifest.json`,
so `node scripts/check-module-ownership.mjs` refuses with
`SNAPBACK_MODULE_OWNERSHIP_VIOLATION: manifest is missing Rust modules:
crates/snapback/src/elevated_read_trace.rs, crates/snapback/src/visibility_governance.rs`. This turns five
`tests/drift_prone_gates_v0.mjs` cases red (they invoke the real ownership
gate as a fixture precondition): missing-declared-deps, agent-safe checker,
diary-identity backstop, boolean-inherited-red attribution, and the
optimistic/strict/backstop push test. Verified pre-existing on origin/main;
not introduced by the LLP 0189 landing (which touches only proof/ci scripts).
`elevated_read_trace.rs` was already noted as an out-of-scope stray by the
ownership-gate minors landing.

## Why not fixed here

Assigning the correct owner module for each requires the landing author's
knowledge of the coupling (a guessed owner freezes a wrong edge). This is
fix-forward for whoever owns those modules: add both to
`ownership.manifest.json` with the correct owner, then re-run
`node scripts/check-module-ownership.mjs --update-baseline --predecessor HEAD`
and confirm the drift suite returns to green.

## Acceptance

- Both modules assigned in `ownership.manifest.json`.
- `node scripts/check-module-ownership.mjs` PASSES.
- `tests/drift_prone_gates_v0.mjs` returns to 47/47.

## Machine records — god-file drainage waivers (visibility_governance)

crates/snapback/src/visibility_governance.rs landed unmanifested (LLP 0234) and is imported by the
crates/snapback/src/local.rs god-file cluster. Assigned to shared-contract-types-leaf (its type is a
contract embedded as a field in the leaf crates/snapback/src/manifest.rs, so leaf keeps that edge
intra-owner). The two god-file import edges are frozen as bounded drainage waivers,
the same pattern as the standing local.rs → leaf drainage set (worklist item 11).

<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/visibility_governance.rs (shared-contract-types-leaf)","disposition":"time-bounded-waiver","observationRevision":"a509921612e3d86a1d445f7c64d80bc7ec148c67","provenance":"visibility_governance landed unmanifested (LLP 0234); assigning it to shared-contract-types-leaf freezes this pre-existing god-file import as a bounded LLP 0225 §2 drainage waiver, inverted when crates/snapback/src/local.rs drains its activation-validation call to the generation-activation-coordinator.","inversionOwner":"generation-activation-coordinator","deadline":"2026-09-15"} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/visibility_governance.rs (shared-contract-types-leaf)","disposition":"time-bounded-waiver","observationRevision":"a509921612e3d86a1d445f7c64d80bc7ec148c67","provenance":"visibility_governance landed unmanifested (LLP 0234); assigning it to shared-contract-types-leaf freezes this pre-existing god-file import as a bounded LLP 0225 §2 drainage waiver, inverted when crates/snapback/src/local.rs drains its activation-validation call to the generation-activation-coordinator.","inversionOwner":"generation-activation-coordinator","deadline":"2026-09-15"} -->

## Inherited forbidden ownership edges — standing tracker

Observed at `a509921612e3d86a1d445f7c64d80bc7ec148c67`. These forbidden module edges are inherited from prior
landings (MediaProjection*V1 type imports from crates/snapback/src/runtime.rs by storage, plus
the standing god-file couplings). They were masked on `main` by the missing-module
error above and surfaced once the three strays were manifested. They are inherited
reds (LLP 0232 fix-forward), tracked here jointly with
issues/20260810-main-module-ownership-red-jobs-edges.md; the MediaProjection edges
invert by shaping those proof types down to crates/snapback/src/contract_types.rs (leaf), owned by
the assets/media lane (LLP 0239).

- `crates/snapback/src/local.rs (unassigned) → crates/snapback/src/auth/identity_core.rs (shared-contract-types-leaf)`
- `crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/conformance.rs (storage-migration-kernel)`
- `crates/snapback/src/storage.rs (storage-migration-kernel) → crates/snapback/src/runtime.rs (transport-adapters)`
- `crates/snapback/src/storage/membership_reads.rs (storage-migration-kernel) → crates/snapback/src/membership_rules.rs (sync-realtime-engine)`
- `crates/snapback/src/storage/mutation_writes.rs (storage-migration-kernel) → crates/snapback/src/runtime.rs (transport-adapters)`
- `crates/snapback/src/storage/tests.rs (storage-migration-kernel) → crates/snapback/src/assets_cut.rs (background-services)`
- `crates/snapback/src/storage/tests.rs (storage-migration-kernel) → crates/snapback/src/runtime.rs (transport-adapters)`

## Resolution (2026-08-16)

Assigned the three strays (`dev_identity.rs` appeared after this ticket was
filed): `crates/snapback/src/dev_identity.rs` + `crates/snapback/src/elevated_read_trace.rs` →
`transport-adapters` (co-located with their `server.rs`/`runtime.rs` callers;
deps are leaf/downward), `crates/snapback/src/visibility_governance.rs` →
`shared-contract-types-leaf` (its type is embedded as a field in the leaf
`crates/snapback/src/manifest.rs`; leaf keeps that edge intra-owner). The two `local.rs`
god-file imports of `visibility_governance` are frozen as bounded drainage
waivers (LLP 0225 §2), and the 7 standing inherited MediaProjection/god-file
edges are jointly tracked here + in the jobs-edges ticket with an observed-at
revision. `--update-baseline` succeeded; `check-module-ownership.mjs` PASSES.

Drift suite recovered from all-blocked to **46/47**. The remaining failure
(`optimistic hook, strict mode, and main backstop operate on committed
pushes`) is NOT the missing-modules problem — it fails on
`SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_PUSH_VIOLATION: SNAPBACK_DRIFT_GATES_BYPASS
is not accepted by the synchronous visibility-governance class`, i.e. the LLP
0234 visibility-governance PUSH gate refusing a bypass inside the
drift-integration harness. That is a distinct LLP 0234 concern for the
visibility-governance owner (see the residual note below), unrelated to module
ownership.

## Residual — separate ticket for the visibility-governance owner

`tests/drift_prone_gates_v0.mjs` "optimistic hook…" pushes with
`SNAPBACK_DRIFT_GATES_BYPASS`, which the synchronous visibility-governance push
class (LLP 0234) rejects, failing the integration push. Either the drift
harness must stop asserting bypass for that class, or the visibility-governance
class must define its bypass posture. Belongs to the LLP 0234 owner.

## Registry-retirement resolution — 2026-08-19

The missing-membership signature is resolved structurally: the files now live
in `snapback-runtime` and `snapback-types`, and the replacement graph check
fails closed over every current Rust module. The module-ownership registry is
retired, so its health signature is administratively closed under LLP 0232
D-4. The distinct visibility-governance harness concern remains open as
`issues/20260819-visibility-governance-drift-harness-bypass-posture.md`.
