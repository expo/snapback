# Workstream FLAKE

Branch `sb4-w10-flake`; base `d814b279d0`. Initial status was clean and
`git log sb4-loop..HEAD` was empty. No other worktree was changed. No push.

| Item | Resolution | Commit |
| --- | --- | --- |
| Quote layout/interaction | Wait for app reads, layout revision/geometry across two frames, and the hook's settled ID. Compare viewport-relative position, exact scrollTop and zero scroll commands. Await initial seen acknowledgement; delegate click recording to the document so revalidation cannot detach the stopwatch. Real Playwright click retained. | `b5888d257a` |
| Changes latency | Measure the serving thread's actual condvar interval; hold at least 600 ms after admission and wake with a commit. Headers and registry must exclude the entire interval from engine/wait; refresh keeps its 150 ms engine floor. Issue closed. | `2ebdd3c676` |
| Sweep | Replace tight lock-independence timing with held-lock/notification barriers. Join the second-wait barrier and writer cleanup. Prove buffered console flush through the real stopping branch with a frozen console clock; signal tests preserve eight records across windows. Recorder wall time is diagnostic. Sixteen timer-sensitive client files run serially after pool cleanup with unchanged latency assertions; account-switch workload uses the existing work-scaled hang guard. | `2ebdd3c676` |
| Cold Lean initialization | Serialize every default-path refresh with a persistent file lock across threads/processes. Preserve source freshness, explicit oracle override and missing-tool fallback. | `87fb474438` |

The quote movement was screen-origin change above the transcript, not a
product scroll-restoration defect. Product jump code, 2-second arrival limit,
1.8-second highlight and 4-second failure/settle constants remain unchanged.
The pooled beyond-horizon timeout had no start timestamp: initial seen-receipt
revalidation replaced the node holding the test's click recorder. It is now
recorded on a stable ancestor after the app's receipt acknowledgement.

## Required repetitions

All required runs used 24 additional CPU-burning processes on 96 available
CPUs. All 24 were verified alive at final test completion, then stopped by
recorded parent PID; parent and children were verified gone. Cargo used
`CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.
No Rust test-thread override or client seed/work-count override was set.

| Run | Files/work | Passes | Failed | Skipped/ignored | Result |
| --- | --- | ---: | ---: | ---: | --- |
| Client 3 | 375 files at pool 24, including 16 drained serial timer files; 2 serial models | 7,419 | 0 | 56 | Exit 0/0 |
| Client 4 | Same 377 files and full model counts | 7,419 | 0 | 56 | Exit 0/0 |
| Client 5 | Same 377 files and full model counts | 7,419 | 0 | 56 | Exit 0/0 |
| Rust 2 | Full workspace, default libtest threads, including doctests | 5,907 reported | 0 | 41 | Exit 0 |
| Rust 4 | Full workspace, default libtest threads, `--no-fail-fast`, including doctests | 5,907 reported | 0 | 41 | Exit 0 |

**Pass counts: full client 3/3; full Rust 2/2 under load.** Client cancellations
and TODOs were zero. The 56 client skips retain existing platform/opt-in and
historical-binary requirements, including macOS native witnesses. Rust ignored
measurements/deeper campaigns remain separate from the requested default suite.
Session and online models kept 5,000 and 3,000 sequences. Quote witness:
38/38 in each of the three corrected pools, plus focused passes.

## Other verification

- Frozen Bun install, native build, wasm build and package build passed.
  Wasm: 698,731 B gzip against unchanged 699,231 B budget.
- Affected server tests: 189 passed, 4 ignored. Ephemeral target: 14/14.
- Guard census and serial-group failure/order regression: 2/2; full runner file
  independently reviewed at 43/43.
- Lean target: 29/29 cold, 29/29 warm, plus two independent processes sharing
  a cold cache: 2/2.
- Three planted Rust regressions were rejected: poll sleep counted as engine,
  missing ephemeral notification, and missing buffered console flush.
- Revised quote recorder still rejects eight-second arrival and 100 ms
  highlight negative controls at the original assertions.
- `./ref-check --verbose`: 543 LLP docs, 11,120 refs, 0 errors/unchecked.
  Docs budget: README 320/320 physical lines.
- Final independent reviews: Muse and fresh Codex both READY (round 5). Verbatim output/provenance
  retained under `llp/reviews/3000-flake-20261013-round*.{muse,codex}.md`.
  Muse's authorized wrapper API fallback handled plan-quota exhaustion;
  credential contents were never exposed in tool output or reports.

## Failed attempts retained

Client 1 overlapped cold Rust preparation/intermediate changes: two generated
trace imports were absent; the 15-second account workload timed out; quote
recording timed out. Client 2 had only the lost quote recorder. These attempts
were not counted as passing repetitions.

Rust 1 failed 17 Lean initialization cases when concurrent Lake builds read
partly written C/object files. The refresh lock fixed that race. Rust 3 caught
an immediate cleanup assertion in the new shutdown witness: foreground return
can precede writer lock release when its bounded wait expires. The sink-drop
completion signal now joins actual cleanup before inspection; Rust 4 passed.
No product timing bound was raised. First passing Rust 2 already exercised the
same product delta; the later test change only joins cleanup, and was verified
in the complete Rust 4 retry.

Only this worktree's unused incremental caches left by early review subprocesses
were removed to recover about 8 GB; test binaries/fixtures were retained. Final
review invocations and prompts propagate the required Cargo flags.

Log names in the tables refer to retained `.log.gz` files; `logs.json` records
their compressed and uncompressed SHA-256 values.

Detailed commands, result/count JSONs, source digests and compressed complete
logs: `snapback4/reports/20261013-flake/`. Reproduction wrappers there are
evidence, not new publication gates.

Deferrals: none for the workstream. Existing opt-in/platform skips are explicitly
not claimed as executed. Delivery is committed locally; no push or publication.
