# P1 Snapback 2: same-account re-login leaves the offline store on the old session epoch

**Status:** Closed
**Priority:** P1
**Systems:** client authentication and offline coverage lifecycle
**Date:** 2026-09-05
**Source:** Codex local-data review; reproduced/inspected at `23e89b4a17fecb713b7ca61681cf6f4f969c8536` (product tree equal to locally tracked origin/main `11e2e60984e756128aa0091b4c6c36ff82094ecb`).
**Related:** LLP 1012 §4 (seal versus wipe), §8 (authority); issues/20260904-snapback2-fence-trust-anchor-followups.md (distinct race)

## Problem

A new login to the same principal keeps the old coverage/session auth epoch.
`reauthenticate()` unseals and loads old facts, while `loadFacts()` uses
`this.sessionEpoch ??= coverage.facts.authEpoch`. Fresh authenticated deliveries
then fail the epoch check.

Sites in `snapback2/packages/snapback2/src/offline.ts`:
`reauthenticate` at line 284, `loadFacts` at line 774, and the
`commitMany` session-epoch guard. `client.ts` opens the same partition
during `session()`.

## Real-owner reproduction

Using the existing `tests/owner-harness.ts` `RealOwnerHarness`, the checked
Quarry chat fixture, and a client configured with `offline.store: fileRangeStore(temp)`:

1. `client.auth.signup({email, password})`.
2. `client.query(api.integration.capped, {})` succeeds and records coverage.
3. `client.auth.login({email, password})` succeeds for the same account.
4. Run the same query again.

Observed:

```text
first authenticated query: capped 1
same-principal login succeeded
new-session query FAILED: E_OFFLINE_AUTHORITY delivery auth epoch does not match the authenticated session
```

No race is needed. This differs from the existing ticket about a late resume
restoring an obsolete trust anchor. The same epoch-restoration code handles
reauthentication after a sealed session expires.

## Resolution and acceptance

Establish the new epoch from authenticated server evidence and explicitly
transition/revalidate held coverage while preserving queued intents.
Unsealing old facts alone cannot establish the new session's authority.

Verify same-account re-login, seal then re-login, and cold reauthentication
against real sessions with different epochs. Fresh queries and resume must
work, old-epoch in-flight deliveries must remain fenced, and unsent writes
must survive.

## Review qualification

The package was rebuilt before verification. Existing selected client/carrier
suites passed 251/251 and Rust offline/replay/retention tests passed 37/37.
The new review reproductions expose gaps in that coverage. This ticket is
self-contained; temporary review artifacts are not required to implement it.

## Resolution — 2026-09-05

Authentication responses now carry the server's authEpoch. Same-principal
reauthentication fences old in-flight work before awaiting persistence,
transitions coverage to that epoch, and resets replay trust while preserving
held history and queued intents. Old delivery fingerprints are invalidated
for this explicit transition; same-sequence conflict detection resumes with
the next authenticated delivery. Validators still force revalidation.

Persisted principal bindings also name their authenticated token, so cold
startup cannot combine a replacement bearer with another account's history.
Real-owner regressions cover re-login, seal/re-login, cold authentication,
queued writes, and rejection of an old in-flight response.

The complete package run passed 364 tests with one existing skipped
process-control placeholder; no package tests failed. The implementation,
regressions, and guide/LLP updates ship together with this ticket closure.
