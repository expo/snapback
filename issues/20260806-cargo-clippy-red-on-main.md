# cargo clippy -D warnings is red on main — 26 lints in recently landed feature code

**Status:** Open
**Opened:** 2026-08-06
**Related:** scripts/verify-local-proof cargo-clippy leg

`cargo clippy --all-targets -- -D warnings` fails with 26 errors at
origin/main (b884202e1 base and after). All locations are in files the
sbsb2 series never touched: src/fork_promotion.rs (2047/2079/3201/3240),
src/operation_ledger.rs:2272, src/proof_checkpoint.rs:2101,
src/operation_detail.rs (178/280/684), src/storage.rs
(2158/2202/5365/6404/6602/6697), src/storage/migration_executor.rs
(47/954), src/local.rs:14257 — dominated by type_complexity,
too_many_arguments, needless borrows, and three never-used methods
(foreclose_branch_operation_admission, retain_committed_branch_mutation,
create_operator_in_app_branch). These trace to recently landed
fork-promotion / operation-ledger / migration work whose sessions did not
run the clippy leg; the proof chain aborts earlier on fresh checkouts
(see issues/20260806-client-bundle-metrology-red-on-main.md), which is
how it went unnoticed. Owners of those lanes should clean their lints or
add scoped allows with justification.

Filed by the sbsb2 implementation session (its own code is clippy-clean;
verified by file attribution of every error).
