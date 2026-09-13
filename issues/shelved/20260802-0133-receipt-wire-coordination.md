# LLP 0133 receipt wire coordination — provisional settlement spellings

**Status:** Open coordination note
**Opened:** 2026-08-02
**Owners:** LLP 0043, LLP 0034, LLP 0093/0094 maintainers (LLP 0129 ledger row 4)
**Related:** LLP 0133 §Receipts; ticket 20260802-0133-01

## Shipped provisional content

The local target now projects LLP 0133's settlement-trust content additively
through the existing mutation receipt family. These are working spellings,
not this lane's claim to freeze the row-4 wire contract:

- `settlementLane`: `"replay-accept" | "re-derive"`;
- submitting-authority-only `claimLedger` entries:
  `{fieldOrSlot, claimed, authoritative, disposition, skewMs?}`;
- dispositions: `"accepted" | "accepted-bounded-skew" | "re-derived"`;
- the later ticket-04 private mapping member is reserved as `idMap`.

The global receipt ring is the fan-out boundary. It retains
`settlementLane` and the pre-existing write-surface facts, but strips
`claimLedger` and `idMap`; the direct mutation response is the private
projection. Generated schemas accept absence of the additions so older
stored/decoded receipt material stays readable under the additive-wire rule.

## Coordination requested

When ledger row 4 freezes receipt shapes, its owners should either ratify
these spellings or land a dated additive projection/migration amendment in
LLP 0043/0034/0093 (and the LLP 0094 provider matrix). That work must preserve
the server-enforced privacy boundary above. It must not infer consent to expose
claim values from a client accepting or ignoring this provisional spelling.
