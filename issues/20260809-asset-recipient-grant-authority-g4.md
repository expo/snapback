# Recipient-scoped asset authority needs a paved path: grant primitive or app-bound assetSharing (LLP 0208 G4/G11 design slice)

**Status:** Open
**Severity:** P2 (design commission — the workaround is sound but hand-composed)
**Systems:** Assets, Auth, Schema, Memberships
**Date:** 2026-08-09
**Related:** LLP 0044 (asset pipeline — §Asset read authorization,
§Authorization), LLP 0056 / LLP 0100 (memberships — the general two-rosters
tax is LLP 0208 G4 and stays with those owners), LLP 0208 (pilot evidence)

## Problem

Clique's media authority (chat attachments visible to recipients; view-once)
did not fit any declared `assetSharing` flavor:

- `membership` binds only to the declared roles system, whose v1 roster is
  deliberately private (no listing, no promote-other, closed transitions) —
  incompatible with a product-visible, promotable roster, so the app already
  runs its own members table (LLP 0208 G4).
- `owner` was usable, but only by modeling authority as **per-recipient
  grant rows** (owner-principal sharing), minted at send, destroyed on
  delete — ~80 lines of hand-composed policy.
- `ctx.assets.attach` refuses non-owner callers
  (`SNAPBACK_ASSET_FORBIDDEN`), which sank the "viewer mints their own
  view-once grant" design; the workaround transfers authority by **patching
  the grant row's `viewerPrincipal` field** at open — it works and survived
  hostile probes, but authority-transfer-by-field-write is nowhere near a
  paved path.

The pilot essay's verdict: "policy-integrated storage exists but I had to
compose my own policy from its primitives" — B5 = 62, between the 60 and 90
anchors. The essay also *praised* the end state ("per-recipient grant rows
as the unit of media authority… policy-clay"), so the ask is a paved bridge,
not a redesign.

## Ask (owner ruling, ascending ambition)

For the LLP 0044 owner to rule, with LLP 0056/0100 consulted on (c):

- **(a) Docs-only:** bless the grant-rows + transfer-at-open pattern as the
  canonical recipe (the recipe half is in the G11 papercuts ticket). Cheap,
  honest, leaves authority-transfer-by-field-write as the blessed spelling.
- **(b) Grant primitive:** first-class `ctx.assets.grant(assetId,
  principal, opts)` / `ctx.assets.revoke(...)` handler ops — explicit,
  auditable authority transfer; view-once becomes grant-at-open /
  revoke-at-close with no field-patch idiom.
- **(c) App-bound sharing:** let `assetSharing: membership` (or a new
  flavor) bind to an app-declared table/predicate instead of only the
  declared-roles machine — dissolves the dual-roster tax for assets the way
  LLP 0208 G4's roster projection would for memberships generally.

The security rationale for the closed membership machine is documented and
not in question; per LLP 0208's non-goals this asks for a bridge, not a
weakening.

## Done when

- The LLP 0044 owner records a dated ruling choosing a rung (or an ordered
  combination), and LLP 0044 carries the corresponding dated amendment.
- The chosen rung is implemented with scoped evidence (for (a): the recipe
  lands and this closes docs-only; for (b)/(c): typed ops/flavor, refusal
  codes, and hostile-probe acceptance mirroring the pilot's 403/200/403
  sequence).
