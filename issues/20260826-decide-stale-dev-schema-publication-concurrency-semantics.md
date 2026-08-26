# Decide stale dev-schema publication concurrency semantics

**Status:** open — ownership decision needed
**Date:** 2026-08-26
**Area:** schema publication; migration/transition concurrency; schema freshness
**Related:** LLP 0303, F182, `issues/20260826-stale-handle-schema-policy-sibling-survey.md`

## Measurement

Family 12 **NEEDS OWNERSHIP DECISION**. The raw dev-schema path checks compatibility against
`self.schema` at `crates/snapback-kernel/src/storage/auth_mode.rs:1621–1622`. Its transaction does
read the current mode snapshot at line 1628, but it does not require that snapshot's active manifest
to equal the handle's predecessor before publishing the supplied manifest at line 1652.

The ignored witness
`storage::auth_mode::tests::stale_predecessor_dev_schema_publication_overwrites_durable_successor`
ran this two-handle schedule against one SQLite file:

1. Handle A published `sha256:publication-predecessor`.
2. Handle B durably published `sha256:publication-successor`.
3. The test confirmed A still held the predecessor and B held the successor.
4. Stale A published `sha256:publication-stale-contender` through ordinary
   `SchemaSeedKernel::apply_schema`.
5. Fresh handle C opened the resource and read the durable active manifest.

Run:

```sh
cargo test -p snapback-kernel stale_predecessor_dev_schema_publication_overwrites_durable_successor -- --ignored --nocapture
```

The observation fired at the witness's result line, currently
`crates/snapback-kernel/src/storage/auth_mode.rs:2238`:

```text
FAMILY12_NEEDS_OWNERSHIP_DECISION: use returned Ok; observer C saw durable_hash=sha256:publication-stale-contender after B had published sha256:publication-successor
```

No error or diagnostic code fired at the stale publication. The exact durable effect was replacing
B's active successor manifest with A's contender.

## Decision required

The owner must decide whether raw v0-dev schema application is intentionally unconditional,
last-writer-wins publication, or whether each application must be compare-and-set against the
durable active manifest from which its compatibility checks were derived. If last-writer-wins is
intentional, document that contract and classify this schedule benign. If publication is meant to
reject lost updates, this is a defect and the required predecessor identity/refusal code must be
specified. This measurement does not choose or implement either policy.
