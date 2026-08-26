# Choreography self-test: M7 vote-switch effect not awaited (cold-start race)

**Status:** Resolved
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

## Implementation update — 2026-08-25

The choreography now waits, bounded by `ctx.timeoutMs`, for Alice's option-B
semantic selection during the live vote-switch attempt. The existing offline
assertion repeats that observation before reading its starting tally, so the
M7 segment cannot emit green merely because a different retained best-of-three
attempt passed while the switch was still unsettled. The calibration fixture
now exposes its already-contracted per-actor poll selection state; the final
authoritative `pollVotes` assertion remains exact and unchanged. This is a fix
inside `0.3.4-m8`'s existing M7 assertion semantics: no version, observation
boundary, or assertion ID changed.

Non-browser checks pass: `startup.test.mjs` 8/8, `node --check` for the
choreography and self-test, and `git diff --check`. Chromium was installed and
the required self-test was attempted twice, once with Playwright's default
headless shell and once with the full Chrome-for-Testing executable. Both
browser processes aborted during launch under the managed macOS sandbox,
before the fixture or any choreography assertion ran. The ticket therefore
remains open pending a passing browser proof on the orchestrator host. No
cold-cache README note was added because this environment produced no browser
timing from which to assess first-run latency.

## Resolution (2026-08-25)

Fix: the M7 vote-switch step now awaits the semantic selection state
(bounded by `ctx.timeoutMs`, never a fixed sleep) before its assertion and
before the segment can close, and the offline assertion re-observes that
selection — the segment's green derives from an observation it actually
waited for. No instrument version, observation boundary, or assertion IDs
changed.

Browser proof: three consecutive self-test runs of the modified
choreography on `expo-build-450b` (the Linux host whose cold first run
originally exposed the race), all PASS with the retained-state M7 voting
path green. The fix removes the host-speed dependency at the code level;
determinism no longer relies on warm caches.
