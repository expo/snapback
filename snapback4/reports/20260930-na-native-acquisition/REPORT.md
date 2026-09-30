# NA round 0 — native acquisition

Base: `ea4ec7b99f`, branch `sb4-intent/na-native-acquisition`. Nothing pushed
or published. Scope and governing constraints: [CONTEXT.md](CONTEXT.md).

Native acquisition is dominated by incremental index writes. Sorting the exact
index entries inside atomic publication cuts the heavy acquisition substantially
without relaxing durability. The final repeated series and qualification follow.

## Attribution

The baseline process trace acquires the exact BN heavy account: 1,000
conversation memberships and 105,034 retained rows. The acquired receipt is
[profile-before](profile-before/unconfined/u0001/acquire.json). Its 12 apply
calls spend **33.369 s** in SQLite index insertion, **2.246 s** in commit,
**1.321 s** in row SQL (including residency triggers), **1.006 s** staging
row SQL, **0.497 s** building word keys, **0.401 s** building ordinary keys,
**0.654 s** collecting delivery, **0.140 s** maintaining history coverage,
and **0.000548 s** saving acquisition boundaries. Native page decoding and
dispatch account for **0.430 s** inside apply calls. These are exclusive
instrumented spans; SQL spans include statement preparation/cache lookup,
binding and execution, not just SQLite VM execution. Counts and every page
are retained in [attribution-before.json](attribution-before.json).

The process witness's instrumented acquisition is **46.566 s**, including
**2.575 s** of server sync time. HTTP headers, body reads and JSON decode,
JS stringify/parse and process round trips are separately recorded in the
attribution JSON. Apply IPC totals **42.195 s**, versus **42.125 s** inside
Rust dispatch: the **70.658 ms** remainder includes pipe transfer, stdin/stdout
framing and scheduling, not pure wire bandwidth. Across all 77 commands, the
trace sends 80,524,166 bytes and receives 2,252,401 bytes (including diagnostic
commands outside the timed acquisition). There is one input frame per command,
not one per row. The first 11 apply calls stage rows in 75–296 ms each; the
empty final page publishes the complete partition in **39.809 s**. HTTP header
wait totals 2.615 s including server work; response-body reads total
0.152 s and body decoding 0.408 s across original and cloned responses. JS parse/stringify totals are
0.304/0.252 s. These overlapping measurements must not be added together. Capturing requests and profiling add overhead, so the
ordinary repeated receipts supply the performance claims.

Replaying those exact requests with typed Rust `Device::apply_publication`
and no subprocess transport takes **38.071 s** of apply time. The complete
replay (including non-apply calls and diagnostic coverage inspection) takes
39.026 s, **16.48 user / 22.18 system CPU seconds**, with **50,028 KiB**
peak RSS. A seccomp-filtered syscall trace counts **141 fsync calls /
0.241676 s** over the complete replay. Commit time also includes checkpoint
and other SQLite work; subtracting fsync does not identify every remaining
I/O operation. Evidence: [direct replay](direct-before-4.jsonl),
[resources](direct-before-resource-4.txt), [fsync](direct-before-fsync-4.txt).

This attributes the dominant loss to maintaining approximately 1.87 million
physical index entries through scattered B-tree writes with the bounded
SQLite page cache ([physical layout](sqlite-layout.json)). It does not support relaxing synchronous durability or
changing the process protocol.

## Implementation and intermediate measurement

Native snapshot replacement appends its exact validated index keys to a
SQLite temporary heap and installs them into `main.i` sorted by `(ti, k)`.
The external sorter can spill; Rust does not retain an account-sized index
vector. Staging, metadata lookup and staged scans reuse prepared statements.
An index insert statement is held across a row's index entries. Replacement
computes residency row/byte counters once with a grouped SQLite scan, then
restores its existing triggers before publication. Legacy temporary counters
keep their namespace; formerly occupied tables retain zero counters.

The rows, full indexes, caps, history, boundaries, watermark, acquired marker,
delivery and prediction replay remain in the existing publication transaction.
WAL, `synchronous=FULL`, page-cache policy, snapshot owner/continuation fencing,
all columns, indexes and horizons, and the process/Expo JSON protocol remain
unchanged. There is no new durable format. Scratch tables and trigger changes
roll back with a failed publication. Ordinary updates still use the original
row/index path and residency triggers.

The first sorted-index candidate, before the final statement/counter changes,
takes **10.249 s** in direct instrumented apply. Its bulk sort/install costs
2.886 s, temporary index insertion 1.381 s and row SQL 1.131 s. Peak RSS is
**49,324 KiB**, versus 50,028 KiB in the same baseline harness. Its complete
replay counts **141 fsync calls / 0.236520 s**. Coverage is identical to the
baseline ([digest comparison](direct-coverage.json)). The instrumented process
witness takes 15.313 s; a plain production probe takes **14.277 s**. This
candidate misses the 10 s target. These intermediate figures must not be
substituted for the final repeated series.

Sorting trades more sequential temporary-file traffic for fewer scattered
B-tree writes. The intermediate direct replay records 3,039,560 filesystem
output blocks versus 2,128,904 before (Linux resource counters use 512-byte
blocks). This is cumulative I/O, not peak live disk space. The final store
retains ordinary SQLite rows and indexes; temporary sorting is not persistent
residency. Native memory remains bounded independently of the account's total
index-key count. The measured web artifact is unchanged.

The final native C ABI replay, with no subprocess or pipe and including Rust
JSON decoding, takes **8.968 s** for apply / **9.693 s** for all calls. Its
coverage SHA-256 again equals the baseline. Peak RSS is **61,284 KiB including
the Python host**, so it is not directly comparable to the typed Rust harness.
[Final replay](direct-final-ffi.json) and [resources](direct-final-ffi-resource.txt).

## Final repeated measurements

Seconds; acquisition columns show **median (min–max)**, three fresh stores
per cell. Final server-sync and offline-restart columns are medians.

| Condition | Memberships | Before acquired | After acquired | After server sync | After restart |
|---|---:|---:|---:|---:|---:|
| 96 CPUs | 100 | 1.306 (1.196–2.114) | 1.056 (1.034–1.062) | 0.392 | 0.043 |
| 96 CPUs | 1,000 | 42.352 (41.494–42.698) | 12.895 (12.760–13.025) | 2.564 | 0.257 |
| 10 CPUs + 8 burners | 100 | 1.508 (1.466–2.075) | 1.042 (0.997–1.374) | 0.444 | 0.058 |
| 10 CPUs + 8 burners | 1,000 | 54.542 (45.785–54.995) | 14.654 (13.066–14.769) | 3.059 | 0.251 |

Heavy acquisition improves **69.6% unconfined / 73.1% under load**. The **under
10 s target and 5 s stretch are not achieved**; the remaining gap is 2.895 s
unconfined. The direct replay still spends 8.968 s in apply (including decode),
and the repeated end-to-end result includes about 2.6 s server work. Further
work must reduce this core path or overlap transport safely; fsync cost alone
cannot bridge the gap. No claim of phone performance is made.

All 24 before/after runs pass the witness, including offline identity/coverage
and row-count equality, with zero row or scope events on reconnect.
[Cross-build comparisons](before-after-coverage.json) also prove every account
retains identical coverage and table counts/bytes across all 12 runs. Heavy
allocated SQLite pages decrease from about 375 MB to **373.5 MB** due to index
packing; schema, retained rows and keys are identical. Small-account latency
improves in both conditions. Every sample, server total and restart appears in
[measurements.json](measurements.json), with raw receipts under `before/` and
`after/`. The bounds card records the final medians within its original
**427 physical lines**. BN's earlier native median (42.081 / 49.048 s) used a
different host-load window; this lane's before/after comparison uses the same
harness, preserved baseline binary and private fixture.

The fixture is this lane's private SQLite backup of BN's private copy of HV's
heavy store. The backup source was opened read-only. Only the lane's copy is
served, with `dev --replay --no-watch`; generated schedules and effects are
held. Both accounts, source Quarry and the witness command are BN's.
`u0001` retains 1,000 conversation groups / 105,034 rows; `u0500` retains
100 groups / 11,612 rows. Authentication material is not copied into reports.

Host: eb1000 / expose-builder-pixel, AMD EPYC 9454, 96 available CPUs,
Linux x86_64, Rust 1.97.0, Node 24.13.1, Bun 1.3.14. Production builds use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. The loaded series pins
server, witness and eight owned CPU burners to CPUs 0–9. Host samples are
recorded per second. OS caches are warm and unrelated lanes share the host;
owned builds and tests do not overlap the final measurement series. These
are three-run medians/ranges, not p95 or physical-phone measurements.

The witness's first complete local query is issued after acquisition. Offline
reopen uses a fresh native process with all HTTP blocked; coverage, table
rows/bytes and identity must match before reconnect, and reconnect must send
zero row/scope events. The retained group total is table/group pairs; the
conversation dimension comes from `groupsByTable.messages`.

## Crash safety and affected validation

The new model kills **48 real child processes** at reproducible seeded points:
SQLite VM instructions (including inside replacement/index/coverage work) and
memory-host writes/fsync/rename. It covers both an initially empty device and
replacement of an acquired image. A killed child executes no destructors.
Before restart, acquired state, watermark, row digest and coverage digest must
equal either the complete old image or the complete new image. A fresh owner
must reject an orphan continuation; restarting at page one must converge,
then survive another offline reopen. SQLite also passes `integrity_check`.
The memory host models the web's indivisible durable save with an atomic
filesystem image; it is not a Chromium process-kill or power-loss experiment.
Existing browser acquisition/adoption/retention tests exercise the actual
wasm persistence adapters.

The bulk regression compares rows, every physical index tuple, expiring cap
counts and residency counters against ordinary row insertion. It injects
both loader failure and duplicate-index failure, checks rollback and scratch
cleanup, then checks later ordinary deletion/insertion. All 58 native unit
tests, the 48-kill model and bulk regression pass. The affected SDK files pass
**338/338**, with no skips or cancellations. Focused Rust passes **531 tests**, with one existing ignore; it includes the
acquisition/adoption/reopen, retention and prediction cases on both stores.
The whole guide passes **106/106** after the documented editorial correction. The preliminary serial whole-device run was stopped after the long privacy model;
it is not claimed as complete. The full suite retains every model and count.

## Complete suite and wasm

Ran `scripts/test.sh` **exactly once**. Exit status: **0**. Exact summary:

```text
== 0 failure(s) in 1380 s
```

Rust passes **4,367 tests**, including 17 doctests, with **33 existing ignores**.
Clients pass **5,317**, with **10 existing skips**, zero failures and zero
cancellations. Full-count client models pass **79/79**, fixture wrappers
**9/9**. Every build, typecheck, release guard and docs-budget stage passes.
The wasm size gate passes unchanged. No full-suite failures are classified as
ours, baseline or environmental: there are none. Earlier corrected failures
and the interrupted preliminary run are individually classified in
[FAILURES.md](FAILURES.md); their original logs are preserved.

The inherited declared 60-second suite-time budget remains exceeded (baseline
budget overrun, not an assertion failure or a weakened timeout). The complete
suite took 1,380 s, versus BN's recorded 1,341 s in a different host-load window.
No test, assertion, model seed/count, timeout or size budget was removed or
relaxed. [Source binding](suite-binding.json) verifies that the implementation,
tests and guide were unchanged throughout the complete run.

`./ref-check --verbose` passes: 525 LLP docs, 9,995 refs in 30,417 files,
zero errors and zero unchecked. `git diff --cached --check` passes after packaging raw evidence. Redundant EOF
blank lines in display logs are trimmed; adjacent `.raw.log.gz` files retain
the exact original bytes. Patch evidence is losslessly gzip-compressed.

The rebuilt web artifact is **1,978,828 B raw / 593,233 B gzip**, exactly
BN's result and **486 B** below the unchanged **593,719 B** ratchet.
No web implementation or budget changes are included.

## Reproduction and evidence

From repository root, after the native production and SDK builds, with a fresh
private fixture copy at `target/na-envelope/store`:

```sh
NA_PHASE=after node snapback4/reports/20260930-na-native-acquisition/measure.mjs
NA_PHASE=after taskset -c 0-9 node snapback4/reports/20260930-na-native-acquisition/measure.mjs --loaded
```

Use fresh output directories; the product witness refuses to overwrite receipts.
`NA_BINARY` selects the preserved baseline executable. `NA_ACCOUNT` and `NA_RUNS`
are diagnostic overrides; both final series use the default two accounts and
three runs. The harness adapts BN's runner only for lane-local paths and these
overrides. It owns and reaps its server and burners.

`instrument.py` installs/restores the temporary exclusive phase profiler;
`capture.mjs` records HTTP/JSON/IPC metrics and writes request bodies only under
ignored `target/`. `replay.rs` is the typed no-transport runner used for phase
attribution. `replay-ffi.py` calls the native C ABI directly from a shared library
without an IPC subprocess. Profiling code is absent from the product change.
`summarize.py` preserves every measurement sample and each profiled apply page.
The instrumentation patches (gzip preserves unified-diff whitespace) and
superseded attempts remain as evidence, with
their distinctions explained above and in the failure ledger.

Runtime artifact hashes are in [artifacts-final.json](artifacts-final.json);
[artifacts-initial.json](artifacts-initial.json) binds the baseline, profiler
binaries, fixture Quarry and captured requests. The baseline executable matches
BN's recorded SHA-256. Timing uses the final runtime implementation; later bounds
text edits do not affect acquisition. The full-suite source manifests bind the
final implementation, tests and guide.

The governing design is appended to LLP 3000.007 §20.4. The journal has one appended entry for this round. The local commit carries
the requested `Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer;
nothing was pushed or published.
