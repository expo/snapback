# Round-1 commands and evidence

Worktree `/home/ccheever/sb4-intent/lane-bt`, host eb1000; base
`cacea20f5d4135863abeb91feb959f8f309faf73`. Node v24.13.1, Bun 1.3.14.
All commands below run in `snapback4/` unless stated otherwise. No other
worktree was used and no other lane's processes were inspected or signalled.

## Preflight and reproduction

```sh
bun install --frozen-lockfile
bash ~/sb4-intent/check-sdk-deps.sh
```

`deps.log.gz`: no dependency changes, **deps-ok**. Reused this worktree's
round-0 native, wasm and SDK builds. `artifact-hashes.json` verifies the native
binary, wasm module and all 128 SDK JavaScript files against the original
`../environment.json`; no rebuild or disk product mutation.

Before editing the tests, ran Astra's supplied import hook on round 0:

```sh
BT_LATE_QUERY=ownedEvent node --import /home/ccheever/sb4-intent/reviews/bt-r0.astra.evidence/late-publication.mjs --test --test-concurrency=1 --test-name-pattern='owned-event fallback' packages/snapback4/test/bounded-following.test.mjs
BT_LATE_QUERY=homePage node --import /home/ccheever/sb4-intent/reviews/bt-r0.astra.evidence/late-publication.mjs --test --test-concurrency=1 --test-name-pattern='MQ speculative events' packages/snapback4/test/retained-history.test.mjs
```

`reproduce-ownedEvent.tap.gz`, `reproduce-homePage.tap.gz`: both 2/2 pass with
early publication logged while held. These use Node's default spec reporter.
Only the supplied evidence directory was read, not the review worktree.

## Exploratory checks after the repair

```sh
node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern='owned-event fallback|MQ speculative events|population growth|re-observation: pending' packages/snapback4/test/{bounded-following,retained-history,following-routing,client-lifecycle}.test.mjs
node --test --test-reporter=tap packages/snapback4/test/custody-read.test.mjs
```

`smoke.tap.gz`: 7/7 pass. `helper-regressions.tap.gz`: 17/17 pass.
The new loader was first exercised with:

```sh
BT_LATE_QUERY=ownedEvent node --import ./reports/20261008-bt-bounded-following-time/round1/late-publication.mjs --test --test-reporter=tap --test-name-pattern='owned-event fallback' packages/snapback4/test/bounded-following.test.mjs
BT_LATE_QUERY=homePage node --import ./reports/20261008-bt-bounded-following-time/round1/late-publication.mjs --test --test-reporter=tap --test-name-pattern='MQ speculative events' packages/snapback4/test/retained-history.test.mjs
BT_LATE_STAGE=apply BT_LATE_QUERY=wide node --import ./reports/20261008-bt-bounded-following-time/round1/late-publication.mjs --test --test-reporter=tap --test-name-pattern='predicted post fences' packages/snapback4/test/bounded-following.test.mjs
BT_LATE_STAGE=apply BT_LATE_QUERY=conditionalHelper node --import ./reports/20261008-bt-bounded-following-time/round1/late-publication.mjs --test --test-reporter=tap --test-name-pattern='unknown conditions' packages/snapback4/test/bounded-following.test.mjs
```

`late-*.tap.gz`: ownedEvent, homePage and conditionalHelper each give 2/2
expected unsettled-assertion failures. Wide has no cached earlier answer and
gave 2/2 passes with no mutation trace. It was replaced by conditionalHelper
for the permanent apply control; the loader also resets its phase trace per
fixture. The permanent verification checks trace counts as well as failures.

## Final repeats, controls and regressions

```sh
python3 reports/20261008-bt-bounded-following-time/round1/verify.py
```

The runner contains complete selections and expected counts. All subprocess
argv, environment overrides, exits and counts are retained in the JSON run
records. It runs each of the four complete integration files three times,
all prior admission/receipt/sibling bypasses, the delayed-publication controls,
all `one-shot*.test.mjs` plus query-dependencies/query-publication-session, and
the 17 helper regressions three times. The first four-file pass uses both
mutation loaders disabled. Later timing passes use neither loader.

The initial driver had already loaded the inactive wide selection before its
configuration was corrected; that attempt is retained, not counted as a
successful negative control. The corrected apply control was separately
rerun with `--test-concurrency=1` and its argv/exit/counts are in
`supplemental-results.json`. Final consolidated results distinguish this
replacement from the original attempt. Integration tests and the helper did
not change during qualification.

## Audits and summary

From the repository root, `./ref-check` writes `ref-check.log.gz` and
`git diff --check` verifies whitespace. TypeScript's JavaScript parser compared
every explicit `assert.*` call in each of the four integration files against
the base commit, in source order, plus every hangBudget timeout declaration:
`assertion-audit.json`. All match exactly; pending calls are moved into the
common synchronous release check. `git diff` was inspected for gate coverage
and preservation of original/fresh read groups.

```sh
python3 reports/20261008-bt-bounded-following-time/round1/summarize.py
```

This extracts all per-test and whole-file TAP durations and verifies identical
test names, counts and full passes against round 0. Completed TAP and log
files are gzip-compressed losslessly for retention.
