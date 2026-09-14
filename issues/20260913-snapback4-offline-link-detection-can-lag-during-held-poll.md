# Snapback 4: Offline link indication can lag a network cut during a held poll

Status: Open
Severity: minor
Priority: P2
Area: client responsiveness
Reported: 2026-09-13
Baseline: published `snapback4@0.2.6`; later delivery `2890a42d4bedfbd7baec85a35b25fe54f1b5aa14` inspected statically
Related: [client attribution audit](../benchmarks/runs/2026-09-13-snapback4-clique-0004/astra-grade-client-attribution.md), [resolved offline recovery probe](closed/20260913-snapback4-offline-probe-route-contract.md)

## Observed behavior

The fresh Claude Opus 5 grader for the Astra Clique build cut Playwright
context connectivity on an idle search screen. Local results appeared in 1 ms
in all three retained samples, but the offline indicator appeared after
22,071 ms, 18,512 ms, and 1,743 ms. The app renders `useLink()` directly and
does not debounce or delay that indicator. Two samples exceed 10 seconds;
separately, two grader-run harness attempts did not observe the indicator
within their 10-second observation window. Those harness executions carry the
[grade's methodology qualification](../benchmarks/runs/2026-09-13-snapback4-clique-0004/astra/grading/README.md).
The published SDK documentation states no
numeric offline-detection SLA, so this is a responsiveness limitation rather
than evidence of a violated documented latency guarantee.

This is received benchmark evidence plus static attribution, not an independent
maintainer reproduction. The evidence is retained at
`/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/grading/evidence/offline-latency.json`
(SHA-256 `1951ae8b14375f1188644abd5a65a82223f056aad0dd270cd0d9243ba9c0ab1b`).
The linked audit records the exact probe and product-source hashes.

## Likely mechanism

In 0.2.6, `local.ts` holds authenticated `GET /changes` for a default of 25
seconds and changes the link to `offline` when that request throws. The sample
latencies are consistent with the remaining time in an in-flight long poll.
No per-request network chronology was retained, so the browser/network layer
responsible for each delayed rejection remains an inference. Slow local search
and an application-owned display timer are excluded by the retained evidence.

The existing `/probe` fix covers recovery from offline to online; it does not
bound this initial detection of link loss. The later server-run invalidation
and client-seam fixes through `2890a42d4...` leave this default and transition
intact. The benchmark remains frozen to 0.2.6.

## Completion criteria

- Reproduce link loss at several offsets within an idle `/changes` poll and
  retain request start, connectivity cut, rejection, and link notification times.
- Establish and document a bounded detection contract appropriate to browser
  and native hosts; use the Clique ceiling as benchmark evidence, not an
  already-existing SDK promise.
- Verify prompt detection and authenticated recovery without false offline
  transitions on healthy idle polls, or changes to write settlement and auth
  rotation behavior.
