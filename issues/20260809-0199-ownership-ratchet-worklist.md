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

9. **Waiver (time-bounded): `src/auth/rehearsal.rs → src/secure_file.rs`
   (leaf→kernel) and `src/storage/auth_rehearsal.rs → src/admin.rs`
   (kernel→transport).** Frozen 2026-08-10 at the slice-1 re-application
   landing; both were live main-reds from the LLP 0213 slice-C wave
   (issues/20260810-main-module-ownership-red-rehearsal-edges.md). Inversion
   owner: **the LLP 0213 rehearsal/auth stream** (that ticket's routed
   author). Vehicle: item 3's typed-input/leaf-shape moves. Bound: the
   author-sitting 24h fix-forward conversion (2026-08-11) on the routed
   ticket; if unmet, fix-forward-by-anyone, and escalate to the author if
   still frozen at the next 0213 slice.

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
