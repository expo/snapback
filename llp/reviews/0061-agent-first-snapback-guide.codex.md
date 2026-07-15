**Reviewer family:** OpenAI (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.4, model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, non-interactive `codex exec`; orchestrated by /llp-super-refine
**Date:** 2026-07-15
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** codex exec (read-only), session id 019f67e9-c76b-7c31-b737-e314c0f2db93

# LLP 0061 reviews — GPT family

## Round 1 — 2026-07-15

**Revision under review:** `llp/0061-agent-first-snapback-guide.rfc.md`, sha256 `34853b92c05140717590ba82dcffdbaeefb423b804b46c3326f571212c3cbf70` (committed at repo HEAD `777b80b`)
**Runtime detail:** codex-cli 0.144.4, model gpt-5.6-sol, model_reasoning_effort="ultra", approval never, sandbox read-only, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating session, to archived reviews, or to the concurrent Claude-family round
**Verdict:** NOT READY

### Review body (verbatim)

# 1. Overall assessment

I reviewed RFC 0061 at HEAD `777b80b` and verified the supplied SHA-256. I also read the accessible Exact RFC 0365 and the requested Snapback authorities and repository evidence.

The proposal is a good idea, and its central architectural decision is sound: Snapback needs an intent-oriented builder guide, and its content should remain independent from Exact’s guide while sharing conventions at the seam. Markdown first, verified examples, explicit capability gaps, and later MCP/admin projections are the right broad shape.

The current plan is not yet ready for acceptance. It promises complete, current, target-honest guidance while deliberately omitting the mechanisms needed to establish those properties. The largest gaps concern capability completeness, maturity/profile modeling, freshness identity, retrieval evaluation, safe process guidance, and the feasibility of the out-of-repo distribution claim. These are repairable without abandoning the proposal.

# 2. Strengths — with section citations

- **It identifies a real genre and discovery gap.** `docs/` has exactly one tracked file, while README, AGENTS, demos, diaries, and LLPs each serve different purposes. Existing demo documentation is useful but fragmented and lacks an intent-to-example index. A dedicated guide is justified. (RFC 0061 §Motivation, “What exists and why it isn't enough”; §Goals 1–2.)

- **Independent content with an explicit Exact seam is the right ownership model.** Snapback should own backend semantics, targets, auth, generated bindings, and the Snapback adapter; Exact should own Contract language and UI authoring. Combining the prose corpora would couple unrelated authorities and release cadences. (RFC 0061 §Relationship to the Exact Guide.)

- **Live-server verification is a strong Snapback-specific adaptation.** The existing kit supplies a structured, vacuous-pass-safe harness and provenance-aware server lifecycle, and the card-game auth acceptance already demonstrates fixture-backed execution on an in-memory, OS-assigned-port server. The plan is technically feasible and offers more confidence than syntax-only examples. (RFC 0061 §Summary, item 1; §Design.3; LLP 0010 §Acceptance Strategy; LLP 0012 §Headless Integration Contract.)

- **Target honesty and explicit gaps are correct priorities.** Local auth is real, while hosted auth is explicitly not implemented; making those boundaries visible to authors is essential. GAP rows are also preferable to silence. (RFC 0061 §Goals 1 and 4; §Design.1–2; LLP 0060 §Status.)

- **The sequencing is sensible.** Corpus, conventions, index, and verification precede MCP and admin rendering. This preserves the principle that content and its truth checks are the product; presentation is secondary. (RFC 0061 §Design.4; §Plan; Exact LLP 0365 §Plan and §Alternatives.)

- **The diary loop is valuable evidence and maintenance input.** LLP 0016 already provides a repository-specific way to discover author friction, and turning such friction into guide gaps is useful. It should supplement, rather than replace, a controlled retrieval evaluation. (RFC 0061 §Design.5; LLP 0016 §Reconcile cadence.)

# 3. Concerns

### [material] “Complete capability awareness” is not kept closed

**Evidence:** Goal 1 promises that the index exposes every author-facing feature, including uncovered ones. Design §2 instead uses a hand-authored Markdown table, seeded by a one-time sweep, and waits until the index misses a shipped feature twice before adding mechanical inventory joins.

That repeats the exact omission problem the guide is intended to solve: an omitted capability has no page, frontmatter, or GAP row through which a check can discover it. Exact LLP 0365 therefore requires a code-surface witness for each shipped capability and recurring joins against enumerable surfaces.

Snapback already has cheap enumerable inputs: the route registry, host-operation IDs, package exports, generated manifests, codegen declarations, and CLI surfaces. The repository is also less simple than “four packages” suggests: there are four package-area directories but only three npm manifests, all private, while `snapback-harness` is not an npm package.

**Resolution criterion:** Either:

1. require a code witness for every shipped capability and add day-one joins for existing enumerable boundaries, mapping every discovered item to a capability or `notAuthorFacing`; or
2. weaken Goal 1 to an explicitly best-effort index.

Waiting for two author failures is not an acceptable trigger for a property described as complete.

### [material] Target metadata does not model actual availability or maturity

**Evidence:** Goal 4 applies to every page touching target-dependent behavior, but `guide-consistency` only requires `targets:` in four directories. Backend actions, client adapters, testing recipes, and getting-started pages can all be target-dependent.

More importantly, a target name alone cannot express the auth surface:

- LLPs 0055 and 0056 remain in Review with partially landed scopes.
- LLPs 0057–0060 are Accepted, but their usable behavior varies by auth mode, protocol, deployment profile, and activation state.
- LLP 0060 explicitly says there is no hosted auth deployment.
- The RFC nevertheless prioritizes pages covering principals, scoped grants, barriers, and leases without a checked maturity or activation field.

This risks turning security design into apparent author-facing product guidance.

**Resolution criterion:** Require every page to declare either `targets:` or an explicit target-independent marker. Add checked availability metadata covering at least maturity (`shipped`, `partial`, `design-only`, `gap`), target, profile/auth mode, required protocol, and activation fence. Every security claim should point to a current code/capability witness and executable acceptance evidence. Agent principals and scoped grants should remain GAP material until an author can exercise them.

### [material] Date-based freshness is knowingly unable to establish currentness

**Evidence:** Design §3 compares authority change dates with a page’s `reviewed:` date. This can miss same-day changes, rebases, multiple revisions on one date, and manual date bumps. Exact LLP 0365 explicitly treats dates as display metadata and uses review-gated authority hashes because these cases hide drift.

The proposal calls hash locks a later “heavy” mechanism, but storing authority blob hashes or a reviewed commit is small compared with writing and running the proposed snippet harness.

**Resolution criterion:** Record the exact authority blob hashes or commit identity against which each page was reviewed, from day one. Regeneration must not update that baseline automatically. Freshness may remain warning-only initially, but the warning must use an identity capable of detecting all changes.

### [material] The Phase 1 discovery exit criterion is anecdotal

**Evidence:** Phase 1 relies on the next real demo and its diary as an informal evaluation. A diary is post hoc, uncontrolled, and not guaranteed for every ordinary build—AGENTS requires one when building or substantially changing a demo. It cannot establish that the guide pointer caused an agent to discover the paved road.

Exact LLP 0365 defines a modest repeatable protocol: cold context, several seed intents, a tool budget, success criteria, a retained transcript, an owner, and a cadence.

**Resolution criterion:** Define a repeatable cold-agent evaluation with at least two or three representative intents. It should record whether the agent loaded the relevant pages, used the paved technique, and avoided the named anti-patterns, with a transcript retained as evidence. Run it at Phase 1 exit and after discovery-wiring changes. Diaries should remain a complementary source of new cases.

### [material] The out-of-repo and “server-versioned” distribution model is underspecified

**Evidence:** LLP 0042 is Draft and describes an external MCP control-plane process that starts or attaches to a Snapback server. It does not establish that guide bytes come from the running server, and whether app-data catalogs are static or server-served remains open. Without an embedded/server-served corpus and identity handshake, an MCP package can expose documentation from a different build than the server it attached to.

RFC 0061 also lacks a Phase 1 guide manifest; an undefined “projection manifest” first appears in Phase 2. There is therefore no common interface carrying page hashes, navigation, capability state, verification status, or verified-against versions to MCP and admin consumers.

Finally, documentation availability alone does not enable out-of-repo building. The three npm packages are private, current demos invoke codegen or adapters by repository-relative paths, and no supported external SDK acquisition path is defined.

**Resolution criterion:** Either scope the initial guide explicitly to authors inside a Snapback source checkout, or specify:

- a supported CLI/SDK/codegen acquisition path;
- a Phase 1 generated guide manifest;
- exact guide/server build identity and mismatch behavior;
- where the corpus is embedded or served;
- and a pre-server bootstrap channel such as `snapback guide`, an installed bundle, or a static rendering.

MCP can then be a version-aligned projection for connected authors rather than an assumed primary bootstrap channel.

### [material] The stale-port anti-pattern recommends an unsafe action

**Evidence:** Design §1 says not to reuse a fixed port “without killing the stale server.” The cited diaries support the opposite discipline: Diary 0010 moved to isolated ports and explicitly killed nothing it did not own; Diary 0008 proposed provenance checks. The current `demos/_kit/server-process.mjs` verifies bundle/binary provenance, otherwise selects an OS-assigned port, and only tears down the child it launched.

An agent following the proposed wording could terminate another checkout’s server or an unrelated user process.

**Resolution criterion:** Replace the rule with: use port `0` or an isolated port by default; reuse only after provenance verification; stop only a process whose ownership token/process handle the current harness possesses. The guide should transclude or directly derive this recipe from the current lifecycle helper.

### [minor] The Exact-dependent verification contract needs precise wording

**Evidence:** The blocking GitHub workflow currently sets `SNAPBACK_VERIFY_EXACT=1`, so executing Contract snippets in CI is feasible. The RFC does not make that required profile part of its acceptance contract. Conversely, `SNAPBACK_VERIFY_EXACT=0` skips the late Contract/admin acceptance block but does not make the complete local proof Exact-free: `check-required-surface-builds.mjs` still installs and builds Exact-backed required surfaces unconditionally.

**Resolution criterion:** State that merge/release CI must run guide snippets with `SNAPBACK_VERIFY_EXACT=1`, while local guide verification may conditionally skip Contract fences. Record skipped versus verified status and the Snapback/Exact versions in the guide manifest. Reword “core-only local iteration stays core-only” to refer narrowly to the guide runner.

### [minor] Several motivation claims overinterpret or outdate their evidence

**Evidence:**

- Diary 0010 really does report missing React-facing connection-state documentation, but it was an intentional React control-arm exercise. It does not show that the author accidentally chose hand-wiring because generated bindings were undiscoverable.
- The Diary 0008 quotation concerns Exact DOM-mirror gesture glue and is later superseded in the same diary by framework-owned paging/removal of that glue. It is historical Exact evidence, not a current Snapback seam.
- ENG-22218’s “product-shaped APIs instead of hand-wired HTTP glue” quotation is accurate, but `demos/graffiti/README.md` already explains its generated durable/live and ephemeral paths. The problem is fragmented discovery, not absence of any teaching surface.
- Several demos have substantial READMEs and are not literally “silent.”
- HEAD has 62 numbered root LLPs including 0061, not 61; “61 pre-existing LLPs” would be accurate.
- LLPs 0055–0060 are six documents, three RFCs and three Specs, not “five specs.”
- AGENTS requires diaries for demo creation or substantial change, not every demo build.

**Resolution criterion:** Reframe the evidence as “rich but fragmented, uneven, and not intent-indexed.” Keep the accurate connection-state and ENG-22218 facts, replace the stale Exact example with current Snapback-owned friction, and correct the counts and diary cadence.

### [minor] The claimed shared schema and reciprocal seam are not yet coherent

**Evidence:** The RFC says the guides use the same frontmatter fields, then replaces Exact’s `examples:` with `demos:` and adds `targets:`. Its field list omits Exact’s required `title`, `order`, and `audience`, and no schema artifact appears in the tree or Phase 1 deliverables. It also says the Exact link policy is copied verbatim while leaving a new cross-repository link class unresolved.

The proposed reciprocal Exact capability row has no Exact-side deliverable or owner, and the current Exact registry’s required local witness does not naturally represent a Snapback-owned implementation.

**Resolution criterion:** Define a complete schema artifact and describe it as a compatible core plus Snapback extensions. Prefer retaining `examples:` with demo paths and adding `targets:`. For Phase 1, make the seam one-directional from Snapback to a versioned Exact guide reference unless a separately owned Exact amendment defines the reciprocal row and cross-guide URI.

### [minor] Canonical migration and GAP ownership are deferred unnecessarily

**Evidence:** The sole current author document, `docs/contract-exact-integration.md`, is substantial and overlaps the planned client pages, yet its disposition remains an open question. GAP rows likewise have filing pointers but no required owner or review date.

**Resolution criterion:** Require same-change absorption plus a pointer stub when replacement pages land. Every GAP or deferral should name an owner and review date, with expired deferrals reported by consistency checks.

# 4. Suggestions

- Generate `docs/guide/guide-manifest.generated.json` in Phase 1. Make it the sole input to MCP, admin rendering, search, and any future package. Include content hashes, authority locks, target/profile/maturity, capability witnesses, GAP ownership, snippet status, and `verifiedAgainst` versions.

- Treat the capability index as a **negative-space contract**: every enumerable author-facing surface must be `documented`, `GAP`, or `notAuthorFacing`. This is stronger and cheaper than attempting to infer completeness from existing pages.

- Use an embedded guide bundle to power `snapback guide`, MCP resources, and the admin tab. A server response should report both `serverBuildId` and `guideContentHash`; consumers should surface mismatches rather than silently combining versions.

- Add a rendered “truth horizon” to every page: shipped target/profile, required protocols, activation state, last verified build, and explicit non-claims. This is especially valuable for auth and Cloudflare guidance.

- Lead auth pages with author intents—authenticate a function, scope rows to the current principal, retain authorized offline data—while keeping barrier, epoch, grant, and lease protocol internals in secondary reference sections.

- Prefer transcluding marked regions from tested fixtures and demos. For prose-sized standalone snippets, require semantic assertions rather than merely successful invocation. Preserve the existing harness’s provenance, isolated-port, structured-report, and vacuous-pass properties.

- Turn historical diary failures into a small “friction replay” suite. Periodically sample an old workaround and ask a cold agent to solve the intent using only the current guide. That tests both currentness and discoverability without making every diary the eval.

- Keep literal renderer reuse conditional on a supported dependency boundary: publish/version `@exact/markdown`, vendor a stable renderer, or describe Phase 3 as pattern reuse rather than promising a currently unavailable package path.

# 5. Open questions

1. What exact boundary defines an “author-facing capability,” and which existing registries/exports/commands constitute its enumerable inventory?
2. What metadata is required to distinguish target, deployment profile, auth mode, protocol negotiation, activation state, and implementation maturity?
3. Which parts of LLPs 0055–0060 have executable author-facing witnesses today, and which must remain GAP or design-reference material?
4. Is the initial audience limited to a Snapback checkout, or what supported CLI/SDK/codegen installation path makes out-of-repo building real?
5. Does guide content live in the binary/server, the MCP package, or both, and what exact identity handshake guarantees version alignment?
6. What is the smallest repeatable retrieval evaluation, who owns it, and how often is it rerun?
7. Is the cross-repo seam initially one-way, or who owns the coordinated Exact registry/schema amendment?
8. Which Phase 1 pages are essential for a coherent first release, and should React/auth breadth follow after getting-started, live queries, testing, and the Contract adapter are proven?

# 6. Readiness verdict

NOT READY
### Orchestrator notes (round 1, outside the verbatim body)

Spot-checks of decisive claims: the three `packages/*/package.json` manifests are all private and `snapback-harness` has none; `.github/workflows/local-proof.yml` sets `SNAPBACK_VERIFY_EXACT: "1"`; every demo has a README including `demos/graffiti/` (the r1 "silent demos" claim was overstated as the review says); the diary 0008 quote's context is Exact DOM-mirror gesture glue (Exact-side, historical). All held. Disposition in r2 (same-day revision of the RFC): all six material concerns addressed (reviewed-commit freshness baseline; pinned retrieval eval; checkout-scoped audience + Phase 1 guide manifest + Phase 2 identity-handshake obligation; corrected stale-port rule to the kit's provenance/OS-assigned-port discipline; witnesses + two day-one joins + honest Goal 1 wording; `targets:` everywhere + `maturity:` + witnessed-auth rule) and the three minors (VERIFY_EXACT contract wording; evidence reframing and count fixes; schema artifact + `examples:` retained + one-directional seam + decided absorption + GAP owners). Partially adopted rather than in full: M1's option 1 — day-one joins cover only the two already-declared machine-readable registries (route registry, host-ops); other surfaces stay hand-maintained with required witnesses and the escalation trigger, because joining them would first require building the enumerations, which is the deferred machinery. Goal 1 was reworded to claim completeness only over the joined surfaces (the review's option 2) so the claim and the mechanism now match.
