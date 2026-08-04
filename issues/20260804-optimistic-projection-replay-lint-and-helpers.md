# Optimistic projections: dev replay-divergence warning and declarative projection helpers

**Date:** 2026-08-04
**Status:** Open
**Area:** Snapback React, optimistic mutations
**Governing:** LLP 0107, LLP 0061

## Problem

The chirp retrospective (`diaries/0053-chirp-expo-twitter-clone.diary.md`)
produced a family of optimistic-toggle traps. The documentation side is
resolved: `guide/recipes/optimistic-toggle.md` is the CI-verified paved path
(issues/closed/20260803-guide-gap-optimistic-toggle-across-query-surfaces.md),
and the two HMR failures are ticketed separately. Two runtime affordances the
retrospective asked for remain untracked:

1. **A development warning when an optimistic reducer is not replay-safe.**
   The core rule — `update` is a replayable projection, so capture and set the
   intended outcome rather than toggling/incrementing the incoming row — is
   currently enforced only by prose. A correct capture-and-set reducer is
   idempotent over its own output, so the dev-mode client can cheaply detect
   the anti-pattern: apply `update` to the base, apply it again to the result,
   and warn (with the mutation name) when the projected rows differ.
   `update: (rows) => rows.map(r => ({ ...r, liked: !r.liked }))` fails that
   check; the recipe's capture-and-set form passes it. Dev-only, no production
   cost, no admission-behavior change.

2. **Declarative projection helpers for common record shapes.** Hand-written
   reducers are where the toggle/increment mistake enters. Helpers such as
   `setFields(recordId, { liked, likeCount })` (and possibly a receipt-driven
   projection that sets exactly the fields the mutation will return) would be
   idempotent by construction and make the paved path also the shortest path.
   The complete-receipt `isAuthoritative` matcher could be derived from the
   same declaration instead of hand-written twice.

The retrospective also wished for transactionally coherent live-query
delivery of related writes (so a like row and its denormalized counter never
arrive split). The recipe deliberately treats partial delivery as expected
and handles it with the full-receipt matcher; whether delivery-side coherence
is worth pursuing is a separate protocol-level question and is only noted
here, not proposed.

## Suggested resolution

- Add the dev-mode replay-divergence check to `useSnapbackMutation`'s
  optimistic path in `packages/snapback-react/index.mjs`, warning once per
  mutation site with a pointer to the recipe page.
- Design the projection-helper surface as an LLP 0107 amendment or extension
  before implementing; derive `isAuthoritative` from the same declaration
  where possible.
- Extend `packages/snapback-react/optimistic.test.mjs` with a fixture proving
  the warning fires on a toggle-style reducer and stays silent on the
  recipe's capture-and-set form.
- Update `guide/recipes/optimistic-toggle.md` and the capability index when
  the helpers exist so the recipe teaches the helper as the default.

## Related

- issues/closed/20260803-guide-gap-optimistic-toggle-across-query-surfaces.md
- issues/20260803-react-hmr-reference-invalid.md (open HMR handoff runtime work)
- issues/closed/20260803-react-dev-binding-mismatch-user-facing.md
- issues/20260801-optimistic-create-and-app-error-guide-gap.md (adjacent
  optimistic-create paved path, still open)
