# Review: LLP 0001 - Prior art and influences

**Reviewed:** `llp/0001-prior-art.research.md` (working-tree revision)
**Family:** GPT-5 (OpenAI)
**Provider/runtime:** OpenAI API via Codex
**Date:** 2026-06-25
**Redacted:** No - reviewed local repo artifacts only.
**Method:** Single-session read-and-critique against the full Snapback corpus and
LLP 0006 Valet recovery; targeted revisions applied.

## Overall assessment

This is a useful map of influences, but it should stay Draft. The biggest fix was
to stop treating Valet as unrecovered: LLP 0006 now owns the evidence. The rest
of the document is still generated prior-art analysis and needs primary-source
verification before hardening into decisions.

## Strengths

- Good taxonomy: sync engines, backend platforms, serverless databases,
  run-your-code platforms, and Rails.
- The synthesis identifies the right convergences: query sync, auth in sync,
  code-next-to-data, migration DX, and open relational portability.
- Provenance labels make the confidence level explicit.

## Concerns

- **C1 - Non-Valet facts are temporally unstable. [High]** Product APIs, pricing,
  free tiers, and roadmaps change. These cannot be treated as current facts until
  checked against primary sources.
- **C2 - Valet evidence should not be duplicated here. [Medium]** The revision
  correctly points to LLP 0006; future edits should avoid re-copying the findings
  and drifting them.

## Suggestions

- Add source links and dates for each non-Valet system before moving beyond Draft.
- Use this document for influence, not requirements; promote requirements into
  subsystem LLPs.

## Open questions

- Which external system deserves the next deep primary-source pass: Convex,
  Zero, LiveStore, Supabase, or Neon?

## Recommended next step

Status should stay `Draft`. Next useful work is a cited, current primary-source
verification pass for the non-Valet systems.
