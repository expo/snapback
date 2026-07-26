# 0081: closed step vocabulary + MigrationKeysetScanV1

**Status:** Closed (2026-07-26)
**Severity:** P2
**Systems:** Migrations, Storage, Codegen
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §3, LLP 0051 (value vocabulary)
**Marker:** step5-impl

Implement the closed v1 steps (CreateTable/CreateIndex, AddField,
BackfillField, ValidateRequired/MakeRequired, ValidateUnique/
CreateUniqueIndex, CopyField/CopyTable, StageTableGeneration,
RebuildMaintainedProjection, Retire*) with add/copy/validate/publish/retire
composition for renames/type changes and total-conversion preflights;
backfill expressions over the closed LLP 0051 vocabulary + explicit
constants; MigrationKeysetScanV1 with target batch/byte/time ceilings and
checkpointed cursors, without relaxing app-query limits. L-sized.

**Progress (2026-07-25, MigrationKeysetScanV1 landed):** the privileged
scan is implemented on the local target (`src/storage.rs`
`migration_keyset_scan_batch` / `migration_keyset_scan_batch_on` for the
executor's own transactions): one declared table via a declared index (or
`_id` order) in the corpus's stable total key order (`index fields ASC
NULLS LAST, _id ASC`, reusing the keyset boundary lowering), per-batch
ceilings validated against target hard caps (rows ≤ 16,384, bytes ≤ 64
MiB, millis ≤ 60,000 — every batch still progresses at least one row),
closed validator facts only (`NonNull` counts + bounded id samples;
`Unique` adjacent-duplicate counts, refused unless the field leads the
scan index so adjacency is sound), optional `ContentDigestV1` streaming
(both stages), and a serializable `MigrationKeysetScanCheckpointV1`
(committed schema `schemas/migration.keyset-scan.checkpoint.schema.json`)
that round-trips through JSON exactly as the Wave-2 journal will persist
it. Registered as the experimental `migration_keyset_scan_v1` capability
(local + remote-service; absent on Cloudflare). Refusals:
`SNAPBACK_MIGRATION_PLAN_INVALID` (shape/ceilings/mis-ordered
uniqueness), `SNAPBACK_MIGRATION_PRECONDITION_FAILED` (foreign
checkpoint). Witnesses: `migration_keyset_scan_is_batch_invariant`
(every batch size 1..=8 yields facts and sealed digests byte-identical
to one-shot), `migration_keyset_scan_refusals_and_sealing`.

**Remaining in this ticket:** the typed step vocabulary itself
(CreateTable…Retire*), backfill-expression validation, and
add/copy/validate/publish/retire composition — the Wave-1 artifact fork
owns the step TYPES; execution lands with the Wave-2 executor.

**Resolution (2026-07-25):** the scan half landed in Wave 1
(`MigrationKeysetScanV1`, resumable checkpoints, ceilings, capability);
the step vocabulary is now fully executable — Wave 2 landed the in-place
and validation steps, Wave 3b landed `StageTableGeneration`, `CopyTable`,
`RetireGeneration`, and cross-table `CopyField`. The
authority-bearing-table refusal is plan validation (Wave 1). Remaining by
design: the `hostOps:migrate` writer class for authority-bearing tables
stays future work per §3, and physical generation cleanup stays fenced
behind the cleanup-pending tail.

## Closeout (2026-07-26)

The cleanup-pending tail subsequently landed with durable, idempotent physical
generation cleanup and crash recovery. The future `hostOps:migrate` writer
class is outside the closed local v1 scope, so no work remains in this ticket.
