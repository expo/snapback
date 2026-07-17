# Capture membership caller authority through commit

**Status:** Closed
**Severity:** P1
**Systems:** RBAC, Membership transitions, Storage, Concurrency
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Writes
**Marker:** security, concurrency

Membership transition planning authorizes against a live caller-role lookup,
but the resulting plan does not carry that lookup as a read dependency.

`plan_membership_insert` in `src/storage.rs` reads the caller's role over the
target resource and captures only the resource row. `derive_class_and_target`
does the same for `setRole`, `remove`, and `patch`; those plans capture the
target row and sometimes a protected survivor, but not the caller membership
or the absence that produced caller class `none`. Commit then trusts the
sanctioned plan after validating only the accumulated dependencies.

Alice can therefore plan an invite, promotion, removal, or patch as `host`;
Bob can remove or demote Alice; and Alice's stale privileged plan can still
commit if its target/resource facts did not change. The inverse class-change
race is also unsafe: a plan authorized as `none` can commit after that fact has
changed.

**Done when:**

- Caller-class derivation returns a captured dependency on the exact
  `(principal, resource)` membership lookup, including an empty-result witness.
- Insert, set-role, remove, and patch plans carry that dependency to the same
  commit-time validator as their target and resource reads.
- Tests exercise caller demotion/removal and absent-to-present caller rows in
  both commit orders.
- A stale plan either linearizes before the authority change or fails with a
  typed conflict; it never commits afterward under obsolete authority.

## Resolution

Closed 2026-07-16. Commit `d4fcfaf` carries exact caller membership and absence
witnesses through every membership plan into commit validation in `src/storage.rs`,
with both-order removal, demotion, and absent-to-present race tests inline.
