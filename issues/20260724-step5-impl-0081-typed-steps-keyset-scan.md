# 0081: closed step vocabulary + MigrationKeysetScanV1

**Status:** Deferred (phase C)
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
