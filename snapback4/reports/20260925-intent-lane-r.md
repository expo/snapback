# Lane R — column min/max (LLP 3000.013, 0.4.2)

Implemented on `sb4-intent/r-minmax`, based on `e3451183e`. No push,
publication or version bump. The supervisor owns integration and blind review.
The checkout has no configured Git identity, so commits use command-scoped
`Codex <noreply@openai.com>` author/committer settings and the required
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>` trailer. Global Git settings
are unchanged.

## Behavior and decisions

- `min(receipts where .message = m.id, .state)` and the corresponding `max`
  stream authorized domains. Null values are skipped, including an all-null
  domain; empty/all-null returns null. The inferred result preserves the
  column type and adds nullability.
- `min(page, .state)`, `max(page, .state)` and the same calls on lists of rows
  fold the selected rows. Nullable list rows project null and are skipped.
  Binary `min(a, b)` / `max(a, b)` retain their meaning, including collections.
- Domain folds keep sum's admission, authorization, expiry, coverage and
  cut behavior. A cut unwinds the answer; `?? 2` cannot replace it with data.
  Rule checks precede residual predicates and comparisons. Devices require
  complete held domain coverage; incomplete and online-only inputs queue
  mutations without predictions.
- An existing index ordering the column after equality pins supplies a seek.
  Pin permutations and extra tie columns are safe because ties have the same
  scalar value. Ascending min and descending max stop at the first qualifying
  non-null value. Nullable indexes seek past the complete null segment.
  Otherwise the ordinary planner supplies a metered scan. Explicit index
  spellings stay on their chosen access paths. No dedicated extremum index
  is synthesized merely to turn a scan into a seek.
- Expiring maintained totals whose live value differs from their stored index
  value are scanned; declaring an index on that live value retains the existing
  `E_QUARRY_MAINTAIN_EXPIRE` refusal. The binder and cost certificate share the
  runtime's endpoint-order test.
- Inline ordered pages need parentheses: `min((receipts first 20 by .id),
  .state)`. The ambiguous comma gets `E_QUARRY_AMBIGUOUS` with a compiling
  rewrite. Competing collection/ambient focal scopes use the same code and
  explain how to bind the binary operand explicitly. No new refusal code.
- The new internal `Builtin::Extremum { field, max, domain }` distinguishes
  column aggregation from the binary builtins without changing old IR forms.
  The ordinary scan folds count/sum and extrema through one consumer. Each
  retained selected value is heap charged; replacement releases only that
  old value, independently of transient scan rows and other retained work.

## Forms compiled and executed

| Form | Example |
| --- | --- |
| Domain minimum | `min(receipts where .message = m.id, .state) ?? 2` |
| Domain maximum | `max(receipts where .message = m.id, .state)` |
| Page minimum | `min(page, .state)` |
| Page maximum | `max(page, .state)` |
| List minimum | `min([{ state: null }, { state: 1 }], .state)` |
| List maximum | `max([{ state: 1 }, { state: 8 }], .state)` |
| Existing binary calls | `min(4, 2)` and `max(4, 2)` |

## Files

Paths below are relative to `snapback4/`.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/ir.rs` | Column-extremum IR and shared ordered-field eligibility. |
| `crates/snapback4-core/src/engine/extrema.rs` | Streaming fold state, page/list folds, null handling, retained-value meter, completeness and cut handling. |
| `crates/snapback4-core/src/engine/read.rs` | Shared authorized incremental consumer; first qualifying endpoint stop. |
| `crates/snapback4-core/src/engine/runner.rs` | Dispatch the new aggregate while preserving binary min/max and count/sum. |
| `crates/snapback4-core/src/engine/mod.rs` | Register the extrema module. |
| `crates/snapback4-core/src/engine/write_target.rs` | Include the builtin in the existing expression classification. |
| `crates/snapback4-lang/src/bind/program/extrema.rs` | Overload resolution, column typing, domain/page distinction, seek direction/null bounds. |
| `crates/snapback4-lang/src/bind/program/expr.rs` | Route min/max calls, preserve original ambiguous spelling for diagnostics. |
| `crates/snapback4-lang/src/bind/program.rs` | Register the binder module. |
| `crates/snapback4-lang/src/bind/intent_aggregates.rs` | Recognize extremum consumers and choose existing ordered indexes. |
| `crates/snapback4-lang/src/bind/intent.rs` | Reuse endpoint indexes with permuted equality pins and extra tie columns. |
| `crates/snapback4-lang/src/bind/intent_variants.rs` | Lift aggregates into argument-presence alternatives. |
| `crates/snapback4-lang/src/bind/residency/components.rs` | Traverse the new builtin through existing device component analysis. |
| `crates/snapback4-lang/src/guide/language.rs` | Compiled domain/page/list examples, receipt-state helper and null/coverage semantics. |
| `crates/snapback4-lang/src/guide/codes.rs` | Extend existing ambiguity explanation with min/max rewrites. |
| `crates/snapback4-lang/tests/extrema.rs` | Language/runtime regressions listed below. |
| `crates/snapback4-lang/tests/guide.rs` | Run the new guide operation and page/list extrema. The pinned operation list deliberately gains receiptStatus. |
| `crates/snapback4-device/tests/extrema.rs` | Server agreement, complete/horizon/online coverage, prediction and reopen on memory and SQLite. |
| `crates/snapback4/src/scale.rs` | Explain endpoint seek versus whole-domain scan and price endpoint bounds. |
| `crates/snapback4/src/verbs.rs` | Render the aggregate plan in check --cost and why. |
| `crates/snapback4/tests/check_cost_source.rs` | CLI text and JSON cost-plan regression. |
| `crates/snapback4/tests/scale.rs` | Deliberately extend the pinned language-card operation classes: receiptStatus scans and therefore grows. |
| `metrics/wasm-budget.json` | Measured byte ratchet; runtime ceilings are unchanged. |
| `JOURNAL.md` | One appended dated implementation and qualification entry. |
| `reports/20260925-intent-lane-r.md` | This review handoff. |

## Tests and measurements

`crates/snapback4-lang/tests/extrema.rs` contains 16 tests:

1. Empty/all-null domains, null skipping, hidden prefixes, residual predicates,
   explicit scan fallback and bounded page values.
2. List and binary overload compatibility, typed empty lists and optional output.
3. 10,000-row min/max seeks each examine exactly one row; fallback scans cut
   under the unchanged 8,192 examined ceiling and expose no partial scalar.
4. Examined, steps and heap cuts remain unavailable, even under coalescing.
5. Optional-filter presence variants remain streaming and null-safe.
6. The ordered-page comma diagnostic supplies a compiling rewrite.
7. Bare-table aggregates and time/money/text columns preserve values/types.
8. Expired rows cannot win; a filtered seek cut cannot return a partial answer.
9. A 4,096-row text scan fits a 128 KiB heap allowance while returning the
   correct extrema, proving retention does not accumulate one result per row.
10. Permuted equality prefixes and additional tie columns still seek one row
    among 10,000 using the existing declared index.
11. A non-uniform rule filters a hidden divide-by-zero row before the predicate.
12. 10,000 null keys examine zero rows; adding one present value examines one.
13. Competing focal scopes refuse ambiguity; unambiguous binary collection
    member comparisons retain their old behavior.
14. Direct and locally bound non-uniform pages produce the same visible
    extremum and incomplete metadata; a true meter cut makes both unavailable.
15. Expiring maintained totals use current live values, while the existing
    refusal of an index on their changing value is preserved.
16. Binary min/max over cap-bounded reads retain row order and can compare
    an enclosing collection member, instead of entering aggregate planning.

The two device tests run the same scenario on memory and SQLite: the server
and fully held devices agree on min/max; horizon and online-only sources are
unavailable even through `?? 2`; only complete inputs predict a summary write;
coverage and queue behavior survive reopen. Backend serialization round-trips
the new builtin through the real decoder.

The new CLI test proves seek/scan descriptions in `check --cost`, constant
one-row certificates for required-column endpoints and a growing certificate
for the scan. All 80 guide tests pass after adding the operation and runtime
assertions. Existing aggregate safety, optional-filter, intent-order and
streaming/job review tests also pass. All 18 cost-classification tests pass
after the intentional guide-operation pin update. No existing assertion
was weakened.

The first completed full run ended `== 1 failure(s) in 604 s` and found one
lane-owned failure:
`snapback4::scale::language_operation_classes`. Its exhaustive operation map
needed the new language-card `receiptStatus` operation, classified `Grows`
because the example has no state-ordered index. The fix adds that expectation
and explains it; no existing classification or assertion is removed.

A final compatibility regression initially failed (lane-owned):
`binary_calls_over_cap_bounded_reads_keep_their_row_order`. For a capped
table holding `{id: 'a', n: 8}` and `{id: 'b', n: 1}`, binary
`max(t where .n >= 0, t where .n >= 0)` wrongly reordered its first operand
by n. Restricting consumer planning to column selectors and probing binary
read/focal operands preserves the former id order. The test covers both
binary operators, direct reads and enclosing collection members, and passes.

The next full run ended `== 1 failure(s) in 493 s`: all Rust targets and
doctests passed, while the concurrent client stage had 14 intermittent
failures. The same client code and artifact had passed in the preceding run.
Six failures explicitly report transport `ECONNRESET`; the remaining eight
sync-generation assertions observe missing requests/adoption rather than
the expected recovery steps. The complete names are recorded below.

The serial-client control run completed `== 0 failure(s) in 1266 s`:
all Rust checks and 1,512 client tests (1,502 passed, ten existing skips,
zero failures). The final compiler correction separately passed 16 extrema
and 80 guide tests before the final full qualification.

The subsequent 16-CPU concurrent run ended `== 1 failure(s) in 443 s`.
All Rust targets, including the final 16 extrema tests, passed. Its sole
failure was the unchanged `release-activation.test.mjs` test
`stopped full-release restore preserves its recovery point and stays separate
from the original`: line 335 observed `done` instead of `parked`. This is
classified environmental/intermittent scheduling; it passed in the serial
control and its unchanged isolated rerun passed 1/1 in 1.46 seconds. Reproduce
the concurrent attempt with `taskset -c 0-15 scripts/test.sh` on this host;
the isolated control is `node --test --test-name-pattern='stopped full-release restore preserves' packages/snapback4/test/release-activation.test.mjs`.
The underlying timing cause remains unresolved and no deadline/assertion
was relaxed. The final qualification returns to serial client files.

Final `scripts/test.sh`: **`== 0 failure(s) in 1141 s`** (exit 0).
All Rust targets and doctests pass. The serial client stage reports 1,512
tests: 1,502 passed, zero failed, ten existing skips. No failure was waived.
The complete log is `~/sb4-intent/lane-r-test-final.log`; earlier completed
run logs are `lane-r-test-attempt-2.log` through `lane-r-test-attempt-5.log`.
Targeted and isolated controls use `lane-r-*-final.log`,
`lane-r-app-global-isolated.log`, `lane-r-client-transport-isolated.log` and
`lane-r-restore-isolated.log` in the same directory.

The production device artifact is 1,772,147 bytes raw and 493,832 bytes gzip.
The last recorded 0.4.1 artifact in the journal is 1,765,796 / 491,640 bytes,
so the recorded delta is +6,351 raw / +2,192 gzip (not a newly rebuilt control).
Following the command sheet's measured-ratchet policy, the gzip byte budget
moves from 492,000 to 494,000, leaving 168 bytes. This changes the artifact
size ratchet only; examined, steps, heap and write ceilings are unchanged.

The first full-suite attempt was interrupted after shared-disk exhaustion:
Rust compilation and the test log writer reported `ENOSPC`. Its temporary
client log also stopped being written, so it cannot support a complete list
of test verdicts or an exact final summary. This is an environmental aborted
qualification, not a pass or a waived failing test. The retry relocates only
this lane's ignored Cargo cache and temporary data to executable `/dev/shm`
and sets `CARGO_INCREMENTAL=0`, with eight build jobs on the first two
completed runs and sixteen on the later runs. One retry used a 16-CPU affinity
to reduce Node's parallel file count; the final run uses the ordinary CPU
allocation and the script's existing serial-client option. Product
code, optimization, assertions and meter ceilings are unchanged. The ignored `snapback4/target`
symlink points to `/dev/shm/sb4-intent-lane-r-target-20260925`; remove/rebuild
that disposable cache after a host reboot.

## Limits, deviations and reproduction

No change to authorization, disclosure, durability or runtime meter ceilings.
A metered scan may still cut; it intentionally returns unavailable. Existing
sum-style admission/completeness restrictions remain: an unbounded non-uniform
domain is refused unless admitted by its existing cap path, and an admitted
non-uniform domain retains incomplete coverage. Reproduce the latter with
`cargo test -p snapback4-lang --test extrema nonuniform_rule_runs_before_the_residual_predicate`.
This is inherited semantics, not a claim of a new complete-domain proof.

The unchanged-source concurrent client run had these 14 failures. All passed
in the preceding full run. Classification: environmental/intermittent
transport and recovery observations outside the extrema path; the underlying
concurrency cause remains unresolved, and these are not failures recorded in
the supplied older baseline log.

| File under `packages/snapback4/test/` | Exact failed test name | Observed failure |
| --- | --- | --- |
| `app-global.test.mjs` | online: global logout follows another tab's persisted rotation and revokes external siblings | ECONNRESET |
| `app-global.test.mjs` | online: global logout follows another tab's held rotation and revokes external siblings | ECONNRESET |
| `store-reset-reconnect.test.mjs` | R2 item 1: changes with a foreign identity returns before its production wait | ECONNRESET |
| `store-reset.test.mjs` | sync store identity survives a server restart; a live client detects an equal-watermark replacement | ECONNRESET |
| `sync-generation.test.mjs` | process: early generation adoption preserves unsent writes, known and lost acknowledgements | empty request/adoption log |
| `sync-generation.test.mjs` | legacy fallback ignores the current server's bad-cursor, bad-limit and bad-pending-id refusals | ECONNRESET |
| `sync-generation.test.mjs` | wasm: early head 20 and ordinary page decide deferred stream evidence identically | 1 request, expected 2 |
| `sync-generation.test.mjs` | wasm: early head 25 and ordinary page decide deferred stream evidence identically | 1 request, expected 2 |
| `sync-generation.test.mjs` | wasm: missing early watermark preserves deferred stream evidence until a headed retry | 0 adoptions, expected 1 |
| `sync-generation.test.mjs` | wasm: early head 20 and ordinary page decide staged snapshot evidence identically | 1 request, expected 2 |
| `sync-generation.test.mjs` | wasm: early head 25 and ordinary page decide staged snapshot evidence identically | 1 request, expected 2 |
| `sync-generation.test.mjs` | wasm: missing early watermark preserves staged snapshot evidence until a headed retry | 0 adoptions, expected 1 |
| `sync-generation.test.mjs` | process: early head 20 and ordinary page decide deferred stream evidence identically | 1 request, expected 2 |
| `transport-http.test.mjs` | sync request-line boundaries and a deliberate body ceiling | ECONNRESET |

Reproduction attempt: run `scripts/test.sh` with its parallel client mode on
this shared host. Isolated controls use `node --test --test-concurrency=1`
on the named files: 73 passed, zero failed and one existing skip across all
five files (7/7 app-global; 66/67 across the other four files). The complete
serial control and final qualification use
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`. No assertion, deadline or product
behavior is changed.

The public receipts table in the compiled language card explicitly declares
its disclosure policy; private receipt tests instead pin the owner rule.
Only direct `.column` selectors are added, as commissioned. Query execution
still uses the shared interpreter; no SQL lowering or second implementation.

The repository's `llp-orient` symlink is broken on this checkout; orientation
used the required documents and source directly. The provided baseline log
records four older Rust test failures and was inspected before attribution.
No unrelated baseline repair is included. All touched source files remain
below 1,500 lines.
