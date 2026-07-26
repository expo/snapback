# 0081: verification proof, receipts, and generationRepublish rollback

**Status:** Closed (2026-07-26)
**Severity:** P2
**Systems:** Migrations, Storage, Deployment
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §§5-7, LLP 0072 (generationRepublish posture)
**Marker:** step5-impl

Final proof assembly (independent expected values, zero rejected rows,
schema/generation identities, no unexpected changes) and the digest-sealed
MigrationReceiptV1 as a journal projection; rollback-before-publication;
maintenance-window generationRepublish (version R restamping with the
monotonic rollback timestamp, commit-version budget reservation, retained
predecessor work reactivation, digest-sealed rollback receipt, audited
authority); reverse-plan and restore paths with irreversibility
acknowledgment; 0072 posture composition and the rehearsal binding.
L-sized.

**Resolution (2026-07-25, Wave 3b):**

- **§5 data proof landed** (`run_data_proof` in
  `src/storage/migration_executor.rs`): expected `ContentDigestV1` values
  computed independently from predecessor-derived rows plus the closed
  plan — staged `CopyTable` proofs map the pristine source through the
  field expressions; in-place proofs reconstruct the predecessor-visible
  row and re-evaluate the expressions, with writes into predecessor
  columns refused as outside the proof domain (fail-closed, never
  approximate). Logical and system streams prove §4's identity rules;
  mismatch refuses publication with
  `SNAPBACK_MIGRATION_VERIFICATION_FAILED` (witnessed by a staged-row
  tamper fixture); `RowCountMatchesSource` enforced; zero-reject rule
  recorded. `full` vs `sampled-audit` ride the receipt face, the audit
  label saying "NOT a proof" verbatim. `migrate verify` re-proves the
  receipt≡journal seal and presents the recorded at-publication proof
  (it never re-digests live post-release tables against a receipt).
- **§6 fast rollback landed** (`migrate_rollback` + CLI): available
  exactly while `published-held`; one transaction renames staged
  generations back (byte-exact republish, witnessed), clears in-place
  columns and restores system fields from the pre-migration checkpoint
  (`_snapback_migration_checkpoint`, captured at admission), allocates
  one new version `R`, appends the raw `rollback-resync` row, raises the
  retention floor, advances the storage generation (a fresh preview is
  then required — witnessed via `SNAPBACK_MIGRATION_PLAN_STALE`), and
  seals `MigrationRollbackReceiptV1` (schema-exported). Replay returns
  the sealed rollback receipt; replaying apply returns the terminal
  forward receipt; rollback after release refuses with the §6 wording.
  The rollback command runs under the original approval, which
  acknowledged the boundary by declaring `rollbackTimestampMs` (a new
  optional canonical constant; absent bytes keep old digests stable).
- **Staged-generation steps landed**: `StageTableGeneration`/`CopyTable`
  (batched, resumable, §4 system-identity rules)/`RetireGeneration`
  (logical; physical cleanup stays behind the cleanup-pending tail) and
  cross-table `CopyField` by `_id` correspondence; publication swaps
  staged tables in and parks the predecessor for the rollback window.
- **Systematic kill points landed**: a `#[cfg(test)]` panic hook inside
  every journal append simulates a crash at each durable transition's
  interior; recovery witnessed at admitted/barriered/executing(×2)/
  verifying/published-held/released/cleanup-pending with exactly-once
  effects. The injection FOUND a real Wave-2 gap — resume after a crash
  between `verifying` and `published-held` replayed the step loop into a
  refused transition — fixed by journal-driven phase-skip resume (and
  `verifying→verifying` added to the committed relation for
  re-verification). A second found gap: the publication-timestamp floor
  ignored staged `CopyTable` sources; now enforced.

**Residuals:** `generationRepublish`'s same-landing LLP 0072 posture-row
amendment (doc-side); retained-work digests over queued rows (the
`transformed` posture is spec-deferred to owning subsystems); the §5
"current generated functions execute against the successor" item and
client-facing refusal conformance (Wave 3a journal-events/handshake);
hosted arms per the deferred DO-executor ticket; the planner does not yet
attach default verification facts to derived steps — doing so changes
canonical plan bytes, an author decision.

## Closeout (2026-07-26)

The local verification, sealed receipt, fast rollback, generation republish,
staged steps, and systematic crash recovery requested here are complete.
Generated-function successor validation landed in Phase D. The remaining
items are deliberately owned by the LLP 0072 documentation posture, deferred
hosted executor, future client conformance, and an explicit canonical-plan
author decision; they are not unfinished implementation in this ticket.
