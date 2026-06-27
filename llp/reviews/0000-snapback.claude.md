# Review: LLP 0000 — Snapback

**Reviewed:** `llp/0000-snapback.explainer.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-25
**Redacted:** No — reviewed locally against the in-repo document; no document
content was sent to any external provider beyond the model serving this Claude
Code session.
**Method:** Single-session, independent read-and-critique of the full document
at its uncommitted working-tree state.

> **Independence (LLP 0005).** This session did **not** author the draft — it
> was drafted by Charlie Cheever / Codex (a GPT-family agent). A Claude review
> is therefore genuinely cross-family, which is the point of the loop: different
> families miss different things. This is **one** family's review. A root
> document of this weight can warrant a second non-author family (e.g. Gemini)
> before the author treats the loop as settled — but for a first pass this is a
> real, independent review, not a self-review.

## Overall assessment

Strong root explainer. It does the job a `Role: Root` document is supposed to
do: states intent, draws subsystem boundaries, names the hard constraints, and
is unusually honest about what is *not* yet proven (the scale target, the
workload envelope, the fan-out ceiling). The provenance discipline — separating
Charlie's ratified direction from boundary-level guidance — is exactly right and
rare to see stated outright.

The gaps that remain are mostly **definitional and trust-model** gaps, not
structural ones. The single most important fix is not mine to make: the central
target term, *Contract/Exact*, is never defined. After that, the document would
be strengthened by naming a security/isolation posture (it runs user code and is
meant to be hosted for other people) and by reconciling "scale to zero" with the
always-on deployment targets it also promises.

I applied the editorial fixes I could make without inventing direction (see
*Recommended next step*); the rest are flagged for the ratifying source.

## Strengths

- **Honest about unknowns** (*Scale targets and known limits*). "Not yet a
  proven benchmark," an explicit `Needs definition:` for the workload envelope,
  and the mouse-position fan-out open question keep aspiration and evidence
  cleanly separated. This is the document's best quality.
- **Hard constraint stated as hard** (*Data storage*). "Anything that makes the
  SQLite→Postgres move a rewrite has failed the brief" is the kind of
  load-bearing, falsifiable invariant a root doc exists to pin down.
- **Provenance discipline** (*Summary*, *Source and ratification*). Distinguishing
  ratified direction from provisional subsystem detail, and naming the ratifying
  source, is what makes the rest of the corpus trustworthy.
- **Agent-first DX made concrete** (*Design principles*). Rather than leaving it
  a slogan, it points at `ref-check` as a worked example of the feedback-loop
  philosophy — and is candid that agent DX wins ties against human ergonomics.
- **Self-aware Valet retrospective** (*Lessons from Valet*). Treating recovery of
  the empirical failures as required early work, not optional history, is the
  right instinct.

## Concerns

Severity reflects impact on a reader/agent trying to *act* on this document.

- **C1 — "Contract/Exact" is never defined. [High]**
  It is the first-class target ("first-class product context," and it wins ties
  in the principles), yet the corpus never says what the Contract/Exact stack is
  or links a reference. A new agent orienting via this root cannot resolve the
  term it is told to prioritize above all else.
  *Resolves when:* the ratifying source adds a one-line definition and a
  canonical link (and an entry in `**Related:**`). I deliberately did **not**
  infer one — this is the top item for Charlie.

- **C2 — No security / tenant-isolation / sandbox posture. [Medium-High]**
  Snapback executes user-authored JavaScript, stores auth data as first-class
  data, and is explicitly meant to be *hosted for other people* (MIT, "no funny
  business"). Yet there is no boundary-level statement of the trust model: how
  executed code is sandboxed, whether a deployment is single- or multi-tenant,
  how tenants are isolated, how secrets are handled. For a backend, this is
  load-bearing even at explainer altitude.
  *Resolves when:* a one-line note names it as an open constraint and a dedicated
  follow-on LLP owns the model. (I added both, conservatively — see edits.)

- **C3 — "Scale to zero" vs. "run anywhere" is in tension. [Medium]**
  "So light that an idle app costs almost nothing" is presented as universal, but
  *Multi-target deployment* also promises always-on VM hosts (Hetzner, cloud
  droplets, EC2) that bill their base rate at idle regardless of how light the
  app is. True bill-to-zero is a property of serverless / Cloudflare-style
  substrates, not of every target. As written the two goals can be read as
  contradictory.
  *Resolves when:* the claim is scoped as target-dependent and the
  runtime/deployment LLP states idle cost per profile. (I added a hedge pointing
  at that work; I did not decide the answer.)

- **C4 — The storage portability boundary is underspecified. [Medium]**
  "One abstraction over both that you use *most of the time*" implies an escape
  hatch to engine-specific features, but the document doesn't say whether using
  it voids the portability guarantee — and portability is declared *hard*. The
  edge of a hard guarantee is exactly what needs an edge.
  *Resolves when:* the doc states the contract binds the shared abstraction and
  engine-specific use is an explicit opt-out, leaving the precise line to the
  storage LLP. (Applied conservatively, consistent with *paved path, not a
  cage*.)

- **C5 — The follow-on list omits core backend concerns. [Medium]**
  No pointer to schema migrations/evolution (a primary data concern, and it
  interacts directly with the portability contract), to the security/isolation
  model (C2), or to runtime observability — logs/errors/metrics, which is the
  feedback loop agent-first DX implies for *running* apps, distinct from
  `ref-check` serving the design corpus.
  *Resolves when:* these are added as expected work. (Applied — the list already
  hedges that it is "a pointer to expected work, not a commitment.")

- **C6 — Minor wording / redundancy. [Low]**
  "Close to guarantees" is evocative but undefined, and used twice; a concrete
  gloss (types/contracts/tests + `ref-check`) would land it. The
  scale-to-zero/Rails framing repeats across Summary → principles → scale
  targets. "Your own machine, your own hardware" reads as one idea twice (laptop
  vs. self-managed server, if a distinction is intended).
  *Resolves when:* lightly tightened. I left most prose intact to respect the
  fresh revision; noted as suggestions, not applied.

- **C7 — Authorship vs. ratification in the header. [Low / Info]**
  `**Author:** Charlie Cheever / Codex` blends the ratifying human with the
  drafting agent, while the body is otherwise careful to keep direction (Charlie)
  separate from drafting. Not wrong, but worth a convention. Relatedly, this
  review and its editorial edits are a third family's touch and are **not**
  ratified.
  *Resolves when:* the review is recorded (done — this file) and the doc notes
  that editorial revisions from it are applied but unratified. (Applied as a
  one-line note in *Source and ratification*.)

## Suggestions (non-blocking)

- Add a short **Trust & isolation** cross-cutting subsection once the model
  exists — it sits naturally beside local-first, realtime, and multi-target.
- Consider a one-line **glossary / Terms** note for project-specific names.
  Ibex, Valet, and the LLP repo are linked; Contract/Exact is not.
- State the **hosting/business-model boundary** plainly: is "scale to zero /
  costs almost nothing" a self-host resource-footprint goal, a managed-offering
  goal, or both? This is the root of C3 and worth one sentence.

## Open questions (for the author / follow-on LLPs)

- What *is* the Contract/Exact stack, and where is its canonical reference?
- Tenant model: is a Snapback deployment single-tenant, or multi-tenant with
  isolation guarantees? What sandboxes executed code?
- Does reaching for engine-specific SQL/Postgres features void the portability
  contract, or is a portable subset guaranteed?
- Who bears idle cost on always-on targets, and what does "almost nothing" mean
  per deployment profile?
- The realtime fan-out ceiling (already flagged in the doc) — the key empirical
  unknown; keep it front and centre, informed by the Valet retrospective.

## Recommended next step

*Proposed only — the author decides; this review changes no `**Status:**`.*

1. **Status stays `Active`.** I did not change it.
2. **Charlie reviews the editorial diff** I applied (C2–C5, C7 — all
   gap-surfacing or faithful clarification, no new direction) and ratifies or
   reverts.
3. **Charlie supplies the Contract/Exact definition** (C1) — the one item I
   could not resolve without inventing.
4. **Optional second family.** For a root document, one more non-author family
   (e.g. Gemini) would harden the loop. I can prepare the standard LLP 0005
   review prompt on request — but per the honesty rules I will not run it against
   an external provider, or record a review that wasn't actually produced,
   without an explicit human action. (Note: the sub-agents available in this
   session are all Claude-family, so they would not satisfy the cross-family
   requirement.)

---

## Re-review — 2026-06-25 (second Claude pass, `0000–0004` sweep)

**Provenance.** Same family as the review above (Claude / Anthropic, Opus 4.8 via
Claude Code); reviewed locally, nothing sent externally. This is a **dated
re-review, not an independent second family** — recorded as a section per the LLP
0005 same-family rule rather than overwriting the original. It was produced while
reviewing the full `0000–0004` set, so its value is mostly cross-document.

- **The editorial edits proposed above are present in the working tree.** C2
  (security/isolation follow-on), C3 (scale-to-zero scoped as a per-target
  property the architecture must "earn"), C4 (storage opt-out / "paved path, not a
  cage"), C5 (migrations, observability, and security added to *Follow-on LLPs*),
  and C7 (the unratified-edits note in *Source and ratification*) all landed.
- **C1 (Contract/Exact undefined) remains open** and is still the single gateway
  item only Charlie can resolve. The doc now flags it explicitly as a
  "Terminology gap," which is the honest interim state — but a new agent orienting
  via this root still cannot resolve the term it is told to prioritize above all
  else.
- **C6 (minor wording/redundancy) was not applied** and remains a low-priority
  cleanup; the original review deliberately left prose intact to respect the fresh
  revision, and I did the same.
- **Cross-document findings that touch 0000** (captured in the new 0003/0004
  reviews, not re-litigated here): (a) the finance reference app's "money-grade
  write correctness" needs exact integer/decimal types that a single JSON number
  type cannot represent — a concrete constraint on the *Data storage* and
  *Reference apps* sections (0004 C3); (b) the realtime fan-out ceiling 0000
  already flags as an open question is concretely where 0003's subscription
  matcher will bend (0003 C1/C6). Neither changes 0000's direction; both reinforce
  open questions already on record.

**No new independent family review was performed on 0000.** A non-Claude family
(e.g. Gemini or a GPT-family agent) remains the real way to harden this root
document's loop, exactly as the original review's step 4 says.


---

## Re-review — 2026-06-25 (third Claude pass, `0000–0012` cross-document sweep)

**Provenance.** Same family as the passes above (Claude / Anthropic, Opus 4.8 via
Claude Code); reviewed locally, nothing sent externally. Scope: a *cross-document*
consistency pass over all thirteen LLPs (`0000`–`0012`), which per-document reviews
structurally miss. Requested as `/llp-review 0000-0012` with "revise if you see
ways to make them better."

> **Honesty (LLP 0005).** This is a **same-family re-review, not a new independent
> family.** It cannot, by itself, complete or extend the multi-family loop — a
> non-Claude family (Gemini, or a second GPT-family pass) remains the way to
> harden it. Two further caveats: (1) `0001` and `0002` are authored
> `Charlie Cheever / Claude`, so a Claude review of *those two* is **not
> cross-family to the author** — the existing GPT-5 reviews remain the
> independent record for them, and my notes on them are editorial, not
> independent review. (2) No `**Status:**` was changed on any document; all
> applied edits are the author's hands acting on review feedback, and remain
> **unratified** until Charlie confirms, exactly as the original review's step 2
> requires.

### What I looked for

Per-document gaps are already well-covered by the existing Claude + GPT-5 reviews
and by the deep Valet fold-in. So this pass targeted: (a) claims in one LLP that
contradict or have been superseded by another; (b) stale pointers created when
`0006`–`0012` landed after `0000`–`0002`; (c) metadata (`Related`) that no longer
matches what a document's body actually references.

### Findings and applied revisions

- **R1 — `0000` "not a fork in the programming model" contradicts `0006` and `0009`
  [High].** Both downstream LLPs record this as a *direct contradiction* and list
  `LLP 0000` under "LLPs to update: soften or qualify the interchangeability
  claim" (`0006` §engines-not-interchangeable finding; `0009` §Runtime Boundary).
  It was never softened: `0000`'s *Code execution* section stated the
  interchangeability flatly, with no caveat. **Applied** — the claim is now stated
  as an *intent not yet earned*, gated on the runtime-conformance contract `0009`
  owns, with Valet's `async`-rejection as the concrete fork. This is a faithful
  clarification (it states as a goal what the rest of the corpus already treats as
  an open constraint), not new direction. It is the headline revision of this pass.
- **R2 — `0002` pointed at Valet's empirical failures via `LLP 0001`, but the
  recovered record now lives in `0006` [Low].** `0001` correctly defers to `0006`;
  `0002`'s "Valet's empirical failures (LLP 0001)" had not been updated.
  **Applied** — `0002` now cites `0006` directly (with `0001` as the secondary
  pointer) and lists `0006`/`0009` in `Related`.
- **R3 — `0001` / `0002` `Related` metadata was stale [Low].** Their bodies
  reference `0006`+ (and `0001` explicitly says `LLP 0003`–`0012` consume its
  recovery pass) but `Related` stopped at `0004`. **Applied** — `Related` extended
  to the LLPs each actually relates to.

`ref-check` still passes (13 docs, 0 errors).

### Not changed (deliberately)

- **No status changes.** All thirteen remain as-is (`Active` for `0000`; `Draft`
  for the rest). Promotion is the author's call.
- **No prose rewrites beyond R1–R3.** The corpus is already heavily reviewed and
  Valet-grounded; churning it further from the same family would add noise, not
  signal. The earlier per-document concerns (Contract/Exact definition gap,
  Cloudflare strategy LLP, fan-out ceiling, scale benchmark envelopes) remain open
  and are *not* closed by this pass.
- **No new independent family review was performed.** For the highest-weight
  documents (`0000`, `0003`, `0008`), a third family (e.g. Gemini) would still be
  the real marginal hardening — per the honesty rules I will not record one that
  wasn't actually produced.

### Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Charlie ratifies or reverts R1.** It is the one edit that touches a
   load-bearing product claim (softening "not a fork" to "intent, gated on a
   conformance contract"). The substance is already mandated by `0006`/`0009`; the
   choice is whether `0000` should carry the hedge or stay aspirational and let
   `0009` carry all of it.
2. **Optionally, gather a third family** (Gemini) on the three highest-weight
   documents — `0000`, `0003`, `0008`. That is the only step that would genuinely
   advance the *loop*; everything else here is editorial.

---

## Re-review — 2026-06-25 (fourth Claude pass, async/execution-boundary finding)

**Provenance.** Same family (Claude / Anthropic, Opus 4.8 via Claude Code).
Triggered by the author's question: *why are async handlers important, can
transpilation/generators rescue them on Hermes, and can Ibex actually do async?*
This is a **same-family re-review, not an independent family** — and because
`0003`/`0006`/`0009` are Codex-authored, a Claude review of them *is*
cross-family to the author, so the substantive findings below are a genuine
independent contribution. `0001`/`0002` are Claude-authored, so notes on those
remain editorial. Nothing sent externally; the Ibex repo was read on the local
machine.

> **Honesty (LLP 0005).** No `**Status:**` changed. The applied revisions are
> the author's hands acting on review feedback and remain **unratified** until
> Charlie confirms. One finding is *new first-hand evidence gathered this
> session* (`[observed - Ibex source, 2026-06-25]`) — it is recorded here as
> the provenance trail, not fabricated.

### The finding (new)

The Valet corpus (`0006`/`0009`) attributed the `async`-handler rejection to
Hermes/Ibex being async-incapable. **Examining the Ibex source
(`/Users/ccheever/projects/ibex`) shows this is wrong about the cause.** Hermes
has `async`/`await` and a microtask queue; JSI embeddings must pump it, and Ibex
already does:

- `ex_hermes_poll(runtime, now_ms)` (`src/engine/hermes_runtime.cc:1814`) runs one
  tick: drains cross-thread callback queues, runs `nextTick`, calls
  `drainMicrotasks(...)`, fires due timers, returns the count executed.
- `drive_event_loop` (`src/bin/ibex/engine/hermes.rs:811`) loops on it until no
  work remains, **releasing the runtime lock between ticks**.
- The `ibex` binary supports top-level `await` (test at `runtime.rs:2738`).

The real Valet failure was the *execution boundary*: mutation replay ran inside a
**synchronous `eval` that held the DB mutex for the entire handler**, so an
`async` handler returned an unresolved Promise with no microtask drain. That is a
property of the boundary, not the engine — and it is the *same* boundary choice
that caused Valet's P99 ~1s write contention. Transpilation/generators do not
rescue it (they relocate the same microtask-pump requirement); the fix is a
poll-driven boundary, which Ibex already has. Boa "worked" only by papering over
the gap with a slow, incomplete engine.

### Applied revisions (all unratified)

- **R4 [High] — `0009` §Runtime Boundary reframed.** The async gap is now stated
  as an execution-boundary property, not an engine limit; the conformance floor
  is made two checkable properties (drive async to completion; don't hold the
  storage lock across async work); Boa is dropped as an engine option (Ibex and
  V8 only, per the author's instruction); the Ibex `ex_hermes_poll` mechanism is
  cited as `[observed - Ibex source, 2026-06-25]`.
- **R5 [High] — `0003` §Execution and Write Semantics rewritten.** The mutation
  model is now "drive handler to completion via the microtask loop with the lock
  released per tick; commit all buffered writes in one brief transaction under a
  single write lock, stamping one version." This separates handler time
  (async, lock-free) from commit time (synchronous, brief) — fixing both the
  async gap and the write contention in one structural change, and delivering
  `0007`'s one-version-per-mutation contract.
- **R6 [Medium] — `0009` Valet-invariants block annotated.** The "DB mutex held
  for the entire handler execution" invariant is marked superseded by the `0003`
  revision (struck through with explanation); the remaining invariants stand.
- **R7 [Low] — `0006` async finding gets a correction note.** The historical
  finding (Valet *did* reject async) stands; the root-cause attribution is
  corrected, pointing to the Ibex evidence and the `0003`/`0009` fixes.
- **R8 [Low] — `0000` R1 hedge tightened.** Now that the mechanism is identified,
  "intent not yet earned" is tightened to "intent not yet earned, but the
  mechanism that earns it is now identified" — naming the two conformance
  properties and the Ibex boundary. Boa is named as not an option in the root.

`ref-check` passes (13 docs, 0 errors).

### What this does and does not prove

- **Does prove:** Ibex has the mechanism to drive async handlers to completion
  without holding a lock for the whole eval. The Valet async failure was a
  boundary choice. Boa is unnecessary.
- **Does not prove:** that a Snapback handler-execution harness built on this
  boundary actually works end-to-end. The evidence is from reading Ibex's own
  runtime + tests, not from running a Snapback mutation through it. The
  conformance suite (`0009`/`0010`) must verify the floor empirically. The
  buffering-`ctx.db`-then-commit model in `0003` is a design, not a benchmark.

### Recommended next step

*Proposed only — the author decides; status unchanged.*

1. **Charlie ratifies R4/R5.** These are the load-bearing changes — they resolve
   Snapback's hardest open runtime question (async + write contention) with a
   mechanism that already exists in Ibex. The choice they make: the mutation
   execution boundary is now poll-driven with a buffering `ctx.db`, not
   eval-under-lock. Confirm or amend.
2. **Build the conformance test early** (`0009`/`0010`): an `async` mutation
   handler driven to completion via the poll loop, plus a contention test showing
   concurrent mutations don't serialize behind a slow one. This is the empirical
   proof the floor is met — the one thing the source-reading can't substitute for.
3. **A non-Claude family** (Gemini, or a second GPT-family pass) on `0003`/`0009`
   remains the way to harden these two load-bearing revisions. I won't run it
   externally without an explicit action.

---

## Re-review — 2026-06-25 (fifth Claude pass, reconciliation + cross-review dedup)

**Provenance.** Same family (Claude / Anthropic, Opus 4.8 (1M) via Claude Code).
Triggered by "review `0000`–`0012` adversarially, then reconcile against the
existing reviews and revise where it really improves the plan." This pass read
**all 24 existing review files** (`reviews/*.{claude,gpt-5}.md`) plus all thirteen
LLPs, deduplicated an independent adversarial review against them, and applied
three targeted edits the loop had not yet caught. Reviewed locally; nothing sent
externally.

> **Honesty (LLP 0005).** Same-family pass, not a new independent family. `0001`
> is Claude-authored, so the `0001` edit is editorial, not cross-family review;
> `0003`/`0004` are Codex-authored, so those edits are a genuine cross-family
> contribution. No `**Status:**` changed; all edits are **unratified** pending
> Charlie. `ref-check` passes (14 docs, 0 errors).

### Reconciliation result

Most per-document concerns an independent adversarial pass surfaces were **already
caught** by the existing Claude/GPT-5 reviews and folded into the docs (the
Contract/Exact definition gap, scale-to-zero vs. always-on tension, the
reactivity/read-set deferral, money/binary types, `skip(n)` pagination, the
`filter`-analyzability ambiguity, matcher cost and retention, hosting gated on the
unbuilt V8 path, the auth-first-class narrowing, offline revocation). The loop is
working. The **novel** findings, and what each became:

- **Mutation isolation across the released runtime lock [High].** The async/
  execution-boundary rewrite (4th pass, R5) introduced a buffering-then-commit
  model whose *isolation* semantics were unspecified — and both `0003` reviews
  predate R5 (they critique the superseded lock-held-for-whole-handler model), so
  nobody had reviewed the new model's concurrency. The author independently added
  a read-set + commit-time-validation (OCC) strategy to `0003` during this pass,
  which resolves the core hazard; **R9** adds the two pieces still missing from it.
- **Closest living peers absent from `0001` prior art [Medium].** → **R11**.
- **`0003`/`0004` concurrency-model wording inconsistency [Low-Medium].** → **R10**.

### Applied revisions (all unratified)

- **R9 [Medium] — `0003` §Execution and Write Semantics, two additive edits.**
  (a) The buffering bullet said reads "query the current database state," which
  leans toward the hazardous live-read reading; restated as a **consistent
  snapshot fixed at handler start, with the handler's own buffered writes layered
  on top (read-your-own-writes)** — the read side that pairs with the author's
  commit-time read-set check. (b) Noted that the mutation read-set and the realtime
  matcher's read-set are **one shared extraction mechanism** (build once, two
  consumers), tying concurrency-correctness to the reactivity bet `0004`/`0008`
  flag as the core unknown.
- **R10 [Low-Medium] — `0004` §Write Semantics.** Replaced "the server may
  serialize mutation execution … to preserve correctness" (which contradicted
  `0003`'s concurrent-handler/serial-commit model) with the observable-boundary
  framing and a cross-link to `0003`.
- **R11 [Medium] — `0001` new "Systems not yet surveyed (coverage gap)".** Named
  ElectricSQL, PowerSync, Turso/libSQL, Cloudflare D1 + Durable Objects, and
  Triplit/Ditto — the closest living peers to Snapback's SQLite↔Postgres
  partial-sync and scale-to-zero-SQLite bets — with structural (stable) reasons
  only, tagged `[observed]`/`[inferred]`, plus an open question, honoring the doc's
  standing "verify against primary sources" caveat.

### Left for the ratifying source (not edited)

- **"Agent-first DX wins over human ergonomics" is the corpus's least-evidenced
  foundational principle.** No Valet finding shows agent and human DX *diverging*
  with the agent winning — the chosen designs (no silent drops, honest typecheck,
  structured diagnostics) are good for both, so the tie-breaker never actually does
  work. Worth either an evidenced example or a softer statement.
- **A consolidated ratification ledger.** The "unratified pending Charlie"
  decisions now span `0000/0003/0006/0009/0011`; one ledger would beat per-doc
  footnotes as the count grows.
- **Design-ahead-of-evidence at scale.** ~7,400 lines of interlocking Draft prose
  over zero implementation; when the first prototype contradicts a premise the
  reconciliation cost is real (the async correction already rippled across four
  docs). A bias toward fewer, later, prototype-tested documents would reduce it.

### Noted (moved after my read; not re-reviewed)

- The author added **`0013-ephemeral-realtime-state.rfc.md`**, which closes the
  presence/cursor/ephemeral-state gap an independent read flags against `0008`
  (the whiteboard reference app's mechanism), and substantially expanded `0000`.

### Recommended next step

1. **Charlie ratifies or reverts R9–R11** alongside the author's own
   isolation-strategy addition to `0003` (they are the matched read/commit halves
   of one contract).
2. **Decide the two judgment calls** (agent-first-DX evidence; a ratification
   ledger) before more docs cross-reference the unratified decisions further.
3. **A non-Claude family** on `0003`/`0008`/`0013` remains the real
   loop-hardening step; not run here.
