# Review artifact: LLP 0259 — claude family

Target: `llp/0259-agent-first-read-budget.rfc.md`

## Round 1 — 2026-08-15

- **Reviewer:** Claude (fable), `claude -p --effort max`, fresh session,
  blind. First launch failed (empty `Execution error` / wrapper timeout);
  this body is the second launch, charged against the 2× launch cap.
- **Revision under review (r1):** sha256
  `f7be03ecc2886baeff51b020f4c8f2f2fceb58e2c9d63ac1fe330c06583231f4`.
- **Capsule:** APFS clone of `git archive HEAD` plus disclosed overlay;
  no 0259 review artifacts or run journal present (structural blindness).
- **Instructions:** sha256
  `b022d0368e14d89af1413a2086ff2cf7da2465b16d5e8940b55733467c8f68b4`.
- **Verdict:** NOT READY (3 MATERIAL, 6 minor).

### Review body (verbatim)

# Review: LLP 0259 — Re-budget the agent first-read contract (round 1)

**Reviewer:** Claude (Fable 5), independent lane, capsule-only.
**Verification basis:** every size, count, quote, and citation below was checked against the capsule's files, not taken from the RFC.

## 1. Overall assessment

The central decision is sound and well timed. The RFC correctly identifies that the 2026-07/08 programs optimized "never miss a capability" and that the binding constraint has moved to "minimum tokens and minutes to first edit on the default surface." I verified the instruction stack it complains about, and it is real: the skill (`skills/snapback-authoring/SKILL.md:15-21`) mandates `guide/index.md` then the full capability index "before designing anything"; `guide/index.md:125-128` says "Start every task here: check the capability index first"; all five template `AGENTS.md` files open with the same pilgrimage to the served `capabilities.md`; and `packages/snapback-cli/package.test.mjs:328,357,459` hard-asserts the literal phrase "capability index first." The sizes table is essentially exact (I measured every row; only the flat differs trivially at 3,235,139 bytes). The Diary 0078 numbers are quoted correctly to the second and token. The proposed shape — re-point four entry artifacts, add ≤5 budgeted cards, fence experimental surfaces, split the getting-started pages, and refuse to claim a competitive win — is the right altitude and deliberately avoids becoming a sixth coordination program.

Three things keep it from READY, all cheaply fixable in one revision: the design misses the *served* out-of-repo entry funnel it itself diagnoses; a Familiar-default gate is keyed to a ticket file that does not exist in the tree; and the proposed trap-list additions were partially fixed on `main` the same day the RFC was drafted, so landing the list as written would install false traps into the highest-leverage artifact the RFC touches.

## 2. Strengths

- **The measured diagnosis is honest and checks out** (§Motivation). `your-first-backend.md` really is 475 lines with the in-repo `'../../_kit/define.mjs'` import as its first schema snippet (line 59), while the shipped react template uses `@expo/snapback-codegen/define` (`packages/snapback-cli/templates/react/snapback/schema.mjs:1`); `clients/react.md` really opens on `prepareReactBinding`/`createSnapbackReactProvider` (lines 34, 42) while the template `App.tsx` is exactly 33 lines of hooks. Enum domains and structured stored values do sit before "Define functions" in the getting-started page (lines 92-159 vs 193).
- **Right document altitude** (§Why this is a new LLP). Amending 0186/0187/0061's steering language rather than burying a reversal inside accepted programs is correct, and the explicit "do not extend this into a sixth coordination program" fence matches the repo's LLP 0189/0232 operating law. LLP 0207's Withdrawn status is cited accurately.
- **Design 3's Familiar gates are exactly Diary 0078's own conclusion** — "publishing one qualified, matched closure and making codegen, client, and runtime share function-name and query-limit rules" (diary lines 157-159) maps 1:1 onto gates 1-3. The RFC resists the temptation to solve Familiar with more prose.
- **Design 4's transclusion fix addresses a verified defect**, and the mechanism exists: `check-guide` already enforces `source=` snippet identity, so a template-sourced or published-path-fixture snippet is enforceable, not aspirational.
- **Measurement discipline** (§Non-goals, §Acceptance, OQ4). Refusing to claim Clique improvement until an LLP 0201/0198 rerun, and the *negative* retrieval-eval seed ("fail if the plan opens `guide-flat.generated.md`... before the first edit"), are genuinely good design. The eval harness supports it (`guide/retrieval-eval.md:628` already checks expected pages exist).
- **Ticket hygiene is accurately characterized** (§Design 6): `guide/auth/app-identity-binding.md` exists and the remaining ask in the identity ticket is indeed the platform one (verified mint email in handlers); the freshness ticket's 69% (45 of 65 pages) figure is exact.
- **The product-work fence** (§Product work) prevents the docs-only landing from being mistaken for the Clique close-out — which the fresh sweep evidence (below) confirms is the right caution.

## 3. Concerns

**MATERIAL 1 — The served out-of-repo funnel is not re-budgeted.** Design 1 edits four artifacts (skill, template `AGENTS.md`, `guide/index.md`, repo agent instructions), all in-checkout or in-scaffold. But the entry funnel LLP 0187 T4 built for the *npm audience* — the audience LLP 0195 and the rapid-publish posture optimize for — is the served one, and it still steers into exactly the reads this RFC removes: `src/server.rs:8349-8353` serves `/llms.txt` with a "Read first — one-request entry tier" whose first item is the ~58 KiB capability index, and the instance home `/` advertises the flat projection (LLP 0061 r7 amendment). Meanwhile the RFC's only llms.txt requirement ("must label [the bulk flat] as a last resort") is already essentially satisfied — `src/server.rs:8381` reads "use only when you want the whole corpus, and prefer the entry or section tiers" — so Design 1 spends its llms.txt sentence on a near-no-op while missing the Read-first steering. A cold agent arriving via the served funnel gets no diet at all, and no build card exists in the served corpus unless OQ1 resolves to guide pages. *Resolves it:* add the llms.txt "Read first" tier and the instance-home advertisement to Design 1's edit list (build card first, capability index repositioned as the grep/`snapback guide` registry), add an acceptance bullet for the served funnel, and resolve OQ1 to guide pages (the RFC's own recommendation) so the cards ship inside the embedded corpus.

**MATERIAL 2 — Design 3 gate 4 and the trap list bind to a ticket that does not exist.** `issues/20260813-guide-gap-familiar-source-consumer-closure.md` is absent from both `issues/` and `issues/closed/` (I checked both; only two unrelated 20260813 tickets exist). Yet the RFC makes it a hard gate for Familiar-becoming-default ("has a CI-checked consumer recipe") and asserts "The open familiar-consumer ticket remains valid" (§Design 3). Diary 0078:109 cites the same phantom file. A promotion gate keyed to a nonexistent artifact can never be evaluated met or unmet. *Resolves it:* commit/restore the ticket (this looks like the known untracked-ticket trap — the diary landed citing a file that was never added), or retarget gate 4 at a named deliverable ("a CI-checked published-closure Familiar consumer recipe exists in `guide/`") rather than a file pointer.

**MATERIAL 3 — Two of the six proposed Clique traps were fixed on `main` before this RFC will land, and the list is uneven on attribution.** `issues/closed/20260815-familiar-codegen-generated-directory-mismatch.md` resolves the `_generated/` vs `generated/` trap outright (`snapback/generated/` is now sole, `_generated/` refuses with a structured diagnostic, regression tests in `familiar-dev-loop.test.mjs`); `issues/closed/20260815-generated-operation-name-seams-metro-and-client-grammar.md` closes the dotted-export seam (shared `@expo/snapback-contract/operation-name` imported by codegen and client, per the open take-limit ticket's own text). Only the take-limit trap remains open. Additionally, "Mixing `useSnapbackQuery` with `db.useQuery`" appears in no diary or ticket I can find — the skill already warns against it (`SKILL.md:67-68`) — so it is listed as a Clique-paid loop without evidence. Landing Design 5 as written installs wrong claims into the skill's "verified against main" trap list. The nuance: these traps are *still live for 0.1.21 npm users*, because the fixes are landed-but-unpublished. The skill's existing convention already models the answer (traps 6, 8, 9, 11 carry "since 0.1.x" bounds). *Resolves it:* Design 5 gains one sentence — each added trap is re-verified against `main` at landing time and carries its version boundary ("fixed on main 2026-08-15, live on ≤0.1.21"); drop or source the mixing-hooks item; and add "reconcile stale existing rows" to Design 5's job, because trap 1 ("No `v.array()` on table fields... design-only") now contradicts both the capability index (`backend.structured-stored-fields`: experimental, with a shipped test witness) and `your-first-backend.md:124-125` ("now compile to a persisted structured contract").

**minor — "The skill's golden path then offers three authoring surfaces" is misattributed** (§Motivation). The skill contains no mention of Familiar anywhere; its golden path offers explicit `.mjs` plus the tiny-data mention in step 5. The Familiar funnel is real but runs through the artifacts the skill *mandates* loading: `guide/index.md`'s Backend map, which literally leads with "Familiar TypeScript profile" as its first entry (lines 147-150), and the capability index's familiar rows. The conclusion stands; the paragraph should re-attribute so the "largest documentation-caused token leak" claim survives a reader opening the skill. (This also suggests a cheap extra edit: see Suggestion 5.)

**minor — "152 dense rows" is wrong; the index has 121 data rows** (58 KiB is correct). Trivial, but this RFC's credibility is its measurements.

**minor — the page-budget arithmetic is stated twice, differently.** Contract step 4 says "at most one feature page"; the cap line says "skill + build card + two pages per task." State it once, precisely (e.g., "at most one feature page before the first edit, at most two pages total per task; budgeted `snapback guide` symbol/code lookups don't count").

**minor — the refusal card contradicts the RFC's own OQ2 logic.** OQ2 correctly rejects a second capability table because "a second table will drift (LLP 0203 transcription rot) unless it is generated from the same rows" — and then Design 2 hand-authors a ~40-row refusal card projected from the 572 KiB generated diagnostics registry. Same rot, same fix: generate the card from `diagnostics-registry.json` via a curated code allowlist, with the one-line fixes in a sidecar that CI joins against the registry (a renamed/removed code fails the build). LLP 0193's errors-as-docs machinery is the natural owner.

**minor — the wrong/right card's first example is already stale.** "`v.json()` vs table `v.array()`" reflects the pre-LLP-0211 world; structured arrays are now experimental-shipped. Since Design 2 declares cards CI-checked, make the wrong/right snippets `source=`-bound like the rest of the corpus so this class of rot is mechanical, not editorial.

**minor — Acceptance has no bullet for Designs 5 or 6**, so the trap-list and ticket-hygiene slices could silently not land while every acceptance box ticks green.

## 4. Suggestions / new ideas (co-author material)

1. **Ship the build card in the scaffold itself.** The cheapest first read is a file already on disk. Fold the build card into (or next to) each template's `AGENTS.md` at template-build time, transcluded from the guide page and enforced by `package.test.mjs` exactly the way the skill's Rosetta block is enforced by `check-rosetta.mjs`. A cold template agent then needs *zero* fetches for the mental model — the diet becomes the default, not a policy the agent must obey. The templates already ship the whole skill, so the sync mechanism and precedent exist.
2. **Make the budgets mechanical.** The capability index already has an enforced size budget (LLP 0061's 51 KiB machinery). Register each card's ≤2-4 KiB budget in the same check so "do not add a sixth card without deleting one" is CI, not vigilance. Add a **bytes-before-first-edit** ceiling to the OQ4 seed (not just page counts), so a card quietly growing to 20 KiB trips the eval.
3. **A composed context endpoint (non-standard, optional).** Instead of teaching a stop list and hoping agents comply, give them one affordance that *is* the diet: `snapback context <brief-terms>` (and served `GET /_snapback/guide/context?q=...`) returns skill + build card + the single best-matched feature page as one budgeted, hash-bound document. The pieces exist — the corpus is embedded, `snapback guide <term>` already searches it; this is composition plus a byte ceiling. `/llms.txt`'s Read-first tier then points at one URL, and retrieval-eval can assert single-fetch compliance. Explicitly *not* a landing gate — the cards must work without it — but it converts behavioral policy into mechanism, which is what actually moves agents. File it under Product work if accepted.
4. **Cite the 0.1.21 sweep diaries (0080-0085) — they're in the tree and they strengthen this RFC.** Diary 0083 (explicit lane, the exact default surface Design 3 blesses) reports the served guide "saved substantial time" while M1-M3 went green in 1,871s/1,414s/675s, with the residual tax at *product seams*: the Expo admission validator rejecting the generated `authoringProfile` descriptor key, supervisor restarts required per function-digest change, and authorized-lease offers causing live-query rejection. That is direct evidence for the one-default-surface decision *and* three concrete candidates for the Product-work list (none currently has a ticket that I could find — they should be filed with the landing). Diary 0081 also shows where the stop list needs its escape hatch: package source was "decisive" for behavioral rules the guide didn't state (data-query catalogue scans the backend root; the `_id` totalizer; the sessions startup carrier).
5. **Reorder `guide/index.md`'s Backend map.** Its first entry is the Experimental Familiar profile, ahead of queries and mutations. Under Design 3's own logic, shipped default-surface pages come first and experimental profiles move to the end (or a separate "Experimental profiles" group). One-line change, closes the actual Familiar funnel the Motivation meant to describe.
6. **Add the stop-list escape hatch that keeps the honesty loop alive.** "If a *behavior* (not a signature) is undocumented, read the owning package source, then file a `guide-gap` ticket" — otherwise the diet suppresses the LLP 0061 §5 feedback cycle that built the guide's accuracy in the first place. The sweep lanes show competent agents already do the first half; the contract should require the second.
7. **Prefer `snapback guide <term>` over "grep the capability index" for served-corpus agents.** An MCP-resource agent cannot grep without loading the full 58 KiB resource; grep is only free in a checkout. One clause in contract step 4.
8. **Consider three cards, not four.** "Which page do I open?" (≤2 KiB) is a decision tree the build card's last section could carry, and `snapback guide <term>` already answers the same question dynamically. Fewer files, smaller default context, one less budget to police — aligned with the RFC's own "smaller default context is the point."
9. **Note the publication pickup.** The diet reaches npm agents only when a qualified release carries the new skill/templates/llms.txt. Under LLP 0041's publish-rapidly ruling, entry-path steering is exactly the kind of surface fix that should not sit landed-but-unpublished; say so in the implementation sketch.

## 5. Open questions

1. **Card freshness under saturation.** With 69% of pages already warning, new cards citing fast-moving authorities will warn almost immediately. Should cards deliberately carry *stable* authorities (templates, the RFC itself) or get a stricter freshness SLA so a stale card — the new default context — is treated as a P1 doc defect rather than background noise?
2. **Who owns the served funnel edit** (llms.txt Read-first tier, instance home advertisement) — Design 1 here, or an LLP 0061 amendment? (Recommend: Design 1 owns it; 0061 records the amendment, same as the T4/steering amendments already planned.)
3. **Do budgeted `snapback guide <Symbol|code>` lookups count against the two-page cap?** They shouldn't — they are the stop list's own prescribed alternative — but the contract should say so.
4. **Do the cards become allowed expected-pages for existing retrieval-eval seeds** (competitor-phrase cases currently expecting deep pages), or only for the new diet seed? Existing seeds asserting deep-page plans could fail an agent that correctly stops at a card.
5. **Where do the Diary 0083 explicit-lane product seams get tracked** (descriptor `authoringProfile` admission mismatch, per-digest supervisor restart, lease-offer rejection)? If the Product-work list is the RFC's record of "what beats more docs," the freshest default-surface evidence should be on it.

## 6. Recommended next step

One orchestrator revision: fix the three MATERIALs (extend Design 1 + Acceptance to the served funnel; restore or re-key the phantom familiar-consumer ticket; add re-verify-against-main + version-bounding to Design 5 and drop or source the mixing-hooks trap), fold in the minor corrections (three-surfaces attribution, 121 rows, cap arithmetic, generated refusal card, acceptance bullets), and cite Diaries 0080-0085. None of this changes the central design, so the revision should be quick — then land implementation steps 1 and 5 immediately per the sketch, which correctly identifies them as the high-return slice that needs no new pages.

VERDICT: NOT READY

## Round 2 (delta round) — 2026-08-16

- **Reviewer:** Claude (fable), `claude -p --effort max`, fresh session,
  blind.
- **Revision under review (r2):** sha256
  `06f539333bc06b9fec3c2f34c54973b9ab8224e96741c3c27d6ee41776067a08`.
- **Capsule:** r1-pristine clone with r2 overlaid; no 0259 review
  artifacts present (structural blindness).
- **Instructions (delta round):** sha256
  `88b75b800db500beb540416cbe01e724f95dbb12d812d9588bc7c48e348eaafc`.
- **Verdict:** NOT READY (1 MATERIAL IN-DELTA, 3 minor IN-DELTA).
  PRE-EXISTING MATERIAL: no.

### Review body (verbatim)

# LLP 0259 r2 — Round 2 (delta) review

**Reviewer:** Claude (Fable 5), independent, capsule-blind
**Target:** `llp/0259-agent-first-read-budget.rfc.md`, sha256 `06f53933…067a08` (verified), 583 lines (verified)

## 1. Overall assessment

r2 is a substantial, honest, and verifiably grounded repair of both families' r1 findings. I checked every claimed repair and every load-bearing factual claim I could reach in the capsule; the factual record is close to spotless — all eight byte counts in the Motivation table are byte-exact, the ~120-row index count is correct (122 pipe-lines = header + separator + 120 data rows), the served-funnel description matches `src/server.rs` (`LLMS_TXT` Read-first tier leads with the capability index) and `src/server/instance_home.rs` (bulk-flat advertisement), the skill/index/capability-index three-surface Familiar attribution is exactly right (zero "familiar" mentions in the skill; `guide/index.md:147` leads the Backend map with the Experimental Familiar profile; `backend.familiar-profile-v1` rows in the index), Diaries 0078/0079/0083 say precisely what r2 cites (timings, token counts, the three explicit-lane seams, the phantom-ticket citation at 0078:109), the phantom ticket is genuinely absent from `issues/` and `issues/closed/`, all seven other cited tickets exist in the stated open/closed states, and the LLP 0252 §D7 Promote / Phase 4 and LLP 0253 Draft-defers-to-0252 authority claims match those documents' text (0252:662,731–733,745,957; 0253:805–807).

Seven of the eight enumerated delta repairs are sound and complete. The eighth (carrier bytes / progressive renewal, codex M3) is mostly repaired — `FirstReadProfileV1`, physical splits, and per-artifact budgets are a real answer to "budget the bytes the carrier sends" — but the new progressive-renewal ladder introduces one in-delta coherence defect: its middle rung prescribes a retrieval mechanism that the RFC's own Motivation documents as nonexistent, that no implementation step builds, and that no acceptance bullet gates. That single defect is what keeps me at NOT READY; it has a one-paragraph fix.

## 2. Strengths

- **The delta discipline is visible and checkable.** Every r1 MATERIAL maps to a named design change, and the "Resolved in this revision" block under Open questions records the resolutions without hiding them in prose. The +33.1% growth is disclosed and attributed in the header.
- **Design 3 (two axes) is the correct fix for codex M2, verified against the templates.** `react`'s `App.tsx` is exactly 33 lines of `useSnapbackQueries`/`useSnapbackMutation`; `expo-chat` uses `useSnapbackQuery` and `useSurface`. "Whatever canonical consumer the selected template already emits" is the only spelling of the fence that doesn't contradict "copy the template," and r2 says so explicitly.
- **Design 3's Familiar authority handling is now airtight** (codex M1). The Promote-only-via-0252-§D7 rule matches 0252's disposition machinery verbatim, and the "additional entry-path prerequisites … are not sufficient promotion criteria and do not substitute for 0252" sentence closes the loophole r1 opened. The phantom-ticket dependency is severed correctly: the consumer recipe is a named deliverable; the missing file is demoted to hygiene (Design 6).
- **Design 5 is the strongest new section.** Every row checks out against the capsule: the two closed 2026-08-15 tickets exist; the take-limit ticket exists, is open, and matches the diary incident; skill trap 1 is provably stale (the skill says `backend.structured-stored-fields` is "design-only," the index says experimental with a test witness at `guide/capabilities.md:29`); the mixing-hooks demotion is right (the skill already warns at step 5, and Diary 0079 records no paid mixing loop). "Re-verify, not accumulate history" is the correct standing rule, and the `since:` version-bounding reuses the skill's existing convention.
- **Design 4 correctly abandons folds for physical artifacts** (Diagnosis #3 → `FirstReadProfileV1` → CI-enforced `maxBytes`), and the `source=` claim is real: `scripts/guide-lib.mjs:474–489` already refuses unbound snippet fences, so packet snippets inherit rot-proofing for free.
- **The refusal-encyclopedia deletion (codex M5) is done properly** — not just removed but replaced with the LLP 0203 P1-compliant rule (generate from `guide/reference/diagnostics-registry.json` or don't ship it), with the "6–8 failure classes, no transcribed fixes" compromise keeping the packet useful.
- **Acceptance now covers all three surfaces the instructions asked about**: the served funnel (bullet 1 names `/llms.txt` and the instance home), profiles (bullet 4, CI-enforced for `react` and `expo-chat`), and trap reconciliation (bullet 5 binds first-read artifacts to Design 5's table at landing time).
- **Scope hygiene held under pressure.** Product work is recorded, not claimed (the "Product work that beats more docs" list), the Diary 0083 seams are slated as ordinary tickets at landing, and the Non-goals section explicitly refuses the competitive-benchmark claim, keeping this RFC out of LLP 0186/0198/0201's lane.

## 3. Concerns

### C1 — MATERIAL, IN-DELTA: progressive renewal rung 2 prescribes a retrieval mode that does not exist, is not built, and is not gated

Design 1's normative ladder, rung 2: "**One feature fragment** for one unresolved design question, fetched via `snapback guide <term>` as bounded content, not a 40 KiB page." The RFC's own Motivation states the opposite is true today: "`snapback guide <term>` today returns matching page/anchor pointers, not bounded section contents" — and I verified it: term search returns `GuideSectionMatch { path, heading, anchor }` (`src/cli/guide_command.rs:14–18`); only exact symbol/diagnostic lookups return bounded content (`packages/snapback-cli/reference-lookup.mjs`), and r2 itself excludes those from the fragment budget ("lookups do not count"). HTTP and MCP return whole files. No implementation-sketch step builds a bounded-section mode; no acceptance bullet requires one; the composed `snapback context` endpoint is explicitly optional and "the packets must work without it." Meanwhile Design 2 says the escalation targets are "ordinary guide pages reached by trigger-gated escalation" — i.e., 40–58 KiB files, exactly what rung 2 forbids. Design 4's physical splits cover only the two getting-started/react pages, not feature pages.

The RFC forecloses the charitable reading ("the agent reads only the anchored section") with its own Diagnosis #3: heading-level self-limits "do not save tokens on carriers that deliver whole files. Budget the bytes the carrier actually sends." By that principle, rungs 2–3 as written are unimplementable with this RFC's deliverables: a landed implementation would pass every acceptance bullet while the contract's escalation text remains false, and step 6's cold traces would record 40–55 KiB page opens that the contract says must not happen. That is a coherence/feasibility defect in the RFC's central deliverable — the first-read contract itself — not a detail demand.

**Resolution (either branch is small):** (a) own the mechanism — add an implementation-sketch step and acceptance bullet for a bounded section-content mode of `snapback guide <term>` (the budgeted-slice/truncation machinery in `reference-lookup.mjs` is the obvious pattern to extend to manifest-anchored sections), keeping rung 2 as written; or (b) re-spell rungs 2–3 to what exists — "run `snapback guide <term>`; open exactly one page the pointer names, preferring the Design 4 split page where one exists" — and move "bounded fragment content" into the optional `snapback context` product-work item. In both branches, reconcile Design 2's "ordinary guide pages" sentence with the chosen spelling.

### C2 — minor, IN-DELTA: the Design 1 carrier table ("the edit list") omits the CLI's own channels output

Bare `snapback guide` prints "Start with the capability index: …/capabilities.md" first (and JSON mode lists `capabilityIndex` first) — `src/cli/guide_command.rs:render_guide_command`. That is a real first-read carrier for CLI-first agents, carrying the exact steering being retired, and Design 1 declares its table "owns the edit list." Add a row (and cover it in sketch step 1's sweep alongside the `package.test.mjs` change).

### C3 — minor, IN-DELTA: "remains live on unpublished 0.1.21" inverts the publication state

`guide/published-closure.json` records `newestPublished: 0.1.21` (2026-08-14). The bug is live on the *published* ≤0.1.21 closures — exactly as Design 5's table has it ("Live on ≤0.1.21" under "Newest published") — and it is the 2026-08-15 *fixes* that are unpublished. Product work item 2 should say so; as written it contradicts the repo's closure record and the RFC's own table.

### C4 — minor, IN-DELTA: Design 2 says packet traps are "each version-bounded (Design 5)," but Design 5's take-limit row is deliberately unbounded

The open `take(4096)` trap is carried "until generate-time refusal ships," not version-bounded. Re-spell as "reconciled per Design 5 (version-bounded where fixed in source)."

No pre-existing concern survived verification: every r1-era factual claim I spot-checked (read-stack contents, sizes, funnel behavior, diary numbers, authority citations) is accurate in r2's text.

## 4. Suggestions / new ideas (not READY blockers)

1. **Cheapest resolution of C1 that also reduces delivered bytes:** extend the existing exact-lookup budget machinery to manifest-anchored sections — `snapback guide <term> --section` returning ≤4 KiB slices with the same `nextSlice`/`TRUNCATED` continuation grammar `reference-lookup.mjs` already ships. One mechanism, one budget discipline, no new endpoint.
2. **Served `/llms.txt` implementation note:** the string is a static const; it cannot name a per-template packet URL. The "(or shared mental-model page)" alternative already licenses the implementable form — have the served Read-first tier list the mental-model page plus a `/_snapback/guide/start/` packet index, and say so in Design 1 to save the implementer a round trip.
3. **Bind cold traces to packet identity:** have step 6's receipts record the `FirstReadProfileV1.digest` they measured against, matching the repo's digest-bound readiness-receipt idiom, so a trace can't silently vouch for different packet bytes.
4. **Carry the packet digest in the transcluded `AGENTS.md` section** (comment line), making the `package.test.mjs` identity check a straight compare rather than a re-derivation.

## 5. Open questions

- The RFC's own OQ1–OQ5 are honest and correctly scoped; none blocks Review→Accepted. OQ3 is genuinely load-bearing: I verified `guide/retrieval-eval.md:67,134` expect `backend/relational-queries.md`, so without the OQ3 decision the diet and the existing eval will disagree about correct agent behavior on day one of implementation.
- For the author: should C1's resolution branch (a) vs (b) be chosen here, or recorded as an OQ with rung 2 spelled conservatively (branch b) in the meantime? I'd default to (b)-now with (a) as the named optional product work.

## 6. Recommended next step

One orchestrator micro-revision (r3) fixing C1 (pick a branch, reconcile Design 2's recipes sentence), plus the three one-line minors (C2–C4). Nothing else in the document needs to move; the repairs of both families' r1 findings are otherwise complete and verified. On the delta rule, an r3 that addresses C1 should be READY-eligible without a full re-read of pre-existing text.

PRE-EXISTING MATERIAL: no
VERDICT: NOT READY
