# Final write-land merge preparation

Upstream `a41c2a0d0f` merges as `4dbc981bce`. Mutation conflict resolution is byte-identical to upstream and retains committer-owned physical transactions.

Initial core library: 754 passed, 3 declared ignores, zero failures. The new grouped column-write/conditional-immutability differential passes its actual fully qualified exact-name case on SQLite, at widths 2/4/12 against serial execution and durable snapshots. Its PostgreSQL counterpart joins private qualification. The earlier short filter with --exact selected zero tests and is retained as an unsuccessful setup attempt, never counted as a pass.

Clean-source Wasm at `4dbc981bce` remains 2,415,003 raw / 737,990 gzip / 555,572 Brotli bytes; budget 738,490 (+500). Complete qualification of this shared native write-path delta follows; earlier snapshots are retained with their original bindings.
