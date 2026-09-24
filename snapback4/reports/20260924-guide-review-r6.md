# Lane F round 6 — cancellation recovery and private unique refusals

Date: 2026-09-24. Branch: `sb4-intent/f-guide`.
Starting commit: `11a4cb35a`.

The later `E_EFFECT_CANCELLED means` paragraph now directs callers to inspect
recorded steps and reconcile each with its stored provider key before creating
replacement intent. Effect-id advice is limited to legacy handlers without
steps that used that key. The new pin selects this paragraph directly, rather
than the earlier paragraph selected by `why`.

## File map

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-lang/src/guide/effects.rs` | Corrected the second cancellation-recovery paragraph. |
| `crates/snapback4-lang/tests/guide/recovery.rs` | Pins the later paragraph's stored-step-key instruction, legacy exception and in-flight limitation. Links to the existing execution witness. |
| `crates/snapback4-lang/tests/guide/rules.rs` | Declares `unique amount else AMOUNT_TAKEN`; executes update and upsert-patch collisions against hidden and readable rows, and compares hidden collisions with ordinary rule denial. |
| `JOURNAL.md` | Appends the dated qualification entry. |
| This report | Records scope, audit and regression evidence. |

No new language form was added. The fixture compiles and executes the existing
forms `unique amount else AMOUNT_TAKEN`,
`update records[id = id] { amount }` and
`upsert records[id = id] { amount }`.
The earlier ordinary-constraint test compiles the same fixture without its
custom refusal, preserving its `E_CONSTRAINT` coverage.

## Regressions and audit

- `recovery::cancellation_definition_reconciles_recorded_step_keys` selects the
  paragraph beginning `E_EFFECT_CANCELLED means`. It fails when that paragraph
  alone is restored to the old advice. The existing
  `cancelled_effect_keeps_distinct_stored_step_keys` test executes the recorded
  key and cancellation behavior behind the advice.
- `rules::declared_unique_refusal_does_not_disclose_hidden_collision` performs
  six writes. For both update forms, a readable target colliding with a hidden
  row returns exactly the ordinary `E_RULE` refusal, without the custom code,
  index, column, value or detail. A readable collision returns `AMOUNT_TAKEN`
  with index/value detail. Every collision leaves the stored rows unchanged.
- Temporarily returning the named constraint before `visible_collision` fails
  the new write test: it observes `AMOUNT_TAKEN` where `E_RULE` is required.
  Both negative controls failed at their intended assertions. All temporary
  source changes were restored byte-for-byte before final qualification.
- Searched every card for `meta.id`, reconciliation, provider keys and
  idempotency-key advice. The remaining `meta.id` prose in actions/effects is
  explicitly legacy-scoped; the low-level worker example is not reconciliation
  advice. No other unqualified effect-id reconciliation instruction remains.
- The initial positive-control assertion expected an untyped value in the
  detail. Corrected that test-authoring failure to the actual `{"Int":42}`
  representation. No engine defect or production engine edit was required.

## Qualification

Frozen Bun install passed. Final restored-source guide tests: **79 passed,
0 failed**. CLI check/why tests: **69 passed, 0 failed**.

One full `scripts/test.sh` run: **`== 0 failure(s) in 397 s`**, exit 0.
No introduced, baseline or environmental suite failure. The complete log has
no failure markers. Client tests: **1,088 passed, 10 skipped, 0 failed**.
WASM remains 1,744,842 B raw / 484,967 B gzip under the unchanged 486,000 B
budget. `git diff --check` passed.

The three published Quarry blocks in the effects card are byte-identical to
the starting commit. README remains 292/300 lines; its budget is unchanged.
Changed Rust sources are at most 300 lines. No Bob `unrepost` test was added.

No scope deviation or new open problem. No compiler or engine behavior,
authorization, disclosure, durability, meter or package-version change.
The inherited full-history search `N_NO_HORIZON` test exception is unchanged;
its reproduction remains in `20260924-guide-review-r5.md`. Nothing was pushed
or published. Logs: `~/sb4-intent/lane-f-r6-*.log`.
