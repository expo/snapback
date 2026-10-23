# Deltas from S1-PG2

The [S1-PG2 method](../results-20261022-snapback-postgres-2/METHOD.md)
applies unchanged except the following requested setup and observation deltas.

- Product revision is `69ab3076b9` after RT3b+RT4. Release builds use
  `CARGO_TARGET_DIR=/home/ccheever/projects/sb4-s1sk/snapback4/target`, with
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. No product patch.
- Owned database/role names are `sb4_snapback_s1pg3` / `s1pg3_app`.
  Runtime, socket, output, remote seed and observer names use PG3 paths.
  The original `postgres-2.py`, `snapback.py`, `run.py`, seed source and
  Rust harness remain unmodified. An ignored external controller imports
  them, substitutes database/role/path labels, and points to the release
  binaries in the requested target directory. Exact source snapshots and
  hashes are archived.
- The helper's original locked build refused because its lockfile named
  core version 0.4.37 while B1 is 0.4.38. An ignored copy of its manifest,
  lockfile and byte-identical source uses an absolute core path. Offline
  Cargo resolution changes only that core version; the original lockfile
  stays untouched.
- Requested cell order: W1 natural/delayed, W2 natural/delayed, W4
  disjoint natural/delayed, then W3 and W5 exact/1% mix on both links.
  Every cell still delegates to the original rate search, trials, probe,
  service lifetime, counter audit, durations, client counts and pass rules.
- Before each cell, save both `/proc/loadavg` values, free space and
  process/executable snapshots. Wait while load >2 or other build/tests
  remain. During-run free-space checks supplement the startup checks.
- Use the original prepared SELECT 1 RTT capture before/after each cell.
  A p99 >5 ms gets two further captures, three seconds apart. Stop if all
  three exceed 5 ms. No setup RTT capture substitutes for these cell captures.
- Release compilation, provisioning and the native seed are unmeasured
  setup. Other lanes were active during setup; their load/process evidence
  is retained. Seed timing is labelled contended and is not compared as
  performance evidence. Both hosts must pass the quiet check before any
  workload cell and its RTT captures.
- The user's stop rule requires dropping the owned database/role even if
  measurement is interrupted. Cleanup signals only recorded owned PIDs;
  the shared cluster remains untouched.

The app, 1M native seed, 256 sessions, cores, Unix delay proxy, 128 read
clients/C=32 writes, three 10 s warm-ups/20 s windows, intended-arrival
histograms, SLO/error/unknown-outcome rules and role/database-filtered clean
probes are unchanged. Controls and SQLite are historical PG2 columns.

The first controller guard required all three captures at a boundary to exceed
5 ms. Before W1, two high captures were followed by one clear capture; after
W1, another high/clear/high sequence occurred. That guard was too permissive
for the requested clean-tail comparison. The operator stopped on recurrence
across the cell (four of six captures near 41 ms) and disqualified the whole
cell. No low confirmation replaces a high original capture. Eleven cells
remain unrun. A separate unrelated Cargo job also overlaps every provisional
707/s measurement window, independently disqualifying that candidate.
