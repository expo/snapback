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
