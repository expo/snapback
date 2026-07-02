# Review: LLP 0032 - Decision and implementation hardening program

**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-07-02
**Redacted:** No - reviewed local repository files and the in-repo LLP corpus; no separate external reviewer or provider was invoked.
**Method:** Review requested as `$llp-review 0032 don't revise just review for now`. Read the full LLP 0032 draft, LLP 0005 review guidance, LLP 0000, and existing GPT-family review artifact style. This review did not independently re-run the whole-repo architecture survey or verify every source-code citation in LLP 0032.

> **Independence note.** LLP 0032 is authored by Charlie Cheever / Claude (Fable 5), and this GPT/Codex session did not author the draft. This is an independent GPT-family review of the Claude-authored draft. It is not a cross-family loop by itself, and no external provider was invoked.

## Overall assessment

LLP 0032 is a strong and useful plan. It does the most important thing a hardening program should do: it turns a broad architecture review into greppable work items with done-whens, named decisions, ownership hints, and an explicit test-debt register. The plan is also appropriately honest about the system's current state. It does not pretend that shipped code, ratified semantics, generated artifacts, and demos are already aligned.

The main issue is not direction; it is control. The plan is so comprehensive that it risks becoming both the emergency security punch list and the entire product-roadmap correction program. That can work, but only if the gating rules are sharper. A few items that should be immediate safety or corpus-honesty patches are nested inside broader phases, while several strategic decisions appear in the docket without clearly determining whether they gate program completion. I would keep the plan in Draft until those execution boundaries are tightened.

## Strengths

- **Good durable synthesis.** The plan captures scattered defects, stale LLP status, missing decisions, product-boundary gaps, and measurement needs in one durable artifact rather than leaving them in a conversation transcript.
- **Good step vocabulary.** Stable ids such as `S5.D4`, `E2`, `P3`, and `DK-1` make the program executable by agents and easy to reference in commits, tests, and follow-up LLP revisions.
- **Correct prioritization of corpus truth.** Phase 0 recognizes that wrong LLP status and stale semantics create agent failures, not just documentation debt.
- **Good distinction between defects and decisions.** The confidence tags and decision docket help keep confirmed bugs out of design debates, while routing policy choices through owner documents.
- **Strong done-whens.** Most steps have checkable outcomes: regression tests, route registry coverage, generated artifact gates, inspect counters, benchmarks, or ledger entries.
- **Appropriate measurement posture.** M1 correctly refuses to settle VM lifecycle, fan-out, matcher cost, and validation strategy by intuition alone.

## Concerns

- **G1 - Urgent safety fixes are bundled with larger taxonomy work. [High]** Phase 1 correctly identifies live destructive-route and session-authority holes, but S1 asks for the full LLP 0031 D1-D5 route-registry program before the root `/admin/*` problem is closed. If the motivating hole is live, the first executable safety step should be smaller: immediately gate or remove destructive root aliases under the same admin policy as their system equivalents, then continue with the registry, public inspect trim, WebSocket classification, and alias retirement. What would resolve this: add a first substep or separate S0 that closes the destructive-route exposure with a regression test before the broader route-taxonomy migration.

- **G2 - The corpus-honesty patch for read/write semantics is sequenced too late. [High]** Phase 0 says the corpus must match reality first, but the most load-bearing overclaim - snapshot reads, read-your-writes buffered `ctx.db`, and read-set validation - is deferred to Phase 2 E1. That means an agent executing Phase 0 or Phase 1 can still read ratified-but-false semantics in LLP 0003/0004/0007. What would resolve this: move the immediate "current semantics" doc-honesty patch from E1 into Phase 0, leaving the implementation-up work in Phase 2.

- **G3 - Ratification authority is still an open question even though R1 requires status changes. [High]** R1 asks agents to promote, demote, or annotate every LLP status and record promotions in the ledger, while the Open questions section says ratification authority and batching are unresolved. Status promotion is not a mechanical audit result; it changes what future agents treat as accepted guidance. What would resolve this: split R1 into mechanical implementation-status annotations versus ratified lifecycle transitions, and require Charlie's explicit ratification before `Draft`/`Review` documents move to `Accepted` or `Implemented`.

- **G4 - The audit evidence is not reproducible enough for a long-lived plan. [Medium-High]** The provenance says citations are anchored to HEAD `4fb5962` plus uncommitted demo changes. That is honest, but brittle: a future executor cannot reconstruct which claims depend on committed code, which depend on the dirty worktree, and which were inferred in the review session. What would resolve this: add a short evidence appendix or companion artifact listing the exact commit, relevant uncommitted diff scope, and any commands or source paths used for each `[confirmed]` register row, or require each step to revalidate its own claim before implementation starts.

- **G5 - Phase 2 and Phase 4 have a hidden dependency cycle. [Medium]** E4 is gated on M1's validation-cost measurement, but Phase 4 is sequenced after L1-L5, while Phase 2 is described as its own phase with a done condition that includes DK-1. That is workable only if Phase 2 is explicitly split into pre-measurement semantics fixes and post-measurement predicate-validation outcome. What would resolve this: mark E4/DK-1 finalization as dependent on M1, or make Phase 2 Done mean "E1-E3/E5-E6 landed, E4 either completed or explicitly deferred pending M1."

- **G6 - Phase 6 is included in the program but not clearly reflected in acceptance. [Medium]** X1-X5 and DK-2/DK-5/DK-9 are important strategic derisking items, but Program acceptance mostly checks Phases 0-5 plus DK-1/DK-3/DK-4. X3 is called out as maybe successor work, but X1, X2, X4, and X5 are less clearly classified. What would resolve this: mark each X item as one of `gates this program`, `gates a named later target`, or `successor program`, and mirror the gating ones in Program acceptance.

- **G7 - The plan may overfit "perfect shape" to one very large epic. [Medium]** The seven end-state properties combine security, semantic correctness, resource lifecycle, benchmarking, packaging, CLI, Contract adapter work, generated artifact CI, and strategic runtime/deployment spikes. That is coherent as a master program, but too large for a single acceptance moment unless there are intermediate release gates. What would resolve this: add phase-level acceptance checkpoints, especially "minimum safe local core" after Phases 0-3 and "product boundary ready for new demos" after P1-P6/P8.

- **G8 - Some done-whens depend on future infrastructure that the same plan has not built yet. [Medium]** Examples: S4 wants setup moved out of browser immediately, but the durable host-ops/CLI path is P6; P3 wants CI gates over generated artifacts while packaging/workspaces are not yet present; L5 wants idle DB/WAL observation tests before the measurement harness exists. These are solvable, but each needs an interim mechanism named in the step. What would resolve this: name the temporary harness or direct-script path allowed before the product package/host-ops/bench infrastructure exists.

## Suggestions

- Add an "Immediate patch lane" before Phase 0/1 with only the few changes that close live safety/corpus-honesty risk: destructive route gating, WebSocket sender binding if trivial, and doc-honesty for current execution semantics.
- Add a rule that every `[analysis]` defect first lands as a reproducing ignored or failing test before implementation, while every `[confirmed]` defect either links to reproducible evidence or is revalidated at step start.
- Keep the decision docket, but add an owner/status column for each DK item: `unratified`, `ratified`, `blocked on measurement`, or `successor`.
- For P5/P6, explicitly choose the first demo that proves the product-boundary change. All Aboard is the obvious candidate, but naming it would make the "do not start new demos before P5" guardrail more enforceable.
- Treat the Test-debt register as a living backlog with blocker tiers. "No open rows" is a useful north star, but without tiers it may block program closure on lower-risk tests discovered along the way.

## Open questions

- Should LLP 0032 define a minimum shippable hardening milestone, or is it intentionally an all-up "perfect shape" master plan?
- Is the author comfortable letting agents make section-level implementation-status annotations before formal ratification, as long as lifecycle status changes remain human-ratified?
- Which Phase 6 items are required before calling the local core hardened: X1, X2, X4, X5, all of them, or none of them?
- Should the dirty-worktree provenance from the original survey be preserved as a review appendix before this plan becomes the execution source of truth?

## Recommended next step

Proposed only; this review does not change `**Status:**`.

Keep LLP 0032 in `Draft`. I would revise the plan before execution begins, primarily to separate immediate safety/corpus-honesty patches from broader taxonomy and product-boundary work, settle ratification authority for R1, and classify Phase 6 items against program acceptance. After that revision, the plan is strong enough to drive a multi-phase hardening program, and it would be worth getting a fresh Claude-family or Gemini-family review focused on whether the adjusted sequencing is still coherent.
