# guide-gap: no authored guide page or capability row for the familiar authoring profile

**Filed:** 2026-08-15 (post-0.1.21 docs survey)
**Surface owner:** LLP 0252/0253 program (Phases A–C landed; 0253 spec Draft)

## Gap

The familiar authoring profile shipped in the published 0.1.21 closure:
`authoringProfile: "snapback-familiar-ts-v1"` is selectable in
`codegen.policy.json`, and the `query`/`mutation`/`action` constructors
in `@expo/snapback-codegen/familiar` lower to the canonical grammar
(LLP 0253 S1/S4; witnesses `packages/snapback-codegen/familiar-phase-a.test.mjs`
and `familiar-phase-b.test.mjs`). But an agent reading the guide finds:

- no authored guide page for selecting or authoring under the familiar
  profile (only the generated reference projection
  `guide/reference/expo-snapback-react--familiar.md` and passing
  mentions in the `guide/data/*` pages' promotion/refusal text);
- no `guide/capabilities.md` row — not even a GAP row, which LLP 0061
  §2 requires for owned-but-undocumented surface.

A GAP row is added alongside this ticket. The page itself should come
from the 0252/0253 program when its remaining phases settle the surface
(metrology mint and Phase 3 are open per that program's tracking), so
the page documents a stable grammar rather than chasing it.

## Resolution

Absorbed when a `guide/backend/familiar-profile.md` (or equivalent)
page lands with CI-verified snippets and the GAP row flips to a page
pointer. Keep the profile documented as Experimental/non-default while
the LLP 0256 D9/D10 window is open — the tiny-data freeze verifier
covers doorway posture, and the familiar profile's default posture is
similarly reserved to its own program's acceptance gates.
