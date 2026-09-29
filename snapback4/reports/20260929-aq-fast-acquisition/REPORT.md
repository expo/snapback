# AQ round 0 — cold browser acquisition

2026-09-29. Branch `sb4-intent/aq-fast-acquisition`, base `f9620c815`.

The requested probe meets the **≤3 s eb1000 target**. Five cold runs give
**2.255 s with `webDevice({ worker: true })`**, down from **4.436 s**;
the default device is **2.186 s**, down from **4.898 s**. Every after run is
under 2.321 s. Strict IndexedDB persistence was the dominant cost. Format 3
uses fewer initial bucket records, splitting bounded buckets as they fill.
The Worker remains recommended for this workload because it keeps atomic
wasm publication off the page thread. It remains opt-in.

This is not a claim to have reproduced the calibration Mac's exact 12.9 s.
The provided calibration #26 files are data, not executed builder code.
They report 12,927.5 ms at full scale, about 4.03 MB logical data and a
54,525,952 B wasm heap. The retained PF/SQ fixture predates that calibration:
it has `replyCounts`/`repostCounts` and lacks its owner-key projections.
Our probe has 4.29 MB logical data and a 57,278,464 B wasm heap. Both have
100 memberships, 500 Following edges and 500 held messages. Different host
and declarations prevent using 12.9 s as a same-fixture speedup denominator.
[FIXTURE.md](FIXTURE.md) compares every nonempty table and its logical bytes.

## Measurement custody

- Host: **eb1000 / expose-builder-pixel**, AMD EPYC 9454, 96 logical CPUs,
  Linux 6.8.0-138-generic. Chromium **151.0.7922.34**, Node **24.13.1**,
  Bun **1.3.14**, Rust **1.97.0**, wasm-bindgen **0.2.127**.
- Copied `~/sb4-intent/lane-sq/target/sq/full/`, including its SQLite WAL,
  into this lane's ignored `target/aq/store/`. No writes to SQ or PF's copies.
  Original private-input hashes are retained in `evidence/input-sha256.txt`.
- The unchanged server was built with `cargo build --profile production`,
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, and eight build jobs.
  Binary SHA-256: `5502b0763e668323400d65b568c800cd535c3b972b38e5b505f1f27588c43844`.
  It served the copied fixture on loopback using `dev --replay --no-watch`.
  Replay holds schedules; ordinary sync/delivery and real password sessions
  remain active. No mock server, persona authentication or client shortcut.
- The harness bundles the built package's public `createApp`, `webDevice`
  and auth exports with Vite. Each run creates a fresh Chromium context with
  empty device IndexedDB. Before and after variants alternate each round;
  default and Worker order also alternate. The server and OS page cache are
  warm. This is **cold device acquisition**, not cold server startup.
- Start: immediately before `createApp`, after SDK page load and password
  authentication. Session restoration and device initialization are included;
  initial JS download and the login request are excluded. End: the public
  client's acquisition listener receiving `true`, after strict durable publication. Residency and
  exhaustive stored-row comparisons run outside this interval.
- The first-screen number is the first `chat.inbox` answer available to a
  watch mounted when the signed-in client becomes visible. It is a 50-row
  answer suitable for rendering, **not a measured DOM paint** or an offline
  readiness claim. The normal online fallback supplies this answer while
  the partition is still staging.
- No AQ build or test overlaps the official paired timing/phase runs. Other
  lanes remained active. Every sample retains timestamp, CPU description,
  load averages, free memory, `/proc/stat` and CPU pressure. Later CPU profiles
  overlap validation and are explicitly separate from those wall measurements.

## Before/after: all five cold observations

Milliseconds; each row has five observations in run order. Instrumented runs
are a separate set, not substituted into the primary timing result.

| Account / device / variant | Individual acquisition times | Median | Load-1 range / 96 CPUs |
|---|---|---:|---:|
| u0500 default before | 4074.8, 4927.9, 4897.6, 4941.3, 4243.4 | 4897.6 | 18.67–31.51 |
| u0500 default after | 2192.5, 2133.9, 2196.5, 2185.8, 2156.5 | 2185.8 | 16.43–29.08 |
| u0500 Worker before | 4552.7, 5035.9, 4372.4, 4435.7, 4413.8 | 4435.7 | 17.34–30.75 |
| u0500 Worker after | 2224.8, 2254.7, 2320.5, 2286.3, 2198.8 | 2254.7 | 16.43–29.08 |
| u0001 Worker before, instrumented | 26920.5, 27122.7, 26605.6, 26440.2, 26542.0 | 26605.6 | 7.06–22.16 |
| u0001 Worker after, instrumented | 25660.7, 28227.9, 25613.1, 25400.8, 26347.1 | 25660.7 | 4.72–16.90 |

The probe's primary first-screen medians are **390.4 → 395.7 ms default**
and **489.8 → 476.4 ms Worker**. This optimization improves offline readiness;
it does not materially move the first answer. Raw load-5 ranges are
21.91–24.83; the ten probe phase runs per variant have load-1 7.24–15.67
and load-5 17.26–21.66. Full per-run facts are in the compressed raw evidence.

## Where the time goes

The pre-product attribution is recorded in [CONTEXT.md](CONTEXT.md). The
table below repeats attribution against preserved before/after clients, five
fresh runs per column. Values are independently computed medians in ms.

| Observed interval | Default before | Default after | Worker before | Worker after |
|---|---:|---:|---:|---:|
| Total acquisition, instrumented | 4898.1 | 2159.1 | 4557.5 | 2391.0 |
| Server production, `Server-Timing total` | 424.1 | 425.4 | 424.3 | 425.5 |
| Of server: engine snapshot/stream | 397.8 | 398.8 | 397.5 | 397.2 |
| Of server: remaining preparation | 26.6 | 26.7 | 26.8 | 26.9 |
| Sync fetch start through response headers | 432.3 | 433.1 | 431.7 | 434.1 |
| Body consumption (`Response.text`) | 38.9 | 37.6 | 63.5 | 62.9 |
| Outer response JSON decode | 9.8 | 8.7 | 11.9 | 12.4 |
| Wasm `apply`, including stage/publication/index/coverage | 413.8 | 390.1 | 423.5 | 396.0 |
| Wasm `drain` of persistence deltas | 91.2 | 90.8 | 92.6 | 91.4 |
| Other wasm calls | 81.9 | 73.5 | 128.4 | 109.6 |
| Strict persistence `save` elapsed | **3364.0** | **693.4** | **2587.9** | **500.9** |
| Of save: three bulk page/publication saves | 3157.9 | 506.9 | 2553.4 | 469.1 |
| First inbox answer | 388.7 | 400.8 | 485.2 | 501.8 |

These are nested/overlapping measurements, **not additive slices** of a
single exclusive timeline. Server time is inside header wait; body consumption
includes scheduling/copying; wasm apply includes wasm JSON decode; save includes
host JSON preparation, bucket work, browser scheduling and commit. Remaining
wall time includes session/device opening, schema/wire conversion, Worker
messages and event-loop scheduling. Chrome exposes no exact per-acquisition
physical disk-byte or native IndexedDB compression breakdown. The supported
attribution is to the strict persistence path, not specifically to `fsync`.

All four probe conditions transfer **3,652,183 UTF-8 HTTP body bytes in three
sync responses**. This excludes HTTP headers/transport framing. The snapshot
pages contain 9,801 and 1,811 row events (3,165,865 and 486,126 B), followed by
an empty 192 B stream catch-up response. The first snapshot costs about 69 ms
on the server, the second about 354 ms, and catch-up about 1 ms. Chromium's
network response-body spans total about 13–15 ms on loopback. No request,
partition, row or wire-byte reduction is claimed.

The timed interval also completes one schema request and first-screen query
refreshes. Total completed API request medians are **8 → 9 default** and
**13 → 12 Worker**, including the three sync requests; screen query refreshes
account for 4 → 5 and 9 → 8. Their scheduling overlaps acquisition. The exact
body-byte figure above covers the partition's sync responses, excluding schema,
screen answers and wasm assets. Their startup/processing time remains in the
end-to-end clock. Authentication precedes it. Per-request header timings are
retained in every raw sample.

Coverage and index work were also sampled in ten separate symbol-preserving
wasm CPU profiles, five before and five after, cropped to acquisition using
Chrome's monotonic navigation clock. Visible coverage stacks have **3.19 →
3.85 ms** median sampled CPU; row/index construction **54.52 → 45.51 ms**.
These are diagnostic samples subject to inlining and sampling error, not exact
exclusive timers or evidence of a coverage optimization. The shipping wasm is
byte-identical. The authoritative inclusive apply timings remain in the table.
Profiles, crop windows and classifier are retained for inspection.

The 1,000-membership account u0001 holds **90,500 messages / 105,034 total
rows**, transfers **39,759,320 B in 12 responses**, and has about **46.21 MB
logical data / 769,064,960 B wasm heap** (not total Worker RSS). Its five-run
phase medians are:

| Heavy Worker phase, ms | Before | After |
|---|---:|---:|
| Server production | 2993.0 | 3005.6 |
| Header wait | 3039.9 | 3047.7 |
| Body consumption / outer JSON decode | 420.1 / 105.8 | 404.9 / 112.8 |
| Wasm apply / drain / other | 9480.7 / 891.3 / 835.3 | 9491.0 / 888.0 / 800.7 |
| Strict persistence | 8993.3 | 8322.7 |
| First inbox answer | 471.0 | 472.1 |

The bounded leaves eventually match the prior 256-bucket capacity, so the
heavy case improves modestly, not by the probe's factor. Its publication/apply
and repeated persistence remain substantial. This lane does not claim the
heavy account meets three seconds or that calibration #24's >90 s is solved.

## Implementation and preserved contracts

Format 3 starts with **64 roots per packed namespace**, instead of 256. A
root exceeding **512 entries or 256 KiB UTF-8** splits once into four bounded
leaves. Leaves keep the existing sticky per-row overflow policy. The directory
is bounded at 64 roots plus 256 leaves; one ordinary mutation reads only its
root and addressed leaf. No unbounded directory, overflow scan, whole-store
rewrite on an ordinary update, or relaxed durability is introduced.

Rows, staging, metadata, watermark and outbox remain in the same strict
IndexedDB transaction. A conditional save checks its predicate after every
root/child callback has queued writes and commits in that callback turn.
Format 1/2 opening migrates packed **and overflow** rows together in one
strict transaction. An abort preserves the old format. Removing old direct
overflow entries prevents them shadowing a subsequently updated packed row.
Legacy unmarked per-row stores retain their representation.

The three probe bulk transactions now issue **257 bucket/range reads instead
of 1,025**, and **1,439 puts instead of 2,015**. They still write about 16.02
million bucket-value characters in total; fewer physical records matter here,
not smaller logical data. Bulk transaction count stays **three**, all strict.
The heavy account retains twelve bulk transactions; reads fall 3,329 → 3,137
and puts 16,667 → 16,411. Auxiliary watch/metadata saves vary slightly with
scheduling and are included in the raw evidence.

The default page's median longest ≥50 ms task is still about 287 ms after
the change; the Worker has no ≥50 ms page task in these acquisition intervals.
That distinction motivates the existing Worker recommendation. It does not
establish arbitrary UI responsiveness or live-write latency under every load.

No changes to auth, disclosure, meters, coverage algorithms, completeness,
schema, declared horizons, server protocol, wasm or public contract. No table
is deferred or omitted. `useAcquisition` still observes durable page apply and
only reports acquired after publication. The governing record is updated in
[LLP 3000.007 §20.4](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#204-a-queued-web-write-survives-navigation-s29).

Rejected trial: replacing the 256 individual reads with one grouped read
reduced request count without improving wall time (about 4.75 s Worker /
5.17 s default). A private fixed-64 trial demonstrated the opportunity but
would spill heavy stores too early; adaptive splitting retains the caps.
Exploratory results are not mixed into the qualified five-run samples.

## Correctness and validation

The retained-fixture witness compares **every persisted row and value** after
closing the app with the snapshot/catch-up events: all 50 official runs have
zero missing rows and zero mismatches, and the offline inbox is complete.
There are 11,612 expected/stored probe rows and 105,034 heavy rows. This is
client retention evidence against the server's delivered partition; it is not
a replacement for the existing server authorization/coverage suite.

The browser regression adds 12,000 known rows, acquires all three pages using
both devices, closes and reopens with network disabled, then pages every row
and checks values, uniqueness, complete flags, restored acquired state and
honest staged-to-acquired progress. Further tests pin 64 reads/64 bucket writes
and one strict transaction for 10,000 rows, aborted split atomicity, conditional
child-save fencing, and format-2 migration rollback with overflow, outbox,
watermark and staged data. Existing colliding-row bounds and deletion tests
continue to exercise spills and aborted publication.

The intentional `many-roots` mutant is rejected: it produces 256 reads and
256 writes, and also fails the split-abort assertion because that root no
longer splits. This is a successful negative control, not a product failure.

- Affected browser/client tests: **241 passed / 0 failed / 0 skipped**.
- Separate real-browser Worker protocol witness: **48 cases passed**.
- Whole guide, final text: **98 passed / 0 failed** (2.23 s).
- `scripts/test.sh` ran **once**, exit 0. Exact summary:
  **`== 0 failure(s) in 1967 s`**. All Rust targets, doctests, fixture wrappers,
  typechecks, release/size checks and client stages passed. The client stage
  totals **4,565 passed / 0 failed / 10 skipped** across its shards; final
  seeded models **79 passed / 0 failed**.
- Reference audit and whitespace checks pass. Reproduction tools pass syntax
  checks; retained evidence verifies all 50 sample assertions.

Final guide-only placement edits were validated by the separate 98-test
guide run. Product code remained unchanged during the full suite.

Full-suite command, from `snapback4/`:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=8 bash scripts/test.sh
```

The 1,967 s includes a cold test-inventory build; the existing 60 s suite
budget remains missed. No timeout, skip, test count or size cap was relaxed.
One **introduced guide failure** occurred during the separate guide check:
the client card exceeded its existing 130-line cap. Moving the complete code
recipe to `guide sync` leaves a 114-line client card with measurements and
steps; the final whole-guide rerun passes. No baseline or environmental
product-test failure occurred in this invocation. Expected mutant refusals
and corrected setup mistakes are itemized in [FAILURES.md](FAILURES.md).

Canonical wasm: **2,040,529 B raw / 592,975 B gzip**, unchanged, **744 B below
the 593,719 B gzip cap**. No budget increase. SHA-256
`3fb9d26ca58097b01fb3fcfdf6f0c02b0416d1969565bd84e7d463b7fa98998b`.

## Guide and reproduction

The published `guide client` card now gives the observed
probe/heavy times, recommends the Worker for this workload, and links the
complete public-API timing recipe in `guide sync`, with fresh profiles, five repetitions, first answer
versus acquired, host/network facts and offline completeness checks.

For a 10-core M1 Max, **5–8 s probe / 60–90 s heavy** are planning estimates,
not measurements or promises. The probe estimate applies roughly the observed
Mac/Linux baseline ratio to the improved result, allowing fixture and browser
variation; the heavy estimate is a conservative several-times eb1000 range.
The provided calibration #24 account is not proven identical to u0001.
Re-run the published recipe on the actual Mac and largest declared partition
before making a Mac qualification claim.

From `snapback4/`, after building and preserving each variant's package dist:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 cargo build --profile production
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
# In a separate terminal, serve only your writable copy of the retained store:
# /absolute/path/to/target/production/snapback4 dev --port 49741 --replay --no-watch
python3 reports/20260929-aq-fast-acquisition/tools/measure.py \
  http://127.0.0.1:49741 ../target/aq/repeat ../target/aq/before-sdk packages/snapback4/dist
python3 reports/20260929-aq-fast-acquisition/tools/summarize.py ../target/aq/repeat
```

`browser.mjs` alone defaults to five repetitions of both devices. `AQ_ACCOUNT`
selects u0500 or u0001; `AQ_MODES=worker` selects the Worker. `AQ_DIAGNOSTIC=1`
adds timers to a private copied dist, including the Worker realm. Ordinary
timing runs do not patch the device implementation. The harness observes
public acquisition and uses internal progress inspection only for telemetry.
It never emits tokens, session records or row contents.

`AQ_PROFILE=1 AQ_MODES=default` additionally captures page CPU profiles.
Build a separate symbol-preserving wasm with `CARGO_PROFILE_WASM_STRIP=false`
and normal `wasm-bindgen --target web`, without overwriting shipping artifacts;
run `tools/cpu.py PROFILE_DIRECTORY` to reproduce sampled attribution. These
larger diagnostic artifacts are excluded from the primary timing result.

Compressed evidence retains six aggregated raw sample sets, their summary,
ten cropped CPU profiles, build/test logs and input hashes. To resummarize,
decompress each measurement `.json.gz` to its basename in a temporary directory
and pass that directory to `tools/summarize.py`. No database or credentials are
committed. No push or publication was performed.
