# Six `snapback-server` lib failures, visible for the first time

**Status:** Open
**Filed:** 2026-08-21
**Related:** `issues/20260821-capability-link-mint-revoke-deadlock.md`, LLP 0283 F-3

## Why these appear now

The `snapback-server` lib suite had never completed. Two independent defects
hid it:

1. The `rust-tests` gate ran `cargo test --workspace` with no
   `--no-fail-fast`, so cargo stopped at the first failing target and never
   reached this crate.
2. Once reached, `approval_gate_returns_one_pending_shape_on_bare_api_mcp_and_link_ingress`
   hung forever on the capability-link deadlock.

With the deadlock fixed the suite completes, and these six surface. They are
NOT regressions from that fix: a clean-main baseline running the same suite,
skipping only the formerly-hanging test, fails the identical six by name.
Measured unsandboxed, where loopback binds succeed — in a sandbox the count
inflates to ~134 through bind denials, which is noise, not signal.

Baseline: 458 passed / 6 failed. With the deadlock fix: 461 passed / 6 failed.

## The six

```
server::tests::authorization_neutral_stage_mispreview_still_fails_closed
server::tests::connection_registry_negotiates_exact_invalidation_v1_with_bound_authority
server::tests::detached_action_nested_mutations_reserve_rooms_off_local
server::tests::detached_action_watchdog_cancels_held_room_reservation_without_publication
server::tests::protected_room_server_fast_paths_progress_during_affected_commit
server::tests::s5_d10_production_diagnostic_inventory_cannot_drift
```

## Suspicion to check first, not to assume

Four of the six concern room reservations and authorization staging. That is
the same area `6974f80e8` ("stop routing live serving through READY-only
reservation prep") changed, and the LLP 0285 step 8 room-authority move before
it. Whether either introduced these, or whether they predate both and were
simply never observable, is UNKNOWN — the suite has never completed, so there
is no prior green to compare against.

Establish that first by running this suite at commits before `6974f80e8` and
before `8de11f06e`, skipping the hanging test, and comparing failure sets. Do
not attribute them to any commit until that comparison exists.

`s5_d10_production_diagnostic_inventory_cannot_drift` is likely an ordinary
inventory-drift red and unrelated to the other five.

## Note on measurement

Run this suite unsandboxed. Agent sandboxes deny `127.0.0.1` binds, which
turns ~128 healthy tests into failures and buries the real six.
