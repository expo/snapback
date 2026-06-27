# Review: LLP 0000 Snapback, Round 3

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `llp/0000-snapback.explainer.md`

## Overall Assessment

LLP 0000 remains a good active root document. It is clear about Snapback's
direction, implementation order, first standard target, reference workloads, and
known gaps. The newer LLPs 0003 and 0004 make the root stronger because the
first implementation slice is now split into a server/process architecture and
an app-facing data API.

## Strengths

- The root thesis is coherent: a complete, open backend that scales to zero,
  then scales up.
- The document continues to distinguish high-level direction from subsystem
  contracts that need their own LLPs.
- The reference app and non-goal lists give useful bounds to otherwise broad
  claims.
- The implementation order is now actionable enough to guide the next code work.

## Concerns

1. Contract/Exact remains an explicit terminology gap. That is honest, but it
   is still the largest missing definition for agent orientation.
2. Scale-to-zero and the SQLite/Ibex scale target still need measurable
   workload and billing envelopes.
3. Security and tenant isolation are correctly called out, but implementation
   should not start executing user code without treating this as load-bearing.
4. The root document is broad. Keep routing details into follow-on LLPs rather
   than expanding 0000 further.

## Suggestions

- Keep `Status: Active`.
- Add the Contract/Exact canonical definition as soon as the ratifying source
  supplies it.
- Let LLP 0003 and LLP 0004 govern first-slice implementation details.
- Prioritize security/isolation and local-first sync follow-ons once the local
  core/API prototype exists.

## Open Questions

- What exact document defines Contract/Exact and Exact Design Mode?
- Which reference apps are launch acceptance targets versus later stress tests?
- What concrete workload envelope proves the SQLite plus Ibex target?
- What sandbox/tenancy model governs executed JavaScript?

## Revisions Applied

- Linked the first implementation step directly to LLP 0003 and LLP 0004 so the
  root points to the current architecture spine.

The LLP process also recommends a GPT review unless this Codex review is the GPT
review wanted for this round.
