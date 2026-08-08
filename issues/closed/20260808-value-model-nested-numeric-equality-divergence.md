# Value-model equality: Rust evaluator and JS twin diverge on nested cross-representation numbers

**Opened:** 2026-08-08 · **Severity:** P2 (correctness; optimistic overlay vs authoritative guard can disagree) · **Area:** value_expr / data-tier conformance

## What

`src/value_expr.rs:526-532` vs `packages/snapback-contract/derived-overlay.mjs:173-197`

```rust
fn values_equal(left: &Value, right: &Value) -> bool {
    match (as_number(left), as_number(right)) {
        (Some(a), Some(b)) => a == b,
        _ => left == right,   // serde_json PartialEq below the root
    }
}
```

Cross-representation numeric compare happens **only at the root**. Nested values
fall to serde_json's `Value` `PartialEq`, whose `Number::PartialEq` returns
`false` for `PosInt(1)` vs `Float(1.0)`. The JS twin's `valuesEqual` recurses
through `deepEqual` where JS has one number type, so `{a:[1]}` == `{a:[1.0]}` is
**true** in JS and **false** in Rust. The module doc (value_expr.rs:25-26)
claims "Eq/Ne are deep value equality with cross-representation numeric
comparison" — the code does not deliver that below the root.

## Failure scenario

A non-JS client (Swift, curl, hand-authored JSON — `serde_json` parses `"1.0"`
as `Float`) sends args compared via `Eq`/`Ne`/`In` against integer-spelled
values inside an object/array. Authoritative evaluation (mutation guards, live
matcher) says unequal; the optimistic client overlay says equal → divergent
guard outcomes and overlay/authoritative flicker.

## The pin is neutered

`tests/conformance/data-tier/expr-equality-value-model.case.json` (field
`intFloat`) was meant to pin this, but JSON round-trip normalized it to `1` vs
`1`, so it silently tests nothing — evidence this is an oversight, not a
decision.

## Fix

Make `values_equal` recurse structurally with numeric compare at every level
(arrays/objects element-wise, numbers via `as_f64`), and re-author the corpus
case using a string-encoded plan or an arithmetic-produced float so the pin
actually bites. Consider a corpus-authoring lint: every case must fail if the
behavior it names is inverted (mutation-test the corpus per profile version).

## Confidence

High on semantics (verified against serde_json source and the JS twin); medium
on incidence (JS `JSON.stringify` never emits `1.0`, so exposure is non-JS
clients and hand-authored JSON).

## Resolution (2026-08-08)
Fixed on main (Lane C). Verified: cargo build; targeted suites pass (throttle 4/4, instance-lock 11/11, fork 3/3, value_expr 10/10, config 23/23, embed 7/7, workerd 10/10, data-tier corpus 2/2 + 37-case parity); ref-check clean.
