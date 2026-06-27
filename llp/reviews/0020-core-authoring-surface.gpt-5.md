# Review: LLP 0020 - Core authoring surface buildout

**Reviewed:** `llp/0020-core-authoring-surface.plan.md` (working-tree revision after the existing Claude review revisions; this pass applied the edits marked **[Applied]** below)
**Reviewer family:** GPT-5 / Codex (OpenAI)
**Provider / runtime:** Codex in this repository
**Date:** 2026-06-27
**Redacted:** No - reviewed local repository files only; no additional external reviewer was invoked.
**Method:** Same-family critical pass. Read the full 0020 plan, the existing Claude review artifact, the local LLP 0005 review guide, and targeted source sections in LLP 0003, 0004, 0008, 0009, 0010, 0012, and 0016.

> **Independence note.** 0020's author line includes Codex, so this is not a
> second cross-family review. It is a real GPT-family review artifact, but it
> should be treated as an author-side/same-family critical pass. The existing
> Claude artifact remains the independent cross-family review for LLP 0005
> purposes. This pass also edited the document, so it is not independent of the
> final revised text.

## Overall assessment

After the Claude pass, LLP 0020 is already a strong implementation Plan. It
does the important planning work: it turns the todo diary's negative findings
into sequenced gates, keeps subsystem specs authoritative for mechanics, and
uses capability reporting as an acceptance condition rather than an afterthought.
The strongest idea is the shared read-dependency substrate spanning static
function manifests, mutation isolation, and realtime matching.

I found no reason to change `**Status:**`; it should remain `Draft`. The
remaining risk is not the content of 0020 so much as corpus shape: LLP 0016 and
0020 still overlap enough that future agents could update the wrong source of
truth. That cross-document cleanup is still the highest-value follow-up, but I
left it out of this pass because the user asked to review 0020.

## Strengths

- **Acceptance gates are concrete.** Each phase has observable proof: a
  diagnostic fires, a capability gap clears, stale work is rejected, or a demo
  consumes generated artifacts.
- **Capability honesty stays load-bearing.** The Plan keeps missing features
  visible as structured facts instead of letting demos infer capabilities from
  working happy paths.
- **The one-substrate read-dependency framing is right.** 0003, 0008, and 0012
  point toward the same dependency facts; 0020 now makes that an implementation
  constraint instead of accidental duplication.
- **The security envelope is preserved while ergonomics improve.** Phase 2 asks
  for real `ctx.db` handlers without weakening the no-ambient-access and
  invocation-isolation guarantees in LLP 0009.
- **The demo admission rule gives agents a useful tripwire.** A demo can still
  run early, but it has to name the scaffolding it depends on.

## Concerns

- **C1 - Phase 1 could not fully close its read-summary gate before Phase 2.
  [Medium] [Applied]** The Plan said Phase 1 could land in parallel with Phase
  2, while Phase 1 also generated a static read-set / primary-table summary
  "validated against the handler body." That validation needs real handler
  bodies and the bundler/loader work from Phase 2. Resolved by clarifying that
  Phase 1 can start in parallel, and can type the manifest field from the first
  generated package, but the JavaScript handler-body validation gate cannot fully
  close until Phase 2 provides analyzable handler bodies.

- **C2 - The demo admission rule was easy to read as a third authority.
  [Medium] [Applied]** LLP 0010 owns acceptance, LLP 0016 owns the umbrella demo
  ladder, and 0020 had its own demo rule. They do not contradict, but agents
  could treat them as competing checklists. Resolved by naming 0020's rule as the
  core-specific specialization of LLP 0016's admission rule.

- **C3 - The title under-described the work. [Low] [Applied]** "Hardening"
  undersold Phases 1 and 2, which are net-new product buildout: typed generated
  artifacts and real JavaScript handlers. Resolved by changing the H1 to "Core
  authoring surface buildout." The filename did not need to change.

- **C4 - Related/open-question metadata under-cited demo and adapter coupling.
  [Low] [Applied]** The plan talks about demo claims and admission but omitted
  LLP 0015 from `Related`. It also asked for a single artifact schema source of
  truth without naming the `ContractDataManifest` ownership question that LLP
  0016 says blocks the broader Phase 1/3 gates. Resolved by adding LLP 0015 and
  extending Open Question 1 to ask whether the shared source owns the Contract
  data manifest or only the LLP 0012 core manifests.

- **C5 - LLP 0016 still needs the real cleanup. [High] [Proposed]** 0020 now
  says it owns authoritative core gates, but LLP 0016 still contains parallel
  phase text and different phase numbering. This is manageable while both docs
  are fresh, but it is a predictable drift source. Resolution would be to slim
  LLP 0016 into an index/umbrella that links to 0020 for core gates and 0021 for
  adapter gates.

## Suggestions

- Keep `Status: Draft` until the source-of-truth schema and Phase 1/Phase 2
  boundary are settled in implementation.
- When implementing the read-dependency work, define the shared dependency
  summary shape first. The static analyzer and runtime capture may run at
  different times, but they should not invent separate vocabularies for tables,
  ranges, predicates, row ids, and auth facts.
- Treat any future `HANDLER_*` diagnostic family as an LLP 0012 schema update,
  not just an implementation detail in Phase 2.

## Recommended next step

Status should stay `Draft`. The plan is good enough to guide the next core work,
but the corpus will be easier to maintain if LLP 0016 is slimmed before several
agents start implementing from both documents.
