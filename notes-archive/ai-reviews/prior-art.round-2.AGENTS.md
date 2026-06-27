# Review: LLP 0001 Prior Art and Influences, Round 2

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `llp/0001-prior-art.research.md`

## Overall Assessment

LLP 0001 is useful and should remain `Draft`. It is acting correctly as a map of
hypotheses and influences, not as a settled factual survey. Its most valuable
role is to keep Valet's unrecovered failures visible while showing why Snapback
leans toward function-first APIs, query-driven sync, authorization-aware
subscriptions, SQLite/Postgres portability, and agent-checkable migrations.

## Strengths

- The confidence/provenance framing prevents generated research from reading as
  ratified fact.
- Valet remains treated as the highest-value unknown.
- The synthesis feeds directly into LLP 0003 and LLP 0004 without pretending the
  public-product claims are verified.
- The open questions are still the right ones for storage, sync, realtime, and
  authorization.

## Concerns

1. Public-product details are unverified and time-sensitive. This must not move
   beyond `Draft` without primary-source verification.
2. LLP 0003 and LLP 0004 now consume the research, so any later correction to a
   premise may require revisiting those docs.
3. Valet's concrete failure modes remain missing. That is the biggest empirical
   risk in the corpus.

## Suggestions

- Keep `Status: Draft`.
- Add primary-source citations before promotion.
- Recover Valet failures before treating the trigger/polling pipeline or
  runtime/server shape as hardened architecture.

## Open Questions

- Which Valet problems were fundamental versus implementation-specific?
- Which prior-art systems deserve deep primary-source research next?
- Is query-result sync the likely baseline, or should event-log sync remain
  competitive longer?

## Revisions Applied

- Updated Next steps to note that LLP 0003 and LLP 0004 already consume this
  research at a draft level and should be revisited when Valet failures or
  public-source verification change the premises.

The LLP process also recommends a GPT review unless this Codex review is the GPT
review wanted for this round.
