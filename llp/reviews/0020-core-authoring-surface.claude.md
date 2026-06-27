# Review: LLP 0020 — Core authoring surface hardening

**Reviewed:** `llp/0020-core-authoring-surface.plan.md` (working-tree revision)
**Reviewer family:** Claude (Anthropic)
**Provider / runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-27
**Redacted:** No — reviewed locally against the in-repo LLP corpus; nothing sent
externally beyond the model serving this session.
**Method:** Single-session read-and-critique, grounded by four delegated readers
that verified 0020's cross-reference claims **term-by-term** against the specs it
cites — LLP 0012 + 0010 (typed artifacts, acceptance), LLP 0004 + 0003 + 0007
(`ctx.db`, the buffered execution model, portability), LLP 0009 + 0008 (security
envelope, realtime), and LLP 0016 + 0021 + 0018 (the structural overlap question).
Roughly forty discrete claims were adjudicated. Requested as "`/llp-review 0020`
revise if you see things you can improve"; this pass **applied** the revisions
marked **[Applied]** below.

> **Independence (LLP 0005) — this is the strong case.** 0020's Author line is
> "Charlie Cheever / **Codex**," so a Claude review is a genuine **cross-family**
> pass — exactly what LLP 0005's multi-model loop wants, and the opposite of the
> same-family weakness flagged in the 0019 review. **One caveat:** this pass also
> *edited* the document, so the review is no longer independent of the *revised*
> text. The cross-family independence of the *critique* stands (the draft was
> Codex's); treat the edits as author-side revisions a Codex or human author
> should confirm or revert. **No GPT-5 companion exists for 0020 yet** — this is
> the first artifact on its loop. For a Plan at this stage one cross-family review
> plus the author's pass is roughly what LLP 0005 calls sufficient for an
> "ordinary proposal," but the 0016-duplication call (C2) is the kind of
> structural judgment a second family should second — see the recommended step.

## Overall assessment

This is a strong, unusually disciplined Plan. It does the thing a Plan is for:
it turns five concrete diary complaints into a sequenced set of phases, each with
a **falsifiable acceptance gate**, and it draws clean ownership lines to the
subsystem specs so it sequences rather than re-specifies. The honesty ethos that
makes the rest of the corpus good is fully present here — "capability honesty is
part of done," "hidden fallbacks are regressions," and a Demo Admission Rule that
makes the whole Plan enforceable against future demos.

On the factual base, the Plan holds up well. Of ~40 cross-reference claims checked
against the cited specs, the large majority confirmed, several by direct quote:
0012 pins `artifactKind`/`schemaVersion`, the three manifest names, `bundleHash`,
and the drift-check rationale; 0010 finalizes the seven-criterion todo acceptance
app and bans `setTimeout` in tests; 0004 shows the `ctx.db` handler form verbatim
and specifies read-only-query / read-write-mutation, injected `ctx.runtime`
time/ids, and `defineLiveQuery`; 0009 establishes the no-ambient-access capability
shape and the enforce-or-report split; 0008 literally defines the *dependency
summary* and the *ordered-changeset contract*. The Plan does not misstate its
sources.

Its exposure is in three places, in rough order of importance: **(1)** a genuine
architectural insight it leaves implicit — read-dependency capture is *one*
substrate the Plan splits across three phases as if unrelated; **(2)** a
planning-hygiene problem with LLP 0016 — 0020 **duplicates** the umbrella's core
phases rather than narrowing them, and the two now disagree on phase numbering;
and **(3)** a cluster of citation/scope slips (a security gate that contradicts
0009's actions class out of context, a portability mis-attribution, an
offline-parity mis-citation, and an under-cited Related header that omits 0011 on
a phase that is *about* authorization). None breaks the Plan; all are corrected or
flagged below.

## Strengths

- **Falsifiable acceptance gates per phase** (every Phase's *Acceptance gate*).
  This is the spine of the document and the reason it will function as an agent
  contract rather than prose. The gates assert structured facts (a diagnostic
  fires, a CI check fails, a gap clears) — the same discipline the diary credited.
- **Phase 0 freezes the wins before refactoring** (*Phase 0*). Pinning the
  diary-praised behavior (stable codes, deterministic seed, the single-seam
  subscribe, machine-readable gaps) *before* replacing scaffolding is the right
  anti-regression move and is rare in implementation plans.
- **The Demo Admission Rule** (*Demo Admission Rule*) operationalizes the Plan: a
  demo may claim the core surface only on four conditions, or must name the
  scaffolding it leans on. This is what makes "is the authoring surface real yet?"
  a checkable question instead of a vibe.
- **Capability honesty as a definition of done** (*Constraints*). "A missing …
  transport is acceptable only when reported as a capability gap. Hidden fallbacks
  are regressions" is the single most load-bearing principle here, and it is
  stated as a constraint, not an aspiration.
- **The Phase 4 no-leak gate is a Plan-originated sharpening, not just a
  restatement.** "A mutation to a row a subscriber cannot see neither notifies
  that subscriber **nor leaks existence through runtime state**" extends 0008/0011
  (which speak to deltas/snapshots/local stores) to guard the Plan's *own* new
  runtime-state surface. That is the document thinking, not transcribing.
- **Clean owns / does-not-own with a conflict rule** (*Scope*): "When this Plan
  conflicts with a subsystem spec, the subsystem spec owns the mechanics. This
  Plan owns sequencing, cutlines, and proof." Correct planning hygiene.

## Concerns

Severity is the reviewer's. Items marked **[Applied]** were edited in this pass
and are the author's to confirm or revert; **[Proposed]** items were not applied.

- **C1 — Read-dependency capture is one substrate the Plan splits across three
  phases as if unrelated. [High] [Applied]** Phase 1 generates a *static* read-set
  summary on the function manifest; Phase 3 captures the *runtime* mutation read
  set for conflict validation; Phase 4 builds a *query dependency matcher*. These
  are the same "what did this execution read" machinery with three consumers, and
  the specs say so out loud: **LLP 0003 §Execution** — "the read-set extraction
  this validation needs is the same machinery the realtime matcher uses … build it
  once and both … share it"; **LLP 0008 §Reactivity** names the shape a *dependency
  summary* with the identical field list (tables, indexes/predicates, row ids, auth
  predicates) Phase 3 records; **LLP 0012** pins the static summary as a manifest
  field validated against the handler body. As written, an implementer could build
  two or three extractors — the exact anti-pattern 0003 warns against. *Resolved
  by:* a new framing in *Phase 3*'s intro ("one substrate with three consumers …
  build one extractor, not three"), a Summary bullet, a *Phase 1* static-summary
  bullet, and a *Phase 4* matcher bullet that names it "the same read-dependency
  facts Phase 3 captures, not a second extractor." This is the highest-leverage
  change in the pass.

- **C2 — 0020 duplicates rather than narrows LLP 0016, and the two now disagree.
  [High] [Applied to 0020; cross-document fix Proposed]** 0016's Change Program
  already enumerates these core phases; 0020 restates Phase 0/1/2/4 nearly
  verbatim (same constraints, non-goals, open questions) instead of referencing
  them. Two concrete harms: **(a)** both are *Draft* Plans presenting themselves as
  trackers for the same four phases, so a decision (source-of-truth schema, push
  transport, read-set representation) must be edited in both or they drift — and
  they already drift (0016 folds `ContractDataManifest` into its Phase 1; 0020
  omits it); **(b)** **phase numbers diverge** — "Phase 3" means *Contract adapter*
  in 0016 but *read-set capture* in 0020, so any corpus cross-reference to "Phase
  3" is ambiguous. *Resolved (0020 side) by:* a *Change Program* preamble that
  declares numbering local to this Plan, states the 0016↔0020 mapping, claims
  authoritative ownership of the core gates, and a new *Open Question* asking
  whether 0016 should be slimmed. *The real cure is cross-document and not
  applied:* **slim LLP 0016 to a one-line-per-phase index that points at 0020
  (core) and 0021 (adapter)** — see Recommended next step. I did not touch 0016;
  that is a separate Draft and the author's call.

- **C3 — The Phase 2 security gate, read literally, contradicts 0009's actions
  class. [Medium] [Applied]** The binding *Constraint* correctly scopes the
  no-network rule to "query and mutation handlers," but the *Phase 2 acceptance
  gate* dropped the scope: "a **handler** that attempts … network … fails." 0009
  §Runtime Boundary deliberately *re-enables* a network subset for **actions**
  ("actions re-enable a selective subset"), so the unscoped gate asserts a blanket
  no-network-for-all-handlers that 0009 contradicts. Latent only because the Plan
  never builds actions — but the wording would mislead. *Resolved by:* scoping the
  gate to "a **query or mutation** handler" with an explicit clause that 0009
  reserves network for actions, which this Plan does not build.

- **C4 — Non-Goals mis-attribute the offline-parity mechanics to LLP 0012.
  [Medium] [Applied]** "offline queueing, deterministic replay, and
  rebase-on-reconnect … per LLP 0012." Those four terms *do* appear in 0012's
  parity-capability section, so citing 0012 for the *claim* is defensible — but the
  **mechanics** are owned by **LLP 0008 §Mutation Replay** ("clients may enqueue
  mutations while offline … replay … as function + args + captured environment …
  full resync then replay in sequence order"). *Resolved by:* "the mechanics owned
  by LLP 0008's mutation-replay contract, the parity-capability claim gated by
  LLP 0012."

- **C5 — Scope mis-attributes portability to LLP 0003. [Medium] [Applied]** "the
  detailed storage, transaction, and portability contract, owned by LLP 0003 and
  LLP 0007." But 0003 §Boundaries **explicitly disclaims** portability ("This RFC
  does not settle … the SQLite-to-Postgres portability contract"); 0007 owns it
  outright and 0003 only implements it. *Resolved by:* splitting the clause —
  storage+transaction to 0003, the storage-portability contract to 0007, with a
  parenthetical that 0003 implements but does not own it.

- **C6 — The Related header omits real dependencies, most seriously LLP 0011.
  [Medium] [Applied]** Phase 4 requires "make the matcher **authorization-aware**"
  and gates on row visibility — squarely **LLP 0011**'s concern — yet 0011 was
  absent from Related and never cited (0016's equivalent phase says "Depends on:
  an authorization-aware matcher (LLP 0011)"). Also missing: **0013** (Phase 4's
  ephemeral presence/cursor boundary, which 0016 carves out explicitly), **0021**
  and **0007** (both cited in the body), and **0018** (app-scope forward-compat).
  *Resolved by:* adding 0007, 0011, 0013, 0018, 0019, 0021 to Related and citing
  0011/0013/0018 inside Phase 4.

- **C7 — Phase 1 drops LLP 0010's "no silent drops" rule — the property the diary
  celebrated. [Medium] [Applied]** 0010 calls completeness-validation /
  AST-over-regex / no-silent-omission its "single most important agent-first rule,"
  and the diary explicitly credited the fail-closed codegen that honors it. Phase 1
  shipped *typed* artifacts but never carried the guarantee forward. *Resolved by:*
  a required-change bullet ("validate manifest completeness against what the
  runtime actually persists and fail closed") and a matching gate ("a field present
  in the runtime schema but dropped from codegen fails closed").

- **C8 — Phase 2 named only the write half of 0003's buffered execution model.
  [Low-Medium] [Applied]** 0003 defines the model as *consistent snapshot reads +
  buffered writes + read-your-writes overlay*; Phase 2 listed buffered writes and
  the read-only/read-write split but not the snapshot-read semantics that make
  isolation work, and did not cite 0003 §Execution at all. *Resolved by:* a bullet
  that names the buffered host API in full and cites 0003.

- **C9 — Phase 2 has no invocation-isolation gate. [Low-Medium] [Applied]** 0009
  §Invocation Isolation ("one fresh runtime or an equivalently reset context per
  handler invocation … per-invocation global state does not leak") is a
  *capability-shape* guarantee, not a resource limit — so a Plan that promises to
  "preserve the capability shape" should gate it. *Resolved by:* a Phase 2 gate
  line asserting no cross-invocation state leak.

- **C10 — The resource-limit Open Question dropped one of 0009's three enforcement
  paths. [Low] [Applied]** 0009 leaves open "engine watchdog vs. killable
  process/isolate vs. the V8 path"; the OQ listed only the latter two. *Resolved
  by:* restoring the engine-watchdog option.

- **C11 — "Authorization-aware matcher from the first version" risks
  over-promising. [Low] [Applied]** 0008's v1 model is **server-directed resubscribe
  on permission change**, not live per-row revocation deltas (the permission
  *language* is deferred to 0011). *Resolved by:* "applying LLP 0011 visibility
  before any delta syncs; v0 may use server-directed resubscribe … rather than live
  per-row revocation deltas."

- **C12 — Phase 0's keep-list named six of 0012's eight pinned diagnostic
  families. [Low] [Applied]** It dropped `BUNDLE_*` and `STALE_*` (the latter
  notable, since the same gate is about stale artifacts). *Resolved by:* listing
  all eight.

- **C13 — Phase 1's typed-artifact list omitted the target profile. [Low]
  [Applied]** 0012 lists the target profile as a required artifact (and embeds a
  `targetProfileId` in the capability manifest and runtime state). *Resolved by:*
  adding "the target profile" to the generate list.

- **C14 — Phase 1's hash work ignored 0012's "two hashes" caution. [Low]
  [Applied]** 0012 warns to make each hash's scope explicit; the diary's
  `inputsHash` (codegen inputs) and 0012's `bundleHash` (handler bundle) are
  different things, plus `schemaVersion`. *Resolved by:* "hash/freshness fields
  whose scope is explicit (codegen-inputs vs. handler-bundle vs. schema version)."

## Suggestions (smaller items applied, plus non-blocking ideas)

Applied in the same pass (author's to confirm):

- **Phase 0 ↔ Phase 2 diagnostic tension.** Phase 0 promises *stable* codes; Phase
  2 introduces arbitrary user JS that throws *unstable* errors. Added a Phase 2
  required change to **normalize handler-thrown errors into the Phase 0 code
  family** so a handler failure never escapes unstructured.
- **Capability-gap ↔ acceptance-gate symmetry.** Generalized the
  `ibex_ctx_db_host_bridge` pattern into a stated rule in *Constraints*: every
  phase that fills a gap adds a test asserting it is reported-absent while missing
  and cleared once present.
- **Phase 4 welds three separable projects.** The matcher, the push transport, and
  the observability work can ship independently; added a bullet saying so, moved
  **fan-out measurement into the acceptance gate** (it had floated as a
  required-change bullet with no gate), and grounded the transport wording in
  0008's swappable ordered-changeset contract (0008 names WebSocket; "SSE" was the
  Plan's own addition — left as an option in OQ2, which is genuinely open).
- **Dry-run forward link.** Noted that Phase 2's buffered path + Phase 3's captured
  reads are the substrate a propose→check→commit dry-run (LLP 0019) would run on —
  a near-free synergy the Plan was missing.
- **OQ1 ↔ Phase 1.** Tied Phase 1's "choose one source of truth" to Open Question 1
  so the required first step and the open question stop floating apart.

Non-blocking, **not** applied (author's call):

- **The Demo Admission Rule now has three authorities.** LLP 0010 owns the demo
  ladder, 0016 layers a capability-gated admission rule, and 0020 restates a
  core-subset rule. They don't contradict, but a demo author must satisfy two
  rules and it is unclear which governs. Worth reconciling when 0016 is slimmed
  (C2) — fold 0020's four conditions into 0016's table rather than maintaining
  both.
- **The title says "hardening," but Phases 1–2 are net-new capability.** "Hardening"
  usually means securing/robustifying an existing surface; building the real
  `ctx.db` path and the typed package is *buildout/completion*. Minor, but
  "Core authoring surface buildout" would describe the content more honestly.

## Open questions (for the author)

- **Is 0020 declaring precedence over 0016 the right move, or should 0016 be
  slimmed first?** My *Change Program* edit now says 0020 "owns the authoritative
  required-changes and gates" and 0016 "should reference rather than restate" them.
  That is the correct end-state, but it is a cross-document precedence claim a
  Plan should not assert unilaterally without the umbrella actually being slimmed.
  Confirm the direction (I recommend slimming 0016), then the precedence sentence
  is earned rather than aspirational.
- **Static manifest summary vs runtime capture — one extractor or two
  derivations?** C1's fix asserts "one substrate with three consumers." Verify that
  is the intended architecture: the static manifest field (build-time, validated
  against the handler body) and the runtime read set (per-invocation) may share a
  *shape* and a *code path* but run at different times — confirm they are meant to
  be one extractor invoked twice, not two implementations of one shape.
- **Does Phase 2's "normalize handler errors" need its own diagnostic family?** If
  arbitrary handler throws map onto Phase 0's stable codes, there is probably a new
  `HANDLER_*` family to pin in 0012 — a 0012 schema event, not silently absorbed
  into an existing code.

## Recommended next step

*Proposed only — the author decides; this review changes no `**Status:**`.*

1. **Status stays `Draft`.** I did not change it. The revisions are sequencing
   insight, citation repair, and gate sharpening — not a new direction.
2. **Slim LLP 0016 to an index (the real fix for C2).** Demote 0016's Change
   Program to one line per phase pointing at 0020 (core) and 0021 (adapter) for the
   authoritative required-changes and gates; keep in 0016 only the genuinely
   cross-owner content (the sequencing/dependency table, the ownership split, the
   demo-ladder mapping, the risks). Then there is one source of truth per phase and
   the precedence sentence this pass added to 0020 becomes true. I can do this as a
   follow-up on request — it is a separate document, so I left it to you.
   **Update (2026-06-27): done at the author's go-ahead.** 0016's Change Program was
   slimmed to an index: the per-phase required changes and gates now live in LLP 0020
   (core — program Phases 0/1/2/4) and LLP 0021 (adapter — program Phases 3/5); 0016's
   Sequencing table gained an *Authoritative detail* column mapping each program phase
   to its owning Plan (program numbers are flagged as not matching the detail Plans');
   the React/Expo phase, which no detail Plan owns, was retained in 0016; and 0020's
   forward-looking "should reference" language plus its now-resolved "slim 0016?" Open
   Question were reconciled. C2 is closed.
3. **Gather a GPT-5 (cross-family) review — and point it at C2 specifically.** This
   is the first artifact on 0020's loop; a second family should second the
   structural call that 0020 and 0016 should be split-and-slimmed rather than
   merged. The standard LLP 0005 prompt applies; per the honesty rules this skill
   will not run it externally or record an unproduced review.
4. **Confirm or revert the applied edits.** They are listed as **[Applied]** above
   with the resolving change for each; the draft is Codex's, so a Codex or human
   author owns the final say on the revised text.

---

## Re-review (2026-06-27, same session) — least-independent pass

**Provenance:** Claude (Anthropic) · Opus 4.8 via Claude Code · 2026-06-27 · not
redacted · single-session self-critique. **This is the weakest-independence pass
on the loop and is not a second independent review.** The first Claude pass above
already *edited* 0020, and this session wrote those edits, so this re-read is a
self-critique of my own revisions — it can catch errors I introduced and close
gaps both prior passes left open, but it adds no cross-family diversity. Recorded
as a dated section per LLP 0005 (same family never overwrites its own artifact).

**What changed on the loop since the pass above.** Two of that pass's recommended
next steps were carried out by the author/another session:

- **A GPT-5 review now exists** (`llp/reviews/0020-core-authoring-surface.gpt-5.md`).
  It is honest that GPT-5/Codex is the *same family as 0020's author*, so it is an
  author-side critical pass, **not** the cross-family review — the Claude pass above
  remains the sole cross-family review for LLP 0005 purposes. GPT-5 applied four
  refinements (C1 Phase 1 read-summary timing, C2 demo-rule-as-specialization,
  C3 title→"buildout", C4 add LLP 0015 + extend OQ1 to the `ContractDataManifest`
  question) and **independently rated the shared read-dependency substrate "the
  strongest idea"** — a useful external check that this pass-1 finding was sound, not
  over-claimed. Its C1 also *corrected an error in my pass-1 edit*: I had Phase 1
  "validate against the handler body," but no handler bodies exist until Phase 2; the
  fix (type the field at Phase 1, validate once Phase 2 supplies bodies) is right.
- **C5 / my C2 (slim LLP 0016) is done.** 0016's duplicated Change Program was
  reduced to an index over 0020/0021; the precedence sentence 0020 added is now
  earned. Verified consistent: 0020 line ~126 ("LLP 0016 … now indexes these gates")
  matches the slimmed 0016, and the Demo Admission Rule now names itself 0016's
  specialization.

**Applied this pass (three small gaps that survived both prior passes).** All are
the author's to confirm or revert.

- **R1 — Resolved the `HANDLER_*` question both reviews only flagged. [Low]** My
  pass-1 open-question #3 and GPT-5's Suggestion 3 both raised that Phase 2's
  "normalize handler-thrown errors into the Phase 0 family" is underspecified —
  Phase 0's eight families may not cover an arbitrary handler throw. *Resolved by:*
  Phase 2 now says if handler failures do not fit the eight families, pin a new
  `HANDLER_*` family in LLP 0012 **as a schema event**, not an ad-hoc code.
- **R2 — Gated the handler-error requirement. [Low]** That required change had no
  acceptance gate (a discipline violation in a gate-driven Plan), and it is distinct
  from the ambient-access gate (a normal throw is not an ambient-access attempt).
  *Resolved by:* a Phase 2 gate line — "a handler that throws produces a structured
  diagnostic with a stable code, not an unstructured error or raw stack trace."
- **R3 — Named OQ3 as the shared-vocabulary decision. [Low]** GPT-5's Suggestion 2
  ("define the shared dependency summary shape first; don't invent separate
  vocabularies") lands on OQ3 (the read-set representation). *Resolved by:* OQ3 now
  states it is the one vocabulary the static manifest summary, the conflict check,
  and the matcher all consume, to be defined before building any of the three.

**Residual / not applied (deliberately).**

- *"Where safe" in Phase 3* (exposing captured read/write facts in admin/doctor) is
  an acceptable Plan-level hedge, but the safety governor is the same LLP 0011
  visibility the Phase 4 gate names; if the author wants symmetry, say so once. Left
  unedited — minor, and over-specifying a Plan is its own cost.
- *Actions are absent from Non-Goals.* The Phase 2 gate already scopes the network
  ban to query/mutation and notes 0009 reserves network for actions, so the omission
  is cosmetic. Left as-is.

**Verdict — stop the review loop here.** For a Plan of this stakes, the loop is
substantively complete: Codex authored, Claude reviewed cross-family and revised,
GPT-5 ran an author-side pass and revised, the 0016 structural fix landed, and the
residual is now micro-level. The honest next move is **not another Claude pass**
(this one already hit diminishing returns and is non-independent) but the author's
call: keep `Status: Draft` until the source-of-truth schema decision (OQ1) and the
Phase 1/Phase 2 boundary are settled, then move toward `Accepted`. I changed no
`**Status:**`.
