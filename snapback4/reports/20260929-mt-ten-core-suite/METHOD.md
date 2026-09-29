# Reproduction method

The first command was `git fetch origin && git merge origin/main`; it returned
`Already up to date` at `ee514de117825183731eb0c215463f99c4775fe4` on
`sb4-intent/mt-ten-core-suite`.

From `snapback4/`, the baseline command was:

```sh
systemd-run --user --scope --unit=sb4-mt-baseline --quiet \
  -p MemoryMax=64G -p MemorySwapMax=0 \
  taskset -c 0-9 bash -c '
    ulimit -n 4096
    unset SNAPBACK4_RUST_TEST_PROCESSES SNAPBACK4_TEST_SERIAL_CLIENT_FILES SNAPBACK4_BIN
    export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
    /usr/bin/time -v bash scripts/test.sh
  ' > reports/20260929-mt-ten-core-suite/baseline-10cpu.log 2>&1
```

Node reported `availableParallelism() = 10` and `cpus().length = 96` in the
same kind of scope. Cgroup readback was `memory.max = 68719476736` and
`memory.swap.max = 0`. All descendants inherit the affinity. The 64 GiB cap
does not manufacture pressure when the suite uses less memory; no unrelated
memory load was started on this shared machine. Existing other lanes may run
on the host. The office M1 was never contacted or loaded.

The worktree started without `node_modules` or `target`. Dependency setup was
`BUN_INSTALL_CACHE_DIR="$PWD/target/mt-tools/bun-cache" bun install --frozen-lockfile`.
Existing Node, Bun, Rust, wasm-bindgen and cached Chromium were used. No new
tool was installed on a shared path. The recorded development/test debug
environment was inherited and kept constant across all runs.

Baseline code and test files were unmodified throughout the reproduction;
only documentation was drafted while it ran. Each verification run executes
the whole `scripts/test.sh` with concurrency overrides unset. No model count,
test filter or shard override is supplied. The unpinned verification removes
`taskset` but retains the memory cap and the same build inputs.

Node's default text reporter records individual durations, and Rust's runner
records target durations. A passing Rust harness suppresses individual test
timings; target duration must not be represented as a single test's duration.
Warnings, inherited ignored/skipped tests, assertion failures and cancellations
are distinguished in the final report.


The final trio ran sequentially on unchanged source: `proof-10cpu-1`,
`proof-10cpu-2`, then `proof-unpinned`. Qualified script/fixture hashes are in
`environment.json`. The report uses each suite's own elapsed-time footer;
`.start`/`.end` include up to one additional 20-second resource-sampling poll.
Per-run summaries preserve raw-log SHA-256 digests, complete stage counts and
selected case durations. No full-run failure was discarded: preceding trials
and focused reproductions remain separately named with their failure records.
