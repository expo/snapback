# The step-up bypass is still open — LLP 0285 called it the cheapest, highest-value item

**Status:** Resolved
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

## Resolution

Resolved 2026-08-28 by deleting `requires_step_up` from the public
`ServingDatabase` approval method, the kernel admission, and the internal
approval command. The engine no longer supplies the function declaration's
boolean beside the prepared effect.

The first implementation's unpinned `_auth_scope_bases` lookup was not a safe
source: the same serving caller could reconcile an authority-creating function
to `false` after intent creation and then approve without proof. The completed
fix creates `_snapback_pending_effect_scopes` and atomically records the exact
scope-basis generation beside each new pending effect. Approval re-reads
`authority_creating` only from the present `_auth_scope_bases` row whose
function id, kind, **and generation** match that immutable pin. Reconciliation
advances the generation whenever kind or authority class changes, so a
downgraded row cannot match the pending effect's predecessor pin.

The source of truth is therefore the kernel-written per-effect generation pin
plus the generation-fenced scope basis. Production deployment/auth activation
reconciliation writes scope bases; the pending-effect creation transaction is
the only writer of pins. The former direct `LocalDatabase` and
`ServingDatabase` reconciliation methods are now compiled only for unit tests
and explicit `test-support` consumers, so an ordinary production caller cannot
pre-seed or rewrite the classification. The approving session principal can
write neither component. During tests, a direct reconciliation can only
produce a successor generation, which makes an already-prepared effect stale
instead of changing its step-up requirement.

Missing pins, missing exact-generation bases, malformed rows, and SQL failures
now refuse approval outright before proof consumption; they are not treated as
"requires step-up," because an unrelated valid proof cannot establish an
undeterminable function classification. Existing in-flight rows created before
the sibling pin table was installed consequently fail stale and must be
re-created. The engine's current-manifest check now returns only validation,
making the kernel's generation-fenced catalog the single authority for the
step-up classification.

Regression coverage records the reconcile-downgrade exploit failing before the
fix, then verifies the downgrade is stale, an authority-creating effect reaches
`StepUpConsumption::Verified` and durably consumes its proof, an ordinary effect
still approves without proof, and a missing pin refuses without consuming a
generic valid proof.

## Scope of this closure — what it does and does NOT establish (supervisor note, 2026-08-28)

This ticket is closed for exactly the defect LLP 0285 §5.1 named: **`requires_step_up` is no
longer a caller-supplied parameter**, and the derived requirement is fenced against the
reconcile-downgrade attack by the generation pin. Two blind reviews (codex gpt-5.6-sol and
grok-4.6, both xhigh) confirmed on the second revision that missing pins, stale pins,
`present != 1`, and malformed flags all fail closed, and that proof consumption is reached and
checked for `Verified` only on the required branch.

It does **not** establish "step-up is enforced for pending-effect approval." Two residuals were
found during review and are tracked separately:

1. `issues/20260828-step-up-proofs-are-not-operation-bound.md` — **pre-existing** (verified on
   `origin/main`). `consume_step_up_proof_on` takes only `(proof, now_ms)`; `StepUpProof` carries
   no operation or session binding, so a proof minted for another operation can be redirected to
   approve an effect. Until that lands, the gate proves a human answered *a* challenge, not that
   a human approved *this effect*.
2. `issues/20260828-scope-basis-reconciliation-is-cfg-gated-not-authority-gated.md` — the
   "approver cannot write the classification" property rests on a compile-time feature graph
   (`#[cfg(any(test, feature = "test-support"))]`) rather than a runtime authority check. Verified
   as **not** a production bypass today (all `test-support` enablements are `[dev-dependencies]`),
   but it is an assumption rather than an enforcement.

Do not cite this closure as evidence that F-1's forgery half is addressed; LLP 0285 §6 is explicit
that steps 2–4 alone must not be reported as closing F-1.
