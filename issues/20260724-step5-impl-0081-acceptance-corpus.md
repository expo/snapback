# 0081: acceptance corpus (0081 half of the coupled suite)

**Status:** Deferred (phase C)
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
