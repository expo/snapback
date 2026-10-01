You are lane WB of Snapback 4, round 0, in `~/sb4-intent/lane-wb` (branch `sb4-intent/wb-wall-clock-budgets`, from `main`). Your task is the test suite only.

## The problem

0.4.10's publication dry run, attempt 2 on the M5 (a shared 18-core Mac at load 58 from other sessions' builds), failed one test:
- `packages/snapback4/test/live-propagation-fallback.test.mjs`, case "wasm: pending cut preserves presentTransition before sync publication";
- assertion "new branch obtains a current whole-server answer while sync remains held";
- it took 9157 ms, while its `turns()` helper allows a fixed 5000 ms of wall-clock time.

The same test took 1970 ms on that host in attempt 1 and 2681 ms on the office M1. It is a load flake, not a product regression. Lane SL (merged as 9d03e94623) fixed many such tests with state barriers and work-scaled guards, but not this one. Every publication dry run runs the whole suite on a shared Mac, so each remaining fixed wall-clock budget can cost hours.

## What to do

1. Fix `turns()` and this case so the outcome no longer depends on host speed. Wait on the actual state transition (a state barrier, or a polled condition with a generous work-scaled hang guard), not a fixed 5000 ms budget. Keep every assertion about ordering and the answers themselves. Keep a hang guard, so a real regression still fails clearly.
2. Audit `packages/snapback4/test/` and `packages/snapback4/test/helpers/` for every remaining fixed wall-clock budget that decides pass or fail: `turns()`-style loops, `until(…, ms)`, `Date.now()` deltas, `setTimeout` races and fixed `timeout:` options on tests that wait for asynchronous work. Classify each as a legitimate timing assertion (the product promises a bound, as with expiry) or an incidental budget. Convert the incidental ones the same way. List all of them in the report.
3. Prove it under the same contention as SL: run the converted files on eb1000 pinned to 10 CPUs with SL's synthetic load (see `snapback4/reports/` from lane SL for the recipe) at least 5 times, plus once unconfined, with zero failures. Mutate one product timing path (for example, delay the fallback publication) in a scratch copy and confirm the hang guard still fails clearly.

Change no product code. Run the converted files, the whole guide, and `scripts/test.sh` once. Report its exact summary line and every failure, marking each as yours, baseline or environmental. Write the report under `snapback4/reports/20261001-wb-wall-clock-budgets/`, append one journal entry, and commit with the trailer `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Push and publish nothing.
