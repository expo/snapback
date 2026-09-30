# TF round 0 — expired-watch timer ownership

2026-09-30. Branch `sb4-intent/tf-expired-watch-timers`, starting at main
`0dad042375057d2dad8c429424713986581432e7`, which includes KA merge
`42ba3ffb90`. Test fixture only; no product source, contract, delay, assertion,
timeout or test count changed. Nothing pushed or published. No full suite run.

The fixture now wraps the existing exported `ReadWork.prototype.retry` with
`t.mock.method`, calls the real method with its original receiver and arguments,
and marks only its synchronous execution for timer capture. The original
AsyncLocalStorage identity still selects this watch. A `finally` restores the
previous marker, and the test mock restores the method after each case.
The timer mock continues to hold and release the actual retry callback and
preserve its requested delay and handle. No product hook was added.

Undici can inherit the watch's async context and request the same 1,000 ms
delay as the backoff cap. Those facts no longer select a timer. Transport,
queue-turn and attempt-deadline timers execute normally outside `retry`.
Unlike the prior duration exclusions, even an incorrect 0 or 30,000 ms retry
would now be captured. All 21 assertion/delay-vector source lines are identical
to main, including exact `[25, 50, 100, 200, 400, 800, 1000, 1000]`, one timer
per step, eight total timers, single flight, forced sync invalidation, no early
dispatch, no expired publication, complete/fresh recovery and both close paths.

Context: Snapback 4's command sheet, root LLP 3000, NOT-DOING, journal,
adopted rules, LLP 2000.000, LLP 3000.019 §3.3 and LLP 3000.023 §10; current
reads and ephemeral guide cards. The existing fixture's LLP reference remains
applicable. This changes its measurement boundary, not the documented design.

Validation ran on eb1000 (`expose-builder-pixel`), AMD EPYC 9454, Linux
6.8.0-138, Node v24.13.1, Bun 1.3.14 and Rust 1.97.0. Unconfined affinity was
CPUs 0–95. The loaded phase pins the test process and inherited server children
to CPUs 0–9, with ten continuous Python CPU workers pinned to the same CPUs.
The runner records their PIDs, affinity and CPU ticks and terminates/reaps only
those owned workers. Five independent file processes run the 50 unconfined
repetitions; the 20 loaded repetitions run sequentially. Every invocation runs
all 12 cases, with no filtering, skips, cancellations or reduced counts.

| Check | Result |
| --- | --- |
| Focused fixture | 12/12 passed |
| 50 unconfined file runs | 600/600 passed; zero failed runs |
| 20 file runs pinned to 10 CPUs with load | 240/240 passed; zero failed runs |
| Other expiry/keep checks, including the focused file (14 files) | 306/306 passed |
| Keep app model (separate, full original counts) | 18/18 passed |
| Whole guide | 106/106 passed |
| Ref-check | 525 LLP docs, 9,999 refs; zero errors or unchecked refs |
| Diff check | Passed |

All positive runs have zero failed, cancelled, skipped or ignored cases.
The only red test invocations are the intentional pre-KA delay/count mutations
and the original-fixture socket-retirement reproduction described below.

The pre-KA SDK was extracted from `28014164c6979995708e758c2090e53455101134`
(`42ba3ffb90^1`) and compiled in `target/tf-controls/pre-ka`. It uses the
repaired fixture, the current unchanged fixture helpers, and this lane's
current server/device. This isolates the SDK comparison; it does not claim a
historical full-stack build. Its unmodified SDK passes 12/12. Changing only
the scratch `dist/local.js` backoff base from 25 to 26 fails all nine measured
cases at `26 !== 25`, with the three warm-withdrawal cases still passing.
Adding one scratch timer inside `ReadWork.retry` separately fails all nine
count assertions at `2 !== 1`. Both mutations are restored in `finally`;
the lane's SDK source and build are never mutated. `controls.py`,
`controls.json`, `control-source.json` and the three `pre-ka-*.log.gz` test
logs retain the commands, source identity and results.

An ordinary run of the original fixture against main's SDK passed 12/12;
that result is retained in `original-fixture-main-sdk.log.gz`. The controlled
reproduction uses `retire-warm-sockets.mjs` to wait 1,100 ms immediately before
opening the watch, so sockets opened outside its context retire and its new
connection creates genuine undici timers. The loader also prints stacks for
1,000 ms undici timers created in the watch context; it changes no callback,
requested delay or assertion. Original fixture: 9 failed / 3 passed, with 23
transport timer traces. Repaired fixture: 12 passed, with 105 transport timer
traces passing through normally. Both runs use the same current SDK and server.
`retired-socket-controls.json` and `retired-sockets-*.log.gz` retain all results.

Fresh-tree preparation: frozen Bun install, SDK build and a local server build
with `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. The wasm glue/artifact
was copied from KA's existing build after checking the core/device, Cargo
manifest/lock and build script are unchanged from `49164c847d`; its wasm SHA256
matches KA's recorded digest. `wasm-provenance.json`, `environment.json` and
`source-artifact-sha256.json` retain provenance. This task makes no new wasm
measurement or publication claim. An initial scratch archive setup used paths
relative to the wrong directory and failed before running a test; the corrected
control archives from the repository root. No validation result was discarded.

Repetition command, from `snapback4/`:

```sh
python3 reports/20260930-tf-expired-watch-timers/repeat.py
```

Each run invokes `node --test --test-reporter=tap
packages/snapback4/test/expired-server-watch.test.mjs`; the loaded phase prefixes
`taskset -c 0,1,2,3,4,5,6,7,8,9`. Full per-run counts, timings and load averages
are in `repetitions.json`, with individual TAP logs named by phase and index
inside `repetition-logs.tar.gz` (each member is itself a gzip log).
The 120-second external runner guard is beyond the existing fixture's own
polling bounds and does not alter them. `affected-command.json` records all
14 files in the expiry/keep group; the 18-case `keep-app-model.test.mjs` runs
separately at its original counts. Whole guide command:
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide`.
The pre-KA controls can be rerun with `controls.py` in a fresh scratch directory;
the retained commands name the one used here.

The QS ticket was absent from main and was imported from
`sb4-intent/qs-one-shot-settles` at `1e1d839c31`. Its original diagnosis is
preserved, with the resolution and evidence added before moving it to
`issues/closed/20260930-snapback4-expired-watch-captures-transport-timers.md`.
