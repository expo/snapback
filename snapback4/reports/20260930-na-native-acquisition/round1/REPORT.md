# NA round 1 — acquisition resource bounds on merged main

Merged `origin/main` **11ddefd88c** first, in **6699793533**, preserving both
histories and BN's final CLI, receipt format 2, guide definitions and reconnect
proof. Read the round-0 prompt/report and both complete reviews, preserved here
as [Astra](astra-round0.md) and [Grok](grok-round0.md). [Scoped context](CONTEXT.md).
No new runtime optimization is included in this round. Nothing pushed or published.

## Review corrections

**Sorter memory is not whole-device memory.** Corrected the original report,
bounds card and LLP 3000.007 §20.4. SQLite spills sort runs and retains bounded
page caches; Rust does not retain all index keys. Publication does retain delivery
candidates per row. Astra's larger-partition review raised rows from **105,034 to
195,534**, Rust peak allocations **21.48 → 37.99 MB**, and RSS **50,084 → 88,736 KiB**.
This is inherited row-dependent memory, not a sorter regression. At fixed row
count, increasing entries to 7.67 million left Rust peak essentially unchanged;
SQLite peak grew 9.19 → 11.18 MB. These are review observations, not new round-1
allocation probes or a phone-wide RAM bound. The merged C ABI replay measured
**62,960 KiB peak RSS including Python**; no comparison with a host-free peak is made.

**Initial acquisition needs more disk than its finished store.** A new merged
replay reproduces the review: **699,438,280 B scratch** and **1,072,507,656 B total
high-water**, for **373,510,144 B final SQLite** — **2.87× final size**. The total
includes the staged database, WAL/SHM and unlinked temporary heap/sort files,
observed through `/proc/<owned-pid>/fd` every 20 ms. It is sampled logical file
size, not cumulative I/O, exact allocated filesystem blocks, or a universal bound.
At the sampled total peak the staged DB was 63,500,288 B, WAL 308,946,496 B and
SHM 622,592 B. [Full sample](direct-ffi.space.json), [sampler](sample-replay.py).
The bounds card says to allow at least **3× this measured final size plus device
headroom**, then prove the actual workload. A device with only enough space for
the final store can fail during publication. The transaction rolls back; freeing
space permits retry. Round-0 reviews tested SQLITE_FULL and sorter ENOSPC with
identical retry results; this round reruns the existing rollback and crash tests,
not those reviewers' fault-injection shims.

No scratch reduction is claimed. Explicit `temp_store=FILE` would select the
existing bundled SQLite `TEMP_STORE=1` behavior, not remove a file. The current
sort already spills with bounded caches; a scratch cap would introduce an earlier
space refusal rather than reduce the keys to install. Per-index installation
could shrink an individual sort run, but retains the temporary heap and entails
repeated heap scans or another index over it. It is not a demonstrated reduction
of the complete high-water mark with preserved latency, so no unmeasured variant
is adopted. Existing cache, WAL/FULL durability and publication boundaries stay.

**Next optimization:** remove the temporary index heap plus ordered second
write. Grok attributed about **4.3 s of a 9.07 s profiled final page** to those
two steps. This needs a bounded external key stream/sorter integrated with the
existing transaction and cleanup path, or a measured batched construction design.
A full Rust key vector would lose the spilling property; direct unsorted B-tree
writes restore the measured bottleneck. This round leaves that work explicit
rather than claiming it is safe or faster without implementation and fault proof.

## Merged measurements

Production build, three fresh stores per account and condition; seconds,
**median (min–max)**. Both server and witness run unconfined or pinned to CPUs
0–9 with eight owned burners. All samples, including the loaded heavy outlier,
are retained in [measurements.json](measurements.json) and raw format-2 receipts
under `measurements/`. Builds and tests did not overlap the series.

| Account | Unconfined acquired | 10 CPUs + 8 burners | Offline answer medians, same order |
|---|---:|---:|---:|
| 100 memberships / 11,612 rows | 1.060 (1.046–1.065) | 1.044 (1.044–1.048) | 0.048 / 0.048 |
| 1,000 memberships / 105,034 rows | 12.989 (12.949–13.116) | 14.691 (14.326–19.367) | 0.262 / 0.365 |

Round-0 optimized heavy medians were 12.895 / 14.654 s; its unsorted baseline
was 42.352 / 54.542 s. These rounds used different shared-host load windows.
The **10 s target and 5 s stretch remain unmet**. Small-account timings remain
about 1.05 s. These are warm-OS-cache process measurements on eb1000, not p95,
Expo startup, UI, media-cache or physical-phone measurements.

The **in-process C ABI replay is 9.552 s all calls / 8.833 s apply**, beside the
**12.989 s process-device acquisition**. The ABI replay includes native JSON
decoding, non-apply calls, final inspection and close, but excludes server sync,
HTTP, JS orchestration and process IPC. It replays round 0's captured requests;
it starts after `sb4_open`, is not an end-to-end acquisition, and its difference from the process figure
is not pure IPC cost. Expo links this C ABI in-process; it does not use the
Node JSON-lines subprocess. Round-0 ABI was 9.693 s all calls / 8.968 s apply.
[Per-call replay](direct-ffi.json), [round-0 runner](../replay-ffi.py).

All **12** runs pass BN's final proof: complete local query, offline reopen,
identical state/counts/coverage, and successful terminal reconnect with zero
row/scope events and no failed attempts. Round-0 and current receipts compare
after hashing the old table names into format 2: exact group coverage digests,
per-table row counts and payload bytes all match. [Comparison](receipt-checks.json).
Restart's local-answer and subsequent coverage-verification clocks remain separate.
Server-Timing and serverSyncMs are absent from final BN receipts by design;
no new server-time number is reconstructed or substituted from round 0.

Exact-request merged and round-0 ABI databases also hash-match all **105,034
rows**, **1,874,664 index tuples**, **2,000 cap-count rows**, **15 residency rows**,
and every metadata value except deliberately excluded random `store_id`.
Both integrity checks pass; WAL is retained. [Physical comparison](store-comparison.json).
The acquired heavy store remains 373.5 MB. The bounds guide uses these merged
medians, keeps BN's final receipt definitions, and fits **427 physical lines**
(round-0 allowance; incoming main had 443). LLP 3000.030 marks its pre-NA
profiles historical and links this result.

## Verification

Affected Rust: **531 passed, zero failed, one existing ignored heavy test**.
This includes native unit tests, acquisition/adoption/reopen, retained history,
prediction and the sorted-index equality/rollback regression. The crash model
passed **48 real process kills**: twelve each for initial/replacement acquisition
on SQLite and the memory atomic-save model. SQLite cuts: 1,503 / 1,610; memory
save cuts: 1,228 / 1,776. These sampled kills are neither exhaustive
instruction-level testing nor physical power loss or Chromium process kills.
[Complete affected Rust log](affected-rust.log).

Whole guide: **107/107**, zero failures. Reference check: **525 LLP docs,
10,018 refs in 30,696 files, zero errors/unchecked** ([final log](ref-check-final.log)).
The first affected SDK run passed **380** and failed **one** guide-text regression
that still required BN's pre-NA timings. Classified **ours**: updated that existing
check to require the new process and C ABI numbers, unmet target and separate
coverage-verification clock. The detecting correction passes, and the complete
witness file then passes **43/43**, zero failed/cancelled/skipped. The other six
unchanged affected files passed all **338** cases in the initial run. The failure
and original log remain in [FAILURES.md](FAILURES.md). No runtime assertion, seed,
workload, timeout or budget was weakened.

Ran `scripts/test.sh` **exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1431 s
```

All 13 stages pass. Rust **4,439 passed / zero failed / 33 existing ignores**;
client files **5,397 passed / zero failed / ten existing skips**, with no
cancellations; full-count client models **79/79** and fixture wrappers **9/9**.
Builds, release guard, docs budget and all package/app typechecks pass.
Full-suite failures: **ours 0 / baseline 0 / environmental 0**. The earlier
affected SDK failure is ours and remains disclosed above and in the ledger.
The inherited nominal **60-second** suite budget remains exceeded; no timeout
was increased and no workload was reduced. The 1,431-second run includes
679 s Rust, 412 s client files and 300 s client models.

[Source binding](suite-binding.json) confirms every tracked implementation,
test, guide and build input in its scope was unchanged through the full run;
before/after manifests are retained. [Full log](full-suite.log) and adjacent
exit status preserve the exact outcome. Logs are normalized only for trailing
whitespace; adjacent `.raw.log.gz` copies preserve original bytes when changed.

Rebuilt wasm: **1,990,092 B raw / 597,059 B gzip**, **188 B below** incoming
main's **597,247 B** cap. The cap's RX increase and shared-runtime changes arrive
through the merge; NA does not change that budget. Round 0's 593,233 B gzip and
593,719 B cap are historical, not the merged result. No per-lane byte attribution
is inferred. [Build log](wasm.log); [artifact hashes and exact gate size](artifacts.json).

## Reproduction and artifact scope

Host eb1000 / expose-builder-pixel; Linux x86_64, AMD EPYC 9454, Node 24.13.1,
Bun 1.3.14, Rust 1.97.0. Unconfined available CPUs: 96. Host samples and binary
SHA-256 accompany each measurement condition. Fixture is the existing lane's
private read-only-backup-derived HV/BN store under `target/na-envelope/store`,
served only from that copy with `dev --replay --no-watch`. Source fixture and
credentials are not committed to this report.

From repository root (fresh output directories required):

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=12 cargo build --manifest-path snapback4/Cargo.toml --profile production -p snapback4 -p snapback4-device
node snapback4/reports/20260930-na-native-acquisition/round1/measure.mjs
taskset -c 0-9 node snapback4/reports/20260930-na-native-acquisition/round1/measure.mjs --loaded
python3 snapback4/reports/20260930-na-native-acquisition/round1/summarize.py
```

The harness adapts round 0 only for its new report-relative imports and output
path; it invokes BN's current witness with three runs per cell, unchanged
accounts/query, restart and 300-second diagnostic run deadline. Production
binary build precedes final editorial guide figures; native runtime inputs do
not change. Qualification rebuilds the CLI from the final guide source.

Validation commands, from `snapback4/` (Node 24):

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=12 RUST_TEST_THREADS=12 cargo test -p snapback4-device --lib --test acquisition_crash --test adoption --test background_durability --test device --test heavy_acquisition --test index_key_bound --test prediction_write_set --test retained_history --test sqlite_bulk -- --nocapture
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=12 RUST_TEST_THREADS=12 cargo test -p snapback4-lang --test guide
node --test --test-concurrency=3 packages/snapback4/test/acquisition.test.mjs packages/snapback4/test/ephemeral-adoption.test.mjs packages/snapback4/test/keep-adoption.test.mjs packages/snapback4/test/maintained-column-adoption.test.mjs packages/snapback4/test/prediction-routing.test.mjs packages/snapback4/test/retained-history.test.mjs packages/snapback4/test/witness-acquire.test.mjs
node --test packages/snapback4/test/witness-acquire.test.mjs
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=12 bash scripts/test.sh
```

Final scoped documentation audit: the sorter/candidate distinction is consistent
across the corrected round-0 report, bounds card and LLP 3000.007; LLP 3000.030
marks the old attribution historical. BN's format-2 semantics and all current
CLI forms remain. One journal entry is appended for this round. The local commit
carries `Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. Nothing pushed or published.
