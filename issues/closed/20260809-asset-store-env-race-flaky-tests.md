# Asset lib tests flake under parallel run: SNAPBACK_ASSET_STORE env race

**Opened:** 2026-08-09
**Found during:** LLP 0199 owner #2 slice-2 verification (broad `cargo test --lib asset` runs)

## Symptom

`cargo test --lib asset` (135 tests) fails 1–6 tests nondeterministically per
run on origin/main (measured at d9f3d4046: three consecutive runs failed 1, 4,
and 4 tests). The failing set varies; every failure carries the same
signature:

```
SNAPBACK_ASSET_STORE_CONFIG_INVALID: the s3 store requires SNAPBACK_ASSET_S3_ENDPOINT
```

Affected tests observed so far: `asset_per_principal_ceiling_refuses_structured`,
`asset_public_lane_serves_immutable_and_masks_everything_else`,
`asset_publication_records_retire_after_the_retention_window`,
`asset_on_demand_width_materializes_once_and_refuses_honestly`,
`asset_record_live_projection_refuses_bad_input_and_unrelated_commit_stays_quiet`,
`asset_record_live_projection_publishes_wakes_and_blanks_with_no_polling`,
`asset_read_decision_pins_the_empty_edge_range_so_first_attachment_moves_it`.
All pass single-threaded (`--test-threads=1`, 135/135 twice) and individually.

## Root cause

Tests in `src/instance_fork.rs` set `SNAPBACK_ASSET_STORE=s3` via
`std::env::set_var` (process-global, under `unsafe`), then restore/remove it.
Store construction in `src/local.rs` (~line 6815) reads `SNAPBACK_ASSET_STORE`
from the environment at construction time. The default cargo test harness runs
lib tests on parallel threads, so any asset test that constructs a store while
a fork test holds the env mutated sees backend `s3` without the required
`SNAPBACK_ASSET_S3_*` variables and fails store construction.

## Impact

- CI/local broad asset filters are untrustworthy at default parallelism;
  agents verifying asset-touching changes get false regressions (this
  cost a slice-2 verification round trip before the stash-baseline check
  attributed it to main).

## Fix directions (pick one)

1. Serialize the env-mutating tests and the env-reading store constructions
   behind a shared test env-lock (the repo has precedent for env discipline in
   other suites), or
2. Thread the store-backend selection through `LocalSnapback` config instead
   of a process-env read at construction time, with the env read only at
   top-level open (injectable in tests), or
3. Mark the `instance_fork` s3-backend tests to run serially
   (`--test-threads=1` shard or a serial-test harness attribute).

Option 2 is the structural fix (env reads at construction sites are the same
shape the LLP 0199 ownership work is eliminating); 1 or 3 are cheap stopgaps.

## Resolution — 2026-08-10

Fixed structurally (ticket option 2 of the 20260809 sibling): the asset
store-backend selection is captured once into LocalSnapback configuration at
the public construction boundary; store construction no longer reads process
env, and the instance_fork s3 tests inject the backend instead of mutating
SNAPBACK_ASSET_STORE. Verified: three consecutive default-parallelism
`cargo test --lib asset` runs 147/147 green, `cargo test --lib instance_fork`
green, no remaining process-env mutation of SNAPBACK_ASSET_STORE in the tree.
