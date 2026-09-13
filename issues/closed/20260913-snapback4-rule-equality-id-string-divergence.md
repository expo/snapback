# Snapback 4: Rule `=` treats Id and String as equal on device, not on server

Status: Closed
Severity: major
Priority: P1
Area: correctness
Observed: 2026-09-13
Evidence: Code-traced, confirmed by prior value-parity probes (`equal('u1','u1') === true` on TS vs `Eq(Id('u1'), String('u1')) === false` on core)
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)
Related: `20260912-snapback4-client-value-semantics` (aggregate-key Id tagging — same root cause, different surface)

## Problem and reproduction

The server evaluates rule and binary `=` with variant-sensitive `==`
([rules.rs](../../snapback4/crates/snapback4-core/src/engine/rules.rs):110,
[runner.rs](../../snapback4/crates/snapback4-core/src/engine/runner.rs):514
`BinaryOp::Eq => Ok(Value::Bool(left == right))`), where `Id('u1') !=
String('u1')` ([value.rs](../../snapback4/crates/snapback4-core/src/value.rs):204-242
tags String=3, Id=4). The TypeScript replica evaluates both the rule arm
and the expression arm through tag-erasing `equal()`:
retired `packages/snapback4/src/replica/interpreter.ts`:94-95
(`tagOf` maps every string to 3), :127-128 (`equal` via `totalCompare`),
:351-352 (Binary `Eq`/`Ne`), :735-736 (rule `Eq`/`Ne`).

Rule binding performs no operand type check
([schema.rs](../../snapback4/crates/snapback4-core/src/schema.rs):662-665 only
verifies named columns exist), so a rule such as `.data = viewer` over a
`Json` column holding the string `'u1'` is admissible — and the device
grants it (viewer `Id('u1')` equals `String('u1')` locally) while the server
denies it. Offline reads/predictions and online enforcement disagree on an
access-control predicate. The aggregate-key tagging in the related ticket
is one symptom; the rule-`Eq` arm is the authorization-relevant one and is
not covered there.

## Implementation locations

- Retired `packages/snapback4/src/replica/interpreter.ts` (`tagOf`, `equal`, Binary and rule `Eq` arms)
- [crates/snapback4-core/src/engine/runner.rs](../../snapback4/crates/snapback4-core/src/engine/runner.rs) (`BinaryOp::Eq`)
- [crates/snapback4-core/src/engine/rules.rs](../../snapback4/crates/snapback4-core/src/engine/rules.rs) (`evaluate` Eq/Ne)
- [crates/snapback4-core/src/schema.rs](../../snapback4/crates/snapback4-core/src/schema.rs) (rule validation)

## Suggestion

Preserve the Id/String distinction in the TS value model (tagged
representation) so `equal` agrees with the server, and add cross-runtime
parity tests that evaluate the same `=` rules/expressions over mixed
Id/String/Json fixtures on Rust and the real TS interpreter — including a
`.field = viewer` rule over a Json column. Decide in one place (with LLP
3000.003) whether tags or type context own the contract.

## Resolution — 2026-09-13

The cited TypeScript evaluator was retired in
`993688b298d4070e549fe0c93588257964bfde05`; device reads now execute the same
Rust `Value` and rule evaluator as the server. The regression in
[device.rs](../../snapback4/crates/snapback4-device/tests/device.rs) verifies that
a JSON string containing `dev:alice` is unequal to the viewer identity in a
binary expression and in `.data = viewer`; the online-only rule hides the row
and reports incomplete coverage on both SQLite and memory devices. All 17
device tests pass. Regression: `b19a89631`.
