# Failure and correction ledger

No failed batch is dropped or replaced. Frozen-curve failures are measurement
results, not test failures: [CURVES.md](CURVES.md) prints each aggregate margin
and the number of passing rounds; `evidence/summary.json` retains every round's
margin. In particular, the initial baseline search/Insights midpoint margins
are −0.372/−0.034 ms. The unchanged ceilings apply to all configurations.

## Validation

The complete suite ran once and exited 0: **`== 0 failure(s) in 1690 s`**.
All product stages pass, including 4,848 client tests (ten declared skips) and
79 final model tests. Affected store tests (4), PF scale tests (2), and the
whole guide (98) pass. No device or server runtime implementation changed.

The documented **60-second total target is missed**. Classification: baseline
budget miss, with cold-build/shared-host effects on this run's elapsed time.
The base journal's LV round-11 entry already records 1,322 seconds. This run's
Rust stage takes 920 seconds, client stage 368, and model stage 328. No limit
was raised or test count reduced. This timing miss is separate from the
script's zero failed stages; no product-test failure is labelled baseline or
environmental.

## Corrected errors belonging to SQ

| Failure | Classification | Resolution and retained evidence |
| --- | --- | --- |
| Initial orientation reads found an uninitialized LLP skill symlink and several guessed paths that did not exist. | Ours, setup | Initialized the pinned `vendor/llp` submodule, read `llp-orient`, and located the actual guide/server/config paths. No product state changed. |
| SDK build reported three TS2307 errors for absent generated wasm modules in `web-wasm.ts`, `web-worker-runtime.ts`, and `web.ts`. | Ours, fresh-tree setup | Bootstrapped this lane's measurement SDK from PF's generated artifact, then rebuilt successfully. The required full suite subsequently rebuilt canonical wasm from this checkout. Both SDK logs are retained. |
| First partial live attempt launched immediate probes in a fresh Node subprocess. The initial history call cost about 29.5 ms client-side versus 2.1 ms server-side. | Ours, invalid experimental method | Intentionally stopped only the owned replay/server at about 40,000 scale actions. Retained its 10% curves/host observations under `evidence/subprocess-attempt/`, outside the completed replay. Replaced with same-process probes through existing clients. No full-replay claim attaches to the partial attempt. |
| Replacement replay setup raised `MODULE_NOT_FOUND` for `undici` after copying through the SDK symlink. | Ours, harness setup | Restored a symlink into this lane's installed SDK; `prepare-live.py` now preserves symlinks. No workload started in that failed setup. |
| Queue sampling used `$.status` instead of the store's encoded `$.Row.status.String`, giving false-zero Following counts at 10% and 50%. One exploratory SQL lookup used nonexistent `op` instead of `program`. | Ours, attribution tooling | Corrected the sampler for full scale. The original `10%-queues`/`50%-queues` JSON remains **invalid for Following counts**. Corrected post-verification snapshot counts are separately retained and labelled; they are not represented as simultaneous replacements. |
| Initial pragma regression expected `foreign_keys=0` on every opener. Detached/read-only connections actually retain bundled SQLite's default of 1. | Ours, test authoring | Corrected the assertion to writer 0, readers 1. The first failure and the four passing affected tests are retained. Production pragmas were not changed to fit the test. |
| Physical analysis assumed 91 server requests (21 warmups plus 70 probes), but a queued 16 MiB run contained 92 due to an additional SDK read. A dependent summary then read stale output and raised a key error. | Ours, parser assumption | Correlate operation and timestamp windows and assert against captured server-request counts. All 71 measured server requests in that batch are retained. |
| Initial strace analysis omitted completion status/duration from calls split across unfinished/resumed lines. | Ours, parser gap | Join by thread and syscall, retaining the original start timestamp. Recompute every trace and assert that every query-thread call has a duration. Final checkpoint-overlap counts are 22/20/18, maximum per-query futex time 1.024 ms. Earlier 2/3/18 and 0.066 ms figures are superseded. Zero SQLite lock-busy results and busy sleeps remain supported. |
| Initial evidence collector selected `SQ_QUERY` rather than `SQ_BEGIN`/`SQ_END`; a process inspection split `/proc` stat incorrectly for a name containing spaces; one patch had a stale context line. | Ours, audit/tooling | Corrected the explicit record allowlist; used `PPid` from process status; reapplied the patch with exact context. Final archive contains all numeric query records. |

The first-read timing statement is also clarified: 7/4/8 ms is delay from entry
to the checkpoint hook. Delay from the last action's recorded settlement is
19/63/11 ms; intervening prefix hashing/state persistence belongs to the adapter.
Both intervals are in `evidence/probe-delays.json`.

## Limits that remain

These are Linux measurements on a shared host with recorded batch load. They do
not establish the cause of the calibration Mac's slowdown. Traced wall times
include tracing overhead. Mmap/cache counters do not measure OS page faults;
no filesystem cache was flushed. Restart controls drain background work first.
Read-only controls do not remeasure the celebrity write rule. The original
baseline/cache/restart runs have a single ten-read deep-page supplement; the
final before/after controls strengthen that supplement to nine rotating
batches with three warmups. Earlier supplements are not relabelled as nine.

The superseded measurements and corrected SQ errors above remain visible
although the final product tests pass. The baseline timing-target miss remains
explicitly open; no environmental product-test exemption is claimed.
