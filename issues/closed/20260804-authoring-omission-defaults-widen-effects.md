# Authoring omission defaults widen authority and destructive scope

**Status:** Closed
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Codegen, Auth, Search, Vector search, Mutations, Jobs, Agent authoring
**Date:** 2026-08-04
**Governing:** LLP 0024, LLP 0065, LLP 0070, LLP 0073, LLP 0132, LLP 0146

## Problem

Several author-facing omissions choose the broadest or least-resilient
behavior instead of requiring an affirmative decision:

- function `auth` omitted → `optional-user`;
- search-index `visibility` omitted → `public-read`;
- vector-index `visibility` omitted → `public-read`;
- `deleteWhere(table)` filter omitted → empty filter → clear the table;
- job `maxAttempts` omitted → `1`.

The runtime/codegen enforces each resolved value, but nothing enforces that the
author intentionally chose it. For an agent, omission is the most likely path,
so these defaults push toward anonymous access, maximum deletion scope, or
terminal first-failure behavior.

## Proposed fix

Audit each omission separately rather than applying one compatibility-breaking
flip blindly:

1. Require explicit `auth` on newly generated functions; preserve legacy
   artifact decoding behind an explicit compatibility version.
2. Require explicit search/vector visibility. Public release should always be
   spelled `{ kind: 'public-read' }`.
3. Replace omitted `deleteWhere` filter with a codegen error; make whole-table
   deletion an explicit `allRows()`/`clearTable()` operation.
4. Require an explicit retry policy for jobs, or choose and publish a bounded
   resilient default with an observable ledger reason.

Generated review artifacts should record whether a value was authored or
defaulted, so inspect/verify can identify compatibility-era omissions.

## Acceptance

For every omission, a generated scratch app either fails at codegen with a
stable repair diagnostic or emits a review artifact proving the safe resolved
choice. No omitted field may silently widen authority or destructive scope.

## Resolution (2026-08-05)

The audit's five findings were separated by their governing decisions rather
than changed as one compatibility break:

- Search-index visibility is now required in JavaScript and TypeScript
  authoring. Omission refuses direct evaluation and scratch-app generation
  with `SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED`; intentional public release
  is spelled `{ kind: 'public-read' }`.
- Vector-index visibility has the same required authoring contract and refuses
  omission with `SNAPBACK_VECTOR_INDEX_VISIBILITY_REQUIRED`.
- `deleteWhere(table, filter)` now requires its second argument and refuses
  omission with `SNAPBACK_DELETE_WHERE_FILTER_REQUIRED`. The existing
  `deleteWhere(table, [])` shape remains the explicit clear-table IR; a new
  alias is unnecessary because the destructive scope is no longer inferred.
- Function-auth omission is not changed here. LLP 0172 defines the staged
  compatibility/error policy and LLP 0173 defines its review projection; both
  remain in **Review**, so implementation is handed to those RFCs after
  acceptance rather than preempting their decision.
- Job `maxAttempts: 1` is an intentional, published bounded-work default under
  LLP 0070's paved queue decision and the Jobs Guide, not an accidental
  authority widening. Authors can explicitly choose 1..8; no change is made.

Focused tests cover the three stable omission diagnostics at both direct
builder and isolated scratch-codegen boundaries, preserve pre-existing output
on refusal, assert the explicit empty-filter IR, and pin the required
TypeScript arguments. Because the changed omissions now fail before artifacts
exist, provenance fields for those absent values would be unreachable; auth
provenance remains LLP 0173's scope.
