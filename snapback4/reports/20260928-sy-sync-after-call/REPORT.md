# Lane SY — explicit sync observes a round begun after its call

Date: 2026-09-28. Branch: `sb4-intent/sy-sync-after-call`.
Baseline: `ede1f11773671436a1e9ce9ec09416500cd7e946`.
The first command was `git fetch origin && git merge origin/main`; it reported
`Already up to date.` The worktree was clean. No push or publication.

The local client now implements the author's ruling. An explicit `sync()`
with no round in flight starts one. During a round, explicit callers share
one follow-up associated with that older round. A caller arriving during the
follow-up requires another round. The older round's rejection cannot skip the
new attempt; the new attempt owns the result. A network failure still resolves
without a value and marks the link offline; an unexpected device exception
still rejects. This preserves acquisition, publication, restore refusal,
close and sign-out behavior.

Only the public local `sync()` uses `explicitSync` in `local-sync.ts`.
`syncOnce` and every internal caller retain their coalescing. Browser wasm,
process SQLite, Expo's native opener and custom handles all enter the same
`createLocalClient`. No device code, wire format, dependency, meter, version,
or budget changed. `local.ts` remains at the 1,500-line cap.
The sync card and operations manual each gain one sentence explaining the
promise and why an older response cannot satisfy it. LLP 3000 section 7
records the ruling. Both tickets are closed, including the SS ticket imported
from `~/sb4-intent/lane-ss/issues/` with its original account and resolution.

## Orientation and review

Used the populated sibling's `llp-orient` skill read-only because this
worktree's vendor skill link was uninitialized. Scope: local round scheduling,
the ordinary-history/asset regressions and the sync authoring surface.

- LLP 3000 sections 2, 4 and 7 (current): one shared client over the device,
  the Snapback 4 fence and its source/verification budgets.
- LLP 2000.000 section 7.2 (current): the partition stream and leave policies.
- LLP 3000.001, “Repair B” and “What is built” (archived): publication must
  keep confirmed images, predictions and acknowledgements together.
- LLP 3000.021 sections 3.1 and 3.4 (current): ordinary retained history and
  the screen/leave/remount assertions. The sync card and operations manual
  supply the current client behavior, including the offline result.

The change reuses the entire existing round, including pagination, terminal
publication and error handling. It does not add an acquisition shortcut.
The new author ruling resolves the previous ambiguity; no new open design
question or separate LLP was needed. Scope review checked every internal
`syncOnce` call, promise cleanup order, calls during the follow-up, rejection,
and lifecycle fences. This is a local review, not an independent model review.

## Regression evidence

The controlled cases use the public fetch injection, consume and hold a real
server response, commit leave/revocation on the server, call explicit sync,
then release the old response. The original inbox, retained history,
revoked-home and offline asset assertions are unchanged. An AST comparison
confirms all 79 original history assertions and all 161 asset-list assertions
are byte-for-byte unchanged (`assertion-preservation.json`). The unforced original
cases remain. Controlled variants cover process/native and wasm for both bugs.
Background change polls are parked with heartbeats to keep them from repairing
the deliberately stale result before its assertion.

The SS report's original patch also disabled every subsequent sync request.
The committed success regression permits the required follow-up; its separate
offline test verifies the documented result when that attempt cannot reach the
server. It does not assert fresh data after a failed attempt.

| Test | Baseline / negative control | Corrected client |
| --- | --- | --- |
| DC leave/history, process and wasm | Both fail at the original nonempty inbox assertion | Both pass |
| SS revoke/media, native and wasm | Both fail at the original `real home is gone` assertion | Both pass |
| Ten calls during an older round | All ten incorrectly resolve with the older response | None resolve early; exactly two total rounds |
| Caller during the follow-up | No second round is started | Exactly three rounds; newest state applied |
| Follow-up offline fetch | Explicit call resolves before the attempt | Waits for attempt, returns undefined, link offline |
| Follow-up device rejection | Explicit call resolves with old success | Waits, then rejects with the device error |
| Older device rejection | Explicit call inherits the old error | Follow-up still runs and succeeds |
| Background wake alone / during an explicit round | Baseline already passes; deliberately doubled-wake mutation fails both with 2 versus 1 | Both remain one round |

`baseline-local.mjs` substitutes only baseline `local.ts` in memory; it does
not edit source or built files. `double-wakes.mjs` is the test-only background
mutation. The four real regressions and five new explicit-call guarantees all
fail without the runtime change. The wake assertions guard an existing
behavior and fail when that behavior is deliberately broken.

Final focused results: `scheduler-final.log.gz` has 7/7;
`interleavings-final.log.gz` has 4/4. The corrected fixture's baseline controls
are in `negative-interleavings-corrected.log.gz` (four expected failures),
`negative-scheduler.log.gz` (five expected failures, two preserved wake passes),
and `negative-wakes.log.gz` (two expected mutation failures).
Two existing acquisition fixtures were subsequently aligned with the ruling:
`negative-recovery-followup.log.gz` shows both revised tests fail on the old
client; `repair-b-final.log.gz` records all **75 Repair B and sync scheduler
tests passing** after those test-only corrections.

## Qualification

All commands run from `snapback4/` unless otherwise stated. Existing Node
24.13.1, Bun 1.3.14, Rust 1.97.0 and wasm-bindgen 0.2.127 were used on Linux
x86_64. No tool was installed and no shared tool path was changed. Build
artifacts are in this worktree. Baseline builds, whole-guide qualification and the full suite used eight
Cargo jobs, dev/test debug info off,
incremental off, and `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.
The full suite used eight Rust test processes, `RUST_TEST_THREADS=8`, and a
65,536 fd limit. Exact inputs/tool versions are in `qualification-inputs.json`.

Affected command:

```sh
node --test --test-concurrency=8 --test-reporter=tap \
  packages/snapback4/test/sync*.test.mjs \
  packages/snapback4/test/local*.test.mjs \
  packages/snapback4/test/ordinary-history.test.mjs \
  packages/snapback4/test/asset-lists.test.mjs \
  packages/snapback4/test/*react*.test.mjs
```

Result: **199 passed, 0 failed, 1 skipped** across 200 tests
(`affected-tests.log.gz`). The inherited skip requires `SNAPBACK4_LEGACY_BIN`
for the published 0.2.32 server. This includes both React files and the sync,
local, ordinary-history and asset-list tests. A later teardown-only improvement
releases held test replies on abort and registers the device-error release
before cleanup; the final 7 + 4 focused checks passed afterward.

Original repetitions use `original-tests.mjs` to load the two original test
files byte-for-byte from the baseline commit, with the corrected runtime.
Every repetition has a new Node process, server and store. The exact filters are:

```text
^process: receipts screen and history after leave, remount and offline/online reopen$
^native: legacy bare id cannot retain bytes after real home revoke$
```

Result: **DC 50/50 and SS 50/50**, all passed.
`original-repetitions.json` and `original-repetitions-{dc,ss}.log.gz` retain
every exit code and TAP result (128.277 s and 71.571 s respectively).

Whole guide command: `cargo test -p snapback4-lang --test guide`.
Result: **92 passed, 0 failed** (`guide-final.log.gz`); the full suite also
runs all 92 successfully. Its Rust asset-list targets pass 28 core and 22
device cases.

Ran `bash scripts/test.sh` exactly once, exit 1. Exact summary:

```text
== 1 failure(s) in 1893 s
   client tests
```

The failed phase contains **two failures, both ours**, detailed below. All other
phases pass: 4,144 Rust tests / 30 existing ignored across 258 binaries and 971
executions, plus passing doctests; client main 3,839 passed / 2 failed / 10
existing skipped; acquisition/server shards 56/56; models 79/79; fixture
wrappers 9/9. The inherited 60-second suite budget is exceeded; no timeout or
budget was raised. After the full run, only the two fixture expectations were
changed, and all 75 Repair B/scheduler tests pass. This is affected verification
after the failed suite, not a second full-suite or all-green full-suite claim.
`full-suite.log.gz` and `full-suite-summary.json` preserve the complete result.

Package build/typecheck, docs budget, whitespace and root `./ref-check --verbose`
are also checked. The reference audit reports 521 LLPs, 9,746 references,
zero errors and zero unchecked. The final staged whitespace/source-cap audit also passes. Runtime source
hashes match the complete-suite inputs; the two test-only adjustments have
separate before/after hashes in `qualification-inputs.json`.

## Every failure and its attribution

This ledger distinguishes intended negative controls from qualification errors.

- **Baseline, expected:** the initial DC control failed on both wasm and
  process at the original inbox assertion. With the corrected fixture, the
  merged baseline fails all four DC/SS interleavings at their original
  assertions. Five scheduler tests expose the old explicit-call behavior.
- **Ours, deliberate mutation:** both background wake tests fail when a
  test-only loader adds a second round. Production files were never mutated.
- **Ours, test setup:** the first asset fetch-hook edit matched an earlier
  options object rather than this fixture. Native and wasm controlled asset
  cases timed out in both initial runs (four cancellations total). No
  stale-row assertion was reached in those cases, so they are not counted as
  valid negative controls. The misplaced hook was removed and the intended
  hook fixed; the corrected baseline and final runs are recorded separately.
- **Ours, docs:** the first whole-guide run failed
  `every_card_introduces_the_feature_before_examples_and_reference_details`
  because the new sentence made the sync introduction exceed 45 words. A
  premature rerun compiled the same content and failed the same assertion.
  Moving the sentence below the example preserves the short introduction.
- **Ours, verification sequencing (artifact availability):** in the first
  unforced repetition batch, DC iteration 37 could not open the wasm file
  (`ENOENT`) while the full suite rebuilt that generated directory. The case
  did not execute. That batch was DC 49 pass / 1 loader failure, SS 50 pass.
  No product assertion failed. The final batch above runs the original test
  bytes after the replacement finished. Both first-batch logs and results
  remain as `repetitions-*.log.gz` and `repetitions.json`.
- **Ours, authoring commands:** two edit snippets initially used a root-relative
  path from `snapback4/` and raised `FileNotFoundError` (the LLP and the guide).
  Corrected paths applied the intended edits. These were not product failures.
- **Ours, formatting:** the first staged whitespace check found an extra blank
  line at the end of the moved DC ticket. Removed it before commit.
- **Ours, full suite:** two existing fixtures assumed explicit sync would join
  the constructor's ongoing recovery round:
  - `repair-b-round7.test.mjs`: `ordinary publication keeps stream mode through
    false snapshot mode and an interrupted round` observed requests
    `[[0,false],[7,true],[7,true],[9,false]]`, versus the old three-request
    expectation. Its mock returned 503 on the legitimate ordinary follow-up.
  - `repair-b.test.mjs`: `interrupted snapshot catch-up resumes its durable
    mode` observed four requests instead of three. Its mock treated every
    post-snapshot request as catch-up, even after publication.
  Both fixtures now verify the extra round at the published watermark with
  `stream: false`. The original recovery requests still require stream mode;
  staged ownership and first-page assertions remain, with new assertions for
  the post-publication attempt. All 75 Repair B/scheduler tests pass afterward.
  No runtime change followed the full-suite run. The single full-suite result
  remains red in this report; it was not rerun.

No unrelated baseline product fix is included. The full suite has no baseline or environmental failures; both failing
assertions above are attributed to this lane's deliberate contract change.

## Wasm

Fresh baseline build and the full suite's rebuild are byte-identical:
**2,019,815 B raw / 585,384 B gzip; delta 0 B / 0 B**. The unchanged gzip
budget is 586,193 B, leaving 809 B. SHA-256:

```text
083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625
```

The local baseline comparison, rather than another machine's historic gzip
measurement, establishes no change. `baseline-wasm.log.gz`,
`baseline-wasm.sha256`, `wasm.json` and the full-suite build output retain the
measurements. There is no new browser or iOS simulator witness claim: process,
wasm-in-Node and custom-handle tests exercise the common TypeScript path;
Expo uses that path unchanged.

The final local commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing is pushed or published.
