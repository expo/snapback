# guide-gap: show authority roster plus product-visible roster projection

**Status:** Resolved 2026-08-21
**Opened:** 2026-08-20
**Systems:** Guide, Memberships, Authorization, Projections, Messaging
**Related:** LLP 0056; LLP 0240; LLP 0277 P21; LLP 0295; diaries 0100, 0101

## Problem

Private membership rows are the correct authority posture, but a chat product
also needs a display roster, join timestamps, send-time recipient sets, and
aggregate receipt membership. Independent lanes discovered that bootstrap
cannot place arbitrary application fields on the creator seat and ordinary
handlers cannot enumerate the private roster. Both maintained a separate
ordinary projection table, learning the sanctioned pattern only after several
precise refusals.

Diary 0105 reproduces this on current local main and adds a concrete Guide/type
drift: the Familiar page demonstrates membership visibility with
`resourceField: "_id"`, but the generated TypeScript surface rejected `_id` as
outside the resource table's authored field union. The lane introduced and
maintained an ordinary resource key before it could reach the private-authority
plus product-projection design below.

## Requested repair

- Add one end-to-end chat/room recipe that declares the private authority
  roster and an app-visible projection, updates both on bootstrap/add/remove/
  promote/leave, and handles absent/idempotent branches.
- Make the `resourceField: "_id"` example typecheck as written or replace it
  with a generated-and-checked authored-key example.
- Explain which facts belong to authority versus product history, how send-time
  recipient snapshots are derived, and how later join/leave affects receipts.
- Include a drift/acceptance check proving the projection and authority
  transition stay synchronized.

## Exit

A cold builder can implement a reviewable chat roster without making the
membership table public or inventing an ungoverned mirror protocol.

## Resolution

Added `guide/recipes/membership-roster-projection.md` and linked it from scoped
roles and Familiar authoring. It separates private current authority, an
ordinary current product roster keyed by authored `conversationId`, and
immutable send-time recipient history. It covers create/join/leave/removal/
promotion, absent/idempotent branches, and projection-versus-authority drift
checks, and replaces the untypeable `_id` Familiar example. Retrieval case 69
uses the exact roster/projection/recipient vocabulary. The retained cold run
at `guide/eval-runs/2026-08-21/membership-roster-projection.md` passed in 4/15
tool uses.

Closure evidence: the retrieval and full Guide checks pass.
