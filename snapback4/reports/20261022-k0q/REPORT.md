# K0-Q — owned commands and the serving committer

## Scope and constraints

This lane changes the concurrency structure of the unified serving engine.
The member facade, store adapters, transaction boundaries and receipt format
remain the reference protocol. No `engine/postgres/` or `store_owner*` file is
changed. Governing context: LLP 3000 §7; LLP 3000.009.001.000.000 §§3.1,
3.4, 3.6–3.7, 7 and the K0a–K0d implementation notes; the SQLite diagnosis
under `experiments/scale-controls/results-20261022-snapback-sqlite-diagnosis/`.
These constraints require one writer, owned admission inputs, fresh authority
checks at execution, and acknowledgement after the member continuation.
Batching, optimistic execution, and a persistent internal revision format remain
future work. The existing committer RFC and append-only journal are updated;
no new LLP or gate is introduced. Orientation hand-off: none.

## Implementation

Code commits, in order:

1. `40162c1c0b04c486ea2b546446136a64a6039d41` — owned commands and queue.
2. `a61df85636a987b53a7390c9fee086b2720a5931` — serving integration,
   context transfer and concurrency tests.
3. `2f3815f7fee550ab1d0d706149eda14fa3bbbfc5` — unambiguous command/error
   spellings for the unchanged source censuses, with no new allowances.

`Command<T>` owns a `Send + 'static` body; the worker supplies `&mut Engine`.
`Queue` owns the engine and its named thread, a 128-command FIFO mailbox and
one-shot typed result channels. Accepted commands complete even when the caller
loses its receiver. Panics unwind transaction guards and return to the submitter;
the worker remains available. There is no automatic retry or batching.

The serving `Writer` handle replaces production `FairMutex<Engine>` access.
Requests own their operation/context/admission inputs and wait for results.
Credentials are resolved again on the worker, including a fresh authority sample;
KDF work and socket/file I/O stay outside it. Detached reads retain their pool and
schema epochs. Ephemeral programs retain their hub lock and detached durable
snapshot; only memory-only fixtures need the worker fallback. Host activation,
maintenance and remaining serving accesses also cross owned command boundaries.

The unchanged member driver owns each physical COMMIT and runs its engine
continuation before command acknowledgement. Mutation wake publication occurs
on the worker. Generation, developer evidence and timing/trace state cross back
to the request; CPU totals include the worker's actual thread CPU. A full mailbox
refuses HTTP durable submissions and maintenance turns with the existing 503,
E_RATE_LIMIT/limit/retryable refusal and Retry-After: 1. Fixed host control and
inspection calls wait for space in the same bounded mailbox.

## Concurrency evidence

- 48 concurrent queue submitters: explicit member continuations observe COMMIT
  through an independent reader, execute in durable order on one worker, and
  precede acknowledgement.
- Capacity-one mailbox: rejected work never executes; accepted work survives a
  dropped reply receiver; transaction unwind does not lose the worker.
- Concurrent HTTP writers race duplicate operation ids while independent reads
  and ephemeral writes progress. Public sequences, exactly-once receipts and
  replay privacy are checked.
- A deliberately full serving mailbox returns the existing HTTP overload
  refusal and Retry-After, without applying the rejected mutation.

## Local W4 measurement

All four runs use the actual `serve` process, SQLite WAL/FULL on local disk,
32 disjoint counter owners and pre-minted bearer sessions. This is a reduced
W4 fixture (32 counters and one room), 160 warm-up operations followed by three
closed-loop trials of 1,600 operations, without mutation ids. No Cargo build or
suite ran alongside measurement. Each run's independently checked durable total
is **4,960**, and every recorded server stopped.

The table gives the median of each run's three trial statistics, not a pooled
latency percentile:

| Run | ops/s | p50 ms | p99 ms |
|---|---:|---:|---:|
| before | 96.96 | 329.14 | 349.96 |
| after | 95.14 | 335.26 | 362.41 |
| before-repeat | 95.77 | 333.38 | 357.54 |
| after-repeat | 97.39 | 327.13 | 351.33 |

The first pair's throughput moved -1.88%; the immediately adjacent repeat pair
moved +1.69%. The latency differences also reversed. This small local check finds
no consistent regression or throughput lift. It does not resolve a cost of a few percent
or establish an SLO; the flush-per-member ceiling remains. Batching is still
needed to change it.

The before executable was copied from this worktree's existing `target/debug`
path before edits, with checkout at `e7d33f738d4d4adc22a060ee58ce295e8711efbc`;
it was not independently rebuilt for this comparison. The after executable is
the development-profile `cargo build -p snapback4 -j 10` output at code commit
`2f3815f7fee550ab1d0d706149eda14fa3bbbfc5`. This quick comparison against cached baseline bytes does not prove a fresh
build from the base commit or qualify the scale-host 1M-message campaign.

Binary SHA-256:

- Before and before-repeat: `17b57a6eefb1081e59fb945c135cbce5d11aef6f29bb61de508bf24654ef03da`.
- After and after-repeat: `a48c3d229a35a3e3d10dd1587a481e07ab6b4e3a1565815230ba0af0abc2a30f`.

Raw trials and counter/shutdown receipts: [before](./before.json),
[after](./after.json), [before repeat](./before-repeat.json),
[after repeat](./after-repeat.json). The [retained harness](./w4.py) uses the same measurement logic, resolving the
repository root relative to itself.
From `snapback4/`, reproduce with
`python3 reports/20261022-k0q/w4.py /absolute/path/to/binary new-label`;
labels must be unused. [Host metadata](./host.json) records the toolchain.

## Verification

All Cargo invocations use only this worktree's `snapback4/target`, with ten
compiler jobs. The host reports `expose-builder-nothing`, rustc 1.97.0 and
Node 24.13.1. `/home` remained above the 20 GB stop threshold.

| Check (from `snapback4/`, unless stated) | Result |
|---|---|
| `cargo build -p snapback4 -j 10` | Pass, including final measurement build |
| `cargo check -p snapback4-core --no-default-features -j 10` | Pass |
| `cargo check -p snapback4-device --no-default-features --features web --target wasm32-unknown-unknown -j 10` | Pass |
| `cargo test -p snapback4-core --no-fail-fast -j 10` | Pass, including integration tests and doctests |
| `cargo test -p snapback4 --no-fail-fast -j 10` | Pass, full suite with `RUST_TEST_THREADS=4` |
| `cargo test -p snapback4-device --no-fail-fast -j 10` | Pass |
| `committer_ratchet`, `store_port_ratchet`, `store_handle_census` | Pass, including final repeat; 10 files / 47 durable opener sites |
| `cargo test -p snapback4-core --test store_handle_traits -j 10` | Pass |
| Core doctests (compiled borrow/member/handle guards) | Pass, latest default suite 27 and Postgres suite 38 |
| `cargo test -p snapback4-lang --test guide -j 10` | Pass, 127 tests |
| `cd packages/snapback4 && node --test test/wasm-codec-census.test.mjs` | Pass, 27 tests |
| Requested Postgres script, PG 16 tool/library paths and `/tmp` | Pass |
| Root `./ref-check` | Pass, 564 LLPs / 11,696 references / zero errors or unchecked |

The Postgres script exercised experiment conformance, 209 engine adapter tests,
the compiled handle guard, 38 doctests, two committer cases, the internal HTTP
host witness, and the 19-case unified corpus. Its sole private cluster was
`/tmp/sb4-pg-eval.RhMiDk`. Both script cleanup and an independent `pg_ctl status`
confirmed status 3 and no `postmaster.pid`. No evaluation cluster remains running.

Verification history matters here. An early CLI run was discarded because a
parallel development-profile build replaced the executable used by test-profile
integration tests. The subsequent stable-binary full run passed all integration
targets, including the three supplied baseline cases, but four HTTP unit tests
hit the shared three-second socket timeout under default test concurrency. Each
passed alone with unchanged bounds. The complete repeated suite passed with
four test cases at a time, including 514 unit tests and every integration target. No product code or timeout bound
was changed for these reruns.

The source censuses retain zero concrete handle/driver escapes, the original
member facade and compiled borrow guards, and the unchanged 10-file / 47-site
remaining durable-opener inventory. No guard, allowance or protected ownership
file was relaxed. [Command/status receipts](./checks.json) include the successful
full CLI rerun and the isolated cases.

[Final cleanup check](./cleanup.json): every recorded benchmark PID is gone;
the owned Postgres cluster again reports stopped. No process-name cleanup was used.
