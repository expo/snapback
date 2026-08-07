# Remediation schema lacked an explicit external-owner inventory entry

**Status:** Resolved
**Opened:** 2026-08-06
**Resolved:** 2026-08-06
**Systems:** Rust schemas, generated inventories, local proof

After the originally reported Rust unit failure was repaired, the full gate
reached `artifact_schemas_v0::dk7_every_artifact_has_a_committed_schema_file`
and found `schemas/remediation-kinds.v0.schema.json` in the committed directory
but absent from the current generator inventory. A first schemagen pass then
removed it as stale, exposing the paired
`remediation_registry_v0` tests that intentionally consume this data-only
draft. This reproduced in isolation and was repository ownership drift, not a
toolchain or checkout artifact.

## Resolution

`schema_export::EXTERNALLY_MANAGED_SCHEMA_ARTIFACTS` now names the remediation
schema alongside the other non-Rust-owned schemas. The file remains committed,
its registry safety tests remain meaningful, and schemagen now preserves it
while still rejecting genuinely orphaned output. A clean schemagen rerun left
all schema bytes unchanged; both `artifact_schemas_v0` and
`remediation_registry_v0` are acceptance checks for the reconciled ownership.
