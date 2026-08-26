# The step-up bypass is still open — LLP 0285 called it the cheapest, highest-value item

**Status:** open
**Verified:** 2026-08-26 against `main`, by reading the public signature and the gate it feeds.

LLP 0285 §5.1 says, verbatim:

> **Delete `admit_pending_effect_decision`'s `requires_step_up: bool`.** Today a caller
> asserting `false` bypasses a human-approval gate entirely. Highest-value, cheapest item
> in this spec — do it first.

It was not done. It is still there.

## The composition

`crates/snapback-kernel/src/storage.rs:2571` is **public** and takes the flag from the caller:

```rust
pub fn approve_pending_effect_admitted(
    &mut self,
    approval: pending_effects::PreparedPendingEffectApproval,
    requires_step_up: bool,                                   // <- caller-supplied
    step_up: Option<&crate::auth::crypto::StepUpProof>,       // <- Option
    now_ms: u64,
) -> SnapbackResult<pending_effects::ApprovedPendingEffect>
```

and `crates/snapback-kernel/src/storage/pending_effects.rs:924` gates the human-approval
proof on precisely that boolean:

```rust
if requires_step_up {
    let proof = step_up.as_ref().ok_or_else(step_up_required_error)?;
    if consume_step_up_proof_on(tx, proof, now_ms)? != StepUpConsumption::Verified {
        return Err(step_up_required_error());
    }
}
```

A caller passing `requires_step_up: false` with `step_up: None` skips the branch entirely.
Nothing else re-derives the requirement.

Remaining sites: `storage.rs:2571`, `:2577`; `storage/pending_effects.rs:363`, `:419`, `:425`,
`:902`, `:924`.

## Why this is the programme's own defect class

This is subject/authority correlation in its plainest form: whether an approval *needs* human
step-up is a property of the effect and the principal, and it is instead handed in beside them
by the caller. Per the LLP 0303 ruling the requirement must be **derived** from the pending
effect's own durable row and the approver's resolved class — never accepted as a parameter.

## Where it sits in the plan

LLP 0285 §6 step 6 converts admissions value-descending, and its **first** item is
"pending-effect decision (closes the step-up bypass)". Steps 5–6 are the *forgery* half of F-1
and have not started; §6 is explicit that steps 2–4 alone "must not be reported as closing F-1."

Note the ordering constraint: step 6 depends on step 5's `ResolvedPrincipal`, which **does not
exist in the tree** (zero occurrences) — partial work on `lane/f1-forge` is held because LLP 0291
found the design as specified would add surface rather than replace it. This particular deletion,
however, does not need `ResolvedPrincipal`: the requirement can be derived from the pending
effect's durable row without introducing the new type.

## Related

- `issues/20260826-authorization-denominator-and-seam-map.md` — the pending-effect family is five
  of the nine unrowed defects.
- LLP 0285 §5.1, §6 — the specification and the migration order.
- LLP 0303 — derive over verify.
