# Coterie lacks a static check for frozen social-messenger test-ID semantics

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Benchmarks, Contract,
Demos, Testing

**Related:** LLP 0266; LLP 0201; Diary 0086;
`benchmarks/tools/social-messenger/CONTRACT.md`

## Problem

Coterie's round-1 review found several `sm-*` identifiers attached to the
wrong semantics: a generic search error labeled offline, topic chips labeled
Trending rows, a static background preview labeled as a chooser, and controls
with the wrong option value space. Contract compilation verifies that IDs
exist, but it does not compare their vocabulary or structural obligations with
the frozen social-messenger contract.

The immediate misuses were corrected manually. Without a static check, a later
stage can reintroduce an unknown ID or reuse a frozen ID on a structurally
incompatible control without any affected-scope failure.

## Closure wanted

Add a deterministic Coterie check that extracts literal `sm-*` IDs from
`.contract` sources and compares them with the allowed vocabulary in
`benchmarks/tools/social-messenger/CONTRACT.md`. Extend it with the structural
rules that can be checked without runtime choreography, including Trending
rows composing feed cards, each chat color/disappearing option exposing its
pinned value and selected state, and file-chooser IDs appearing only on real
chooser controls. Register the check in `verify:coterie` and pin failing
fixtures for unknown and semantically misapplied IDs.
