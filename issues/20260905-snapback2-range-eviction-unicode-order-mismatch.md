# P2 Snapback 2: range eviction compares strings in UTF-16 order

**Status:** Open
**Priority:** P2
**Systems:** client range-store index extent comparison
**Date:** 2026-09-05
**Source:** Codex local-data review; reproduced/inspected at `23e89b4a17fecb713b7ca61681cf6f4f969c8536` (product tree equal to locally tracked origin/main `11e2e60984e756128aa0091b4c6c36ff82094ecb`).
**Related:** LLP 1012 §5 (fresh uniform range extent), LLP 1001 value-order parity

## Problem

`snapback2/packages/snapback2/src/store/range-store.ts:478–485`
uses JavaScript string comparison for wire values. The engine/evaluator
use Unicode scalar ordering. The difference can evict a row outside the
fresh range's authoritative extent.

## Reproduction

Use an ascending `byName` index on `[name, id]`, empty prefix,
and take 2:

1. Hold x with `name: "\\u{10000}"` as the sole row of an exhausted page.
   Also hold x through another query.
2. Deliver a new limited page at the same site/prefix/rule with:
   a named U+9000 and b named U+E000.
3. Read the other query holding x.

Under engine ordering, U+10000 is beyond U+E000 and outside the fresh limited
extent. Observed: x is globally evicted; the other answer becomes
`partial/evicted` with `data: [null]`.

The actual reproduction uses those Unicode characters, not the literal
backslash escape strings.

## Resolution and acceptance

Reuse the evaluator's typed value comparator for eviction, including index
tuple comparison. Verify the supplementary-character example preserves x.
Check Bytes and optional index values for parity as part of the repair;
those additional types are not confirmed defects in this review.

## Review qualification

The package was rebuilt before verification. Existing selected client/carrier
suites passed 251/251 and Rust offline/replay/retention tests passed 37/37.
The new review reproductions expose gaps in that coverage. This ticket is
self-contained; temporary review artifacts are not required to implement it.
