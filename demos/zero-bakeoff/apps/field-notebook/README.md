# Field Notebook

This app compares retained offline reads, freshness labeling, interrupted
writes, draft custody, reconnect idempotence, logout deletion, and the
Replicache-only durable/rebase stretch. Zero and Replicache remain separate
arms: Zero tests current partial-sync behavior, while Replicache uses an
app-owned PostgreSQL push/pull service with mutation IDs and version cookies.

From the repository root:

```sh
node packages/snapback-codegen/index.mjs demos/zero-bakeoff/apps/field-notebook/snapback
SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback" node demos/zero-bakeoff/apps/field-notebook/acceptance/snapback.mjs
bun demos/zero-bakeoff/apps/field-notebook/acceptance/zero.mjs
bun demos/zero-bakeoff/apps/field-notebook/acceptance/replicache.mjs
```

The provider runners use the shared PostgreSQL receipt at
`demos/zero-bakeoff/.runtime/postgres/ready.json`, create uniquely named owned
databases, and leave the shared server running. The headless Zero and Replicache
clients use `fake-indexeddb`; receipts therefore mark cold browser-IDB and
restart durability as evidence GAPs rather than converting carrier limitations
into product failures. No hosted credentials are required.

Machine-readable receipts are in `evidence/`; the frozen checks are in
`../../protocol/acceptance/field-notebook.v1.json`.
