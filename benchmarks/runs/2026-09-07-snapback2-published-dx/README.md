# Published Snapback 2 developer-experience measurement

Measured **npm `snapback2@0.0.14` and `snapback2-darwin-arm64@0.0.14`**, on 2026-09-07 06:50–06:59 UTC (September 6 Pacific). The todo change reached a passing test receipt and the running backend returned the changed row. The largest observed friction was broad verification, the setup URL handoff, and diagnostic correction cascades. These are priorities from two small workloads, not a population-wide ranking or a Clique loop-bar qualification.

The subsequent authorized implementation and ownership handoff are recorded in [FIXES.md](FIXES.md). The measurements and no-edit statements below describe the original measurement interval.

The consumer lives at `/Users/ccheever/bench-snapback2-dx/published-0.0.14/`. It installs registry packages, with no source-package links, locally built Snapback binary, or compiler override. The initial npm download cache was empty; OS caches were not flushed. The host was a 10-logical-CPU MacBookPro18,4 with 64 GiB RAM, macOS 26.6 (25G72), Node 22.23.2, npm 10.9.8. Exact host output, package versions, and SHA-256 hashes for the 151 CLI-package files and three platform-package files are in [environment-and-installed-bytes.json](evidence/environment-and-installed-bytes.json). The compiler's nested TypeScript is 5.9.2; the React app resolved TypeScript 5.9.3, React 19.2.8, and Vite 7.3.6. Both app lockfiles are retained.

Registry receipts retain the immutable tarball URLs and integrity values: [CLI](evidence/01-registry.json), [darwin-arm64 binary](evidence/31-platform-registry.json). The first metadata command supplied two package names but npm returned only the CLI metadata; the separate platform command supplies the missing record. The receipt identifies binary version `0.0.14`, digest `rust64:0c64cf0914f5b3e1`.

The primary workload was the untouched todos/React scaffold, followed by a `todos.complete(todoId)` mutation and an authored journey proving owner-only completion, preservation after rejection, the changed `done` value, and private-row isolation. An untouched chat/backend-only scaffold provided a larger 26-operation verification workload. Backend behavior was tested through the installed CLI and wire client. A headless Chromium probe tested the React starter's connection; this is not a complete todo UI, a native-device test, or a fresh uninformed builder trial.

| Stage | Observed wall time | Evidence and interpretation |
|---|---:|---|
| Bootstrap package installation | 2.985 s | [02](evidence/02-install.json); empty dedicated npm download cache |
| Scaffold todos/React, including initial check | 0.594 s | [04](evidence/04-init.json); correctly pins Snapback 0.0.14 |
| Install generated app dependencies | 5.118 s | [06](evidence/06-app-install.json); same npm cache, fresh app `node_modules` |
| First installed doctor | 0.442 s | [07](evidence/07-doctor.json); internal doctor time 65 ms |
| Start owner | 0.448 s | [08](evidence/08-dev.json); returns an ephemeral port |
| First successful `todos.list` | 0.044 s | [09](evidence/09-first-run.json); complete seeded row |
| React production build | 1.136 s | [10](evidence/10-react-build.json); compiling the bundle alone does not prove a connection |
| Watched edit → changed served behavior | median 0.430 s, range 0.400–0.479, N=5 | [36](evidence/36-hot-edit.json); write return boolean, poll actual mutation result every 50 ms |
| Explicit todo `check` repeats | median 2.249 s, range 2.064–2.479, N=5 | [summary](evidence/summary.json); three operations and two journeys |
| Todo journey-only repeats | median 3.346 s, range 2.979–3.730, N=5 | [timings](evidence/timings.jsonl); both authored journeys pass |
| Chat `check` | median 4.311 s, range 1.390–5.002, N=4 | [summary](evidence/summary.json); all samples retained |
| Chat full tests | median 19.423 s, range 18.936–20.614, N=4 | [35](evidence/35-chat-test.json), [repeat 1](evidence/37-chat-repeat-1-test.json), [2](evidence/37-chat-repeat-2-test.json), [3](evidence/37-chat-repeat-3-test.json); all pass |
| Corrective edit → check → affected-selector probe → full test → live mutation/read | 6.958 s elapsed; 6.474 s summed command time | [edit timestamp](evidence/22-edit-start.json), [check](evidence/22-check-verified-change.json), [selector refusal](evidence/23-test-changed.json), [full receipt](evidence/24-test-full-verified.json), [mutation](evidence/25-run-complete.json), [changed row](evidence/26-run-verified.json) |

Installation + init + doctor + dev + first query consumed **9.630 s of command time**, including **8.103 s installing packages**. The session elapsed 44.934 s between installation start and first query; the remainder includes inspecting output and agent/tool turn gaps. Neither number includes the later browser investigation. Browser probes included an intentional 1.8 s observation window and browser startup; their total durations are not estimates of connection latency. [Aggregated arithmetic](evidence/summary.json).

1. **Broad verification is the largest recurring measured delay.** `test --changed snapback/todos.q --json` exits 2 with `unknown option --changed`; help advertises only `--journeys-only` and `--derived-only`. Affected-test selection is unavailable in this pin, so the affected journey runs within a broader group. This is an explicit missing capability, not an advertised selector malfunction. The repeated two-journey runs take 3.35 s median although their individual receipt durations total only 0.17–0.29 s. Chat full tests take 19.42 s median; invalidation accounts for 5.39–5.49 s per receipt, and certification for 1.96–2.33 s. These tests provide real coverage; the opportunity is selecting/reusing work while retaining that coverage. With the todo owner stopped, alternating the same source with and without its journey files reduced `check` by 0.458, 0.494, and 1.192 s within the three adjacent pairs. This implicates journey compilation in the command cost, but it is not a process-level profile and does not establish that all other time is removable. [Test help](evidence/12-test-help.json), [selector refusal](evidence/23-test-changed.json), [paired controls](evidence/29-control-1-with-journeys.json), [second pair](evidence/29-control-2-with-journeys.json), [third pair](evidence/29-control-3-with-journeys.json).

   The later final full todo test was much faster, **1.528 s**, and passed all seven checks. It is retained separately rather than omitted or mixed into the five journey-only repeats. This variability limits a claim about a fixed verification floor. The declared 1 s `check` budget was exceeded in this host's repeat cohorts; doctor repeats passed the 0.5 s budget (median 0.252 s), and all measured test runs stayed below 30 s. [Final receipt](evidence/38-final-test.json).

2. **Setup has a reproducible instruction/feedback correction loop.** `guide init` tells the builder to start the bundler separately after `dev` prints `SNAPBACK_URL`, but does not show the React `VITE_SNAPBACK_URL` assignment. The generated client falls back to `http://127.0.0.1:3210`, while this owner chose port 58805. Starting Vite without that assignment produced four failed manifest requests to port 3210 during the probe. The static page still said “The owner URL is connected”; the overlay correctly said `reconnecting` / `E_NETWORK`. Restarting Vite with `VITE_SNAPBACK_URL=http://127.0.0.1:58805` produced `connected`, a generation, and no failed requests. This is one demonstrated configuration correction, not a slow backend startup. Package installation is the largest one-time wait in this workload, but these measurements do not separate registry/network, extraction, and host filesystem cost. [Published init instructions](evidence/05-guide-init.json), [generated client](evidence/baseline-src/main.tsx), [default failure](evidence/19-browser-default.json), [configured control](evidence/20-browser-configured.json).

3. **Diagnostics serialize independent errors and give an irrelevant repair.** The deliberate two-error fixture assigns `done: "yes"` and returns `missingValue`. Both JSON and human `check` report only `E_QUARRY_UNKNOWN` at the return (0.292 / 0.290 s). Changing only the return to `true` exposes the independent string-to-boolean error (0.392 s), classified `E_OPAQUE`, with the rewrite `add ! else CODE to assert the possibly absent Quarry value before using it here`. An absence assertion does not repair this type mismatch. Replacing `"yes"` with `true` then passes (1.956 s). Thus two known, independently fixable errors required two correction rounds and three check attempts; the minimum compiler-wait subtotal is 2.640 s, excluding the duplicate human-format probe and all reasoning time. This is a controlled fault-injection result, not a claimed frequency of spontaneous developer mistakes. The old backend remains available, and `dev --status` correctly reports the refused successor. [Original fixture](evidence/diagnostic-todos.q), [first diagnostic](evidence/14-diagnostics.json), [second fixture](evidence/diagnostic-round2-todos.q), [misleading rewrite](evidence/17-diagnostics-round2.json), [corrected check](evidence/18-check-corrected.json), [refused status](evidence/16-status-refused.json).

The separate red/green behavioral control intentionally changed the implementation to leave `done: false`: the new journey failed with `completion did not change done`, while the pre-existing round-trip journey passed. Restoring `done: true` passed both the journeys and the derived checks, and the existing served owner returned the changed row. That deliberate red is evidence that verification detects the bug; it is not another product-attributed correction loop. [Red receipt](evidence/21-test-red-control.json), [verified fixture](evidence/verified-snapback/todos.q), [journey](evidence/verified-snapback/tests/complete.test.ts), [green receipt](evidence/24-test-full-verified.json).

Host attribution is deliberately limited. Each timed command records a monotonic wall clock, start time, exit status, load averages, and waited-child user/system CPU time. Commands longer than one second also sampled process CPU; their readable records retain the top 15, and [raw-records.jsonl.gz](evidence/raw-records.jsonl.gz) retains every original record and complete process list. The CPU counter includes small sampler costs; detached owner's CPU is not included in its launching command's waited-child counter. Product subprocesses and host work are not one interchangeable metric.

Sampled one-minute load ranged from 4.52 to 25.29 on 10 logical CPUs. FSEvents, Spotlight workers, browser activity, and the measured Node/compiler processes were visible. No Cargo, rustc, clang, or linker process appeared in the recorded samples; this measurement launched no Rust build. There is evidence of a busy shared machine, but no evidence assigning these delays to a concurrent Snapback build or a Cargo lock. Short work between samples may have been missed. Chat test subprocesses consumed about 20.4–20.6 CPU seconds across roughly 19–21 wall seconds, supporting substantial real test work; that does not isolate scheduling or filesystem wait. There was no exclusive-host or same-hardware idle crossover, so no exact contention penalty is claimed. Early post-edit snapshots also show the product's watched compiler running alongside explicit checks; that overlap is part of the developer workflow, distinct from an unrelated build.

Orientation followed [LLP 1000#how-to-orient](../../../llp/1000-snapback2.explainer.md#how-to-orient), [LLP 1002#5-the-owner](../../../llp/1002-dev-loop.spec.md#5-the-owner), [#7-test-and-the-receipt](../../../llp/1002-dev-loop.spec.md#7-test-and-the-receipt), and [#11-measured](../../../llp/1002-dev-loop.spec.md#11-measured), plus the installed init/testing/Quarry guides. Snapback 2's separate rules apply. No Snapback 1 build, inventory, bootstrap, or complete battery was run. Existing design-document examples were not substituted for the published authoring surface.

Implementation ownership was requested before measurements could lead to shared-code changes. No owner acceptance was received during this run. **No shared product code was edited, and no fix has been claimed or assigned.** The existing named lanes below are routing candidates, not assertions of current ownership:

| Follow-up | Coordinate before implementation | Concrete scope to agree |
|---|---|---|
| Verification cost and affected selection | CLI/test owner; existing `s2/clique-cli` lane, plus compiler owner for journey build work | `snapback2/crates/snapback2/src/test.rs`, compile/test staging; measure reuse opportunities before deciding whether to implement the deferred selector |
| React setup and truthful connection text | CLI/guide and React-template owners; existing `s2/clique-cli` and `s2/clique-guide-topics` lanes | Printed executable Vite startup command, `templates/react/src/main.tsx` and `App.tsx` |
| Diagnostic cascade and incorrect absence rewrite | Compiler owner; existing `s2/clique-compiler-r13-integration` lane | Quarry error aggregation and `packages/compiler/src/quarry/index.ts` diagnostic rewriting |

All fixture edits were in the separate consumer. The final full test passed, the owned development server was stopped, its recorded PID no longer existed, and no test-run directories remained. Both headless browser sessions and their recorded Vite children were closed. [Cleanup evidence](evidence/cleanup.json).

To reproduce, choose an unused consumer directory and set `dx_evidence` to this report's `evidence/` directory. This creates application data only, not a Git worktree. The commands intentionally use the published pin and saved lockfile:

```sh
dx_evidence=/absolute/path/to/2026-09-07-snapback2-published-dx/evidence
dx_repro=$(mktemp -d /tmp/snapback2-dx-repro.XXXXXX)
mkdir "$dx_repro/bootstrap"
cd "$dx_repro/bootstrap"
npm install --save-exact --no-audit --no-fund --cache "$dx_repro/npm-cache" snapback2@0.0.14
./node_modules/.bin/snapback2 init ../app --template todos --client react --json
cd ../app
cp "$dx_evidence/baseline-package-lock.json" package-lock.json
npm ci --no-audit --no-fund --cache "$dx_repro/npm-cache"
./node_modules/.bin/snapback2 doctor --json
./node_modules/.bin/snapback2 dev --json
./node_modules/.bin/snapback2 run todos.list '{}' --as alice --json
```

For the URL control, start `npm run dev` without `VITE_SNAPBACK_URL`, inspect connection/network failures, then restart that bundler with `VITE_SNAPBACK_URL=<the returned owner URL> npm run dev`. Do not presume port 3210. The exact headless probe used here remains in the [local measurement workspace](/Users/ccheever/bench-snapback2-dx/published-0.0.14/browser-probe.mjs).

```sh
# Two-error diagnostic sequence: expected exit 1, exit 1, then exit 0.
cp "$dx_evidence/diagnostic-todos.q" snapback/todos.q
./node_modules/.bin/snapback2 check --json
cp "$dx_evidence/diagnostic-round2-todos.q" snapback/todos.q
./node_modules/.bin/snapback2 check --json
cp "$dx_evidence/verified-snapback/todos.q" snapback/todos.q
cp "$dx_evidence/verified-snapback/tests/complete.test.ts" snapback/tests/complete.test.ts
./node_modules/.bin/snapback2 check --json

# Unsupported selector exits 2; the broader test commands pass.
./node_modules/.bin/snapback2 test --changed snapback/todos.q --json
./node_modules/.bin/snapback2 test --journeys-only --json
./node_modules/.bin/snapback2 test --json
./node_modules/.bin/snapback2 run todos.complete '{"todoId":"todo-1"}' --as alice --json
./node_modules/.bin/snapback2 run todos.list '{}' --as alice --json
./node_modules/.bin/snapback2 dev --stop --json
```

For the behavioral negative control, change only `update todos[todoId] { done: true }` to `done: false` and run journey-only tests; restore it before the green run. For the chat cohort, initialize another consumer with `--template chat --client none`, use [chat-package-lock.json](evidence/chat-package-lock.json), install with `npm ci`, and run four serial `check` / `test --json` pairs. Its unchanged authored files are retained under [chat-snapback](evidence/chat-snapback/). The exact executed commands and their timestamps are in [timings.jsonl](evidence/timings.jsonl); the temporary [measurement helper](/Users/ccheever/bench-snapback2-dx/published-0.0.14/measure.py) and [hot-edit probe](/Users/ccheever/bench-snapback2-dx/published-0.0.14/hot-edit.py) remain locally available. No new repository measurement script or gate was introduced.
