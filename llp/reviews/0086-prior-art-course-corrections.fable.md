**Reviewer family:** Claude (Fable)
**Provider / runtime:** Claude Fable 5 (`claude-fable-5`) — fresh subagent context spawned via the Claude Code Agent tool from the orchestrating /llp-super-refine session; the orchestrating session did not author the document and the subagent had no access to the concurrent Codex round or to llp/reviews/
**Date:** 2026-07-23
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** subagent-runner (fresh context per round; no access to the concurrent Codex-family round or to this artifact)

# LLP 0086 reviews — Claude (Fable) family

## Round 1 — 2026-07-23

**Revision under review:** `llp/0086-prior-art-course-corrections.plan.md`, sha256 `521adc128eba6b4192f22d77efae0f4763ae1167e811b6a85eb3c2cd4f00364d` (untracked working-tree file), at HEAD `d408d3fd` (both MATCH the pinned values).
**Runtime detail:** fresh Fable subagent, 30 tool uses, ~364 s, ~99k tokens; files verified against are listed at the end of the review body.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

Commands run:

```
shasum -a 256 llp/0086-prior-art-course-corrections.plan.md
git rev-parse --short HEAD
```

Observed: `521adc128eba6b4192f22d77efae0f4763ae1167e811b6a85eb3c2cd4f00364d` — **MATCH** against the expected sha256. HEAD observed `d408d3fd` — matches the expected HEAD (concurrent advance permitted anyway).

2. **Overall assessment**

This is a good plan, and mostly an honest one. I verified every load-bearing evidence claim in CC-1 through CC-7 against LLP 0082–0085 and LLP 0001, and the translation of the *headline* findings is faithful — in several places carefully so (CC-4 preserves 0082's "shipped-status unverified" hedging as "had not verifiably shipped"; CC-3 correctly frames the LLP 0053 differentiator as conditional on proof; CC-7 correctly imports Jazz's history/branching demand while explicitly refusing its no-GC failure mode). The two governing constraints (no ratified decision reopened; review-gating on Draft evidence) are the right spine for a plan built on unreviewed research, and I found no place where a ratified decision is actually reopened — CC-2's relationship to LLP 0014's one-way doors is handled with unusual care, mostly by delegation to LLP 0087, which explicitly reserves door-2 re-ratification to LLP 0014.

Two things keep it from READY. First, the plan is already stale against its own elaboration on its own authorship date: LLP 0014 carries the ENG-25387 refresh (Revised 2026-07-23, working tree), and LLP 0087's Phase 0 progress note marks CC-2 step 1 **Done** and reports first spike results plus two research updates (published Dynamic Workers pricing since 2026-05-26; current docs carry no beta caveats) that undercut the operative predicate of CC-2's decision gate ("while facets are beta") as written here. The plan's Sequencing still lists CC-2 step 1 under "Now." Second, the plan presents itself as *the* conversion of the research batch into work items ("This plan turns those findings into work items"), but a visible cluster of the research documents' "adopt / strongly consider" pointers is silently dropped — schema lockdown (0082→LLP 0037/0024), output-gate vocabulary and bookmarkable versions (0083→LLP 0007/0008), the alarms-are-lossy confirmation (0083→LLP 0028/0070), the partyserver positioning decision (0083→LLP 0013), Triplit's schema-push comparison and Cambria lenses (0084/0085→LLP 0037), and the cite-the-retreat rationale updates (0085→LLP 0008/0011). The model plan, LLP 0079, solved exactly this with its SC-3 doc batch; this plan needs the equivalent or an explicit exclusion record. Both fixes are cheap and mechanical; neither invalidates the plan's structure.

3. **Strengths**

- **Evidence citations check out essentially everywhere.** CC-1's remote-MCP/platform-API characterization matches LLP 0082 §Agent-first DX (lines 264–289) verbatim in substance; CC-2's dates (Worker Loader open beta 2026-03-24, Facets beta 2026-04, Dynamic Workflows 2026-05) match LLP 0083 lines 25–34 and 135–147; CC-3's triangle (0053 Accepted — verified in the header; Instant confirmed-absence on revocation eviction, 0082 lines 214–218; Triplit's shipped eviction protocol and death, 0084 lines 80–115) is exactly what the research says; CC-7's framing matches 0085 lines 229–236.
- **The code claim in CC-2 is real.** The `snapback-app` esbuild alias exists (`/Users/ccheever/projects/snapback/cloudflare/scripts/generate-deployment-identity.mjs:64`, `cloudflare/src/coordinator.js:48`), and per-app wrangler configs (`wrangler.jsonc`, `wrangler.handler.jsonc`, `wrangler.all-aboard.action-handler.jsonc`) confirm apps are deploy-time artifacts on the hosted target — the "wrangler deploy cycles, not data operations" framing is accurate and is the right articulation of why CC-2 is urgent-shaped.
- **No ratified decision is reopened.** LLP 0053 stays Accepted and CC-3 only proves it; LLP 0014's everything-on-DOs resolution is untouched, and the facets question is routed through LLP 0087's explicit door-2 re-ratification path rather than decided here; LLP 0033 is used as an input to the lock-in accounting, not revised.
- **The standing-refusals section is genuinely grounded.** Each refusal maps to verifiable prior-art text: LLP 0068's document-profile carve-out (0068 lines 20–57 already absorbed the 0082–0085 corroboration), Ditto's mesh segment (0084 lines 186–197), Instant's EAV pathology (0082 lines 124–128, 377–383).
- **The shape follows LLP 0079 faithfully** — status board, per-item Evidence/Work/Exit, Sequencing, Watch items, Open questions — which makes the corpus's plan genre legible.
- **CC-4's "hardest to retrofit first" sequencing logic is sound**: LLP 0011 currently contains no pushdown/compilability requirement and no guest-auth path (verified by search), so the additions are additive and cheap now, and Instant's 2024→2026 unshipped pushdown is the right cautionary evidence.
- **Honest recording of unresolved decisions** in Open questions (CC-1 surface shape, CC-2 ownership/time box, CC-7 scoping), rather than premature resolution.

4. **Concerns**

1. **Major — Dropped research findings with no exclusion record.** The plan claims to turn the batch's findings into work items, but at least seven "adopt / strongly consider" items from the evidence documents appear nowhere in it (no CC item, no watch item, no refusal): schema lockdown against rogue agents (0082 lines 359–361 → LLP 0037/0024 — particularly odd to drop given the plan's agent-provisioning emphasis in CC-1); output-gate vocabulary and keep-bookmarkable-versions (0083 lines 335–339 → LLP 0007/0008); treat-platform-alarms-as-lossy (0083 lines 341–343 → LLP 0028/0070); the partyserver positioning decision (0083 lines 347–350 → LLP 0013); Triplit's compatibility-classified schema pushes (0084 lines 234–236 → LLP 0037); Cambria lens migrations (0085 lines 242–244 → LLP 0037); citing the Jazz/Electric retreats in LLP 0008/0011 rationale sections (0085 lines 224–228 — CC-6 covers only the competitive-material half). I verified by search that none of "lockdown", "output-gate", "partyserver", "Cambria/lens", or "alarm" (outside the CC-2 spike bullet) occurs in the plan, and LLP 0037/0013/0007/0028/0003 own no work item despite 0037 and 0013 sitting in the Related header. **Resolution:** add a CC-8 doc-batch item in the LLP 0079 SC-3 style sweeping the small documentation absorptions (each a one-paragraph revision to its owning LLP), and/or an explicit "Considered, not planned" list naming anything deliberately excluded with a reason. Silence is the one thing a conversion plan may not do with its inputs.

2. **Moderate — CC-2's state is stale against LLP 0014 and LLP 0087 as of the plan's own date.** LLP 0014 already carries the ENG-25387 platform-fact refresh (Revised 2026-07-23: dynamic-code fact updated, storage-billing enforcement date, write/read price-asymmetry design note, door-2 premise-change annotation — verified at `llp/0014-cloudflare-strategy.rfc.md` lines 8–15, 107–109, 129–137), and LLP 0087's Phase 0 progress note (lines 140–166) marks step 1 **Done**, reports spike-first-results in `cloudflare/spike-facets/`, and adds two findings — Dynamic Workers pricing published/billing since 2026-05-26, and current docs carrying **no beta caveats** — that directly bear on CC-2's gate predicate "No hosted rearchitecture starts while facets are beta." LLP 0087's authorization note (lines 129–136) even anticipates *amending this document's CC-2* to handle the GA case. Yet 0086 lists CC-2 step 1 under Sequencing "Now" as pending and states the beta prohibition without acknowledging the open GA determination. **Resolution:** mark CC-2 step 1 done (pointing at LLP 0014's dated revision entry, with ENG-25387 closure as the residue), restate the gate predicate the way 0087 does (beta prohibition binds until LLP 0014 records a dated GA determination), and reduce CC-2's Work section to a summary plus pointer — 0087 now owns the elaborated spike spec, and maintaining two divergent copies is exactly the drift this shows.

3. **Moderate — Review-gating asymmetry is unexplained.** The governing constraint says review-gated items wait for their evidence documents to pass `llp-review`, and CC-1/CC-7 are gated on LLP 0082/0085 accordingly. But CC-2 — the largest strategic trajectory in the plan — rests on LLP 0083, equally Draft and unreviewed, and was elaborated same-day into a full staged adoption plan (LLP 0087) whose Phase 0 is already executing. There may be a good rationale (the ENG-25387 facts were independently re-verified into LLP 0014 with dated provenance; 0087's gates substitute for review-gating; Phase 0 is information-buying, not commitment), but the plan doesn't state it, and a reader applying the plan's own constraint would conclude CC-2 should be review-gated too. **Resolution:** one paragraph stating why CC-2 is exempt (facts independently absorbed into LLP 0014; commitment deferred to 0087's gates plus LLP 0014 re-ratification), or gate 0087's Phase 1 entry on LLP 0083 passing review and say so here.

4. **Moderate — CC-1's dependency on the hosted authoring model is unstated.** LLP 0087's Motivation (line ~80) says explicitly: an agent or platform API cannot create a hosted app without a wrangler cycle, and "this blocks the full value of the agent provisioning surface (LLP 0086 CC-1)." 0087 also notes LLP 0024 "explicitly does not own hosted project lifecycle" today. CC-1's Exit ("an agent with only credentials and the MCP endpoint can provision a working app end-to-end") is therefore either (a) scoped to the local target, (b) achievable on hosted only via wrangler-automation behind the MCP surface, or (c) dependent on CC-2/0087's outcome — and the plan doesn't say which, nor does Sequencing order CC-1 relative to CC-2. **Resolution:** state CC-1's target scope and its relationship to CC-2 (e.g., "hosted end-to-end provisioning is delivered in coordination with LLP 0087 Phase 2's control-plane API, or via deploy-automation as an interim"), and note that the LLP 0024 revision is a scope *extension* into project lifecycle, coordinated with 0087's Phase 2 contract question.

5. **Minor — "three per-app Worker services" overstates the notes proof.** The plan states flatly that the hosted model compiles the bundle "across three per-app Worker services (gateway, handler isolate, action handler)"; the notes proof has two (no `wrangler.action-handler.jsonc` exists for notes — verified in `cloudflare/`), and LLP 0087's own Motivation says "two or three per-app services… All Aboard adds the third." **Resolution:** adopt 0087's wording.

6. **Minor — "the existing SpacetimeDB one" points at the wrong document by implication.** CC-6's boundary markers land "in LLP 0074 or its successors… alongside the existing SpacetimeDB one," but SpacetimeDB appears nowhere in LLP 0074 (verified by search); the existing marker lives in LLP 0000/0001 (0001 lines 447–452, 535–539 — which already record Nakama/Colyseus as "a second marker on the same line"). **Resolution:** cite where the existing marker lives, and note the tick-rate marker is already recorded in 0001's synthesis — CC-6's work is promoting it into competitive material, not creating it.

7. **Minor — Related header omits three load-bearing documents.** LLP 0008 (cited in CC-7 and the standing refusals), LLP 0079 (the plan's declared model), and LLP 0087 (CC-2's elaboration; it lists 0086 in *its* Related) are all missing from the Related line, while never-cited documents (e.g. LLP 0022, 0037) are present. **Resolution:** add 0008, 0079, 0087.

8. **Minor — "work items with owners" is not delivered.** The Summary promises items "with owners, evidence, and exit criteria," but the status board's owner column is owning *LLPs*, and open question 2 concedes the CC-2 spike has no owner. **Resolution:** either reword ("owning documents") or add actual ownership where it exists.

5. **Suggestions**

- CC-3's Exit should name the failure branch explicitly: if the InstantDB probe shows revocation *does* evict, the LLP 0074 claim must be withdrawn or narrowed, and LLP 0082's §Permissions inference updated. The plan's spirit ("observation, not their docs' silence") implies this; the exit criterion should state it so the item can't be marked done only in the convenient outcome.
- CC-5 will reopen LLP 0076, which just converged through a long multi-round review. Consider noting the comparison subsection should land as a clearly-scoped additive revision (a dated section, no change to the ratifying contract text) so it doesn't restart the whole review loop.
- CC-7's "the only place the research surfaced *demand* Snapback does not address" is slightly overclaimed — guest-auth-with-claiming (0082) is also user-demonstrated demand for a missing capability; it just happens to be absorbed by CC-4. "the only *unabsorbed* demand" or similar would be precise.
- Consider a one-line note that LLP 0001's fragile-suppliers synthesis (§8) itself flags the pattern this plan's evidence base exhibits: same-day Draft research driving same-day plans. The two-constraint preamble already carries this; making the connection explicit would strengthen the review-gating rationale.
- The Exit for CC-2 ("ENG-25387 closed") is now the only remaining step-1 residue; when revising per concern 2, keep it — it is the one crisply checkable criterion left.

6. **Open questions**

- Is CC-2's exemption from review-gating a deliberate decision (and if so, on what grounds — the independent LLP 0014 fact-verification, or 0087's gate structure)? See concern 3.
- What target does CC-1's exit criterion run on — local, hosted, or both — and does hosted CC-1 wait for 0087 Phase 2 or ship an interim wrangler-automated path?
- Were the dropped absorptions (concern 1) considered and rejected, or missed? If rejected, on what grounds — several (schema lockdown especially) look cheap and aligned with the plan's own priorities.
- Should this plan, rather than LLP 0087, own the record of when the beta-prohibition predicate in CC-2's gate is deemed discharged (GA determination), given 0087 defers that decision to "the owning documents"?
- Who inherits CC-6 if LLP 0074 is superseded — does "or its successors" have a concrete referent yet?

**Files verified against:** `llp/0082-instantdb.research.md`, `llp/0083-cloudflare-do-d1-prior-art.research.md`, `llp/0084-triplit-ditto.research.md`, `llp/0085-jazz.research.md`, `llp/0001-prior-art.research.md`, `llp/0079-serverpod-course-corrections.plan.md`, `llp/0087-facets-hosted-adoption.plan.md`, `llp/0014-cloudflare-strategy.rfc.md`, `llp/0053-authorization-invalidation.rfc.md`, `llp/0011-auth-and-permissions.rfc.md`, `llp/0008-local-first-sync-and-realtime.rfc.md`, `llp/0076-bounded-streamed-actions.rfc.md`, `llp/0074-convex-competitive-strategy.rfc.md`, `llp/0068-collaborative-document-convergence.rfc.md`, `llp/0010-agent-dx-and-acceptance.spec.md` / `llp/0024-agent-operating-surface.spec.md` (status headers), and code under `cloudflare/` (`scripts/generate-deployment-identity.mjs`, `src/gateway.js`, `src/coordinator.js`, `src/handler-worker.js`, wrangler configs, `spike-facets/`). Approximate tool-call count: ~27.

Verdict: NOT READY

## Round 2 — 2026-07-23

**Revision under review:** `llp/0086-prior-art-course-corrections.plan.md`, sha256 `f9b4b1a060b2f499ede753615151eba6d3142dec27a8a76fcd13e76e4fe621f7`, tracked at HEAD `92d93ddf` (both MATCH the pinned values). Round-2 prompt noted the document carries a Revised header from the round-1 revision; the reviewer had no access to round-1 artifacts.
**Runtime detail:** fresh Fable subagent, 28 tool uses, ~260 s, ~114k tokens; files verified against are listed in the review's verification report.
**Verdict:** READY

### Review body (verbatim)

All verification complete. Here is my review.

# Review: LLP 0086 — Course corrections from the 2026-07 prior-art passes (Round 2, Fable family)

## 1. Revision check

Commands run:

```
shasum -a 256 llp/0086-prior-art-course-corrections.plan.md
git rev-parse --short HEAD
```

Observed: `f9b4b1a060b2f499ede753615151eba6d3142dec27a8a76fcd13e76e4fe621f7` — **MATCH** with the expected sha256. HEAD `92d93ddf` — matches the expected repo HEAD.

## 2. Overall assessment

This is a strong plan, and I verified it substantially rather than taking it on faith. The translation from the four research documents into work items is unusually faithful: I cross-checked every row of the evidence-disposition ledger against the "What to learn" sections of LLP 0082, 0083, 0084, and 0085, and found no dropped or silently mutated finding. Every adopt/consider/decide/avoid pointer in the research batch appears either as a work item, a CC-8 row, a watch item, or a "covered" row whose covering citation I confirmed (LLP 0011's server-evaluated stance, LLP 0008's retention rule at line 31, LLP 0013's Accepted status, the standing-refusals section). The one structural improvement over its LLP 0079 model — the ledger itself — directly answers the "is the translation faithful" question a Plan of this kind invites, and it holds up under audit.

The ratification posture is handled correctly and carefully. The plan's most dangerous surface — CC-2's contact with LLP 0014's one-way door 2 — is deferred to exactly the recorded path: I confirmed LLP 0014's premise-change annotation exists as described (LLP 0014 lines 480–488: "change the premise — not the decision, which stands as ratified until LLP 0087's Gate 0 evidence supports re-ratifying or reaffirming it"), that the ENG-25387 platform-fact refresh landed with dated provenance (LLP 0014 lines 129–146), and that LLP 0087's ratification posture says what this plan claims it says (door 1 untouched, app data in the coordinator, facet SQLite role-local only). The plan's decision to keep only a summary of CC-2 and point at LLP 0087 as sole detailed authority avoids the divergent-copies failure mode, and its summary matches LLP 0087's actual content, including the Phase 0 progress (I confirmed `cloudflare/spike-facets/` exists with `gate0-probe-list.md`, `harness.mjs`, `spike.mjs`).

The two-dimensional gate structure (commitment gates vs publication gates) is coherent and operationally defined — "passes review" has a checkable meaning. The argument for CC-2's exemption from review-gating is sound: its load-bearing facts were independently re-verified into LLP 0014, and all commitment defers behind LLP 0087's gates anyway. The code-facing claims in CC-2's "why urgent-shaped" paragraph check out against the repo: the `snapback-app` esbuild alias exists (`cloudflare/scripts/generate-deployment-identity.mjs:64`), and the two-vs-three per-app Worker services claim matches the wrangler configs (`wrangler.jsonc` + `wrangler.handler.jsonc` for notes; All Aboard adds `wrangler.all-aboard.action-handler.jsonc`). CC-3's honest Cloudflare capability-gap expectation matches LLP 0053 (the coordinator "has no auth machinery today" — though see concern 2 on where that fact actually lives). CC-1's prerequisite chain matches LLP 0024's actual scope exclusion ("hosted control planes, billing, tenants, or project lifecycle", line 92) and its 2026-07-16 dated amendment (LLP 0060 deployment contract, LLP 0019 F8 audit log — F8 confirmed to contain the audit-substrate gap). CC-6's licensing wording matches LLP 0074's Summary framing (FSL source-available vs MIT, "license terms and completeness", LLP 0074 lines 121–123) and LLP 0074's evidence-class labels exist as described (lines 167–171).

What remains are polish-level issues: a mislabeled citation, one exit criterion referencing a section that does not exist by that name, a publication-gate ambiguity around LLP 0001-sourced claims, and a cross-item requirement that lives in the wrong place for executable-from-Work/Exit purposes. None of these block advancement.

## 3. Strengths

- **The evidence-disposition ledger is complete and accurate.** All ten LLP 0082 pointers, all nine LLP 0083 pointers, all six LLP 0084 pointers, and all eight LLP 0085 pointers map to a disposition, verified against each document's "What to learn" section. The "Covered" rows are genuinely covered (e.g., "Presence over a persistence primitive — avoid" → LLP 0013 is in fact Accepted; "Unbounded history without GC — avoid" → LLP 0008 line 31 names exactly that retention rule).
- **Governing constraint 1 is precise where it most needs to be.** The CC-2/door-2 language matches LLP 0014's actual premise-change annotation and LLP 0087's Ratification posture verbatim in substance, and the plan correctly neither performs nor presumes re-ratification.
- **CC-7's two-category evidence decomposition is a fidelity improvement over its source.** LLP 0085 loosely calls PITR bookmarks "partial ingredients"; the plan correctly sharpens this into Snapback-owned machinery (LLP 0008 changesets) vs provider-owned capability (LLP 0083 records bookmarks as an SRS property to preserve on the wire, not a Snapback history API). That distinction, plus the mandated per-capability decomposition including target portability, makes the RFC executable and prevents the "history-and-branching as one product" trap.
- **CC-3 preregisters its probe observable and timing threshold**, and its exit criterion explicitly includes the failure branch (claim withdrawn/narrowed, LLP 0082 §Permissions corrected). This is the right epistemics for a claim that will be published competitively.
- **CC-2's "why urgent-shaped" paragraph is grounded in the actual code**, not just the research doc — the esbuild alias, the per-app service topology, and the wrangler-cycle-vs-data-operation asymmetry all check against `cloudflare/`.
- **The plan resists scope creep in the right places**: CC-4 is explicitly amendment-only with implementation docketed separately; CC-2b is day-scale with no implementation; CC-5 is explicitly additive so as not to restart LLP 0076's converged review loop.
- **Standing refusals and watch items give the "no" decisions a recorded home**, which is exactly what makes a course-corrections plan auditable later.

## 4. Concerns

1. **Moderate — The publication gate's evidence set excludes LLP 0001, which CC-6 leans on.** Governing constraint 2 defines the unreviewed evidence base as "LLP 0082–0085," but CC-6's fragile-suppliers argument is sourced from "LLP 0001 synthesis §8" and the Nakama/Colyseus boundary marker from LLP 0001's synthesis — and LLP 0001 is also Draft (its promotion to Active was ratified then reverted, per its own Revised header). As written, a reading of the gate that only requires review of 0082–0085 would let LLP 0001-derived competitive claims publish on unreviewed evidence. **Resolution:** one sentence in governing constraint 2 or CC-6 stating whether LLP 0001-sourced claims are inside the publication gate (and if so, whether LLP 0001's long-standing survey status plus the batch's primary-source verification counts as sufficient), or explicitly re-scoping those claims' support to the reviewed deep passes.

2. **Minor — Mislabeled citation in CC-3: "LLP 0053's as-built note."** The fact is real — LLP 0053 records that the Cloudflare coordinator "has no auth machinery today" — but it lives in LLP 0053's Open Questions (question 3, lines 1926–1928), not in any section labeled "as-built"; no such note exists in the document (`/usr/bin/grep -in "as-built"` finds nothing). An executor sent to find the as-built note will not find one. **Resolution:** cite it as LLP 0053 open question 3 (or whatever the correct anchor is).

3. **Minor — CC-2b's exit references "LLP 0070's hosted-profile section," which does not exist under that name.** LLP 0070 discusses target profiles and a `HostedManaged` mapping but has no hosted-profile section heading; the exit criterion as written points at a location the executor must invent. **Resolution:** rephrase the exit to "a dated candidate-assessment note in LLP 0070 (its target-profile material, creating a hosted-profile subsection if needed)" or similar.

4. **Minor — CC-1's exit does not carry the schema-lockdown-toggle requirement that CC-8.1 imposes on it.** CC-8.1 says CC-1's surface spec "must expose the lockdown toggle," but CC-1's Work and Exit (the text the prompt says an executor works from) never mention it. If CC-1 executes before or independently of CC-8.1, the requirement can be missed and discovered only at CC-8.1 close-out. **Resolution:** add the lockdown toggle to CC-1's Work (or exit criterion 2) with a pointer to CC-8.1, keeping CC-8.1's row as the doc-absorption half.

5. **Minor — CC-4's internal sequencing is half-stated.** Sequencing places "CC-4 item 1" in Now but never places items 2 (guest-auth spec) and 3 (onboarding note); and item 2 — "specified to the point where implementation is docketable" — is the bulk of an S-sized item's real work. **Resolution:** either state that items 2–3 ride the same amendment in Now, or place them in Next; optionally note that the S sizing is for the amendment text, with guest-auth's design depth acknowledged.

6. **Minor — CC-5's "no change to the ratifying contract text" overstates LLP 0076's status.** LLP 0076 is Draft (converged through review but not Accepted); "ratifying contract text" reads as if a ratified contract exists. The intent (additive subsection, don't reopen the converged text) is clear, but the wording could mislead a status audit. **Resolution:** "no change to the contract text that converged through review" or equivalent.

## 5. Suggestions

- The Status board could carry a "Gate" column (none / commitment / publication / LLP 0087) so the two gate dimensions are visible at a glance rather than only in the State parentheticals.
- CC-8's exit says a skipped row must be "annotated with a named no-action rationale" — consider requiring the annotation to be dated, matching the dated-revision discipline the rest of the plan enforces.
- The ledger could add one row for LLP 0082's remaining probe-shaped open question (presence/topic fan-out limits) as an explicit watch item; it is an open question rather than a "What to learn" pointer, so its absence is defensible, but the ledger's value is completeness.
- CC-2's step 1 residue ("close ENG-25387") is the only Linear-issue-state exit criterion in the plan; consider noting who confirms closure, since the plan otherwise defers all assignment to the docket path.

## 6. Open questions

- For governing constraint 2: when CC-3's probe succeeds and re-establishes the Instant-side fact empirically, does the *Snapback-side* half of the claim (LLP 0053 implemented and tested) need any review artifact, or does the acceptance evidence itself satisfy the gate? The gate text reads as if empirical verification fully substitutes; confirming that reading is intended would remove ambiguity.
- Is the intent that CC-8 rows landing in Accepted documents (LLP 0013, 0037, 0033-adjacent) go through any lighter-weight review, or are dated doc-only revisions to Accepted documents considered below the review threshold by convention? The plan is silent; a one-line convention statement would prevent per-row relitigating.
- Should the plan name a single place where "publication" is defined (website, README, competitive one-pagers)? CC-3/CC-6 gate on it, but what counts as externally visible is currently implicit.

## Verification report

Files verified against: `llp/0082-instantdb.research.md`, `llp/0083-cloudflare-do-d1-prior-art.research.md`, `llp/0084-triplit-ditto.research.md`, `llp/0085-jazz.research.md` (all read in full), `llp/0087-facets-hosted-adoption.plan.md` (read in full), `llp/0014-cloudflare-strategy.rfc.md` (platform facts §, one-way doors §), `llp/0024-agent-operating-surface.spec.md` (scope §, 2026-07-16 amendment, status), `llp/0053-authorization-invalidation.rfc.md` (open questions, status, as-built search), `llp/0079-serverpod-course-corrections.plan.md` (structure/SC rows), `llp/0074-convex-competitive-strategy.rfc.md` (evidence-class labels, licensing framing), `llp/0070-durable-background-work.rfc.md` (profile sections, status), `llp/0011-auth-and-permissions.rfc.md` (fail-closed/server-evaluated stance), `llp/0008-local-first-sync-and-realtime.rfc.md` (retention rule, auth-invalidation revisions), `llp/0001-prior-art.research.md` (Encore §, synthesis §7–8, Revised header), `llp/0013-*`/`llp/0037-*`/`llp/0033-*` (statuses), `llp/0019-agentic-readiness.research.md` (F8), `cloudflare/` (wrangler configs, `scripts/generate-deployment-identity.mjs`, `spike-facets/` contents). Approximate tool-call count: 14.

## 7. Verdict

The document is faithful to its evidence, correctly deferential to ratified decisions and to LLP 0087's authority, operationally gated, and executable from its Work/Exit criteria with only the small localization fixes above. The remaining concerns are citation-precision and gate-scope clarifications that do not change the plan's structure.

Verdict: READY
