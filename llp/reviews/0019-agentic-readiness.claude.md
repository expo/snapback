# Review: LLP 0019 — Agentic readiness

**Reviewed:** `llp/0019-agentic-readiness.research.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-26
**Redacted:** No — reviewed locally against the in-repo LLP corpus; nothing sent
externally beyond the model serving this session.
**Method:** Single-session read-and-critique, grounded by four delegated readers
that verified 0019's cross-reference claims **term-by-term** against the documents
it surveys — LLP 0010 + 0012 (the F1 operating-surface claims), LLP 0011 + 0009
(auth / identity / actions / isolation), LLP 0003 + 0004 + 0007 (data API,
versioning, determinism, vector type), and LLP 0000 + 0005 + 0013 + 0017 (thesis,
read-set open question, ephemeral limits, admin routes). Roughly thirty discrete
claims were checked; the verdicts drive the concerns below. Requested as
"`/llp-review 0019` revise as appropriate"; this pass **applied** the revisions
marked below.

> **Independence (LLP 0005) — this is the weak case.** 0019's Author line is
> "Charlie Cheever / **Claude**," so a Claude review is **same-family**, not the
> cross-family pass LLP 0005 actually wants. (Contrast LLP 0006, drafted by Codex
> and reviewed by Claude — genuinely cross-family; and LLP 0017, Codex-drafted,
> Claude-reviewed.) This pass also *edited* the document, so it is doubly
> non-independent: it is no longer independent of the revised text either. Treat
> this as an author-side revision-and-self-check, **not** as the independent
> review. **No GPT-5 companion exists for 0019; the multi-family loop is not
> complete**, and a GPT-5 pass matters *more* here than for the cross-family
> reviews because the only critique so far shares the draft's family. (0013 and
> 0016 are in the same missing-companion state.)

## Overall assessment

This is a strong Research document doing exactly what a Research document should:
it frames gaps and options, records per-finding confidence, names the LLP that
should own each implied decision, and **explicitly does not ratify**. Its value as
a survey rests on accurately mapping the corpus, and on that test it holds up
unusually well: of ~30 specific cross-reference claims verified against eleven
source LLPs, the large majority confirmed *exactly*, several by direct quote
(0010's "the exact CLI names are not fixed here" and the shared-result-schema
clause; 0012's pinned per-function manifest fields and `bundleHash`; 0011's
`AuthContext` shape and authorization-epoch model; 0009's Ibex-vs-killable-isolate
threat model and "ask why a handler cannot call a capability"; 0007's single
monotonic commit version and absent vector type; 0000's "the first-class builder
is an AI agent"). Notably, F6's citation of **LLP 0005** for the
read-set / primary-table invalidation open question — which I expected to be a
mis-citation — is *correct*: 0005 §Open questions raises exactly that refresh-key
question. The factual base is sound.

The two strongest analytical moves are both keepers. First, the **build-time agent
vs. runtime AI split** (Summary, F7) is the single most important decision in the
document; conflating those two "agents" would wreck the analysis, and keeping them
separate is what lets F1–F6 stay coherent while F7 stands apart as an unmade
product decision. Second, **F1's recognition that the function manifest already
*is*, in substance, an MCP tool catalog** — and that emitting MCP from it is a
projection, not a parallel surface — is a genuine, near-free insight that the
verification fully supports (0012 pins per-function args validator, kind,
capabilities, auth, read-set/primary-table summary, and `bundleHash`). F1 also
correctly reuses 0012's *pinned* diagnostic schema as the one result schema rather
than inventing a look-alike, which is the right call and keeps "one core, three
projections; don't let MCP become a fourth dialect" honest.

The weak spots are not the thesis but a cluster of **citation and precision slips**
where the survey attributed a fact to the wrong document, mischaracterized a
finalized deliverable as a sketch, or named concrete strings a source does not
define. None of them break a finding, but in a document whose job is to be a
trustworthy map they matter, and all six are corrected below. One genuinely
analytical fix — decoupling vector storage from the actions subsystem in F7 and
the sequencing — improves the recommendation rather than just its accuracy.

## Strengths

- **The two-agents framing** (*Summary*, *Motivation*, F7). "There are two distinct
  'agents'" — build-time operator vs. in-app runtime AI — is named as the single
  biggest analytical error to avoid, and the findings honor it throughout. This is
  the spine of the document.
- **F1 — operating surface as the lead, manifest-as-catalog, one core / three
  projections.** Verified end-to-end: 0010 enumerates the operations and declines
  to fix CLI names; 0012 pins the manifest fields that make each generated function
  a candidate tool and the diagnostic schema that all surfaces share. The
  "control-plane MCP vs. app-data MCP" split, and the insistence that app-data MCP
  is *not itself an authorization model*, are both correct and well-guarded.
- **F6 — "don't redesign the data API, add reflection."** Every praised property
  checks out against 0004: structured predicate DSL over opaque callbacks, immutable
  query builders, explicit `defineLiveQuery` separating syncable from callable, and
  fail-closed codegen with source spans and no silent failures. Correctly resisting
  churn on a well-shaped API is the right instinct, and the one API-design item it
  *does* keep open (read-set / primary-table invalidation metadata) is the one the
  corpus genuinely leaves open.
- **F3 — dry-run as "the missing rung."** Reframing the agent loop from
  optimistic-commit-and-rollback to propose → check → commit is sharp, and the
  implementation discipline ("not a second evaluator") is exactly the constraint
  that keeps dry-run's verdict trustworthy. The buffered-path substrate it needs
  already exists (now correctly attributed to 0003).
- **Confidence discipline.** Per-finding confidence plus a consolidated *Confidence*
  section, and the repeated "to be ratified elsewhere / this names the LLP that
  should own it," keep the document honestly inside Research scope.

## Concerns

Severity is the reviewer's; all six were **applied** in the revise pass and are the
author's to confirm or revert.

- **C1 — F8 mischaracterized a finalized deliverable as a sketch. [Medium]** F8 said
  "Acceptance harness as a first-class deliverable. LLP 0010 *sketches it but does
  not finalize it*." Verification: 0010's *V0 Implementation Charter* **finalizes**
  a v0 acceptance *app* (one todo app that must prove query, mutation, live
  subscription, realtime update, conflict diagnostic, reset, and invalid
  schema/query diagnostics) as a required deliverable — not a sketch. The real,
  still-open gap is the *generalization*: a reusable harness an agent points at the
  app it just wrote to verify *its own* arbitrary work. *Resolves when:* the bullet
  credits the finalized v0 app and scopes the gap to the reusable harness.
  **Applied** (F8).
- **C2 — F8 attributed an audit model to the wrong document. [Medium]** F8 said
  "LLP 0011 logs `{who, when, key, value_changed}`." Verification: **0011 defines no
  general mutation audit model**; the only `{who, when, key, value_changed}` shape
  in the corpus is **0009's *secret-specific* `set_env` log**. This actually makes
  the gap *larger* than the draft claimed — the audit substrate itself is
  unspecified, not merely agent-blind. *Resolves when:* the bullet states there is
  no general audit model and traces the existing shape to 0009. **Applied** (F8) —
  note this strengthens F2's case and the author should confirm the stronger claim.
- **C3 — F7 conflated two independent primitives in the sequencing. [Low-Medium]**
  F7 and *Recommended sequencing* step 5 bundled "vector type + actions + `ctx.ai`"
  as one unit gated on actions. But a portable vector type + ANN index is a *local
  storage/index* concern that needs no outbound network; only embedding *generation*
  and LLM completion need actions. Storing and querying vectors can be decided and
  shipped by extending LLP 0007 **ahead of** any actions work. Bundling them
  understates how much runtime-AI value is reachable without the (deferred) actions
  contract. *Resolves when:* F7 marks the two tracks independent and the sequencing
  splits them. **Applied** (F7 intro, items 1–2, closing; sequencing step 5).
- **C4 — Concrete strings attributed to sources that do not define them.
  [Low-Medium]** Two instances of the recurring corpus failure mode (the same one
  the 0017 review's C3 caught): (a) F1 listed `/_snapback/api/health` as a route
  0017 *reserves* — 0017 names only `/_snapback/api/inspect` as future-canonical and
  keeps `/health` as a v0 alias; (b) F1/F2 presented `--as <user>` / `--as-admin`
  and "sandbox identities" as **LLP 0011's** — 0011 defines the *capability*
  (run as unauthenticated / specific user / roles / explicit labeled admin bypass)
  but neither those flag spellings nor that term. *Resolves when:* the route claim
  matches 0017's actual reservation and the flags are presented as 0019's proposed
  spelling for a capability 0011 owns. **Applied** (F1 routes, F1 CLI projection,
  F2 opening).
- **C5 — F3's buffered `ctx.db` path was attributed to the wrong layer. [Low]** F3
  leaned on "the same buffered `ctx.db` invocation path" while framing dry-run as an
  extension of the 0004 doctor surface. Buffering is **not** in 0004's API contract;
  it is **LLP 0003's** host API ("the handler runs against `ctx.db`, which is a
  buffering host API"). The fix strengthens F3 by pointing at the substrate that
  already exists. *Resolves when:* the buffered path is attributed to 0003.
  **Applied** (F3).
- **C6 — "defers actions entirely" overstated 0009. [Low]** 0009 blocks
  `ctx.fetch` / network by default (confirmed) but *mentions* actions and defers
  their **capability contract** (network / durable side-effects), rather than
  omitting the concept. *Resolves when:* the wording says "defers the actions
  capability contract." **Applied** (F7 item 2).

## Suggestions (non-blocking, not applied — author's call)

- **"Three projections" vs. "two MCP servers" can trip a fast reader.** F1's
  headline is "one core, three projections" (CLI, HTTP, MCP), but the body then
  describes *two* MCP servers, and the app-data MCP projects from a different source
  (the function manifest) than the host-ops core. It is coherent on a careful read —
  control-plane MCP is the third projection of the host-ops core; app-data MCP is a
  projection of the manifest — but one explicit clause saying so would prevent the
  count from reading as contradictory. Left unedited to avoid churn on a
  presentational point.
- **F4's "destroys all state / the only coarse recovery" is 0019's characterization,
  not a 0010 quote.** It is a *fair* characterization (a deterministic reset to seed
  does discard current working state), so I left it; if you want strict
  source-fidelity, soften to "discards current working state."
- **F2's four-fact audit tuple now carries more weight given C2.** Since there is no
  general audit model at all, F2 is effectively *specifying* one, not refining an
  existing log. That is fine for a Research finding, but when this graduates toward
  action, the four-fact tuple (actor principal / effective principal / scoped grant /
  dry-run-vs-committed) is concrete enough to hand to 0011 as a starting schema.

## Open questions (for the author)

- **OQ1 (surface ownership) is the highest-leverage unmade decision and gates the
  rest.** The document's own open question 1 — does the host-ops core extend LLP
  0010 or warrant its own RFC — sits upstream of the entire sequencing, since F1 is
  "the prerequisite gap." Worth resolving before any of steps 2–5 begin, not after.
- **Does the host-ops core literally reuse 0012's *pinned* `snapback.v0` diagnostic
  schema, or a superset?** F1 correctly says "return the LLP 0012 structured result
  schema," but the operating-surface operations (start/stop/reset/checkpoint) may
  carry result facts the *function* diagnostic schema does not. If so, that is a
  0012 schema event (it pinned `schemaVersion` on 2026-06-26) — the same
  cross-document seam the 0017 review flagged. Reconcile with 0012's author rather
  than letting the core quietly grow the pinned schema.
- **The new OQ9 (concurrent operators)** I added is genuinely open and may deserve
  promotion to a finding if agent *fleets* become a near-term target: F1/F3/F4 all
  assume a single operator, and checkpoint/restore + dry-run semantics change
  materially under concurrency. Its natural owner is the app-instance boundary
  (LLP 0018), which I have not independently verified here.

## Recommended next step

*Proposed only — the author decides; this review changes no `**Status:**`.*

1. **Status stays `Draft`.** I did not change it. The revisions are precision,
   citation repair, and one analytical decoupling — not a new direction. A survey
   document like this can stay `Draft` / `Active` indefinitely; it does not need to
   reach `Accepted`.
2. **Gather a GPT-5 (cross-family) review — this is the honest completion of the
   loop.** It matters more here than for any recent LLP, because the *only* pass so
   far (this one) shares the draft's family *and* edited the text. The standard
   cross-family prompt is prepared and handed to the author; per LLP 0005 this skill
   will not run it externally or record an unproduced review.
3. **Confirm the C2 reframing in particular.** F8 now asserts the stronger,
   verified claim that *no general audit model exists* (only 0009's secret log),
   rather than "0011 logs X." Make sure that stronger statement is the one you want
   standing.
4. **When 0019 graduates from survey to action, route the implied decisions to
   their owners** — F1→0010-or-new-RFC, F2→0011, F3/F4→0004/0003/0007/0010,
   F7-vector→0007 and F7-`ctx.ai`→a new actions-gated RFC under 0009 — exactly as
   the findings already name. As a Research document it correctly stops short of
   ratifying any of these.
