# Step-up proofs carry no operation binding, so a proof for one operation can approve another

- **Status:** Open
- **Filed:** 2026-08-28
- **Area:** `crates/snapback-kernel/src/storage/auth_catalog_ops.rs` (`consume_step_up_proof_on`),
  `StepUpProof`, every step-up-gated decision including pending-effect approval
- **Found by:** codex gpt-5.6-sol (xhigh) adversarial review of the LLP 0285 §5.1 landing;
  independently noted as a residual by grok-4.6 ("effect-binding has to live on the proof
  object; replay across two pending effects is entirely `consume_step_up_proof_on`'s job")
- **Pre-existing:** yes — verified on `origin/main`; the identical
  `consume_step_up_proof_on(tx, proof, now_ms)` call shape predates the LLP 0285 §5.1 work.

## The gap

`StepUpProof` is `{ challenge_id, code, address }`. It names *who* proved *a* challenge. It does
not name **what the proof authorizes**.

`consume_step_up_proof_on(transaction, proof, now_ms)` resolves the challenge by `challenge_id`
alone and verifies the stored code digest, attempt count, expiry, consumed-ness, and supersession.
Nothing binds the proof to an operation, a resource, or a session:

```rust
pub(crate) fn consume_step_up_proof_on(
    transaction: &Transaction<'_>,
    proof: &StepUpProof,
    now_ms: u64,
) -> SnapbackResult<StepUpConsumption>
```

`StepUpProof` is cloneable, so a proof minted while the human was stepping up for operation A can
be presented to approve pending effect B and will return `StepUpConsumption::Verified`.

## Why it matters

Step-up exists so a *human* authorizes a *specific* privileged act. Without an operation binding
the gate proves only that some human recently answered some challenge — which is a weaker claim
than any caller of this function believes it is making. The pending-effect approval path
(`storage/pending_effects.rs`, the `consume_step_up_proof_on` call) is the sharpest case: an
authority-creating effect can be approved with a proof the human minted for something else
entirely.

This is the same defect *class* as LLP 0285 §5.1 (`requires_step_up: bool`) — an authorization
fact travelling beside the request instead of being derived from and bound to it — but at the
proof layer rather than the requirement layer.

## Wanted

- Bind each step-up challenge to the operation it authorizes at mint time (e.g. an
  `("effectApproval", effect.id)` tuple, or a canonical operation descriptor + argument digest),
  persist that binding on `_auth_verification_codes`, and require the consumer to pass the
  expected binding.
- `consume_step_up_proof_on` should take the expected binding and refuse a mismatch with a
  distinct code, rather than accepting any unused valid challenge.
- Bind to the approving session/principal as well, so a proof minted by one principal cannot be
  replayed by another.
- Regression: a proof minted for operation A must be REFUSED when presented for effect B, and the
  refusal must not consume it.

## Related

- LLP 0285 §5.1, §6 — the requirement-layer half, closed separately.
- LLP 0303 — derive over verify; this is the proof-layer application of the same principle.
- `issues/closed/20260826-step-up-bypass-still-open-the-cheapest-item-in-llp-0285.md`
