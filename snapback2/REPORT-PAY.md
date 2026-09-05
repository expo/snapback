# Clique Pay lane report

Date: 2026-09-03

## Outcome

Clique Pay is implemented in the existing Quarry Clique fixture. Its seven new
`pay.*` operations bring the exact fixture inventory from 33 to 40. The fixture
lowers, Rust-certifies, runs through the CLI, and passes its compiled journey.
All acceptance items P1.1-P1.8 have executable coverage.

No engine arithmetic semantics or serialized IR changed. The TypeScript
evaluator stayed at 112/112 cases and the corpus has no diff.

## Platform extensions

- A1: Quarry accepts `share(amount, recipients, recipient)`, requires exact
  arity, an int/decimal/money amount, a bounded recipient collection, and an
  exactly matching recipient item type, then lowers to
  `deterministicShare`. Compiler checks pin typing, lowering, IR, sites, and
  rewrites. The Rust Pay e2e file directly pins the runtime's empty
  (`E_DIV_ZERO`), duplicate (`E_INPUT`), and missing-recipient (`E_INPUT`)
  refusals; the app journey additionally reaches duplicate and empty input.
- A2: Quarry accepts `divmod(a, b)` with an int/decimal/money numerator and int
  divisor. Its object fields preserve the numerator descriptor and member
  access lowers through to IR. Fractional divisors get a sited
  `E_QUARRY_TYPE` rewrite. Runtime zero-divisor behavior is unchanged.
- A3: branded multiplication implements money-times-decimal in either order
  and decimal-times-decimal with the left decimal's scale. It emits
  `divmod(a * b, 10^T).quotient`, producing the existing `Mul` plus `Divmod`
  IR. Money-times-money refuses with the requested currency-squared wording;
  branded `/` and `%` point to the quotient/remainder spelling. Generated
  TypeScript analysis was extended to retain these brands, but round 1
  incorrectly weakened bare branded-product `E_DECIMAL_SCALE`; round 2
  restores it and admits only the generated `divmod(product, 10^scale)` form.
- A4: Quarry target synthesis, TypeScript schema lowering, and Rust schema
  admission now admit int, decimal, or money sum sources and require target
  `value` to equal the source descriptor exactly. New Rust tests cover a valid
  Money sum, Money-to-Int mismatch, signed minor-unit aggregation, same-mutation
  visibility, and zero for an absent group. Compiler tests also pin a Decimal
  sum target.
- A5: compiler checks pin `amount > 0`, `tipRate >= 0`, `0 - amount`, and
  unary `-amount`, including retained nominal types.
- A6: operation arguments render decimal/money as documented `number` fields
  in generated `api.d.ts`; direct column and argument results retain
  `Money`/`Decimal`. Round 1 did not cover computed results; round 2 adds that
  inference and its exhaustive declaration pin. A
  journey compile check accepts `250`, accepts a branded query result back into
  the argument, and rejects a string. Optional operation arguments now include
  wire `null`, and optional write fields accept runtime `null`, because the
  feature's exact Quarry and journey spellings use `note: null`,
  `expense: null`, and `settledAt: null`.
- A7: no runtime change was needed. The CLI e2e proves `amount: 2.5` is refused
  before dispatch with `E_INPUT`, family `input`, and the message `numeric
  arguments must be integers`; the journey pins the corresponding thrown input
  refusal.
- A8: maintained values include earlier writes from the same mutation.
  `sendMoney` therefore returns the post-send balance, and the CLI/journey both
  assert `9750`. The core test independently inserts signed ledger entries and
  reads the maintained result from the writing mutation.

The generated `lib.d.ts` signatures for `deterministicShare` and `divmod` now
retain number subtypes, so the generated code carries Money/Decimal through the
existing lowering target rather than erasing the brand.

## Clique Pay application and acceptance proof

The schema adds `ledger`, `expenses`, `shares`, `balances`, and `convSpend`.
`pay.q` supplies `sendMoney`, `addExpense`, `settleShare`, `myBalance`,
`myLedger`, `convExpenses`, and `myOpenShares`. The seed used by the Rust e2e
contains four personas, the four user rows, one Alice/Bob/Carol group with
members and inbox rows, and $100 deposits for Alice, Bob, and Carol. It does
not seed `balances`: `Runtime::seed` applies maintains from the ledger rows and
the initial 10000/10000/10000/0 reads prove that derivation.

Coverage by acceptance item:

1. Exact Alice/Bob balances, one new ledger row each, signed 250 amounts,
   note, and equal timestamps.
2. Insufficient funds, self-pay, zero, and fractional input refusals; ledger
   row count unchanged.
3. Dinner 1000 at rate 1800 produces tip 180, grand 1180, shares
   394/393/393 in ascending user-id order, payer settled, total 1180.
4. Coffee produces tip 180/grand 1181; cab produces tip zero and shares
   1/1/0; total spend becomes 2363.
5. Bob's settlement changes balances to 9857 and 10143, records a settlement
   time, refuses repetition, and refuses Carol.
6. Outsider, duplicate, empty, and non-member-read cases are all executed with
   their exact refusal code/rule; refused expense attempts leave total spend
   unchanged.
7. Dave reads zero and cannot send one minor unit.
8. `0.12345` in a decimal-4 sink is refused at the `.q` site with
   `E_DECIMAL_SCALE` before runtime.

## Documentation

The normative Quarry guide and grammar now state the exact arithmetic,
rounding, i53 intermediate caveat, argument/result wire posture, typed sum
maintains, and same-mutation maintain visibility. LLP 1001 records the relaxed
maintain contract; LLP 1004 records the app-shaped Quarry additions; LLP 1007's
kept-money ruling points to Clique Pay. LLP 1004/1007 use `<SHA>` because this
lane was explicitly forbidden to commit and the orchestrator owns the landing
commit.

## Verification

- `cargo build`: pass.
- package compiler-worker build: pass.
- compiler typecheck and suite: 269/269 pass.
- evaluator corpus twin: 112/112 pass; no corpus diff.
- focused Rust Clique Pay e2e: 2/2 pass (runtime refusal probe plus full CLI
  and journey test).
- workspace doctests: pass.
- `ref-check --verbose`: pass, 402 LLP docs, 7,311 refs, 0 errors/unchecked.
- `git diff --check`, formatting check, and all touched source line caps: pass.
- full nextest and `scripts/test.sh`: 335/337 pass. The only failures in both
  runs are the brief's known sandbox exception:
  `chat_owner_wire_sse_channels_and_successors` and
  `stop_during_generation_update_is_bounded_and_cannot_recreate_owner_state`
  each report `E_OWNER_STOP_TIMEOUT` because `ps` is denied. The orchestrator
  must rerun those outside the sandbox for the required green blocking receipt.
- The repository-wide Snapback 1 guide/inventory audits remain red on unrelated
  pre-existing state: missing generated demo/Contract artifacts, the generated
  API cold-signature assertion, unregistered `scripts/caps.test.mjs`, and the
  existing diagnostic-registry removal-justification drift. `caps` likewise
  reports 62/59 current LLPs and the unrelated 45,167-line Snapback 1
  `engine.rs` as a new over-baseline file. No generated registry projection was
  retained from this lane because regeneration exposed those unrelated
  removals and produced no Snapback 2 diagnostic-site delta.

## Findings for the orchestrator

### The specified nested expense reads do not certify

The brief's `convExpenses` spelling made a returned nested shares page depend
on a capped-only site whose member read rule was not uniform over the scan
prefix. Rust returned `E_STRUCTURAL_COUNT` with the standard
denormalize-scope-or-maintain rewrite. Adding a `conv` prefix to a new
`byConvExpense` index makes the existing privacy rule uniform without loosening
it.

After that repair, `last 20` expenses times `first 50` shares still exceeded
the fixed certificate ceilings: output estimate 7,593,678 exceeded 1,048,576
and closure estimate 7,831,410 exceeded 4,194,304 (`E_BOUND`). Even `last 2`
estimated 1,490,926 output bytes, so `convExpenses` can return only the newest
one expense under today's row-width accounting. This is an app-visible limit,
not a money implementation issue.

The specified `myOpenShares` nested `.expense` read similarly returned
`E_STRUCTURAL_COUNT`: the outer own-debtor scan is authorized uniformly, but
the nested member-authorized expense shape makes the returned structure depend
on hidden membership. The fixture snapshots the four displayed expense fields
onto each share; it does not loosen any read rule.

### A missing share recipient is unreachable through `addExpense`

The operation calls `share(grand, participants, u)` only while iterating `u`
from `participants`, so the runtime's missing-recipient branch cannot be
reached through the public feature. The Rust `quarry_pay.rs` runtime probe pins
that branch directly. Duplicate participants reach the builtin through the
feature; empty participants intentionally stop earlier at `NO_PARTICIPANTS`.

### Fractional client refusal shape differs from operation refusals

The CLI returns a bare input-family diagnostic envelope before dispatch (no
operation `state`), and the journey client throws that diagnostic rather than
returning a rejected operation result. Both paths are now asserted, but an app
author must handle this input failure differently from a Quarry `require`.

## Deviations from the brief

- `convExpenses` uses `last 1`, not `last 20`, for the `E_BOUND` reason above.
- `shares` adds `byConvExpense` and four immutable-in-practice snapshot fields
  (`expenseDescription`, `expensePayer`, `expenseGrand`, `expenseAt`) so the two
  member-private result shapes certify. `convExpenses` keys shares by
  `(conv, expense)`; `myOpenShares` constructs `expenseRow` from those fields.
- The journey queries each newly created expense before creating the next one,
  because the certified endpoint returns the newest expense only.
- The missing-recipient share refusal is pinned by a direct runtime probe in
  the required Rust e2e file rather than through `addExpense`, where it is
  impossible by construction.
- `scripts/test.sh` is not green inside this sandbox solely because the two
  pre-declared owner-stop tests cannot inspect process liveness. No product
  failure was observed.

There are no other deviations. No privacy rule was loosened, no new diagnostic
code or apparatus was added, no metrics file was touched, and no git state was
changed.

## Round 2

### Review fixes and pins

- R1: `pay.convExpenses` now returns `last 20` expenses with payer profiles,
  while the new `pay.expenseShares` operation returns one expense's first 50
  shares with debtor profiles. The exact Pay/Clique inventory is 41 operations.
  Both compiler inventories lower and Rust-certify it. The Rust e2e and journey
  read all three expenses in one page as cab/coffee/dinner, newest first, with
  `(tip, grand)` values `(0, 2)`, `(180, 1181)`, `(180, 1180)` and total 2363;
  they read dinner/cab shares separately, observe Bob's settlement timestamp,
  refuse Dave's share read as `NOT_MEMBER`, and prove refused expenses leave
  total 2363.
- R2: Quarry, generated-TypeScript analysis, and the runtime decimal helper now
  cap scales at 12, and the guide says 0 through 12. Compiler checks pin
  `decimal 13` and `money USD 13` at their `.q` scale tokens with exact rewrites,
  while `decimal 12`/`money JPY 12` lower and certify a product using the safe
  integer divisor `1000000000000`.
- R3: dinner participants are deliberately ordered Carol/Alice/Bob in both
  acceptance paths, while the sorted result still gives Alice 394. A separate
  Rust runtime probe shares 1181 across descending IDs and pins 394 on the two
  smallest IDs, independent of input order.
- R4: LLP 1001 §9 now states that Decimal/Money sum sources preserve their
  descriptor on target `value` without changing engine arithmetic; the §4
  maintain amendment remains.
- R5: shaped page results remain intentionally untyped and the filed ticket is
  untouched. The guide now says exactly that column reads, maintained reads,
  and computed scalars stay branded while shaped pages are untyped today.
- R6: the base `where` paragraph is restored, including one predicate
  evaluation per fetched row and the `take N` maximum. The guide is 12,283
  bytes, under its 12 KiB build budget.
- R7: `apiExpressionType` now carries local expression facts through unary
  minus, `divmod` objects and their fields, `deterministicShare`, and product
  chains; multiplication selects Money over Decimal and otherwise the left
  brand. The compiler pin checks every requested `b` field plus `rate * amount`
  and `amount * r1 * r2`, requiring named `Money<"USD", 2>` aliases and
  excluding expanded brand intersections.
- R8: lowered-TypeScript analysis again refuses every bare branded × branded
  expression as `E_DECIMAL_SCALE`. Its sole admitted shape is a `divmod`
  numerator product with the exact `10^T` literal; compiler tests pin the bare
  refusal, accepted wrapper, wrong-divisor refusal, and money × money refusal.
  This corrects round 1's inaccurate claim that the refusal had not weakened.
- R9: `#maintain[key]` now hoists `read?.value ?? 0` into a typed statement
  temporary before ordinary expression lowering. One compiler test lowers and
  certifies maintained Money used by `share`, `divmod`, and branded
  multiplication and proves no call receives inline `??`.
- R10: Quarry statically refuses nonnumeric unary minus with `negation requires
  an int, decimal, or money value`; bare fractional multiplication now explains
  that it needs an int or decimal-typed rate and rewrites toward a `decimal S`
  argument/column. Rust and TypeScript maintain validation skip descriptor
  equality when `sum.of` is unknown; Rust uses `Display` names instead of debug
  `Option` output. Compiler pins cover both messages and accepted `-amount`;
  the core malformed-maintain test requires exactly one unknown-source issue.
- R11: the guide now describes `divmod` as Euclidean (nonnegative remainder,
  floor only for positive divisors) and share/branded multiplication as floor
  operations because their divisors are positive. It carries the precise
  branding sentence from R5, and its `where`, statement, and upsert paragraphs
  are restored to base text. The package build enforces the byte budget.
- R12: the frozen corpus adds
  `named-maintained-sum-read-after-insert`: starting from a maintained -250, a
  +500 source insert followed by a same-program target read returns 250 in both
  runtimes. Regeneration produced 113 cases and the evaluator passes 113/113.
  Rust and journey Pay pins also require `myLedger` newest-first with `bob` on
  Alice's debit profile and `alice` on Bob's credit profile.

### Round 2 verification

- Focused compiler: typecheck pass; 273/273 checks pass.
- Focused evaluator: 113/113 corpus cases pass.
- Focused Clique Pay Rust e2e: 3/3 pass, including the independent share-order
  probe and the complete CLI/journey acceptance path.
- Core maintain checks and the 113-case corpus certification pin pass.
- Compiler-worker/client/package build passes; the Quarry guide is 12,283
  bytes.
- `cargo fmt --all -- --check` and `git diff --check` pass. `ref-check
  --verbose` reports 402 LLP docs, 7,313 refs, 0 errors, and 0 unchecked.
  Snapback 2 has no file over 1,500 lines, and no metrics path changed.
- The final single `scripts/test.sh` run completed every no-fail-fast leg:
  doctests pass, evaluator 113/113, compiler 273/273, and Rust 337/339. The only
  two failures are the brief's pre-declared sandbox exceptions,
  `chat_owner_wire_sse_channels_and_successors` and
  `stop_during_generation_update_is_bounded_and_cannot_recreate_owner_state`,
  both `E_OWNER_STOP_TIMEOUT` because process-liveness inspection is denied.
  The orchestrator must rerun this gate outside the sandbox for the required
  green 339/339 receipt.

### Round 2 deviations

- R12 intentionally supersedes the inherited “corpus unchanged” finish rule:
  the corpus diff is exactly one new case plus regenerated `manifest.json`.
- The blocking script cannot be green in this sandbox for the two explicitly
  anticipated owner-stop tests above. No product-specific failure remains.
- Repository-wide `caps` still reports only the round-1 inherited reds: 62/59
  current LLP links and the unrelated Snapback 1 `engine.rs` raising the
  baseline oversize count to 205/204. Snapback 2 adds no oversize file.

There are no other round-2 deviations. No shaped-page typing change was made,
no privacy rule was loosened, no metrics file was touched, and no git state was
changed.
