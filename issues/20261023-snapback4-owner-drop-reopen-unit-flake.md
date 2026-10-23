# Snapback 4 ownership cleanup unit flakes in the post-main CLI batch

Status: Open
Owner: committer / release integration (outside SEC9)
Observed: 2026-10-23 after merging origin/main 46c6cdd056

The full CLI unit batch reports549 passed,1 failed,9 ignored. The failure is
`store_owner::tests::address_cleanup_preserves_replacements_and_the_ownership_sidecar`
at store_owner_tests.rs:203: immediately reacquiring after dropping the first
owner refuses E_STORE_BUSY (address pending). The exact single-test rerun passes.
This is observed nondeterminism; SEC9 does not change the ownership implementation
or weaken the exclusion assertion. No inference of a safety violation follows.

Reproduce from snapback4/: 

```sh
timeout 600s env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4 --bin snapback4
timeout 180s env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4 --bin snapback4 store_owner::tests::address_cleanup_preserves_replacements_and_the_ownership_sidecar -- --exact
```

See the SEC9 report and compressed full-batch/exact-rerun logs. Preserve the
ownership fence; do not delete live sidecars to make this green.
