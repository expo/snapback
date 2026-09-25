# Lane Q — review round 1

2026-09-25. Branch `sb4-intent/q-expiring-counts`; reviewed starting point
`d266f5baf`. Corrections: `811dbb1a5` (adoption and accepted device contract),
`9bb1a3261` (differential write assertions), `2707b0093` (PostgreSQL adoption,
physical witness bounds, group isolation and pagination).

## Review disposition

Astra's two Medium findings and its Low test finding are fixed. Both Medium
reproductions were added before changing implementation and failed on the
reviewed code. The supervisor accepted the device stop: devices preserve the
existing live recomputation and return unavailable when coverage or the meter
cannot establish the answer; the client uses the server fallback. No physical
total or private next-expiry certificate is delivered.

Grok's completed review was read before the final suite. Its High PostgreSQL
adoption finding and Medium physical-witness-work finding are fixed. Its Low
cap finding duplicates Astra's first finding and is covered by the same fix.
Its additional group/pagination test gaps are covered by a new regression.

## File map

| File, relative to `snapback4/` unless noted | Change |
| --- | --- |
| `crates/snapback4-core/src/store/activation.rs` | Require `is_plain()` for a cap-validation index. Share the fetched-page meter with contribution evaluation. Cap and uniqueness validation stream only encoded keys, eliminating a second 500-row source-image buffer. |
| `crates/snapback4-core/src/store/activation_walk.rs` | New walker: preflight stored byte lengths, reserve the complete page before fetching it, shrink pages to leave decoding headroom, charge typed decode and callback scratch while the buffer remains resident, and release after consumption. |
| `crates/snapback4-core/src/store.rs` | Register the walker module. |
| `crates/snapback4-core/tests/expiring_adoption.rs` | Valid legacy expiry-cap upgrade, independent Rust allocation measurement for 600 large rows, and late heap-refusal rollback. |
| `crates/snapback4-device/tests/expiring_counts.rs` | Require valid writes, verify source transitions, and cover distinct group/principal totals plus two-page enumeration. |
| `crates/snapback4-core/src/engine/postgres/contribution_upgrade.rs` | Preflight and reserve adaptive driver-owned pages, decode one source row at a time, release its scratch after contribution rebuilding, retain atomic schema/generation publication and key limits. |
| `crates/snapback4-core/src/engine/postgres/tests/expiring_counts.rs` | Explicitly run real PostgreSQL legacy adoption with 96 × 4 KiB and 600 × 64 KiB payloads, mixed expiry states, exact live/physical counts and stable reopen generation. |
| `crates/snapback4-core/src/engine/read.rs` | Existence probes recognize the expiry-ordered internal index and seek strictly past the pinned instant, requesting one witness; preserve legacy fallback and current device coverage checks. |
| `crates/snapback4-device/tests/expiring_counts_probe.rs` | Count physical source rows fetched by server reads and device predictions, including absence, live/null expiry, unselected rows and a different principal's group. |
| `crates/snapback4-device/tests/readauth/round2.rs` | Update deliberately changed aggregate-witness budget expectations; retain ordinary-expiry cuts and the heap-refusal assertions. |
| `crates/snapback4-lang/src/guide/maintains.md` | Explicitly document unavailable local reads using the server fallback and the absence of physical-total/certificate delivery. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | Record the accepted stop and the reviewed adoption allocation/validation contract in §20.9.3. |
| `JOURNAL.md` | Append the dated review-resolution and verification entry. |
| `reports/20260925-lane-q-round1.md` | This report. |

## Reproductions and tests

`cargo test -p snapback4-core --test expiring_adoption -- --nocapture`
passes all three tests:

- `legacy_expiry_cap_uses_a_plain_index`: `cap 1 by expiresAt`,
  `view counts: count receipts by .principal`, and Alice's receipts expiring
  at 1000 and 2000. Legacy contribution keys upgrade successfully, both rows
  remain, and physical occupancy is one for each expiry. Before the fix,
  activation chose `$contribution:counts` and refused with `E_CONSTRAINT`.
- `large_legacy_pages_stay_inside_the_job_heap`: 600 legacy receipts with
  65,536-byte payloads adopt successfully. A separate allocator probe measures
  additional live Rust bytes around the complete adoption: **33,225,445 before;
  2,893,625 after**, against the unchanged **16,777,216-byte** job heap. Native
  SQLite allocations are excluded from this independent Rust probe; the page
  ledger also reserves its native payload copies using the existing scan
  accounting convention.
- `a_row_that_cannot_fit_refuses_after_prior_pages_without_publishing`:
  after 300 ordinary large receipts, a valid 2 MiB final payload exceeds the
  decoder allowance. Adoption refuses with `E_BOUND` before decoding it.
  Peak Rust allocation remains **2,893,625**. A digest of all rows, indexes,
  cap occupancy, catalog entries and metadata is identical before and after.

`cargo test -p snapback4-device --test expiring_counts --test expiring_counts_upgrade -- --nocapture`
passes 14 tests after the added group/pagination regression; the existing
wall-clock sweep measurement remains explicitly
ignored in the normal suite (it was measured in the original lane work).
The differential test still makes 4,320 live-value comparisons. It now rejects
any refusal of a valid write and confirms the resulting row before comparing
aggregates. Every seed observes all nine transition classes. Totals across
four seeds: 431 inserts, 48 deletes, 63 updates to state 1, 9 filter-on changes,
65 filter-off changes, 16 expiry-to-null changes, 11 earlier expiries, 109 later
or null-to-instant expiries, and 68 computed-day moves. Only a target already
expired before the write may refuse, and its physical image must remain equal.

The real PostgreSQL target passes both tests (explicit `--ignored`, private Unix
socket; the default suite does not exercise a database). The new payload test
first reproduced `E_BOUND` at 96 rows × 4,096 bytes: 34,535,008 charged bytes
against the 16,777,216-byte heap. Both that case and 600 rows × 65,536 bytes now
adopt, read exact live values with expired/null rows, retain physical totals,
and reopen at generation 2 without retrying adoption.

`expiring_counts_probe` passes both memory and SQLite tests. Its independently
counted store boundary first reproduced 9,000 physical row fetches for an
all-expired group despite constant observable meter values. It now fetches
zero source rows for absence or one for presence, with at most one source seek,
on both stores and both server reads/device predictions. Filtered-out rows and
Bob's live group cannot witness Alice's group. Both finite and null live expiry
are covered. Current device authority/coverage checks remain in force.

The existing `readauth` round-2 target passes 20/20. Its aggregate witness now
fits two physical examinations (target plus source) past 9,000 expired rows;
ordinary non-contribution witnesses retain their old metered cuts. The small
and oversized witness payload assertions remain unchanged in meaning.
The original simulator tests still compare one-probe observable outcomes.

`backlog_subtraction_stays_in_its_group_and_pages_each_live_group_once` adds
50 scalar comparisons across 25 chat keys and two principals, with different
backlogs and totals. Alice's 24 live groups arrive in exactly two pages with
no omissions, repeats, all-expired group, or Bob rows. The complete count target
passes 9 tests; its existing sweep-timing test remains explicitly ignored.

Server scale results remain 2 examined with no backlog and 502 with 500 expired
unswept contributions, at both 100 and 10,000 live rows. At the large scale,
the device remains unavailable at 8,193 examinations, and the server returns
the exact live total. The existing upgrade and disclosure tests still pass.

## Engineering decisions and deviations

No syntax, refusal code, runtime ceiling, wire shape, device fast path or
prediction protocol changed. The accepted device stop is preserved. The
walker reserves at most half the job heap for a multirow fetched page, with
a maximum of 256 rows; the other half leaves headroom for typed decoding and
per-row evaluation. A single larger row must pass both reservations or refuse
atomically. A fresh job meter starts only after consuming the previous page.
All uses of the old activation walker, including cap-count rebuilding and
final row validation, use the metered walker.

PostgreSQL uses an adoption-specific byte preflight under the existing writer
lock. Its maximum 32-row page halves until its driver reservation fits half
the heap, with an eight-times-byte plus per-row metadata allowance. Typed decode
and index scratch are then charged from borrowed serialized text and released
per row; the whole driver page stays reserved. The query scan's existing
256-times-byte reservation is unchanged. This avoids charging every decoded
row for the life of a page while preserving preallocation bounds.

The allocator regression initially remained red after replacing the walker:
`validate_groups` separately fetched 500 full source images. It now streams
only the keys required to validate grouping, retaining one decoded prefix.
This additional correction is necessary to meet the complete-adoption bound.

The final wasm build measures 1,768,024 bytes raw / **492,569 bytes gzip**,
within the unchanged 493,000-byte artifact ratchet (431 bytes headroom).
No artifact ceiling was raised in this review round. The private PostgreSQL
server was stopped after its successful regression run. Source files remain
under 1,500 lines; build artifacts stay on the shared disk.

## Intermediate failures and attribution

- **Ours, expected reproductions:** both new review tests failed on the old
  implementation: incorrect cap-index selection and 33,225,445-byte peak.
- **Ours, during implementation:** the first test draft called a private cap
  helper; changed to the public `Rows::cap_count` interface. The first walker
  draft read SQLite lengths as `usize`, which `FromSql` does not support;
  changed to the existing `i64` length convention before conversion.
- **Ours, incomplete first fix:** the allocation test still measured
  33,226,069 bytes because cap/uniqueness validation retained its old source
  buffer. Streaming keys fixed it; the complete three-test target then passed.
- **Ours, expected Grok reproductions:** `ordinary_payloads_adopt_across_multiple_pages`
  failed with `E_BOUND` on 96 × 4 KiB; both `probe_seeks_live_witness_*` tests
  observed 9,000 fetched expired source rows. All pass after their fixes.
- **Ours, probe fixture drafts:** a private Runner meter assertion did not
  compile; removed it in favor of the independent physical counter and existing
  observable-meter tests. Initial fixture declarations used an ambiguous one-key
  positional probe and a noninvertible sync rule; replaced them with the existing
  group/principal membership form. A raw SQLite fixture attempted device reset
  before sidecar initialization; it now rolls back test rows and needs no reset.
  A local query over an already-delivered row correctly skipped rule reevaluation;
  the test now predicts a newly inserted provisional row to exercise authority.
  Two initial commands filtered the wrong test target and ran zero tests; they
  are not counted as evidence. The correct readauth target subsequently ran 20.
- The first complete round-1 suite, covering Astra's fixes while Grok finished,
  passed: `== 0 failure(s) in 353 s`. Source was held fixed during that run.
- **Environmental/intermittent (classification inferred; root cause unproven):**
  the next full run reported `== 1 failure(s) in 240 s`, client stage only.
  All 883 Rust executions passed. Client failures were
  `a stale online refresh preserves another owner's kept successor`
  (`undefined !== []` at app.test.mjs:306),
  `a stale local refresh preserves another owner's kept successor`
  (condition timeout at app.test.mjs:311), and
  `actions retry a throwing handler and reauthenticate a waiting caller and worker`
  (`fetch failed` / `ECONNRESET` at worker.test.mjs:429).
  The affected fixture schemas have no expiring maintains; these client/session
  paths are unchanged by the round-1 code. All three passed in the preceding
  full suite and twice in isolation afterward with unchanged source (3/3 each,
  zero skips). No assertions, waits or production code were changed for them.
  The complete suite was then rerun; no failure waiver was used.
- The shared baseline log remains `== 1 failure(s) in 276 s`; its older
  capability/word-fixture/census/why failures were not changed or waived here.

## Remaining accepted limitation

The device stop remains in effect. Physical total delivery would distinguish
expired data absent from a fresh live snapshot; the retained device count
recomputation can exhaust its unchanged meter at 10,000 rows. Such a local
count is unavailable and uses the server fallback, whose backlog-bounded
answer remains exact when complete. The original counterexamples remain in
`expiring_counts` (`physical_delivery_would_disclose...` and `scale_`).
No additional review finding remains unaddressed. The
[original lane report](20260925-lane-q-expiring-counts.md) records the full
implementation, existing forms and accepted stop reproductions.

## Final verification

Final `scripts/test.sh`, exit 0: **`== 0 failure(s) in 205 s`**.
Environment: `CARGO_BUILD_JOBS=8 SNAPBACK4_RUST_TEST_PROCESSES=8`; normal
parallel client files. Source was unchanged throughout this run. All 883 Rust
executions across 175 test binaries passed, followed by the workspace doctests. The main client
process reported 1,479 tests, 1,469 passes, zero failures and ten existing
explicit skips; the separate shards also passed. The three intermittent cases
from the preceding run all passed. No new skips, removed assertions or failure
waivers. Grok's completed review was checked again before starting this run.

`./ref-check --verbose` passes with zero errors and zero unchecked references;
`git diff --check` passes. The final report and journal are the only changes
after test qualification. No push or publication.

Evidence logs under `~/sb4-intent/`:
`lane-q-r1-adoption.log`, `lane-q-r1-differential.log`, `lane-q-r1-device.log`,
`lane-q-r1-counts-final.log`, `lane-q-r1-probe.log`, `lane-q-r1-witness.log`,
`lane-q-r1-admission.log`, `lane-q-r1-pg.log`,
`lane-q-r1-client-retry.log`, `lane-q-r1-client-retry2.log`,
`lane-q-r1-test.log` (353 s, zero failures),
`lane-q-r1-test-final.log` (240 s, three client cases in one failing stage),
`lane-q-r1-test-complete.log` (**205 s, zero failures**),
`lane-q-r1-ref-check-final.log`.

The intermittent client failure mechanism remains unproven. The isolated
reproduction attempt below passed twice; the failed full-run log above
preserves the original assertions and stack traces:

```sh
node --test --test-name-pattern="a stale .* refresh preserves|actions retry a throwing handler" packages/snapback4/test/app.test.mjs packages/snapback4/test/worker.test.mjs
```

