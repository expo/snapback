# Parallel lib tests race on SNAPBACK_ASSET_STORE via the fork egress test

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Assets, Instance forking, Testing
**Date:** 2026-08-06

## Problem

`src/instance_fork.rs`'s test
`manual_cron_and_asset_provider_paths_deny_on_a_fork` (~line 3976) sets
`SNAPBACK_ASSET_STORE=s3` process-wide with `std::env::set_var`, asserts the
fork provider-store denial, then restores the variable. There is no lock
around the mutation, and `LocalSnapback::asset_store_obj` reads the variable
at call time, so any concurrently running lib test that constructs an asset
store can observe the transient `s3` value and fail with
`SNAPBACK_ASSET_STORE_CONFIG_INVALID: the s3 store requires
SNAPBACK_ASSET_S3_ENDPOINT`.

Observed 2026-08-06 on a clean fleet checkout: `cargo test --lib asset_`
(default parallelism) failed
`local::tests::asset_finalize_publishes_end_to_end_and_is_idempotent` and
`local::tests::asset_finalize_dedups_within_the_app_and_charges_quota_twice`
with exactly that diagnostic; the same filter passes with
`--test-threads=1`. The filter matches the fork test through
"asset_provider_paths", so any asset-focused sweep can co-schedule the racer.

## Suggested fix shape

Guard every test that mutates `SNAPBACK_ASSET_STORE` (and any sibling
process-env knobs) with a shared static `Mutex`, or refactor the
provider-adapter selection point to accept an injected override in tests so
the fork denial can be asserted without touching process env.

## Related

- LLP 0158 instance forking (fork egress denial families)
- LLP 0044 asset storage pipeline
