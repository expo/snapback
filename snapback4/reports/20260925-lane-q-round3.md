# Lane Q — review round 3

2026-09-25. Branch `sb4-intent/q-expiring-counts`; reviewed starting point
`eece92909`. Astra's Medium examination-budget finding and Low admission-charge
test gap are fixed. Grok's completed review is READY, with no new High or Medium
finding. Its surviving native-copy reservation mutation is now detected too.
Implementation, regressions and the LLP amendment are commit `8aca506a4`.

## File map

Paths are relative to `snapback4/` unless marked otherwise.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/rows/adoption.rs` | Add a per-row callback work budget. Limit each page by remaining examined, steps and index entries, including the admission examination. Check the complete cumulative budget before decoding or callbacks; retain the existing heap admission checks. |
| `crates/snapback4-core/src/store/activation.rs` | Derive that budget from every contribution index, including its existing evaluation-step bound. |
| `crates/snapback4-core/src/store/activation_walk.rs` | Use the remaining cumulative budget on initial selection and every retry. Assert exact callback counts, retained rejected-attempt work, individual counter limits and pre-callback singleton refusal. |
| `crates/snapback4-core/src/engine/postgres/contribution_upgrade.rs` | Apply the same page budget to the per-index PostgreSQL walk. Count callback decoding separately from contribution evaluation. Expose the page helper only within its existing private PostgreSQL module for boundary tests. |
| `crates/snapback4-core/tests/expiring_adoption.rs` | Add the 256-row/63-view legacy upgrade and a 20-comparison-per-view variant that reaches the step limit. Verify all contribution indexes and stable reinstall. |
| `crates/snapback4-core/src/engine/postgres/tests/expiring_counts.rs` | Real PostgreSQL checks that each cumulative ceiling limits the fetched/admitted page before callbacks; assert admission counts and that subsequent work fits. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | Dated §20.9.3 amendment records the complete page budget and retained retry work. |
| `JOURNAL.md` | Append the dated review-resolution, measurements and qualification entry. |
| `reports/20260925-lane-q-round3.md` | This report. |

## Budget audit and decisions

Each SQLite source row requires one admission examination, one callback decode,
and one examination for each contribution index. Callback steps sum those
indexes' existing `evaluation_steps()` bounds. Each selected contribution emits
at most one index entry, so the number of contribution indexes also provides
the entry bound. PostgreSQL uses the same calculation for its per-index walk;
this now explicitly counts callback decoding as well as the contribution.

Before fetching a payload page, the walker limits its row count by the
remaining cumulative counters. It rechecks the entire page before admission
decodes. Heap admission still checks the resident serialized page together with
one active row's decoder and contribution scratch. A rejected heap attempt
drops its buffer and releases only heap; its examinations remain charged when
the next, smaller page is selected. Callback writes are never replayed.

A rejected attempt consumes at most one examination per candidate and no
callback steps or entries. An admitted row always budgets at least two
examinations (admission plus callback decode). Consequently, halving a rejected
page leaves enough of its previously admitted cumulative budget for the smaller
attempt; retries cannot make an otherwise fitting singleton fail by erasing
or unexpectedly exhausting the work allowance.

Only a singleton that cannot fit the counters or heap refuses. The empty range
remains legal even when a hypothetical source row would exceed a ceiling.
A new job meter starts only after an accepted page is fully consumed, as
before. The budget does not precharge hypothetical selected entries or steps:
their existing execution sites continue to charge actual work. It proves they
can fit before callbacks start.

The charged cumulative meters on this path are examined, steps and index
entries; all now limit page size. Heap remains a retained-page plus transient
row budget. The path does not charge rule probes, output bytes or rows written;
those meters belong to other execution paths. No ceiling is raised and no
existing charge is removed.

## Regression evidence

The reported upgrade was added before the implementation change. It reproduced:

```text
Examined: actual 16385, ceiling 16384
site: adopt receipts.$contribution:c9
```

`sixty_three_views_adopt_within_the_examination_and_step_page_budgets` now
passes both cases:

- 256 tiny receipts and 63 `view cN: count receipts by .principal` declarations.
  With 65 total examinations per source, pages contain **252 and 4** rows.
  Their complete examination costs are **16,380 and 260**. The total remains
  **16,640**, including all **256** admission decodes.
- The same 63 views, each with twenty `.payload = ''` comparisons. Each
  contribution costs 80 steps; each source costs **5,040**. The step ceiling
  selects **198 and 58** rows, costing **997,920 and 292,320** steps. Every
  selected source remains represented in each of the 63 indexes, and reinstall
  leaves the adopted store digest unchanged.

Four walker tests cover the boundaries:

- `callback_keeps_the_whole_fetched_page_reserved`: retains the independent
  heap lower bound, strengthens it to include both native copies as well as
  Rust-owned images, and checks `20 admission + prior callback + current
  decode` examinations at every callback.
- `heap_retries_keep_admission_examinations_at_the_callback_boundary`: five
  1,280 KiB rows require four rejected two-image attempts before singletons fit.
  Callback examination counts are exactly **[3, 3, 3, 3, 2]**, including the
  rejected admission work. No contribution steps or entries run on rejected
  attempts, and the retained buffer remains within the heap ceiling.
- `every_cumulative_budget_fixes_the_page_before_any_callback`: independently
  exercises examined pages **252/4**, step pages **198/58**, and an isolated
  entry-budget case of six **40-row** pages plus **16** rows. Every callback
  asserts exact accumulated counters before charging its declared work.
- `only_non_fitting_singletons_refuse_before_callbacks`: each cumulative
  ceiling refuses an oversized single row before invoking any callback;
  matching empty-table cases succeed without callbacks.

The real PostgreSQL test
`contribution_pages_admit_all_cumulative_budgets_before_callbacks` independently
tightens examined, steps and index entries. It admits **2, 3 and 2** rows,
respectively; admission examinations equal the delivered page length, steps
and entries remain zero before callbacks, and every simulated callback fits.
The two existing PostgreSQL upgrade tests also pass with real stored rows and
stable generations, including the previous large-payload regressions.

Five deliberate mutations were detected, then restored in `finally` blocks:

| Mutation | Failure |
| --- | --- |
| Remove `page_fits`' admission examination charge | Three callback tests fail; heap-retry counts become `[1, 1, 1, 1, 1]`. |
| Omit admission from the page's examination budget | The 63-view upgrade again refuses at examination **16,385**. |
| Omit the step limit | The filtered 63-view upgrade refuses at **1,000,080** steps, site `adopt receipts.$contribution:c32`. |
| Restore the entire meter after a rejected heap attempt | The retry-count regression detects erased work. |
| Reduce the serialized-page reservation coefficient from three to one | The callback heap assertion rejects the weakened **41,296-byte** ledger; it requires Rust-owned images and both native payload copies. |

The older allocation measurements remain unchanged: one 1,000,000-byte body
peaks at **3,003,026** additional live Rust bytes; five 1,280 KiB rows at
**3,935,639**; 600 × 65,536-byte rows at **2,893,625**; late 2 MiB singleton
refusal at **4,591,031**. The independent probe excludes native SQLite memory;
the page reservation still includes its native-payload allowance.

## Forms, deviations and remaining limits

No authoring form or refusal code changes. Existing programs still compile
and run, including `expire at .expiresAt` on receipts together with
`view unreadCounts: count receipts where .state < 2 and .visible by .chat, .principal`.
The new fixture uses the existing count spelling 63 times, rather than adding
an author-visible page bound.

The engineering choice is a schema-derived, per-row budget shared by both
adapters, with actual execution charges left in place. PostgreSQL gains one
explicit callback-decode examination per source/index walk to match the
specified accounting. Index entries are included because the audit found they
are also charged on this path. No runtime ceiling, query admission, wire shape
or authorization/disclosure policy changes.

The supervisor's device stop remains accepted: a 10,000-source local aggregate
can exceed 8,192 examinations, returns unavailable, and uses the existing
server fallback. No physical-total/private-next-expiry delivery. Reproductions
remain `scale_memory` and `scale_sqlite`. PostgreSQL's separate query limitation
for a wide declared payload bound is unchanged: declare
`payload: text <=2097152`, seed one live 1,000,000-byte receipt, adopt the old
contribution index, then query `counts[viewer]`. Adoption succeeds; that query
can be unavailable at the evaluation adapter's conservative heap bound
(`HeapBytes actual 268466405`, site `programs.count.0`). Details remain in
`reports/20260925-lane-q-round2.md`. Value-order indexes, maintained columns and
rule value comparisons over expiring sources remain refused. No version bump,
push or publication; target artifacts remain on the shared disk.

## Reviews, failures and final qualification

The shared baseline tail was checked before attributing failures. The initial
63-view failure and deliberate negative tests are ours, expected and fixed;
none is classified as baseline or environmental.

The first complete run ended **`== 1 failure(s) in 305 s`**, exit 1. All Rust
executions passed. The sole failing client test was `native: maximum pending
ids (256), cursor batches and every terminal acknowledgement`, timing out at
`transport-http.test.mjs:175` after waiting 30 seconds for terminal receipts.
Its fixture has no maintained views or expiry. No client code, test assertion
or timeout changed. The same case passed in round 2, and all three native
boundary cases (232, 233, 256) passed twice in isolation here. Classification:
**environmental/intermittent, inferred; root cause unproven**, not a baseline
failure claim. Reproduction:

```sh
node --test --test-name-pattern='native: maximum pending ids' packages/snapback4/test/transport-http.test.mjs
```

Grok's file contained progress text at the first suite's start. The complete
READY review arrived afterward and was read before the final suite. Its
additional test-strength observation was addressed and mutation-tested before
that rerun.

The second complete run ended **`== 1 failure(s) in 390 s`**, exit 1. The
transport case passed. Two client tests failed at their five-second server
startup waits, before reaching their tested behavior:

- `logout online deletes the bearer while network work is held`,
  `app.test.mjs:222`, reported `timed out: server` from
  `helpers/app-server.mjs:19`.
- `navigation model: reopen before slow first sync (missing store)`,
  `navigation-model.test.mjs:456`, reported `dev readiness timed out` from
  `witness/lib.mjs:84`.

Both passed unchanged in isolation (107 ms and 1,542 ms). Classification:
**environmental/intermittent, inferred; root cause unproven**, not a baseline
failure claim. Reproduction:

```sh
node --test --test-concurrency=1 --test-name-pattern='logout online deletes the bearer while network work is held|navigation model: reopen before slow first sync.*missing store' packages/snapback4/test/app.test.mjs packages/snapback4/test/navigation-model.test.mjs
```

The final qualification uses the suite's existing
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` mode to reduce shared-host contention.
This runs every client test file, preserving assertions, timeouts and existing
explicit skips. No source change was made for any of the three timeout cases.

Final command, run from `snapback4/`, exit **0**:

```sh
CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=8 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 scripts/test.sh
```

Exact summary: **`== 0 failure(s) in 1196 s`**.

- All **883 Rust executions across 175 binaries** and separate workspace
  doctests pass. All five SQLite adoption tests and four walker tests pass.
- The single client process includes the files otherwise run in separate
  shards: **1,513 tests, 1,503 pass, zero failures, ten existing explicit skips**.
  All three earlier timeout cases pass: transport 256 in 4,223 ms, logout in
  57 ms, and missing-store navigation in 1,109 ms.
- All three explicitly enabled real-PostgreSQL tests pass. The private
  socket-only PostgreSQL server was stopped afterward.
- Wasm remains **1,768,024 raw / 492,568 gzip bytes**, within the unchanged
  **493,000-byte** budget. Build, docs budget, release guard, package and app
  typechecks, app check and fixture-wrapper tests all pass.
- Ref-check: **507 LLP documents, 9,276 references, 25,863 files; zero errors
  and zero unchecked references**. `git diff --check` is clean.

No baseline failure is claimed or waived. The original review reproduction and
five deliberate mutation failures are ours and detected as expected. The three
intermittent client failures above are the only unexpected failures in this
round's complete-suite attempts; their environmental attribution remains an
inference, with unchanged source passing both isolation and final qualification.

Evidence under `~/sb4-intent/`:

- `lane-q-r3-test-complete.log`: final zero-failure suite.
- `lane-q-r3-test-transport-timeout.log` and
  `lane-q-r3-test-readiness-timeouts.log`: the two earlier complete runs.
- `lane-q-r3-transport-recheck.log`, `lane-q-r3-transport-recheck2.log`, and
  `lane-q-r3-readiness-recheck.log`: unchanged-source isolated passes.
- `lane-q-r3-walker-tests.log`, `lane-q-r3-postgres-tests.log`,
  `lane-q-r3-ref-check.log`, and `lane-q-r3-mutation-*.log`: targeted and
  negative-test evidence.
