# Successful password logins exhaust the development login quota

**Status:** Closed — author-directed removal, 2026-09-05
**Systems:** Snapback 2 identity, installed auth recipe, seed/acceptance loop
**Evidence:** Diary 0116; `benchmarks/runs/2026-09-05-snapback2-loop/run.json`

`snapback2-core/src/identity.rs` consumes a durable login attempt before
credential verification. The fixed 60-second quotas are eight globally and
three per email, including successful logins. The reduced Clique acceptance
performs three seed logins, three client logins, another logout-test login,
then two three-user seed passes. It necessarily reaches the global quota.
Throttling returns `E_AUTH_INVALID`; the builder's catch-all signup fallback
then reports `E_AUTH_EMAIL_TAKEN` for an existing account. This is a code-and-
sequence diagnosis; the live throttle counters were not captured.

Make ordinary legitimate development reruns practical while retaining
password-guess protection. Give actionable retry guidance without revealing
account existence, and teach seeds to distinguish failed login from missing
fixture setup. Verify repeated three-user seed/acceptance runs and unchanged
rejection of abusive invalid-password attempts. Do not merely delete throttling.

The builder also misimplemented token-store adapters; those errors are separate.
The quota lives in `_auth_throttle`, so restarting an owner is not a reliable
reset. No throttle policy was changed as part of benchmark preparation.

## Resolution — 2026-09-05

The author explicitly chose to remove all login throttling now and revisit it
later, superseding the proposed retention of throttling above. Removed the
global and per-email buckets, their counter writes, and the store requirement.
The regression runs four consecutive three-user login/logout rounds at one
instant, verifies invalid credentials still fail through password verification,
and logs in again after reopening the store. The installed auth recipe and
LLP 1001 record the current behavior.
