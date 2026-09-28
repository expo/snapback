# Reproduction tools

Run from the repository root. All servers and stores below belong inside this
worktree. Never run a dev server against the supplied read-only evidence.

The tools use Node 24, Python 3's sqlite3, and the built local client. No global
installation is needed. Build the server with the package's SQLite flag:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --manifest-path snapback4/Cargo.toml --profile production
(cd snapback4 && bun install --frozen-lockfile && bash scripts/build-wasm.sh && bun run --cwd packages/snapback4 build)
```

`target/pf/` is the retained, ignored reproduction workspace for this run:

- `replay/`: writable copies of the builder's `snapback/` and `scripts/`;
  `scripts/replay.mjs` is replaced by `replay-adapter.mjs` here. Its mutations,
  ID mapping, uploads, prefix validation and `verifyScale` are the builder's.
  Password signup/login calls the same SDK authentication directly, bypassing
  the copied harness's unavailable browser. `instrument/fixtures` links to this
  checkout's `benchmarks/fixtures/social-messenger`, whose scale log matches the
  frozen hash. `node_modules/snapback4` links to this checkout's built package;
  `node_modules/.bin/snapback4` links to its production binary.
- `snapshot.py`: Python SQLite backup, called at each verified checkpoint;
  stores both the consistent database and that checkpoint's private user state.
- `10pct/`, `50pct/`: those snapshots, each with `snapback/` and `.snapback4/`.
- `full/`: a writable copy of the original full database **and WAL**, with
  the builder's source. `original-state.private.json` is its private state.
- `snapback4-before`: the production binary retained before any lane changes.
- `snapback4-after`: rebuilt production binary with the empty-preflight optimization.

Start replay in `target/pf/replay` with the copied binary's
`dev --port 49461 --replay --no-watch`. Set `REPLAY_STATE` to
`$PWD/evidence/replay-scale`, `REPLAY_BACKEND_DIR=$PWD`, and
`SNAPBACK_URL=http://127.0.0.1:49461`. Run the three `starter-m{1,2,3}.log`
segments followed by `scale.log` through `scripts/replay.mjs`.

**The adapted replay deliberately stops at the verified 50% checkpoint.**
Its retained `result.json` is a checkpoint-production receipt, not a claim
that this host replayed all 167,157 scale actions. The supplied full store
provides the full-scale point. Its original verification receipt is preserved
separately. No source fixture, ceiling, action, mutation or invariant was changed.

For the ordinary-search supplement only, append to each snapshot's `chat.q`:

```text
query pfOrdinary(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c
```

The exact original `chat.searchMessages` and `insights.summary` stay unchanged.
Serve the three copies with the retained binary, `--replay --no-watch`, on
49462 (10%), 49463 (50%), and 49460 (full%). Keep all started PIDs; stop only
those PIDs. `--replay` suppresses new effects and holds schedules, as in the
builder runner. It does not bypass read rules or meters.

`PF_ROOT=target/pf node <this-directory>/curve.mjs before` runs nine balanced
rounds, rotating checkpoint order. Each operation uses the exact builder
`read` helper, arguments, principal and ten-sample percentile positions.
Three warmups per operation precede recording; these warmups are an explicit
experimental addition. Every request records `Server-Timing` with the SDK's
unchanged Node dispatcher. `doctor --latency` is reset after warmups and saved
before the ordinary/overlap supplement. No work from replay or our compilation
runs concurrently with the official curves. Stop only the three recorded server
PIDs, restart those same store copies with `snapback4-after`, then run
`PF_ROOT=target/pf PF_BIN=target/pf/snapback4-after node <this-directory>/curve.mjs after`.
The physical-work delta is stronger causal evidence than a wall-clock repeat
on a shared host.

For SQLite attribution, back up each running copy to a separate `*-trace.sqlite`
using Python SQLite backup, then:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo run --manifest-path snapback4/Cargo.toml --profile production --example pf_scale_probe -- target/pf/10pct-trace.sqlite '<u0500 principal from private state>'
```

The probe records parameterized plans, statement calls, VM work, scans, sorts,
and connection page-cache hits/misses for three reads. It does not print bearer
tokens. The callback subtracts the counters observed at statement entry from
those at completion; these are per-execution counter deltas, not a wall-clock profile. This
fixed convention is identical at every checkpoint; it is not the runtime meter.

The committed evidence uses deterministic gzip for large JSON/JSONL files.
Private states, tokens, databases, node_modules and binaries stay ignored.

After the full suite drains and those three ports are free,
`python3 <this-directory>/paired-control.py` performs an adjacent before/after
control on the same copied stores. It starts and stops only its own server
children, preserves the nine-round method, and records separate
`control-before` / `control-after` artifacts. These supplement the original
measurements; they do not replace a failed rule with a successful repeat.

`tools/summarize.py` produces the tables, every batch with host load, and the
chart. Its optional matplotlib dependency was installed under `target/pf/pydeps`;
set `PYTHONPATH=$PWD/target/pf/pydeps` and
`MPLCONFIGDIR=$PWD/target/pf/mpl-cache` when regenerating it.
