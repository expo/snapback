# Expected negative control

The real regression source was copied to ignored `target/pf/negative/`; the
production source and running suite were unchanged. The copy's `measured`
helper executes this extra SQL statement after enabling its statement census
and before the unchanged engine query:

```sql
SELECT SUM(length(data)) FROM r
```

This intentionally adds an unmetered linear walk while preserving all query
answers and caller counters. Both copied tests fail their zero-fullscan assertion immediately: 124
fullscan steps in Insights and 1,110 in search (also 1,110 with overlap). The ordinary regression target passes.
This verifies that the SQL complexity assertions detect a storage walk which
caller-meter assertions alone would miss. It does not simulate a B-tree level
transition or claim that the remaining midpoint timing failures are fixed.

Command:

```sh
CARGO_TARGET_DIR=$PWD/snapback4/target CARGO_BUILD_JOBS=4 cargo test --offline --manifest-path target/pf/negative/Cargo.toml --test linear_work -- --nocapture
```

Expected result: `0 passed; 2 failed`. Full output is in `negative-control.log.gz`.
