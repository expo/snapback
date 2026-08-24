# Deny and revoke paths left unfixed beside their fixed siblings

Status: open
Date: 2026-08-24
Systems: snapback-engine, snapback-server
Related: LLP 0303, issues/20260824-p1-ship-rows-enumerated.md,
  issues/20260824-liveness-row-bucket-assignment.md

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
`issues/20260824-authority-provenance-is-a-prerequisite-not-a-peer.md`.


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
