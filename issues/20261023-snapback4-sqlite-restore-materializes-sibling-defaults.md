# SQLite column restoration materializes absent sibling fields

Date: 2026-10-23
Status: Open
Scope: Snapback 4 SQLite dormant-column restoration
Related: LLP 3000.009.001.000 §3.5; P1-EV-1 fix round 1

Reproduction on `1875a9e77f` and the P1-EV-1 fix:

1. Release `{id, n, memo}` and write a row with memo.
2. Retire memo and add `extra: text <=100 ?` plus `count: int default 7`.
   Both new fields remain absent in raw stored rows.
3. Restore memo, keeping extra and count in the new schema.

SQLite's `store/dormant.rs` restore walk calls `materialize_optional_fields`
against the predecessor and writes the whole row. Raw storage gains
`extra = null` and `count = 7`. Postgres restores only the retained memo cell,
so both siblings remain absent. The RFC §3.5 says new defaults/optionals stay
physically absent; keep Postgres's sparse representation under that rule.
The two stores' interpreted query rows are identical because `row_image`
fills absent defaults and optionals before returning rows or constructing keys.
Owner inspection of raw storage can observe the difference.

Witnesses in `snapback4-core/tests/postgres_evolution.rs`:
`ev1_sqlite_restored_sibling_bytes` pins current SQLite behavior;
`ev1_dual_store_restored_sibling_bytes` compares the raw rows and asserts
identical interpreted query results. The public EV-1 witness also keeps the
sibling declarations in v3 and compares the complete normalized wire bytes.

Follow up in the SQLite lane: preserve physical absence during restoration
without changing row interpretation, retained-cell authority or validation.
No SQLite implementation change belongs to P1-EV-1.
