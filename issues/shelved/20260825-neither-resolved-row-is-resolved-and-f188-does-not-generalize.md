# Neither RESOLVED row is resolved, and F188 does not generalize

Status: open
Date: 2026-08-25
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-sync
Related: issues/shelved/20260824-liveness-row-bucket-assignment.md,
  issues/shelved/20260825-twenty-eight-of-forty-p4-rows-are-siblings-not-duplicates.md,
  issues/shelved/20260825-p2-rows-are-nine-decisions-not-sixty-eight.md

## All four buckets have now been audited, and all four were wrong

| Bucket | Claim | Audit result |
|---|---|---|
| P2-POLICY (68) | 68 decisions | **9 questions**, 7 already decided, 3 rows author-blocked |
| P3-LOW (17) | close with reasoning, no code | **12 of 17** likely falsifiable; six executed, **all six falsified**, five promoted to P1-SHIP |
| P4-DUPLICATE (40) | all duplicates | **28 siblings**, 12 genuine — and one of the 12 was also wrong |
| RESOLVED (2) | fixed at HEAD | **neither is resolved** |

## A. F190 and F191 are STILL-OPEN

`a5d66e941` removed the independent `user_id` argument from both terminal planners and derived the
user from the supplied `PreparedAuthority` — but left the sibling durable writers accepting an
independent `AdmissionEffectGuard + user_id`. `23db84b46` consolidated the source/session check into
`require_agent_grant_management_session` without closing those writers. A later commit `2d2649b75`
converted the writers to derive too, and its message correctly limits the claim to **derivation**,
disclaiming provenance.

The naked `user_id` mismatch is genuinely unconstructible now — that part is DERIVE, not VERIFY, and
storage scopes the selected grant by `(derived_user_id, grant_id)`. **The authority itself relocates:**

1. a dependent crate constructs a Sessions `AdmissionController` from public `AuthModeStateRecord` /
   `DeploymentIdentity` values and obtains a lease;
2. `ResolvedAppAuthority::Session` is a **public enum with caller-supplied user/session fields**;
3. `InvocationGate::prepare_admitted_authority` is public and accepts that lease and resolved
   authority **independently**;
4. the resulting `PreparedAuthority` is passed to a *different* `LocalSnapback`.
   `require_agent_grant_management_session` validates the authority's own lease, source and variant —
   but never that it was produced by the target engine or database.

So a caller-minted or first-engine authority naming B travels to the second engine and
selects/revokes B's grant. Under `test-support` the same route is simpler still via
`AdmissionLease::unmanaged`.

This is the same `ResolvedAppAuthority` that defeated Q04 twice, and it is what the authority-root
lane is closing now.

## B. The seven P1-SHIP rows are correctly classified — but F188 does not generalize

All seven have a settled exact predicate and a concrete durable or outbound effect; no author
decision is needed. Four status labels are stale: F171/F172/F173 landed DERIVE through the OAuth
lane, F188's reference pattern landed in `62daf4a1a` and `c19a57e9f`. **F053, F183, F185 remain
open.**

The correction that matters is to a claim this programme has been repeating, including by me:

> F188's own proof states that `PreparedAuthority` remains caller-constructible. Copying it does not
> solve cross-controller or cross-engine provenance.

F188 generalizes **directly only to F171–F173** — remove independent user/session arguments, derive
both from one exhaustive management-session match — and those have already adopted it. The others
need different work:

- **F053** — the exact `(session_id, generation)` must come from the connection authority and be
  bound to the database executing the sealed plan. Copying F188's helper is insufficient.
- **F183** — must also bind the exact step-up proof and authorized-effect reservation, and remove or
  consolidate the raw `mint_agent_invitation(effect, user_id, …)` sibling writer, which returns a
  secret and which the checked `*_with_authorized_effect` sibling does not close.
- **F185** — same shape: the raw `mint_pairing_code(effect, user_id, …)` route must be removed or
  changed to consume full authority.

"F188 is the reference implementation other lanes copy" was too strong and should not be repeated
without this qualification.

## C. One of the twelve TRUE-DUPLICATE calls was also wrong

Four of the twelve were spot-checked — chosen because none is a simple public wrapper. F189→F112,
F264→F266 and F265→F266 confirmed. **F280→F279 is a FALSE-DUPLICATE:**

F280 does not call F279. The direction is reversed — public F279 calls crate-visible F280, while
F280 independently calls the deeper settlement/staging path. A correction confined to F279 leaves
F280 able to accept authority A, an `AuthorityDescriptor` naming B, and caller-selected mutation
identity inputs, and reach the staged-mutation path and a later durable commit. Its `pub(crate)`
visibility is a boundary *inside* the crate, not against it.

Consistent with the checked-in P4 verification, which independently classifies F280 as P2
implementation work.

## Corrected count

| | |
|---|---:|
| Previous actionable | 120 |
| F190, F191 not resolved | +2 |
| F280 not a duplicate | +1 |
| **Corrected actionable** | **123** |

Landed progress restates to **9 of 123 — 7.3%**.

Seven published counts in this programme have now been corrected. The first five were over-counts
revised downward; these last two both revised **upward**. The direction of error flipped exactly when
the buckets that *removed* work from the total were finally examined.

**Explicit limit on this result:** the four-row spot-check does not certify the remaining eight
TRUE-DUPLICATE calls. One of four sampled was wrong; that rate applied to eight untested calls is not
a basis for confidence, and they should be treated as provisional.
