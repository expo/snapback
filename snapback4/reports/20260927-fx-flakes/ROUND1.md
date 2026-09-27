# Lane FX round 1 — review regression coverage

2026-09-27, branch `sb4-intent/fx-flakes-2`. Read the original lane prompt,
round-0 report/journal, and both complete reviews. Fetched and merged
`origin/main` at `880788cc5` in `5bf51d938`. The only conflict was JOURNAL.md;
both parents' histories remain verbatim and in order, verified before commit.
All round-1 commits carry `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

All three requested regressions detect their reviewer mutations. Round 1
changes tests and their evidence only; runtime source is unchanged from the
merged tree. No push, publication, version or budget change.

## Changes, file by file

Paths are relative to `snapback4/` unless stated otherwise.

| File | Change |
| --- | --- |
| `packages/snapback4/test/expired-server-watch.test.mjs` | After recovery/closure and the existing 1,100 ms wait, also require exactly eight scheduled retry timers. A held ninth callback can no longer hide continued retries. |
| `packages/snapback4/test/react.test.mjs` | Add a focused shared-listener lifetime test and a real two-tab localStorage-clear hook test. Existing browser cases and timeouts are unchanged. |
| `../issues/20260927-snapback4-react-usenow-deadline-flaky.md` | Append the two observed recurrences of the already recorded unrelated flake, including the final 19/20 file result. No fix. |
| `reports/20260927-fx-flakes/ROUND1.md` | This report, commands, mutation results and limits. |
| `reports/20260927-fx-flakes/round1-qualification.json` | Per-run statuses, test summaries, log hashes, mutation details and unchanged artifact measurement. |
| `JOURNAL.md` | One dated round-1 append; existing entries are preserved. |

The changed test files are 100 and 240 lines. No test or assertion was
removed, skipped, loosened or given a longer timeout. No new syntax, API,
diagnostic, dependency, gate or design was introduced. The existing report
and round-0 qualification remain intact.

## What the tests prove

1. **Retries stop after recovery.** The existing seven cases still check
   scheduled exponential backoff, withholding, single flight, authoritative
   recovery and closure. The added timer-count assertion checks the mock's
   outstanding scheduling behavior after the unchanged teardown wait.
   All three recovery variants (`keep` omitted/false/true) fail with **9
   timers instead of 8** when `retryExpired` includes
   `|| watch.expiredRetries > 0`. Five processes: **15/15 recovery cases
   fail**, each at the new assertion.
2. **The final shared owner releases the listener.** The focused test uses
   the built `journalChanges` with a real EventTarget standing in for the
   window. It records registrations/removals and wraps the actual handler
   to count deliveries. Two owners register once; the first close removes
   nothing; the last close removes that identical handler exactly once.
   A matching storage event after final close reaches neither handler nor
   owner. Deleting `entry.stopStorage()` fails **5/5**: handler deliveries
   reach 3 instead of 2 even though the owners' notification counts remain
   unchanged. This detects the exact leak the old assertions missed.
3. **A different tab's clear invalidates a localStorage journal.** The
   existing fixture stores real custody in localStorage and mounts
   `usePendingWrites`. A sent, unsettled ID must appear both in the hook
   and in `pendingWrites()`. A second real Chromium page, with no custody
   client, calls `localStorage.clear()`. The existing mounted hook must
   become empty and agree with the durable list, without remounting,
   another write or a broadcast from the clearing page. Removing the
   `event.key === null` branch fails **5/5**, at the unchanged 30,000 ms
   hook wait.

The exact retry mutation initially refused TypeScript compilation with
`TS18048: 'watch.expiredRetries' is possibly 'undefined'`. That setup
attempt is recorded, not counted as a regression failure. For the behavioral
control, the exact expression was applied to the emitted `dist/local.js`
`rerun` function. The tests then executed that mutant and failed on timer
counts. The listener-release mutation was applied to source and built; the
clear mutation was applied to source, which the browser harness loads
directly. Every mutated file was restored byte-for-byte; the listener build
was restored as well. No mutation remains in source or built output.

## Qualification

Node 24.13.1, Bun 1.3.14, Rust 1.97.0 on expo-build-1000. Frozen install,
package build, merged native CLI build, and the initial **55/55** affected
test run pass. The **whole guide passes 86/86**:

```text
test result: ok. 86 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.51s
```

The full affected files were each run 20 times, in batches of five Node
processes sharing cores 0–7 with eight CPU workers, using the existing
round-0 repeat driver. No retained-history test changed in this round.
Final one-minute host loads were 29.88 (expiry) and 51.26 (React).

| Final group | Result | Cases per run |
| --- | --- | --- |
| `round1-expired` | **20/20 pass** | 7 |
| `round1-react` | **19/20 pass** | 48 including parent |

All assigned regressions pass **20/20**. React run 04 fails only the
previously recorded, unchanged `useNow hides a server-answered row at its
deadline and after a clock advance` case, plus its enclosing parent:

```text
Error: clock advance repaints without another row answer: "bob"
```

That case took 561.121 ms; the other 46 tests pass. It also failed once in
`round1-mut-clear-04.log` (572.904 ms), separately from the expected new
clear-regression timeout. All other mutation runs have only their expected
failures. This is a **baseline intermittent finding**, already recorded in
round 0; its cause remains unconfirmed, not labelled environmental. No
green rerun replaced either failure. No assigned or environmental test
failure occurred on the restored implementation.

`ref-check --verbose` passes: 517 LLP documents, 9,618 references, zero
errors and zero unchecked. `git diff --check` also passes.

Commands from `snapback4/`, after the frozen install and package build:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
python3 reports/20260927-fx-flakes/repeat.py round1-expired packages/snapback4/test/expired-server-watch.test.mjs . 20
python3 reports/20260927-fx-flakes/repeat.py round1-react packages/snapback4/test/react.test.mjs . 20
CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p snapback4-lang --test guide
```

For the negative controls, apply each exact mutation described above alone,
then restore it before the next control. Use the same repeat command with
count `5` and these labels/files/patterns:

| Label | Test file | Pattern |
| --- | --- | --- |
| `round1-mut-retry` | `expired-server-watch.test.mjs` | `expired server replies: recover` |
| `round1-mut-release` | `react.test.mjs` | `^journal storage listener` |
| `round1-mut-clear` | `react.test.mjs` | `React hooks` |

Raw logs, the reproducible mutation driver (`round1-mutations.py`), and
per-group JSON remain under `target/lane-fx-evidence/`. The committed
qualification records their hashes and all statuses; the repeat driver
itself returns success even for negative controls, so inspect its per-run
statuses. The failure above is also reproducible as a stress attempt with
the final React command; there is no deterministic useNow reproducer yet.

## Existing forms, scope and remaining work

These are existing forms exercised by the tests; no new authoring form is
claimed:

```js
client.observe(api.typingIn, { room: 'r' });
client.observe(api.typingIn, { room: 'r' }, { keep: false });
client.observe(api.typingIn, { room: 'r' }, { keep: true });
const writes = usePendingWrites();
await client.pendingWrites();
```

The only execution adjustment is the exact retry expression's application
to emitted JS after its TypeScript refusal, as explained above. The user
explicitly waived a new full suite for this test-only round. Consequently
`scripts/test.sh` was **not rerun**. Its latest historical FX result remains
round 0's **`== 0 failure(s) in 1436 s`**, exit 0; this is not a round-1
full-suite qualification.

No wasm rebuild was needed: the existing artifact is unchanged,
**1,981,512 B raw / 572,053 B gzip** using the build script's `gzip -9 -c`,
SHA-256 `5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
Test-only device-code delta is **0 B**, below the unchanged 572,841 B cap
with 788 B headroom. No authorization, disclosure, durability, engine,
meter, runtime behavior or timeout change.

All three assigned review findings are covered and mutation-proven. The
existing useNow issue remains open with the reproduction and both new
observations; it was deliberately left unfixed under the lane's original
scope. Nothing was pushed or published.
