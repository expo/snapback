# Snapback 4 — agent command sheet

Read this, then [LLP 3000](../llp/3000-snapback4.explainer.md) (the root and
the bakeoff protocol), [LLP 2000.000](../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md)
(the design brief), [`NOT-DOING.md`](./NOT-DOING.md), and the tail of
[`JOURNAL.md`](./JOURNAL.md). `rules/RULES.md` at the repository root is
adopted here as written; LLPs for Snapback 4 are numbered **3000 and up**
(`llp-create --under 3000` for a child; extend LLP 3000 or LLP 2000.000
before minting a new number).

```
cargo build                          # the binary; no JS engine, no bootstrap; crates.io plus one vendored patch (vendor/tiny_http)
scripts/test.sh                      # everything blocking (60 s budget); reports every failure, never fail-fast
./target/debug/snapback4 --help      # init [--online|--expo] · check [--cost|--residency|--fix|--json] · dev · deploy · rollback · serve · run (an op, or a job as the system) · test · why · guide · data · sql · token (a service's seat) · doctor · device · types · --version
./target/debug/snapback4 guide       # lists cards and aliases; `guide language` for the language card — every card's Quarry is compiled by the suite (crates/snapback4-lang/tests/guide.rs)
cd apps/chat && ../../target/debug/snapback4 check     # compiles snapback/*.q, writes snapback/generated/api.ts
cd apps/chat && ../../target/debug/snapback4 dev       # serves 127.0.0.1:4400; re-adopts the schema on save
cd apps/chat && bun run dev                            # the app on the real client (?as=bob picks a persona)
bun run --cwd packages/snapback4 typecheck   # the contract, the client and the hooks typecheck
cargo test -p snapback4-core --test corpus -- --nocapture   # the conformance corpus, with skip reasons
cargo test -p snapback4-difftest     # fixed seeds, oracle regressions and replay (opt-in, no database by default)
cargo run --release -p snapback4-difftest -- run --seed 0 --cases 100000 --workers 6 --out /tmp/quarry-difftest
cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/rewrite-identity--why--NOT_FOUND
cargo run --release -p snapback4-difftest -- run-devices --seed 0 --cases 100000 --workers 8 --out /tmp/quarry-devices   # server against both device stores; no database
cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/device-sqlite--heap-bytes-data--loading
(cd lean && lake build) && cargo run --release -p snapback4-difftest -- run-lean --seed 0 --cases 100000 --workers 8 --out /tmp/quarry-lean   # the engine against the Lean model (LLP 3000.035 §5.2); ~900 cases/s on 8 workers
cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--kind--committed~NOT_FOUND'   # needs the model built, or SNAPBACK4_LEAN_ORACLE=<quarry-oracle>
./target/debug/snapback4 check --emit-lean schema.q   # one checked file as the Lean model's case JSON; programs outside its fragment listed with a reason
# Store tests require SNAPBACK4_EVAL_POSTGRES pointing to a private evaluation cluster.
cargo test -p snapback4-difftest --features postgres  # fails if the cluster is absent
cargo run --release -p snapback4-difftest --features postgres -- run-stores --seed 0 --cases 1000000 --workers 8 --seconds 10800 --out /tmp/quarry-stores
cargo run --release -p snapback4-difftest --features postgres -- replay /path/to/found-case
python3 scripts/test-difftest-scheduled.py  # runner/ticket tests; no schedule or push
scripts/difftest-scheduled.sh --checkout "$HOME/quarry-difftest-runner" --state-dir "$HOME/.snapback-quarry-difftest" --hours 3
# Operator only: install daily launchd (Darwin) or user systemd timer (Linux).
scripts/install-difftest-schedule.sh --checkout "$HOME/quarry-difftest-runner"
cargo test -p snapback4-sim          # the chat world under faults: the seven invariants
cargo test -p snapback4-sim --test exhaustive   # every sequence of two writes (two viewers, two groups): disclosure and write authority against a model of the rules
SNAPBACK4_EXHAUSTIVE_DEPTH=3 cargo test -p snapback4-sim --test exhaustive -- --ignored   # three writes: ~7,000 states, minutes
scripts/kani.sh [harness...]         # Kani proofs of the key encoding (crates/snapback4-core/src/key_proofs.rs; minutes, ~12 GB peak); outside test.sh
(cd lean && ./check.sh)              # the Lean model of Quarry's core (LLP 3000.035 §5.2): lake build (~15 s cold, needs elan), no-sorry/axiom audit, 31 examples, the quarry-oracle I/O fixture; outside test.sh; open points in lean/OPEN.md
cargo test -p snapback4-sim --test native   # native jobs: builds native-fixtures/rescore for wasm32-unknown-unknown (cold ~20 s, then cached under target/native-fixture) and runs it
bash scripts/build-wasm.sh           # the device as wasm into packages/snapback4/src/wasm/ (the web tier and the Chromium witness need it); fails when the gzip exceeds metrics/wasm-budget.json — a landing that needs the bytes raises the budget in the same commit, with the reason
node witness/idb.mjs                 # the Chromium witness: the client on the wasm device over IndexedDB (needs Chrome)
WITNESS_UDID=<dedicated-udid> node witness/expo.mjs   # published witness verb/helper; freshly install apps/chat-expo Release first (simctl uninstall a previous build: its store belongs to an earlier backend); port 4400, no Metro
node witness/scale.mjs [G] [N] [M]   # cold sync at scale: G groups × N messages × M members into the wasm device; wall time + JS heap → metrics/witness.jsonl
node scripts/measure-storage.mjs     # what the store weighs on the scale seed (rows, indexes, partition log) → metrics/storage.jsonl
                                     # SNAPBACK4_BIN=target/release/snapback4 measures the release build (throughput numbers)
node scripts/measure-client.mjs      # each client tier's bytes on the pinned toolchain → metrics/client.jsonl
node scripts/attribute-wasm.mjs [--families] [--check-families] [--check-absent] # class bytes and concrete serde families; --check-families refuses non-text readers/non-Vec writers outside the exact dynamic-envelope, counting-writer and Scan map-replay allowlists; content-buffer families name the duplicated types and refuse Deserialize representations using untagged, tag or flatten; --check-absent refuses the core's prefetch, admission or log-event symbols in the web artifact (needs twiggy; slow, outside test.sh)
bash scripts/check-release-guard.sh # the web artifact's configuration plus the debug-only `web-device-check` feature must refuse to build (in test.sh)
bash scripts/measure-wasm.sh         # the device core as wasm (crates/snapback4-device), family-checked, bound and measured → metrics/wasm.jsonl
bash scripts/build-xcframework.sh    # the device as an iOS xcframework for packages/snapback4-expo (staticlib alone, stripped; 13.2 MB with native reads)
node loopbar/run.mjs --n 3           # the loop bar: fresh agents on the published pin build reduced Clique M1–M3 → metrics/loopbar.jsonl
node scripts/publish.mjs --prepare-client # rebuild wasm + clean client, pack once for cross-host qualification
node scripts/qualify-linux.mjs --client /path/client.tgz --out /path/qualification # Linux suite + Ubuntu/Alpine proof, no publish
node scripts/publish.mjs             # Mac: qualify/sign Darwin; optional --linux-receipt + --linux-tarball import; platforms before client
```

Crates: `snapback4-core` (value model, schema with `sync`, IR, key encoding,
SQLite store, rules with hoisting, the meter, the interpreter, the partition
log, at-most-once, the day-two classifier, wire forms), `snapback4-lang`
(Quarry lexer, parser, binder, diagnostics, the TypeScript emitter),
`snapback4` (verbs and the HTTP wire), `snapback4-sim` (the deterministic
world hosting the engine and a replica device), `snapback4-difftest` (seeded
Quarry source generator, rewrite and meter oracles, optional Postgres store
oracles with prefetch on/off, the server-against-device oracle on both device stores, the engine-against-Lean-model oracle, structural shrinking and replay; not published or linked by shipped crates), `snapback4-device` (the
interpreter over a `DeviceStore`: the core's SQLite under the native
module for Expo and Exact2 hosts, memory under wasm on the web; one
dispatcher, one suite on both)). The guide (`snapback4-lang/src/guide.rs`) is
the language card and the keyword cards; packages: `snapback4` (the client
over the device and the CLI shim), `snapback4-darwin-arm64` and `snapback4-linux-x64` (the binaries), `snapback4-expo`
(the Swift module over the device's C ABI).

What exists, by week (LLP 3000 §5):

| Week | Lands |
|---|---|
| 1 | the contract (`packages/snapback4/src/contract.ts`), the mocked chat app against it, the hub fixture wrapper, the five floor measurements in the journal, the simulator skeleton (`crates/snapback4-sim`), the Snapback 2 corpus copied in, 0.0.1 published |
| 2 | server: SQLite transaction and interpreter, rules and uniformity, the meter, the partition log (`sync`), generations, personas, the wire, `check`/`dev`/`run`/`test`/`why`/`guide`, the seven simulator invariants |
| 3 | web client: replica store, outbox with client-minted ids, local interpreter, reactive local queries, the online-only tier, the chat app on the real client |
| 4 | Expo client, day-two scenarios, deploy, the loop bar, the Clique hub run, the comparison record |

Gotchas you cannot derive from the code:

- Own Cargo and Bun workspaces; the repository root excludes them. Run cargo/bun from `snapback4/`. Node 24.x (`engines`): run the suite with the pinned runtime on PATH, not the ambient Homebrew node.
- Web builds require `bun install --frozen-lockfile` first. Binaryen 132.0.0 is
  an exact workspace devDependency; build/measurement invoke its portable
  `node_modules/binaryen/bin/wasm-opt` through Node, never a PATH optimizer.
  Missing/mismatched dependencies and optimizer failures refuse the build.
  See README's web-device build instructions and HV round 4 for host parity.
- The suite schedules client files in one pool: `max(1, min(24,
  floor(os.availableParallelism() / 3)))` slots (3 on 10 CPUs, 24 on 96).
  This counts Linux CPU affinity and leaves room for each file's servers,
  browser renderers and workers. Acquisition and server-e2e share that pool;
  there are no extra shard processes outside it. The two full-count model
  files retain a separate serial slot. `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`
  still forces one client file at a time. The external file watchdog measures
  time since a subtest started or finished: max(900 seconds, largest single
  declared guard + max(60 seconds, 25%)). There is no absolute duration cap.
  Console output does not count as progress. Serial mode uses the same bounds.
  See `scripts/run-client-tests.mjs` and the QF round-2 guard census; update
  named work counts and recheck the census when declarations change. Every
  file runs as native `node --test` with default isolation, in a process group
  whose first member is a tiny Node keeper. The runner closes the keeper's stdin
  on completion, stall or abort; only the keeper calls `kill(0, SIGKILL)`.
  Runner death also closes that pipe. An unexpectedly exited keeper fails the
  file and never authorizes a runner signal. Cleanup requires two consecutive
  completed inspections (50 ms apart) with no living group member. Observed leftovers
  fail as TEST_FILE_LEAK. Failed listings and unclassifiable PID/PPID/PGID
  prefixes remain fail-closed. A ps timeout at two seconds retries once with a
  60-second bound; all other command errors refuse immediately. Listings use
  asynchronous spawn so other files' timers and keeper EOF delivery keep running.
  File watchdogs and cleanup's five-second window use per-file monotonic time.
  Expiry requires another completed snapshot: a live group after the deadline
  refuses; two consecutive empty snapshots pass even when the second is late.
  Precisely
  recognized exit-time routing anomalies
  discard the whole snapshot and retry at most twice, 50 ms apart; persistent
  anomalies refuse and never confer ownership (LLP 3000 §7, QF2).
  Metadata is validated for group members and
  their visible descendants; unrelated rows only increment diagnostics.
  Signed Darwin UIDs, variable lstart spacing and comm spaces are accepted.
  Vanished members count as exited. Processes leaving the group (setsid,
  setpgid or detached spawns) are outside cleanup custody; visible descendants
  receive metadata validation but are never signalled by the runner. Native Node's exit
  status alone decides test success; reporter counts are diagnostic only.
  The reporter observes progress as Node delivers it: synchronous work that
  does not yield may buffer events in Node's child until that work finishes.
  Such an unreported interval is subject to the same stall bound. See QF Round 7.
  The M5 MacBook is the publication host; the office M1 is calibration-only.
- Before a publication dry run, warm the test artifacts **in that publication
  worktree**, while the host is free of calibration work:
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo test --workspace --no-run`.
  Use the dry run's toolchain, target directory, profile/features, `RUSTFLAGS`
  and Cargo profile environment. Do not add `--release` or `--profile production`:
  the suite uses the default test profile. The suite still asks Cargo for the
  complete test inventory, runs every binary and runs doctests separately.
  Warming compiles without executing tests and supplies no qualification receipt.
- One owner on the core (LLP 3000 decision 4): the engine, the store and the client contract are written by the lead session; Codex lanes take the fixture generator, the reference apps, the device witnesses and the periphery. Do not reshape `contract.ts` from a lane; propose the change in the journal.
- No ceiling is raised in slice one (LLP 2000.000 §12). A thing that does not fit changes the design or waits.
- The journal is append-only and dated; never rewrite an entry. LLP 3000 §7 carries decisions that must outlive it.
- Nothing here depends on `snapback2/` at runtime. Copy source deliberately, split under 1,500 lines on the way in, and say so in the journal.
- Named lane: `~/projects/snapback-sb4` on `sb4/*` branches. Never `git stash`; commit checkpoints.
- The conformance corpus (`corpus/`) is Snapback 2's serialized IR and value
  model; the core keeps those serializations so it binds. A case the slice
  cannot run is skipped with a named reason, never counted as a pass.
- `snapback/generated/api.ts` is built by `check` and `dev`, never committed;
  the app's typecheck needs a `check` first (the suite does one).
- Point rule probes and `exists` require a unique key. A fully pinned superset
  of a required unique key is unique too (for example an explicit role index
  containing the unique conversation/principal pair). Nullable unique key
  arguments need non-null proof. Other existence checks use bounded populations
  in code. Named equalities covering a total unique key check extra columns on
  that one row without an additional index.
- The packaged CLI uses `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` during both publication tests and its production build (LLP 3000 §7). A plain production Cargo build retains the dependency's ordinary SQLite policy; use the same build input when comparing with the package. The variable is unnecessary at runtime.
- When creating a stage, `scripts/publish.mjs` runs the suite and refuses on red, builds the production binary, packs `snapback4-darwin-arm64` and verifies the installed digest, then publishes both packages. Bump `version` in `packages/snapback4/package.json` (and its `optionalDependencies`), `packages/snapback4-darwin-arm64/package.json`,
  `packages/snapback4-linux-x64/package.json` and `Cargo.toml` together; a test refuses a mismatch.
- Publication retains exact qualified tarballs under `target/publication/`. If a
  stage exists, use `node scripts/publish.mjs --resume` to validate its recorded
  suite qualification, requalify those exact bytes through the installed-consumer
  proof, and finish missing registry artifacts; an existing version must match
  its staged integrity. This also applies after `--dry-run`. An ordinary invocation
  refuses an existing stage so changed source cannot silently publish old bytes.
  Bump the version to build a new pair; preserve a partially published stage.
- Cross-host publication (LLP 3000.021 §3.3): prepare the common client once
  from clean release source, qualify that tarball on Linux, and import the
  Linux tarball plus its receipt on the Mac. Source commit, client SRI and
  Linux SRI must agree. Linux prefers working Docker/Podman, otherwise uses checksum-pinned proot
  with clean Ubuntu 24.04/Alpine root filesystems in a user cache, and refuses
  `NPM_TOKEN` or `NODE_AUTH_TOKEN`, even when empty. It never signs or packs
  the client. The Mac never rebuilds or executes Linux; `--resume` rechecks
  its copied receipt. No receipt packs a Darwin-only client; an existing
  two-platform preparation is refused on that path. Packed dependencies must
  match the staged set. Uploads use verified private snapshots, with each
  digest checked again immediately before publish.
  Commands and current qualification limits:
  [`reports/20260927-lx-linux-package/REPORT.md`](./reports/20260927-lx-linux-package/REPORT.md).
- The guide is tested text. Every ```quarry block in `crates/snapback4-lang/src/guide.rs` and in `packages/snapback4/README.md` is compiled by `crates/snapback4-lang/tests/guide.rs` with no diagnostic and no note (the language card is also run against the engine); every refusal code the sources emit must be in `guide::CODES`; every `guide("..")` a diagnostic carries must name a card. Add a form to the language card when you add it to the parser, fence README Quarry as ```quarry, and never fence Quarry as plain text to dodge the test.
- Native jobs (LLP 3000.005) need `rustup target add wasm32-unknown-unknown`; the suite's fixture build fails loudly without it. The guest SDK `crates/snapback4-native` is a path dependency until it is published; an app's `snapback/native/Cargo.toml` names it by path.

Quarry store testing (LLP 3000.035 §5.1): `SNAPBACK4_EVAL_POSTGRES` is an
explicit evaluation connection. The factory owns one physical schema per worker,
restores its rows and bookkeeping, installs the compiled fixture, then opens the
ordinary engine. Mutation attempts restore a seeded snapshot; shrinking reuses
that same factory. `Database::connect_fresh()` is an opt-in test mode. Fresh and
restored outcomes must serialize to identical bytes. The local wire observer
retains SQLSTATE, message, detail and SQL statement before the public query API
converts a driver error to a refusal; it never changes the traffic.

Reads sweep every public boundary. Mutations compare every discovered position
twice on SQLite, and compare up to eight seeded positions per dimension on
Postgres (including first/last), plus the case's original budget. Sampling
counters are in `store_stats`; each selected position runs prefetch on and off.
Physical prefetch counters are separate from the exact public outcome record.
The present generator does not fill the Postgres prefetch cache: it emits no
per-row related-key lookup in a page loop, so its reads receive no prefetch marks.
The focused control in the DT-B report demonstrates that a consumed cached-hit
fault changes an outcome; the random campaign does not claim this coverage.
See the [prefetch coverage ticket](../issues/20261007-quarry-store-oracle-prefetch-coverage-gap.md). Store heap accounting also differs at low budgets; those
remain disagreements and ticket candidates, never normalized into passes.
The cluster regression asserts its known signatures and refuses new/missing ones.

`run-stores --seconds N` stops each worker between cases after N seconds; a case
and any shrinking already underway finish. `cases` remains the requested count,
`generated` is actual completed generation, and `time_limited_workers` reports
the early stop. Slowest-case timing includes generation, comparisons, shrinking
and artifact saving. It does not silently claim the requested million. The scheduled
runner rejects incomplete reports; its own `--hours` option instead chooses a
case count from a 256-case calibration of both campaigns, with 20% headroom and
a million-case cap. This is a sizing estimate, not a hard deadline.

Quarry device testing (`src/devices.rs`, `src/device_writes.rs`, LLP 3000.035
§5.1 oracle 4): each case runs on a server engine and on a device of each store
(native SQLite at a file path, and memory), both brought up through the client's
own path: the `/schema` backend as JSON text, then `local.ts::syncRound` (capture
`sync_state`, `/sync` snapshot pages built as `serve_sync.rs` builds them,
`observe_store`, `apply` through `call_text`, catch-up stream). Never seed a
device store directly. Reads the device publishes without the server (`complete`
with `unknown` false, or a known refusal) compare the whole outcome record
except `seq` (and server-only `delivery`); every other read counts under a named
reason (`online-only-*`). Low ceilings reach the device only through `call`'s
`spent` ledger (`default - n`), compared at the server's boundary positions.
Writes go through `admit`: a device refusal must equal the server's, a
predicted row must equal the committed one (less its `pending` marker), and
after `settle` plus a sync round the device must answer `observe` as the server
does. `run-devices` accepts `--seconds`. Known findings are retained under
`cases/found/device-*` with a `DIAGNOSIS.md`; `tests/devices.rs` replays them
and `tests/smoke.rs` pins the fixed-seed signature set.

The Lean oracle (`run-lean`, LLP 3000.035 §5.2): `snapback4_lang::emit::lean`
translates each generated program's surface tree (never the binder's IR) to
the model's case JSON; `quarry-oracle` (`lean/Oracle.lean`, one process per
worker) answers one tagged outcome per line; the engine runs on SQLite at
default ceilings. Compared: kind, refusal code, data (tagged: an id is not a
text), `complete`, `next` presence, each side's own continuation, and a
mutation's `observe` reread. Not compared: meter fields and sites. Programs
outside the model's fragment are named unsupported reasons, never passes.
`lean::generate` adds Lean-only variants (per-effect rules, a hidden probe
target, nullable/id orders, residual filters) aimed at `lean/OPEN.md`. A
disagreement is a Rust defect, a model defect (only when a document
contradicts the model: fix the model, rerun `lean/check.sh`), or an open
point (record the engine's behaviour in `OPEN.md`); never change the model to
match the engine without a document. Findings live in
`cases/found/lean--*` with `DIAGNOSIS.md`; `tests/lean.rs` replays them and
pins the open signature set. Lean-dependent tests skip loudly without the
built model; `SNAPBACK4_REQUIRE_LEAN=1` makes that a failure.

Quarry scheduled testing: prepare a separate clean clone whose current branch
can fast-forward to `origin/main`. The runner fetches/fast-forwards it and starts
its own socket-only evaluation cluster with `fsync=off`,
`synchronous_commit=off`, `full_page_writes=off`, `shared_buffers=1GB`, and
`max_connections=200`. It builds the Lean model's `quarry-oracle` first
(`lake build` in `lean/`; a host without `lake` fails the run), then runs the
SQLite, store, device and Lean campaigns on the selected
seed window, replays shrunk findings twice, and files/appends open `issues/*.md`
tickets. Only ticket changes are committed/pushed, with three fetch/rebase
retries. State and reports live outside Git under `--state-dir`; seeds advance
only after completed work and successful owned-cluster cleanup. Dirty/diverged
trees, overlap, setup failures, partial reports and failed publication refuse.
A crash can retain the lock and cluster directory; inspect `lock/owner.json`
and the run report. Never stop a cluster by process name.

`--dry-run --cases 32` writes previews and a separate `next-seed.dry-run.json`,
never commits or pushes. Dry runs may explicitly supply `--external-postgres
'host=... user=... dbname=...'`; that cluster is neither started nor stopped by
the runner. Ambient connections do not override normal private-cluster ownership.
The installer remains an operator action; do not invoke it during development.

The Lean oracle on a scheduled host (one-time, per user, no sudo): install
elan with `curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh -s -- -y --default-toolchain none`.
The runner finds `lake` on `PATH` or in `~/.elan/bin`; the first `lake build`
downloads the toolchain pinned in `lean/lean-toolchain` (Lean 4.34.1, no
Mathlib), so the first scheduled run needs network. Check by hand with
`(cd lean && ./check.sh)` in the runner's clone. `run.json` records the pinned
toolchain and the oracle binary's digest.
