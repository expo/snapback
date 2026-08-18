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

- Role narrowing is still open
  (`issues/20260817-ephemeral-membership-role-narrowing.md`); Coterie's
  typing needs only row-existence authority, so it is not blocked.
- The v8 declaration is byte-frozen; claiming typing changes only the
  adapter's claims/refusals, not the declaration, unless the Exact
  ephemeral-descriptor generation lands first (graduated to the Exact repo;
  local pointer
  `issues/closed/20260817-exact-ephemeral-declaration-generation.md`).
