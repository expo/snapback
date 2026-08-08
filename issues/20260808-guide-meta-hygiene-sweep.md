# Guide meta hygiene sweep: duplicate index entry, duplicate surface-map rows, dead skill citation, README status

**Opened:** 2026-08-08 · **Severity:** P3 (documentation, batched)

One editing pass over the meta/entry files closes all of these:

1. **guide/index.md lists "Local instance forks" twice** in the Operating
   section (:239-240 and :266-268) with identical text — merge artifact;
   delete one.
2. **guide/surface-map.md duplicates two route rows:** `/app-api/current`
   and `/app-api/envelope/{sha256}` each appear twice (:95-96 and :99-100).
   The checker's join is set-based so it passes; delete the duplicate pair.
3. **SKILL.md trap 6 cites a dead ticket path:**
   `issues/20260806-asset-image-src-strict-url-sessions.md` moved to
   issues/closed/ when the fix shipped in 0.1.12. The trap's substance is
   still accurate (packages/snapback-react/index.mjs:3675 emits the
   sessions-strict diagnostic) but the citation is dead, and the trap omits
   that since 0.1.12 `src` picks the most-permissive granted delivery and
   warns loudly. Update path (trap 8 shows the closed/ convention) and add
   the 0.1.12+ note.
4. **Reviewed-stamp lag on the two meta pages that define freshness:**
   conventions.md and surface-map.md both say `reviewed: 2026-08-03`, but
   conventions gained two sections on 2026-08-06 (3eb862d32, 8b821028a) and
   surface-map changed three times that day. Bump both on the next pass.
5. **README.md:14-25 status blockquote** ("early design with a first
   local-dev core slice … primarily in the vision-and-design stage")
   materially undersells an eleven-package 0.1.15 npm closure, a 52-page
   CI-verified guide, and dozens of shipped capability rows — and
   contradicts README.md:246-249. Refresh to reflect the published
   local-target product plus honest hosted gaps.

Housekeeping folded into the review landing itself (recorded here for the
trail): the stale duplicate open copy of
issues/20260807-surface-command-optional-input-undefined.md was removed —
the closed copy (issues/closed/, 2026-08-07 15:30) carries the recorded
resolution; the open copy (15:33) was an identical-body leftover that
contradicted it.

Found by the 2026-08-08 comprehensive docs review (entry-points slice).
