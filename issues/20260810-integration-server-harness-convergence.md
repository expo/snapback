# Converge integration server/child guards around shared lifecycle primitives

**Status:** Open
**Impact:** 2
**Urgency:** 1
**Ease:** 2
**Confidence:** 4
**Systems:** Testing, CLI lifecycle
**Date:** 2026-08-10

## Problem

At least seven integration binaries retain locally implemented server spawn,
readiness, output-custody, and child teardown helpers. The Slice G2 audit found
that these are no longer one mechanically extractable struct: some use Tokio
`kill_on_drop`, others synchronous `Child`; some require captured output or a
reader thread, some graceful authenticated `snapback stop`, and some immediate
kill; ready descriptors range from raw JSON to validated typed descriptors.

A broad extraction inside a flake-hardening slice would either erase those
ownership differences or force unrelated suites through a large migration.

## Resolution criteria

- Define small composable primitives for ready-file polling, early-exit output
  capture, and explicit teardown policy rather than one least-common-denominator
  `Server` wrapper.
- Migrate the cited suites incrementally with unchanged behavioral counts.
- Make the route-policy registry-equality assertion the documented house
  pattern wherever a helper represents a closed route inventory.
- Preserve synchronous/Tokio and graceful/forced teardown as explicit types or
  options whose ownership is visible at the call site.

## Related

- `issues/closed/20260808-test-suite-flake-and-duplication-hardening.md`
- `crates/snapback/tests/admin_reachability_v0.rs`
- `crates/snapback/tests/admin_tailscale_v0.rs`
- `crates/snapback/tests/shutdown_wal_checkpoint_v0.rs`
- `crates/snapback/tests/config_set_cli_v0.rs`
- `crates/snapback/tests/admin_claim_link_v0.rs`
- `crates/snapback/tests/network_profile_v1.rs`
- `crates/snapback/tests/host_ops_v0.rs`
