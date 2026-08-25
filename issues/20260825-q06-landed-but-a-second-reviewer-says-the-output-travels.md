# Q06 landed, and a second reviewer says the reconstructed output still travels

Status: open — claim under execution, not yet established
Date: 2026-08-25
Systems: snapback-engine, snapback-kernel, snapback-sync
Related: llp/0303-subject-authority-correlation-policy.decision.md,
  issues/20260825-unforgeable-identity-should-be-one-primitive.md

## Why this ticket exists before the answer does

Q06 (rows F157, F175, commits `837155513` and `fca304d78`) is the one lane in this programme that
cleared a review outright and landed. Five sibling lanes have since been defeated by executable
reviews *after* producing fixes that looked correct — Q05 five separate times — and in every case
the capability had **relocated** rather than vanished.

That prior made Q06 worth a second opinion it never got. An independent adversarial review was run
against the landed commits. It did not clear the row.

The claim is **not yet established**: the reviewer states plainly that it did not execute, and rates
its central step *medium-high* and a downstream step *medium*. Recording it now, before the answer,
so the claim is durable whichever way execution goes — and so that if it is refuted, the refutation
lands against a written claim rather than a memory.

## What the review says holds

F157 and F175 were genuinely rebound at their named entry points. The current signatures no longer
take raw subject fields. That part of the fix is real and is not in dispute.

## What it says relocated

`prepare_pending_effect_session_original` and `prepare_pending_effect_service_original` still accept
a **caller-supplied reconstructed authority** and only VERIFY identity strings.
`PreparedBearerAuthority` and `ResolvedServiceAuthority` carry **no producing-database identity**,
and are `Clone`.

`DatabaseBinding` *was* added in `fca304d78` — but to the retained view, not to the reconstructed
outputs the wrap accepts. So the input side is bound and the output side is not:

> They bound the *input* view, then let the *output* travel to a second engine.

The predicate at roughly `engine.rs:5912–5962` was read as comparing `actor_user_id`,
`credential_id`, `credential_generation`, `grant_id`, `token_id`, `effective_user_id` and
`token_expires_at_ms` — and **not** `DatabaseBinding`, coordinator identity, scopes, or
`integration_status`. `session_claims_for_authority` is a no-op for `ServicePrincipal`, so the
impersonated principal need not exist on the second database at all.

Three further observations, each read from current source rather than inferred:

- engine `create_pending_effect` overwrites only `link_origin_id` and `approver_principal_id`; it
  does not derive `request.authority` from the creating `PreparedAuthority`;
- `approve_pending_effect` does not re-bind original authority to the stored row;
- `resolve_retained_service_authority` remains a public kernel sibling.

## The observation about our own tests

This is the part that generalises past Q06:

> Q06's landed tests only show that **A's retained view** is refused on **B's reconstructor**. They
> never feed **A's reconstructed output** into **B's original-authority wrapper**.

That is the LLP 0303 coverage class verbatim — binding on one path is not binding on its siblings —
and it is a plausible account of how the first review passed. A test suite that proves the bound
direction and never tests the unbound one will read as thorough.

## Status

An executing lane is running the reviewer's exact composition: two `LocalSnapback::memory()`
engines, the legitimate F175 path on A, a pending effect created on B with the principal's
coordinates copied, and A's resolution fed into B's wrapper. Assertions are on B's
`_snapback_pending_effects.status` and on the principal having no row in B's `_auth_users` or
`_auth_grant_tokens` — the reviewer named "would B's application rows actually commit" as its own
weakest inference, so that is being established specifically rather than stopping at the wrapper
accepting.

The lane is instructed to isolate the exploit and stop, not to fix it, so the finding is reviewable
before any change is designed.

**If confirmed**, the landed row count falls from 9 to 7 and F157/F175 reopen. **If refuted**, the
refutation is recorded here against this claim, and Q06 gains the executed evidence it should have
had at landing.
