# Coterie: adopt `allow.members` to claim M3 typing in the Snapback lane

**Opened:** 2026-08-17
**Source:** LLP 0277 F5; capability closure in
`issues/closed/20260817-ephemeral-membership-permission-backing.md`

## Work

The membership-backed ephemeral capability (`allow.members`) closed on main
on 2026-08-17, but Coterie does not gain typing automatically: the closure
record states its schema uses incarnation-oriented membership and must
migrate to a canonical `membership()` declaration before the posture can
bind. Steps:

1. Migrate the Coterie M3 conversation membership schema to declare the
   canonical current-membership relation (keeping the incarnation history
   rows for receipts/cutoffs — the current-projection split from the M3
   review already separates them).
2. Author the typing projection with `allow.members` per the landed
   typing-indicators guide recipe; keep the 2 s visibility / 5 s lease
   contract from the frozen v8 bridge extension.
3. Grow the adapter claim from M3-minus-typing: claim `observeTyping` /
   `setTyping`, delete the refusal that cites the closed platform ticket,
   and turn the two skipped-by-claim acceptance steps green.
4. Carry the capability's negative fixtures (anonymous, non-member,
   former-member observers and writers) into the Coterie acceptance run.

## Constraints

- Role narrowing closed on 2026-08-21
  (`issues/closed/20260817-ephemeral-membership-role-narrowing.md`); Coterie may
  still use the default complete active-role set, so its adoption shape is
  unchanged.
- The v8 declaration is byte-frozen; claiming typing changes only the
  adapter's claims/refusals, not the declaration, unless the Exact
  ephemeral-descriptor generation lands first (graduated to the Exact repo;
  local pointer
  `issues/closed/20260817-exact-ephemeral-declaration-generation.md`).

## Resolution

Resolved 2026-08-24. Coterie now keeps one canonical current-access seat per
principal/conversation in `conversationCurrentMembers.membership()`, while the
existing `conversationMembers` incarnation rows continue to own roles,
receipts, unread watermarks, join sequences, and removal cutoffs. Conversation
creation, member addition, removal, and leave update both projections
atomically; product-level admin promotion leaves the canonical access seat
unchanged.

This adoption is a documented **DESTRUCTIVE-WITH-RESEED** transition. It does
not backfill `conversationCurrentMembers`: every disposable Coterie database,
including one already created from the pre-typing M3 schema, must be reset and
then installed through `seed-m3.mjs`. The existing-conversation fixture paths
may otherwise return `matched` without reconstructing the canonical seats. A
future preserved-data deployment must use a separately reviewed migration and
explicit canonical-membership backfill before activating this schema.

The `typing` ephemeral collection uses connection-owned entries, an explicit
5,000 ms lease, and `allow.members('conversationCurrentMembers')` for both
publish and subscribe. Omitting `roles` selects the declaration's complete
active set, its sole `member` role. The adapter now claims `observeTyping@1`
and `setTyping@1`, projects one latest entry per external user, clears its own
lease on send/leave/auth loss, and reuses login/profile-stream identity on the
latency-critical publish path. The shared provider proof's two former
`skipped-by-claim` typing steps are required green steps.

Coterie's backend acceptance carries anonymous, authenticated non-member, and
former-member observer and writer denials. Existing incarnation churn,
receipt, unread/rejoin, quote/privacy, message-envelope, and chat-envelope
proofs remain green. The byte-frozen Exact v8 declaration and its generated
declaration products are byte-identical to `origin/main`.

Verification:

- Coterie M3 backend acceptance with both runtime/server binaries — 14/14
  named M3 subtests; the Node summary printed 16/16 total tests after counting
  the parent harness and standalone receipt-envelope test
- Coterie Snapback adapter integration with both binaries — the M3 live tails,
  fresh raw survivor frame, removed-overlay non-delivery, M2 live proof, and
  formal M1/M2/M3 conformance all passed; Bun then printed 97 assertions before
  the explicitly configured, stale-stamped server timed out in the unrelated
  post-conformance `setAvatar` profile-stream tail
- shared Coterie Snapback provider proof — 30/30, zero skipped claims
- shared Coterie memory provider proof — 30/30, zero skipped claims
- Coterie Snapback adapter unit tests — 15/15, 179 assertions
- Coterie Snapback codegen — 13 tables, 39 operations, one ephemeral collection
- `./ref-check --verbose`

Landing SHA: TBD
