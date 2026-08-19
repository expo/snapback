# LLP 0199 ownership-ratchet worklist: invert the frozen upward edges

**Status:** Resolved 2026-08-19 by LLP 0276 Phase 3
**Opened:** 2026-08-09
**Context:** the 62-module ownership assignment (49c2ad3a8) re-keyed the
dependency graph and froze the pre-existing upward/sideways edges below into
ownership.baseline.json. Each item inverts a family of them; work them as
owner-#2 slices touch the same code, or as standalone leaf-shape moves.
The gate blocks NEW edges in these directions; this ticket tracks burning
down the grandfathered ones.

## Phase 3 resolution

The crate carves removed the module-owner graph that made these fingerprints
violations. The replacement workspace-graph check passes over all 13 planned
crates and 419 Rust modules, and validates the five named assigned-home
exceptions exactly. No item below remains as a forbidden crate edge and no
waiver was copied into the replacement matrix.

The final committed baseline before retirement made this mechanically
checkable: it contained 137 observed edges and exactly one
`frozenForbiddenEdge`,
`schema_export.rs (generation-activation-coordinator) →
crates/snapback/src/assets.rs (background-services)`. That exact fingerprint
died in the services carve (`1509190a0`): its target path no longer exists and
the asset implementation now lives in `snapback-services`. The surviving
schema-registry composition is not hidden: `schema_export.rs` is one of the
five exact named assigned-home exceptions, and its physical dependency is the
checked legal `snapback` → `snapback-services` edge. Thus the final
grandfathered fingerprint did not carry into the replacement matrix.

| Item | Resolution at the carve |
| --- | --- |
| 1 | Jobs value/kernel operations moved to `snapback-types` and `snapback-kernel`; scheduling policy moved to `snapback-services`. Services now depends downward on kernel. |
| 2 | RQS/search/vector value shapes moved to `snapback-types`, persistence to `snapback-kernel`, and sync behavior to `snapback-sync`. |
| 3 | Auth value shapes moved to `snapback-types`, durable operations to `snapback-kernel`, and auth behavior to `snapback-auth`. The kernel has no dependency back up into auth. |
| 4 | Auth/coordinator behavior moved below transport into `snapback-auth`; `snapback-server` and `snapback-cli` depend downward on it. |
| 5 | Durable admission moved to `snapback-kernel`; auth policy to `snapback-auth`; startup composition to `snapback-cli`. The old kernel-to-service/transport call-ups are absent from the checked crate graph. |
| 6 | Host-operation carriers moved to `snapback-types`, with coordination in engine/server. |
| 7 | Shared leaf residues moved to `snapback-types`; behavior moved to its owning higher crate. No leaf crate has a workspace dependency. |
| 8 | The `local` engine still uses the connected-client registry, now as the legal checked `snapback-engine` to `snapback-sync` dependency. The grandfathered unassigned-to-sync violation died at the engine/sync carve. |
| 9 | Already retired by the `ServerProfile` leaf move and owner-only-file extraction; Phase 2 placed the surviving carriers in their owning crates. |
| 10 | The engine still negotiates wire versions through `snapback-types`; this is the legal checked engine-to-types dependency, so the old unassigned-to-leaf waiver died at the engine/types carve. |
| 11 | Logical-transfer persistence is in `snapback-kernel`. `schema_export.rs` still composes it from the façade, but its exact file is the named `schema-export-facade-integration` assigned-home exception, assigned to activation; activation-to-kernel is legal. The old coordinator/kernel-to-sync violations are gone. |
| 12 | All 38 analyzer discoveries were redistributed among their assigned crates. Any surviving reference is intra-crate or a checked downward dependency; none requires a remainder record. |
| 13 | The 14 merge-wave records resolved the same way: rehearsal died at item 9, logical transfer at item 11, and every analyzer-discovery record is now covered by an exact crate boundary rather than a frozen exception. |

The original prose and machine comments below remain as historical evidence;
they are not live gate inputs after the module-ownership registry retirement.


1. ~~**kernel→background: crates/snapback/src/jobs.rs helpers.**~~ **DONE 2026-08-10** (slice 1,
   re-applied onto post-watches/LLP-0213 main the same day).
   The `*_in_tx` SQL helpers + row types now live in `crates/snapback/src/storage/jobs.rs`
   (including main's `_snapback_job_rehearsal_provenance_v1` columns/joins,
   which ride the moved helpers); crates/snapback/src/jobs.rs keeps scheduling policy and
   calls down. Inverted: `storage.rs -> jobs.rs`, `storage/jobs.rs ->
   jobs.rs`, and `storage/watches.rs -> jobs.rs` (the S5-growth edge below,
   absorbed by the relocation as predicted). (Same audit later for
   cron.rs/assets*.rs as owner-#2 slices drain them.)
2. ~~**kernel→sync: rqs shape imports ×8.**~~ **DONE 2026-08-10** (slice 1).
   The shared relational-query/stream shapes moved to the new leaf
   `crates/snapback/src/rqs_contract.rs` (and search/vector type shapes to the leaf-owned
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
   result envelope shapes moved to the new leaf `crates/snapback/src/host_ops_contract.rs`.
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
   fixture extracted to background-owned crates/snapback/src/bench_fixture.rs; the
   feature-gated file-backed `configured_file` twin now lives in
   telemetry_bench itself). Baseline frozen upward/sideways edges 362 → 340
   at the slice-1 baseline refresh on the 2026-08-10 evening main (26
   inverted, 4 pre-existing live edges entered — see the slice-C growth
   entry below; total baseline edges 1322 → 1356, the growth being allowed
   downward edges added by the new leaf modules and the refresh picking up
   main's newest modules).


Also: ~~refresh the mixedModuleScopes prose for crates/snapback/src/local.rs and
crates/snapback/src/manifest.rs~~ **DONE 2026-08-10** (slice-1 re-application; both entries
now describe today's scopes), and ~~dedup the
asset_delete_cascade/asset_receipt kernel copies~~ **DONE** (verified
2026-08-10: a single kernel copy lives in
`crates/snapback/src/storage/asset_maintenance.rs`; local.rs delegates through
`asset_maintenance()` — no duplicate remains).

**Growth 2026-08-09 (frozen at the slice-4 landing):** eaed8e784 (LLP 0204 S0
agent registration, concurrent session) added four edges from
crates/snapback/src/storage/auth_agents.rs; two are upward and join item 3's burn-down:
-> crates/snapback/src/auth/provider.rs (StepUpConsumption/StepUpProof/step_up_required_error
imports; kernel->sync) and -> crates/snapback/src/admin.rs (kernel->transport). Inversion:
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

9. **Retired 2026-08-11: `crates/snapback/src/auth/rehearsal.rs → crates/snapback/src/secure_file.rs`
   (leaf→kernel) and `crates/snapback/src/storage/auth_rehearsal.rs → crates/snapback/src/admin.rs`
   (kernel→transport).** Both were live main-reds from the LLP 0213 slice-C
   wave (issues/20260810-main-module-ownership-red-rehearsal-edges.md). The
   kernel→transport edge retired when `ServerProfile` moved to the contract
   leaf. The leaf→kernel edge retired when strict owner-only capsule I/O moved
   to the dependency-free `crates/snapback/src/owner_only_file.rs` leaf; the kernel keeps a
   downward compatibility wrapper. Both waiver records are removed from the
   frozen baseline.

10. **Waiver (time-bounded): `crates/snapback/src/local.rs → crates/snapback/src/wire_version.rs` and
    `crates/snapback/src/local/tests.rs → crates/snapback/src/wire_version.rs` (unassigned→leaf).** Lane-J
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

<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/server/writer_gate.rs (transport-adapters) → crates/snapback/src/local.rs (unassigned)","disposition":"time-bounded-waiver","observationRevision":"c93b17329d56db8af01c9fba6c4dc46f93151fe3","provenance":"Edge-key split at the owner-#5 extraction: the moved with_snapback family carries the pre-existing LocalSnapback coupling out of server.rs; the predecessor server.rs -> local.rs edge is retained by remaining references, so the strict relocation disposition cannot apply.","inversionOwner":"transport-adapters","deadline":"2026-09-15"} -->

8. **Waiver (time-bounded): `crates/snapback/src/local.rs → crates/snapback/src/connected_clients.rs`.**
   Genuinely new god-file-pattern coupling frozen 2026-08-10 at the
   connected-client landing, reclassified as a formal waiver by LLP 0225 §2
   (revision d/e). Edge: unassigned → sync-realtime-engine. Inversion owner:
   **`sync-realtime-engine`** (the accountable manifest owner — it owns the
   registry; the chosen resolution is a sync-owned port that `local.rs`
   consumes, not an adapter reclassification); vehicle: the `local.rs`
   drainage / coordinator-port slices (LLP 0225 §4 items 1 and 3). Bound: due with the sync-engine consolidation slice or
   2026-09-15, whichever comes first; if unmet, escalate to the author as a
   §2 violation rather than silently re-freezing.

<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/connected_clients.rs (sync-realtime-engine)","disposition":"time-bounded-waiver","observationRevision":"4e3b066e54e52556393ad26303adb0f868d81efe","provenance":"The genuinely new connected-clients coupling was author-recorded and reclassified as the bounded LLP 0225 §2 waiver in item 8.","inversionOwner":"sync-realtime-engine","deadline":"2026-09-15"} -->

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

<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/args_contract.rs (shared-contract-types-leaf) → crates/snapback/src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/auth/provider.rs (sync-realtime-engine) → crates/snapback/src/auth/lifecycle.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/auth/provider.rs (sync-realtime-engine) → crates/snapback/src/auth/mailbox.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/local/config_types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/local/inspection.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/local/live_protocol.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/storage/asset_attempts.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/storage/asset_reads.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/storage/connections.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/storage/projection_rebuild.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/storage/schema_transition.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/vector/types.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/wire_version.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/auth_room_kick_acceptance.rs (unassigned) → crates/snapback/src/contract_types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/auth_room_kick_acceptance.rs (unassigned) → crates/snapback/src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/authorization_acceptance.rs (unassigned) → crates/snapback/src/contract_types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/authorization_acceptance.rs (unassigned) → crates/snapback/src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/authorization_acceptance.rs (unassigned) → crates/snapback/src/local/live_protocol.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/config_types.rs (shared-contract-types-leaf) → crates/snapback/src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/inspection.rs (background-services) → crates/snapback/src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/live_protocol.rs (sync-realtime-engine) → crates/snapback/src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/receipt_log.rs (sync-realtime-engine) → crates/snapback/src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/contract_types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/local.rs (unassigned)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/local/inspection.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/local/live_protocol.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/realtime.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/storage/asset_reads.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/storage/schema_transition.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/vector/types.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/wire_version.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/manifest.rs (shared-contract-types-leaf) → crates/snapback/src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/result_contract.rs (shared-contract-types-leaf) → crates/snapback/src/vector/profile.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/schema_export.rs (generation-activation-coordinator) → crates/snapback/src/local/inspection.rs (background-services)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/schema_export.rs (generation-activation-coordinator) → crates/snapback/src/local/live_protocol.rs (sync-realtime-engine)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/schema_export.rs (generation-activation-coordinator) → crates/snapback/src/server/response_types.rs (transport-adapters)","disposition":"analyzer-upgrade","observationRevision":"8f135b91a449a11960a8f186cf03b6cc747b47e7","provenance":"The upgraded module-relative and transitive re-export analyzer proves this edge in the predecessor source graph."} -->

11. **Waiver (time-bounded): `crates/snapback/src/schema_export.rs → crates/snapback/src/auth/logical_transfer.rs`
    (coordinator→sync) and `crates/snapback/src/storage/auth_logical_transfer.rs →
    crates/snapback/src/auth/logical_transfer.rs` (kernel→sync).** The logical-transfer wave
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
    jobs-wave pair (`crates/snapback/src/manifest.rs → crates/snapback/src/storage/jobs.rs`,
    `crates/snapback/src/storage.rs → crates/snapback/src/jobs.rs`) is NOT frozen — it is the current
    unadmitted outstanding set, tracked by
    `issues/20260810-main-module-ownership-red-jobs-edges.md`. None of these
    grants permission for similar new coupling.

<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/live_wire.rs (shared-contract-types-leaf) → crates/snapback/src/storage/jobs.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/auth/handshake.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/rqs_contract.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/search/types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/storage/jobs.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/vector/types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/auth/handshake.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/rqs_contract.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/search/sqlite.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/search/types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/storage/jobs.rs (storage-migration-kernel)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local/tests.rs (unassigned) → crates/snapback/src/vector/types.rs (shared-contract-types-leaf)","disposition":"analyzer-upgrade","observationRevision":"eefe4e446","provenance":"Visible only to the upgraded module-relative and transitive re-export analyzer in the 2026-08-10 main landings merged at the LLP 0225 §5 enforcement landing."} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/schema_export.rs (generation-activation-coordinator) → crates/snapback/src/auth/logical_transfer.rs (sync-realtime-engine)","disposition":"time-bounded-waiver","observationRevision":"eefe4e446","provenance":"Item 11: the logical-transfer wave landed both modules unmanifested; the fleet assigned them and froze these edges at its --update-baseline. Carried into the v2 frozen set as item 11 machine records.","inversionOwner":"sync-realtime-engine","deadline":"2026-09-15"} -->
<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/storage/auth_logical_transfer.rs (storage-migration-kernel) → crates/snapback/src/auth/logical_transfer.rs (sync-realtime-engine)","disposition":"time-bounded-waiver","observationRevision":"eefe4e446","provenance":"Item 11: the logical-transfer wave landed both modules unmanifested; the fleet assigned them and froze these edges at its --update-baseline. Carried into the v2 frozen set as item 11 machine records.","inversionOwner":"sync-realtime-engine","deadline":"2026-09-15"} -->

<!-- Item 9 RETIRED 2026-08-11: both rehearsal-edge waiver records are gone;
     the kernel->transport half retired with the ServerProfile leaf move, and
     the leaf->kernel half retired with owner_only_file extraction. -->

**Item 3 first cut, 2026-08-10 (kernel auth authority shapes → leaf).** Six
frozen kernel→sync edges inverted by moving value shapes down, with the
behavior left in the sync engine
(`issues/20260810-owner2-kernel-auth-authority-shapes-slice.md`): the step-up
proof shapes to the leaf-owned `crates/snapback/src/auth/crypto.rs`, and the service-authority
fence value shapes to the new leaf module
`crates/snapback/src/auth/service_authority_contract.rs`. Removed:
`storage/auth_agent_credentials → auth/service_fence`,
`storage/auth_agents → auth/{provider,service_fence}`,
`storage/auth_grants → auth/{provider,service_fence}`, and
`storage/pending_effects → auth/provider`. `storage/auth.rs →
auth/service_fence` deliberately stays — it imports the two retained fence
traits, which invert when prepared-terminal custody becomes a typed kernel
operation. `ServiceAuthorityWitness::from_resolved` became
`ResolvedScopedToken::service_authority_witness` in
`crates/snapback/src/storage/auth_agent_credentials.rs` so callers project the witness by
method instead of naming the leaf module — which is what keeps
`crates/snapback/src/local/tests.rs` off the new module entirely.

One waiver, below: `crates/snapback/src/local.rs` genuinely matches on
`ServiceAuthorityActResolution`/`ServiceAuthorityDisposition` (local.rs:3842-3856),
so the shape move re-keys its frozen `crates/snapback/src/local.rs → crates/snapback/src/auth/service_fence.rs`
edge (which this landing removes) onto the new leaf module. That is a strict
*layer improvement* — unassigned→sync becomes unassigned→leaf — but the tool's
`relocation` disposition asserts the predecessor owner pair is retained, so it
cannot express a re-key that moves a shape down a layer. This is the same
vocabulary gap already filed as
`issues/20260810-owngate-split-relocation-disposition-gap.md`; until that lane
widens the vocabulary, the honest machine record available is a waiver, and
the prose here carries the real disposition. It inverts with the `local.rs`
drainage slices, not by a separate inversion.

<!-- module-ownership-frozen-edge: {"fingerprint":"crates/snapback/src/local.rs (unassigned) → crates/snapback/src/auth/service_authority_contract.rs (shared-contract-types-leaf)","disposition":"time-bounded-waiver","observationRevision":"3d1553975","provenance":"Item 3 first cut: downward re-key of the frozen crates/snapback/src/local.rs → crates/snapback/src/auth/service_fence.rs edge that this same landing removes, because the service-authority value shapes moved from the sync engine to the contract leaf. Recorded as a waiver only because the relocation disposition requires the predecessor owner pair to be retained and cannot express a shape moving down a layer (issues/20260810-owngate-split-relocation-disposition-gap.md). Inverts with local.rs drainage.","inversionOwner":"transport-adapters","deadline":"2026-09-15"} -->


**Items 4-5 first cut, 2026-08-10 (`ServerProfile` -> contract leaf).** Items 4
and 5 looked like two families; six of their twelve edges actually crossed on a
single type, `crate::admin::ServerProfile` — a four-variant deployment-posture
enum that transport owned while the kernel and sync engine both had to consult
it. Moving the enum plus its two pure methods (`as_str`, `allows_provisioning`)
to `crates/snapback/src/contract_types.rs` — with `for_bind_ip` left behind in `admin.rs`
because it reads `SNAPBACK_PROFILE` and the bind address — removed **12** frozen
forbidden edges and added none (382 -> 370).

It cleared more than the six scoped, because `ServerProfile` turned out to be
the *sole* admin import of six further modules: `crates/snapback/src/auth/rehearsal.rs` and
`crates/snapback/src/data_patch.rs` (leaf->transport, the worst direction in the graph),
`crates/snapback/src/local.rs`, `crates/snapback/src/local/tests.rs`,
`crates/snapback/src/local/authorization_acceptance.rs` (unassigned->transport), and
`crates/snapback/src/push.rs` (background->transport). Retires the kernel->transport half of
waiver item 9 the day before its deadline.

Zero baseline growth: `crates/snapback/src/contract_types.rs` was already a dependency of every
consumer, so no re-key needed a disposition. `snapback::admin::ServerProfile`
still resolves via a `pub use` kept for the public surface only; internal
callers were repointed so the edges genuinely re-key.

Still open in items 4-5: `crates/snapback/src/proof_checkpoint.rs -> crates/snapback/src/admin.rs`
(`ProtectedErasureAdminCredentialBinding`), `crates/snapback/src/store_state.rs -> crates/snapback/src/admin.rs`
(`admin_token_sibling` / `console_credential_sibling`), the `store_state ->
auth/{lifecycle,runtime}` composition edges, and `storage/hosted_admission ->
auth/hosted_edge`.


**Item-3 second cut, 2026-08-11 (`session_projection` value shapes -> leaf).**
Four more frozen kernel->sync edges inverted (370 -> 366) by moving
`SESSION_TERMINAL_CAUSE_META_PREFIX`, `RevocationReason`,
`PersistedSessionTerminalReason`, `SessionTerminalCauseRecord`, and
`AuthorizationStreamIncarnation` to `crates/snapback/src/contract_types.rs`, leaving every
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
`crates/snapback/src/auth/provider.rs`. The split therefore runs through `provider.rs` — SQL
bodies down to the kernel, plan/outcome shapes down to the leaf, plan
composition and refusal classification staying in sync, with the
read-and-classify functions cut so the kernel returns durable facts and sync
classifies them. Sequenced A1/A2/A3 in
`issues/closed/20260811-llp0225-item-3-provider-split-implementation.md`; the question
is closed at
`issues/closed/20260810-item-3-remainder-auth-catalog-ops-owner-question.md`.
Item 3 is unblocked.
