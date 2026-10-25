# Maintained activation tests use triggers rejected by managed-store admission

Status: Open
Systems: snapback4, tests, maintained columns
Author: Codex for Charlie Cheever
Date: 2026-10-24

REL affected testing found four failures in `snapback4-lang/tests/maintained_columns/activation.rs`: `activation_mirror_is_event_free_in_place_and_zero_additions_stay_unwritten`, `redefinition_zero_removal_and_readdition_preserve_other_fields`, `expired_parent_skipped_on_activation_then_swept_and_recreated_right`, and `activation_uses_host_clock_on_both_sides_of_parent_expiry`.

The tests install `no_parent_delete` / `no_expired_put` SQLite triggers on managed relation `r`. Adoption now correctly refuses them with `SNAPBACK_MANAGED_RELATION_INTERCEPTION` before the behavior under test runs. Both these test bodies and the admission guard match `origin/main`; REL changes neither. Preserve the product refusal and replace test instrumentation with an admitted test-only observation mechanism, keeping the assertions about event-free in-place mirrors, zero writes and expiry.

Reproduce: from `snapback4`, `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test -p snapback4-lang --test maintained_columns activation::`.

This is a test repair, not permission to weaken managed-store admission. Found in REL's full-crate run after merging origin/main; report logs are `/tmp/rel-lang-full.log` on the workstream host.

The affected CLI `expiry_writes` target has the same inherited conflict in `stores::refused_legacy_counter_upgrade_preserves_bytes_and_accepted_upgrade_runs_once`: its `no_counter_rebuild` trigger on `_cap_counts` is rejected by the same managed-relation guard. Preserve this test's atomic failed-upgrade/one-successful-rebuild assertions with admitted instrumentation too.

The REL final affected run also reaches the same inherited fixture issue in
`snapback4-sim/tests/adoption.rs` (`forbid_rewrite`) and
`snapback4-sim/tests/review_corrections.rs` (`no_rebuild_delete`). Both attach
foreign triggers to `r` before activation. Move these instrumentation sites to
an admitted test-support observer/fault hook together with the listed CLI and
language sites; retain the managed-relation fence.

SDK `maintained-column-adoption.test.mjs` exercises four server/device and
SQLite/wasm watch combinations. Its `zero_untouched` trigger on `r` hits the same
fence during hot activation, so each watch waits for a generation that correctly
refused adoption. Include these four fixtures in the instrumentation repair.
