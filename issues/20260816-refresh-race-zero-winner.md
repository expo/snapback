# Concurrent two-tab refresh race yields zero winners: the winning caller's response is rejected

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 2
**Confidence:** 4
**Systems:** Auth, Client, Server, Custody, Browser
**Date:** 2026-08-16
**Governing:** LLP 0059 (exactly-one-winner transitions), LLP 0227
(credential response admission), LLP 0258 Acceptance (two-tab races)
**Found by:** the Phase 1.4 real-browser harness
(`tests/acceptance/browser-auth-bootstrap-v1.mjs`), proof 2
concurrent-refresh check, after the cross-tab convergence fix
(`issues/20260816-app-client-cross-tab-convergence-disabled.md`) isolated it
**Related:** `issues/20260815-auth-churn-backend-stall.md` (refresh-path
churn investigation), `issues/20260815-agent-lifecycle-auth-seams.md`

## Observed (real Chromium 151 AND real Safari 26.6, identical signature)

Two tabs share one IndexedDB custody record and one authenticated
principal. The harness gates two `client.auth.authRefresh()` calls so the
requests race at `/auth/refresh`:

- one tab refuses `SNAPBACK_AUTH_REFRESH_SUPERSEDED` — the correct typed
  loser;
- the other tab — the would-be winner — fails its OWN call with
  `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID`: **zero caller successes**;
- the durable custody record nevertheless ends on the rotated successor
  (authority epoch advanced by one, e.g. 7 → 8 in the witnessed run), so
  the server-side rotation committed;
- within the automatic observation window one tab remains on the stale
  pre-rotation principal; an explicit `synchronize()` in each tab converges
  both onto the rotated authenticated record.

Witness bundle:
`tests/acceptance/fixtures/browser-lane/browser-auth-bootstrap.2026-08-16.v1.json`
(`proofs[id=2].details.refresh` on each engine, including manualRecovery
snapshots).

Both failing callers blank rather than retain unsafe predecessor state,
which is itself conformant. The defect is that the race has NO winner:
LLP 0059's transition model expects exactly one caller to succeed and every
other context to observe that winner. Pre-fix runs showed the same
SUPERSEDED + CREDENTIAL_RESPONSE_INVALID pair, so this is not a regression
from the cross-tab wiring fix — the fix isolated it as the one remaining
non-convergent race.

## Hypotheses for the implementer (verify, don't assume)

1. The winner's response admission races the loser-induced cross-context
   wakeup: the loser's superseded/blank handling broadcasts, the winner's
   coordinator adopts the hint mid-admission, and the winner's own
   credential-response commit then fails against mutated local custody.
2. The server's refresh response under a simultaneously-superseded sibling
   omits or alters something the client's response validation requires.
3. A client-side admission ordering bug independent of the broadcast (the
   pre-fix runs failed the same way with wakeups disabled — which weighs
   against hypothesis 1 being the whole story).

Reproduce with the harness (proof 2 runs in isolation order refresh-first)
or distill a two-context node test from
`packages/snapback-client/app-client.test.mjs`'s shared-storage fixture.

## Exit

Exactly one concurrent refresh caller succeeds; the loser stays typed
`SNAPBACK_AUTH_REFRESH_SUPERSEDED`; both tabs converge automatically on the
rotated record; the harness's proof-2 concurrent-refresh check passes on
both engines and the witness receipt goes green.
