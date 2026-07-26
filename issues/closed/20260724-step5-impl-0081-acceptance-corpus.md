# 0081: acceptance corpus (0081 half of the coupled suite)

**Status:** Resolved (2026-07-26)
**Severity:** P2
**Systems:** Testing, Migrations, Storage
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §Acceptance, LLP 0063 WS6
**Marker:** step5-impl

Build the §Acceptance suite for the local profile: golden-vector plan
determinism; CLI refusal matrix incl. audience mismatch; UUIDv7 vectors;
fault injection inside every durable transition + fence-survival crash tests
per registered lane; cancellation matrix; downtime fixtures; portable corpus
through the pure expected-value evaluator and SQLite; publication-boundary
crashes with journal-projected receipts; preflight-failure purity; full and
sampled corruption oracles incl. the outside-sample miss demonstration;
deployment-ordering fixtures in both directions; rollback fixtures
(pre-publication, republish enable/disable, irreversible refusal,
timestamp-regression, resource-drift); retained/offline client across
publication; retained-work fixtures; rehearsal isolation; projection change
via the 0080 shadow rebuild; surface-identity parity; expression-sufficiency
fixtures; the Step 5 witness rerunning cumulative gates. Gates 0081
Implemented via the coupled suite. L-sized.

## Suite index (2026-07-25) — §Acceptance item → witness (local profile)

Witnesses live in `src/storage/migration_executor.rs` tests (module),
`tests/migration_corpus_v0.rs` (public surface), and Wave-1 suites.

1. **Canonical artifact byte agreement / golden vectors** —
   `migration.vectors-v1.json` + `golden_vectors_are_byte_pinned`;
   deterministic planner order + step IDs pinned by the Wave-1 tests.
2. **Deterministic synthesized IDs** — Wave-1 conformance vectors.
3. **Admission matrix** (audience equality, expiry-at-admission,
   plan/approval digest binding, staleness on schema drift, republished
   generation staleness, exclusivity, ceilings, timestamp floor incl.
   staged sources) — `admission_refusals_hold`,
   `corpus_completed_plan_is_stale_under_a_new_operation`,
   `fast_rollback_republishes_the_predecessor` (generation staleness).
4. **Durable state machine + closed relation** —
   `migration.journal-machine.v1.json` (committed), refusal-at-append;
   crash interiors: `kill_points_recover_at_every_transition_interior`
   (admitted, barriered, executing×2, verifying, published-held,
   released, cleanup-pending; exactly-once effects witnessed).
5. **Fence over the closed lane registry, surviving reopen** — Wave-2
   witnesses (all registered lanes + reopen-fenced).
6. **Batched execution, resume replays only uncommitted ranges** —
   Wave-2 backfill witnesses + staged-copy resume in
   `verification_failure_blocks_publication` (kill at verifying, resume).
7. **§5 full proof, zero rejects, independent expected values** —
   `staged_generation_migration_proves_and_publishes`,
   `corpus_forward_lifecycle_with_full_proof`; tamper refusal in
   `verification_failure_blocks_publication`; `sampled-audit` face label
   in `sampled_audit_labels_its_receipt_face`.
8. **Publication atomicity** (schema + version + floor + schema-resync
   row + receipt) — Wave-2 happy-path witness; published-held resume in
   `published_held_resume_releases`.
9. **§6 fast rollback / generationRepublish** —
   `fast_rollback_republishes_the_predecessor` (byte-exact republish,
   version R, floor raise, storage-generation advance, both replays,
   post-release refusal in `corpus_rollback_refused_after_release`).
10. **Downtime ceiling both sides** — Wave-2 fixtures.
11. **Receipts prove journal projection** — `migrate verify` +
    `corpus_forward_lifecycle_with_full_proof`.

**Open (recorded, not claimed):** the 0007 journal-grammar formalization
and posture-aware client handshake conformance (Wave 3a's ticket);
retained-work posture proofs; hosted/DO arms (deferred ticket);
generated-functions-against-successor execution check; fault injection
into the LANE fence interiors beyond reopen (Wave 2 covered reopen).

**Flip-closure fixtures (2026-07-25):** three §Acceptance items closed —
quarantined-offline-mutation settlement (refuse → resync → settle exactly
once; the floor gate fixed to refuse exactly the un-rebasable case),
proven ordering postures (dual-compatible and predeploy-compatible
publish only with the generated-facts binding proof; incompatible
predecessors refuse by name with no publication; dual-compatible admits
the predecessor attest during the window), and the restore-derived
rehearsal (executes only through its binding, cannot target production,
receipt consumed without substituting). Witnesses:
`quarantined_offline_mutation_settles_through_resync_before_replay`,
`compatibility_posture_ordering_is_proven_not_declared`,
`restore_derived_rehearsal_gates_production_apply`. Remaining 0081 flip
blockers after this slice: the Step 5 application witness (shared with
0080), the JS client quarantine UX residual, hosted/DO items (deferred
profiles), and the `transformed` retained-work posture (spec-deferred).

**Step 5 application witness (2026-07-26): CLOSED.** On the admitted
fixture (`demos/competitive-checkpoint`, LLP 0063 Revised 2026-07-26,
protocol amendment v0.8) the witness `schema-evolution.mjs` (6/6) reviewed
and executed the REAL `models.provider` schema change through
`snapback migrate` preview→approve→apply against the pinned v0 artifacts:
sealed plan reviewed on its face, tamper refusal, dry-run admission,
released journal-sealed receipt, exactly-once replay, verify re-proof,
then reopen on the successor artifacts with every predecessor row and the
relational helper serving. It found and fixed two engine defects with
regressions (the migrate.* CLI async-guard panic — pre-bind blocking
handoff in src/cli.rs; publication/§6 republish writing only the legacy
manifest slot and bricking reopened stores —
`publish_manifest_for_migration` dual-slot write plus the file-backed
reopen regression in tests/migration_corpus_v0.rs). Gate reruns ride
`step5-both-helpers.v1.json`. The 0081 Step 5 application witness item is
witnessed; remaining flip residuals are the JS client quarantine UX,
hosted/DO items (deferred profiles), and the `transformed` posture
(spec-deferred).

## Resolution (2026-07-26)

The 0081 §Acceptance corpus is complete on the local SQLite admission
profile (the RFC's own Step 5 scope): artifact vectors, admission matrix,
executor/journal/fence, §5 proof, §6 rollback, settlement, rehearsal, and
ordering fixtures are green, and the Step 5 application witness executed a
real reviewed v0→v1 schema change on the admitted fixture
(acceptance/results/schema-evolution.v1.json). LLP 0081 flipped to
**Implemented** 2026-07-26. Hosted/DO arms stay deferred in
`20260724-step5-impl-0081-hosted-do-executor.md`; spec frictions
consolidated in `20260726-0081-spec-amendment-frictions.md`; the client
quarantine UX residual stays in
`20260724-step5-impl-0081-journal-events.md`.
