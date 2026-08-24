# Activity presence: volatile value thunks defeat dedup and storm the wire at keystroke rates

**Status:** Resolved
**Opened:** 2026-08-24
**Resolved:** 2026-08-24
**Systems:** React/Expo, Ephemeral state, Diagnostics, Guide
**Related:** LLP 0257 (Implemented; names this failure mode), LLP 0306
(chip-away D24, idea 10), `guide/recipes/activity-presence.md`

## Problem

`useSnapbackActivityPresence` is designed for per-keystroke `touch()`: the
provider treats an unchanged canonical value/TTL pair as a local no-op
(`packages/snapback-react/implementation.mjs:3182`), idle-delete withdrawal
ships (`:5927`), and the guide already teaches the composer shape
(touch-on-keystroke, withdraw-on-send). But when the presence `value` thunk
contains anything volatile (timestamp, counter, draft text), every keystroke
becomes a real wire publish, which ends in rate refusal surfacing as a
`publish-error` suspension. LLP 0257 documents exactly this trap
(`llp/0257-activity-scoped-presence-convenience.rfc.md:175-179`) — and the
published-0.1.25 Clique pair still fell into it, spending part of Familiar
M3's 3,015s rewriting presence before finding the memoization fix.

There is no time-based coalescing option and no diagnostic that names the
volatile value when the storm happens; the agent sees only the rate refusal.

## Wanted

Small, in this order of value:

1. **A dev diagnostic that names the cause.** When the provider observes N
   consecutive *changed*-value publishes for the same presence key within a
   short window, emit a dev-diagnostics warning (LLP 0219 channel) naming
   the key and saying the value thunk appears volatile, with the memoize/
   bound-value repair. This converts a 50-minute bisection into a one-line
   fix.
2. **Guide callout.** The activity-presence recipe gains an explicit
   "volatile values defeat the no-op dedup" warning with a before/after
   snippet (LLP 0257's language, surfaced where agents actually look).
3. **Optional leading-edge coalescing** (`coalesceMs` or similar) on the
   hook, for callers whose value legitimately changes per keystroke. This is
   the only part with API surface; skip it if 1–2 prove sufficient, and rule
   it through LLP 0257's owner if taken.

## Acceptance

- A composer publishing a volatile value at keystroke rate produces the
  named dev diagnostic before (or instead of) the rate-refusal suspension.
- The recipe page teaches the trap and the repair; retrieval-eval covers
  "presence rate limit", "typing indicator too many publishes".
- If (3) is taken: coalesced publishes keep last-writer-wins semantics and
  the idle-delete deadline unchanged.

## Resolution

Items 1–2 landed. In positively identified development builds the React
provider emits `SNAPBACK_REACT_PRESENCE_VALUE_CHURN` after the configured
number of actual changed-value publishes for one generated presence key in
the short window. The event omits scope and presence payloads, names the key,
and points to the stable bound-value repair. Initial publishes, content-equal
no-ops, heartbeats, and superseded intents do not advance it. The activity
presence recipe now carries exact before/after snippets and retrieval cases
95–96.

Item 3 was deliberately not taken: this lane was limited to items 1–2, and
the diagnostic plus documented stable-value repair address the observed
failure without adding hook API surface.
