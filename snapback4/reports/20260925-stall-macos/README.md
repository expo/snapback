# macOS periodic-read-stall investigation — 2026-09-25

Investigation branch: `sb4-intent/stall-macos`. No publication.

## Results: the periodic signature did not reproduce

**168,000 sequential measured reads** across six runs, plus three warmups per
shape. The saved store does produce rare tails; it does not reproduce one
27–31 ms stall per twenty reads. The cause of the historical stall remains
undetermined. No production fix or publication was made.

| Run | Reads | Per-shape p95 range (ms) | Max (ms) | ≥20 ms | 27–31 ms |
|---|---:|---:|---:|---:|---:|
| [Main, checkpointed, SDK](main-sdk.json.gz) | 7,000 | 1.747–4.048 | 5.341 | 0 | 0 |
| [0.4.1, checkpointed, SDK](published-sdk.json.gz) | 7,000 | 1.470–3.458 | 4.222 | 0 | 0 |
| [Main, preserved WAL, SDK](main-raw-sdk.json.gz) | 7,000 | 1.793–4.237 | 10.810 | 0 | 0 |
| [Main, checkpointed, long SDK](main-long-sdk.json.gz) | 70,000 | 1.942–4.164 | 34.804 | 4 | 0 |
| [0.4.1, preserved WAL, long traced SDK](published-raw-long-sdk.json.gz) | 70,000 | 3.772–7.295 | 49.321 | 18 | 6 |
| [0.4.1, preserved WAL, direct HTTP](published-raw-http.json.gz) | 7,000 | 3.560–5.786 | 11.449 | 0 | 0 |

The main long run lasted 130.6 seconds. Its four ≥20 ms reads were separated by
18.87 seconds, 61.23 seconds and 76.33 ms (across the seven shapes); none was in
[27,31) ms. The published long run lasted 250.4 seconds. Its eighteen ≥20 ms reads
were separated by 83.7 ms to 57.4 seconds. Only six of 70,000 reads (0.0086%) were
in [27,31) ms. No stable time or request-count period was found. Within a shape,
slow-read gaps range from 16 to 5,649 reads on the published run, unlike a stall
every approximately twenty reads.

One published `chat-list-100` outlier is explicitly **not all server latency**:
read 1464 took 29.070 ms, but its HTTP body had been parsed by 4.347 ms; another
24.723 ms elapsed before the query promise reached the timing continuation.
That localizes this one outlier to the client-side remainder/scheduling window,
without identifying whether GC, scheduling, or another cause filled the gap.
Across the eighteen slow reads, the median header-to-parsed-body interval was
0.195 ms (maximum 5.804 ms). The other seventeen spent most of their time before
headers were observed. None retried.

### Per-shape long-run latencies

Each cell is p50 / p95 / max in milliseconds; 10,000 reads per shape per binary.
The store and tracing conditions differ as named above, so this is not a
before/after speedup comparison.

| Shape | Main, checkpointed | Published 0.4.1, preserved WAL |
|---|---:|---:|
| following-5 | 1.045 / 1.942 / 8.335 | 3.020 / 3.977 / 34.008 |
| following-500 | 1.172 / 2.107 / 10.601 | 3.052 / 3.772 / 13.023 |
| global | 1.092 / 1.963 / 34.804 | 2.939 / 3.786 / 23.048 |
| busy-latest | 2.012 / 3.558 / 24.605 | 3.156 / 4.754 / 35.743 |
| chat-list-100 | 2.758 / 4.164 / 8.327 | 5.187 / 7.295 / 29.070 |
| busy-search | 0.900 / 2.207 / 9.379 | 2.820 / 3.969 / 49.321 |
| all-chat-search | 2.597 / 3.984 / 25.998 | 3.725 / 5.253 / 19.280 |

### Histograms

Counts in disjoint, half-open millisecond bins. Every sample is retained in the
linked gzip JSON; [summary.json](summary.json) also contains the original finer
bins and percentiles for every run/shape.

**Main, checkpointed, SDK**

| Shape | <2 | 2–5 | 5–10 | 10–20 | 20–27 | 27–31 | 31–50 | ≥50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| following-5 | 985 | 15 | 0 | 0 | 0 | 0 | 0 | 0 |
| following-500 | 951 | 49 | 0 | 0 | 0 | 0 | 0 | 0 |
| global | 966 | 34 | 0 | 0 | 0 | 0 | 0 | 0 |
| busy-latest | 837 | 163 | 0 | 0 | 0 | 0 | 0 | 0 |
| chat-list-100 | 0 | 998 | 2 | 0 | 0 | 0 | 0 | 0 |
| busy-search | 975 | 25 | 0 | 0 | 0 | 0 | 0 | 0 |
| all-chat-search | 580 | 420 | 0 | 0 | 0 | 0 | 0 | 0 |

**0.4.1, checkpointed, SDK**

| Shape | <2 | 2–5 | 5–10 | 10–20 | 20–27 | 27–31 | 31–50 | ≥50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| following-5 | 996 | 4 | 0 | 0 | 0 | 0 | 0 | 0 |
| following-500 | 991 | 9 | 0 | 0 | 0 | 0 | 0 | 0 |
| global | 992 | 8 | 0 | 0 | 0 | 0 | 0 | 0 |
| busy-latest | 934 | 66 | 0 | 0 | 0 | 0 | 0 | 0 |
| chat-list-100 | 30 | 970 | 0 | 0 | 0 | 0 | 0 | 0 |
| busy-search | 997 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| all-chat-search | 737 | 263 | 0 | 0 | 0 | 0 | 0 | 0 |

**Main, preserved WAL, SDK**

| Shape | <2 | 2–5 | 5–10 | 10–20 | 20–27 | 27–31 | 31–50 | ≥50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| following-5 | 874 | 126 | 0 | 0 | 0 | 0 | 0 | 0 |
| following-500 | 831 | 169 | 0 | 0 | 0 | 0 | 0 | 0 |
| global | 919 | 81 | 0 | 0 | 0 | 0 | 0 | 0 |
| busy-latest | 388 | 602 | 9 | 1 | 0 | 0 | 0 | 0 |
| chat-list-100 | 0 | 984 | 16 | 0 | 0 | 0 | 0 | 0 |
| busy-search | 979 | 21 | 0 | 0 | 0 | 0 | 0 | 0 |
| all-chat-search | 503 | 497 | 0 | 0 | 0 | 0 | 0 | 0 |

**Main, checkpointed, long SDK**

| Shape | <2 | 2–5 | 5–10 | 10–20 | 20–27 | 27–31 | 31–50 | ≥50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| following-5 | 9609 | 386 | 5 | 0 | 0 | 0 | 0 | 0 |
| following-500 | 9249 | 747 | 3 | 1 | 0 | 0 | 0 | 0 |
| global | 9556 | 427 | 14 | 2 | 0 | 0 | 1 | 0 |
| busy-latest | 4926 | 4954 | 109 | 10 | 1 | 0 | 0 | 0 |
| chat-list-100 | 0 | 9886 | 114 | 0 | 0 | 0 | 0 | 0 |
| busy-search | 9276 | 714 | 10 | 0 | 0 | 0 | 0 | 0 |
| all-chat-search | 1564 | 8312 | 117 | 5 | 2 | 0 | 0 | 0 |

**0.4.1, preserved WAL, long traced SDK**

| Shape | <2 | 2–5 | 5–10 | 10–20 | 20–27 | 27–31 | 31–50 | ≥50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| following-5 | 458 | 9396 | 118 | 20 | 3 | 4 | 1 | 0 |
| following-500 | 428 | 9470 | 99 | 3 | 0 | 0 | 0 | 0 |
| global | 460 | 9398 | 132 | 9 | 1 | 0 | 0 | 0 |
| busy-latest | 260 | 9366 | 343 | 27 | 2 | 1 | 1 | 0 |
| chat-list-100 | 0 | 4641 | 5316 | 42 | 0 | 1 | 0 | 0 |
| busy-search | 522 | 9206 | 207 | 61 | 0 | 0 | 4 | 0 |
| all-chat-search | 104 | 9148 | 684 | 64 | 0 | 0 | 0 | 0 |

**0.4.1, preserved WAL, direct HTTP**

| Shape | <2 | 2–5 | 5–10 | 10–20 | 20–27 | 27–31 | 31–50 | ≥50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| following-5 | 93 | 903 | 4 | 0 | 0 | 0 | 0 | 0 |
| following-500 | 34 | 936 | 29 | 1 | 0 | 0 | 0 | 0 |
| global | 39 | 950 | 11 | 0 | 0 | 0 | 0 | 0 |
| busy-latest | 22 | 906 | 72 | 0 | 0 | 0 | 0 | 0 |
| chat-list-100 | 1 | 896 | 103 | 0 | 0 | 0 | 0 | 0 |
| busy-search | 56 | 928 | 16 | 0 | 0 | 0 | 0 | 0 |
| all-chat-search | 19 | 851 | 130 | 0 | 0 | 0 | 0 | 0 |

## Question and scope

Calibration #20 recorded approximately 27–31 ms maxima among twenty sequential
reads of each of seven shapes. Its receipt contains sorted percentile summaries,
not the original per-read timestamps: those summaries establish a slow tail but
cannot establish a period. This lane tests the same seven operation/actor/argument
combinations on the black M5 Max, using copies of the saved scale store.

The source packet was only read. No SQLite connection opened the original store.
`lsof` reported no process using that file before copying. All servers, SQLite
inspection and checkpoints used copies under `snapback4/target/stall-macos/`.
The preserved-WAL experiments copied the original DB, WAL and SHM together and
did not open SQLite before starting the server.

Governing context: [LLP 3000 §4](../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
limits this lane to Snapback 4; [LLP 3000.013 §4](../../../llp/3000.013-quarry-states-intent.rfc.md#4-following-without-caps)
requires FIFO admission, bounded maintenance deferral and WAL `synchronous=FULL`.
No runtime code, fairness, slice, durability, connection limit or socket policy
was changed. No new gate or LLP is introduced.

## Method

[provenance.json](provenance.json) records SHA-256 hashes of both executables,
the original store/WAL, schema, fixture, receipt, SDK and probe. The npm binary
and calibration packet's installed binary are byte-identical:
`6661de6001b315489dca317669d03ed52a0527c44a885fa27d850096c70a8b48`.
The saved source database is 2,358,583,296 bytes and its WAL 1,203,262,512 bytes.
The checkpointed condition ran `PRAGMA wal_checkpoint(truncate)` on a copy before
making the two baseline server copies. Raw conditions retained the large WAL.
Sample captures: [main](main-sample.txt.gz), [published](published-raw-sample.txt.gz).


- Worktree created detached from `origin/main` at `e2fb801e88`; branch created
  after measurements began. `bun install --frozen-lockfile` passed (476 packages).
- macOS 26.6.2 (25G83), Darwin 25.6.0, arm64, Apple M5 Max.
- Node v24.18.0; Bun 1.4.2. Release command: `cargo build --release -p snapback4`.
  The ordinary Cargo build retains SQLite's default memory-management compile
  option. Published 0.4.1 disables that option as documented in LLP 3000 §7.
  These measurements test the presence of a stall; they are not a controlled
  claim that one build is faster.
- Published server launched through `npx --yes --package=snapback4@0.4.1 -c ...`
  from `/tmp`, then changing directory to the copied project in that command.
  Launching npx directly inside this workspace initially found its unbuilt local
  package, so those failed invocations are not measurements. The actual running
  published process resolved to the npm cache's `snapback4-darwin-arm64` package.
- All servers ran `dev --replay --port PORT`, with the file watcher enabled.
  This matches the original scale-backend log: effects suppressed, schedules held.
- `probe.mjs` reads the frozen fixture's login credentials without logging them,
  logs in three actors before timing, and uses the packet's installed 0.4.1
  `createClient().query`. No writes or observations are started by the probe;
  these query-only clients do not start `/changes` polling. The replay's retained
  clients, live write history, heap and machine load are not reconstructed.
- Three warmups per shape, then sequential awaited reads. End-to-end time includes
  the full response body, JSON decode and SDK result publication. Each result must
  have non-null data. All responses in these runs are complete; row counts are
  20, 20, 20, 50, 50, 20, 20. `chat-list-100` names the actor with 100 chats, while
  the timed operation returns its first 50, exactly as the original probe did.
- Percentiles use nearest rank. Histograms have disjoint half-open millisecond
  bins. Every read retains its ordinal, monotonic start time and latency.
  `TRACE_FETCH=1` additionally records each query's HTTP attempt, status, time to
  headers/body and sequence; it does not record credentials or response contents.
- Long runs included one five-second, one-millisecond `sample` capture each.
  They are descriptive shared-machine runs, not an idle-host latency guarantee.

## What the diagnosis supports

The supplied receipt does not contain enough timing information to establish
"every twentieth request." A maximum in every twenty-read batch is compatible
with a time-based interruption, concurrent work, client activity or scheduling.
This investigation records order and time so those possibilities can be compared.

The fresh checkpointed-store runs had no read over 20 ms on either binary.
The longer runs have occasional tails; they do not establish a recurring
27–31 ms mode. The preserved-WAL published trace distinguishes those tails from
client retry backoff: the observed slow reads use one HTTP attempt and receive
HTTP 200. Most of their time passes before response headers arrive, rather than
between headers and body. It does **not** separate server work from scheduling
of the Node client or kernel.

Inspection and samples:

- `serve_lock.rs` admits engine users by ticket. Background work defers up to
  5 ms, with a 1 ms quiet interval; it does not sleep for 25–30 ms holding the
  engine. This is source inspection, not proof against every lock schedule.
- `serve_maintenance.rs` wakes delivery at most every 100 ms when idle, runs
  other work on a one-second tick, and uses 250 µs/2 ms cooperative slices.
  The copied saved store had 49,228 completed delivery records, no pending or
  parked ones, and no jobs. It therefore cannot reproduce a delivery backlog
  that existed during live replay. The final saved store is not an exact
  snapshot at the original twenty-read batch boundaries.
- The main `sample` capture shows the maintenance and source-watcher threads
  predominantly waiting/sleeping, with requests doing SQLite/interpreter work.
  The published capture has stripped Rust symbols and similarly mostly-waiting
  maintenance. Neither capture identifies a recurring 28 ms critical section.
  Sampling may itself perturb tail latency; the raw files name its wall time.
- The watcher polls every 400 ms. It remains enabled in the reproduction runs.
  No schema was edited during them.
- `vendor/tiny_http/src/connection.rs` already enables `TCP_NODELAY` at accept
  (landed as `17bde96d80` on September 14). The trace's very short header-to-body
  intervals on slow reads do not match the earlier split-response-body Nagle
  failure described in `vendor/tiny_http/SNAPBACK-PATCH.md`.
- SDK retry waits are 25/50/100 ms. The traced slow reads have a single HTTP
  request, so that explanation does not apply to those observed tails. The
  original twenty-read batches have no corresponding HTTP-attempt trace.
- SQLite remains WAL/FULL. The large original WAL and a checkpointed copy are
  tested separately; no checkpointing policy or durability setting was changed.
- No dtrace or OS timer-policy change was needed to reach the non-reproduction
  result. These runs do not establish an external macOS cause.

The user's Linux observation (20,000 reads, p95 below 2.62 ms, max 13.4 ms) is
context, not independently re-run evidence here. The named
`sb4-intent/w-following-device` ref was absent from origin and the accessible
`~/projects/snapback` repository on expo-build-1000 at investigation time;
its report was not available through those locations.

## Repeating the measurement

Copy `scale-instance` while its original server is stopped. Include the DB, WAL,
SHM and schema; never open the packet itself with SQLite. Run `dev --replay`
from the copy. Then, from `snapback4/`, use the supplied Node 24.18.0 toolchain:

```sh
node reports/20260925-stall-macos/probe.mjs \
  http://127.0.0.1:49420 /tmp/stall-reads.json.gz 1000 sdk
TRACE_FETCH=1 node reports/20260925-stall-macos/probe.mjs \
  http://127.0.0.1:49420 /tmp/stall-traced.json.gz 10000 sdk
node reports/20260925-stall-macos/probe.mjs \
  http://127.0.0.1:49420 /tmp/stall-http.json.gz 1000 http
```

`CAL20_LANE` overrides the default packet location. A final argument selects one
shape, e.g. `following-500`; default is all seven. Gzip JSON records retain all
samples and full histogram summaries. No dependency install or writes occur in
the packet. Login creates sessions in the **copied** store. This is an opt-in
benchmark, not a timing-sensitive CI gate.

## Validation and disposition

The release build passed. The benchmark ran successfully against the built and
published binaries; `node --check probe.mjs` and `git diff --check` passed.
Every retained timing record is checked for the requested sample count,
nonnegative latency, strictly increasing read order, complete non-null results,
and histogram counts summing to the sample count. The traced published run has
exactly one HTTP 200 attempt for each of its 70,000 measured reads, no denials
and no fetch errors. Full product suites are not rerun for this evidence-only
change.

No production fix is proposed: the reported periodic signature did not reproduce,
and the sporadic tails have not been causally attributed. There is consequently
no "after fix" histogram. The tables above compare measurement conditions, not
before/after implementation claims. FIFO fairness and `synchronous=FULL` remain
unchanged. If the signature appears again during a live replay, retain the
per-read HTTP attempts and the concurrent replay/maintenance state before
restarting the server; restarting a drained saved store cannot preserve those
conditions.
