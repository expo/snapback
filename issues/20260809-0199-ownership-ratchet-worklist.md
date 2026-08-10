# LLP 0199 ownership-ratchet worklist: invert the frozen upward edges

**Opened:** 2026-08-09
**Context:** the 62-module ownership assignment (49c2ad3a8) re-keyed the
dependency graph and froze the pre-existing upward/sideways edges below into
ownership.baseline.json. Each item inverts a family of them; work them as
owner-#2 slices touch the same code, or as standalone leaf-shape moves.
The gate blocks NEW edges in these directions; this ticket tracks burning
down the grandfathered ones.


1. **kernel→background: src/jobs.rs helpers.** storage.rs + storage/jobs.rs call
   `crate::jobs::*_in_tx` (background-services). Fix: relocate the `*_in_tx`
   SQL helpers + row types into `src/storage/jobs.rs`, leave scheduling policy
   in src/jobs.rs. (Same audit later for cron.rs/assets*.rs as owner-#2 slices
   drain them.)
2. **kernel→sync: rqs shape imports ×8.** search/{ast,sqlite} and
   vector/{profile,query,rebuild,sqlite,storage} import `crate::rqs` (+
   membership_rules ×1). Fix: move the shared relational-query/stream shapes
   from rqs.rs down to the contract leaf.
3. **kernel→sync/auth-core ×~24.** storage/auth_* files call up into
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
6. **coordinator→transport ×1.** schema_export → host_ops. Fix: the host-op
   result envelope type belongs on the leaf.
7. **leaf residues ×~10.** wire→descriptor(ok, both leaf), handshake→lease,
   descriptor→{admin,invocation}, exec_guard→session_projection,
   args_contract/manifest→search/vector types, live_protocol→completeness,
   telemetry_bench→bench. Each inverts by moving one shape down; none blocks.


Also: refresh the mixedModuleScopes prose for src/local.rs and
src/manifest.rs (still describes pre-split scopes), and dedup the
asset_delete_cascade/asset_receipt kernel copies when the delete/finalize
slices drain the local.rs originals.

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

9. **Analyzer-upgrade discoveries (38 edges, observed at
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
