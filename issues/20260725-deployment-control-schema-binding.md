# No gate binds `deployment-control.mjs` closed-key lists to the exported schemas

**Status:** Open
**Severity:** P3
**Systems:** Deployment, Control plane, CI
**Author:** Claude (Opus 5), directed by Charlie Cheever
**Date:** 2026-07-25
**Related:** LLP 0072; PR #4 (`984b6a06`); `src/deploy.rs`, `schemas/*.schema.json`,
`packages/snapback-cli/deployment-control.mjs`
**Marker:** deployment, schema-drift, ci-gate

This tranche landed the trusted single-tenant control plane as two artifacts
that describe the same wire objects and are not connected to each other:

- `src/deploy.rs` (1,543 lines of serde/schemars types) is the schema
  authority. `src/schema_export.rs` derives roughly twenty new
  `schemas/*.schema.json` files from it, and `tests/artifact_schemas_v0.rs`
  checks the Rust types against the checked-in schema files.
- `packages/snapback-cli/deployment-control.mjs` (3,638 lines) is the only
  runtime implementation. It validates every artifact against roughly thirty
  hand-maintained closed-key constant arrays — `TARGET_KEYS`, `PLAN_KEYS`,
  `BACKUP_PLAN_KEYS`, `ROLLBACK_PLAN_KEYS`, `RESTORE_PLAN_KEYS`,
  `AUDIT_EVENT_KEYS`, `REMOTE_DRILL_PLAN_KEYS`, `MAINTENANCE_RECEIPT_KEYS`,
  and the rest.

Nothing in `packages/snapback-cli/` reads `schemas/` — the CLI's own
`package.test.mjs` contains zero references to any `.schema.json`. So the Rust
side is gated against the schemas and the JS side is gated against nothing.
Adding a field to `src/deploy.rs` regenerates the schema and passes CI while
`deployment-control.mjs` continues to reject the new field as "unexpected", and
the reverse drift is equally invisible.

**This is drift prevention, not a live defect.** I diffed eight of the closed
key lists against their exported schema property sets and found zero
divergence today:

    TARGET_KEYS               jsOnly=[] schemaOnly=[]
    PLAN_KEYS                 jsOnly=[] schemaOnly=[]
    BACKUP_PLAN_KEYS          jsOnly=[] schemaOnly=[]
    ROLLBACK_PLAN_KEYS        jsOnly=[] schemaOnly=[]
    RESTORE_PLAN_KEYS         jsOnly=[] schemaOnly=[]
    AUDIT_EVENT_KEYS          jsOnly=[] schemaOnly=[]
    REMOTE_DRILL_PLAN_KEYS    jsOnly=[] schemaOnly=[]
    MAINTENANCE_RECEIPT_KEYS  jsOnly=[] schemaOnly=[]

The two artifacts agree because one author wrote both in one pass. Nothing
keeps them agreeing.

## Proposed fix

Add a check that walks the pairs (JS constant name, schema file) and asserts the
key sets match, run from the CLI package test or `scripts/verify-local-proof`.
Roughly the diff harness above, promoted into a gate with the pair table
declared explicitly so a new artifact type must register itself.
