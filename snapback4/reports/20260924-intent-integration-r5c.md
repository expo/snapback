LLP 3000.013 integration, round 5 part c — 2026-09-24

Branch `sb4-intent/integration`, worktree `~/sb4-intent/lane-i`.
Read F rounds 4–5 external and committed reports, and L rounds 0–3 external
reports and full committed journal records before merging. L round 3 explicitly
supersedes its experimental reconstruction implementation and earlier claims.

| Source | Merge | Resolution |
|---|---|---|
| F `11a4cb35a` | `b320e0f41` | `--no-ff`; journal-only conflict. Preserve every entry, H certificate prose, and the Bob unrepost test. Workspace build passed. |
| L `e68d7a6e2` | `a8a36a911` | `--no-ff`; journal and feeds-card conflicts. Preserve every journal entry and F's structure and four compiled feed examples. Incorporate L's time slicing, FULL durability and precise lifecycle contract. Workspace build passed. |

No runtime conflict occurred in `serve.rs`, `serve_maintenance.rs` or the
timeline engine. Server integration, maintenance and `Store::open` match L's
reviewed head byte-for-byte. The original Bob unrepost test and all four
published feed examples also remain byte-identical.

F's imported file maps and execution witnesses are in
[round 4](./20260924-guide-review-r4.md) and
[round 5](./20260924-guide-review-r5.md). They tie refusal excerpts to actual
write outcomes, asset ownership and durable effect-step keys. L's full
file-by-file map remains in its four appended journal entries. Its final
behavior is FIFO engine admission, cooperative background slices, FULL disk
commits, atomic materialized-view retirement and dependent aggregate cleanup.
Historical redefinition refuses; the withdrawn reconstruction path is absent.

Integration changes, relative to `snapback4/`:

| File | Change |
|---|---|
| `crates/snapback4-lang/src/guide/feeds.md` | Keep F's Global → Following → Trending structure, examples and compatibility section. Explain L's atomic removal, empty-source activation, redefinition refusal and planned-view alternative in Boundaries; explain fair slices and FULL watermark durability in How it works. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Update the two timeline lifecycle definition pins to L's reviewed behavior. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pin the new lifecycle repairs, including empty event/edge tables and preserving application data; point to executed adoption/lifecycle tests. |
| `crates/snapback4/tests/maintenance_chunks.rs` | Find the published `view following:` block by declaration, because F's first example is now Global. Keep all slice assertions. |
| `crates/snapback4/tests/maintenance_latency.rs` | Select the same published Following block; keep every metric and performance assertion. |
| `crates/snapback4/tests/timeline_adoption.rs` | Select Following by declaration; keep all nine retirement/refusal tests. |
| `crates/snapback4/src/serve_lock.rs` | Restore `a_single_continuous_holder_cannot_defer_background_forever` verbatim from before L's round-3 test refactor. All seven existing tests, including exact 1 ms/5 ms boundaries and immediate admission, remain unchanged. |
| `JOURNAL.md` | Preserve both merges' entries and append one dated integration qualification. |
| This report | Record conflicts, source preservation, the Low follow-up, measurements and failures. |

The restored regression holds the sole request guard continuously and requires
the background ticket to exist before releasing that guard. No second request
can trigger the sustained-contention shortcut. All eight lock tests passed.
The exact requested mutation replaces `self.background_wait(&queue, started)`
with `self.background_wait(&queue, self.clock.now())`. The restored test fails
with `waiter did not enqueue` after its five-second harness timeout. The source
was restored byte-for-byte before subsequent qualification. This intentionally
failed negative control is not a remaining product failure.

Functional qualification: **422 distinct affected tests passed**, zero skipped,
after the isolated and bounded-concurrency reruns described below:

| Targets | Passed |
|---|---:|
| CLI unit tests, including all eight lock tests | 89 |
| CLI check 69, source/cost 8, clock 18, maintenance chunks 5, timeline 23, adoption 9, delivery 1, design 2 | 135 |
| Language guide 78, timeline background 17, epoch counterexample 1, timeline guide 4 | 100 |
| Device adoption 6, background durability 2, timeline 26 | 34 |
| Core action context 9, effect policy 12 | 21 |
| Simulator adoption 5, complete Clique target 3, write authority 35 | 43 |

The complete Clique fixture compiles without diagnostics and its three engine
tests pass, including Following, source authorization, planned Global, Trending,
predicate aggregate seeks and the digest sweep through completion. No target
form needed changing. Guide tests retain Bob's delivered cross-author unrepost
and execute F's new refusal/recovery witnesses. No new Quarry form or code was
introduced; supported forms include fresh `view following`, planned
`return activity last 20 by .at after c` after removal, and destructive deployment
with `--allow-destructive`.

One intermittent timing failure occurred in the first concurrent CLI unit run:
`serve::tests::full_poll_admission_preserves_short_request_progress` timed out
in its existing two-second `wait_until` helper. It **did not reproduce alone**
(0.06 s), and all 89 unchanged unit tests then passed with `RUST_TEST_THREADS=4`
(2.06 s), matching L's supported qualification setting. This is a concurrent
test timing failure, not one of the four recorded baseline failures. Its root
cause was not established; no timeout, assertion or production behavior was
weakened. Reproduction attempt: `cargo test -p snapback4 --bin snapback4` with
the host's default test concurrency; isolated reproduction uses that test's
full name and `-- --exact --nocapture`. No other functional failure occurred.

Built the integrated production server with Rust 1.97.0 and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`; SHA-256:
`2aa05c847a61b912ffc9540b032b270da24e655817ab1d0030ac6d6c326aa338`.
Ran the requested Cargo test target with that binary selected by
`SNAPBACK4_BENCH_BIN`, `SNAPBACK4_BENCH_ASSERT=1` and
`SNAPBACK4_BENCH_MAX_RATIO=1.5`. First ran all four ignored witnesses serially;
then ran `following_http_latency` twice more. All passed, without discarded
runs or tuning between measurements.

| Run | Post p50/p95, 5 followers (ms) | Post p50/p95, 900 followers (ms) | p95 ratio | All 20 celebrity posts delivered (ms) |
|---|---:|---:|---:|---:|
| 1 | 1.241 / 1.984 | 1.692 / 2.491 | **1.256×** | 4656.425 |
| 2 | 1.069 / 2.025 | 1.320 / 2.499 | **1.234×** | 4585.861 |
| 3 | 1.114 / 1.862 | 1.473 / 2.619 | **1.406×** | 4459.073 |

Every run checks every event's 900 follower copies plus its own copy, not only
the last task. Celebrity-reader p95 was 0.933, 0.876 and 1.198 ms. Under eight
continuous HTTP request streams, delivery completed in **463.985 ms**, with
4,007 requests completed, a 4.674 ms post acknowledgment and 1.343 ms read p95.
The isolated empty-fixture witness measured 900 copies in 116.903 ms,
**129.892 microseconds/copy**. The commit-profile witness also passed; its
controlled NORMAL/checkpoint comparisons alter only temporary test stores.
Production remains FULL with the existing checkpoint policy. These measurements
use the published Following fixture and a production-profile HTTP server;
direct engine profiling uses the requested Cargo test profile, not the full
calibration store. Cooperative slices still cannot preempt atomic rows or I/O.

Reproduce the performance qualification from `snapback4/`:

```sh
export LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT
cargo build --profile production -p snapback4
export SNAPBACK4_BENCH_BIN="$PWD/target/production/snapback4"
export SNAPBACK4_BENCH_ASSERT=1 SNAPBACK4_BENCH_MAX_RATIO=1.5
cargo test -p snapback4 --test maintenance_latency -- --ignored --nocapture --test-threads=1
# Repeat the following command twice for the second and third ratios.
cargo test -p snapback4 --test maintenance_latency following_http_latency -- --ignored --nocapture --test-threads=1
```

Reference validation passed: 505 LLP documents, 9,238 references, zero errors
and zero unchecked. Whitespace and source line budgets pass; largest changed
source is CLI `check.rs` at 1,459 lines. README stays 296/300 lines.

No part-c design deviation or open implementation blocker. The fixture selectors
and lifecycle text pins were necessary cross-lane adaptations. The accepted
historical-build limitation remains: edit an existing materialized predicate
or add materialization over populated event/edge tables to get the precise
refusal while preserving data. Use a planned view for retained history.
The concurrent polling-test flake above remains an observed test limitation.

`scripts/test.sh` was **not run**, as instructed; no new full-suite summary is
claimed. WASM rebuilding and remaining round-5 merges/qualification stay
deferred. No version bump, push or publication.

Evidence: `~/sb4-intent/integration-r5c-{build-f,build-l,lock,lock-mutant,
cli-unit,cli-unit-final,poll-alone,cli,lang,device,core,sim,ref-check,
production-build,latency-1,latency-2,latency-3}.log`.
