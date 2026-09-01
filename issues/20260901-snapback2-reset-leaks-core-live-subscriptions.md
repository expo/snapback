# snapback2: reset leaks core live subscriptions

**Status:** Open
**Systems:** snapback2, owner, live queries, resource handling
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/writer.rs:1013-1030

Failure scenario: create N live subscriptions, call /control/reset, reconnect, and repeat. SSE senders close, but the core subscription records and invalidation indexes remain; every later reset or successor reruns all ghost subscriptions and memory/work grows without bound.

Why it happens: Runtime::reset_and_seed at snapback2/crates/snapback2-core/src/registry.rs:593-602 reruns rather than removes subscriptions. Writer then calls self.live.clear without runtime.unsubscribe for each runtime_id, bypassing the normal unsubscribe path.

Suggested fix: collect and unsubscribe all live runtime IDs before clearing writer clients, or add an atomic core clear-all operation. Add a test asserting core and writer subscription counts are both zero after reset.
