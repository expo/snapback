# PQ round 3 failure ledger

## Required full run

The full client stage has reported two failures, both **ours**:

1. `every delivery await is explicitly classified`: moving local expiry backoff
   out of the active attempt removed one await. The reviewed whole-SDK fingerprint
   was stale. Updated only `local.ts` (160 → 159 total awaits). The 158 classified
   delivery sites and their fault recipes are unchanged. This also caused the
   expanded affected run's sole failure (915/916). The corrected full delivery
   matrix plus Grok regressions passes 332/332 in `grok-final.log`.
2. `expired server replies: close watch, keep=true`: a callback from a cancelled
   delayed retry still enqueued work if delivered after cancellation. The unchanged
   full file reproduced it (`expired-watch-followup.log`, 11 pass / 1 fail).
   `ReadWork.retry` now checks the current timer identity before scheduling.
   Final per-row plus that entire unchanged file passes 94/94 in
   `retry-close-final.log`. A separate removal control detects the callback fence.

Exact full-run summary, exit 1:

```text
== 1 failure(s) in 1255 s
   client tests
```

Main client group: 4,599 pass / two fail / ten declared skips. All separate
client shards and all other phases pass, including 79/79 models. No baseline
or environmental exemption applies to either failure. No second full run.

## Test-authoring and control setup — ours

- The first presence control survived: held expiry changed the target snapshot,
  so the existing presence snapshot fence masked the missing floor check.
  Changed the probe to expire a matching policy peer and preserve the target.
- That fixture's first revision left the target's own raw deadline at D. All six
  presence cases failed the `resetVersion === 0` assertion because the real sweep
  correctly expired it (`presence-fixture-error.log`). Give the newer target
  answer its own later deadline. The unchanged product passes all 35 regression
  cases after that fixture correction (`regressions-final.log`).
- The first local abort-guard mutation survived: `postForCaller`'s independent
  abort waiter resolved before the adapter rejection reached `sendPost.catch`.
  The adapter now consumes the abort event and reports cancellation by rejecting,
  exercising the catch branch explicitly. Both local cases then detect guard
  removal, while passing with the guard present. `controls-initial.log` retains
  the earlier surviving local mutation. No production change was needed.
- Control harness setup initially used a repository-root output path while its
  working directory was already `snapback4/`, then assumed the wrong generated
  indentation, then formed an invalid whitespace regexp. Corrected the path and
  used escaped tokens joined by `\s+`. These were harness failures, not SDK runs.
- The first two awaited-backoff controls hung at fake-time polling/cleanup and
  hit the harness's 60-second limit. The fixture now pumps zero-time queue turns
  against a bounded host clock and advances cleanup timers. Both controls fail
  at the intended ninth-reader assertion, and the unmutated tests pass. No
  production or qualification timeout was increased.
- Read-only lookups used stale names for the episode LLP, deadline helper, clock
  test, and local client test. Correct paths supplied the context. The optional
  machine-fleet file is absent on this Linux host; checks use this existing lane's
  installed tools and artifacts. No tools were installed or shared paths changed.

## Expected detecting controls — ours, deliberately broken isolated copies

| Removed behavior | Failing cases | Assertion |
|---|---:|---|
| queued `keep: false` transition | 2 | notification before queue service |
| queued final floor check | 6 | withdrawn deadline never returns |
| presence final floor check | 6 | withdrawn deadline never returns |
| online abort diagnostic guard | 1 | diagnostic remains ECONNREFUSED |
| local abort diagnostic guard | 2 | diagnostic remains ECONNREFUSED |
| online due-result supersession check | 3 | newer answer survives synthetic loading |
| local due-result supersession check | 6 | newer answer survives synthetic loading |
| move retry delay back inside the active attempt | 2 | ninth read runs before backoff |
| online accept-time floor check | 3 | no deadline installation |
| delayed retry cancellation | 1 | closed retry never runs |
| invalidation replacing delayed retry | 1 | old delayed work never runs |
| stale timer callback identity check | 1 | close watch stops expiry retries |

`controls.py` copies the built SDK inside this worktree and runs each mutation
separately. `controls.log` and individual logs retain the results. No mutation
changes the production checkout or the full suite's inputs. These failures are
counterfactual evidence, not unexplained product-test failures.
