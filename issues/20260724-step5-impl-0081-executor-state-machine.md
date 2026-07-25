# 0081: durable executor, admission fence, lifecycle (local SQLite profile)

**Status:** In progress (Wave 2 core landed 2026-07-25)
**Severity:** P2
**Systems:** Migrations, Storage
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §§1, 4
**Marker:** step5-impl

The exclusive-single-writer executor as a durable state machine: closed
schema-enumerated state set + transition relation (published-held,
cleanup-pending tail, cancellation states), fencing-token validation, the
capability-derived all-lane admission fence surviving crash between reopen
and resume, batch atomicity (shadow writes + cursor + digest accumulator +
journal in one transaction), pre-publication-only cancellation, the enforced
downtime ceiling with safe abort, and the published-held release/rollback
exits. Local SQLite is the Step 5 admission profile; hosted DO executor is a
separate deferred ticket. L-sized.

**Progress (2026-07-25, Wave 2):** the local-profile durable executor landed
(`src/storage/migration_executor.rs`):

- The closed 13-state machine with the complete transition relation
  committed at `schemas/migration.journal-machine.v1.json` (generated
  through the module; an out-of-relation append refuses as
  `SNAPBACK_MIGRATION_JOURNAL_CORRUPT`, and the cleanup tail must close
  into the terminal it extends). Journal entries carry plan/step identity,
  attempt, state, progress cursor (the Wave-1 scan checkpoint or the
  backfill boundary), output generation, verification, durable error code,
  and the fencing token (lease epoch, validated on every append —
  `SNAPBACK_MIGRATION_EXECUTOR_STALE` supersedes old instances). Journal +
  ops tables live in the durability domain
  (`_snapback_migration_journal` / `_snapback_migration_ops`).
- The persisted fence closes the enumerated lane registry
  (`CapabilityManifest.migration.fenceLanes`: mutation,
  buffered-mutation, query, live-subscribe, live-resume, cron,
  action-stage, ephemeral-publish) — enforced PER ADMISSION from durable
  state (each lane re-reads the fence in its own transaction/snapshot),
  and reopen-time construction starts admission closed over a fenced
  database (`migration_fence_survives_process_reopen`).
- Admission (§2): audience equality against the resolved local identity,
  replay keyed by operationId before any staleness comparison, plan/
  approval digest binding, expiry-at-admission (an admitted operation is
  never stranded), schema-drift staleness, exclusivity (one migration
  owns the app), barrier-time resource ceilings and the
  publicationTimestamp >= max `_updatedAt` floor
  (`SNAPBACK_MIGRATION_PRECONDITION_FAILED`), and `MigrationAdmissionV1`
  emission into the sealed receipt.
- Execution: single-transaction structural steps; batched in-place
  backfill (union-schema page reads, executor-privileged, one
  transaction per batch committing writes + boundary + journal); §4
  system-identity rules for changed rows; `MigrationKeysetScanV1` proof
  scans for ValidateRequired/ValidateUnique; RebuildMaintainedProjection
  delegates to the LLP 0080 engine.
- Publication: ONE transaction publishes the successor manifest +
  additive DDL, exactly one successor version, the raised retention
  floor, and a typed `schema-resync` change-journal row (reserved
  `_snapback_schema` table name; keeps the head/high-water cut), entering
  `published-held`; the only exits are the journaled release (re-running
  apply is the explicit release decision) or rollback; a held journal
  entry without its output version fails closed as
  `SNAPBACK_MIGRATION_PUBLICATION_AMBIGUOUS`.
- The downtime ceiling is enforced pre-publication with the safe abort
  (`SNAPBACK_MIGRATION_BARRIER_FAILED`, predecessor authoritative, fence
  cleared, terminal receipt); after `published-held` it no longer
  applies. Cancellation is pre-publication only and reaches `cancelled`
  with a terminal receipt. Receipts are digest-sealed journal
  projections (`migrate verify` recomputes the projection digest).

Witnesses (9): end-to-end publish/release with §4 identity rules +
replay + new-approval staleness; fence closes mutation/query/buffered
lanes and survives reopen; stale lease token; out-of-relation append;
admission refusal matrix (ceilings, timestamp floor, audience, binding,
expiry, predecessor drift); downtime-ceiling safe abort; cancellation +
exclusivity; published-held resume releases.

**Remaining (Wave 3 / the full lane):** shadow-generation strategy
(CopyTable/StageTableGeneration/RetireGeneration refuse
`SNAPBACK_MIGRATION_PROFILE_UNSUPPORTED` this wave), cross-table
CopyField, injected crash points INSIDE every durable transition (the
wave-2 witnesses cover refusal paths, manufactured mid-states, and
transaction rollback equivalence; systematic kill-point injection is the
corpus lane), the §5 expected-value/content-digest verification harness,
the 0007 grammar formalization + client handshake (the resync row is
real but typed parsing/posture behavior is the journal-events ticket),
physical cleanup in the cleanup-pending tail, and 0053 activation
obligations at publication.

**Wave 3b update (2026-07-25):** the recorded deferrals are closed —
staged-generation steps (CopyTable/StageTableGeneration/RetireGeneration)
and cross-table CopyField execute; verify is the §5 data proof; rollback
is the §6 fast republish; systematic kill-point injection covers every
happy-path transition interior. Two executor gaps found and fixed by the
injection: crash-resume between `verifying` and `published-held` replayed
the step loop into a refused transition (now journal-driven phase-skip
resume, `verifying→verifying` added to the committed relation), and the
publication-timestamp floor ignored staged CopyTable sources (now
enforced). Physical cleanup of parked generations remains behind the
cleanup-pending tail.

**Phase D closure (2026-07-25):** two tails completed. (1) The
generated-functions-against-successor check: publication refuses with
`SNAPBACK_MIGRATION_PRECONDITION_FAILED` when the serving (staged)
function set does not bind against the successor schema; witnessed both
ways, including the by-design approval-audience staleness after restaging
(`publication_refuses_a_function_set_that_does_not_bind_the_successor`).
(2) The physical cleanup tail does real work: from `released` the parked
`__retired_g*` predecessor generations and artifact-declared retired
columns drop; from `rolled-back` the orphaned staged `__g*` generations
drop; two durable cuts (`cleanup-pending` commits before physical work),
idempotent inventory-driven sweeps, reopen-time resume covering BOTH
crash interiors (a kill before the pending row commits resumes from the
terminal + garbage inventory; a kill before the closing terminal resumes
from the durable pending row), and `verify`'s receipt≡journal projection
cuts at the first terminal row since the tail extends it. Witness:
`cleanup_tail_drops_parked_generations_and_resumes_after_crash`.
