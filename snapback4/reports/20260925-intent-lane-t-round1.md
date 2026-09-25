# Lane T round 1 — blind review fixes

Date: 2026-09-25. Branch: `sb4-intent/t-read-through`.
Reviewed base: `ea65b80a2`. Design: LLP 3000.014 revision 8, increments 1 and 3.
Inputs: `~/sb4-intent/reviews/t-r0.astra.md` and `t-r0.grok.md`.

## Findings and corrections

| Finding | Correction | Regression witness |
| --- | --- | --- |
| Astra High: aggregate rule evaluated with null `.value` | Hoist authorization only when the supplied key determines every deciding input. Otherwise evaluate the actual live aggregate, including an authorized logical zero; denied scalars remain null. The zero image and key copies reserve heap before allocation. | `aggregate_actual_row`: `.value != 1` and `.value = 2`, owner and other principal, counts one/two, stale stored totals after expiry, and authorized/denied zero. |
| Astra High: expiry-default changes omitted from capture identity | Include the expiry field's name, type and default interpretation in the identity. Parent identities flow to descendants in dependency order. | `expiry_default`: start without expiry; adopt default 300 at time 100; adopt default 150 at time 100; parent, middle and grandchild are visible at 149 and absent at 150/200. |
| Grok High: reuse reveals physical child occupancy | Evaluate the expired predecessor's read rule without expiry before scanning children. Hidden predecessors refuse immediately. Reserve the complete child probe set before any seek, visit every table, and restore the probe charge on collision before returning the ordinary live-collision constraint. Failed reservations retain their bound refusal. | `reuse_refusal`: live collision versus first/second child table occupied, with different row-size ceilings; compares complete refusals and every meter field for reader/non-reader. Examined and heap ceilings also prove hidden callers do not probe, and readable callers pay the whole reservation before seeking. |
| Astra Medium: aggregate `exists` treats denial as presence | Aggregate existence recognizes the private null-value denial result. Scalar reads keep unauthorized null distinct from authorized zero. | `aggregate_existence`: absent, unreadable, authorized-empty, occupied and expired parents. |
| Grok Medium: delete names an occupied expired child table | One fixed `E_PARENT_HAS_CHILDREN` message for every child table and either live or expired children. | `delete_refusal`: first/second table occupied, expired/live child; complete refusal and meter equality. |
| Low: cursor never followed | Follow four pages with tied `.body` values and assert exactly `c00` through `c24`, once each. | Strengthened `cursors_and_dependencies_contain_no_captured_audience`. |
| Low: no `exists`-rule meter comparison | Compare missing and unreadable parent worlds with a real membership probe in the parent rule. | `probe_meter_equivalence`: pinned page, child insert and keyed count; the absent world still reserves a nonzero probe charge. |

The six shared review scenarios run over SQLite, native memory and real
PostgreSQL. The strengthened cursor continuation witness runs on SQLite.
The original seven PostgreSQL inheritance tests remain in qualification.

## Negative controls

With the new regressions and **all production fixes absent**, five tests failed
on the reviewed code, each at its corresponding finding:

- `aggregate_actual_row`: returned `1` instead of unauthorized null.
- `expiry_default`: the middle row remained visible at time 150.
- `reuse_refusal`: hidden live/expired collisions had different meters.
- `aggregate_existence`: an absent parent yielded true.
- `delete_refusal`: messages differed by live/expired child occupancy.

The `exists`-probe meter test already passed the correct reservation code. A
deliberate mutation moving that charge until after finding the parent made it
fail: absent used zero rule probes; unreadable used one. A second deliberate
mutation ignoring `after` only for parent-pinned scans made the cursor test fail
by repeating `c00`–`c06`. Both temporary mutations were restored before final
qualification. Their tests pass on the final code.

Evidence: `~/sb4-intent/lane-t-r1-before.log`,
`lane-t-r1-mutant-probe.log`, `lane-t-r1-mutant-cursor.log`.

## Implementation decision and scope

The author's stricter deletion decision is recorded beside the design in
LLP 3000.014 §11: any physical child blocks parent removal, including an expired
unswept child. At time 200, a non-expiring parent with a child deadline of 150
refuses deletion until sweeping. The same section supersedes §6's instruction
to identify an occupied child table. This closes the deletion decision left
open in the first report.

No new syntax, sync support, device capture/prediction support or adoption
mapping API was added. This round changes only the reviewed server/aggregate
paths, associated tests and the required explanatory records. The original
round's deferred work remains deferred. There are no new open review findings.

## Qualification

Final `scripts/test.sh`, exit 0:

```text
== 0 failure(s) in 213 s
```

Command from `snapback4/`, with the prescribed toolchain on `PATH`:

```sh
TMPDIR=/dev/shm/sb4-intent-lane-t-tests CARGO_BUILD_JOBS=8 RUST_TEST_THREADS=4 SNAPBACK4_RUST_TEST_PROCESSES=8 scripts/test.sh
```

There are no waived failures. All assertions, timeouts and sequence counts
remain intact. The final run uses eight Rust target workers on the 96-core
host; only one complete suite ran at a time. The first run used four workers.
Rust: 2,992 passed, zero failed, 16 ignored. Clients: 1,591 tests, 1,581 passed,
zero failures/cancellations and ten skips. Fixture wrappers: 9/9. Both session
models completed 5,000 sequences. The reference audit passed: 508 LLP documents,
9,281 references, zero errors and zero unchecked. All changed Rust files remain
within 1,500 lines.

Focused qualification: 29 read-through language/server tests and 80 guide tests
passed. PostgreSQL: 13 inheritance/review tests passed against the lane's
isolated PostgreSQL 16 cluster. The optional unrelated PostgreSQL conformance
suite was not rerun; its two baseline failures remain documented in the initial
report and are not a waiver for this round's mandatory suite.

Fresh same-toolchain wasm measurements (Rust 1.97.0, wasm-bindgen 0.2.127,
without wasm-opt):

| Tree | Raw | Gzip |
| --- | ---: | ---: |
| Reviewed `ea65b80a2` | 1,790,122 | 499,539 |
| Round-1 fixes | 1,793,057 | 500,855 |
| Delta | +2,935 | +1,316 |

The size ratchet rises from 500,000 to 501,000 bytes, leaving 145 bytes. This is
a whole-artifact measurement of shared aggregate authorization/existence and
collision/probe paths, not independently measured component costs. The compiler
expiry-identity change is outside wasm. No runtime meter ceiling changed.

The first direct wasm build exceeded the old size limit by 855 bytes; the
documented ratchet resolves that check. Initial test-harness compile/syntax
mistakes were corrected before the five behavioral negative controls. One suite
invocation from the repository root exited 127 before running any checks; it
was immediately rerun from `snapback4/`. Deliberate failing regression controls
are listed above; none is counted as a passing qualification.

The first complete run was `== 1 failure(s) in 412 s` (the `cargo test`
category). Its guide check still pinned the obsolete phrase
"deleting the named live children" in
`definitions::w11_every_registered_code_quotes_its_definition`. This failure
was ours. The two expectation tables now require deleting live children,
sweeping expired children, and a message that identifies no occupied table.
All 80 guide tests pass with the changed behavior; no assertion was removed.

Logs: `~/sb4-intent/lane-t-r1-{qualified,pg-final,test,test-final,guide-cursor-final,ref-check,wasm,wasm-control}.log`.

## File-by-file changes

Paths are relative to the repository root.

| File | Change |
| --- | --- |
| `snapback4/crates/snapback4-core/src/engine/read.rs` | Restricts key-only authorization; checks live aggregate values and logical zero; preserves denial and bounds zero-image allocation. |
| `snapback4/crates/snapback4-core/src/engine/runner.rs` | Makes denied/absent aggregate existence false. |
| `snapback4/crates/snapback4-core/src/engine/write.rs` | Checks expired-image read authority before child probes; normalizes occupied reuse to live collision. |
| `snapback4/crates/snapback4-core/src/engine/through.rs` | Prepays all physical-child probes, removes early exit, and uses one deletion refusal message. |
| `snapback4/crates/snapback4-lang/src/bind/schema.rs` | Includes complete expiry-column interpretation in capture dependency identity. |
| `snapback4/crates/snapback4-lang/src/guide/rules.md` | Updates the parent-deletion explanation for physical children and non-disclosing messages. |
| `snapback4/crates/snapback4-lang/tests/guide/definitions.rs` | Updates the defining-fact pin to the approved physical-child deletion rule. |
| `snapback4/crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pins sweeping and the refusal's disclosure boundary. |
| `snapback4/crates/snapback4-lang/tests/read_through/review_cases.rs` | Six shared review scenarios, with fixtures, full outcomes and meter comparisons. |
| `snapback4/crates/snapback4-lang/tests/read_through_review.rs` | SQLite and native-memory adapters and six test entries. |
| `snapback4/crates/snapback4-lang/tests/read_through_transactions.rs` | Strengthens cursor continuation to exhaustion with tied values. |
| `snapback4/experiments/postgres/tests/read_through_review.rs` | Runs all six shared review scenarios on PostgreSQL. |
| `llp/3000.014-a-child-reads-through-its-parent.rfc.md` | Records the author's implementation decision in §11 and updates revision metadata. |
| `snapback4/metrics/wasm-budget.json` | Records the measured size ratchet and its attribution limits. |
| `snapback4/JOURNAL.md` | Appends this round's implementation and qualification record. |
| `snapback4/reports/20260925-intent-lane-t-round1.md` | Review dispositions, negative controls, measurements and this file map. |
