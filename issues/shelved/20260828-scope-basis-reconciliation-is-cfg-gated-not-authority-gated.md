# Scope-basis reconciliation is `#[cfg]`-gated rather than authority-gated

- **Status:** Open
- **Filed:** 2026-08-28
- **Area:** `crates/snapback-kernel/src/storage/auth_scope_bases.rs:62,590`
- **Found by:** codex gpt-5.6-sol (xhigh) review of the LLP 0285 §5.1 landing
- **Severity:** defense-in-depth, **not** an active production bypass

## Observation

`LocalDatabase::reconcile_auth_scope_bases` and `ServingDatabase::reconcile_auth_scope_bases`
(plus the `_with_schema` variants) are restricted with
`#[cfg(any(test, feature = "test-support"))]`. That keeps them out of an ordinary production
build, and the pending-effect approval path relies on the approving caller being unable to
rewrite `_auth_scope_bases`.

**Verified 2026-08-28:** every `features = ["test-support"]` enablement in the workspace is under
`[dev-dependencies]` (`snapback-cli`, `snapback-auth`, `snapback-engine`), so a normal
`cargo build --bin snapback` does not compile these methods in. There is no bypass today.

## Why it is still worth closing

The safety property is "the approving principal cannot write the authority classification." That
property currently rests on a **compile-time feature graph** rather than on a runtime authority
check. A future crate that legitimately needs `snapback-engine/test-support` as a real dependency
— or a feature-unification accident — would silently restore the rejected attack, with no test
failing to announce it.

## Wanted

- Either gate reconciliation on a runtime authority (deployment/activation authority), so the
  property holds regardless of the feature graph;
- or add a build-time assertion that fails if `test-support` is enabled in a
  `BUILD_DISTRIBUTION=public-package` build, so the compile-time assumption is enforced rather
  than assumed.
