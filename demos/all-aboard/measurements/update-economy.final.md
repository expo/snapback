# All Aboard update-economy final receipt

- **Issue:** ENG-24188
- **Design:** LLP 0052 D1–D5
- **Status:** Web and macOS-native acceptance complete; physical-iPhone
  performance trace tracked separately in ENG-24221.
- **Raw evidence:** `update-economy.final.web.json`
- **Raw SHA-256:** `9dd4a280b56ec1f82cd53cc3e07c0cc200e6df0a3a4e456717f73a0efe3bbcfa`

## Revisions and method

The final runner mounted the real All Aboard Contract surface against an
isolated in-memory Snapback server, with clean source trees at Snapback
`ff6141df6921` and Exact `9a3a349805e2`. The surface's five Exact aliases and
their complete internal dependency closure resolve to the public `0.1.4`
release. The recorded run used headless Chrome 150.0.7871.115 on macOS arm64,
a 390 × 844 viewport at DPR 2, two seconds of settling, and a 20.25-second
post-deadline idle window. The JSON records empty dirty-state fields for both
repositories.

## D1–D5 results

| Deliverable | Final evidence | Result |
|---|---|---|
| D1 reactive host/device bindings | Eight fresh-but-value-equal scheme, inset, and geolocation transactions produced eight accepted publications but zero reactive waves, effects, recomputes, or cascade passes. A frozen-clock reader matrix independently changed scheme, insets, location, and backend state and observed every affected reader. | Pass |
| D2 deadline-driven time | A production terminal countdown changed from 9 to 8 at its declared deadline. The narrow presentation wave ran 34 terminal effects but zero app-computed recomputes and zero fresh-equal computed results; the deadline queue remained bounded at five entries. | Pass |
| D3 value-equal host skips | A deliberately repeated raw-text value recorded one attempt, one equality hit, and one skip, with zero protocol operations, bytes, or layout requests. Separate web and native conformance covers changed text and hidden-text unhide behavior. | Pass |
| D4 opt-in derive memoization | Exact conformance proves value-equal `memo` identity and keyed `memoRows` structural sharing: an equal board keeps its outer identity, while a one-row change keeps every unaffected row's identity. All Aboard uses the keyed primitive for both board composites. | Pass |
| D5 profiling and conformance | Thirty control and thirty reporter trials covered a representative 207-host-attempt commit. Control p95 was 5.0 ms; reporter p95 was 4.8 ms, for -0.2 ms measured overhead against a 1 ms allowance. Attribution, bounded history, omitted/unattributed accounting, dev-only loading, and production removal also passed their Exact profiles. | Pass |

After the scripted deadline completed, the 20.25-second idle window recorded
zero reactive waves, effects, computed recomputes, fresh-equal computed
results, renderer commits, host attempts, protocol work, layout requests, or
DOM writes. This is the key framework-level replacement for All Aboard's
former universal ticker and cache-buster seams.

The frame trace retained 2,430 intervals. Its p50 was 8.3 ms, p95 was 9.0 ms,
and maximum was 16.8 ms. The cadence-relative p95 limit was 11.205 ms; one
interval exceeded that threshold against an allowance of five. The
environment gate (p50 no more than 20 ms and at least 45 samples/s) and sparse
tail gate both passed.

## Verification scope

- Exact's full Contract profile passed 119 tests with seven declared manual
  skips and no failures. Its focused update-economy profiles covered 71
  Contract assertions, 34 DOM assertions, 105 host-operation assertions, and
  one agent assertion; TypeScript, Rust, Vite, Hermes-folding, and production
  profiler-removal gates also passed.
- All Aboard passed 34 browser behaviors, 12 headless checks, seven cron
  checks, eight real-data checks, 14 egress/config checks, and the focused
  deadline, trip-detail, helper, render-first, Contract-live, registry build,
  and source-pinned native-source suites.
- The five surface aliases installed from the public npm registry with a
  frozen lockfile and produced a registry-only production build. A separate
  cold Exact consumer installed all 13 `0.1.4` tarballs and built successfully.
- The macOS-native receipt proves redundant text produces zero native protocol
  operations, bytes, and layout requests. A separate product run rendered and
  interacted with All Aboard on a physical iPhone, but the LLP 0052 candidate
  device locked before its performance trace; ENG-24221 preserves that
  platform-specific follow-up without weakening these implementation gates.

The package-publish resume-integrity hardening discovered during release is
tracked separately as ENG-24222. It does not affect the identity or contents
of the published `0.1.4` artifacts used here.
