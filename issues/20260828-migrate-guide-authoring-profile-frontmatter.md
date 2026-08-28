# Migrate legacy Guide authoring-profile scope into page frontmatter

**Status:** Open
**Impact:** 4
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, Documentation, Tooling
**Date:** 2026-08-28

## Summary

The Familiar parity-policy survey classified the 100 authored Guide pages as
5 Familiar-covered, 52 Explicit-only, and 43 profile-neutral. Three pages now
declare their scope directly: the original `guide/conventions.md` exemplar plus
`guide/backend/schema-evolution.md` and `guide/clients/react-expo.md`, migrated
during integration. The active legacy inventory therefore contains 97 rows.

The immutable authority remains the original 99 `(path, scope, SHA-256)` tuples
in `scripts/guide-authoring-profiles-baseline.mjs`. The active subset lives in
`scripts/guide-authoring-profiles.mjs`. The checker rejects an active path
outside the frozen set and rejects any scope or digest that differs from its
frozen tuple. A one-way migrated-path ledger in the baseline module records the
two deleted rows and prevents their restoration; the frozen tuples, active
rows, and ledger must partition exactly. Page bytes and projected scope are
also resolved against the frozen tuple, never an editor-refreshed active value.
The inventory still classifies `guide/start/mental-model.md` as Explicit-only
and binds its original bytes.

## Exit condition

Migrate the remaining entries opportunistically when their pages are
materially edited:

1. Recheck the page against the scope definitions in `guide/conventions.md`.
2. Add canonical `authoring-profiles` frontmatter.
3. Delete the page's exact row from the active inventory. Do not edit the
   frozen authority or refresh either digest; append the path to
   `MIGRATED_LEGACY_AUTHORING_PROFILE_PATHS` in the baseline module.
4. Run `node scripts/check-guide.mjs` and regenerate the Guide manifest and
   flat projections with `node scripts/generate-guide-manifest.mjs`.

Close this ticket when the active legacy inventory is empty. The frozen
99-tuple authority remains committed as migration history. New pages, restored
rows, new legacy rows, and tuple rewrites are not permitted.
