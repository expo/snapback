# Failure and control ledger — round 3

## Detecting controls (deliberate failures, ours)

`regressions-before-final.log` runs the original 22 round 3 cases against the merged
round 2 SDK, copied before the implementation change. All 20 generation cases
fail; the two quiet-presence cases pin the existing guard and pass. The failing
titles are listed below. The implementation patch is solely the generation
boundary plus comment compression; no production quiet-presence change is
needed because its guard already exists.

- process: real generation-only adoption retires readable replica answers, keep=undefined
- process: real generation-only adoption retires readable replica answers, keep=true
- process: real generation-only adoption retires readable replica answers, keep=false
- process: real generation-only adoption retires throw replica answers, keep=undefined
- process: real generation-only adoption retires throw replica answers, keep=true
- process: real generation-only adoption retires throw replica answers, keep=false
- process: real generation-only adoption retires held replica answers, keep=undefined
- process: real generation-only adoption retires held replica answers, keep=true
- process: real generation-only adoption retires held replica answers, keep=false
- wasm: real generation-only adoption retires readable replica answers, keep=undefined
- wasm: real generation-only adoption retires readable replica answers, keep=true
- wasm: real generation-only adoption retires readable replica answers, keep=false
- wasm: real generation-only adoption retires throw replica answers, keep=undefined
- wasm: real generation-only adoption retires throw replica answers, keep=true
- wasm: real generation-only adoption retires throw replica answers, keep=false
- wasm: real generation-only adoption retires held replica answers, keep=undefined
- wasm: real generation-only adoption retires held replica answers, keep=true
- wasm: real generation-only adoption retires held replica answers, keep=false
- process: generation boundary clears remembered answers and a held server completion
- wasm: generation boundary clears remembered answers and a held server completion

`mutant-presence.log`: removing only ` || !answers.current(watch, result)`
from quiet publication in a copied final `dist/local.js` fails both process
and wasm `quiet presence cannot publish below a pending durable cut` cases.
The old sample clears the pending episode, so the expected withdrawal never
occurs. Sources were not mutated.

`mutant-generation.log` and its per-host JSON: the copied merged round 2 SDK
fails 3/3 schedule seeds per host. Failures are `failed adoption stays
withdrawn` and `answer from retired program after generation notification`.
The negative-reference test passes. These are expected falsification results,
not unresolved final product failures.

## Setup corrections (ours)

The initial `regressions-before.log` was interrupted after seven expected
pre-fix assertion failures because the held-read test tried to trigger a read
by resubscribing a `keep:true` watch. That watch correctly lingers and does
not start a new read. The final test explicitly holds a direct query instead;
`regressions-before-final.log` and `regressions-after.log` replace the initial
run. The interrupted log is retained.

Three exploratory file reads used nonexistent filenames/globs
(`helpers/answers-stay-review.mjs`, `src/local-presence.ts`, and the guessed
`3000.007-builder-friction*` path); located and read the actual modules/LLP.
These were lookup mistakes, not test or product failures.

## Affected and guide checks

`regressions-after.log`: 22 passed, zero failed. `oracle-smoke.log`: three
seeds per host and the negative-reference test pass. `affected.log`: 740
tests, 739 passed, zero failed, one declared skip. The skipped test is
`new client syncs against the actual 0.2.32 server's deny_unknown_fields
request contract`: its existing condition requires SNAPBACK4_LEGACY_BIN.
No baseline or environmental test failure is recorded in these runs.
`guide.log`: 98 passed, zero failed. Build and reference check pass.

A documentation-update command initially ran from `snapback4/` with a root-relative
LLP path and failed before writing. Reissued from the repository root; this was
my setup mistake. Build/typecheck launched afterward completed normally.

## Grok follow-up controls

`unknown-tables-before.log`: before the online fix, all four omitted-table
cases fail to refresh (default/true, held/failed replacement), while all four
explicit-empty-table controls pass. The real server always supplies `tables`;
this fixes the existing defensive-path asymmetry between the two clients.

`mutant-intersection.log`: changing only the local notification intersection
from `some` to `every` in a copied SDK fails the members-only process and wasm
cases. The expected replica re-read is never triggered. The ordinary tests
and seeded notification schedule now send exactly `tables: ['members']`.
These are deliberate red controls, attributed to our injected mutations.

Final Grok follow-up checks: `grok-qualified.log` passes 120/120, including all
30 final round 3 cases. `oracle-final.log` and its JSON records pass 300 seeds
per host with zero failed seeds. Final guide remains 98/98; docs budget,
package build and typecheck pass. No timeout or ceiling was raised.

## Full-script failure (ours)

The only failed client test reported by the full script is
`packages/snapback4/test/answers-stay-round3.test.mjs:1:1` (`test failed`).
The file's first 20 generation/adoption tests had passed. Its first
quiet-presence case then waited indefinitely for another sample: the test
waited across the episode deadline before selecting the next gated sample,
and a sample overtaken by that withdrawal can end its sampling cycle without
arming another timer. The test incorrectly assumed the next sample must run.
The problem is ours, not a baseline or environmental failure.

Stopped only the recorded Node test child and its two fixture processes after
the file had run for about 431.5 seconds; the full script continued to report
all other stages. `stalled-test-processes.json` records those exact PIDs and
commands. It did not stop or restart the full script. Node reported the whole
file failure, rather than a named quiet test assertion; this is the exact full
run outcome, not a claim that the entire file passed in that run.

The initial live-process inspection suggested the held-server test, but the
buffered output after termination showed both held-server/remembered-answer
cases had passed and located the stall in quiet presence. The diagnostic
`memory-setup-probe.log` also passes those cases 12 times per host (24/24).
No memory-test or production change was made for that suspicion.

Fixed the test schedule: freeze the host clock while an old quiet sample
finishes, assert it preserves the existing episode, advance to the original
deadline only after the sample has rearmed, then release a second sample from
the stable withdrawn snapshot. Sample-entry and completion waits are bounded
using the existing polling helper. No product timer or timeout was increased.

Final `regressions-final.log`: **30/30**. `presence-repeat.log`: **24/24**
(12 repeats per host). `mutant-presence-final.log`: the same one-guard deletion
still fails **2/2**, now specifically at `older sample cannot settle pending
evidence`. The corrected source file is retained with these results.

Full client counts: **4,754 tests; 4,743 passed; 1 failed; 10 skipped;
0 cancelled**. Baseline failures: **0**. Environmental failures: **0**.
The full script remains a red run and will not be rerun. Exact overall summary: `== 1 failure(s) in 1388 s` (exit 1), stage `client tests`.
Every other stage passed, including 79/79 final models. The complete run also
passed 300 schedule seeds per host. The inherited 60-second target remains
missed; no ceiling changed.
