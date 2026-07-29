# Official documentation consulted

- [CLI and local server](https://spacetimedb.com/docs/cli/) — installation, version selection, local standalone operation, publish, generate, logs, and delete workflow.
- [Tables and indexes](https://spacetimedb.com/docs/tables/indexes/) — B-tree and direct indexes used for issue filters and the migrated `customerImpact` field.
- [Views](https://spacetimedb.com/docs/views/) — caller-dependent public views over private source tables.
- [Table access](https://spacetimedb.com/docs/tables/#table-access) — private-table access and subscription boundaries.
- [Schema migrations](https://spacetimedb.com/docs/modules/schema-migrations/) — compatible trailing defaulted-column and index migration.
- [SQL](https://spacetimedb.com/docs/sql/) — authoritative post-publish count probes.

No source above was used to claim native full-text indexing, provider-backed persistent offline storage, or an offline mutation queue. Those are explicit GAPs in this arm.
