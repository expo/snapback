# Busy-group qualification

Run from `snapback4/` on eb1000 with the workspace's pinned Node, Bun, Rust,
wasm-bindgen and Binaryen, and the Chromium located by `witness/lib.mjs`.

```sh
bun install --frozen-lockfile
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
python3 reports/20261001-bg-busy-group-render/tools/instrument-server.py
BG_RUNS=50 BG_OUT=/tmp/bg-debug.json node reports/20261001-bg-busy-group-render/tools/measure.mjs
BG_PROFILE=production python3 reports/20261001-bg-busy-group-render/tools/instrument-server.py
BG_PROFILE=production BG_RUNS=50 BG_MAX_P95=500 BG_OUT=/tmp/bg-production.json node reports/20261001-bg-busy-group-render/tools/measure.mjs
node reports/20261001-bg-busy-group-render/tools/summarize.mjs /tmp/bg-debug.json /tmp/bg-production.json
```

The instrumenter restores all temporary source edits in `finally`. Do not edit
those sources or build another target concurrently. Its separate measurement
binary stamps after the SQLite mutation commit and around live count
certification. It does not add a shipping hook. Build the ordinary binary again
before tests. Run exactly the same profile before and after; a debug/production
comparison is not a fix measurement.

The script owns a disposable `snapback4 dev --port 0 --no-watch`, three independent
Chromium contexts and real wasm/IndexedDB devices. It uses the calibration's
unaltered schema and config, the app facade, history, decorations, room, member,
typing, delivery and seen mutations. The React DOM fixture mounts the builder's
20-row window; the server holds 10,000 messages and 50 members. Source acquisition
is the builder's declared last 500 messages. The 47 inactive members retain unread
history. Extra global conversations, the Expo shell, media and the digest worker
are outside this fixture. No sync is forced after a measured send. Samples retain
both remote viewers; the headline statistic uses the slower viewer of each send.

`BG_SEED_CACHE=/tmp/bg-seed` optionally reuses a SQLite online backup of the seeded
state. The companion JSON contains temporary password-session credentials and
must stay outside the report/repository. It is created mode 0600. Each run gets a
new copy and still acquires real devices. Omit the option to seed from scratch.
The cache does not contain measured writes. `BG_POLLERS` adds optional passive
pollers; it defaults to zero. The calibration population is 50 members, not 50
simultaneously held polls. The server's unchanged wait-worker limit is 32.

All event stamps are Unix milliseconds on one host. Device wrappers capture
call start, committed callback and return. For these non-search operations,
`search: true` requests the dispatcher's existing meter envelope; the interpreter
enters retained-search mode only for an operation with a search descriptor, which
none of the mounted local queries has. The test does not change the interpreter,
SDK scheduling, retention or read result. Fetch wrappers preserve streaming bodies
and record EOF, wire bytes, watermark and server timing. A public observation
records publication; React `useLayoutEffect` records the matching committed DOM.

The raw trace preserves every request and evaluation, including receipt follow-up
work. Stage summaries select the sync/apply whose watermark reaches the send,
then the history evaluation and publication. Concurrent live-count spans are
reported as the largest matching span inside that sync interval; they are not
summed. Percentiles use nearest rank. Core durations, transport waits and query
calls can overlap; adding percentile columns is not valid.

The final script also retains a continuous trace across sample boundaries and
waits for the last send's notification on all three devices after measuring its
render. An already active sync can render before the corresponding poll returns.
Earlier baseline runs captured per-sample windows; missing notifications in
those files stay missing. No timestamp is inferred from a later window. The
browser lock wrapper records only acquisition/release times and opaque event IDs.
It changes neither lock options nor the protected work.

The explicit p95 assertion is for the shipping `production` build. The default
unoptimized Cargo build is measured separately and remains above 500 ms. Omit
`BG_MAX_P95` when recording an expected failing baseline. The two final shipping
runs (50 sends each) are both retained; the continuous-trace qualification is
the reported final run. Raw JSON is stored as `.json.gz`; summaries remain JSON.

The original LL small-group harness is retained at
`reports/20260929-ll-live-latency/tools/measure.mjs`. It uses 20 repetitions of all
eight flows. Run it with `LL_KEEP=viewed LL_TIER=wasm LL_RUNS=20 LL_OUT=...` against
the matching debug measurement binary, then its `summarize.mjs`. Its media-ready
and quote timings remain separate from message rendering.

Verification run from `snapback4/` (the full suite was invoked once):

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-core --lib engine::row_views:: -- --nocapture
node --test --test-concurrency=4 packages/snapback4/test/web-session-authority.test.mjs packages/snapback4/test/app-local-session.test.mjs packages/snapback4/test/query-publication-session.test.mjs packages/snapback4/test/per-row-*.test.mjs packages/snapback4/test/retention-*.test.mjs packages/snapback4/test/live-propagation*.test.mjs packages/snapback4/test/answer-row-authority.test.mjs packages/snapback4/test/keep-authority*.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test -p snapback4-lang --test guide
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh
```

After correcting the changed await census, run the affected audit and all its
fault cases with `node --test packages/snapback4/test/delivery-fault-matrix.test.mjs`.
Run `./ref-check --verbose` from the repository root. The SQLite build flag was
held fixed for every server build, before and after.


## Round 1

The round-1 idle assertion is `BG_MAX_P95=250`. Preserve matching round-0 and
round-1 production measurement binaries outside the repository, then run each
against its matching built client. After each clean SDK build, add the optional
client trace with `python3 reports/20261001-bg-busy-group-render/tools/instrument-client.py`.
It modifies only ignored `dist/`; rebuild the SDK to remove it. The page also
records synchronous wasm spans, IndexedDB transaction lifetimes, raw local
publication and app facade checks. No trace adds a wait to the shipping flow.

```sh
BG_PROFILE=production BG_RUNS=50 BG_MAX_P95=250 BG_SEED_CACHE=/tmp/bg-round1-seed BG_OUT=/tmp/bg-after-idle.json SNAPBACK4_BIN=/tmp/bg-round1-production node reports/20261001-bg-busy-group-render/tools/measure.mjs
BG_PROFILE=production BG_RUNS=50 BG_SEED_CACHE=/tmp/bg-round1-seed BG_OUT=/tmp/bg-after-loaded.json SNAPBACK4_BIN=/tmp/bg-round1-production python3 reports/20261001-bg-busy-group-render/tools/contended.py node reports/20261001-bg-busy-group-render/tools/measure.mjs
node reports/20261001-bg-busy-group-render/tools/summarize.mjs /tmp/bg-after-idle.json /tmp/bg-after-loaded.json
node reports/20261001-bg-busy-group-render/tools/attribute-client.mjs /tmp/bg-after-idle.json /tmp/bg-after-loaded.json
```

`contended.py` owns one CPU burner per affinity-visible logical CPU (96 here),
keeps them alive throughout the scenario, and reaps all its children in `finally`.
Client attribution clips and unions spans inside each named stage; IndexedDB,
facade and lock elapsed times overlap CPU and one another. They must not be
added together. Prediction means synchronous `admit`; other VM calls are
reported separately. Browser timings include scheduling, not just IDB service.

The negative control `negative-control.py` temporarily installs the six relevant
round-0 Rust implementation files, adds the new test module, and requires the
10k/100k work test to fail. It always restores sources. Do not run it alongside
edits or builds. The retained failure must name the work assertion, not a compile
error. Normal verification runs with the round-1 sources restored.


`host-load.py COMMAND...` samples `/proc/stat` once per second while running a
Linux qualification command and records host-wide busy CPU percentage and load
average. It does not pin or reprioritize the command. The final candidate
confirmation uses the wasm rebuilt by the full suite; both the earlier matched
artifact runs and the final confirmation are retained.

Final round-1 evidence uses `qualification-idle`, `qualification-loaded` and
`ll-final`. Wrap the idle command with `host-load.py`; wrap the loaded command
with `host-load.py python3 contended.py`. `SNAPBACK4_BIN` points to the final
production or debug measurement binary as appropriate. After measurement, run:

```sh
python3 reports/20261001-bg-busy-group-render/tools/qualify-round1.py
```

This validates the retained final traces and writes `round1/qualification-final.json`.
It accepts raw or gzip-compressed JSON. Rebuild the normal SDK and server after
measurement to remove ignored instrumentation artifacts. Qualification does not
publish or push anything.

## Round 2

The fixture, sample counts, profiles and idle p95 assertion are unchanged. Use
`/tmp/bg-round2-production` and `/tmp/bg-round2-dev` for the instrumented binaries,
with outputs under `round2/`. The candidate can reuse a copy of the round-0
`BG_SEED_CACHE`; adding the optional work version causes atomic count adoption.
Round 2's negative control is `python3 tools/negative-control-round2.py` (paths
relative to this report). It installs the relevant `4277a65cf4` production files,
requires both property tests and the exact-page regression to fail assertions,
and restores the candidate. Run without concurrent builds or source edits.

After the two BG scenarios, their summaries and the unchanged LL harness, run
`BG_ROUND=round2 python3 reports/20261001-bg-busy-group-render/tools/qualify-round1.py`
from `snapback4/`; the original trace validator now accepts the report subdirectory.
The full suite runs once with ordinary sources/client artifacts restored. Its
wasm digest must equal the artifact used by the measurements; retain its exact
terminal summary and every failed test even when a later affected rerun repairs it.
