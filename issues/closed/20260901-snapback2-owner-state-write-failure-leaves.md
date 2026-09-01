# snapback2: owner-state write failure leaves a half-applied successor

**Status:** Closed
**Resolution:** Successor apply now performs channel/live rebind and effect wake before owner-state publication, reports applied+activeGeneration on publication failure, and fatally stops instead of serving half-applied in snapback2/crates/snapback2/src/{writer,watch}.rs; an injected owner-path failure integration test was added.
**Systems:** snapback2, owner, successors, lifecycle
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/writer.rs:980-1005

Failure scenario: .snapback/build remains writable but the .snapback directory loses write permission. A valid successor commits to SQLite and replaces self.compiled; publish_owner then fails. The watcher records the generation as refused and skips live reruns/effect wakeups even though new API calls execute the successor.

Why it happens: the fallible owner.json publication occurs after the semantic transition but before phase=ready, rerun_live, and wake_effects. Any returned error is interpreted by the watcher as a non-applied refusal, and the committed transition cannot be rolled back.

Suggested fix: stage all fallible metadata before the semantic transition, or treat post-apply publication failure as fatal while still completing required rebind/wake work and reporting the actual active generation. Add an injected owner-write failure test.
