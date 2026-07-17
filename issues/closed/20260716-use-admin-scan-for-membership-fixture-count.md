# Use the admin scan path for membership-fixture row counts

**Status:** Closed
**Severity:** P1
**Systems:** RBAC, Membership privacy, Acceptance tests, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Reads — rules, not roster queries
**Marker:** build-integrity, rbac, privacy, regression

The membership-schema race fixture counted rows with a generic query whose
primary table was the raw membership roster. That read is now correctly
refused by `SNAPBACK_MEMBERSHIP_READ_PRIVATE`, but the stale test helper only
became reachable after its nominal resource-ID fixture was repaired.

**Done when:**

- Test-only row counting uses the schema-aware admin data-explorer scan rather
  than weakening or bypassing production membership-read privacy.
- The same-pair race still proves exactly one row survives the duplicate
  commit and two rows survive for distinct resources.
- The membership-schema suite and canonical proof pass.

## Resolution

Closed 2026-07-16. The fixture now reads only the `total` from
`LocalDatabase::scan_table`, the existing schema-aware admin inspection path.
Production generic membership-roster reads remain closed, while the race keeps
its exact cardinality assertions.
