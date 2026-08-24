# Two landed F-1 fences do not correlate the two authority axes

Status: open
Date: 2026-08-23
Systems: snapback-engine, snapback-sync
Related: LLP 0283 F-1, LLP 0297, issues/20260822-claims-versus-enforcement-is-endemic.md

## Summary

An independent audit of the five landed F-1 fences (dispatched after the unlanded
origin-bound capsule was caught with the same defect) found that **two of the five do not
enforce the property they claim**. I verified both by reading the enforcement code; neither
finding is taken on the reviewer's assertion.

Both fences accept the *staged/authorizing* authority and the *reserving* authority as
independent parameters and never compare them. Every check passes when they differ.

## Finding 1 — detached-action nested-mutation fence (critical)

`MutationEffectPosture::bind` discards `prepared` for both authorized variants
(`crates/snapback-engine/src/local/engine.rs:1433`):

```rust
Self::Authorized(reservation)              => BoundMutationEffectPosture::Authorized(reservation),
Self::AuthorizedAction(reservation, latch) => BoundMutationEffectPosture::AuthorizedAction(reservation, latch),
Self::ModeOnlyOrTerminalCarrier            => BoundMutationEffectPosture::ModeOnlyOrTerminalCarrier(prepared),
```

Only `ModeOnlyOrTerminalCarrier` retains `prepared`. For `Authorized` and
`AuthorizedAction` the prepared invocation (authority B) is dropped at bind time, and
`commit_guard` then validates only the reservation (authority A). There is no point at
which B and A are compared.

Note this is **broader than the audit reported**: the audit flagged only
`AuthorizedAction`; the ordinary `Authorized` variant discards `prepared` identically. I
have verified the discard for both; I have *not* checked whether the ordinary path has an
upstream correlation point, so treat the ordinary path as unverified rather than confirmed
open.

Shortest composition (audit-supplied, from safe in-crate calls): stage a mutation under
live authority B -> reserve an authorized effect under A -> terminalize B -> call the
public action sink with `{staged_B, reservation_A, ActionTerminalLatch::default()}`. All
checks pass and B's mutation commits.

## Finding 2 — pairing-code mint fence (high)

`require_pairing_code_mint_authority(authority, user_id)`
(`crates/snapback-engine/src/local/engine.rs:5819`) checks only immutable resolved facts
about `authority`: that it is `ResolvedAppAuthority::Session`, that
`authority.source() == InvocationSource::AgentGrantManagement`, and that
`authority_user_id == user_id`. The durable guard is then taken from the separate
`authorized_effect` parameter (`engine.rs:5805`). The two are never compared.

Composition: retain a prepared session authority B carrying the required static facts ->
obtain an `AuthorizedEffectReservation` from live A -> terminalize B -> call
`mint_pairing_code_with_authorized_effect(&B, user_id_B, ..., reservation_A)`. B satisfies
the static check; A authorizes the COMMIT.

## Correction of landed claims

This session recorded the detached-action fence as **PROPERTY** — "top violating path
route-closed for both caller classes, confirmed by measurement" — and the pairing-code
mint fence as **PROPERTY**. **Both claims are wrong.** The measurement confirmed that the
*measured* path was closed; it did not establish the property, because the tests exercise
callers that supply a pre-correlated pair. That is the same error the fences were built to
eliminate: verifying something correlated with the invariant instead of the invariant.

Downgrade both to ROUTE-CLOSED-FOR-MEASURED-CALLERS pending a fix.

## Design implication

Three independent fences (detached-action, pairing-code mint, and the unlanded
origin-bound capsule) have now each failed the same way: two authority axes supplied
separately, correlated only by caller discipline, with each side's check passing on its
own axis. A fourth one-off fence will make the same mistake.

The fix should be the shared primitive the capsule was already meant to be: **one opaque,
already-correlated carrier** that makes the mispaired composition unconstructible rather
than rejected. Extend the origin-bound capsule's scope to cover the detached-action and
pairing paths instead of hardening each separately.

## Not findings

The audit cleared, with parent-diff evidence: OAuth proposal cap (a real private-body ->
`pub(super)` widening, but the helper still structurally enforces count-and-insert and no
bypass could be composed), capsule construction-origin seal (`Arc::ptr_eq` on a private
graph identity actually blocks `{bindings_A, state_B}`), and R2 atomic batch persistence
(single immediate transaction, guarded seam private). 40 of 42 compile-fail fixtures pass
the strict "names and exercises what it fences" criterion; `clone_kernel_commit_authority`
and `reserve_authorization_via_sync` fail it and are evidence defects, not effect routes.
