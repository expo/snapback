# Review: LLP 0007 - Storage portability contract

**Reviewed:** `llp/0007-storage-portability.spec.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local repo artifacts only.
**Method:** Single-session read-and-critique against LLP 0004, 0006, 0008, and
0010.

## Overall assessment

This is a strong portability spec. It correctly broadens portability beyond
SQLite vs Postgres to include local optimistic execution vs server execution,
physical type mapping, versioning, atomic changesets, and conformance tests.

## Strengths

- One commit version per mutation is load-bearing and clearly stated.
- Query semantics, null behavior, and no silent fallback are treated as product
  contracts.
- Export/import is named as a logical portability contract distinct from backup.

## Concerns

- **C1 - Atomic cross-engine import is a large hidden project. [High]** It is
  correctly identified but not yet decomposed.
- **C2 - Exact decimal/id/cursor choices are still open. [Medium-High]** These
  choices affect the finance app, indexes, replay, and client types.
- **C3 - Cross-engine conformance can be delayed under pressure. [Medium]** LLP
  0010 must make the matrix a gate, not a nice-to-have.

## Suggestions

- Choose `_id`, timestamp precision, and decimal encoding before generated
  client APIs become sticky.
- Build the conformance corpus as product artifacts, not storage-unit tests only.

## Open questions

- What is the minimum Postgres adapter needed to falsify the portability contract?
- What is the first atomic logical import story?

## Recommended next step

Keep `Draft`. Next: pin id/timestamp/decimal/cursor choices and create the first
cross-engine conformance cases.
