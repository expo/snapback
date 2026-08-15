# Ephemeral typing first visibility repeatedly lands 45–126 ms over a 2-second ceiling

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-simplified` (0.1.21) ·
**Systems:** Ephemeral state, Realtime transport

## Problem

The simplified lane's M3 boundary failed its only required choreography
check: typing presence became visible in the second browser 2045–2126 ms
after keystroke, against a 2000 ms ceiling, across repeated final runs
(expiry was consistently fine at ~1.3–1.85 s). The agent tried stable
declarative values, immediate imperative publish, unique connection IDs, a
1 ms ephemeral dispatch setting, disabling local live coalescing, clean
backend restarts, and focus warm-up — none produced repeatably compliant
timing. One earlier raw run passed, so the floor is near the boundary, not
far past it.

Calibration: the explicit and familiar lanes passed the same check on the
same machine, and the Convex lane observed its durable-row typing "close
enough to the two-second ceiling to feel load-sensitive." So this is not a
uniform Snapback failure — but a first-delivery latency that hovers around
2 s under modest load deserves a mechanism-level look: is there a fixed
batching/coalescing/poll interval in the ephemeral publish → fan-out →
client-apply path that sets a floor?

## Evidence

- `lanes/sol-snapback-simplified/final-report.md` ("Capability failure" —
  exact timings and the mitigation list) and `diary.md` M3.
- `lanes/sol-snapback-explicit/final-report.md`,
  `lanes/sol-snapback-familiar/final-report.md` (same check green).

## Suggested fix

Instrument the ephemeral pipeline end to end (publish accept, server
dispatch, connection flush, client apply) under a two-client harness and
publish a latency budget. If a coalescing window or timer tick dominates,
make first delivery eager and coalesce only subsequent updates.
