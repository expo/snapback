# Round-3 inputs and reproduction

`build-qualify.sh` records the production profile, SQLite flags and affected
checks. `measure.sh` records the exact experiment order and invocations; run it
after all owned compilation/tests have stopped. It never stops other tenants.
All commands assume Node 24, pinned workspace dependencies, and 4,096 descriptors.
The recorded runner waits for local `target/ct-round3/{final-ready,post-suite-ready,baseline-ready}`
sentinels. They mean the final build, post-correction checks and isolated-main
control have finished. On a reproduction, complete those steps and create the
three empty files before invoking `measure.sh`; use fresh output directories.

The three executables are local artifacts under `snapback4/target/ct-round3/`:

- `ordinary`: round-2 source 32e111fff0, ordinary-all maintenance. SHA-256 matches
  round2/custody.json's `restored` binary.
- `demoted`: the same round-2 source plus round2/inputs/maintenance-demotion.patch,
  matching round2/custody.json's binary. Every round-2 fix is present; “round 0”
  identifies only its maintenance priority policy, not old request-worker code.
- `split`: current round-3 source, same production profile and SQLite flags.

Rebuild ordinary from an isolated checkout at 32e111fff0 with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --profile production`
inside `snapback4/`; copy the executable, apply the retained demotion patch and
build/copy again. Build split from this commit with the same command. The binary
and source hashes in custody.json bind the artifacts actually measured.

Prepare once with the ordinary binary:

```sh
node scripts/contended-reads.mjs --prepare --work target/ct-round3/pristine --binary target/ct-round3/ordinary --out reports/20261001-ct-contended-reads/round3/prepare
```

This replays the actual packet through 50%, verifies the builder invariants,
then stops the server. Do not start that pristine store again. Its preparation
snapshot had 6,551 pending deliveries; after orderly server shutdown the stopped
snapshot has 6,507. Every drain trial copies that same closed project/store into
a fresh `--work`. Database bytes, actor credentials, minted tokens, generated
projects and binaries remain ignored local artifacts, not committed evidence.
The stopped SQLite database **and committed WAL** byte counts/SHA-256 values, plus every initial queue count, are in each primary-trial metadata file. Copy the entire closed project, including its WAL; the base database alone does not contain every committed frame.

The corrected small mixed fixture is unchanged by default. `--following-backlog`
adds the tested timeline fixture, 100 followers and ten 100-post mutations,
producing 1,000 real delivery tasks. It scopes physical expiry observation to
`items`, observes delivery every loop and through the final tail, and records
completion after the real-clock window when necessary. No direct queue injection
or replay/clock advance creates its delivery work. The original exact 1,000 ms
lease-extension probe still precedes the real-clock window.

`contended-drain.mjs` uses the pinned published client and same eight queries,
23 sequential calls/cohort and first-three warmup exclusion as the original
builder. An independent Node worker performs read-only queue observations so SQL
polling does not block the probe client's event loop. All raw responses retain
normalized digests (`asOf` only excluded); Following answers may evolve during
drain. The conservative during-drain distribution includes responses completed
before the last positive queue observation. Every trial then waits for settlement
and records all eight final answer digests for cross-design equality.

Full-suite command (once, after smokes, before timed comparisons):
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh`,
with `ulimit -n 4096` and Node 24 on PATH. Final source contains no performance
switch or environment-selected production scheduler; variants are separate builds.

The final corrected server check is `cargo test -p snapback4 --bin snapback4`
with the same SQLite environment and descriptor limit. The four follow-up
integration targets are recorded in `post-suite.sh`. The measured split binary
is rebuilt from that corrected tree; the sole complete suite had already
compiled the earlier server target when the timing fix was made.

The current-main control archives commit
`738d45830c9d51c9c92f65180c56cbecb2f2b068` under `target/ct-round3/current-main/`,
builds its own client/wasm, and runs the same `delivery-fault-matrix.test.mjs`.
Its 321 passing cases do not establish an inherited failure: the original
fault-reachability red did not reproduce on either CT or current main. See the
failure ledger and `qualification/main-*` logs. Main is not merged.

Development smoke projects are retained locally under `target/ct-round3/retained-projects/`; report raw sample/backlog/server files may be losslessly compressed as `.gz` with deterministic headers. `summarize.py` accepts plain or compressed records.
After all primary exits are zero, `archive.py` moves each generated mixed project
to that ignored directory as `<run>-<level>` and compresses the raw observations.
It preserves every database locally and keeps credentials out of the report.
Qualification logs with intentional trailing blank lines are also retained
byte-for-byte as `.log.gz`, so raw tool output does not create whitespace errors.
Where a record names a `.log`, use its `.log.gz` counterpart if compressed.
Run `summarize.py` afterward to regenerate both measurement tables and check
the cross-trial store manifests and settled answer digests.
