# Team Chat needs an owner-authorized member-removal surface

**Status:** Open
**Severity:** P1
**Systems:** Team Chat, Memberships, Authorization invalidation, Codegen
**Date:** 2026-07-26
**Governing:** LLP 0056, LLP 0053, LLP 0063 Step 6

The `team-chat/local-pressure-v0` checkpoint can invite, self-accept,
self-leave, and rejoin through the declared `roomMembers` membership. It
cannot implement the Slack/Discord owner action “remove this member.”

The private roster correctly exposes no application-readable membership row
id. Current id-addressed `ctx.membership.*.remove(...)` therefore is not an
application authoring path, and treating the displayable
`roomParticipants` row as authority would violate LLP 0056.

## Needed decision

Amend the membership authoring contract with a host-owned, declaration-bound
other-principal transition that does not disclose private roster ids or
membership existence. A likely shape is resource + target principal, admitted
only when the transition matrix names the caller role, target relation, source
role, and operation.

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
