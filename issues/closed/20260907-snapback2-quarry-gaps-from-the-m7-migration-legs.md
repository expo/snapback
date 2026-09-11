# snapback2: Quarry and guide gaps hit by the fresh-session M7 migration legs (list indexing, nested maintain in a page shape, `capped` vs "no row", destructive maintain regrouping, successor page)

**Status:** Resolved — implemented items retained; surviving syntax explicitly deferred
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
populated. A later direct supervisor capture found a20-row API pagination limit; an exact
stored-row check found the omitted original message intact. The browser attempt was separately aborted for contamination. See the
[attempt record](../benchmarks/runs/2026-09-08-release-cold-headroom/m7-aborted.md).
The intermediate null-valued snapshot and failed migration attempts are retained;
the final match does not establish uninterrupted intermediate availability.

Extend the existing migration guide follow-up with the destructive enum case and
a bounded preservation recipe, including staged columns, immutable/index
constraints, planning, and resumable chunks. Correct the stale diagnostic rewrite.
Value-preserving enum-superset succession would be a separate design improvement.
The author's bulk-job and bounded-list attempts returned `E_STEPS`; those receipts
alone do not establish the cause or show that a bounded job recipe is impossible.

The [clean retry](../benchmarks/runs/2026-09-08-release-cold-headroom/m7-retry/README.md)
subsequently passed its local M7 suite and frozen poll choreography. It avoided
retyping the old discriminator, added an optional logical message type, and
used the documented optional-column/backfill/required-narrowing sequence for a
new stored count. The job visited all three stored conversations; the canonical
Node 24 API snapshot preserved the two persona-visible conversations exactly.
This demonstrates one successful additive route, while the guide follow-up
for preserving values through enum evolution remains. The late snapshot again
hit the thread's visible window; exact storage checks found all six omitted
starter DM rows unchanged in their original message fields. The completed
[independent assessment](../benchmarks/runs/2026-09-08-release-cold-headroom/assessment-m7/README.md)
also recovered all 15 starter IDs and 13 message fields through Alice's paged
`offlineHistory` API. That check does not establish late receipt/reaction
preservation across every persona.

## Inherited thread/API pagination mismatch — 2026-09-08

Independent M7 grading found a 42-row DM returned only 20 rows through
`messages.thread`, with `state=capped` and `next=null`. The relevant `thread`
and `offlineHistory` definitions are byte-identical between the original
continuous app and final M7 source; app `API.md` is also unchanged.

`thread` returns `{ messages: page messageView, members: ... }`. Installed
0.0.19 explicitly documents that such an object has no root continuation.
The app API instructions nevertheless promise newest-to-older pagination and
tell callers to stop at null `next`. The root-page `offlineHistory` query
returns all 42 rows and retains every starter ID. The problem is the app's
composition and documentation, not `last 20` itself, migration data loss or an
established engine cursor-contract violation.

Provide and document a supported history-page path, then prove more than
20 rows using opaque continuation. Preserve the authorization distinction:
`thread` permits members; `offlineHistory` requires active members. Do not
replace one with the other without preserving the intended retained-history
policy. This follow-up is separate from the repaired conditional root-page
cursor issue and from native/twin partial-replay parity.


2026-09-09 guide resolution: `guide migrations`, `guide successor`, and
`guide migration` now serve the same focused card. It explicitly warns about
maintain regrouping and destructive enum evolution, and gives the additive
optional-column/backfill/narrowing path with immutable total job keys, planning,
resumption and stored-value verification. The stale “job once J1b lands”
rewrite now names the implemented bounded job and `--wait`. This addresses
items 4–5's documentation; the separate list/shape/completeness and app-level
pagination work is not closed by this change.

## 2026-09-10 — LLP 1020 A7 reproductions (lane `cost`)

Item 2 reproduced: the refusing `#pollTallies[...]` spelling parsed as an aggregate (a
structural count) on 0.0.19; since LLP 1011 B2 a maintained point read is a `Get` and the same
shape admits. Only a structural sink (`count(page)`) over a capped-only page refuses
`E_STRUCTURAL_COUNT` — `issues/20260910-snapback2-m7-poll-shape-capped-authority.md`, test
`snapback2/crates/snapback2/tests/check_cost.rs::m7_poll_tally_reproduction_records_capped_only_refusal`.

The bulk-job `E_STEPS` reproduced on the chat template: every `update messages[...]` was charged
the full `wordPrefixes(body)` re-derivation (945,153 steps per row; a 100-row chunk priced
94,517,328 against the 1,000,000 ceiling) whatever the patch wrote. An update now re-derives,
and is priced, only when its patch writes a column the search index reads
(`engine/index.rs::reindex_replaced_row`, `certificate/search.rs`; LLP 1001); a `body`
rewrite still needs `first 1` per chunk — test
`check_cost.rs::m7_bulk_job_prices_derivation_only_for_patches_that_write_a_derived_column`.

## 2026-09-11 triage

**Priority:** P3. **Disposition:** Resolved as a reconciled composite; no current M7
blocking defect was reproduced, but substantive language/policy scope remains.

- Item 1 remains: current direct Quarry can iterate bounded values but has no
  positional list indexing or page-to-list projection. See the still-open
  `20260904-quarry-no-list-from-range.md`.
- Item 2 is resolved by the current maintained `Get` spelling and
  `check_cost.rs::m7_poll_tally_reproduction_records_capped_only_refusal`;
  structural `count(page)` remains intentionally refused.
- Item 3 is not resolved by a group cap. LLP 1020 A7 and
  `20260910-snapback2-m7-poll-shape-capped-authority.md` preserve the author's
  confirmation condition; no completeness-policy change is authorized here.
- Items 4–5 remain resolved by the 2026-09-09 successor/migrations guide and
  the current packaged `guide successor` card.
- The historical nested-page statement is stale at the engine/compiler
  contract: commits `02c1250c5` and `52ab67e2a` support one cursor-bearing page
  through a returned record, and `quarry-chat-composition-checks.ts` asserts
  that the shipped chat view has exactly one certified result page. The
  packaged `guide pagination` says that page supplies root `next`. Proving the
  app's authorization-specific history route beyond 20 rows, and item 6's
  client-arm UI behavior, remain outside this compiler/evolution triage.
- The bulk-job false re-derivation charge remains resolved by `ff23a9326` and
  its named `check_cost.rs` regression; a body rewrite still honestly needs a
  smaller chunk.

**Remaining acceptance:** decide and implement or explicitly decline list
indexing/projection; obtain the author ruling for cap-equals-bound envelope
state; separately adjudicate the app/client-arm items. Close this composite
only when those surviving scopes are split or resolved.

## Resolution — 2026-09-11

The surviving language and policy choices are now explicit. LLP 1001 defers
positional indexing and page-to-list projection; the obsolete motivating
recipient list is owned by derived delivery custody. LLP 1020 A7 records the
delegated no-exception ruling for cap-equals-bound, preserving capped state and
absence authority. Items 2, 4, 5, and the bulk-job charge already have the
named regressions above. Authorization-specific paginated-history and UI-arm
coverage remain independently tracked by the custody/client tickets rather
than keeping this compiler/evolution composite open.
