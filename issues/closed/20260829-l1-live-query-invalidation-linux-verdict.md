# L1 live-query invalidation — Linux x86_64 rerun verdicts

**Status:** Closed (verdicts recorded in LLP 0317 O14; the two follow-ups are named at the end)
**Opened:** 2026-08-29
**Systems:** Live queries, Authorization invalidation, Client SDK, Benchmarks
**Source:** LLP 0317.000 lane L1; LLP 0317 row O14 (shapes a–d) and O35 live-query half;
supersedes the platform/binary caveats of the r2.4 verdict (`f3c09fcb0`)
**Harness:** `demos/_kit/tests/live-query-invalidation-e2e.mjs` at `8b332808f`

## Why a rerun was owed

The r2.4 verdict ran on macOS arm64 against a binary that was not an ancestor
of the checkout, and every shape closed `inconclusive` for that reason. LLP
0317.000 P1 asks for the reported platform (Linux x86_64) and an exact-current
binary. Running the harness there exposed a second problem first: the landed
harness could not execute shapes (a)–(c) at all. `originalSubscriptionDelivery`
destructured `frameRowsMatch = rowsMatch` before `rowsMatch` was bound, so
every caller that omitted `frameRowsMatch` threw
`Cannot access 'rowsMatch' before initialization` (`stoppedAfterShapeAControlFailure`
in the first Linux report). The bug is present at `f3c09fcb0`, so the 10/10
passes that commit reports for (a)–(c) did not come from the file it landed;
they are not reproducible from the repository. Fixed in `8b332808f`.

## Setup (P6: platform, profile, client arm)

- Host `expo-build-450b`, Linux 6.8.0-100-generic x86_64, node v24.13.1.
- Lane worktree `~/lanes/o14-linux` at `8b332808fb9121e12e2974135ffa365cddfa10ec`,
  clean tree (superproject and `vendor/ibex` both `git status` empty before the
  build — a first attempt was refused because 14 tracked fixture files under
  `vendor/ibex/**/node_modules/` had been deleted and the binary was stamped
  dirty; restored with `git -C vendor/ibex checkout -- .`).
- Binary built there by `scripts/bootstrap-ibex-runtime`: readiness receipt
  `gitCommit 8b332808fb9121e12e2974135ffa365cddfa10ec`, `gitDirty: false`,
  issued 2026-08-29T00:07:04Z; sha256
  `8b9721b0e76eb0ab6b77903b99426da0e99526aadbd61193599ad50b1c4c560f`. All 40
  spawned servers reported that identity; the report is
  `evidenceEligibleForCurrentCheckout: true`.
- Client arm: headless browser-shaped clients + React test renderer
  (`fake-indexeddb`, Web Locks custody, distinct principals and explicit
  `storagePartition`s per persona). Explicit profile. Scope limitations recorded
  by the harness: not a real browser/Metro context; source-checkout client
  packages rather than the published 0.1.29 bundle.

```sh
SNAPBACK_RUNTIME_BINARY=$HOME/lanes/o14-linux/target/debug/snapback \
  node demos/_kit/tests/live-query-invalidation-e2e.mjs --shape a,b,c,d --runs 10 \
  --report-file ~/o14-linux-results/o14-main-8b332808f-r2.json
```

Summary line: `FAIL LLP 0317.000 O14 sound live-query invalidation — 30/40`
(the 10 failures are all shape (d)'s past-ceiling arm, below).

## Verdicts, per obligation

| Shape | Reported evidence and arm | Linux result (10 fresh servers each) | Verdict |
|---|---|---|---|
| (a) child-row insert/patch woke neither the JS parent query nor a dedicated declarative subscription | `sol-snapback-explicit` `1787861040`: "headless liveQuery subscription and two-client browser probes" | 10/10 delivered on the original subscription by `live_delta`, 32–42 ms after settlement (median 33.5), distinct principals and partitions | **not reproducible** on the headless arm the lane itself used; the browser-probe half of its evidence is the outstanding arm |
| (b) same-client hook missing its own settled mutation for 3 s | `sol-snapback-familiar` `1787857038`, `manual-playwright` | 10/10 own-write delivered by `live_delta`, 30–40 ms (median 33), row absent at settlement in every run | **inconclusive → upgraded**: platform and binary now match; the reported arm is a real browser |
| (c) two-context staleness while the same-client projection updated | `sol-snapback-familiar` `1787857472`, two Playwright contexts | 10/10 for nested, list and point subscriptions on insert and on patch; nested witnessed by `authorization_invalidation` snapshot 93–144 ms (median 119) | **inconclusive → upgraded**: same as (b); browser arm outstanding |
| (d) exact 179-row silence | `grok-snapback-explicit` M3 | 10/10 delivered at exactly 179 rows | **not reproducible** at 179 on this arm |
| (d) past the implicit ceiling | harness-derived | 10/10 `O14_D_IMPLICIT_LIMIT_SILENCE_CONFIRMED`: at 1,023 rows the subscription established; the commit to 1,025 settled; a fresh unbounded query returned `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`; the server published an `authorization_invalidation` with `maxDisposition: quarantine`, no resolution and no snapshot; the client blanked the still-attached original subscription; socket continuity held | **confirmed** on Linux x86_64 — the defect `issues/20260828-live-query-implicit-limit-refusal-blanks-subscription.md` (lane L19) fixes |

Shape (c) again surfaced `SNAPBACK_AUTH_INVALIDATION_SCOPE_INVALID` callback
noise on the multiplexed connection for sibling subscriptions; every target
subscription still received its authoritative frame, so it stays a disclosed
limitation of the harness topology, not an O14 mechanism.

## What this settles and what it does not

- The general "live invalidation is unsound" reading of the matrix is not
  supported on current `main`, on the reported platform, with an exact-current
  binary: nested, same-client and cross-partition deliveries all arrive on the
  original subscription within 150 ms, ten times out of ten.
- The one live-query defect the program has confirmed is a **bound refusal
  delivered as an anonymous quarantine**, and it is confirmed on both platforms.
  It is not a matcher or fanout miss.
- Shapes (b) and (c) cannot close as terminal negatives from a headless run
  because P1 names the client arm; the real-browser arm is filed as
  `issues/20260829-o14-real-browser-arm-harness.md`, extending the LLP 0258
  browser runner. Until it runs, the O2/B3/B4 discount on the 0.1.29 familiar
  lanes stays provisional.

## Retained evidence

`~/o14-linux-results/o14-main-8b332808f-r2.{json,log}` on `expo-build-450b`
(lane worktree retained), copied to the session scratchpad. The first,
harness-crashed report (`o14-base-abcd.json`, at `6edfe7a45`) is retained
beside it as the record of the TDZ failure.
