# Reproduce PRL qualification

From the repository root, install/build using Snapback 4's own workspace and
pinned toolchain. The recorded host uses Node 24.13.1, Bun 1.3.14 and Rust 1.97.0.
Build the wasm and SDK **before** starting repetition inventories; do not rebuild
artifacts while any cohort runs. The browser fixture uses Vite aliases to source
TS, plus the built SDK for its native adapter and local wasm artifact.

From `snapback4/` after `bun install --frozen-lockfile`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
bun run --cwd packages/snapback4 typecheck
mkdir -p target/prl-load
cc -O2 reports/20260929-sl-suite-under-load/busy.c -o target/prl-load/busy
cc -O2 reports/20261001-prl-per-row-loading/confine.c -o target/prl-load/confine
python3 reports/20261001-prl-per-row-loading/repeat.py unconfined-final-50 50 node --test --test-reporter=tap packages/snapback4/test/per-row-react.test.mjs
python3 reports/20261001-prl-per-row-loading/run-load.py loaded-final-50 48 -- python3 reports/20261001-prl-per-row-loading/repeat.py loaded-final-50 50 node --test --test-reporter=tap packages/snapback4/test/per-row-react.test.mjs
```

The two final runners were launched concurrently (with the affected suite also
running initially). Unconfined means the runner and browser have all 96 CPUs
available; the load workers still occupy CPUs 86–95 during that overlap.
The confined runner and every descendant inherit exactly those **ten CPUs**.
SL's busy worker is unchanged; its 48 workers use constant memory and no I/O.
The adapted guard refuses affinity changes in descendants, including threads,
without changing host policy. Parent/thread/child negative controls preserve the
mask and return EPERM when broadening it. The wrapper records worker survival,
CPU time, binary hashes, source diff hashes, PIDs and all test overrides; cleanup
terminates only its own workers. See `loaded-final-50.json` and
`raw/affinity-controls.json`.

`repeat.py` records every run's exit and duration and hashes sources, wasm and
built SDK before/after. It never retries failures. Each file contains **seven**
cases, including the unchanged original online test, the new causal/refusal
controls and all three real-clock local-device tests. The report records full
cohorts, not fifty selected passing samples.

The final affected command is Node's test runner with `--test-concurrency=8`
and every path in `affected-hardened-files.json`. No seed override is applied;
both RL oracles retain their full 300-seed/history counts per device.

The once-only complete suite command was:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT python3 reports/20261001-prl-per-row-loading/repeat.py full-suite 1 bash scripts/test.sh
```

Its source input inventory precedes the final callback-boundary correction;
see REPORT.md for the precise qualification scope. It rebuilt wasm, so the
first overlapping unconfined cohort was explicitly invalidated and repeated
with frozen artifacts. Never combine the preliminary cohorts with final counts.

The retained `trace.probe.mjs` and `worker-diagnostic.probe.mjs` are diagnostic
source snapshots, not additional suite files. To rerun them, copy one into
`packages/snapback4/test/` in an isolated worktree (their imports are relative
to that location), run the named test, then remove that diagnostic copy.

After the callback-boundary correction, `final-clients.py` repeats exactly the
script's 279-file client pool (default 24 slots on 96 CPUs) and both full-count
model files (one slot), without invoking a build. The pool found one stale await
census hash, ours; all other runtime tests and the models passed. The audited
manifest/comment correction is applied after the frozen cohorts, then the full
321-case delivery matrix is rerun in this lane. See the failure ledger.
