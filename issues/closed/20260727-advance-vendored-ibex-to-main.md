# Advance vendored Ibex from the archived Snapback compatibility branch to main

**Status:** Closed
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 5
**Severity:** P1
**Systems:** Runtime, Security, Supply chain
**Author:** Codex, directed by Charlie Cheever
**Date:** 2026-07-27
**Related:** LLP 0009 §Harness control-plane boundary; LLP 0009 §Supply Chain and Generated Bundles; `vendor/ibex`; `issues/20260727-vendor-ibex-advance-blocked-on-compat-abi.md` on the superseded unpublished maintenance branch
**Marker:** ibex, submodule, hermes, supply-chain

Snapback main pinned Ibex `bfbc6133` from the long-lived
`eng-25006-snapback-compat` lineage and used a personal-fork submodule URL. The
pin could not move directly to `expo/ibex` main because Snapback depended on:

- a restricted constructor that preserves host bundle evaluation while
  irreversibly closing JavaScript dynamic-code compilation;
- owner-thread deadline watch/unwatch plus safe foreign-thread cancellation;
- detached-Promise rejection detection that the archived branch implemented
  through handler-reachable compatibility hooks; and
- a consumer surface mutable enough for Snapback to install and verify its
  deterministic Date/Math and Promise-constructor policies.

## Resolved 2026-07-27

The required generic consumer capabilities were upstreamed to `expo/ibex`
main, and Snapback now pins `63ad33bcb45d8a08e036108be3394a0302556e37`:

- `ex_hermes_create_no_eval` uses Hermes patch 0014's one-way VM latch,
  preserves host-selected `ex_hermes_eval`, leaves the consumer intrinsic graph
  mutable for the embedder's verified application policy, and fails closed
  against a stale Hermes artifact.
- `ex_hermes_interrupt_eval(runtime, nonce)` replaces foreign-thread
  `watchTimeLimit` calls; Snapback captures the live nonce at construction and
  clears the cancellation identity before destruction.
- Detached rejections use Ibex's native Promise checkpoint and
  `ex_hermes_take_async_failure_event`. Snapback drains rooted values after
  eval, renders them through trap-free native inspection, releases every
  handle, and fails closed on malformed, failed, or dropped publication. No
  JavaScript observer registrar or ledger is authoritative.
- The shared harness retains a sealed canonical-constructor gate around
  `Promise.prototype.then`, preventing hostile no-op child capabilities on both
  Ibex and workerd.
- `.gitmodules` now uses `https://github.com/expo/ibex.git`; the gitlink follows
  Ibex main lineage, and the Rust toolchain/lockfile advance with the vendored
  workspace.
- Upstream Ibex now enforces runtime-owner thread affinity. Snapback's blocking
  workers may change OS threads, so the former process-wide DK-4 warm pool
  cannot safely evaluate or destroy retained runtimes. It is retired in favor
  of the honestly reported `fresh-per-invocation` lifecycle; a deterministic
  cross-thread regression test covers the boundary.

Verification included the Ibex no-eval/native-checkpoint tests, generated-policy
drift and `ref-check`; Snapback's bootstrap build/launch smoke; all 30
unhandled-rejection adversarial tests; all 11 action-watchdog tests, including
foreign-thread interruption and held native-fetch cases; the fresh-runtime
thread-crossing regression and benchmark smoke; the complete Rust workspace
suite (1,358 library tests plus every integration and doc-test target); and the
repository reference/toolchain, generated-artifact/type, and package-test
inventory checks.
