# Rerun the two-client measurement

Run from `snapback4/`, with Node 24, Bun, Rust, wasm32-unknown-unknown,
wasm-bindgen and Chromium installed as for this workspace's normal tests.
`witness/lib.mjs` locates Chromium; Playwright and Vite come from the workspace.
Use an isolated checkout with no other compiler or test workload running.

```sh
bun install --frozen-lockfile
python3 reports/20260929-ll-live-latency/tools/instrument-server.py
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build -p snapback4
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
LL_KEEP=viewed LL_TIER=wasm LL_RUNS=20 LL_OUT=/tmp/ll-wasm.json node reports/20260929-ll-live-latency/tools/measure.mjs
LL_KEEP=viewed LL_TIER=process LL_RUNS=20 LL_OUT=/tmp/ll-process.json node reports/20260929-ll-live-latency/tools/measure.mjs
LL_KEEP=viewed LL_TIER=wasm LL_RUNS=20 LL_LOAD=3 LL_OUT=/tmp/ll-wasm-loaded.json taskset -c 0-3 node reports/20260929-ll-live-latency/tools/measure.mjs
LL_KEEP=viewed LL_TIER=process LL_RUNS=20 LL_LOAD=3 LL_OUT=/tmp/ll-process-loaded.json taskset -c 0-3 node reports/20260929-ll-live-latency/tools/measure.mjs
node reports/20260929-ll-live-latency/tools/summarize.mjs /tmp/ll-wasm.json /tmp/ll-process.json /tmp/ll-wasm-loaded.json /tmp/ll-process-loaded.json
```

Select permitted CPU IDs on another host. `taskset` is Linux-specific. Its
affinity is inherited by server, browser, devices and load workers. `LL_LOAD=3`
starts three owned busy workers and stops them in `finally`; affinity alone
does not simulate load. `LL_KEEP=none` is a separate no-retention experiment.
The run owns disposable server/device directories and two separate password
accounts and Chromium contexts. It does not use a hosted backend or credentials.

The instrumenter temporarily adds a post-transaction timestamp, copies the
result to `target/debug/snapback4-ll-measure`, and restores source in `finally`.
Run the ordinary build afterward to restore the uninstrumented process device.
Do not run concurrent builds or edit the engine during that temporary edit.
There is no shipping telemetry hook. The harness wraps only public SDK fetch,
device and observation interfaces. Process receiver calls cross a Playwright
bridge; process sender lives in Node because browser journal custody correctly
refuses a process writer. Both still use `createLocalClient`/`processDevice`.

For a baseline, build an isolated checkout at
`a5e690077a4474eebc0f9dfeb26f7fc1e60d792f`, copy these tools into the same report
path and run the same commands before applying the product changes. Keep output
separate. Baseline artifacts in this report used the existing lane-ea wasm
artifact as described in REPORT.md; build from source for a new qualification.

`summarize.mjs` accepts `.json` or `.json.gz`. `render-stages.mjs` renders all
summary files in this report directory. No timers are advanced in the causal
regressions except zero-delay queue turns and the explicitly named retention
expiry cases:

```sh
node --test packages/snapback4/test/live-propagation.test.mjs packages/snapback4/test/media-dependencies.test.mjs
node reports/20260929-ll-live-latency/tools/negative-controls.mjs
```

The negative controls temporarily mutate built `dist` in place, expect three
assertion failures, and restore it. Run them without concurrent SDK consumers.
Raw samples include all trial events and no session credentials. An `at` is UNIX
milliseconds; the commit stamp precedes HTTP wake delivery. A timeout is kept in
the raw output and does not silently trigger another attempt.
