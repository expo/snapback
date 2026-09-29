# Empty-read diagnostic cost

All workloads use 55,210 successful HTTP reads, matching calibration #26's
scale-log line count. This is a synthetic diagnostic reproduction alternating
an empty page, missing point and composed missing point, not a replay of Clique
or a production throughput claim. No rows, secrets or credentials are used.

The old logger was already asynchronous. File/stderr I/O did **not** directly
block the request thread. The request still parsed the encoded response, built
a JSON evidence record, cloned context, updated a mapped atomic watermark and
attempted a bounded queue handoff. Its background writer cloned the record,
serialized the 32-record store, atomically replaced its file, formatted the
console message and wrote stderr for every accepted record.

## Exact response-path modules

`response-cost.py` obtains the old evidence modules from base
`4fd338de59407ab6b7cc7009e27001c877cacfe9` and the new modules from this tree.
It compiles both with the same ordinary unoptimized dev profile and pinned
dependency graph. A minimal host calls the actual `begin` and `response`
functions; a draining thread replaces disk/stderr to isolate producer cost.
It retains the 32-slot channel and actual mapped atomic watermark. Source
SHA-256 values and all seven rounds are in `response-cost.json`.

| Seven rounds of 55,210 calls | Old | New default |
| --- | ---: | ---: |
| Median per round | 543.611 ms | 162.559 ms |
| Median per call | 9.846 µs | 2.944 µs |
| Records constructed, all rounds | 386,470 | 0 |
| Accepted queue entries | 384,608 | 0 |
| Dropped queue entries | 1,862 | 0 |
| Final watermark | 386,470 | 0 |

The measured median delta is 6.902 µs/call (381.052 ms per burst, about 70%).
Parsing the response and creating/dropping the dev request scope remain. The
change removes evidence construction, its watermark update and queue handoff;
it does not claim to remove all developer instrumentation.

The same harness extracts the **exact old console formatting statement** and
calls the old `save` function for another 55,210-record component measurement:

| Old writer component | Time | Output |
| --- | ---: | --- |
| Console formatting into a reusable byte buffer | 148.417 ms | 13,747,290 B formatted |
| Same formatting plus unbuffered file writes | 2,518.000 ms | 13,747,290 B written |
| Ring clone, pretty serialization, private file creation and atomic replacement | 45,212.362 ms | 55,210 replacements; final snapshot 8,056 B |

These are elapsed component measurements, not additive request latency. The
store pass uses a shorter synthetic instance identity, so its byte count need
not equal the full HTTP pass. The old code does not fsync, and neither does this
measurement. Shared-host activity and cache state affect timings. There is no
corresponding writer work on new default empty reads: zero producer records
means zero formatting calls, queue entries or store replacements.

## HTTP burst with ordinary dev builds

`replay.py BINARY OUTPUT_PREFIX [COUNT]` starts a real `dev --fresh --no-watch`
server, verifies every response, and captures latency, all-thread CPU ticks,
Linux `/proc/PID/io`, persisted records, watermark and compressed stderr. It
waits 1.2 seconds after requests for the writer and console window to finish.
Snapshots are taken after startup, excluding the initial empty evidence file.
The payloads and binary SHA-256 are retained in each JSON file.

Both binaries here were built with `cargo build -p snapback4`, ordinary dev
profile, same checkout and toolchain. Run order: new, old, new.

| 55,210 HTTP reads | New 1 | Old | New 2 |
| --- | ---: | ---: | ---: |
| Request burst elapsed, s | 46.901 | 51.525 | 52.440 |
| p50, ms | 0.738 | 0.822 | 0.851 |
| p95, ms | 1.264 | 1.383 | 1.338 |
| Server CPU, s | 43.12 | 70.51 | 46.54 |
| File-descriptor write calls (`syscw`) | 0 | 1,804,077 | 0 |
| Bytes written (`wchar`) | 0 | 437,955,712 | 0 |
| Storage bytes charged (`write_bytes`) | 0 | 464,609,280 | 0 |
| Console lines | 0 | 54,669 | 0 |
| Console bytes | 0 | 16,815,858 | 0 |
| Retained records | 0 | 32 | 0 |
| Dropped evidence | 0 | 541 | 0 |
| Final response watermark | 0 | 55,210 | 0 |

Files: `matched-after-1.json`, `matched-before.json`, `matched-after-2.json`
and their `.stderr.gz` captures. The old accepted plus dropped records equal
55,210. Its newest record persisted; no old snapshot was mistaken for a new one.
Actual wire responses remain successful empty answers throughout. The changed
writer has no backlog to hide work outside the measurement window: its sequence
stays zero.

The elapsed HTTP results do not establish a general latency improvement: the
second new run took slightly longer than the old run. They establish removal
of console/file traffic and record churn; the isolated module run establishes
the response-path cost removed. CPU totals include all server threads and
background work, not just evidence handling.

`before-1` and `before-2` are additional old ordinary-dev bursts. The initial
`after-1` and `after-2` used Cargo's optimized test-profile executable by mistake
and are retained as superseded exploratory data, excluded from this comparison.
The mismatch was caught and corrected before making the matched-build claim.

Reproduce from `snapback4/` with the report's two Python scripts. They create
temporary projects and remove only their own files/processes. No benchmark or
new gate is added to the blocking suite.
