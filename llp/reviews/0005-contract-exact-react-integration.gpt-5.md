# Review: LLP 0005 - Contract/Exact and React integration

**Reviewed:** `llp/0005-contract-exact-react-integration.explainer.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local Snapback and selected local Exact repo docs.
**Method:** Single-session read-and-critique with current Exact README/AGENTS
used only as external context; targeted revisions applied.

## Overall assessment

The explainer has the right shape: Contract/Exact gets the richest path, React
and Expo remain real consumers, and the shared headless contract prevents a
private backend. The revision adds current Exact context and a core-vs-adapter
promotion rule, which makes "Contract/Exact first" more actionable.

## Strengths

- The adapter is treated as product, not copied demo glue.
- Design Mode is an authoring and inspection layer over durable Snapback files.
- React/Expo support is used as a test that the contract is actually headless.

## Concerns

- **C1 - Canonical Contract/Exact definition is still owed. [High]** The current
  Exact repo narrows the gap, but Snapback should not become the definition's
  source of truth.
- **C2 - First adapter could be deferred too long. [Medium-High]** Without a
  real generated bridge, every claim here remains aspirational.
- **C3 - Core promotion must be enforced. [Medium]** The new rule helps, but
  implementation reviews should check it whenever Contract-specific needs arise.

## Suggestions

- Make the first Contract/Exact fixture in LLP 0010 the forcing function.
- Use React as a sentinel: if React needs private backend semantics, the
  headless contract is not real.

## Open questions

- What stable Exact authority should Snapback cite?
- Which adapter ships first, and what minimal generated package proves it?

## Recommended next step

Keep `Draft`. Next: supply the stable Contract/Exact citation and build one
generated adapter over the LLP 0012 artifacts.
