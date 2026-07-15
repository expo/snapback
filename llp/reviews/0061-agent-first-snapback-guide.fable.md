**Reviewer family:** Claude (Fable)
**Provider / runtime:** fresh Claude Code workflow subagent — model claude-fable-5, reasoning effort max (explicit per-agent override); orchestrated by /llp-super-refine
**Date:** 2026-07-15
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** sub-agent

# LLP 0061 reviews — Claude family

## Round 1 — 2026-07-15

**Revision under review:** `llp/0061-agent-first-snapback-guide.rfc.md`, sha256 `34853b92c05140717590ba82dcffdbaeefb423b804b46c3326f571212c3cbf70` (committed at repo HEAD `777b80b`)
**Runtime detail:** workflow run wf_f7b16774-8ec, agent aee6f87c592a3a6c3, model claude-fable-5, reasoning effort max (explicit per-agent override); fresh context — no access to the orchestrating session, to archived reviews, or to the concurrent GPT-family round
**Verdict:** READY

### Review body (verbatim)

# Review: RFC 0061 — The Snapback Guide (Agent-First Documentation for Building on Snapback)

**Reviewer:** Claude Fable 5 (fresh context, independent pass)
**Revision reviewed:** repo HEAD `777b80b`, file sha256 `34853b92c05140717590ba82dcffdbaeefb423b804b46c3326f571212c3cbf70` (hash verified)
**Context gathered:** the RFC in full; Exact LLP 0365 in full (sibling checkout was readable); LLP 0000 in full; LLPs 0004, 0005, 0010, 0012, 0013, 0015, 0016, 0017, 0024, 0028, 0031, 0036, 0039, 0040, 0042, 0049, 0053, 0055–0060 (headers/status plus load-bearing sections); README.md and AGENTS.md in full; `docs/`, `demos/`, `packages/`, `admin-ui/` layout; `scripts/verify-local-proof` in full; diaries 0008, 0010, 0013; ENG-22218 in Linear; `ref-check --verbose` (passes, 62 docs, 0 errors). `llp/reviews/` was not read.

## 1. Overall assessment

This is a strong, well-evidenced RFC and I recommend proceeding with it. Its central decision — adopt Exact 0365's pattern, keep the corpus independent, define the seam explicitly, and scale the governance down to Snapback's stage with named re-adoption triggers — is the right call, and the document argues it from real differences (authorities, verification substrates, cadence, owners) rather than taste. The two claimed Snapback-shaped deltas are genuine improvements, not just adaptations: run-verified snippets are a real step past compile-verified and exploit exactly the property (`--memory`, scale-to-zero) Snapback has that Exact doesn't; and the server-as-distribution-channel insight (MCP resources versioned with the running server) is the correct analog of 0365's npm package for a backend product. Every load-bearing factual claim I spot-checked against the repository held up: the diary quotes are accurate and fairly contextualized, `docs/` does hold exactly one file, `SNAPBACK_VERIFY_EXACT` gating works as described, ENG-22218's "product-shaped APIs instead of hand-wired HTTP glue" characterization is verbatim-faithful, the LLP 0016 reconcile cadence exists as cited, and the admin console is in fact an Exact app. The concerns below are real but all minor or nit-level: some present-tense phrasing that outruns shipped reality (the MCP surface is a Draft design with zero implementation), a freshness mechanism that knowingly re-inherits the date-granularity flaw 0365 removed, a soft exit criterion, and a dropped ownership row. None undermines the decision quality or the plan's feasibility.

## 2. Strengths

- **The shared-vs-independent decision is properly adjudicated, not defaulted** (§Relationship to the Exact Guide). The rejection of a shared artifact names four concrete decoupling reasons, the shared-pattern table specifies *what form* each reuse takes, and the rule-of-three condition for upstreaming the conventions file is exactly the right escape hatch. This is the RFC's biggest decision and it is its best-argued section.
- **The motivation is evidence-backed, and the evidence is real** (§Motivation). I verified all three exhibits: diary 0010 lines 91–97 ("had no React-facing documentation; I had to read the Contract runtime's source"), diary 0008 line 359–361 ("load-bearing and undocumented; if someone adds a dynamic attr to `board-content`, the drag will start snapping"), and ENG-22218's description ("carrier work that lets the demo use product-shaped Snapback APIs instead of hand-wired HTTP glue"). The "what exists and why it isn't enough" table matches the repo (one file in `docs/`, README Demos is pointers, AGENTS.md is a contributor primer).
- **"Ran, not compiled" is a genuine trust upgrade that plays to a real asymmetry** (§Summary, §Design 3). Executing snippets against a `--memory` server through the existing `demos/_kit` server-process/client path is feasible with machinery that already exists (`startServer`, `SnapbackClient`, `packages/snapback-codegen`), and the Exact-availability gating correctly mirrors `scripts/verify-local-proof`'s existing `SNAPBACK_VERIFY_EXACT` behavior (verified against the script).
- **Proportionate governance with named, mostly countable adoption triggers** (§Design 2, §Design 3, §Design 5). "When the index misses a shipped capability twice" is a crisp, auditable trigger; naming the 0365 machinery as the *recorded next step, not a new debate* is good decision hygiene. The claim that the surface is hand-enumerable checks out (one route registry, four packages under `packages/`, one demo kit).
- **The diary loop closes an existing loop instead of inventing one** (§Design 5). The observation that Snapback already has what 0365 had to invent a retrieval eval to approximate — a standing friction ledger with a reconcile cadence (LLP 0016, verified: "Run the `llp-maintain`-style corpus audit before each demo lands") — is the most Snapback-native part of the design.
- **The honesty boundary is made mechanical** (§Goals 4, §Design 1 `targets:` frontmatter). Inheriting LLP 0060's must-not-claim posture (verified in README and the root ledger's 2026-07-15 ratification entry) as a checked frontmatter obligation on `auth/`, `realtime/`, `deploying/`, `operating/` pages is exactly how a documentation surface should carry a product's honesty rules.
- **The seam definition answers the diary-0010 gap by name** (§Relationship, seam bullet 2): connection-state semantics and generated-mutation-binding material are precisely what that diary could not find, and the three-surface framing (headless / Contract / React) matches both LLP 0005/0012 and the actual demo layout (`surfaces/{headless,contract,react}`).

## 3. Concerns

**C1 (minor) — The Summary's "surfaces Snapback already owns" overstates the MCP surface's existence.**
Evidence: §Summary point 2 says the guide "projects through surfaces Snapback already owns — the admin console (LLP 0017) and the MCP surface (LLP 0042)." The admin console is shipped (LLP 0017 Accepted; `admin-ui/` is a built Exact app). But LLP 0042 is Draft and I found no MCP server implementation anywhere in `src/` or `packages/` — the only traces are an `@ref` comment and a source-name string. The RFC's own Phase 2 hedges correctly ("Depends on the 0042 surface existing"), but the Summary reads as if both channels exist today, and the net effect is that out-of-repo authors have *no* shipped channel until an unbuilt dependency lands (the npm form is explicitly deferred, OQ5).
Resolution criterion: one sentence of wording — "owns the design of" / "the admin console (shipped) and the MCP surface (LLP 0042, Draft, not yet implemented)" — plus an explicit statement that out-of-repo distribution has no channel until Phase 2's dependency exists.

**C2 (minor) — The freshness mechanism deliberately re-inherits the date-granularity flaw 0365 r3 removed, in a repo where that flaw's trigger condition is the norm.**
Evidence: §Design 3 Freshness compares authority file changes "since the page's `reviewed:` date (computed from git)". Exact 0365 §1 replaced exactly this with review-locked content hashes because "same-day revisions and multi-entry `Revised:` blocks can't hide drift... dates are display/age metadata only, never identity." This repo's fleet demonstrably lands many same-day revisions (the root LLP's Revised header alone shows multiple same-day entries repeatedly; several sessions push to main in parallel). A date-granular signal will be blind on the busiest days — which are the days drift happens. The RFC names the hash-lock as the upgrade path and keeps this warning-only, so it is proportionate, but it adopts a *known-unsound* mechanism rather than a merely *lighter* one.
Resolution criterion: either (a) record the reviewed-at commit SHA (or full timestamp) in frontmatter and compare `git diff <sha>..HEAD -- <authorities>` — nearly as cheap as dates and strictly sound — or (b) an explicit sentence accepting date granularity's same-day blindness as a known limitation of the warning tier.

**C3 (minor) — The Phase 1 exit criterion is informal and unowned, in contrast to the RFC's otherwise crisp triggers.**
Evidence: §Plan Phase 1's exit is "checked informally against the next real demo build and its diary." 0365's equivalent is a pinned, repeatable protocol (fixture, seed intents, tool-use budget, rubric, artifact, owner, cadence). The diary-loop substitution is legitimate, but "informally" means nobody is obligated to evaluate it, no timeframe binds it, and there is no stated condition under which the informal eval's failure fires the 0365 retrieval-eval adoption (unlike §2's "misses twice" trigger for the registry).
Resolution criterion: name the observable and the trigger — e.g., "the next demo's diary must record either guide-page use on the paved path or a filed guide gap; two consecutive demo diaries recording guide-preventable friction adopt the 0365 retrieval-eval protocol."

**C4 (minor) — Guide-page ownership/review path was dropped from the 0365 pattern without comment.**
Evidence: 0365 §4.2/§Plan name a section owner per registry entry and route corpus authorship through PR review. RFC 0061's capability index carries "owning authorities (LLP + code)" — document/code pointers, not people/roles — and no section states who reviews guide prose before it lands. In a repo where multiple concurrent agent sessions push to main, a teaching surface with checked *structure* but unreviewed *claims* can acquire confidently wrong prose that `guide-snippets`/`guide-consistency` cannot catch (a snippet that runs can still teach an anti-pattern; a hosted overclaim outside the `targets:`-required directories is unchecked).
Resolution criterion: one stated rule — e.g., guide pages ride the LLP 0016 reconcile audit; or index rows name an owner; or guide-page changes require the same review posture as LLP edits.

**C5 (minor) — Phase 2's MCP projection has an unstated content-provenance question.**
Evidence: §Design 4 item 4 promises "read-only, server-versioned" guide resources "for exactly the server version it is talking to." A server running from a checkout can read `docs/guide/`; a packaged binary (LLP 0041) or hosted deployment has no checkout, so the corpus must be embedded at build time or shipped alongside — the same problem the admin console solved with the built `dist` snapshot. The RFC never says where the bytes come from or how the version stamp binds corpus to binary. This is Phase 2 scope, but it is the load-bearing mechanism of the RFC's second headline differentiator and deserves at least an open-question entry.
Resolution criterion: add it to §Open questions (or a scope note in §Design 4): embedded-at-build vs repo-read vs admin-dist-carried, and the version-stamping rule.

**N1 (nit)** — §Design 4 item 3 says "a short note in the kit README, since every demo author lands there" — `demos/_kit/` has no README today (verified); Phase 1 creates it rather than annotates it.
**N2 (nit)** — §Why now: "That knowledge currently lives in five specs and one diary" vs. the same paragraph's "LLPs 0055–0060" (six documents; and 0055/0056 are Review-status RFCs, not specs).
**N3 (nit)** — §Relationship's shared-pattern table lists `examples` among the copied frontmatter fields; §Design 1 then replaces it with `demos:`. The adaptation is explicit, but the table row should say "adapted (`examples` → `demos`)" for internal consistency.
**N4 (nit)** — "The LLP corpus (61 documents)": there are 62 including this RFC (ref-check: "62 LLP docs"). Defensible if read as "the corpus this guide would document," but easy to fix as "61 prior documents."
**N5 (nit)** — The headline "The guide's trust property is 'this ran'" (§Summary) is per-class, not corpus-wide: fixture-backed, partial-with-reason, and Exact-gated Contract-arm snippets carry weaker properties, as the RFC's own §Design 3 correctly specifies. "Runnable snippets' trust property is…" would be exact.
**N6 (nit)** — §Motivation's diary-0010 second quote ("direct `client.mutate` vs generated mutation binding; hand-wired handles vs…") is drawn from the acceptance-parity section describing *intended arm differences*, and is glossed as "an author adjudicating between paved road and hand-rolling." The surrounding diary text (lines 91–97) does fully support the RFC's point; the specific fragment chosen is just a slightly stretched fit for the gloss.

## 4. Suggestions

1. **Consider transclusion-from-demos as the Phase 1 default, not just OQ1's alternative.** The demos are already CI-verified end to end; marking regions in demo/backend/test files and transcluding them into pages gives "this ran" on day one with *zero new harness*, and makes behavioral drift structural (0365's own observation). The scratch-app assembler can then be built only for snippets no demo exercises — likely a small minority. This inverts the riskiest engineering item into an incremental one.
2. **Make OQ2 (teachable auth boundary) mechanical instead of judgment-based:** a rule that an `auth/` page may teach only behavior witnessed by the server's own capability/inspect reporting or an acceptance test (the README "Implemented now" list is the human mirror of this). That is the same move `targets:` makes for the local/hosted boundary, applied to the activation fence.
3. **Pin capability-index ids as the future MCP resource ids now.** The index is destined to become the Phase 2 projection manifest; saying so in §Design 2 costs one sentence and prevents an id-migration later.
4. **A cheap pre-MCP "server as channel" increment:** the local server already serves the admin console's static assets; serving `docs/guide/` read-only from a checkout-run dev server (a `/_snapback/docs/*` lane under LLP 0031's taxonomy) would let *adjacent* out-of-repo agents (pointed at a running dev server) read the guide long before the 0042 MCP server exists. Optional, but it de-risks C1's gap.
5. **Turn the anti-patterns list into a lint where greppable.** "Do not hand-wire HTTP glue for app data," "do not reuse a fixed acceptance port without killing the stale server" — several of these have mechanical signatures; a warning-tier check over `demos/` would close the diary loop without waiting for a diary. On-brand for the repo's feedback-loop philosophy (LLP 0000 §Design principles).
6. **Add a `sync/` or offline/local-first section (or an explicit expected-GAP note) to the illustrative outline.** Local-first with partial sync is one of Snapback's two required cross-cutting capabilities (LLP 0000), and author-facing surface already exists (retained queries/leases, outbox, app-owned optimistic reducers per the DK-10/P5 ledger). Its absence from the §Design 1 tree is the one conspicuous coverage hole in an otherwise complete map; the capability index will catch it, but the outline shapes Phase 1 priorities.
7. **Consider a "diagnostics and stable codes" page under `operating/`.** Structured `SNAPBACK_*` diagnostics are among Snapback's most distinctive agent-DX assets (LLP 0010) and exactly what an out-of-repo agent needs when something fails; no outline row currently owns them.
8. **Name LLP 0041 (packaged dev loop) in §Open questions 5** — the packaged CLI is the natural carrier for a future `@snapback/guide` payload and for C5's embedded corpus; tying the two deferred items together keeps one future decision instead of two.

## 5. Open questions

(Beyond the RFC's own five, which are well-chosen — OQ1 and OQ4 in particular.)

1. **Where do the guide bytes live for a server that isn't running from a checkout** (C5), and what binds the corpus version to the binary version the MCP resources claim?
2. **Who reviews guide prose, and on what cadence** (C4) — and does the guide corpus get its own line in the LLP 0016 reconcile audit checklist?
3. **What is the crisp adoption trigger for the 0365 retrieval eval** (C3), given the other heavy mechanisms each have one?
4. **Who lands the Exact-side seam row?** §Relationship asserts "Exact's data-layer row points at the Snapback guide," but 0365's Accepted text and its implementation program (ENG-25014..37) don't record that row; it needs a filed coordination item on the Exact side or it will silently not happen.
5. **Does `guide-snippets` get a fast standalone entry point** for docs-only edits, given `scripts/verify-local-proof` is a full clippy+cargo-test+acceptance run — or is the docs-edit loop expected to pay the full proof?

## 6. Readiness verdict

**READY**

All concerns are minor or nit-level polish: C1–C5 are each resolvable with a sentence to a paragraph of wording, one open-question entry, and one small mechanism substitution (date → SHA), and none blocks the decision this RFC exists to make — independent corpus, shared pattern, explicit seam, run-verified snippets, proportionate governance. The evidence base is accurate (every spot-checked quote, path, flag, issue characterization, and status held up against the repository), the plan's Phase 1 is feasible with machinery that already exists, and the deferred phases correctly depend on the corpus rather than the reverse.
### Orchestrator notes (round 1, outside the verbatim body)

Spot-checks of decisive claims: LLP 0042 is Draft with no MCP implementation in `src/`/`packages/` (C1 holds); `demos/_kit/` has no README (N1 holds); LLPs 0055/0056 are Review-status RFCs (N2 holds). Disposition in r2 (same-day revision of the RFC): C1–C5 and N1–N6 all addressed; suggestions 1 (transclusion default), 2 (witnessed-auth rule), 3 (index ids reserved as projection resource ids), 6 (sync/ section), 7 (diagnostics page), and 8 (LLP 0041 tie-in) adopted; suggestion 4 (pre-MCP static docs lane on the dev server) and suggestion 5 (anti-pattern lint) noted but not adopted — both are additive surface this RFC doesn't need to commit to, and the Phase 1 manifest keeps them cheap later.
