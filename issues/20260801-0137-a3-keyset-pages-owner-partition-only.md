# A3 sweep: generated keyset pages accept only principal-owner partitions; the org board list cannot use them

**Opened:** 2026-08-01
**Systems:** Codegen, Standard patterns
**Related:** LLP 0137 (A3 arm), LLP 0065, LLP 0110, LLP 0131, issues/20260801-0137-a2-guide-gap-bounded-keyset-not-in-packaged-ctx-db.md, demos/improvement-sweep/arms/a3-snapback-web/findings/0137-a3-f7-keyset-pages-owner-partition-only.json

`defineOwnedKeysetPages` — the safe cursor path with opaque AEAD
continuations, byte-uniform refusals, and the no-skip/no-dup guarantee —
only accepts `visibility: { kind: 'owner' }` (principal match). The board's
primary list shape (all issues in an org/team, visible to any member)
partitions by a resource id, so it cannot use the generated path; combined
with 0137-a2-f5 (no strict-gt verb in the packaged ctx.db chain) the
org-wide cursor must be hand-rolled over a bounded indexed read, forfeiting
cursor custody. The A3 arm shipped both shapes (generated "my issues" pages
green including cross-owner cursor refusals; hand-rolled org cursor honest
at seed scale only).

Fix shape: a membership-gated resource partition for the generator — index
`[resourceField, cursorField]` plus a membership declaration whose resource
axis is that field; the cursor binds the resource partition and the
caller's seat. This is the LLP 0110/0131 bounded-children/board-list shape.
Witness: generated pages over (orgId, pageKey) for any member, standard
refusal matrix, outsider denied, stable under interleaved writes.

---

**Triage 2026-08-01 (fix-wave Lane β): governed by LLP 0100 §4, gated on its
ratification.** This ticket's fix shape (a membership-gated resource
partition for the generated keyset pager) is item 2 of **LLP 0100** (Draft):
"a generated `membership-keyset-pages.v1` profile that pages one
membership-protected resource through an opaque, authority-bound keyset
cursor", with the cursor granting no authority and invalidating when the
caller's authorization epoch changes. 0100 §4 carries the declaration and
index shape.

Do not implement independently: an ad-hoc resource partition that does not
bind the cursor to the authorization epoch would hand out a cursor that
outlives revocation — the exact property 0100 designs against. Blocked on
0100 ratification alongside its sibling
`20260801-0137-a2-no-admin-revocation-of-another-member.md` and
`20260726-team-chat-room-pagination.md`.
