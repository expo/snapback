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

## Amendment 2026-08-15 — clique-0121 sweep evidence for the page's contents

The `sol-snapback-familiar` lane of the clique-0121 exploratory sweep
(LA Durand, `~/clique-0121-20260814`) built Clique M1–M3 green on this
profile and its diary/essay name what the page must cover beyond the
grammar:

- **Native session custody:** the lane shipped web IndexedDB custody but
  left native custody in memory (a disclosed process-restart persistence
  gap); the explicit lane wired SecureStore. The familiar page needs the
  native custody recipe, not just the web one.
- **Authorization pattern prominence:** with no declarative computed-
  membership rule (see
  `20260815-owner-visibility-filters-handler-reads-membership-authority-gap.md`),
  per-handler active-member/admin checks are the sanctioned pattern and
  the essay argues they must be front and center, "because it is where
  otherwise-correct realtime code can become subtly unsafe."
- **Hook argument identity hygiene:** teardown surfaced non-failing dev
  warnings about stable-content query argument objects changing identity
  at several hook sites; the page should show the memoization idiom the
  React arm expects.
- The lane's essay asks for an end-to-end example (Expo Router,
  acceptance processes, asset uploads, generated-artifact refresh) over
  more isolated reference pages.

## Resolution

Absorbed when a `guide/backend/familiar-profile.md` (or equivalent)
page lands with CI-verified snippets and the GAP row flips to a page
pointer. Keep the profile documented as Experimental/non-default while
the LLP 0256 D9/D10 window is open — the tiny-data freeze verifier
covers doorway posture, and the familiar profile's default posture is
similarly reserved to its own program's acceptance gates.

Implemented 2026-08-15 by `2e0e5e03a`. The new authored page documents the
grammar that ships in 0.1.21 as **Experimental / non-default**, flips the
capability GAP to a page pointer, puts per-handler active-member/admin checks
before business logic, shows stable React-hook argument memoization, and gives
a tested Expo SecureStore adapter for process-restart session custody. Its
single Expo Router journey connects generation, provider ownership,
authorization, asset upload, generated-artifact refresh, acceptance process
ownership, and native relaunch proof.

Proof: `packages/snapback-codegen/familiar-phase-b.test.mjs`,
`packages/snapback-react/familiar.test.mjs`,
`packages/snapback-react/package.test.mjs`, the SecureStore restoration block
in `packages/snapback-contract/auth-coordinator.test.mjs`, and the guide and
retrieval checks. Lane F's familiar asset-intent/query-lowering changes and
Lane G's membership grammar/authorization recipe were deliberately not
anticipated; the asset-boundary and short link-shaped authorization sections
need a follow-up accuracy pass after those branches land.
