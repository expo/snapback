# Review: LLP 0001 Prior Art and Influences, Round 1

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `llp/0001-prior-art.research.md`

## Overall Assessment

This is a useful Research LLP and should stay `Draft`. It gives Snapback a
working comparison set and extracts the right kinds of lessons: reactive query
sync, authorization-aware partial sync, code-next-to-data, scale-to-zero
economics, schema branching, and open relational portability.

The main problem is evidentiary. The document is generated research about
fast-moving products. It is good as a map of hypotheses, but not yet good as a
source of settled facts.

## Strengths

- Valet is correctly treated as the highest-value unknown rather than handwaved
  as history.
- The synthesis themes are directly actionable for storage, sync, realtime,
  migrations, and agent DX follow-on LLPs.
- The document distinguishes `[observed]` from `[inferred]`, which keeps claims
  from reading as decisions.
- It makes the query-result sync versus event-log sync fork visible early.

## Concerns

1. **Current product claims are not verified.** Product details around Zero,
   LiveStore, PlanetScale, Neon, Supabase, Convex, and hosted free tiers can
   change quickly. This document should not harden without primary-source
   verification.

2. **`[observed]` currently sounds stronger than the evidence supports.** The
   document says these are not fresh citations, but the tag can still read as
   factual confirmation. It should be explicitly framed as generated observation
   pending verification.

3. **Valet findings are the gating input but are still empty.** That is fine for
   a draft, but the corpus should not build too much architecture before those
   failures are recovered.

4. **There are no primary-source links for non-Valet systems.** The `Related`
   field only points to LLP 0000 and Valet. A later revision should add links or
   per-system citations.

## Suggestions

- Keep `Status: Draft`.
- Add a stronger source-gap note and make `[observed]` less authoritative.
- Replace ad hoc tags like `[confirmed-needed]` with normal provenance language.
- Add primary-source verification as a required next step before promotion.

## Open Questions

- What exactly broke in Valet?
- Which prior-art systems are closest enough to deserve deeper LLPs of their
  own?
- Should Snapback choose query-result sync, event-log sync, or a hybrid?
- Which external system is the best reference for agent-checkable migrations?

## Revisions Applied

- Tightened the provenance language around generated/unverified observations.
- Replaced the custom `[confirmed-needed]` tag with ordinary provenance wording.
- Added a primary-source verification next step.

The LLP process also recommends a GPT review unless this Codex review is the GPT
review wanted for this round.
