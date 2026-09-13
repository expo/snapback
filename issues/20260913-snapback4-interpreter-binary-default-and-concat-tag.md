# Snapback 4: Unknown binary ops silently mean `=`, and Concat of Ids changes type

Status: Open
Severity: minor
Priority: P2
Area: correctness
Observed: 2026-09-13
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Review provenance: Snapback4 comprehensive-review synthesis (2026-09-13 child review)

## Problem and reproduction

Two parity gaps in the TS replica evaluator, both read directly from the
code:

1. `SameValueZero` has no arm in the `Binary` dispatch
   ([interpreter.ts](../snapback4/packages/snapback4/src/replica/interpreter.ts):343-363),
   so it falls into `default: return equal(left, right)`. The server
   ([runner.rs](../snapback4/crates/snapback4-core/src/engine/runner.rs):529-540)
   refuses non-scalars with a type error and returns `false` for
   cross-variant pairs — while the tag-erasing `equal()` returns `true`
   for `Id('u1')` vs `String('u1')` and structurally compares
   arrays/maps instead of refusing. Any future or malformed binary op
   silently becomes `=` rather than raising `E_SCHEMA`.
2. `Concat` of two scalars always yields a JS string
   ([interpreter.ts](../snapback4/packages/snapback4/src/replica/interpreter.ts):383
   template-string branch), while the server yields `Id` for `(Id, Id)`
   ([runner.rs](../snapback4/crates/snapback4-core/src/engine/runner.rs):407-416).
   Binder reachability of scalar Concat on this path is unverified, hence
   minor/latent.

Distinct from `20260913-snapback4-interpreter-readtime-and-unhandled-inputs`
(which covers the `Input` fallback) and the rule-`Eq` divergence filed
separately.

## Implementation locations

- [packages/snapback4/src/replica/interpreter.ts](../snapback4/packages/snapback4/src/replica/interpreter.ts) (Binary dispatch, `builtin` Concat)
- [crates/snapback4-core/src/engine/runner.rs](../snapback4/crates/snapback4-core/src/engine/runner.rs) (`same_value_zero`, `Builtin::Concat`)

## Suggestion

Add an explicit `SameValueZero` arm matching server semantics (refuse
non-scalars, variant-sensitive comparison) and make the Binary `default`
throw `E_SCHEMA` instead of returning `equal()`. Align Concat's result tag
with the server, or prove via binder tests that scalar Concat is
unreachable and then refuse it. Add TS-vs-Rust parity cases for both.
