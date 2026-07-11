# All Aboard update-economy Phase 0

**Issue:** ENG-24189
**Design:** LLP 0052 D1–D5
**Status:** Web baseline complete; native/iPhone trace pending (the only paired
physical device was offline when this run was taken).
**Raw evidence:** `update-economy.web.raw.json`
**Raw SHA-256:** `75d5b50d378e1454e2dab54d79517bb64f67d03298566b4ffc1354e213bb838e`

## Method

The runner mounted the real All Aboard Contract surface against an isolated
memory Snapback server and source-pinned Exact. It waited for app readiness,
allowed two seconds for asynchronous host inputs to settle, loaded Exact's
development reporter lazily, forced both D3 equality flags off, reset all
counters, then observed 20.25 seconds per arm. No D1–D4 behavior was enabled.

The four arms independently select the two shipped userland mitigations:

| Arm | 5 s clock quantization | palette singleton |
|---|---:|---:|
| `pre` | no | no |
| `clock-only` | yes | no |
| `palette-only` | no | yes |
| `current` | yes | yes |

Pinned facts: Snapback `8c289e1e7bba`, Exact `2b1bd500fca3`, Chrome
150.0.7871.115 on macOS arm64, viewport 390 × 844 at DPR 2. The headless
display ran at roughly 120 Hz. The raw file retains every commit, reactive
node snapshot, cause, and frame interval; the table below is only its summary.

## Results

| Metric (20.25 s) | pre | clock only | palette only | current |
|---|---:|---:|---:|---:|
| reactive waves / renderer commits | 21 | 4 | 20 | 4 |
| computed recomputes | 357 | 68 | 340 | 68 |
| effect runs | 10,206 | 1,944 | 6,080 | 1,216 |
| host element attempts | 6,489 | 1,236 | 2,540 | 508 |
| raw-text attempts | 3,318 | 632 | 3,160 | 632 |
| same-text attempts | 3,280 | 632 | 3,122 | 632 |
| protocol ops / bytes | 3,360 / 71,373 | 640 / 13,592 | 3,200 / 67,960 | 640 / 13,592 |
| layout requests | 21 | 4 | 20 | 4 |
| DOM mirror visits | 12,117 | 2,308 | 11,540 | 2,308 |
| DOM `applyProps` calls | 6,237 | 1,188 | 2,540 | 508 |
| aggregate commit time | 198.8 ms | 36.1 ms | 111.8 ms | 26.5 ms |
| frame p95 / max | 10.0 / 25.7 ms | 9.9 / 10.4 ms | 9.9 / 16.3 ms | 9.9 / 10.4 ms |

The two mitigations compound, but they solve different layers:

- Quantization reduced waves and every per-wave cost by about 81% in this
  window (21 → 4). It does not make an active wave cheaper.
- The palette singleton reduced effect runs by 40% and DOM applies by 59% at
  the 1 Hz cadence. It did not reduce raw-text attempts, protocol traffic, or
  mirror traversal per active wave.
- Together they reduced effect runs by 88%, element attempts by 92%, protocol
  traffic by 81%, DOM applies by 92%, and aggregate commit time by 87% versus
  `pre`. Yet each remaining `current` wave still ran 304 effects, attempted
  158 identical text writes, emitted 160 protocol ops, visited 577 mirror
  nodes, and called `applyProps` 127 times.

The per-host mechanism split is therefore confirmed on web. Every one of the
8,358 element descriptions in `pre` was value-equal, but fresh palette-derived
props defeated the reference fast path and caused 6,237 live DOM writes. Raw
text was independently redundant: 3,280 of 3,318 text attempts (98.9%) were
identical, accounting for almost all of the protocol traffic. Even in the
fully mitigated `current` arm, all 508 applied element descriptions and all
632 text attempts were value-equal. The mirror still walked 577 nodes on every
commit, exactly as LLP 0052 predicted.

## Numbers fixed for the acceptance gates

- **D3:** an all-equal All Aboard `current` wave starts at 127 redundant DOM
  applies, 158 same-text attempts, 160 protocol ops (3,398 bytes), one layout
  request, and 577 mirror visits. After D3 it must produce **zero DOM applies,
  zero text ops, zero protocol ops/bytes, and zero layout requests** while
  retaining the measured traversal residual (577 visits is evidence, not a D3
  failure). Changed text still emits exactly one text op; hidden-updated text
  still emits once on unhide.
- **D1/D2:** the current mitigation still wakes app dataflow four times in
  20.25 seconds and runs 304 effects per wave. After the host/time migration,
  the same idle window must have **zero periodic app-dataflow waves**; only a
  declared logic deadline or independently injected host change may wake it.
  Presentation-only deadlines may update their terminal binding without an app
  dataflow wave.
- **D4:** the count remains semantic rather than hardware-dependent: a
  value-equal keyed `boardTrains` recompute produces **zero downstream
  re-fires**; a one-row change re-fires only that keyed row's bindings.
- **D5:** the default dev console warning threshold is fixed at **at least 100
  host attempts with at least 80% value-equal in one commit** (the measured
  `current` wave is 285 at 100%). Full reports remain available below the
  warning threshold. Phase-1 profiling may add at most **1 ms or 10% (whichever
  is larger) to p95 commit time** over the reporter-disabled dev control, keeps
  the measured frame p95 at or below 11 ms on this fixture, and adds zero eager
  production modules/counters; the Exact startup-budget gate enforces the last
  condition.

## Native evidence still required

This run deliberately does not infer native thread ownership from web. The
paired iPhone was listed by Xcode as offline. An iPhone/ExactApp run must still
capture the same four count arms plus a Time Profiler/signpost trace proving
where protocol apply, text measurement, kernel layout, and presentation run.
Simulator or macOS traces are useful regression evidence but do not replace the
physical-device performance row. Until that artifact lands, ENG-24189's web
deliverable is complete and its native trace deliverable remains open.
