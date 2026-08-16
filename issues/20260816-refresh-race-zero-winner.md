# Concurrent two-tab refresh race has no winner and fail-closed blanks both tabs

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
- the other tab — the candidate winner — fails its own call with
  `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID`: **zero caller successes**;
- the two `/auth/refresh` responses are HTTP 401 and 409; there is no
  successful refresh response;
- both tabs converge **automatically** to the same settled anonymous custody
  record with no bearer (epoch 8/revision 17 in the committed witness);
- the epoch advance is the session-to-anonymous authority transition, not a
  bearer rotation — LLP 0059 forbids a refresh rotation from advancing the
  authority epoch;
- the optional `manualRecovery` step remains on that same anonymous record;
  the later authenticated epoch 9 state is a fresh password sign-in under
  `logoutPreparation.entry`, performed only to prepare the following logout
  race.

Witness bundle:
`tests/acceptance/fixtures/browser-lane/browser-auth-bootstrap.2026-08-16.v1.json`
(`proofs[id=2].details.refresh` on each engine, including manualRecovery
snapshots).

The defect is that the gated concurrent refresh race has NO winner and the
fail-closed outcome logs both users out. LLP 0059 requires exactly one refresh
caller to succeed with a same-authority, revision-only bearer rotation and the
loser to refuse superseded. The cross-tab wiring fix is still a positive: all
four race arms now converge automatically, including this shared anonymous
blank. Pre-fix runs showed the same SUPERSEDED + CREDENTIAL_RESPONSE_INVALID
pair, so the wiring fix did not introduce the zero-winner outcome.

## Hypotheses for the implementer (verify, don't assume)

1. The 401/409 response pair suggests the candidate winner path fails either
   server-side or during request admission before any bearer rotation commits.
   Instrument the refresh handler's admission and commit boundaries to
   distinguish those cases; the witness supports no narrower claim.
2. Trace why the caller associated with the 401/409 pair surfaces
   `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID` rather than a successful
   credential response. Do not assume a successor credential existed: the
   witness records no 2xx response and no rotated session custody.

Reproduce with the harness (proof 2 runs in isolation order refresh-first)
or distill a two-context node test from
`packages/snapback-client/app-client.test.mjs`'s shared-storage fixture.

## Exit

Exactly one concurrent refresh caller succeeds with the same authenticated
user/session authority, unchanged authority epoch, and an incremented custody
revision; the loser stays typed `SNAPBACK_AUTH_REFRESH_SUPERSEDED`; both tabs
converge automatically on that rotated record; the harness's proof-2
concurrent-refresh check passes on both engines and the witness receipt goes
green.

## Claim (2026-08-16, second sitting)

The Phase-1.4 orchestration session (which filed this from its harness
evidence) is now executing the root-cause and fix, with the harness's
proof-2 rerun as acceptance; a Firefox (geckodriver) engine arm is being
added to the same harness in parallel, so the closing witness covers three
engines. Per the fleet convention this claim yields to landed code.
