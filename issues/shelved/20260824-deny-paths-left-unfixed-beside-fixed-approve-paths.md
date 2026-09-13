# Deny and revoke paths left unfixed beside their fixed siblings

Status: open
Date: 2026-08-24
Systems: snapback-engine, snapback-server
Related: LLP 0303, issues/shelved/20260824-p1-ship-rows-enumerated.md,
  issues/shelved/20260824-liveness-row-bucket-assignment.md

## Pattern

Two independent lanes fixing approve-style operations under LLP 0303 each left the adjacent
**deny** operation untouched. Neither lane claimed otherwise — both reported it explicitly when
asked — but the pattern is worth tracking as its own work rather than discovered a third time.

1. **`deny_oauth_authorization`** — still accepts `consenting_user_id` as an independent parameter
   and does not call `require_agent_grant_management_session`
   (`crates/snapback-engine/src/local/engine.rs:5127-5136`,
   `crates/snapback-server/src/server/oauth.rs:504-515`), while its sibling
   `approve`/`issue` paths now derive the subject from the authority.
2. **`deny_grant_request`** — sits immediately below the now-fixed `approve_grant_request`
   (`engine.rs`, ~:5954). Under review to confirm whether it has the same shape.

## Why this is not merely cosmetic

A deny path writes durable state: it records a refusal, closes a pending request, and in some flows
frees or consumes a slot. If the subject is caller-supplied, a caller can deny **someone else's**
pending request — which is a denial-of-service and state-corruption shape rather than a privilege
escalation, and correspondingly easy to overlook when reviewing for privilege.

It also breaks the symmetry a reader will assume: once `approve` derives its subject, the natural
inference is that `deny` does too.

## Predicate

The same one the approve paths use, per LLP 0303: derive the subject from the admitted authority
via `require_agent_grant_management_session`, and remove the independent parameter rather than
verifying it.

## Scope note

Until the authority-provenance seal lands, a fix here may claim only that it derives the subject
from the prepared authority — not that a mismatch is unconstructible. See
`issues/shelved/20260824-authority-provenance-is-a-prerequisite-not-a-peer.md`.


## Two more found by a lane's own sibling audit (2026-08-24)

The invitation/pairing lane ran a read-only audit of its neighbours without being asked and found
two further paths still accepting a separately supplied user:

- `revoke_grant_for_user`
- `revoke_grants_by_actor_for_user`

These are **revoke** paths, so they carry the deny-path risk in its strongest form: a caller-supplied
subject means revoking someone else's grant. That is not a denial of one request but removal of a
standing capability, and it is the same shape as the grant-revocation *planner* defect already fixed
(`a5d66e941` + `23db84b46`) — which suggests the planner fix closed one door while these two
remained open beside it.

Predicate: the same as their fixed siblings — derive the subject from the admitted authority via
`require_agent_grant_management_session` and remove the independent parameter rather than verifying
it.

## Note on discovery

Both this pair and the original deny pair were found by lanes auditing their own neighbourhood
rather than by the sweep that produced the row inventory. The inventory enumerated *guard
acquisitions* and *authority-minting factories*; these paths are neither. Any future claim that the
population is closed should account for that: **operations adjacent to a fixed one are the cheapest
place to find the next instance, and no enumeration so far has covered them systematically.**

## Derivation lane result and neighbourhood inventory (2026-08-24)

The four named mutation boundaries now derive their durable user subject from
`require_agent_grant_management_session` and no longer accept that subject separately:

- `deny_oauth_authorization` no longer accepts `consenting_user_id`;
- `deny_grant_request` no longer accepts an `AdmissionEffectGuard` plus `user_id` and instead
  accepts the prepared authority;
- `revoke_grant_for_user` no longer accepts an `AdmissionEffectGuard` plus `user_id` and instead
  accepts the prepared authority; and
- `revoke_grants_by_actor_for_user` has the same conversion.

The server callers now forward only the prepared authority and the operation selector
(`request_id`, `grant_id`, or `actor_id`). This is a DERIVATION result only: the caller can no
longer supply the user independently at these four boundaries. It is not a claim of closure,
unconstructibility, a fence, or provenance identity.

`deny_grant_request` was confirmed to have exactly the suspected sibling shape: its fixed
`approve_grant_request` neighbour derived `(user_id, session_id)` from the management authority,
whereas denial accepted a separately acquired effect guard and caller-supplied `user_id` before
passing both user and request id to storage. Both revoke commit methods had that same split shape;
their already-converted planners derived the user, but the commit methods again accepted an effect
guard and a separate user.

The immediate-neighbourhood audit found the following additional inventory. These rows were not
changed in this deny/revoke lane:

- At this lane's base, the OAuth consent neighbours `begin_oauth_authorization`,
  `approve_oauth_grant_request`, and `issue_oauth_authorization_code` still accept independently
  supplied user facts (approval also accepts `session_id`). This differs from the issue's earlier
  report that their sibling lane had landed; that sibling delta is not present in the tree audited
  here, so integration must be checked before making any parity claim.
- `pending_grant_requests` and `grants_for_user` accept an authority plus an independent `user_id`.
  They are read paths rather than the durable deny/revoke mutations scoped here, but they retain
  the same correlation shape.
- `mint_pairing_code_with_authorized_effect` and
  `mint_agent_invitation_with_authorized_effect` accept a user alongside authority and compare it
  instead of deriving it. Their older effect-guard variants also accept `user_id` directly. These
  are adjacent grant-management write paths, not deny/revoke siblings.
- `approve_pending_effect` and `deny_pending_effect` both accept `approver_id` alongside management
  authority. They are symmetric with each other, but both retain an independently supplied subject;
  `pending_effects_for_approver` has the analogous read shape.
- `oauth_revoke_scoped_token`, `revoke_agent_credential_family`, and
  `retire_integration_credential_family` do not expose a separate user subject: their storage
  subject is selected by the supplied credential itself. No adjacent independent-user revoke
  sibling was found there.

Because this inventory contains unresolved rows, this ticket remains open. None of the listed
residuals should be read as covered by the four-row derivation result above.
