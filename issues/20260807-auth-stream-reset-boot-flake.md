# SNAPBACK_AUTH_STREAM_RESET flake (~50%) on fresh anonymous clients at server boot

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Auth, Server lifecycle, Client transport
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

Immediately after server start, fresh anonymous clients' first
`prepareReactBinding`/`liveQuery` fail with `SNAPBACK_AUTH_STREAM_RESET`
roughly half the time; bounded retries mask it. A boot-ordering race
(auth stream authority not yet settled when the listener admits
connections?). Cold agents read it as their own bug first — expensive.
Fix shape: gate readiness (the ready-file) on the auth stream being
admittable, or classify the refusal as retryable-with-hint.

2026-08-07 additional evidence (declarative-mutation-misroute lane): the
same boot window also surfaces as `SNAPBACK_AUTH_MODE_PENDING` (503) on
`authRequestCode` and on mutations, `SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID`
/ `SNAPBACK_AUTH_TRANSITION_FAILED` /
`SNAPBACK_AUTH_HANDSHAKE_AUTHORITY_MISMATCH` on the mint-and-exchange
sequence, and transient `SNAPBACK_AUTH_REQUIRED` (401) on mutations for
several seconds after the ready-file reports ready in sessions mode. All
are order-independent and hit JS and declarative mutations equally
(swapped-order probe runs). Strengthens the ready-file-gating fix shape:
readiness should cover auth-mode settlement, not just the listener.
