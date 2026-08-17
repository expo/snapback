# Ephemeral projections need membership-backed permission lowering

**Opened:** 2026-08-17
**Source:** Coterie M3 backend dual review (codex MATERIAL, adjudicated;
LLP 0013 protected-room privacy rule controlling)

## Gap

An app cannot author an ephemeral projection (typing indicators, presence
scoped to a conversation) whose visibility is derived from a MEMBERSHIP
TABLE. Codegen does not lower a membership relation into the protected
ephemeral `permissionBacking` projection required by the sessions
runtime, so the only expressible postures are `allow.all()` (public
within the store) or nothing. For Coterie M3 typing, `allow.all()` means:
any authenticated — or anonymous — client that knows a conversation id
can observe per-member typing activity (profileId/displayName) and
inject spoofed typing entries; former members retain the id forever.
Review ruling: Snapback M3 typing stays UNCLAIMED until this exists;
the memory provider carries typing alone.

## What the capability must provide (from the review's enumeration)

1. Source-authored membership-backed ephemeral projection lowering: the
   schema declares "visible to current members of conversation X" and
   codegen generates the `permissionBacking` projection from the
   membership table.
2. The authority must be CURRENT membership, not historical incarnations
   (removal and rejoin change visibility immediately).
3. Removal/rejoin invalidation: an ephemeral subscription held by a
   removed member terminates or goes silent at removal time.
4. Write scoping: only current members may publish into the projection
   (no spoofed entries).
5. Negative tests as first-class fixtures: anonymous, non-member, and
   former-member observers all receive nothing.
6. An exact guide example (the typing-indicator recipe is the natural
   one).

## Pointer

The parked Coterie implementation and its constraints are recorded in
`demos/coterie/snapback/LANE-NOTES-M3.md` and Diary 0086.
