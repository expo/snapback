# snapback2: Quarry and guide gaps hit by the fresh-session M7 migration legs (list indexing, nested maintain in a page shape, `capped` vs "no row", destructive maintain regrouping, successor page)

**Date:** 2026-09-07 · **Area:** Quarry language / successor migrations / guide · **Source:** Clique full run M7 legs, grok-snapback2 (`m7/final-report.md` gap list) and astra-snapback2 (`m7/final-report.md`)

Both M7 legs went green (group polls plus a backfilled per-conversation message count, migrated
as a schema successor with byte-identical persona snapshots), so these are ergonomics, not blockers:

1. **No list indexing.** A poll's 2–4 options became four named columns; `optionKeys[0]` is
   `E_QUARRY_UNKNOWN`. Bounded lists exist as a type but cannot be indexed or iterated by position.
2. **Nested `#maintain` in a page shape is `E_STRUCTURAL_COUNT`.** Poll tallies had to be aggregated
   client-side from the votes page instead of being a maintained count inside the thread shape.
3. **`first N` over a cap-N group reports `capped`.** When the bound equals the cap the result is
   complete by construction (LLP 1017's complete-by-cap rule), yet the envelope says `capped`,
   which "is easy to mis-handle as 'no row'."
4. **Reshaping a maintain grouping is a destructive index drop** that needs `--apply-migration` or a
   revert; the diagnostic says so, but the guide does not warn that changing a maintain's key is a
   migration.
5. **`snapback2 guide successor` / `guide migrations` is `E_GUIDE_UNKNOWN`**; the builders assembled the
   migration story from the operator page, the job page, and the diagnostic's rewrite text. astra's
   leg also hit `E_GUIDE_STALE` on `guide app` immediately after a clean `check`.
6. RN-web / kit: `accessibilityState.selected` does not become `aria-pressed`; offline pending is
   not automatic on the option node. Client-arm notes for the template, not Quarry.

## Proposed

- Item 3 is a certificate fix: a page whose literal bound equals the group's cap is complete; say
  `complete`, not `capped`.
- Items 1–2 are language decisions; record them in LLP 1011/1017 either way.
- Items 4–5 are guide pages: a successor/migrations page that the guide index actually serves, with
  the destructive-regroup warning; fix the stale-page detection that fires after a clean check.

## Published 0.0.19 recurrence — 2026-09-08

The fresh M7 author adds enum evolution to items 4–5. Adding `poll` to a required
message-kind enum refused with `E_SUCCESSOR_COLUMN_REQUIRED`. Making that changed
column optional allowed the successor, but cleared the existing values to null.
The author restored the populated text rows through temporary sender-authorized
scalar mutations, then restored the required type and removed the helper.

This follows the implemented contract in LLP 1001 §4: this enum change is a
destructive `TypeChange`; optional-to-required narrowing is a separate case.
It is not evidence of an engine regression. The installed operator/job guides
explain adding and filling a new required column, but do not explain enum case
addition or compose a recipe that preserves existing values through a retype.
The diagnostic also still says “a job once J1b lands,” although jobs have shipped.

The final author-captured API snapshot matches the supervisor's pre-M7 snapshot
after excluding capture timestamps and endpoint metadata. The supervisor checked
the unchanged capture helper and compared both files independently. This covers
15 starter messages, six quoted messages, and 81 receipt rows in a snapshot covering
eight personas and six persona-conversation views; media, reactions,
edited/tombstoned messages, and view-once values were not
populated. A later direct supervisor capture and final M7 acceptance remain pending.
The intermediate null-valued snapshot and failed migration attempts are retained;
the final match does not establish uninterrupted intermediate availability.

Extend the existing migration guide follow-up with the destructive enum case and
a bounded preservation recipe, including staged columns, immutable/index
constraints, planning, and resumable chunks. Correct the stale diagnostic rewrite.
Value-preserving enum-superset succession would be a separate design improvement.
The author's bulk-job and bounded-list attempts returned `E_STEPS`; those receipts
alone do not establish the cause or show that a bounded job recipe is impossible.
