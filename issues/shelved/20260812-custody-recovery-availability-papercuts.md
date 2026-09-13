# Custody recovery follow-ups: probe latency on ordinary expiry + two availability papercuts

**Status:** Open
**Severity:** P4
**Systems:** snapback-client auth, auth coordinator
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-12
**Related:** issues/closed/20260812-no-recovery-path-for-unrecognized-session-custody.md; LLP 0059#unrecognized-authority-recovery

Non-blocking findings from the adversarial review of the unrecognized-session
custody recovery landing (all custody-safety claims were confirmed; these are
latency/availability papercuts, none affect the security predicate):

1. **Extra bearerless probe on every terminal `carrier` refusal.** Ordinary
   session expiry now issues one additional bearerless `GET /auth/session`
   probe before the terminal error surfaces (sender-transport request count
   17→18, asserted). One extra round-trip on expiry surfacing; bounded, but a
   change to a hot pre-existing flow. Consider gating the warm-path probe on
   codes that plausibly indicate unrecognized custody if the traffic matters.
2. **Missed-recovery race (fails safe).** The shared
   `__unrecognizedAuthorityRecovery` witness slot can be cleared by a second
   concurrent synchronize entrant before the first consumes it; the wedge then
   persists until the next attempt instead of recovering immediately.
3. **Warm-path STALE skips the bounded retry.** A
   `SNAPBACK_CLIENT_AUTHORITY_STALE` thrown from the warm-path recovery's
   capture-scoped `transition()` propagates out of the catch instead of taking
   the one bounded `retry: false` re-entry, so the caller sees STALE where one
   more retry would likely succeed.
4. **Documented server invariant to keep true.** The recovery predicate rests
   on incarnation rotation implying session discontinuity (LLP 0059 amendment
   pins it). Any future server change that rotates
   `auth_stream_incarnation_v1` while old bearers stay valid would let an
   induced 401 plus a legitimate rotation downgrade custody — keep that
   invariant load-bearing in review.
