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
