# `SNAPBACK_AUTH_RESERVATION_STALE` is ordinary write contention reported as HTTP 503

**Filed:** 2026-07-26 · **Source:** Partitime matrix
**Status:** open (worked around client-side)

## What happens

Snapback takes a one-shot authorization reservation before a protected write.
Two concurrent writes make one stale *before* the durable transaction, so
nothing is committed and the call is safe to re-enter. It surfaces as:

```
HTTP 503  SNAPBACK_AUTH_RESERVATION_STALE
"authorization reservation became stale before the durable transaction"
```

Measured: 12 concurrent rsvps from one session -> 1 success, 11 stale.

## Why it matters

1. **503 with no `retry-after`** reads as "server unavailable" for what is
   routine contention. Every client must special-case it or show users a
   backend-down error the first time two people click at once.
2. **It silently passes authorization tests.** The Partitime Solid cell had an
   A4 host-only check go green with the detail `authorization reservation
   became stale…` — the rule was never evaluated; a race lost. Any assertion
   of the form "assert it was rejected" cannot distinguish a rule from a race.
3. The retry must be **many short attempts**, not exponential backoff: the
   reservation behaves like a mutex with no queue, so each round yields ~1
   winner and N writers need ~N rounds. 40 writers with 8 attempts backing off
   to 500ms -> 29/40; with 40 attempts jittered 10-150ms -> 40/40.

## Suggested

- Classify it as a retryable conflict (409, or 503 **with** `retry-after`) and
  say "retry" in the message.
- Document it in `guide/backend/mutations.md` beside
  `SNAPBACK_MUTATION_CONFLICT`, including that authorization tests must assert
  the expected diagnostic code rather than mere failure.
- Consider queueing the reservation so throughput does not degrade to one
  winner per retry round.
