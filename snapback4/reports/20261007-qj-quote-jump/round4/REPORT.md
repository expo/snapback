# QJ round 4 — span calibration and brief-restart rejection

2026-10-07 · eb1000 · `sb4-intent/qj-quote-jump` · no push.
Parent: `6a914596d31efa99011bb81b9f323f56a4370cb6`.

Read Astra's round-3 READY review and Grok's READY WITH CHANGES review, especially
§2 and its `negative-blink-restart.log`. This round changes test precision and
its documentation. **Product behavior and the 1800 ms constant are unchanged.**
`product-unchanged.json` records the parent and matching hashes for the starter's
TypeScript/TSX/Quarry files. The earlier OA merge, editable-key guard, ownership
rules and scrolling algorithm remain intact.

## Measurement

Both distant and already-visible targets now require a **1,700–2,300 ms span**
from first highlight on to final off. Summed on-time has an independent **2,300 ms
cap**. The initial layout gap contributes to the span but is still excluded from
illuminated time; it no longer consumes the lower-bound tolerance. In the three
unthrottled runs, distant spans were **1,802.4–1,804.6 ms**, while actual on-time
was **1,709.0–1,713.6 ms**. This moves the lower-bound margin from about 9 ms to
about 102 ms for the closest observed case, without extending the product timer.

Span and sum alone cannot reject a brief restart within their caps. The test
therefore records the hook's actual `highlightUntil` timestamp in a test hook
inserted **only into the disposable generated app**, immediately after that
deadline is assigned. This observation does not change the timer or rendering.
Using first DOM on plus 1800 ms would shift the expiry by render delay; the
recorded deadline avoids that ambiguity. It classifies transitions only; the
independent span/on-time bounds still reject an incorrect deadline.

The observer retains actual color on/off transitions until settling ends and
the highlight is off, as in round 3. It locates the first off transition at or
after the recorded expiry and rejects **every subsequent on transition**.
Pre-expiry layout gaps remain allowed. The assertion also requires a finite
deadline and an observed expiry-time off, so missing instrumentation cannot
silently pass. All timing comes from browser `performance.now()`; arrival and
failure bounds, state-based driver waits and hang guards are unchanged.

`blink-restart` reproduces Grok's mutation in the generated hook: turn the
highlight back on only during `(highlightUntil + 40, highlightUntil + 240)`.
The source fixture and all assertions are otherwise the same as the positive
runs. `run-controls.py` requires exit 1 with `highlight restarted after expiry`,
distinguishing this rejection from an upper-cap failure.

## Mutation proof

All **nine controls exit 1 for their intended assertions**, including with the
2.3-second driver delay. `negative-results.json` records the runner's checks;
each complete run is retained in `negative-<mutation>.log.gz`.

| Generated-only mutation | Rejection |
| --- | --- |
| `timeout-8s` | Failure notice outside 3,900–4,500 ms |
| `highlight-100ms` | Highlight span below 1,700 ms |
| `astra-both` | Both the failure deadline and short span fail |
| `arrival-8s` | Viewport arrival exceeds 2,000 ms |
| `list-only-keys` | Body-key cancellation allows unwanted correction |
| `short-far-highlight` | Distant highlight span below 1,700 ms |
| `late-highlight` | Span/on-time caps exceeded |
| `blink-restart` | On transitions after the first expiry-time off |
| `editable-keys-cancel` | Editing incorrectly cancels scroll ownership |

The brief blink fails the new assertion in **all four measured cases**:

| Target / tier | Summed on-time | Span | New assertion |
| --- | --- | --- | --- |
| Distant / online | 1,979.2 ms | 2,098.0 ms | restart rejected |
| Visible / online | 2,078.5 ms | 2,087.3 ms | restart rejected |
| Distant / replica | 1,909.0 ms | 2,100.3 ms | restart rejected |
| Visible / replica | 2,078.8 ms | 2,087.4 ms | restart rejected |

Each sum and span remains below 2,300 ms; rejection is specifically for the
restart, not for a long duration. These deliberate reds establish test
sensitivity and are separate from positive qualification.

## Positive qualification

| Check | Result | Evidence |
| --- | --- | --- |
| Social starter, social browser and quote browser | **79/79**, zero failures/skips | `affected.log.gz` |
| Additional ordinary quote run | **38/38** | `quote-run2.log.gz` |
| Quote run, 2.3-second driver delay | **38/38** | `quote-driver-delay.log.gz` |
| Same delay plus 6× Chromium CPU throttle | **38/38** | `quote-cpu6.log.gz` |
| Guide | **113/113** | `guide.log.gz` |
| Workspace build and client typecheck | passed | `build.log.gz`, `client-typecheck.log.gz` |
| Docs budget and executable first-screen check | passed, README **300/300** | `docs-budget.log.gz` |
| Wasm and generated bindings | all four baseline hashes unchanged | `wasm-unchanged.txt` |

Four complete positive quote runs include the affected batch. All retain
viewport, draft, editable-target, body-key cancellation and late-layout checks.
No scenario or work count was reduced. The timing measurements are fixture
observations, not a latency guarantee for every device or network.

Run from `snapback4/` (all Node checks used `taskset -c 48-71`):

```sh
node --test packages/snapback4/test/{social-starter,social-browser,social-quote-jump-browser}.test.mjs
node --test packages/snapback4/test/social-quote-jump-browser.test.mjs
QJ_DRIVER_DELAY_MS=2300 node --test packages/snapback4/test/social-quote-jump-browser.test.mjs
QJ_DRIVER_DELAY_MS=2300 QJ_CPU_RATE=6 node --test packages/snapback4/test/social-quote-jump-browser.test.mjs
python3 reports/20261007-qj-quote-jump/round4/run-controls.py
```

Rust build/guide/docs commands retained the required SQLite flag, disabled
dev/test debuginfo and incremental compilation, and used eight Cargo jobs on
the same CPU affinity. An initial docs-budget command named a nonexistent shell
script; `docs-budget-command-error.log.gz` preserves that command error. The
correct `node scripts/docs-budget.mjs` run passed.

Guide social, the installed README and LLP 3000.028 §8 now describe the span
floor, separate on-time cap and expiry-aware restart assertion. No native UI run
or full-suite run is claimed for this test-only round. The earlier native UI
limitation remains. Wasm was hash-checked, not rebuilt this round; it stays
2,135,164 raw / 645,264 canonical gzip bytes against the unchanged 645,564 cap.

The reference audit still reports the one broken LLP 3000.035 anchor inherited
from main in `snapback4-difftest/src/lib.rs:3`; see `ref-check.log.gz` and the
unchanged-file proof in `../round3/ref-check-baseline.json`. No QJ reference fails.
All work stayed in this eb1000 worktree at about **15.34 GB**, below 30 GB. No
other worktree or process was changed. Nothing was pushed or published.
