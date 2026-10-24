# M1: composed S1 reads on the current layout and typed shadows

A one-statement fact closure removes most of W3’s SQL/flight cost on the existing layout. Typed shadows earn a measurable read saving at equal flights, but do not establish the delayed W2 target. Plan hygiene matters independently: the analyzed `auto` arm repeatedly custom-plans generic W2 and many statements in today’s sequence. No product code changed.

Canonical measurements: **2026-10-23 20:01:46–20:03:16 UTC**, on `expose-builder-pixel` (the commissioned expo-build-1000 host). The requested directory label is `20261024`. Base source: `e26d1ebc95208e536752aac05f754fe355405971`, branch `sb4-pg/g3b-gate`. Design: revision 5 of LLP 3000.009.001.000.002, read in `/home/ccheever/projects/sb4-land2`, commit `306f3f041e4dc3fddd0ca325af22d1903e7cf4a0`, SHA-256 `f50c6927356df8dd0e576f13bd90028ab85a2edd44cc698f39264fb68c1074d9`. That worktree advanced to an uncommitted revision 6 during this lane; the private revision-5 snapshot matches the initial digest.

Values below are medians of three run means, in **µs per whole request**. Main “server” time is the sum of PostgreSQL `EXPLAIN (ANALYZE, TIMING OFF, BUFFERS, FORMAT JSON) EXECUTE` execution times on the **exact prepared handles used by the wall measurement**. SQL templates share handles just as the adapter cache does. Utility commands execute in sequence but are excluded from the EXPLAIN sum. Planning is reported separately. Wall time is plain loopback TCP, including all returned rows, driver row buffering and sequence framing; it excludes initial prepares, fixture setup and Rust query/rule/meter/result decoding. These are separate measurement windows, not additive pieces of one latency sample.

| Shape | Statistics / cache | Generic composed server / wall | Typed composed server / wall | Today’s sequence server / wall |
|---|---|---:|---:|---:|
| W1 | fresh / auto | 85.28 / 123.84 | 69.93 / 109.42 | 138.03 / 371.86 |
| W1 | fresh / generic | 85.20 / 127.06 | 67.42 / 111.77 | 132.53 / 395.65 |
| W1 | analyzed / auto | 81.53 / 123.77 | 68.88 / 92.28 | 139.43 / 554.85 |
| W1 | analyzed / generic | 80.05 / 120.10 | 68.37 / 107.25 | 128.65 / 380.37 |
| W2 | fresh / auto | 146.02 / 194.89 | 76.80 / 131.64 | 191.50 / 467.94 |
| W2 | fresh / generic | 145.32 / 197.18 | 75.43 / 131.30 | 190.72 / 464.61 |
| W2 | analyzed / auto | 135.47 / 564.30 | 78.10 / 130.30 | 179.83 / 608.87 |
| W2 | analyzed / generic | 123.58 / 173.28 | 77.57 / 131.44 | 166.93 / 438.14 |
| W3 | fresh / auto | 322.78 / 363.23 | 175.28 / 216.74 | 2242.13 / 7303.16 |
| W3 | fresh / generic | 313.62 / 361.67 | 169.83 / 215.27 | 2317.92 / 6890.28 |
| W3 | analyzed / auto | 267.98 / 314.49 | 168.60 / 214.37 | 2407.25 / 16118.33 |
| W3 | analyzed / generic | 265.70 / 315.31 | 169.23 / 209.64 | 2025.95 / 6245.03 |

Returned bytes are identical across plan-state arms. “Payload” counts every non-NULL binary field, including native array/record headers. “DataRow wire” adds each returned row’s `7 + 4 × column_count` bytes. Neither includes RowDescription, CommandComplete, ReadyForQuery, inbound parameters, TCP/IP framing or TLS. All three variants return raw facts, not the app’s final HTTP JSON.

| Shape | Generic payload / DataRow wire B | Typed payload / DataRow wire B | Sequence payload / DataRow wire B |
|---|---:|---:|---:|
| W1 | 674 / 769 | 575 / 670 | 884 / 1080 |
| W2 | 6336 / 6431 | 5173 / 5268 | 7342 / 7823 |
| W3 | 5575 / 5670 | 3687 / 3782 | 12326 / 15372 |

The same plain request windows also collect `pg_stat_statements.total_exec_time`, divided by 300 requests, with an exact statement-call-count assertion. This avoids EXPLAIN’s instrumentation and includes utility execution. It excludes planning (`track_planning=off`). It is a useful server-cost cross-check, not a replacement for the requested EXPLAIN figures. Default TIMING ON execution, planning, first-request wall, all run-mean spreads, worst observed p99 and exact plan counters remain in [summary.json](./summary.json).

| Shape | Statistics / cache | Plain server: generic / typed / sequence µs | EXPLAIN planning: generic / typed / sequence µs |
|---|---|---:|---:|
| W1 | fresh / auto | 47.97 / 37.68 / 77.78 | 6.20 / 5.37 / 14.10 |
| W1 | fresh / generic | 48.15 / 37.72 / 77.58 | 6.30 / 5.57 / 14.25 |
| W1 | analyzed / auto | 50.45 / 41.90 / 93.78 | 6.17 / 5.37 / 156.57 |
| W1 | analyzed / generic | 49.45 / 42.09 / 82.38 | 6.15 / 5.33 / 14.10 |
| W2 | fresh / auto | 107.28 / 51.65 / 133.40 | 5.50 / 5.33 / 14.45 |
| W2 | fresh / generic | 107.51 / 51.57 / 132.13 | 5.42 / 5.25 / 14.53 |
| W2 | analyzed / auto | 104.23 / 55.44 / 132.57 | 391.50 / 5.30 / 165.38 |
| W2 | analyzed / generic | 88.37 / 55.40 / 116.73 | 5.60 / 5.25 / 14.22 |
| W3 | fresh / auto | 273.49 / 135.37 / 993.58 | 5.60 / 5.43 / 306.58 |
| W3 | fresh / generic | 270.21 / 131.19 / 999.93 | 5.38 / 5.22 / 322.12 |
| W3 | analyzed / auto | 231.35 / 134.72 / 1315.19 | 5.42 / 5.20 / 9048.72 |
| W3 | analyzed / generic | 229.05 / 135.11 / 885.19 | 5.35 / 5.23 / 334.08 |

The W2 analyzed/auto generic-composed handle records 0 generic / 1,410 custom executions, versus 1,410 / 0 under `force_generic_plan`. Typed W2 auto uses 1,405 generic / 5 custom executions. Its large auto-arm wall advantage therefore includes avoided planning; it cannot all be credited to typed storage. At equal forced-generic plans, typed W2 saves **46.02 µs EXPLAIN execution, 32.97 µs plain server and 41.84 µs wall**, with **18.36% fewer payload bytes**. Typed W3 saves **96.47 / 93.94 / 105.68 µs**, with **33.87% fewer payload bytes**. W1’s equal-plan saving is smaller: **11.68 / 7.36 / 12.85 µs**. These are differences between medians, not paired causal decompositions.

No sequential scan of the large generic `r` or `i` relation appears in the saved canonical plans. Generic reads use their existing primary indexes (including bitmap paths where selected). Typed W3 chooses a sequential scan of all 1,025 room rows for its join; it is retained, not forced away. ANALYZE permits sequential scans of tiny authority tables, which is expected. This read experiment does not exercise the write-tail foreign-key plan cliff measured in the preceding G3b lane.

Worst observed W3 sequence wall p99 is **19.98 ms** in analyzed/auto, with a **16.12 ms** median run mean; analyzed/generic falls to **6.25 ms** median but still has **17.45 ms** worst p99. All are retained. Composed W3 stays around **0.31–0.36 ms generic** and **0.21–0.22 ms typed** as median run means. These finite, single-client tails are diagnostics, not SLO/error-rate qualification.

The fact closures and the source baseline are concrete and reviewable:

- [composed.sql](./composed.sql) contains all six parameterized statements. Both layouts return the same 19 account-session authority facts, principal generation, worker/family markers, store identity/generation, backend generation and head. The authority projection is the real adapter query, including its optional read-session union. SQL makes no authority, expiry, refusal or unread-arithmetic decision.
- W1 returns the complete message image and its room/viewer membership, deriving the membership key from the fetched message in the same statement. W2 returns one membership and all 20 newest message images in exact engine order. W3 returns all 32 membership images and 32 distinct room images, including the stored last-read/total inputs to Rust arithmetic. Room, message and membership absence remain distinguishable.
- Generic facts retain the engine’s tagged JSON text. `r(t,id,data TEXT)` has primary key `(t,id)`; `i(t,ix,k BYTEA,id)` has primary key `(t,ix,k)`. Scans join `i` to `r`; the SQL helper constructs the fixture’s ASCII Id-key prefixes using the real key tags/terminators. This is not a general portable NUL/sparse/type codec.
- [typed-shadow.sql](./typed-shadow.sql) creates users, rooms, memberships, messages and counters with native columns, natural unique/FK constraints and read indexes, then copies all images from `r`. Typed facts use native record arrays. The core, adapter, schema and lowerer are unchanged. The shadow does not implement private maintained-state or history writes.
- [sequence.md](./sequence.md) records today’s 6 / 6 / 136-statement sequences and their SQL templates. W1/W2 agree with the committed account RT0 ratchets. W3 still performs 64 room-size preflights and 64 room fetches after its 32-room prefetch. A future deduplicated fact collector must preserve the original logical reads, trace and meter charges.

The S1 schema and `postgres-seed` fixture shape were reused. `Engine::seed_at` loaded **131,072 messages, 256 users, 1,025 rooms, 8,448 memberships and 257 counters**, with genuine engine-maintained totals and private count rows. There are 32 read memberships plus the seed’s extra r1024 write-room membership per user; W3 returns 32 and excludes r1024. Messages cycle through 1,024 rooms (128 per room), use the original sender/time shape and ~150-byte chat bodies. All 256 account sessions exist. The timed request repeats viewer `bench:0`, message `m0000130049`, room `r0000`; broad concurrent/locality distributions are not measured.

The canonical seed took **54.92 s**; typed DDL plus FK-checked copy took **2.37 s**. Generic r/i heap+index allocations are 151,347,200 / 112,812,032 bytes. The complete allocation census is retained in the summary. This is not a storage-ratio claim: generic rows include private maintained state and seed-update bloat, while the fresh typed copy does not carry that history. No vacuum, live activation lock/pause, temporary-disk peak or failed-build/rollback campaign was run.

Fresh means the actual new load/copy with no ANALYZE or optimizer-statistics/catalog reset in the canonical fixture. Its r/i and typed tables have zero statistics columns. Fixture relations disable auto-analysis during the controlled arms; cluster autovacuum remains on. ANALYZE then runs before fresh measured connections open for the analyzed arms. Both arms retain warm buffer caches. Each cell has one fresh TCP backend, three repetitions, 50 warm-up requests plus 300 measured plain requests per repetition, and 60 exact-handle EXPLAIN executions with timing on and 60 with timing off. First plain-request wall time is retained. No run is dropped for load or a bad plan.

Positive checks compare complete generic and typed facts, all named authority fields, W2 order and reconstructed W1/W2/W3 results against the real engine. Negative checks cover missing message, absent room membership and absent token. Every plain replay checks byte-count stability; pg_stat_statements must observe exactly 300 × statement-count calls per run. This is static-fixture equivalence, not concurrency, authority-race, semantic-trace, error-order or meter qualification of a product collector.

The delayed W2 pool allowance at 22,627/s is **30/22,627 = 1,325.85 µs** connection hold. With **R = 1,230 µs**, just **95.85 µs** remains. Forced-generic current-layout W2 is **123.58 µs instrumented server / 173.28 µs loopback wall**; typed W2 is **77.57 / 131.44 µs**. The typed server figure leaves only **18.28 µs** before other request work. Its matched plain-server counter is 55.40 µs, but loopback wall and observed p99 remain materially larger. Local loopback wall already contains a local RTT, and EXPLAIN is instrumented: neither is an exact delayed-link q estimate, and neither can be spliced into a loaded-capacity claim.

**A’s read case is real but conditional.** At equal flights and plan policy it reduces W2/W3 server work, wire payload and plain wall time. The large W3 improvement is already available through current-layout fact composition; typed storage is an additional ~0.1 ms in this fixture. A full format migration still owes EV-1/EV-2, portable representations and recurring fenced shadow-build/atomic-selection costs from revision 5 §10.2. The static 2.37 s copy does not pay or qualify those costs.

**W2 still warrants admission/queue and plan-policy measurement first, followed by revision-equality G5 if the loaded residual requires it.** A alone does not establish the 22,627/s delayed rung. These numbers justify measuring G5’s ability to avoid the data joins/packing and its write-induced misses, but do not prove that G5 is required or sufficient. This harness neither implements a revision-complete validator nor measures a G5 hit. Keep the fixed 30-reader/32-total-connection budget; no additional pool capacity is credited.

**W3 needs composition to remove dependency flights.** A two-flight fallback has a 2,460 µs network floor, exceeding the delayed 16,000/s allowance of 1,875 µs even before server work. A one-statement closure is the useful result here: generic/typed wall of 315/210 µs is below the corresponding 645 µs beyond-R mean allowance on loopback, leaving Rust/HTTP/admission and loaded tails unqualified. The stronger delayed 22,627/s W3 challenge has W2’s same 95.85 µs remainder and remains at risk. No G9 rung, loaded throughput, publication or product capability is claimed.

PostgreSQL **16.15**, direct `127.0.0.1:56541`, NoTls; no SSH/proxy/delay injection. S1b-matching durability/resource settings: fsync/synchronous_commit/full_page_writes on, fdatasync, commit_delay=0, **8 GiB shared_buffers, max_connections=300**, checkpoint_timeout=300 s, max_wal_size=1 GiB. Measured sessions set statement_timeout=lock_timeout=5 s; the admin settings snapshot shows their global 0 defaults. JIT, I/O/WAL timing and pg_stat_statements tracking are on; track_planning is off. Rust release binaries used the lane-owned `CARGO_TARGET_DIR`, **`-j 8`**, and the profile’s existing debug info. No CPU pinning or host-idleness assumption.

Each of the 108 runs records the full `/proc/loadavg` line before and after. Canonical 1/5/15-minute ranges: **9.75–16.14 / 8.91–10.53 / 6.42–7.11**. The host is shared; other work and backend scheduling remain part of these observations. Arm order is fresh-auto, fresh-generic, analyzed-auto, analyzed-generic, not randomized. No campaign RTT, loaded reader pool, HTTP admission, Rust interpreter/authority CPU, semantic SQL executor, G5 cache, general codec, or production server binary is benchmarked.

Raw custody: `/tmp/claude-1000/-home-ccheever-projects-snapback/3d04fc0c-0698-42a7-917c-2880afdea35c/scratchpad/m1/`. It holds the canonical per-run JSON, full exact-handle plans/counters, oracle/negative checks, settings, fixture/schema, binary digest, process ledger and cleanup proof. Preliminary parallel-array and prepared-EXPLAIN-wrapper diagnostics, reset-statistics trials, and setup/counter-search-path fixes remain there in separate directories. They are not merged with the canonical new-load/record-array/exact-handle matrix. Only curated aggregates and parameterized SQL are committed; no raw logs or credentials are committed.

To reproduce on a new private S1b-configured PG16 cluster, set PG_UNIX_URL for setup and provide its env.sh in PRIVATE_DIR (this lane uses port 56541). The runner uses this checkout’s lane-owned target/release/m1. Create a fresh fixture for each full matrix; the runner refuses previously analyzed application tables:

```sh
CARGO_TARGET_DIR=/home/ccheever/projects/sb4-g3b/snapback4/experiments/postgres-commit-path/target \
  cargo build --release -j 8 --manifest-path snapback4/experiments/postgres-commit-path/Cargo.toml --bin m1
# With PG_UNIX_URL exported and PRIVATE_DIR outside Git:
snapback4/experiments/postgres-commit-path/target/release/m1 setup "$PRIVATE_DIR"
python3 snapback4/experiments/postgres-commit-path/scripts/m1-reads.py "$PRIVATE_DIR" trace
python3 snapback4/experiments/postgres-commit-path/scripts/m1-reads.py "$PRIVATE_DIR" prepare
python3 snapback4/experiments/postgres-commit-path/scripts/m1-reads.py "$PRIVATE_DIR" run
python3 snapback4/experiments/postgres-commit-path/scripts/m1-reads.py "$PRIVATE_DIR" summarize
```

Orientation: LLP 3000 (foundation; separate candidate/process fence), store-port LLP 3000.009.001.000 §7 (current layout), request-round-trip LLP 3000.009.001.000.001 §3.2–3.3 (shared authority and borrowed snapshot), scale-controls LLP 3000.009.001.002 §4/§9 (S1/cost-model scope), and commissioned revision 5 §6 M1/§10 (equal-flight facts and conditional A/G5). No governing design changes; experiment evidence and this append-only JOURNAL entry are the only documentation updates. Hand-off: none; product qualification remains future work.

Validation: release build, canonical 36 cells × 3 repetitions, fact/oracle/absence/order checks, exact statement-call and byte-stability witnesses, rustfmt check, Python compile, diff check and ref-check (566 LLPs, 11,830 refs, zero errors). **Cleanup: postmaster 1540291 stopped; all 215 recorded owned PIDs absent; pg_ctl status=3; no postmaster.pid or Unix socket directory. PIDs left: none.** The 25 GiB /home guard held; post-stop free space was 48.97 GiB. No push, stash or Git configuration change.
