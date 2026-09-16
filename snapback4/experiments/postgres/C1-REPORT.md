# Lane C1 implementation report — 2026-09-15

## Fix round 1 — completed 2026-09-16

All previous work remains uncommitted. No commit, push, stash, rebase or branch
switch was performed. All edits are under `snapback4/`; the protected contract,
CLI sources, `engine/actions.rs` and `identity.rs` remain untouched. Local
verification uses Node **24.18.0**. The guide is still tested text, and every
changed source/artifact remains below 1,500 lines (`guide.rs`: 1,476).

| Finding | Change and focused evidence |
| --- | --- |
| B1 | Shared `rows::index_write` computes/validates before any write on SQLite, Postgres, core MemoryRows and browser MemoryStore. The browser/server test admits exactly 2,048 bytes, refuses 2,049, and verifies no partial row or index change. Device edits are limited to this write path and its tests. |
| B2 | Declaration refusal stays the primary `check`/source-adoption gate. SQLite adoption and existing Postgres open run one bounded-result index query, returning an offending table/index and exact entry count with a rewrite; fresh stores skip it. Deletes remain unrestricted, and updates can retain or shorten existing violations without increasing their lengths/count. SQLite, Postgres and browser tests load predecessor images and exercise cleanup. The indexes card documents this evolution path. |
| M1 | Get and lookup fill SQL gates the sum of serialized payload bytes before transfer, reserving 32× for decoding. Exact heap accounting remains. Transfer counters run immediately after SQL and before decoding/cardinality checks; both oversized fill tests assert zero rows and zero payload bytes transferred. |
| M2 | `Tx::rollback_program` explicitly clears the cache and handles program failure/conflict reread. `batch` rejects any case variant containing `ROLLBACK`; a test refuses lowercase SQL then exercises the supported rollback and observes the original row. |
| M3 | Every query/mutation differential asserts `calls_on <= calls_off + largest_marked_page + 4`, including cold calls, forced cuts, oversized payloads and the write matrix. Warm fixtures retain the stricter guard. Largest observed excess: **4 calls** (15 on / 11 off; six marked reads). Outcomes matched at 6,209 query/point-write and 15,873 page/write precharge positions. |
| M4 | All stores reuse the computed before/after keys; there is no extra `stored_index_keys`/word-tokenization validation pass. Idle-machine measurements and their limitations are below. |
| M5 | The walk visits `Check.current`, `WriteTarget.target`, condition values and `WriteCondition.setup`. A setup assignment disqualifies its alias; the regression test shows the same write target becomes markable when that assignment is removed. |
| Minor findings | `guide_for` maps the code to `indexes`; key-bound diagnostics run despite other schema diagnostics; cache subtraction saturates; `FILL_CONTROL_CALLS` is named/commented and tested for tiny, duplicate and already cached requests; tail ordering uses `debug_assert!`. |
| Replay follow-up | Added `issues/20260915-snapback4-postgres-replay-skips-the-id-binding.md`, linked to LLP 3000.009 §5.1 and `PostgresEngine::mutate`'s unbound replay. No bound replay implementation was added. |

### M4 idle measurements

The duplicate work was a real cost introduced by C1; it was removed. The
original Mac throughput regression is **not attributed to load** or claimed resolved by
cross-machine timings. All reachable Macs remained busy, so the repeat used
the idle `expo-build-450b` host (Ryzen 5 3600, 128 GiB, Ubuntu 24.04, NVMe,
Rust 1.94.0, Node 24.13.1). `vmstat` showed 98–100% CPU idle before and 100%
after, without swap traffic or another build/test job.

The existing benchmark now has `--sqlite-only`, reusing its exact fixture,
timing and writer functions, WAL/FULL and counter assertions. It permits the
requested SQLite cells to finish independently of Postgres stress failures.
[Raw results](./results-20260915-c1-fix-idle-sqlite.json): 200 timed point reads
following 20 warmups, 400 mutations in each four-writer cell.

- Point median **14.748 µs**, p95 **15.319 µs**.
- Four writers, same counter: **162.68 ops/s**.
- Four writers, disjoint counters: **158.51 ops/s**.

Two unmodified 1,000-iteration full runs hit SQLite's existing five-second
busy timeout on this host. A default 200-iteration full run exhausted
Postgres's existing serializable retry budget. These failed runs produced no
complete benchmark result; timeout/retry limits and durability were preserved.
The focused SQLite run completed and verified no lost increments. Its platform
and length differ from the original Mac baseline, so it does not establish recovery of
the original throughput or any Postgres performance-target success.

### Final suite results

`bash scripts/test-postgres.sh` **passed** on the final tree (exit 0):
15 conformance tests, 1 device test, 2 key-limit tests, 5 cache/adoption tests,
and 18 corpus harness tests. The corpus reports SQLite **211 passed / 83
skipped / 0 failed**, Postgres **208 passed / 86 skipped**. The exhaustive
conformance phase took 530.02 s; all 22,082 precharge positions matched,
and the largest observed call excess remained four. The private cluster was
stopped and retained at `/tmp/sb4-pg-eval.ubpgl0`.

`bash scripts/test.sh` is **not fully green**. Two complete macOS runs
failed the Rust and client stages. The later run reported **354/377 clients
passed, 21 failed, 2 cancelled**. Rust reported two socket-read `WouldBlock`
failures in protected `crates/snapback4/src/serve_tests.rs:106`, and one newly
added language test whose fixture incorrectly put an independent schema error
in the same table as the oversized index. The invalid table is removed before
bound checking, so the test was corrected to use separate tables. The corrected
language tests both pass; no protected CLI source was changed. Other macOS
stages passed, including all nine fixture wrapper tests.

A further complete run uses an isolated copy of the corrected source on the
idle Linux host, Node **24.13.1**. It finished in **602 seconds**, with the
**Rust workspace passing (989 passed, 4 ignored, 0 failed)** and two failing stages (fixture wrapper
and clients). All other stages passed. The client stage reported **375/377 passed, 2 failed, 0 cancelled**:
`acquisition.test.mjs:260` (process readiness) and
`navigation-model.test.mjs:670` (secondary-tab receipt recovery).
Both failed tests **pass together in an isolated rerun** (2/2); this does not
convert the full client stage into a pass. Its fixture stage initially lacked
the shared `benchmarks/fixtures/social-messenger` input outside the Snapback 4
fence; supplying that unchanged input made the standalone wrapper stage pass
**9/9**. An earlier Linux setup run included macOS transfer metadata files;
those were removed before this corrected-source run and are not product
qualification evidence.

The full-suite failures remain reported rather than hidden with larger
timeouts or unrelated client/CLI changes. Raw logs are retained under the
ignored `target/c1-fix-evidence/` directory. No Postgres replay-binding change
was attempted because that belongs to the explicitly separate lane.

## Original C1 record (before adversarial fix round 1)

Implementation is present, but qualification is **not fully green**: the
Postgres script passes; the blocking script fails its client step after two
runs. Both provisional performance targets are missed. See the exact evidence
and deviations below before integration.

All changes are uncommitted on the supplied lane branch. No commit, push,
stash, rebase, reset or branch switch was performed. All edits are inside
`snapback4/`. Node is v24.18.0; dependencies were already installed. Every
Postgres connection used a private socket-only cluster created by
`scripts/test-postgres.sh`.

## Design as built

- A runtime side table marks total related-read keys in page and derived-page
  loops, plus pinned rule probes. It handles immutable helper aliases, excludes
  filters, matching, merges, recurse, dependent keys and expiry, and never
  changes serialized IR. The hook reads row images and context directly;
  rules, meters and refusals remain in the interpreter.
- Postgres groups exact gets and lookups, including misses. A transaction-only
  cache has a 4 MiB budget, savepoint-protected all-or-nothing fills, per-table
  write invalidation and rollback clearing. Failed fills preserve earlier
  answers. `set_prefetch(false)` disables planning and filling; SQLite and
  device hosts use the trait defaults. Tiny batches are skipped.
- The serialized head lock supplies the next sequence. A data-modifying CTE
  batches the head, commit, all log events and outbox effects. Program-time
  writes remain immediate. The existing receipt call follows, then COMMIT;
  an error rolls back the complete transaction.
- The binder computes worst-case encoded composite keys, including tags,
  terminators, text/byte escaping, contribution groups and the appended id.
  Stores enforce the same bound before writes, including loads and maintains.
- The existing 64-character tokenizer cap is shared by indexed tokens and
  query terms. Its 256-byte maximum is now named and documented, with Unicode
  conformance tests; its semantics and contract version are unchanged.
- The corpus can run its existing oracle against Postgres. Feature/environment
  absence and unsupported C3 capabilities are named skips, never passes.
  Differential tests compare complete outcomes/refusals, including all meter
  fields, table dependencies, expiry and cut/refusal sites.

## Refusal and tested guide text

New code: **`E_INDEX_KEY_BYTES`**, documented in `guide/codes.rs`.

The indexes card states that an encoded key, including all components and the
appended id, must fit **2,048 bytes**. `check` uses declaration bounds and
encoding overhead and suggests a `text <=N` rewrite. Writes enforce the same
limit on SQLite, Postgres and devices. The card also states the **512-byte
combined UTF-8 table/index-name limit**.

The search card states that both indexed tokens and query terms truncate to
**64 Unicode characters after folding**, at most **256 UTF-8 bytes**, and that
longer queries use that truncated prefix. Complete word-index keys must also
fit the portable composite bound.

No protected existing schema needed editing. The corpus declaration audit's
largest encoded index is 1,303 bytes (`messages.byToken`); its longest combined
table/index names are 34 bytes.

## Measured portable bound

PostgreSQL **16.14 (Homebrew)**, **8,192-byte blocks**, original `i` primary key
`(t, ix, k)`, labels `items` / `byRoomTitle`, incompressible encoded keys:

- 2,672 bytes: accepted.
- 2,673 bytes: PostgreSQL `54000` refusal.
- `MAX_INDEX_KEY_BYTES = 2048`: 624 bytes below that measured key maximum.
- `MAX_INDEX_LABEL_BYTES = 512`: reserves the names' share of the same tuple.

Both engines accept exactly 2,048 encoded key bytes and return the same typed
refusal at 2,049; the old 6,000-byte counterexample now also refuses portably.
The test measures the physical limit afresh instead of asserting a fixed
Postgres-version-dependent number.

## Before and after measurements

Baseline: [`results-20260915-repeat.json`](./results-20260915-repeat.json).
After: [`results-20260915-c1.json`](./results-20260915-c1.json).
Both use 1,000 latency iterations, 20 warmups and 2,000 mutations per
four-writer cell. Benchmark workload/timing code was not changed.

| Workload | SQLite median before → after, µs | Postgres median before → after, µs | Postgres calls/op before → after |
| --- | ---: | ---: | ---: |
| Point | 5.7 → 15.7 | 116.9 → 468.5 | 5 → 5 |
| Page | 24.8 → 57.4 | 164.2 → 898.3 | 5 → 5 |
| Inbox | 137.6 → 344.0 | 1,894.1 → 2,234.4 | 68 → 8 |
| Increment | 54.0 → 188.3 | 441.2 → 2,509.0 | 18.002 → 15.002 |

| Four writers | Ops/s before → after | Calls/op before → after | Retries before → after |
| --- | ---: | ---: | ---: |
| SQLite same | 14,429 → 4,282 | not instrumented | — |
| SQLite disjoint | 15,479 → 4,363 | not instrumented | — |
| Postgres serialized same | 2,532 → 305 | 18.018 → 15.012 | 0 → 0 |
| Postgres serialized disjoint | 2,624 → 409 | 18.018 → 15.012 | 0 → 0 |
| Postgres serializable same | 2,217 → 344 | 20.512 → 27.056 | 874 → 3,011 |
| Postgres serializable disjoint | 2,182 → 355 | 21.936 → 28.832 | 984 → 2,764 |

The harness does not record latency samples for four-writer cells, so their
medians are unavailable in both runs. Other worktree suites ran concurrently
with this measurement; SQLite and the native SQL lower bound also slowed down.
These observations are not an isolated causal latency comparison.

**Targets missed:** page and inbox are 15.7× and 6.5× same-run SQLite median
(target ≤3×); serialized throughput is 305–409/s (target ≥5,000/s).

## Deviations and limitations

1. **Unconditional physical-call non-increase is incompatible with speculative
   prefetch before a meter cut.** A fill can precede zero logical reads, and a
   failed/oversized fill can consume calls without caching. Warmed fixture
   workloads assert non-increase; exhaustive cut tests report the overhead
   while asserting exact complete-outcome equality. Of 6,209 query/point-write
   precharge positions, 3,049 query positions made extra physical calls.
   Another 15,873 write-loop positions compare complete mutation outcomes.
   The optimization never changes meters to conceal this work.
2. **`_ops` is a separate call.** The brief both requests combining it with the
   tail and forbids editing its code. The explicit file restriction was kept;
   the batched tail runs immediately before the unchanged receipt writer.
3. **Names also need a bound.** A 512-byte combined table/index-name ceiling was
   added because those names share the physical B-tree tuple with the key.
   Without it, no positive portable key bound covers arbitrarily long names.
4. **Minimal edits outside the narrow primary descriptions:** SQLite's
   `core/src/store.rs` has one added validation call, necessary to enforce the
   write bound on both stores. `runner.rs` also changes the existing plan
   construction call and adds a derived-page hook; the requested DerivedArray
   support and default no-op hosts require these alongside the Page hook.
5. **Token cap already existed.** Reusing it preserves the serialized tokenizer
   contract and yields a stricter bound than the physical limit requires.
6. **Four-writer medians were never recorded by the baseline harness.** The
   available throughput, calls and retries are reported rather than estimating
   a median from aggregate duration.
7. The result is still an experimental Postgres host. Existing C3 capability
   exclusions remain explicit corpus skips. No CLI, packages, wire, value model,
   replay/receipt code, new gate, registry or inventory was changed.
8. **The blocking suite did not pass.** Both full runs passed Rust, builds,
   typechecks and fixture tests, but failed the client step. A narrower serial
   retry still reproduced two navigation port-rebind failures. Repairing the
   protected client/CLI harness is outside this lane's permitted changes.

## Every changed file

Paths are relative to `snapback4/`; “new” means a new untracked source/artifact.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/rows.rs` | Requests/default hooks, shared bounds and write validation |
| `crates/snapback4-core/src/store.rs` | One SQLite write-validation call |
| `crates/snapback4-core/src/words.rs` | Named token byte maximum, Unicode test |
| `crates/snapback4-core/src/engine/pages.rs` | Runtime prefetch plan integration |
| `crates/snapback4-core/src/engine/runner.rs` | Plan setup, Page and DerivedArray fill hooks |
| `crates/snapback4-core/src/engine/prefetch.rs` (new) | Total-key/probe planner and planner tests |
| `crates/snapback4-core/src/engine/postgres/mod.rs` | Runtime switches, meter-precharge evaluation hook, corpus load |
| `crates/snapback4-core/src/engine/postgres/store.rs` | Transaction cache/invalidation and reserved head/tail integration |
| `crates/snapback4-core/src/engine/postgres/log.rs` | Reserved head reuse and staged coalesced events |
| `crates/snapback4-core/src/engine/postgres/prefetch.rs` (new) | Savepoint batch fill and bounded exact cache |
| `crates/snapback4-core/src/engine/postgres/tail.rs` (new) | One head/commit/log/outbox CTE |
| `crates/snapback4-core/src/engine/postgres/tests.rs` (new) | Physical cache and failure/invalidation tests |
| `crates/snapback4-core/tests/corpus.rs` | Optional Postgres oracle leg and named skips |
| `crates/snapback4-lang/src/bind/mod.rs` | Key-bound check call |
| `crates/snapback4-lang/src/bind/key_bound.rs` (new) | Declared maximum calculation and binder tests |
| `crates/snapback4-lang/src/guide.rs` | Indexes card bound explanation |
| `crates/snapback4-lang/src/guide/codes.rs` | New refusal explanation |
| `crates/snapback4-lang/src/guide/search.rs` | Token/query truncation explanation |
| `experiments/postgres/tests/conformance.rs` | Portable counterexample and differential module |
| `experiments/postgres/tests/conformance/prefetch.rs` (new) | Complete-outcome differential tests |
| `experiments/postgres/tests/key_limit.rs` (new) | Physical measurement and portable-bound tests |
| `experiments/postgres/results-20260915-c1.json` (new) | Unmodified benchmark output |
| `experiments/postgres/README.md` | Design, evidence, measurement and limitations |
| `experiments/postgres/C1-REPORT.md` (new) | This handoff report |
| `scripts/test-postgres.sh` | Cache and dual-store corpus tests in the private cluster |

## Commands and verification

All cargo, bun, Node and script commands ran from `snapback4/`.

| Command | Result |
| --- | --- |
| `node --version` | v24.18.0 |
| `cargo check -p snapback4-core --features postgres` | Passed after fixing initial module visibility |
| `cargo test -p snapback4-lang --lib bind::key_bound` | 1 passed; initial bare-text test syntax was corrected to the language's explicit maximum bound |
| `cargo test -p snapback4-core --lib engine::pages::prefetch` | Final 3 planner tests passed |
| `cargo test -p snapback4-lang --test guide` | Final 25 passed, including every card and package README Quarry |
| `bash scripts/test-postgres.sh` | Final exit 0; detailed summary below |
| `SNAPBACK4_EVAL_ITERATIONS=1000 SNAPBACK4_EVAL_OUTPUT=experiments/postgres/results-20260915-c1.json bash scripts/test-postgres.sh --bench` | Exit 0; retained raw result, targets missed |
| `bash scripts/test.sh` (two full runs) | Both exit 1, client tests only; exact step summaries below |
| `node --test --test-concurrency=1 packages/snapback4/test/http-bounds.test.mjs packages/snapback4/test/navigation-model.test.mjs packages/snapback4/test/transport-http.test.mjs packages/snapback4/test/web-navigation.test.mjs` | 77/79 passed; two navigation cases still failed with address-in-use / connection-refused errors |
| `git diff --check` | Clean |

Postgres script summary from the final run (exit 0):

```text
PREFETCH inbox warmed calls on/off: (8, 68)
PREFETCH differential: 6209 pre-charge positions; 3049 query positions incurred speculative physical-call overhead; every complete outcome/refusal equal
PREFETCH write-loop differential: 15873 pre-charge positions; complete MutationOutcome equality
test result: ok. 15 passed; 0 failed; 0 ignored [conformance]
test result: ok. 1 passed; 0 failed; 0 ignored [device]
KEY_LIMIT: Postgres 16.14 (Homebrew), block_size=8192, i PK (t,ix,k), t=items ix=byRoomTitle: largest encoded key 2672 bytes; 2673 refused (54000)
KEY_LIMIT: 2048 encoded bytes plus 512 combined label bytes accepted
test result: ok. 2 passed; 0 failed; 0 ignored [key_limit]
test result: ok. 2 passed; 0 failed; 0 ignored [cache]
corpus (Rust server only; no TypeScript/replica conformance claim): 211 passed, 83 skipped, 0 failed
corpus Postgres: 208 passed, 86 skipped
test result: ok. 18 passed; 0 failed; 0 ignored [corpus]
Evaluation cluster stopped; data retained at /tmp/sb4-pg-eval.450CaX
```

Intermediate Postgres failures were fixed: the CTE needed an explicit bigint
cast for the head parameter; the added long-label measurement needed to
restore `search_path` after its measurement rollback. The final run includes
both fixes. The benchmark's production code is unchanged by the latter
test-only repair.

First blocking-suite run:

```text
-- ok: cargo build (39 s)
-- ok: wasm build (43 s)
-- ok: package typecheck (2 s)
-- ok: package build (2 s)
-- ok: chat app check (3 s)
-- ok: cargo test (1303 s)
-- ok: chat app typecheck (1 s)
-- ok: expo app typecheck (6 s)
-- ok: fixture wrapper tests (92 s)
-- FAIL: client tests (119 s)
== 1 failure(s) in 1392 s
```

The first client run repeatedly failed to bind `127.0.0.1:47815`. On the
final-code retry, clients reported bind failures on ports 47499 and 46661,
connection refusals and fixed HTTP/transport timeouts (356 passed, 19 failed,
2 cancelled). The serial four-file retry cleared HTTP/transport failures but
still hit a bind race at 47131 in two navigation tests:

- `pre-admission journal: 1 unawaited writes survive held save teardown`
- `W6R1 journal: caller ID stays fenced across replacement (offline reopen=false)`

The unchanged `witness/lib.mjs` helper kills a server without waiting for its
exit, and these files reuse one PID-derived port. That is consistent with the
observed rebinding failures. Protected package/CLI files were not edited to
repair the harness, and no test was skipped or weakened. **The requirement
that the blocking script pass is not satisfied by these runs.** Both runs also
exceed the repository's stated 60-second suite budget under shared-machine
load.

Final-code blocking-suite retry:

```text
-- ok: cargo build (28 s)
-- ok: wasm build (50 s)
-- ok: package typecheck (2 s)
-- ok: package build (4 s)
-- ok: chat app check (2 s)
-- ok: cargo test (789 s)
-- ok: chat app typecheck (6 s)
-- ok: expo app typecheck (6 s)
-- ok: fixture wrapper tests (79 s)
-- FAIL: client tests (111 s)
== 1 failure(s) in 875 s
```

Temporary raw run logs were removed after retaining these results; the raw
benchmark JSON is retained. Every changed source/artifact is below 1,500 lines.
