# Team Chat needs an owner-authorized member-removal surface

**Status:** Open
**Severity:** P1
**Systems:** Team Chat, Memberships, Authorization invalidation, Codegen
**Date:** 2026-07-26
**Governing:** LLP 0056, LLP 0053, LLP 0063 Step 6
**Proposed authority:** LLP 0100 (Draft)

The `team-chat/local-pressure-v0` checkpoint can invite, self-accept,
self-leave, and rejoin through the declared `roomMembers` membership. It
cannot implement the Slack/Discord owner action “remove this member.”

The private roster correctly exposes no application-readable membership row
id. Current id-addressed `ctx.membership.*.remove(...)` therefore is not an
application authoring path, and treating the displayable
`roomParticipants` row as authority would violate LLP 0056.

## Proposed decision

LLP 0100 proposes an explicit `principalAddressedWrites.remove` declaration
and generated `removePrincipal(resource, targetPrincipal)` command. It admits
only a total `target: "other"` remove transition, resolves the target row
inside the host, returns the same `null` for present and absent targets, and
keeps the transition matrix, provenance, `lastHolder`, delegated consent, and
LLP 0053 invalidation as the sole governing mechanisms.

The proposal remains Draft. This issue stays open until the RFC is independently
reviewed, ratified, implemented, and exercised by the Team Chat product
receipts.

## Acceptance

- an owner removes an active member without obtaining a private roster id;
- a non-owner, cross-room owner, delegated principal without consent, absent
  member, and malformed target all fail with the intended non-disclosing
  outcome;
- removal and full-provenance append commit atomically;
- active protected queries and rooms blank/quarantine before newly forbidden
  delivery can become visible;
- queued and retained state cannot replay after the membership epoch changes;
- last-holder and bootstrap invariants remain unchanged; and
- the Team Chat pressure app exercises owner removal through a complete UI and
  executable target receipt.
