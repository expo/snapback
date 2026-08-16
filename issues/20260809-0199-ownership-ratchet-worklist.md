# LLP 0199 ownership-ratchet worklist: invert the frozen upward edges

**Opened:** 2026-08-09
**Context:** the 62-module ownership assignment (49c2ad3a8) re-keyed the
dependency graph and froze the pre-existing upward/sideways edges below into
ownership.baseline.json. Each item inverts a family of them; work them as
owner-#2 slices touch the same code, or as standalone leaf-shape moves.
The gate blocks NEW edges in these directions; this ticket tracks burning
down the grandfathered ones.


1. ~~**kernel→background: src/jobs.rs helpers.**~~ **DONE 2026-08-10** (slice 1,
   re-applied onto post-watches/LLP-0213 main the same day).
   The `*_in_tx` SQL helpers + row types now live in `src/storage/jobs.rs`
   (including main's `_snapback_job_rehearsal_provenance_v1` columns/joins,
   which ride the moved helpers); src/jobs.rs keeps scheduling policy and
   calls down. Inverted: `storage.rs -> jobs.rs`, `storage/jobs.rs ->
   jobs.rs`, and `storage/watches.rs -> jobs.rs` (the S5-growth edge below,
   absorbed by the relocation as predicted). (Same audit later for
   cron.rs/assets*.rs as owner-#2 slices drain them.)
2. ~~**kernel→sync: rqs shape imports ×8.**~~ **DONE 2026-08-10** (slice 1).
   The shared relational-query/stream shapes moved to the new leaf
   `src/rqs_contract.rs` (and search/vector type shapes to the leaf-owned
   `search/types.rs` / `vector/types.rs`); rqs.rs re-exports. Inverted:
   `search/{ast,sqlite} -> rqs`, `vector/{profile,query,rebuild,sqlite,storage}
   -> rqs`, `search/sqlite -> membership_rules` (membership_rules no longer
   imports rqs).
3. **kernel→sync/auth-core ×~24.** **First cut DONE 2026-08-10** — the value-shape
   half (6 edges) inverted; see the item-3 entry at the end of this file. The
   remaining edges are the genuine behavior call-ups. storage/auth_* files call up into
   session_projection ×5, service_fence ×5, sender_proof ×4, invalidation ×2,
   lease ×2, provider ×2, coordinator, invocation ×2, admission (via
   proof_checkpoint). This is exactly the with_auth_* escape-hatch shape:
   as owner-#2 slices convert closures to typed kernel ops, callers should pass
   typed inputs down instead of the kernel calling up. Standing worklist tied
   to slices 6–7 of the owner-#2 plan.
4. **sync→transport type imports ×4.** auth/{coordinator,invocation} →
   admin/server (+coordinator→local.rs). Fix: move the impersonation-header /
   wiring types to the leaf.
5. **kernel→background/transport composition ×3.** store_state.rs →
   auth/lifecycle + auth/runtime; storage/hosted_admission → hosted_edge.
   Fix: extract the admission-envelope + startup-composition types downward, or
   move the composing residue out of store_state.
6. ~~**coordinator→transport ×1.**~~ **DONE 2026-08-10** (slice 1). The host-op
   result envelope shapes moved to the new leaf `src/host_ops_contract.rs`.
   Inverted: `schema_export -> host_ops`.
7. ~~**leaf residues ×~10.**~~ **DONE 2026-08-10** (slice 1), except
   wire→descriptor which stays by design (both leaf, fine). Inverted:
   `handshake -> lease` (lease-protocol constants/duration shape moved into
   handshake), `descriptor -> {admin, invocation}` (the authority-consuming
   `descriptor_for_*` constructors + their tests moved up to auth/invocation;
   the pure derivation/validation stays on the descriptor leaf),
   `exec_guard -> session_projection`, `args_contract/manifest ->
   search/vector types` (search/types.rs + vector/types.rs reassigned to the
   leaf), `live_protocol -> completeness` (proof DTO family
   CursorEndV1/PageIdentityV1/ProofVersionV1/ProofNodeIdentityV1/
   [Unsigned]CompletenessProofV1 moved to contract_types.rs;
   AuthorizationWitnessRecordV1 moved beside CompositeWitness in
   auth/invalidation.rs; completeness re-exports and keeps all
   derivation/signing logic), `telemetry_bench -> bench` (shared finite-Ibex
   fixture extracted to background-owned src/bench_fixture.rs; the
   feature-gated file-backed `configured_file` twin now lives in
   telemetry_bench itself). Baseline frozen upward/sideways edges 362 → 340
   at the slice-1 baseline refresh on the 2026-08-10 evening main (26
   inverted, 4 pre-existing live edges entered — see the slice-C growth
   entry below; total baseline edges 1322 → 1356, the growth being allowed
   downward edges added by the new leaf modules and the refresh picking up
   main's newest modules).


Also: ~~refresh the mixedModuleScopes prose for src/local.rs and
src/manifest.rs~~ **DONE 2026-08-10** (slice-1 re-application; both entries
now describe today's scopes), and ~~dedup the
asset_delete_cascade/asset_receipt kernel copies~~ **DONE** (verified
2026-08-10: a single kernel copy lives in
`src/storage/asset_maintenance.rs`; local.rs delegates through
`asset_maintenance()` — no duplicate remains).

**Growth 2026-08-09 (frozen at the slice-4 landing):** eaed8e784 (LLP 0204 S0
agent registration, concurrent session) added four edges from
src/storage/auth_agents.rs; two are upward and join item 3's burn-down:
-> src/auth/provider.rs (StepUpConsumption/StepUpProof/step_up_required_error
imports; kernel->sync) and -> src/admin.rs (kernel->transport). Inversion:
move the step-up proof shapes to the leaf and pass the admin dependency down
as a typed input.

**Growth 2026-08-09 (frozen at the slice-8 landing):** the S1/S2 wave's five
catch-up modules froze two more upward edges: `storage/auth_integrations ->
admin` (kernel->transport; the integrations kernel imports an admin type —
move the shape to the leaf) and `auth/invocation -> telemetry`
(sync->background; instrumentation import — invert via a leaf-side event
shape or a callback). Slices 6-7 also relocated five kernel->sync
type-imports (provider, sender_proof, session_projection ×2, invocation)
into item 3's burn-down as recorded in their commit messages.

**Growth 2026-08-09 (slice-10 landing):** relocating the branch cluster made
two pre-existing kernel->background upward edges explicit (branch_ops ->
fork_promotion, -> instance_fork — the branch lifecycle calls domain
promotion/fork logic; invert by passing typed plans down). Fourth
unmanifested-module catch: storage/stream_transcripts.rs assigned to the
kernel at this landing (reinforces 20260809-ownership-gate-prepush-tier.md).

**Growth 2026-08-09 (slice-12 landing):** relocating schema/seed made four
pre-existing kernel upward edges explicit (schema_seed -> assets, -> push
[kernel->background: seeding invokes domain fixture/registry logic], ->
auth/coordinator + session_projection [kernel->sync, relocated from
storage.rs], -> seed_identity [kernel->generation]). Inversions ride the
same moves as items 1/3.

**Growth 2026-08-09 (slice-14 finale, re-derived):** mutation_writes ->
assets/jobs (kernel->background, item-1 family). Catch-ups #6-7:
ask.rs (background) + storage/ask_spend.rs, storage/asset_grants.rs,
storage/auth_rehearsal.rs (kernel) + auth/rehearsal.rs (leaf) assigned.

**Growth 2026-08-10 (frozen at the always-run-gate landing):** the LLP 0204 S5
wave (durable watches + approval-gated effects) landed five unmanifested
modules and four unbaselined edges without the gate running — the fourth
occurrence of the 20260809-ownership-gate-prepush-tier.md failure shape, and
the landing that closed that ticket assigned them
(`server/effects`→transport, `storage/{capability_links,pending_effects,watches}`→kernel,
`watches`→leaf) and re-baselined. Two edges are genuinely upward and join the
burn-down: `storage/pending_effects -> auth/provider` (kernel→sync; joins
item 3's typed-input inversion family) and `storage/watches -> jobs`
(kernel→background; joins item 1 — the `*_in_tx` helper relocation should
absorb it). The two `local.rs -> watches`/`storage/watches` edges are
unassigned-module freezes that drain with the local.rs remainder.

9. **Retired 2026-08-11: `src/auth/rehearsal.rs → src/secure_file.rs`
   (leaf→kernel) and `src/storage/auth_rehearsal.rs → src/admin.rs`
   (kernel→transport).** Both were live main-reds from the LLP 0213 slice-C
   wave (issues/20260810-main-module-ownership-red-rehearsal-edges.md). The
   kernel→transport edge retired when `ServerProfile` moved to the contract
   leaf. The leaf→kernel edge retired when strict owner-only capsule I/O moved
   to the dependency-free `src/owner_only_file.rs` leaf; the kernel keeps a
   downward compatibility wrapper. Both waiver records are removed from the
   frozen baseline.

10. **Waiver (time-bounded): `src/local.rs → src/wire_version.rs` and
    `src/local/tests.rs → src/wire_version.rs` (unassigned→leaf).** Lane-J
    pair, live-red on pristine main before this landing, frozen at the same
    `--update-baseline`. Inversion owner: **the local.rs drainage slices**
    (same vehicle as item 8, LLP 0225 §4 item 1). Bound: due with the
    local.rs drainage slice that assigns those modules or 2026-09-15,
    whichever comes first.

**Relocation re-key 2026-08-10 (owner-#2 generation-commit slice):** the
composite commit primitive moved from storage.rs into
storage/generation_commit.rs, and the frozen `local.rs -> storage.rs`
coupling's commit-primitive portion follows the moved code as `local.rs ->
storage/generation_commit.rs` (unassigned->kernel, one edge; provenance:
relocation — the wide `generation_database_mut` accessor was replaced by the
narrow typed `GenerationCommitOps` accessor, which local.rs must name).
Drains with the local.rs remainder like its sibling local.rs->storage/*
entries. The same landing's unmanifested-module catch (#8-9:
auth/identity_core.rs -> leaf, storage/auth_identity.rs -> kernel, from the
961b8be8c auth-floor landing) added allowed downward edges only — no
forbidden growth.

**Waiver (time-bounded) 2026-08-10 (owner-#5 writer-gate slice):** the
with_snapback/read-lane acquisition family moved from server.rs into
server/writer_gate.rs. The moved code's LocalSnapback coupling takes the new
key `server/writer_gate.rs -> local.rs` (transport->unassigned) while the
predecessor `server.rs -> local.rs` edge is retained by server.rs's
remaining references — an edge-key SPLIT, which the arm's relocation
disposition cannot express (predecessor must vanish; see
issues/20260810-owngate-split-relocation-disposition-gap.md). Recorded as a
waiver with transparent provenance; drains with the local.rs remainder like
its sibling god-file edges. The would-be second split
(`auth/coordinator -> writer_gate` through the re-export chain) was avoided
structurally: `with_snapback` stays a delegating `server.rs` item, keeping
the frozen item-4 edge on its existing key until item 4 inverts.

<!-- module-ownership-frozen-edge: {"fingerprint":"src/server/writer_gate.rs (transport-adapters) → src/local.rs (unassigned)","disposition":"time-bounded-waiver","observationRevision":"c93b17329d56db8af01c9fba6c4dc46f93151fe3","provenance":"Edge-key split at the owner-#5 extraction: the moved with_snapback family carries the pre-existing LocalSnapback coupling out of server.rs; the predecessor server.rs -> local.rs edge is retained by remaining references, so the strict relocation disposition cannot apply.","inversionOwner":"transport-adapters","deadline":"2026-09-15"} -->

8. **Waiver (time-bounded): `src/local.rs → src/connected_clients.rs`.**
   Genuinely new god-file-pattern coupling frozen 2026-08-10 at the
   connected-client landing, reclassified as a formal waiver by LLP 0225 §2
   (revision d/e). Edge: unassigned → sync-realtime-engine. Inversion owner:
   **`sync-realtime-engine`** (the accountable manifest owner — it owns the
   registry; the chosen resolution is a sync-owned port that `local.rs`
   consumes, not an adapter reclassification); vehicle: the `local.rs`
   drainage / coordinator-port slices (LLP 0225 §4 items 1 and 3). Bound: due with the sync-engine consolidation slice or
   2026-09-15, whichever comes first; if unmet, escalate to the author as a
   §2 violation rather than silently re-freezing.

<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/connected_clients.rs (sync-realtime-engine)","disposition":"time-bounded-waiver","observationRevision":"4e3b066e54e52556393ad26303adb0f868d81efe","provenance":"The genuinely new connected-clients coupling was author-recorded and reclassified as the bounded LLP 0225 §2 waiver in item 8.","inversionOwner":"sync-realtime-engine","deadline":"2026-09-15"} -->

12. **Analyzer-upgrade discoveries (38 edges, observed at
   `8f135b91a449a11960a8f186cf03b6cc747b47e7`).** The LLP 0225 §5 extractor
   upgrade made module-relative roots and transitive re-export targets visible
   under the predecessor source graph. These are attributed pre-existing
   freezes, not waivers and not permission to add similar coupling. The set
   includes the live `auth/provider → {lifecycle, mailbox}` sideways pair;
   `local.rs`/its acceptance residue reaching extracted child modules; and
   leaf/coordinator paths exposed through the vector, local, and server
   re-export façades. The exact canonical fingerprints are the frozen-edge
   records below and are consumed by the gate when it re-derives the baseline.

<!-- module-ownership-frozen-edge: {"fingerprint":"src/args_contract.rs (shared-contract-types-leaf) → src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/auth/provider.rs (sync-realtime-engine) → src/auth/lifecycle.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/auth/provider.rs (sync-realtime-engine) → src/auth/mailbox.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/local/config_types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/local/inspection.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/local/live_protocol.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/storage/asset_attempts.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/storage/asset_reads.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/storage/connections.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/storage/projection_rebuild.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/storage/schema_transition.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/vector/types.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/wire_version.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/auth_room_kick_acceptance.rs (unassigned) → src/contract_types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/auth_room_kick_acceptance.rs (unassigned) → src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/authorization_acceptance.rs (unassigned) → src/contract_types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/authorization_acceptance.rs (unassigned) → src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/authorization_acceptance.rs (unassigned) → src/local/live_protocol.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/config_types.rs (shared-contract-types-leaf) → src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/inspection.rs (background-services) → src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/live_protocol.rs (sync-realtime-engine) → src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/receipt_log.rs (sync-realtime-engine) → src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/contract_types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/local/inspection.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/local/live_protocol.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/realtime.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/storage/asset_reads.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/storage/schema_transition.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/vector/types.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/wire_version.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/manifest.rs (shared-contract-types-leaf) → src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/result_contract.rs (shared-contract-types-leaf) → src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/schema_export.rs (generation-activation-coordinator) → src/local/inspection.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/schema_export.rs (generation-activation-coordinator) → src/local/live_protocol.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/schema_export.rs (generation-activation-coordinator) → src/server/response_types.rs (transport-adapters)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->

11. **Waiver (time-bounded): `src/schema_export.rs → src/auth/logical_transfer.rs`
    (coordinator→sync) and `src/storage/auth_logical_transfer.rs →
    src/auth/logical_transfer.rs` (kernel→sync).** The logical-transfer wave
    landed both modules unmanifested (fifth occurrence of the
    pre-push-gate failure shape); this landing assigned them (sync / kernel)
    and froze the two edges at its `--update-baseline`. Inversion owner:
    **the LLP 0213 logical-export stream**. Vehicle: move the export
    envelope shape to the leaf (item 6's family) and pass typed inputs down
    (item 3's family). Bound: due with the next LLP 0213 slice that touches
    logical transfer or 2026-09-15, whichever comes first; if unmet,
    escalate to the author as a §2 violation.

13. **Merge-wave reconciliation (14 machine records, observed at
    `eefe4e446`).** The 2026-08-10 main landings (LLP 0214 catalog v3,
    LLP 0218 P2, ratchet slice 1, logical-transfer wave) merged into the §5
    enforcement landing. Twelve edges in that landed code are visible only
    to the upgraded analyzer and are frozen as attributed pre-existing
    discoveries; the two item-11 logical-transfer edges carry item 11's
    time-bounded waiver as machine records (two further records under this
    block carry item 9's rehearsal waivers into the v2 frozen set). The
    jobs-wave pair (`src/manifest.rs → src/storage/jobs.rs`,
    `src/storage.rs → src/jobs.rs`) is NOT frozen — it is the current
    unadmitted outstanding set, tracked by
    `issues/20260810-main-module-ownership-red-jobs-edges.md`. None of these
    grants permission for similar new coupling.

<!-- module-ownership-frozen-edge: {"fingerprint":"src/live_wire.rs (shared-contract-types-leaf) → src/storage/jobs.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/auth/handshake.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/rqs_contract.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/search/types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/storage/jobs.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/vector/types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/auth/handshake.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/rqs_contract.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/search/sqlite.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/search/types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/storage/jobs.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/local/tests.rs (unassigned) → src/vector/types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/schema_export.rs (generation-activation-coordinator) → src/auth/logical_transfer.rs (sync-realtime-engine)","disposition":"time-bounded-waiver","observationRevision":"eefe4e446","provenance":"Item 11: the logical-transfer wave landed both modules unmanifested; the fleet assigned them and froze these edges at its --update-baseline. Carried into the v2 frozen set as item 11 machine records.","inversionOwner":"sync-realtime-engine","deadline":"2026-09-15"} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"src/storage/auth_logical_transfer.rs (storage-migration-kernel) → src/auth/logical_transfer.rs (sync-realtime-engine)","disposition":"time-bounded-waiver","observationRevision":"eefe4e446","provenance":"Item 11: the logical-transfer wave landed both modules unmanifested; the fleet assigned them and froze these edges at its --update-baseline. Carried into the v2 frozen set as item 11 machine records.","inversionOwner":"sync-realtime-engine","deadline":"2026-09-15"} -->

<!-- Item 9 RETIRED 2026-08-11: both rehearsal-edge waiver records are gone;
     the kernel->transport half retired with the ServerProfile leaf move, and
     the leaf->kernel half retired with owner_only_file extraction. -->

**Item 3 first cut, 2026-08-10 (kernel auth authority shapes → leaf).** Six
frozen kernel→sync edges inverted by moving value shapes down, with the
behavior left in the sync engine
(`issues/20260810-owner2-kernel-auth-authority-shapes-slice.md`): the step-up
proof shapes to the leaf-owned `src/auth/crypto.rs`, and the service-authority
fence value shapes to the new leaf module
`src/auth/service_authority_contract.rs`. Removed:
`storage/auth_agent_credentials → auth/service_fence`,
`storage/auth_agents → auth/{provider,service_fence}`,
`storage/auth_grants → auth/{provider,service_fence}`, and
`storage/pending_effects → auth/provider`. `storage/auth.rs →
auth/service_fence` deliberately stays — it imports the two retained fence
traits, which invert when prepared-terminal custody becomes a typed kernel
operation. `ServiceAuthorityWitness::from_resolved` became
`ResolvedScopedToken::service_authority_witness` in
`src/storage/auth_agent_credentials.rs` so callers project the witness by
method instead of naming the leaf module — which is what keeps
`src/local/tests.rs` off the new module entirely.

One waiver, below: `src/local.rs` genuinely matches on
`ServiceAuthorityActResolution`/`ServiceAuthorityDisposition` (local.rs:3842-3856),
so the shape move re-keys its frozen `src/local.rs → src/auth/service_fence.rs`
edge (which this landing removes) onto the new leaf module. That is a strict
*layer improvement* — unassigned→sync becomes unassigned→leaf — but the tool's
`relocation` disposition asserts the predecessor owner pair is retained, so it
cannot express a re-key that moves a shape down a layer. This is the same
vocabulary gap already filed as
`issues/20260810-owngate-split-relocation-disposition-gap.md`; until that lane
widens the vocabulary, the honest machine record available is a waiver, and
the prose here carries the real disposition. It inverts with the `local.rs`
drainage slices, not by a separate inversion.

<!-- module-ownership-frozen-edge: {"fingerprint":"src/local.rs (unassigned) → src/auth/service_authority_contract.rs (shared-contract-types-leaf)","disposition":"time-bounded-waiver","observationRevision":"3d1553975","provenance":"Item 3 first cut: downward re-key of the frozen src/local.rs → src/auth/service_fence.rs edge that this same landing removes, because the service-authority value shapes moved from the sync engine to the contract leaf. Recorded as a waiver only because the relocation disposition requires the predecessor owner pair to be retained and cannot express a shape moving down a layer (issues/20260810-owngate-split-relocation-disposition-gap.md). Inverts with local.rs drainage.","inversionOwner":"transport-adapters","deadline":"2026-09-15"} -->


**Items 4-5 first cut, 2026-08-10 (`ServerProfile` -> contract leaf).** Items 4
and 5 looked like two families; six of their twelve edges actually crossed on a
single type, `crate::admin::ServerProfile` — a four-variant deployment-posture
enum that transport owned while the kernel and sync engine both had to consult
it. Moving the enum plus its two pure methods (`as_str`, `allows_provisioning`)
to `src/contract_types.rs` — with `for_bind_ip` left behind in `admin.rs`
because it reads `SNAPBACK_PROFILE` and the bind address — removed **12** frozen
forbidden edges and added none (382 -> 370).

It cleared more than the six scoped, because `ServerProfile` turned out to be
the *sole* admin import of six further modules: `src/auth/rehearsal.rs` and
`src/data_patch.rs` (leaf->transport, the worst direction in the graph),
`src/local.rs`, `src/local/tests.rs`,
`src/local/authorization_acceptance.rs` (unassigned->transport), and
`src/push.rs` (background->transport). Retires the kernel->transport half of
waiver item 9 the day before its deadline.

Zero baseline growth: `src/contract_types.rs` was already a dependency of every
consumer, so no re-key needed a disposition. `snapback::admin::ServerProfile`
still resolves via a `pub use` kept for the public surface only; internal
callers were repointed so the edges genuinely re-key.

Still open in items 4-5: `src/proof_checkpoint.rs -> src/admin.rs`
(`ProtectedErasureAdminCredentialBinding`), `src/store_state.rs -> src/admin.rs`
(`admin_token_sibling` / `console_credential_sibling`), the `store_state ->
auth/{lifecycle,runtime}` composition edges, and `storage/hosted_admission ->
auth/hosted_edge`.


**Item-3 second cut, 2026-08-11 (`session_projection` value shapes -> leaf).**
Four more frozen kernel->sync edges inverted (370 -> 366) by moving
`SESSION_TERMINAL_CAUSE_META_PREFIX`, `RevocationReason`,
`PersistedSessionTerminalReason`, `SessionTerminalCauseRecord`, and
`AuthorizationStreamIncarnation` to `src/contract_types.rs`, leaving every
`impl` behind in `auth/session_projection.rs`
(`issues/20260810-item-3-session-projection-shapes-leaf.md`). Cleared:
`storage/auth_mode`, `storage/push_registry`, `storage/auth`,
`storage/auth_catalog_ops`. Zero baseline growth; no waiver.

`SessionProjection` deliberately did NOT move (36 methods — it is the behavior
the boundary exists to keep in sync), which is why `storage/auth_stream`,
`storage/tests`, and `storage/schema_seed` keep their edges. Those, plus the
`auth_catalog_ops`/`auth_sender` function call-ups, were raised as an ownership
question.

**Item-3 remainder RULED 2026-08-11.** LLP 0225 revision (n), §4 "Item-3
remainder — the provider split, ruled". The question's premise was inverted:
`storage/auth_catalog_ops.rs` is the *transaction-scoping* half (correctly
kernel-owned under §3.1) and the canonical-store SQL lives in the sync-owned
`src/auth/provider.rs`. The split therefore runs through `provider.rs` — SQL
bodies down to the kernel, plan/outcome shapes down to the leaf, plan
composition and refusal classification staying in sync, with the
read-and-classify functions cut so the kernel returns durable facts and sync
classifies them. Sequenced A1/A2/A3 in
`issues/closed/20260811-llp0225-item-3-provider-split-implementation.md`; the question
is closed at
`issues/closed/20260810-item-3-remainder-auth-catalog-ops-owner-question.md`.
Item 3 is unblocked.
