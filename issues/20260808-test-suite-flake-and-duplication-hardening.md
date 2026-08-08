# Test-suite hardening: absolute-latency ceilings, vacuous-pass windows, duplicated spawn harness

**Opened:** 2026-08-08 · **Severity:** P2 (CI flake sources + coverage that can silently pass) · **Area:** tests

Grouped test-quality findings. None is a product defect; all reduce the suite's
signal on a loaded proof host / concurrent fleet.

## Red-flake: absolute wall-clock ceilings inside contention/spawn tests

- `tests/concurrency_v0.rs:827, 836` (`< 250ms`; same class 277, 295, 614, 636,
  683, 708 at `< 500ms`) — asserted while the test spawns hot publisher threads.
- `tests/network_profile_v1.rs:146, 172` (`< 220ms` / `< 100ms`) against a
  separately spawned `snapback` process.
- `tests/action_watchdog_v0.rs:745, 968, 1227` (`elapsed < 1500ms`);
  `tests/instance_fork_cli_v1.rs:2331, 949, 2131` (1.5 s expiry margins + flat
  500 ms cleanup grace).

On a debug build under a loaded host these red without a defect. *Fix:* compare
against a measured baseline (ratio/delta), not absolute ms.

## Vacuous-pass windows (assertions that can pass without exercising the property)

- `tests/concurrency_v0.rs:821` — a `thread::sleep(50)` is the only "heat up"
  sync; on a slow host the non-blocking property is asserted against no
  contention. Gate "heated" on an observed publish counter.
- `tests/action_watchdog_v0.rs:974` — asserts a late write is *absent* after a
  fixed 1300 ms sleep; if the abandoned VM thread hasn't finished its ~1600 ms
  busy loop yet, the guard-broken case still passes green. Have the handler
  signal that the late write was attempted and poll for it before asserting
  absence.

## Capability tests skip silently green when the capability is absent

`tests/workerd_twin_v0.rs:259-266` guards all 31 twin-parity tests behind
`detect_workerd_binary().is_none()` → `return`;
`tests/instance_fork_disk_pressure_v1.rs:62` and `tests/ibex_bootstrap_v0.mjs:76`
similarly. On a checkout without a completed `npm install` (or on macOS CI for
the RAM-disk test) the corpus vanishes while `cargo test` stays green; nothing
asserts "N cases actually ran." *Fix:* emit a machine-readable skip receipt and
have one gate assert twin-executed count > 0 where workerd is expected (mirror
the capability-maturity pattern).

## Duplicated spawn/child-guard harness across ≥7 integration binaries

`tests/admin_reachability_v0.rs:30`, `admin_tailscale_v0.rs:33`,
`shutdown_wal_checkpoint_v0.rs:219`, `config_set_cli_v0.rs`,
`admin_claim_link_v0.rs`, `network_profile_v1.rs:575`, `host_ops_v0.rs:24` each
carry a near-identical (and already drifted) `struct Server`/`Drop`/
`start_server`. A fix to one (e.g. the stderr-reader join) doesn't propagate.
*Fix:* one shared dev-support module (small path dev-dependency crate or
`#[path]`-included common file) for spawn/ready/guard/token helpers. Advertise
`route_policy_v1.rs`'s registry-equality trick as the house pattern while at it.

## Confidence

High on the flake/duplication mechanics; medium on the vacuous-pass windows
(load-dependent). The proof runs `cargo test --test-threads 4`, so these bite
under exactly the concurrency the repo already operates in.

## Current complete-proof reds (2026-08-08)

The pinned Node 24 complete proof exposed four more test-maintenance failures
whose underlying behavior completed successfully:

- `packages/snapback-vite/package.test.mjs:414` passes its behavioral assertions
  and then fails cleanup with `ENOTEMPTY` while recursively removing its temp
  directory. Cleanup needs a bounded retry/child-quiescence barrier.
- `cloudflare/test/local-suite.mjs` expects the literal completion sentinel
  `cloudflare rqs acceptance: 39/39 checks passed`, while the child now correctly
  reports `42/42`; derive the count from a receipt or suite registry instead of
  pinning a duplicate magic number.
- `server::tests::s5_d10_production_diagnostic_inventory_cannot_drift` is stale
  for three new diagnostics:
  `SNAPBACK_MUTATION_SETTLEMENT_UNAVAILABLE`,
  `SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS`, and
  `SNAPBACK_SHUTDOWN_WAL_CHECKPOINT_INCOMPLETE`. Classify them in the reviewed
  HTTP table (or remove them if they are not intended production diagnostics).
- `tests/drift_prone_gates_v0.mjs:391` expects `9 of 14 registered gates`, but
  the registry now contains 16. Assert the selected tier from the registry
  rather than duplicating the total.

These four failures currently make `scripts/verify-local-proof --complete
--keep-going` red independently of the product defects elsewhere in the proof.
