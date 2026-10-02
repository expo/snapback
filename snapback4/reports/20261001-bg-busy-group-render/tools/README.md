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
