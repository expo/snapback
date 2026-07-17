# Refresh the membership-schema fixture for nominal resource IDs

**Status:** Closed
**Severity:** P1
**Systems:** RBAC, Membership schema, Acceptance tests, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Declaring a membership table
**Marker:** build-integrity, rbac, regression

The direct-manifest membership acceptance fixture still declared its
`eventId` resource axis as a plain string after the runtime began enforcing
the documented `v.id(resourceTable)` nominal type. Eighteen tests therefore
stopped at `SNAPBACK_MEMBERSHIP_RESOURCE_TYPE` instead of reaching the
specific declaration and activation invariants they were intended to pin.
The app-scope `lastHolder` case also supplied a separately forbidden
`bootstrapRole`, allowing validation order to mask its intended diagnostic.

**Done when:**

- The shared resource-scoped fixture declares `eventId` as `v.id("events")`.
- Dedicated negative cases pin rejection of a plain string and a mismatched
  `v.id(...)` target.
- The app-scope `lastHolder` case contains only the invalid feature it means to
  exercise.
- The same-pair race isolates the generated unique index from an unrelated
  caller-authority witness change.
- The membership-schema suite and canonical proof pass.

## Resolution

Closed 2026-07-16. The shared fixture now carries the same nominal resource
binding as generated RBAC manifests, and the two resource-axis failure modes
have explicit acceptance coverage. The app-scope case no longer mixes two
independent manifest errors. The same-pair race now inserts a different
principal, keeping the writer's caller class stable so the test reaches the
unique index it is meant to verify. All tests therefore reach their intended
invariant.
