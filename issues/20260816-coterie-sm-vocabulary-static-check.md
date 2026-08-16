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
stage can reuse a frozen ID on a structurally incompatible element, state, or
value space without any affected-scope failure. IDs absent from the frozen
vocabulary are valid extensions under the authority's explicit "extras
allowed" rule; they are not errors merely because the shared choreography does
not consume them.

## Closure wanted

Add a deterministic Coterie check that extracts literal uses of the frozen
`sm-*` IDs defined by `benchmarks/tools/social-messenger/CONTRACT.md` and gates
only misuse of those IDs according to the authority's element, state, and value
space definitions. Check the structural rules that can be decided without
runtime choreography, including Trending rows composing feed cards, each chat
color/disappearing option exposing its pinned value and selected state, and
file-chooser IDs appearing only on real chooser controls. Register the check in
`verify:coterie` and pin failing fixtures for semantically misapplied frozen
IDs.

Unknown `sm-*` IDs must pass: they are extensions, not vocabulary violations.
That includes Coterie-local additions such as `sm-auth-form` and
`sm-feed-author`. The check may report extensions for information, but it must
not fail them or treat the authority as a closed allowlist.
