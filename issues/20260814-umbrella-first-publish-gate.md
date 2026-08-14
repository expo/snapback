# Umbrella first-publish gate blocks the D9 clock start

**Filed:** 2026-08-14 (overnight LLP 0254 program session)
**Blocks:** LLP 0254 Phase 4's final bullet (qualified publication of the
tiny package closure → D9 clock start → evaluation → D10 packet)

## Finding

All five LLP 0254 implementation phases are landed on main (Phase 4 at
`598d2cfc3`), including the S9 doorways at `@expo/snapback/data` and
`@expo/snapback/react/data`. But `@expo/snapback` — the LLP 0253
umbrella the LLP 0255 S9 package closure is defined over — has **never
been published**: the registry returns E404 for the name. The qualified
release ceremony (last: 0.1.20, epoch 25) covers the existing 11-package
family only; its promotion-authority prior vector, dist-tag flip, and
receipts are all shaped for those 11 names.

## The author decision

Starting the D9 clock requires "the first qualified publication of the
tiny Experimental package closure" (LLP 0255 S9 / LLP 0256). Two paths:

1. **First-publish the umbrella** — a brand-new public package under the
   `@expo` npm scope: extend the publication authority's vector to a
   12th name, verify org-scope publish rights, then run the ordinary
   qualified ceremony (0.1.21-era) including it. Outward-facing and
   irreversible; deliberately not attempted under overnight autonomy.
2. **Re-scope the closure to the existing packages** — LLP 0255 OQ4's
   recorded default path if the umbrella is withdrawn: mechanically
   re-export the `/data` doorways from the existing `@expo/snapback-
   client`/`-react` packages, amend S9's illustrative imports (a dated
   revision), and let an ordinary 11-package qualified release be the
   clock-starting publication.

Either way the ceremony should run in a **morning window** (the evening
GitHub macOS runner queue reliably eats the 900s staging lease — see the
0.1.20 ceremony record).

## Resolution

Awaiting the author's ruling on path 1 vs 2; then run the ceremony and
launch the D9 lanes per LLP 0256.
