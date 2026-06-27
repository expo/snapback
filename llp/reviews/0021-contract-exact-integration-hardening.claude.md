# Review: LLP 0021 — Contract/Exact integration hardening

**Reviewed:** `llp/0021-contract-exact-integration-hardening.plan.md` (working-tree revision)
**Family:** Claude (Anthropic)
**Provider/runtime:** Anthropic API via Claude Code — model Opus 4.8 (1M context)
**Date:** 2026-06-27
**Redacted:** No — reviewed locally against the in-repo LLP corpus and diaries;
nothing sent externally beyond the model serving this session. The Exact-side
documents (Exact 0263/0265/0268) live in a separate repository and were **not**
reachable from here, so claims about their contents are unverified.
**Method:** Single-session read-and-critique, grounded by (a) direct term-by-term
verification of 0021's Snapback citations against LLP 0005, 0012, 0017, and 0020,
and (b) one delegated reader that fact-checked the eight Motivation/evidence
claims against diaries 0001/0002/0003. Requested as "`/llp-review 0021` revise if
you see ways to make it better"; this pass **applied** the revisions marked below.

> **Independence (LLP 0005) — this is the strong case, with one caveat.** 0021's
> Author line is "Charlie Cheever / **Codex**," so a Claude review is the genuine
> **cross-family** pass LLP 0005 wants — unlike the 0019 review, which was
> same-family and said so. For a Plan at ordinary-proposal stakes, 0005 §How much
> review to buy calls for "one round from a different model family than the one
> that drafted it, plus the author's critical pass" — a Codex draft plus this
> independent Claude review is exactly that, so the loop is appropriately sized.
> **The caveat:** this pass *edited* the document, so the review is no longer
> independent of the **revised** text. The critique below is independent of the
> original draft; the edits are not independently reviewed. A light close-out —
> your own critical pass over the revised text, or a fresh non-Claude read — would
> complete it. No separate GPT companion is needed for cross-family coverage here,
> because the author family already is GPT.

## Overall assessment

This is a well-grounded Plan that does the right job for its moment: it takes the
integration pain the diaries actually recorded and turns it into a phased delete-
the-glue program, without drifting into the backend-semantics territory that LLP
0012 and LLP 0020 own. Its citation base is unusually solid. Every load-bearing
Snapback claim I checked confirmed against its source: the **Online-vs-Parity**
honesty rule and its four Parity conditions (local handler execution, deterministic
replay, offline queueing, rebase-on-reconnect) are owned verbatim by LLP 0012
§Capability Manifest; the **`@expo/snapback/contract`** first-class adapter is named
in both LLP 0012 and LLP 0005, not invented here; the **current-value-plus-
subscription** hydration seam is LLP 0012 §Runtime State; and the entire static/
native build-recipe motivation (route registry, `@exact/router/types`,
`configFile: false`, subdirectory entry, basePath rewrite, Exact 0268) is sourced
from LLP 0017 §Static bundling and the native shell. The diary fact-check confirmed
six of eight evidence claims outright and the other two with only precision slips.

The strongest move is the **honest-capability spine**: Online-not-Parity, "Exact
optional for core work," and "if a second demo copies glue, the adapter has not
shipped" are all falsifiable, all inherited from the governing docs, and together
they keep the Plan from overclaiming. The intellectual honesty of folding in Diary
0003's *false-lead correction* — that the admin-console gap was fluency, not a
Contract ceiling — is what keeps the Plan aimed at integration ergonomics instead
of chasing a non-problem.

The weak spots are not the thesis but a cluster where the Plan **introduces a new
shared artifact without wiring it into the discipline its own corpus already
established**, **under-specifies the adapter against behaviors LLP 0012 says the
reference adapter must carry**, and **leaves two diary-recorded binding constraints
out of the phase text**. None breaks a phase; all are corrected below. The largest
single fix — reframing `ContractDataManifest` as a *projection registered into LLP
0012's pin* rather than a parallel schema — embeds a mild design interpretation and
is flagged for your confirmation.

## Strengths

- **Online-vs-Parity honesty** (*Design Principles → Online and Parity must be
  reported honestly*, Phase 2/4 gates). Verified against LLP 0012:307–315: an
  Online client speaks the wire protocol and runs mutations on the server (optional
  optimistic UI); Parity adds the four local-first conditions. 0021 inherits this
  exactly and gates the adapter on it. This is the spine that stops the first
  adapter from being mis-sold as local-first.
- **"The adapter is product, not sample code"** with a falsifiable test (*Design
  Principles*). "If a second demo copies hydration, provider, runtime-link, seed,
  Vite alias, descriptor, or native-envelope glue, the adapter has not shipped" is
  the right bar, and it traces straight to LLP 0005:70–72 and LLP 0012:84.
- **Phase 0 codifies before it replaces.** You cannot delete glue you have not
  inventoried, and the *wrong-server-shape capability diagnostic* (browser HTML
  served to a native request, or native envelope from a browser-only dev server) is
  a concrete, testable deliverable that turns the diaries' "generic JSON decode
  error" into an actionable fact (verified against Diary 0001).
- **Diagnostics To Standardize** is the most concrete section: each diagnostic is
  named, and the requirement that each carry its target surface (headless / browser
  / static web / native Exact / packaged admin) is exactly the discrimination the
  diaries lacked.
- **Exact-optional invariant** (*Design Principles → Exact should be optional*,
  Phase 3 gate "ordinary Snapback core tests still pass without Exact installed").
  Correctly inherits LLP 0017's and LLP 0012's "core tests must not require Exact."
- **Clean scope.** The does-not-own list routes language/renderer to Exact,
  contract to LLP 0012, core `ctx.db`/typed-artifact/read-set/realtime to LLP 0020,
  and relationship to LLP 0005 — each verified accurate.

## Concerns

Severity is the reviewer's; all were **applied** in the revise pass and are yours
to confirm or revert. C1's reframing is the one that embeds a design lean — confirm
it specifically.

- **C1 — `ContractDataManifest` was introduced outside LLP 0012's artifact
  registry, risking the parallel schema 0012 forbids. [Medium]** LLP 0012:104–109
  declares itself "the registry for the shared artifact shapes" and requires other
  LLPs to "register their additions into the `runtimeState`, `capabilityManifest`,
  and diagnostic-code families defined here … rather than forking a parallel
  schema." LLP 0017:247–264 followed this precisely for its admin facts. 0021's new
  `ContractDataManifest` instead listed "generated row shapes, syncability classes,
  read/write declarations, and required capabilities" — fields LLP 0012's schema and
  function manifests already pin — with no statement that it registers into the pin.
  Re-declaring those facts is how the binding silently drifts from the source of
  truth. *Resolves when:* Phase 1 frames the manifest as a Contract-side
  **projection** that *references* the shared LLP 0012 fields and carries only the
  Contract-specific binding facts, declares `artifactKind`/`schemaVersion` under LLP
  0012's machinery (in-place vs. later `schemaVersion`, as 0017 did), and its
  diagnostics register under LLP 0012's stable code families. **Applied** (Phase 1
  rewrite; Diagnostics closing sentence; Open Question). **Design lean — confirm:**
  calling the manifest a projection rather than a source of truth is a choice; I
  surfaced the projection-vs-new-artifact decision as the lead Open Question so you
  can overrule it.
- **C2 — Phase 2 under-specified the adapter against the race handling LLP 0012
  says it must carry. [Medium]** LLP 0012:354–361 enumerates the reference-adapter
  behaviors ("the reference adapter should carry the same behaviors"): queue
  pre-subscribe deltas and apply only those newer than the subscribe version, buffer
  before auth, full-resync-on-reconnect, return an empty array (not `undefined`) on
  error, treat skip/unsubscribe as a full stop, single combined pending count. These
  are the exact Valet bug class the adapter exists to fix once, yet Phase 2 listed
  none of them — inviting each surface to re-derive (or drop) them. *Resolves when:*
  Phase 2 requires the adapter inherit the LLP 0012 race-handling set. **Applied**
  (Phase 2 required changes).
- **C3 — the cross-plan sequencing gate to LLP 0020 was implicit. [Medium]** Phase
  1 binds to "generated Snapback function references," which *LLP 0020 Phase 1*
  produces (0020:154–158). A Plan whose job is sequencing should name that upstream
  gate so the two Plans do not each assume the other generates the typed references.
  Worth noting the converse as a *strength*: the adapter's **Online** path does
  **not** need LLP 0020 Phase 2 `ctx.db` handlers — it speaks to the live server,
  which already runs mutations — so 0021 can proceed in parallel with most of 0020.
  *Resolves when:* Phase 1 states the LLP 0020 Phase 1 dependency. **Applied** (Phase
  1 intro states the dependency; the Online-independence observation is noted here
  but left out of the doc to avoid over-editing — add it if you want it explicit).
- **C4 — two diary-recorded binding constraints and one diagnostic were missing
  from the phase text. [Medium]** The diary fact-check surfaced three findings the
  Plan did not capture: (a) Contract templates do **static field access**
  (`cell.text`), not dynamic `row[col]`, so any dynamic grid must be pre-flattened
  at the boundary (Diary 0003 L105–108) — a real constraint on Phase 1 row shapes;
  (b) the **silent partial-mutation** failure mode, where a bridge wired only a
  subset of mutations and a control (todo's checkbox) silently rendered read-only
  (Diary 0001 L228–231); (c) the confusing **component-level `use`** compiler error
  (`expected "=" in behavior instantiation`, Diary 0003 L80–85). *Resolves when:*
  (a) becomes an explicit Phase 1 row-shape concern, (b) a Phase 2 requirement that
  links generate from the full declared mutation set, (c) a Phase 5 Exact-side
  diagnostic. **Applied** (Phase 1, Phase 2, Phase 5 respectively).
- **C5 — the todo Contract surface was listed as a deliverable in both Phase 2 and
  Phase 4. [Low-Medium]** Phase 2's gate already had todo delete its bridge and
  import the adapter; Phase 4 re-listed "migrate the todo Contract surface to the
  adapter and generated manifest," so the reader could not tell which phase owns it.
  *Resolves when:* Phase 2 owns the todo→adapter migration (it is the proving
  ground) and Phase 4 only confirms todo also consumes the generated manifest, with
  Phase 4's migration scope being admin-ui + `_kit` retirement. **Applied** (Phase 4
  first bullet rescoped).
- **C6 — Phase 1's gate had surfaces "consume" the manifest before Phase 2 ships
  the consuming adapter. [Low-Medium]** The original gate read as if the todo/admin
  surfaces consume `ContractDataManifest` in Phase 1, but the adapter that consumes
  manifests ships in Phase 2 and the surfaces hold demo-local bridges until Phase
  2/4. *Resolves when:* Phase 1's gate scopes consumption to "produced from the
  Snapback artifacts and validated by the demo bridge or a test harness — surface
  adoption follows in Phase 4." **Applied** (Phase 1 acceptance).
- **C7 — Motivation mis-bucketed the basePath rewrite into the static-native-export
  chain. [Low]** The diary treats basePath as a *separate* "serve the web build
  under a subpath" finding (Diary 0002 L86–90), not part of the export-gating chain
  (route registry / router types / `configFile: false` / subdirectory entry). Lumping
  it in overstated the export chain. *Resolves when:* the basePath rewrite is its own
  Motivation bullet tied to `exactVitePlugin`'s missing basePath support. **Applied**.
- **C8 — Motivation padded the false-lead list with "data-driven styling." [Low]**
  Claim 7 listed data-driven styling among the things that "all worked once the labs
  were read," implying it had been a flagged false lead. It was not: it "worked first
  try" in Diary 0002 L61. *Resolves when:* it is dropped from the false-lead list
  (noted parenthetically as already-working). **Applied**.
- **C9 — Exact 0263/0265 were in Related but uncited in the body. [Low]** Exact 0263
  ("contract-data-bindings-for-snapback-and-backends") and 0265 ("…data-authoring-
  ergonomics") are the upstream Contract+Snapback data-binding RFCs — directly
  relevant to `ContractDataManifest` — and LLP 0012/0005 both cite them, but 0021's
  body cited only Exact 0268. *Resolves when:* Phase 1 aligns the binding shape with
  Exact 0263/0265. **Applied** (Phase 1). (Diary 0002, also in Related, *is* load-
  bearing — it is the sole source for the entire static-native-export chain — so it
  stays.)

## Suggestions (applied; non-blocking)

- **Graduation rule's home is LLP 0005 §Boundaries.** The "Contract gets a rich
  path, not private backend semantics" principle cited 0012/0020 for graduation, but
  the explicit "a Contract-motivated need enters core only when…" rule lives in LLP
  0005:210–240. **Applied** — cited alongside 0012/0020.
- **Pick the version-mismatch policy deliberately.** 0021 required mismatch
  diagnostics but not the warn-vs-hard-stop choice LLP 0012 §Versioning asks every
  consumer to make. **Applied** — added as an Open Question rather than pre-deciding.
- **Optimistic Online state must never be an authorization boundary.** A one-clause
  guard keeps a tempting adapter shortcut (trusting optimistic state for
  visibility) off the table; authorization stays server-authoritative. **Applied**
  (Phase 2).

## Open questions (for the author)

- **`ContractDataManifest` ownership + projection-vs-artifact is the highest-leverage
  unmade decision and gates Phases 1–2.** The Plan now elevates it. If it is a
  projection over LLP 0012 artifacts, it registers into 0012's pin; if it is a new
  cross-repo source of truth, it needs a shared boundary LLP mirrored in Snapback and
  Exact. Resolve before the shape is frozen — C1's applied framing assumes
  projection, and that is the assumption to confirm or overrule.
- **Does any Contract-specific binding fact belong in LLP 0012's framework-neutral
  manifests instead?** If a fact the `ContractDataManifest` carries is genuinely
  shared (a React/Expo binding would want it too), it belongs in 0012's manifests,
  not a Contract-named artifact — the same neutrality test 0012 applies to every
  adapter. Worth a deliberate pass when the field list settles.
- **Where does the basePath decision land** (upstream `exactVitePlugin` vs. a
  Snapback preset)? Already an Open Question; flagged because Phase 3 and Phase 5
  both touch it and a split owner invites the rewrite to be re-copied.

## Recommended next step

*Proposed only — you decide; this review changes no `**Status:**`.*

1. **Status stays `Draft`.** I did not change it. The revisions are precision,
   citation repair, cross-document wiring, and folding in your own diary evidence —
   not a new direction.
2. **The cross-family loop is appropriately sized for a Plan** (Codex draft +
   independent Claude review). The only honest gap is that this pass *edited* the
   text, so the revised version has not had independent eyes. A short critical pass
   of your own over the revised Phase 1/Phase 2, or a fresh non-Claude read, closes
   it — not strictly required at this stake level.
3. **Confirm C1's projection framing in particular.** Calling `ContractDataManifest`
   a projection registered into LLP 0012's pin (rather than a new source of truth) is
   the one edit that embeds a design interpretation. If you intend it as a standalone
   cross-repo artifact, revert that framing and answer the ownership Open Question the
   other way.
4. **Resolve the ownership Open Question before freezing the manifest shape**, since
   Phases 1–2 both depend on it.

---

## Re-review (2026-06-27): post-GPT-5 revision, verified against Exact 0263/0265 and Valet 0088

**Family:** Claude (Anthropic) — same family as the round-1 review above; this is a
dated re-review section, not an overwrite (LLP 0005 §Review artifacts).
**Provider/runtime:** Anthropic API via Claude Code — Opus 4.8 (1M context)
**Method:** Re-read the revised plan after the GPT-5 close-out pass landed, then
verified the new content **term-by-term against the now-reachable authoritative
sources** the first pass could not open: Exact 0263 (`…contract-data-bindings…`),
Exact 0265 (`…data-authoring-ergonomics…`), and Valet 0088 (`…snapback-contract-
integration…`). Applied the corrections marked below.

> **Loop status — the multi-family loop is now genuinely complete.** Codex authored;
> this Claude artifact was the independent cross-family review (round 1); a GPT-5 /
> Codex pass then closed out same-family (it correctly self-identifies as *not* the
> independent review, since the author is Codex). This re-review is Claude again, so
> it is same-family to round 1 — but it had something the earlier passes did not: the
> Exact and Valet repos were reachable this time, so it could check the cross-repo
> claims against source instead of taking them on faith. That is what it adds.

### What the GPT-5 pass got right (verified, not assumed)

The GPT-5-driven additions are accurate transcriptions of the authoritative Exact
RFCs — I checked each against source and they hold:

- the **descriptor-module seam** (Phase 1) is verbatim-faithful to Exact 0263 §4.2
  (provider manifest module + per-binding `*.query.ts`/`*.mutation.ts` descriptors;
  `use` resolves TS modules, never raw `.json`);
- **row-shape honesty** (Phase 1) is a near-verbatim transcription of Exact 0265 §5.3
  (table row aliases for direct queries, query-result aliases for projections,
  `unknown` only with a visible degraded-type diagnostic);
- **provider lifecycle / HMR dispose / dedupe** (Phase 2) matches Exact 0265 §5.1 +
  §5.7;
- **rejected-mutation rollback** (Phase 2) is verbatim to Exact 0263 §4.5, and 0263
  confirms the *provider* (Snapback's optimistic engine) owns rollback — so it is
  correctly a Snapback-side gate;
- `.contract-meta.ts` is a real Exact term (0265 §5.1).

So the content the author folded in is sound. The problems are at the **ownership
seam**, which neither round-1 (no Exact access) nor the GPT-5 pass fully reconciled.

### Concerns (new this pass)

- **RR1 — `ContractDataManifest` is Exact-owned; the plan (and both prior reviews)
  over-claimed it. [High] [Applied — corrects a prior edit; please confirm]** Round 1
  and the GPT-5 pass both converged on "register `ContractDataManifest` into LLP
  0012's pin, give it `artifactKind`/`schemaVersion`." Verified against source, that
  is wrong: **Exact 0263 §4.2 defines `ContractDataManifest` as the Contract-facing
  schema the compiler binds against** (`manifestVersion`), and **decision 7 promotes
  it to `exact-contracts.json`** with LLP 0179 owning the provider-side seam. 0263 is
  explicit that Snapback is "not required to own the cross-backend schema"; its job is
  "a small adapter that projects a Snapback manifest into `ContractDataManifest`." The
  *projection* framing both passes reached for was right; the *direction* was
  backwards. *Resolved by:* Phase 1 now says the shape is Exact-owned, Snapback owns
  the **projection/codegen** that emits Exact-shaped modules from its native LLP
  0012-pinned manifest, the `artifactKind`/`schemaVersion` discipline stays on the
  **native** manifest, and the projected manifest carries Exact's `manifestVersion`.
  Because this reverses an edit two prior passes endorsed, confirm the reading against
  Exact 0263 (same author) before freezing.
- **RR2 — the central Open Question was partly stale. [Medium] [Applied]** "Is
  `ContractDataManifest` specified in Snapback, Exact, or a shared boundary LLP?" is
  already answered on Exact's side by 0263 decision 7. *Resolved by:* the Open
  Question now asks the live thing — how the native LLP 0012 manifest **maps onto**
  the Exact schema and where the projection adapter lives.
- **RR3 — three-repo ownership collision with Valet LLP 0088. [High] [Applied]** Exact
  0263/0265 repeatedly name **Valet LLP 0088 ("Snapback Contract Integration")** as
  the owner of exactly this Snapback-side adapter work — `@expo/snapback/contract`,
  `openSnapbackContractRuntime`, generated descriptors, headless boot, initial
  snapshot, the Vite recipe. Valet 0088 is a detailed, multiply-reviewed Draft RFC in
  the `valet` repo (Status: Draft; "This RFC owns what **Snapback must ship**"), and
  Snapback's own LLP 0006 already cites 0088's `openSnapbackContractRuntime`. Yet
  0021 did not mention 0088. Left unreconciled, this produces two divergent adapter
  specs across three repos (snapback 0021 / valet 0088 / exact 0263+0265). *Resolved
  by:* 0088 added to Related; a Summary note framing 0021 as 0088's successor; and an
  Open Question on dividing or handing off ownership so the Exact references resolve.
  **The author should decide the lineage deliberately** — supersede 0088, or run it
  as a coordinated sibling — because 0088 already designed much of Phases 1–3
  (S1a/S1b staging, scoped install, generated runtime callables, browser WASM
  default) and 0021 risks re-deriving or diverging from reviewed work.
- **RR4 — the conformance suite is Exact-owned. [Low-Medium] [Applied]** The
  DataProvider conformance suite is an Exact deliverable (Exact 0263 §6 S4, §7
  `data-provider-conformance`); Snapback's job is to *pass* it, not build a
  Snapback-local harness that drifts. This was the GPT-5 pass's own open question that
  did not make it into the doc. *Resolved by:* Phase 2's gate now names the suite as
  Exact-owned (0263 §6 S4).

### Recommended next step

*Proposed only — you decide; this review changes no `**Status:**`.*

1. **Stays `Draft`.** The remaining blockers are no longer internal review gaps —
   the plan is well-reviewed across three model families now. They are **cross-repo
   reconciliations**: the `ContractDataManifest` ownership (now corrected toward Exact
   0263) and the Valet LLP 0088 lineage.
2. **Confirm RR1 against Exact 0263.** It reverses a direction two prior passes
   endorsed; since you author Exact too, a one-line confirmation that 0263 owns the
   schema and Snapback owns the projection settles it.
3. **Decide the Valet 0088 lineage (RR3).** Supersede-and-hand-off, or coordinated
   sibling with an explicit ownership split. This is the single highest-leverage
   decision left for this Plan, because it determines whether Phases 1–3 are new work
   or a port/continuation of already-reviewed 0088 work.
4. Once RR1 and RR3 are settled, Phase 1 is implementation-ready.
