# PRL round 0 — per-row loading

Base: `d959efe2edf405e1270dce35f75703d89a0ccbf7`, branch
`sb4-intent/prl-per-row-loading`, eb1000 (`expose-builder-pixel`). Nothing is
pushed or published. Toolchain, affinity and wasm inputs are in
[environment.json](environment.json).

## Cause

The first bad listed landing is PR `096a1b78ef`; the introducing commit within
it is **`c3c4ed0976`**. Its exact first parent `c586a5904f` passes the original
online test **10/10** and it fails **10/10**. Nine bisect positions each ran ten
times. [BISECT.md](BISECT.md) names every position and links the raw evidence.

That commit correctly starts online revalidation's one-second authority bound
at change receipt, including queue wait. Independently completing row requests
then repeatedly notify React and walk the entire tree; nested timer turns add
more delay. Later rows exceed the second and `ReadEpisode.check` withdraws them
with `change-timeout`. Main's instrumented last replacement starts at 1,276.5 ms.
This is not an accidental reset by the local authority revision, remembered
answer retirement or detached-owner fences.

## Change and safety

Online accepted answers still publish immediately. With a queue backlog,
positive subscriber callbacks share a window of at most 50 ms in a browser
(one timer turn elsewhere), flushed sooner when the backlog drains. The batch
captures the subscribers present at publication and rechecks live ownership
and subscription membership before delivery. It stores no read body.

The retiring answer's episode deadline caps the window. Empty/null replacements,
answers with old or new row deadlines, failures and withdrawals bypass it.
Invalidation, denial, reset, refusal and expiry continue to notify immediately.
A held positive batch cannot resurrect a refused answer. Five direct boundary
regressions fail the initial implementation and pass the correction.

Capacity turns use `scheduler.postTask`, falling back to `MessageChannel` in
browsers and the existing timer mechanism elsewhere. Only a real host task
resets the eight-start allowance. Active capacity, priority, cancellation,
local queue-clock pause, online queue-inclusive deadline and authorization
predicates remain unchanged. Both browser task backends have deterministic
1,000-start/cancellation tests.

The causal React regression holds the positive notification turn: main commits
nine times for invalidation plus eight results; the fix commits once while all
eight new raw answers are already available. The initial control fails main
10/10; the final 32-row fixture independently fails main too. The existing
1,000-row tests, clock, timeouts and counts were not relaxed.

[PUBLICATION-AUDIT.md](PUBLICATION-AUDIT.md) follows every PR round-5/6 route.
LL's local publication, notified cuts, parked owners, media and metadata paths
are unchanged. PQ's eight-start/eight-active and zero-unrelated-evaluation
checks remain in the affected inventory.

## Verification

**Final affected tests: 1,202/1,202**, zero failures/cancellations/skips, across
59 files ([inventory](affected-hardened-files.json),
[output](raw/affected-hardened.log)). This includes all PR authorization files,
all per-row files, RL's answer/retention and full-count oracles, and LL's live
propagation/fallback/media checks. Final SDK build and typecheck pass.

**Unconfined browser cohort: 50/50 consecutive whole-file passes**, 350 cases,
zero failures/skips and no changed inputs ([receipt](raw/unconfined-final-50.json)).
**Loaded browser cohort: 50/50 consecutive whole-file passes**, 350 cases,
zero failures/skips and no changed inputs ([receipt](raw/loaded-final-50.json)).
The runner and all descendants used exactly CPUs 86–95 under SL's 48 busy
workers. All workers survived with recorded CPU time; the wrapper reaped them
on completion. The cohort took 2,311.5 seconds
([load record](loaded-final-50.json), [reproduction](REPRODUCE.md)).

The final complete client models pass **79/79**, including both default 5,000-history session models and
3,000 online interleavings. All runtime sources, SDK and wasm inputs remain
unchanged in this check ([receipt](raw/final-clients.json),
[output](raw/final-clients-01.log)).

The final complete client pool has **5,745 tests: 5,734 passed, one failed,
10 declared skips**. Its sole failure is ours: the conservative await census
hash includes the synchronous `batchReady` check inside the existing refresh
await. All 58 client awaits/I/O are unchanged; the review is in
[raw/await-expression-review.json](raw/await-expression-review.json). The
classification retains every delivery fault site/recipe; its corrected full
matrix passes **321/321** both in the isolated control and in the final lane
([final output](raw/delivery-matrix-final.log)). The audit-only update was
applied after both frozen repetition cohorts finished. No runtime, SDK, wasm or
executed browser-test bytes changed after those cohorts.

[qualification.json](qualification.json), checked by [qualify.py](qualify.py),
binds the per-run logs, unchanged runtime inputs, all 48 workers and the final
audit correction. Final reference validation passes: 525 LLP documents,
10,048 references, zero errors/unchecked ([output](raw/ref-check-final.log)).
Source/doc whitespace and all report links pass. The repetition inventories include tracked product/test
sources, wasm and built SDK files. Repetitions do not retry failures.

The **single** complete `bash scripts/test.sh` run returned exactly:

```text
== 0 failure(s) in 1385 s
```

[raw/full-suite-01.log](raw/full-suite-01.log) retains the full output. Client
pool: 5,740 tests, 5,730 passed, 10 declared skips, zero failures. Client models:
79/79, including the default 3,000 online sequences; wrapper tests: 9/9. Rust,
doctests, package guard, builds and app typechecks pass. No seed/concurrency/test
count override was supplied to this run; it selected 24 client files on 96 CPUs.
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` matches the packaged build.

**Scope of that complete run:** it preceded the additional five boundary tests
and the correction that makes empty/deadline-bearing callbacks immediate and
caps delayed callbacks at the retiring episode deadline. The complete run is
not represented as a final-byte qualification. Those final client changes have
the fresh affected, browser repetition, typecheck and build evidence here, plus
a separate repeat of the complete client/model stages using the same file
selection and default concurrency as the script.
The full suite was not repeated after that correction, respecting the requested
single run. [raw/full-suite-inputs.json](raw/full-suite-inputs.json) records its
exact sources/artifacts.

The whole guide passes **110/110**, zero ignored: `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo test --manifest-path snapback4/Cargo.toml -p snapback4-lang --test guide`.
See [raw/guide.log](raw/guide.log). No guide/Rust source changes followed it.

Wasm rebuilt with the locked toolchain (the canonical `gzip -9 -c` measurement): **1,994,357 B raw / 598,401 B gzip**,
SHA-256 `4830b5cc781889759c6dc4f3c595bbb14304b3e2391850a9c9f5a67ea9eb21d0`.
The **599,000 B** budget is unchanged (599 B remaining); this TypeScript change
adds no wasm code. See [raw/wasm-build.log](raw/wasm-build.log).

## Failures and limits

[FAILURES.md](FAILURES.md) classifies all failures and disqualified cohorts,
with a per-log machine-readable index. No failure was silently retried into a
passing repetition count. In particular, the first repetition cohort overlapped
a wasm rebuild and is disqualified; its worker/process startup timeouts are
assigned to our harness, with root cause unproven, rather than called baseline.

The guarantee is tested under the requested host/load conditions. It cannot
promise continued visibility after the existing online authorization second
under arbitrary suspension: PR's occupied-capacity revocation regression must
and does withdraw at that second. Positive notification latency is bounded
above by 50 ms (or the earlier retiring episode), subject to host delivery;
this is not a new authorization tolerance or a claim of universal latency.
