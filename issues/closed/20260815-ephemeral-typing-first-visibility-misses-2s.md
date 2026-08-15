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

## Resolution

Resolved 2026-08-15.

The local ephemeral path did not contain the hypothesized near-two-second
coalescing or polling interval. Publish mutates the room, enqueues each
subscriber's latest-state frame, and wakes its delivery notifier
synchronously; the WebSocket loop drains on that notifier. The publish HTTP
acknowledgement now carries an additive `serverDispatchedAtMs` timestamp
sampled after that fan-out/wake cut. Together with the existing publish
`serverObservedAtMs`, `Upsert.entry.received_at_ms`, socket-frame
`serverObservedAtMs`, a raw client receive timestamp, and the overlay's
`onChange('applied')` timestamp, the real two-client regression attributes the
whole path without changing its scheduling.

The final eight-sample run against the rebuilt pinned binary measured these
maxima:

| Segment | Maximum |
| --- | ---: |
| publish accept → server dispatch | 0 ms |
| server dispatch → connection flush | 0 ms |
| connection flush → client receive | 1 ms |
| client receive → overlay apply | 0 ms |
| publish accept → overlay apply | 1 ms |
| caller publish start → overlay apply (monotonic) | 1.68 ms |

The apparent 2,045–2,126 ms floor was in the frozen choreography's
observation boundary. It starts the clock, awaits a roughly 45-character
`pressSequentially(..., { delay: 25 })` action, and only after that entire
multi-key action completes begins waiting for the second browser's already
visible indicator. Its reported `visibleMs` therefore includes the synthetic
typing action and browser input/render overhead; it is not first-delivery
latency. This also explains why changing declarative values, publish style,
connection ids, `dispatchMs`, live coalescing, processes, and focus could not
move the observed floor.

[LLP 0013](../../llp/0013-ephemeral-realtime-state.rfc.md#first-delivery-latency-budget)
and the Guide now publish a 1,000 ms already-subscribed local
server-accept-to-overlay-apply regression ceiling, with 100/500/200/200 ms
diagnostic allocations and explicit measurement-boundary guidance. The
eight-sample test in
`demos/_kit/tests/regression-multiplexed-lanes.mjs` hard-fails that ceiling and
records every hop. A focused Rust test pins the additive HTTP timestamp, and
the existing L8 test still proves enqueue wakes delivery immediately.

No eager-first scheduling change was made: the measured first delivery is
already eager, and adding a speculative scheduler branch would not address
the reported number.
