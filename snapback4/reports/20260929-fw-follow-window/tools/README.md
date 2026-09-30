# Following publication probe

Adapted from `../../20260929-ll-live-latency/tools/`: two password accounts,
separate Chromium contexts, real `webDevice` or `processDevice`, the public SDK,
fetch/device timestamps, and React layout commits. Alice creates three posts
and reposts the first. Bob mounts `cards`, then follows/unfollows her 20 times.
The fixture is the maintained Following guide example with password identity.

Run from `snapback4/` with Node 24, Bun, Rust, wasm-bindgen and Chromium:

```sh
bun install --frozen-lockfile
python3 reports/20260929-ll-live-latency/tools/instrument-server.py
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build -p snapback4
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
FW_TIER=wasm FW_OUT=/tmp/fw-wasm-idle.json node reports/20260929-fw-follow-window/tools/measure.mjs
FW_TIER=process FW_OUT=/tmp/fw-process-idle.json node reports/20260929-fw-follow-window/tools/measure.mjs
FW_TIER=wasm FW_LOAD=3 FW_OUT=/tmp/fw-wasm-loaded.json taskset -c 0-3 node reports/20260929-fw-follow-window/tools/measure.mjs
FW_TIER=process FW_LOAD=3 FW_OUT=/tmp/fw-process-loaded.json taskset -c 0-3 node reports/20260929-fw-follow-window/tools/measure.mjs
node reports/20260929-fw-follow-window/tools/summarize.mjs /tmp/fw-*.json
node --test reports/20260929-fw-follow-window/tools/follow-window.test.mjs
```

Select permitted CPU IDs on another host. Each run owns and stops three busy
workers for contention; server, browser, Node and devices inherit four-CPU
affinity. Idle uses the host's allowed CPUs without harness load. Do not run
builds/tests during measurements. `FW_RUNS` overrides 20. Timeouts stay in the
output and fail the run; no retry replaces a sample.

LL's instrumenter temporarily changes the engine, builds a separate measurement
server and restores source in `finally`. Do not run other builds while it owns
that edit. The ordinary build restores the uninstrumented process device. The
instrumented server is used for both arms; no telemetry ships in the product.

For the baseline, copy these tools to an isolated checkout of
`6a2eaebf414599670d84d01c9302f5dc051ddb30` and run the same commands there.
Keep its outputs separate from the fixed arm. The report retains the original
source commit, all raw samples and the instrumented server hash.
For process-only comparisons, `FW_LOCAL_MODULE=/absolute/path/to/dist/local.js`
selects an independently built baseline SDK while keeping the same server and
process-device binary. Only Bob's device/transport events enter the stage trace;
Alice has a separate trace. The archived `superseded-process/` runs predate this
separation and must not be used to attribute the apply stage.

On wasm, SDK observations and the React screen live together in Bob's browser.
On process, Alice and Bob each use a Node local client on a real SQLite device;
Bob's published snapshots cross a sequential Playwright bridge to React. Browser
admission requires a synchronous web journal, so a process writer is correctly
hosted in Node. Process React timings include that bridge and are not native UI
latencies. Publication timestamps are taken before crossing it. Every published
answer and every rendered React commit is retained, even identical flags.

The screen checks denial, then loading/revalidation/incompleteness for
“Updating…”, then renders event keys or “No posts”. Pending writes are sampled
on SDK pending notifications, separately from answer publication. A read has no
top-level pending flag; each returned row can carry `pending`. Full read JSON
retains it. Snapshots, operation state and row publication are distinct facts.

The regression holds mutation transport before execution and sync before apply;
`/changes` is parked. Promise releases, device replies and SDK notifications
drive assertions; host timers remain frozen except zero-delay queue turns. Its
30-second timeout is only a deadlock guard. Both retention
policies, ordinary and zero-wait calls, idempotent refollow and self-follow
refusal run on wasm and process. The package test file imports this harness so
`scripts/test.sh` runs it too. No wall-clock latency threshold is asserted.

`summarize.mjs` accepts JSON and gzip, uses nearest-rank p50/p95, reports sample
counts for every stage, retains each published/rendered sequence and counts
complete/fresh/unmarked answers with the old cardinality. Its misleading-duration
measure also includes the initial answer still visible between call and first
mark. All clocks use the same machine's UNIX milliseconds. The report describes
the scope and limitations of the measured fixture.
