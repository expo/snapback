# Choreography self-test: M7 vote-switch effect not awaited (cold-start race)

**Status:** Open
**Opened:** 2026-08-25
**Systems:** Benchmarks
**Related:** `97a5fba1c` (instrument 0.3.4-m8),
`issues/20260821-clique-instrument-observability-version-bump.md`

## Problem

First-ever execution of the `0.3.4-m8` choreography self-test on
`expo-build-450b` (Linux, Ryzen 5 3600, cold Chromium/module caches) failed
at `self-test.mjs:1029`:

```
Error: M7 calibration did not preserve idempotent one-vote-per-user state:
[["alice","m7-option-a"],["bob","m7-option-b"]]
```

while the M7 segment summary itself reported green with 2/2 assertions
passed. Expected final state is alice→`m7-option-b` (a set-state vote
switch) — alice's switch never landed in the fixture, yet the choreography
segment closed green. Two immediate warm reruns on the same host: PASS.

So the M7 vote-switch assertion does not await the switch's observable
effect before the segment ends; a slow/cold host loses the race, and worse,
the choreography can report green while the authoritative state disagrees
with what its assertion claims to have observed. On a scored lane this
class produces sporadic false reds (or false greens) in fresh-session M7.

## Wanted

Make the vote-switch step await its observable effect (the same
demonstrated-progress discipline the removed-member cutoff now uses), so
the assertion is deterministic on cold, slow hosts; assert the final
per-user state from an observation the segment actually waited for. Add a
cold-cache consideration to the self-test docs if first-run latency remains
materially different.

## Evidence

`/home/ccheever/capstone-0127-20260825/logs/choreography-self-test.log`
(first run, exit 1) and `/tmp/st-{1,2}.log` (warm PASS ×2) on
`expo-build-450b`, 2026-08-25.
