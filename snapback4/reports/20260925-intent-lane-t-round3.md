# Lane T: round-3 aggregate authorization restriction, 2026-09-25

Addresses `t-r2.astra.md` and `t-r2.grok.md`, following `5cba90e42` on
`sb4-intent/t-read-through`. The author explicitly replaced the round-2
cap-based admission with a restriction on the entire expiring-source class.
Implementation commit: `25980b7fc`.

## Behavior

`E_MAINTAIN_READ_EXPIRE` refuses an aggregate read rule that uses `.value` or
another field not determined by the group key when the source expires, either
by its own declaration or an inherited effective deadline. A source cap and
`online only` do not make this form admissible. Compiler and raw-schema
validation enforce the restriction; point and scan execution also guard it.
The diagnostic's literal `read <- deny` rewrite compiles; its comment directs
the author to a group-key rule or the inherited rule. The guide also describes
`online only` with an explicit key rule.

Examples tested:

- Expiring `view totals: count children by .parent` with
  `read <- .value = 2`: refused, with and without `cap 4 by parent`.
- The same view with `read <- .parent = .parent`: `totals[p]` returns the live
  authorized count; `totals where .parent = p first 10` refuses with
  `E_READ_THROUGH_SCAN` for this read-through parent grouping.
- `[totals[p], totals[p]]`: completes under the default 16 MiB ceiling with
  `body: text <=100000`, for hits, misses, expired physical groups and denials.
- A non-expiring source retains `.value = 2` and `.value != 1` authorization
  over its stored total; read-through groups preserve authorized zero versus
  unauthorized null, and ordinary groups preserve their existing zero result.

Pre-authorization recounting, its cap proof, and prepaid recount counters were
removed. Point reads retain a uniform schema/key-sized scratch reservation and
one point charge before occupancy discovery. Recounts occur only after key
admission, charge every examined contribution and evaluation step, and use the
ordinary runtime ceilings. Temporary scratch is released on completion or
unwind; returned images remain charged. Heap peak, work and cuts are preserved.
Denial still restores dependency tables and the next expiry. Synced retained
rows keep the existing trust policy. No cursor or store format changes.

## File-by-file changes

Paths below are relative to `snapback4/`, except the LLP.

| File | Change |
|---|---|
| `crates/snapback4-core/src/maintain.rs` | Replaces the cap proof with group-field authorization validation and parent-group classification. The deterministic aggregate id is group-determined. |
| `crates/snapback4-core/src/schema.rs` | Rejects non-key authorization over every expiring source, including raw schemas. |
| `crates/snapback4-core/src/engine/live_aggregate.rs` | Removes pre-authorization/prepaid recounting; keeps reusable point scratch and the ordinary metered live recount with a debug assertion. |
| `crates/snapback4-core/src/engine/read.rs` | Guards invalid rules, scopes scratch ownership, authorizes expiring reads before recounting, retains non-expiring stored-value authorization, and refuses parent-group scans even with explicit key rules. |
| `crates/snapback4-lang/src/bind/schema.rs` | Emits the located new refusal and compiling rewrite. |
| `crates/snapback4-lang/src/bind/program.rs` | Refuses parent-group pages with explicit as well as inherited rules. |
| `crates/snapback4-lang/src/diag.rs` | Routes the new refusal to the maintains card. |
| `crates/snapback4-lang/src/guide/codes.rs` | Replaces the superseded `E_MAINTAIN_READ_BOUND` code with `E_MAINTAIN_READ_EXPIRE`. |
| `crates/snapback4-lang/src/guide/maintains.md` | States the restriction, valid repairs, and non-expiring exception. |
| `crates/snapback4-lang/tests/guide/definitions.rs` | Pins the new definition. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pins the recovery and rejects cap/online-only exceptions. |
| `crates/snapback4-lang/tests/read_through/review_cases.rs` | Moves value-rule runtime cases to non-expiring sources; retains denial/meter comparisons with key rules; adds sequential-read and multi-batch witnesses. |
| `crates/snapback4-lang/tests/read_through_review.rs` | Tests direct/inherited expiry refusal, compiling repairs, raw schema admission, both reviewers' programs and explicit parent-group scan refusal; registers shared adapter cases. |
| `experiments/postgres/tests/read_through_review.rs` | Runs the same sequential and multi-batch cases on PostgreSQL. |
| `../llp/3000.014-a-child-reads-through-its-parent.rfc.md` | Adds the requested implementation-decision sentence in §5 and marks the superseded round-2 cap exception in §11. |
| `JOURNAL.md` | Appends this round's outcome, measurements and non-claims. |
| `reports/20260925-intent-lane-t-round3.md` | This report. |

## Tests and negative controls

- `expiring_aggregate_authorization_is_key_determined`: direct expiry and
  inherited deadlines, caps present/absent, value equality/inequality and even
  `.value = .value`, and `online only`; every refusal's rewrite compiles.
  A raw schema with a value rule is rejected too.
- `stored_total_page_authorization_is_refused`: Grok's two-child program,
  one contribution due at 150, cannot compile its value-dependent page.
- `signed_sum_overflow_before_authorization_is_refused`: Astra's capped
  `MAX_I53, -MAX_I53, MAX_I53` program with the negative contribution expiring
  is refused before execution; its key-rule rewrite compiles.
- `explicit_parent_key_aggregate_scans_are_refused`: explicit group-key
  authorization cannot bypass the parent-group page prohibition.
- `aggregate_sequential_reads`: two wide-row-schema reads fit at default
  ceilings; hits, misses, expired groups, denials and a group-determined id
  rule are exercised; retained results/work remain charged and tight heap
  failures remain unavailable/capped rather than becoming authoritative nulls.
- `aggregate_multi_batch`: counts 65 contributions, then 32 live contributions
  after 33 expire; traverses more than one batch and asserts metered work.
- `aggregate_actual_row`: preserves value-dependent authorization for both
  ordinary and read-through non-expiring sources, including the logical zero.
- Existing denial, existence, lifetime, page exhaustion, issue tracker,
  four-level chain and Clique tests remain passing. Prior value-dependent
  expiring fixtures were deliberately replaced because the user now refuses
  those declarations.

Against the round-2 production code, six updated regressions fail. A separate
mutation retaining temporary scratch fails the sequential test with an
unavailable reply at 25,689,277 heap bytes. A mutation stopping the live recount
after its first batch fails the 65-row witness. All mutations were restored.

Targeted qualification: 38 read-through tests and 80 guide tests passed.
After the compatibility correction, all 125 affected corpus, device authority,
derived-maintain and review tests passed.
PostgreSQL: 17 tests passed, with ignored tests enabled on the lane's isolated
cluster. Ref-check: 508 LLP documents, 9,284 references, zero errors and zero
unchecked references. `git diff --check` passed.

## Measurement, deviations and full suite

Fresh same-toolchain round-2 control (`5cba90e42`): 1,797,060 raw / 502,035
gzip bytes. Final artifact: 1,795,777 raw / 501,638 gzip bytes, a delta of
−1,283 raw / −397 gzip bytes. The 503,000-byte artifact budget is unchanged
(1,362 bytes headroom). Rust 1.97.0 and wasm-bindgen 0.2.127; whole-artifact
comparison, not component attribution. Runtime ceilings are unchanged.

The schema, diagnostic and fixture changes intentionally supersede the round-2
cap exception, as requested. The old bound diagnostic is retired. A generated
aggregate id is admitted because the group key determines it. Parent-ref groups
remain point-only even with an explicit rule; ordinary aggregate pages with
key-decided rules keep their existing execution behavior. Non-expiring read-through groups retain actual-row authorization;
ordinary groups retain their prior missing/denied scalar-zero and raw-null
behavior.
No requested fix was deferred, and no review reproduction remains open.
No sync/device feature, broader guide rewrite, baseline repair, runtime ceiling
increase, push or publication was added.

Final full `scripts/test.sh`: **`== 0 failure(s) in 258 s`**, exit 0.
Command: `TMPDIR=/dev/shm/sb4-intent-lane-t-tests CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 scripts/test.sh`.
Rust: 3,001 passed, zero failed, 16 ignored. Clients: 1,557 total, 1,547
passed, zero failed, ten skipped. The isolated PostgreSQL cluster was stopped
after its 17 passing adapter tests.

The pre-fix and mutation failures above were intentional negative controls.
The first full run returned `== 1 failure(s) in 272 s` (the `cargo test`
step). Five failing tests across three targets were ours, introduced by
applying synthetic key admission to ordinary aggregates:

- Core `corpus`: `maintain-numeric-group-absent` expected numeric zero, received
  null.
- Device `read_authority`: `outcomes::write_forms_memory` and
  `outcomes::write_forms_sqlite` expected raw null, received `{value: null}`.
- Language `derived_maintains`:
  `disclosure::column_audience_rules_survive_calendar_grouping_and_service_grants`
  and `disclosure::private_aggregates_never_reach_nonmembers_online_or_on_a_device`
  expected the ordinary aggregate's scalar zero, received null.

Restricting synthetic key admission to read-through aggregates restored those
existing outcomes. The fixes preserve key authorization before recounting on
expiring sources. All five pass in the final suite. No baseline or environmental
failure was waived or repaired.
Logs are under `~/sb4-intent/`, with prefix `lane-t-r3-`: `before.log`,
`negative-controls-final.log`, `scratch-mutant.log`, `batch-mutant.log`,
`qualified.log`, `compat.log`, `pg-final.log`, `wasm-control.log`,
`ref-check.log`, `test.log`, and `test-final.log`.
