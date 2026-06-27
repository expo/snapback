# Review: LLP 0006 — Valet retrospective

**Reviewed:** `llp/0006-valet-retrospective.research.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against in-repo documents and the Valet
repository on the same machine (`~/projects/valet`); no document content was sent
to any external provider beyond the model serving this Claude Code session.
**Method:** Single-session, independent read-and-critique, **plus** a first-hand
recovery pass: I read all 12 Valet experience diaries and ~30 Valet LLP documents
(including the implementation-status guide) and folded confirmed findings into the
document. This review was requested together with an explicit instruction to
"revise to make them better," so unlike a pure review it **applied** substantial
content, documented below.

> **Independence (LLP 0005 process).** This session did **not** author the draft —
> it was drafted by Charlie Cheever / Codex (a GPT-family agent). A Claude review
> is therefore genuinely cross-family. The recovered findings are grounded in
> recoverable artifacts (the diaries and the Valet corpus), which this document's
> own provenance rules already admit as `[confirmed]`/`[observed]` evidence — not
> in this session's invention. Findings the diaries/corpus do not support are left
> as open questions.

## Overall assessment

The draft was a **well-built research *plan* with no findings** — and it said so
honestly ("It deliberately does not invent first-hand facts. Until Charlie or
another person who worked with Valet confirms what broke, every failure below is a
candidate investigation area"). The problem was that the evidence already existed
and was admissible under the document's *own* provenance rules, which explicitly
count "a recoverable artifact such as a demo diary, issue, trace, benchmark, log,
or commit" as first-hand. Valet's repo holds exactly that: 12 experience diaries
and a 50KB implementation-status guide recording what shipped, what broke, and what
was reversed. The single highest-value action for this document was to *mine the
evidence it was waiting for*, and that is what this revision does.

The revised document now carries a `Confirmed findings (diaries)` section (~14
findings) and a `Findings from the Valet LLP corpus` section (~10 findings), each
tagged with provenance and pinned to the subsystem LLP that must absorb it, with
the genuinely production-scale unknowns kept open and honestly scoped. The finding
template, the provenance-tag discipline, and the "promote constraints into the
owning LLP" instruction were all already right — they just needed to be exercised.

## Strengths (of the draft as received)

- **The finding template and provenance tags** (`[confirmed]`/`[observed]`/
  `[inferred]`/`[unconfirmed]`) are the correct scaffolding and made the recovery
  mechanical rather than improvised.
- **Honest about being empty.** The draft did not fabricate findings to look
  finished; it named the gap precisely. That is the right failure mode, and it is
  why the recovery could slot in cleanly.
- **The investigation areas were the right partition** — storage/write-contention,
  realtime, sync, runtime/isolation, schema-codegen-feedback, deployment — and the
  diaries/corpus mapped onto them with almost no friction.

## Concerns

- **C1 — The available first-hand evidence was never mined, leaving the corpus's
  highest-priority input unrecovered. [High]** The diaries and Valet LLPs sat one
  directory over and are admissible under this doc's own rules. *Resolves when:* the
  findings are recovered and promoted. **Applied** — both findings passes added; the
  per-finding "LLPs to update" pointers are now reflected in the 0007–0012
  revisions.
- **C2 — Several "Initial Hypotheses To Validate" were already answerable. [Medium]**
  E.g. "silent schema/codegen failures are more dangerous than crashes" (confirmed
  by the kanban field-drop), "auth/sync/realtime can't be debugged as separate
  layers" (confirmed by the multiplayer diaries). *Resolves when:* resolved
  hypotheses move to findings. **Applied** — the hypotheses section now marks each
  resolved/partly-resolved/open.
- **C3 — Without scoping, diary evidence could be over-read as production proof.
  [Medium]** The diaries are demo-scale, single-session, point-in-time. They prove
  correctness/DX failures, not load behavior. *Resolves when:* the doc states the
  caveat and keeps production-scale questions open. **Applied** — two scoping
  caveats in the Summary; the open questions now isolate the single-writer breaking
  point, the fan-out ceiling, and atomic cross-engine import as the true unknowns.
- **C4 — A few corpus findings *contradict* sibling docs and must be surfaced, not
  smoothed. [Medium]** The Ibex/Hermes watchdog being a no-op (vs. 0009's "enforce
  wall-clock timeout"), and the per-row version trigger (vs. 0007's "one version per
  changeset"). *Resolves when:* contradictions are stated as such and routed to the
  owning LLP. **Applied** — both are called out in 0006 and corrected in 0009/0007.

## Suggestions (non-blocking)

- When a Valet primary source beyond the diaries surfaces (issues, traces,
  benchmark notes), add it under the corpus heading with its own provenance.
- The production-scale open questions are the natural backlog for the first
  Snapback prototype benchmark; LLP 0010's acceptance suite should adopt Valet's
  measured baselines (now cited in 0008) as starting targets.

## Open questions (for the author)

- Are there Valet benchmark/trace artifacts beyond the diaries and LLPs worth
  summarizing here?
- Which production-scale finding should the first prototype benchmark target first
  — the single-writer breaking point or the fan-out ceiling?

## Recommended next step

*Proposed only — the author decides; this review changes no `**Status:**`.*

1. **Status stays `Draft`.** I did not change it. The doc should stay Draft until a
   Snapback prototype answers the production-scale questions; the recovered findings
   are already strong enough to constrain v1.
2. **Charlie reviews the recovered findings** for any first-hand correction —
   diaries are "allowed to be opinionated and wrong," so a human who ran Valet may
   adjust severity or add what the artifacts missed.
3. **The promoted constraints now live in 0007–0012**; confirm the cross-references
   read correctly.
4. **A second non-author family** is optional at Research/`Draft`; on request I can
   prepare the standard prompt but will not run it externally or record an
   unproduced review without an explicit human action.
