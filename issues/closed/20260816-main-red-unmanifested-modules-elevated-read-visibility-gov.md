# main red: two Rust modules exist but are missing from the ownership manifest

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Ownership gate, Tests
**Date:** 2026-08-16
**Found while:** landing LLP 0189 piece 3; the drift_prone_gates_v0 suite's
ownership-gate fixtures fail on the ambient strays.

## Problem

`src/elevated_read_trace.rs` and `src/visibility_governance.rs` exist as
tracked files on `origin/main` but are absent from `ownership.manifest.json`,
so `node scripts/check-module-ownership.mjs` refuses with
`SNAPBACK_MODULE_OWNERSHIP_VIOLATION: manifest is missing Rust modules:
src/elevated_read_trace.rs, src/visibility_governance.rs`. This turns five
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

src/visibility_governance.rs landed unmanifested (LLP 0234) and is imported by the
src/local.rs god-file cluster. Assigned to shared-contract-types-leaf (its type is a
contract embedded as a field in the leaf src/manifest.rs, so leaf keeps that edge
intra-owner). The two god-file import edges are frozen as bounded drainage waivers,
the same pattern as the standing local.rs → leaf drainage set (worklist item 11).

<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/visibility_governance.rs (shared-contract-types-leaf)","disposition":"time-bounded-waiver","observationRevision":"a509921612e3d86a1d445f7c64d80bc7ec148c67","provenance":"visibility_governance landed unmanifested (LLP 0234); assigning it to shared-contract-types-leaf freezes this pre-existing god-file import as a bounded LLP 0225 §2 drainage waiver, inverted when src/local.rs drains its activation-validation call to the generation-activation-coordinator.","inversionOwner":"generation-activation-coordinator","deadline":"2026-09-15"} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/visibility_governance.rs (shared-contract-types-leaf)","disposition":"time-bounded-waiver","observationRevision":"a509921612e3d86a1d445f7c64d80bc7ec148c67","provenance":"visibility_governance landed unmanifested (LLP 0234); assigning it to shared-contract-types-leaf freezes this pre-existing god-file import as a bounded LLP 0225 §2 drainage waiver, inverted when src/local.rs drains its activation-validation call to the generation-activation-coordinator.","inversionOwner":"generation-activation-coordinator","deadline":"2026-09-15"} -->

## Inherited forbidden ownership edges — standing tracker

Observed at `a509921612e3d86a1d445f7c64d80bc7ec148c67`. These forbidden module edges are inherited from prior
landings (MediaProjection*V1 type imports from src/runtime.rs by storage, plus
the standing god-file couplings). They were masked on `main` by the missing-module
error above and surfaced once the three strays were manifested. They are inherited
reds (LLP 0232 fix-forward), tracked here jointly with
issues/20260810-main-module-ownership-red-jobs-edges.md; the MediaProjection edges
invert by shaping those proof types down to src/contract_types.rs (leaf), owned by
the assets/media lane (LLP 0239).

- `src/local.rs (unassigned) → src/auth/identity_core.rs (shared-contract-types-leaf)`
- `src/local/tests.rs (unassigned) → src/conformance.rs (storage-migration-kernel)`
- `src/storage.rs (storage-migration-kernel) → src/runtime.rs (transport-adapters)`
- `src/storage/membership_reads.rs (storage-migration-kernel) → src/membership_rules.rs (sync-realtime-engine)`
- `src/storage/mutation_writes.rs (storage-migration-kernel) → src/runtime.rs (transport-adapters)`
- `src/storage/tests.rs (storage-migration-kernel) → src/assets_cut.rs (background-services)`
- `src/storage/tests.rs (storage-migration-kernel) → src/runtime.rs (transport-adapters)`

## Resolution (2026-08-16)

Assigned the three strays (`dev_identity.rs` appeared after this ticket was
filed): `src/dev_identity.rs` + `src/elevated_read_trace.rs` →
`transport-adapters` (co-located with their `server.rs`/`runtime.rs` callers;
deps are leaf/downward), `src/visibility_governance.rs` →
`shared-contract-types-leaf` (its type is embedded as a field in the leaf
`src/manifest.rs`; leaf keeps that edge intra-owner). The two `local.rs`
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
