# Round-2 reproduction and verification

Base `a9c84614b6c2e4274f39bf1d1ad5c789282178de`, eb1000
(`expose-builder-pixel`), `/home/ccheever/sb4-intent/lane-bt`.
Node v24.13.1, Bun 1.3.14. Commands run in `snapback4/` unless noted.

## Dependencies and unchanged product

```sh
bun install --frozen-lockfile
bash ~/sb4-intent/check-sdk-deps.sh
```

`deps.log.gz`: 597 packages installed, **deps-ok**. No tracked dependency file
changed. Native, wasm and 128 SDK artifacts were checked against round 1's
hashes before testing and again before commit (`artifact-hashes.json`). No
build or on-disk product mutation. `integration-file-audit.json` binds the
byte-identical four integration files to round 1.

## Before and focused after controls

Before editing the helper, ran each mode separately against round 1:

```sh
BT_LATE_MODE=timeout node --import /home/ccheever/sb4-intent/reviews/bt-r1.grok.evidence/late-timer.mjs --test --test-reporter=tap --test-name-pattern='event slots wasm: owned-event fallback' packages/snapback4/test/bounded-following.test.mjs
BT_LATE_MODE=two-immediates node --import /home/ccheever/sb4-intent/reviews/bt-r1.grok.evidence/late-timer.mjs --test --test-reporter=tap --test-name-pattern='event slots wasm: owned-event fallback' packages/snapback4/test/bounded-following.test.mjs
```

Both passed with release logged before publication. `before-results.json`
records argv/exits/times; `before-timeout.tap.gz` and
`before-two-immediates.tap.gz` retain the traces. Only the supplied review
evidence directory was read, not its worktree.

After adding the checkpoints, repeated those selections using this round's
permanent `--import ./reports/20261008-bt-bounded-following-time/round2/late-publication.mjs`.
Both failed at `releaseCustody`, with exactly one publication and zero release
logs. Exact argv/environment/exits and checks are in `after-results.json`;
traces are `after-timeout.tap.gz` and `after-two-immediates.tap.gz`.

```sh
node --test --test-reporter=tap packages/snapback4/test/custody-read.test.mjs
```

`helper-smoke.tap.gz`: 25/25 pass. This includes the original 17 and the eight
new timer/immediate, fulfillment/rejection, POST/apply cases.

## Complete qualification

```sh
python3 reports/20261008-bt-bounded-following-time/round2/verify.py
```

The runner records exact argv, environment overrides, exit status, elapsed
process time, TAP counts and expected-result checks in `run-results.json`.
All commands use the local built artifacts and terminate their own children.
It runs:

- Three complete serial passes of bounded-following, retained-history,
  following-routing and client-lifecycle (178 cases per pass).
- All 43 admission/receipt/selective-sibling bypass controls from round 0.
- All six delayed-microtask controls from round 1.
- The two new wasm owned-event timer and two-immediate controls.
- Every `one-shot*.test.mjs`, plus query-dependencies and
  query-publication-session, at concurrency 4 (378 total including nested tests).
- Three full runs of custody-read (25 per run).

The first four-file pass imports both loaders with mutations disabled and
overlaps the independent mutation/regression jobs. Passes 2 and 3 run only
one test file at a time, after all this lane's other test jobs finish. Shared
host activity is neither inspected nor controlled. For each delayed mutant,
the runner requires the exact failure count, assertion text/code, release
boundary stack and trace count. POST mutants must log zero releases; the
before-apply mutant must log one POST release per case and no apply release.

## References, whitespace and timings

From the repository root:

```sh
./ref-check
git diff --check
```

`ref-check.log.gz` records the corpus check. The four integration files are
unchanged byte-for-byte, so the round-1 explicit-assertion/timeout audit still
applies; no assertion was weakened in the helper regression expansion either.

```sh
python3 reports/20261008-bt-bounded-following-time/round2/summarize.py
```

This requires all 12 file runs to pass with the same 178 test names and emits
per-test/file TAP durations in `TIMINGS.md`, `timings.json` and
`timing-summary.json`. Original and round-1 times are retained from the earlier
reports. Raw completed TAP/log evidence is gzip-compressed losslessly.
