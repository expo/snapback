# snapback2 Ibex drive() busy-polls at ~1kHz while fetches pending

**Status:** Resolved
**Priority:** P1
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** effects Ibex `drive()` (`wait=1ms` while `pending_fetches > 0`)

## What was reported

`drive()` busy-polls with a 1ms wait while fetches are pending — each
iteration runs drain-microtasks + snapshot + arm-timers + pump + disarm. A
30s fetch costs ~30k Hermes entrances. CPU burn and timer churn scale with
fetch latency, not work done.

## Suggested fix

- Evented wakeup for fetch completion, or a substantially larger backoff
  while blocked on network.
- Measure Hermes entrances / CPU during a long fetch before and after.

## Acceptance

- Long-fetch CPU and Hermes entrances drop by an order of magnitude with
  no behavior change; measurement recorded in the ticket.

## Resolution (2026-09-12)

Idle pumping backs off from 1ms to 40ms, resets after progress, and honors earlier JavaScript timers and the invocation deadline. The existing held-fetch test can reproduce the former 1ms strategy with SNAPBACK2_MEASURE_LEGACY_POLL=1 and choose the measurement duration with SNAPBACK2_MEASURE_SECONDS.

Measurement on the same prepared Hermes debug test executable and machine, a held fetch lasting 30 seconds, `/usr/bin/time -l`:

| Strategy | Drive loops (each enters Hermes) | User CPU | System CPU | Total CPU |
| --- | ---: | ---: | ---: | ---: |
| Former 1ms poll | 14,237 | 6.43s | 1.24s | 7.67s |
| Adaptive, 40ms maximum | 693 | 0.27s | 0.07s | 0.34s |

This is 20.5x fewer loops and 22.6x less CPU. Wall time was 30.03s after the change. The final full Hermes effects suite passed 81/81 in 6.54s, including sequential fetches, short timers, shared deadlines, and retry/discard semantics.
