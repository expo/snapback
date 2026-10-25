# Snapback 4 difftest: six unexpected E_INPUT runtime refusals on main

**Status:** Open
**Opened:** 2026-10-25
**Area:** `crates/snapback4-difftest/tests/stores.rs` (`both_stores_all_public_boundaries_and_write_observations`)

On main `5c4716af14` (0.4.41 integration hand-off), the both-stores difftest
fails its final assertion `report.runtime_refused_unexpected.is_empty()`
(`stores.rs` ~82) with `{"E_INPUT": 6}`. Oracle agreement is otherwise clean
(`store-postgres-off/on` 808/810 passed, the remaining two named
`E_STORE_UNSUPPORTED:time-publication`, zero disagreements).

Reproduced on plain main with only that target against a private PG16
(SNAPBACK4_EVAL_POSTGRES, `cargo test -p snapback4-difftest --features
postgres --test stores`), so it predates G7.2 and is not caused by the write
pipeline. Identify the six generated cases, decide whether the refusals are
correct new behaviour (then classify them as expected in the generator) or a
regression, and fix.

Also on main: `snapback4/experiments/postgres/Cargo.lock` is stale under
`--locked` (`cargo metadata --locked` refuses), which stops the evaluator
stage of `scripts/test-postgres.sh`.
