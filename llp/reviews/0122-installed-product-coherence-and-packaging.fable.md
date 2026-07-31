# LLP 0122 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 40ca18b9, mutually blind (no llp/reviews/
artifacts for LLPs 0116–0125 read)
**Target SHA-256:** `c41f584d37139c5d8544fd4a2cf1b3a75f1fe5317b99f35abf1cbecdc48bb815`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## 1. Overall assessment

This is a strong, heavily verified research document that is close to the
bar and misses it narrowly. Its evidence base is unusually solid: I
spot-checked essentially every load-bearing claim about current-main code,
the publication state, the diaries, and the owning LLPs, and all but one
small enumeration survived contact with the tree. The provenance discipline
(general Convex background vs. diary-observed, explicitly separated in
§What Convex does) is exemplary for the series, the five-facet decomposition
of "coherence" in §How they differ is genuinely more useful than the
"publish packages" framing it replaces, and the Confidence section honestly
grades its own weakest judgments. The document is scrupulously decision-free;
I found no smuggled decisions.

What keeps it under the stated bar ("exhausted what pre-empirical analysis
can deliver… no flaws"): the document's own first coherence facet — naming
unity — receives no option-level analysis. OQ3 names the decision and the
swappable-alias mechanism, but the concrete naming paths and, critically,
their interaction with the byte-bound publication-ledger lineage (LLP 0115
governing constraint 1, no evidence regression) are analyzable today and
unexamined. Alongside that, two small factual/citation flaws sit inside
claims the Confidence section marks High. All are bounded, cheap fixes.

## 2. Strengths (cite sections)

- **Verified package reality.** §What Snapback does today is accurate in
  every particular I checked: thirteen directories under `packages/`; the
  nine-closure membership matches LLP 0041's alias table; the four
  outsiders are characterized correctly (`snapback-admin-client` is
  `"private": true` and has no version field, and its own description
  confirms the `/_snapback/admin/client.mjs` served path;
  `snapback-harness` has no package.json and holds workerd assets;
  `snapback-publication-authority` is private tooling). The `./online`
  defect is exactly as stated: `packages/snapback-client/package.json`
  maps `"./online": "./online.mjs"` with no `types` condition, no
  `online.d.mts` exists, the `./rqs*` subpaths are bare mappings, and
  `online.mjs` is a twelve-line re-export whose three symbols
  (`SnapbackClient`, `bindSnapbackAppLifecycle`,
  `createExternalSessionClient`) are all declared in `index.d.mts` — so
  the "one small declaration file" repair-size claim is grounded, not
  asserted.
- **Verified already-fixed inventory.** The "already improved on current
  main" paragraph is right and important review hygiene: `runCli` in
  `packages/snapback-cli/index.mjs` dispatches `doctor` (l. 2264), `new`
  (l. 2338), `generate` (l. 2346), `deploy` (l. 2726), and `dev` with
  `--client` (ll. 2867–2875); `packages/snapback-cli/templates/` holds
  `react` and `todo-contract`; the packaged doctor's vertical slice
  matches the code and 0041's status. Explicitly fencing fixed complaints
  off from the option choice prevents the option space from being argued
  from stale evidence.
- **Verified diary quoting.** Every quote I checked is verbatim with
  correct attribution: Diary 0022 ll. 69–70 ("felt like developing
  Snapback itself"), l. 121 ("most coherent TypeScript loop"),
  ll. 134–135 (`CONVEX_AGENT_MODE` discoverable from installed
  source/CLI diagnostics); Diary 0027 ll. 372/413 (coherence verdicts),
  l. 379 (PTY prompt despite agent-mode documentation), l. 1419
  (`VOLTA_HOME`), ll. 1424–1431 (umask refusal, `.secret-read-root`);
  Diary 0028 l. 523 (Hermes-from-source cost); Diary 0031 ll. 907–911
  ("clean-project path is still not boring") and ll. 79–80 (bun
  install/workspace protocol); Diary 0038 l. 63 (121.06 ms under
  anonymous mode) and §157; Diary 0039 l. 245 (port coordination),
  §Quantitative shape (committed custody 84,914 bytes vs. Convex's
  87,158), and "Installed, coherent TypeScript workflow" as the first
  entry under "Where Convex is better." The TS7016 finding is genuinely
  independent across three diaries (0027 l. 1420, 0028 l. 911, 0029
  l. 862).
- **The facet decomposition (§How they differ).** Splitting coherence into
  naming unity, one CLI, one documentation dialect, app-owned artifacts,
  silent runtime, and the agent lens is the document's real analytical
  contribution; Finding 3's observation that the closure addresses mainly
  the install facet reframes CV-1's residue correctly. Facet 6
  ("agent-boring is specifiable") converts diary anecdotes into a named
  requirement class — one noninteractive path, predicate-naming
  diagnostics, docs-equal-disk, total cleanup — which downstream owners
  can actually adopt.
- **Guide-dialect finding is verified and sharp.** `guide/getting-started/
  your-first-backend.md` l. 58 imports from `'../../_kit/define.mjs'` and
  l. 195 teaches `node packages/snapback-codegen/index.mjs myapp/snapback`
  on the same page that mentions `snapback new` (l. 27). The observation
  that LLP 0061's snippet-authority mechanism *structurally* biases the
  guide toward the checkout dialect — the truth-anchoring device prevents
  the installed dialect — is the kind of second-order insight the READY
  bar asks for, and OQ4 routes it to the right owner.
- **Faithful owning-document alignment.** Option 5 reproduces both sides
  of the 0111-vs-0074 conflict accurately (0111 ll. 9–15 serialize
  `latest` behind the hosted journey; 0074 header makes npm a parallel
  gate; the day-before-the-gate fact matches 0115 OQ5); Option 6
  reproduces 0041's 2026-07-30 open question (ll. 927–940) exactly,
  including the Codex-review digest-pinned-instrument variant; the
  Relationship section's ownership map (0041 lead, 0111 sequencing, 0113
  cannot mint stable, 0114 starter, 0062 app CLI, 0061 guide mechanism)
  checks out against each document.
- **Empirical honesty.** The Confidence section names the unrun registry
  probe, the missing scaffold-to-first-row timing (with LLP 0074's
  preregistered comparison as the instrument), and the unspiked
  single-binary feasibility. Option 4 independently flags the registry
  probe before reliance. Nothing I found asserts what only running code
  could establish.

## 3. Concerns

1. **MATERIAL — Facet 1 (naming unity) has no option-level analysis, and
   the naming-transition/evidence-lineage interaction is unexamined.**
   The document's own decomposition puts naming unity first among the
   facets the closure does not fix (Finding 3: "the `@ccheever/*` alias
   seam persist[s] after promotion completes"), yet the option space
   contains no option whose primary target is facet 1. OQ3 names the
   decision and the load-bearing mechanism fact (0041 l. 331: the brand
   scope may replace the alias "without changing authored imports"), but
   the concrete paths — dispute/recover the squatted `@snapback` scope,
   secure a different organization scope, secure an unscoped name, or
   accept `@ccheever/*` as durable — and their distinct costs are never
   laid out. Most importantly, a rename's interaction with LLP 0115
   governing constraint 1 (no evidence regression) is unstated: the
   `0.1.0` closure's value rests on a byte-bound publication ledger and
   clean-machine receipts bound to the `@ccheever/snapback-*` names; new
   names restart version history, cannot inherit `latest` continuity, and
   raise the question of whether ledger lineage carries across or the
   public-proof suite must re-run under the new names. The capsule's
   review charge names exactly this class (unstated interactions with
   0115's governing constraints). This is pre-empirical desk analysis the
   document could do today. *Resolves it:* a short Option 7 (or an
   expanded OQ3) enumerating the naming paths with cost/risk per path,
   explicitly including ledger/receipt/`latest` continuity across a
   rename and what would need re-proving.
2. **DETAIL — Declaration-file enumeration is factually wrong.** The
   document states "only `index`, `search`, `external-store`, and
   `canonical-client-value` carry `.d.mts` files"
   (§What Snapback does today, first seam bullet), but
   `packages/snapback-client/app-data.d.mts` exists and the `./app-data`
   export carries a `types` condition (`package.json` ll. 35–38) — five
   declared subpaths, not four. The same bullet's "declarationless" set is
   also incomplete: `./agent-authority` and `./hosted-browser` are bare
   mappings like `./rqs*`. The substantive `./online` conclusion is
   unaffected, but this sits inside a claim the Confidence section grades
   High ("export-map and declaration facts… checked against the working
   tree"). *Resolves it:* correct the enumeration in both directions.
3. **DETAIL — Paraphrase presented as a quotation of LLP 0041.** The
   package-inventory paragraph attributes the quoted phrase "not an
   unlisted tenth registry package" to 0041; 0041's actual sentence
   (l. 369) is "`@snapback/hosted-supervisor` is not a tenth public
   package in this closure." The phrase as quoted appears nowhere in
   0041. The point survives; the quotation marks do not. *Resolves it:*
   quote verbatim or drop the quotation marks.
4. **DETAIL — `templates/` reads as a repository-root path.** "the
   packaged CLI now dispatches… ; `templates/` ships `react` and
   `todo-contract`" invites reading `templates/` at the repo root; the
   directory is `packages/snapback-cli/templates/` (no root `templates/`
   exists). *Resolves it:* qualify the path.
5. **DETAIL — Related header omits Diary 0029.** The body cites Diary
   0029 for the Linear-arm TS7016 finding (correctly — 0029 l. 862), but
   the Related line lists only Diaries 0022, 0027, 0028, 0031, 0038,
   0039. *Resolves it:* add Diary 0029 to Related.
6. **DETAIL — The `ex_hermes_create_no_eval()` symbol is not in Diary
   0038.** Facet 5 cites "(Diary 0038; LLP 0115 CV-2/CV-3)" for the
   refusal-after-link incident; Diary 0038 records the incident
   (ll. 144–147) but phrases it as "Hermes promise rejection checkpoint
   tracking is unavailable" — the literal symbol name appears in LLP 0115
   CV-2 and Diary 0039 P0-2, not 0038. The dual citation makes this
   defensible, but a reader checking 0038 for the named symbol will not
   find it. *Resolves it:* attach the symbol to 0115 CV-2/Diary 0039 and
   the incident to 0038.

## 4. Suggestions (non-blocking)

- Cross-reference LLP 0123 Option 2 (prebuilt hermetic runtime
  distribution) from Options 2–3: the "runtime fetched on demand behind
  the CLI" shape — Convex's literal model, which facet 5 describes — is
  the natural intermediate between the platform-package status quo and the
  single binary, and it lives in 0123. A one-line pointer would tell the
  reader the axis is covered by the sibling document rather than missed.
- If any download-on-demand shape is entertained, note that 0041's public
  proofs run `latest` installs with npm scripts disabled (0041 l. 70), so
  a postinstall-download design would collide with the proof posture while
  a first-run download would not. This is a cheap, analyzable constraint
  worth one sentence.
- Option 4 frames onboarding as scaffold-first; Convex's coherence also
  covers add-to-existing-project (`npm install convex` inside any app).
  Options 3+4 jointly bracket this, but naming the add-to-existing path as
  a distinct first-hour surface would sharpen the facet-3/facet-4
  coverage.
- Consider one line scoping out Windows: the closure is darwin-arm64 +
  linux-x64 and all diary evidence is macOS/Linux, so "installed product"
  currently has an undiscussed platform boundary (0041's open platform
  question is the owner).

## 5. Open questions

- Is the unscoped `snapback` npm name available or squatted? (The document
  correctly names the registry probe as unrun; it gates Option 3's
  cheapest form.)
- Does the publication-ledger lineage survive a package rename, or does a
  brand-scope swap require re-running the two-platform public-proof suite
  under the new names? (Part of concern 1; answerable by desk analysis of
  0041's ledger design.)
- Should facet 6's "agent-boring" requirement class be extracted into a
  checkable checklist owned by a Spec (0041 or the guide), so future
  diaries can score it rather than re-derive it?

## 6. Verdict

**NOT READY** — narrowly, and strictly against the stated bar. The
document is decision-free, provenance-disciplined, and its verified
factual base is the strongest I have seen in this series; none of the
concerns touch its conclusions. But the bar is "exhausted what
pre-empirical analysis can deliver" with "no flaws": facet 1 of its own
decomposition lacks the option-level analysis the other facets received —
including an unstated interaction with 0115's no-evidence-regression
constraint that is analyzable without running anything — and two small
factual/citation flaws sit inside High-confidence claims. All fixes are
bounded and require no empirical work.

## 7. Recommended next step

A v0.2 revision: add the facet-1 naming-path option (or expanded OQ3)
with the ledger/`latest`-continuity interaction (concern 1); correct the
declaration enumeration, the 0041 pseudo-quote, the `templates/` path,
the Related header, and the 0038 symbol attribution (concerns 2–6);
optionally absorb the suggestions. These are hours, not days, of desk
work. A delta re-review against the revision should suffice for this
family; nothing here requires a full re-read round.

## Round 2 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context (round-2 delta), read-only
review of the working tree at commit 97946b33, cross-family blind
**Target SHA-256:** `27390c8950fd22ca209a714a472da9159311b9868ad9362f4f2e37a1e66afec9`
**Instruction SHA-256:** `33c3fd21fcc61f4ed59da1207ef188e75a1328149be03f08f57ca9141b06f7ce`
**Status:** completed

## 1. Resolution check (round-1 Fable concerns)

1. **MATERIAL — facet-1 naming analysis + evidence-lineage interaction:
   RESOLVED.** Option 7 is exactly what the concern asked for: four
   analyzable paths (accept `@ccheever/*` as durable; dispute/negotiate
   the `@snapback` scope; fresh organization scope; unscoped front-door
   name) each with distinct costs, the scope-dispute path correctly
   labeled general-industry-background with applicability unprobed, and
   path (d) gated on the registry probe. The ledger interaction is
   analyzed, not gestured at: the 0041 alias-swap quote is now verbatim
   (0041 l. 331, "may replace this public alias without changing
   authored imports" — verified), the document correctly derives that a
   rename cannot inherit byte-bound receipt history or `latest`
   continuity, states the re-proof obligation under 0115 governing
   constraint 1 (whose paraphrase — "ergonomic work must not weaken an
   evidence boundary" — is faithful to 0115 l. 93–96, verified), and
   draws the sequencing consequence (rename cost grows with the receipt
   corpus). The new per-option no-evidence-regression subsection extends
   the same constraint across Options 1–7 with a stated dimension list;
   its Option 6 entry is grounded in code I verified (see §2 checks
   below). Round-1 open question 2 (does ledger lineage survive a
   rename?) is answered — it does not; re-proof is required — with the
   empirical residue honestly routed to §Empirical questions 6. This is
   the analysis the round-1 verdict was waiting for.
2. **DETAIL — declaration enumeration: RESOLVED.** Verified against
   `packages/snapback-client/package.json` and the tree: exactly five
   subpaths carry `types` conditions (`.`, `./app-data`,
   `./canonical-client-value`, `./external-store`, `./search`; the five
   matching `.d.mts` files exist), and `./agent-authority`,
   `./hosted-browser`, `./online`, and the four `./rqs*` subpaths are
   bare mappings. Both the seam bullet and Finding 5 now state this
   correctly.
3. **DETAIL — 0041 pseudo-quote: RESOLVED.** Now quoted as "not a tenth
   public package in this closure" — verbatim match to 0041 l. 369.
4. **DETAIL — `templates/` path: RESOLVED.** Now
   `packages/snapback-cli/templates/` in both occurrences.
5. **DETAIL — Related header missing Diary 0029: RESOLVED.** Diary 0029
   is in the Related line.
6. **DETAIL — `ex_hermes_create_no_eval()` attribution: RESOLVED.** The
   split is now explicit and correct: the incident attributed to Diary
   0038 (phrased there as promise-rejection checkpoint tracking
   unavailable — matches 0038 ll. 144–147 as verified in round 1), the
   symbol name to LLP 0115 CV-2 and Diary 0039 P0-2 (verified: the
   literal symbol appears in Diary 0039's P0 item 2, l. 313).

Round-1 suggestions (non-blocking): the LLP 0123 cross-reference was
adopted into Option 2 (with a defect — new concern 1 below); the
postinstall/npm-scripts note, the add-to-existing-project surface, and
the Windows scoping line were not adopted, which is fine — they were
non-blocking.

## 2. Delta spot-checks of the v0.2 factual claims

All verified against the working tree unless noted:

- **Blocking-scope split.** 0115 CV-1's exit text is quoted verbatim:
  "(Campfire or Streak Lab)" and "the admin-client proof rides Dispatch
  or a separate fixture" both match 0115 ll. 235–238. The derived split
  (helpers block any external arm; admin client blocks Dispatch
  specifically; full CV-1 exit needs both custody decisions) follows
  from that text.
- **Admin-client decomposition.** `packages/snapback-admin-client/
  index.mjs` confirms every listed property: master-token handling with
  immediate exchange for a short-lived console credential
  (`/console/credential`), secret-read leases commented "intentionally
  memory-only" and never restored from browser storage, and credential
  redaction (`CREDENTIAL_REDACTION`, `redactKnownSecrets`).
  `src/admin.rs` l. 290 confirms the served-path intent: "for external
  tooling — one client, no drift."
- **Helper checkout entanglement.** `demos/_kit/server-process.mjs`
  imports `../../scripts/lib/process-tree.mjs`,
  `../../scripts/runtime-link-smoke.mjs`, `./provenance.mjs`, and
  `../../packages/snapback-cli/runtime-recovery.mjs`, and carries the
  `cargo run` source-tree fallback rung — all as stated.
- **Comparator surface.** `guide/testing/acceptance.md` §The
  backend-comparator profile confirms `snapback accept comparator`,
  `defineComparatorProfile` from `@snapback/cli/comparator`, the five
  mandatory profile checks, and "Run it from the application root."
- **Guide reframing.** `guide/conventions.md` l. 103–104 contains the
  quoted snippet-source sentence verbatim ("a demo acceptance suite,
  package test, or proof script"); `guide/getting-started/
  the-authoring-loop.md` frontmatter lists
  `packages/snapback-cli/templates/{todo-contract,react}` and the
  `sessions-dev-loop.test.mjs` package test among its `examples:` while
  teaching `snapback new`/`generate`/`dev`; every `source=` fence on
  `your-first-backend.md` transculdes from `demos/todo/` — so "corpus
  choice, not mechanism" is the right diagnosis, and the reframed OQ4
  and Relationship-section wording are consistent with it. (One
  overstatement in the facet-3 restatement — new concern 2.)
- **Flagship-scope clarification** ("staged package confirmations did
  consume package-only artifacts; the flagship matrix did not") is
  consistent with the round-1-verified diary record.
- The expanded Revised header parses; `./ref-check` reports 0 errors
  corpus-wide.

## 3. New concerns in the delta

1. **DETAIL — Stale option number in the LLP 0123 cross-reference.**
   Option 2 says the intermediate shape "is LLP 0123 Option 2 (prebuilt
   hermetic runtime distribution)." In the working tree at 97946b33,
   LLP 0123's Option 2 is "Server-side readiness: the process witnesses
   itself"; prebuilt hermetic runtime distribution is **Option 3**
   (l. 352). The mismatch is a concurrent-revision artifact — 0123's own
   v0.2 fix pass renumbered its options in the same commit that added
   this cross-reference — and the parenthetical name keeps the reader
   from landing on the wrong option, but the number as printed is wrong
   in the reviewed tree. *Resolves it:* say "LLP 0123's prebuilt
   hermetic runtime distribution option" or correct the number to 3.
2. **DETAIL — Facet 3 misplaces the package-anchored snippets.** The
   facet-3 text claims "installed-dialect, package-fixture-anchored
   snippets already exist on the authoring-loop page."
   `guide/getting-started/the-authoring-loop.md` contains **no**
   `source=` fences at all — only plain `sh`/`text` blocks; in the
   guide's own vocabulary (conventions §snippet classes) its package
   anchoring is the `examples:` frontmatter, not snippets. The parallel
   sentence in §What Snapback does today gets this exactly right
   ("lists the packaged templates and a package test among its
   examples"). Package-sourced verified snippets *do* exist — on other
   pages (`guide/backend/standard-patterns.md` has four
   `source=packages/snapback-codegen/standard-patterns.test.mjs`
   fences; also `guide/clients/headless.md`, `guide/clients/
   contract-adapter.md`, `guide/auth/scoped-roles.md`) — which supports
   the "mechanism accepts package sources" argument *better* than the
   sentence as written. But the location claim fails the check, and it
   sits inside the Confidence section's High bucket ("guide dialect…
   checked against the working tree"). *Resolves it:* repoint the
   sentence at the corpus (e.g., standard-patterns) or restore the
   examples-frontmatter phrasing used earlier in the document.

Nothing else in the new text failed a check. The new no-evidence-
regression subsection and Option 7 stay decision-free; the two general-
industry-background claims added in v0.2 (scaffold-first delivery
model, npm dispute process) are both explicitly provenance-labeled; the
"ledger machinery is name-parametric" judgment is hedged and its
empirical residue is routed to §Empirical questions 6.

## 4. Verdict

**NOT READY** — by the thinnest possible margin, and only on the two
one-sentence defects above. The round-1 MATERIAL gap is genuinely
closed: Option 7 and the no-evidence-regression subsection are the
missing analysis, done well, and every round-1 concern is resolved
rather than reworded. The document has, in my judgment, now exhausted
what pre-empirical analysis can deliver on this front. What it has not
yet met is the bar's other clause — "no flaws": the delta introduces
two verifiably false statements (a wrong option number against the
sibling document as revised in the same commit, and a snippet-location
claim that fails against the guide corpus, the latter inside a
High-confidence claim). These are the same citation-accuracy class my
round 1 counted against the bar, so consistency requires counting them
here; but they are transcription-level, touch no conclusion, and each
is a one-line fix.

## 5. Recommended next step

Apply the two one-line corrections (concern 1: "Option 2" → "Option 3"
or drop the number; concern 2: repoint the facet-3 sentence at the
corpus). With those applied verbatim, this family's concerns are
exhausted: no further Fable review round is needed — a fix-verification
pass (confirming the two lines) suffices, and the author may treat this
family as READY at that point without another subagent round. When
editing the cross-reference, re-check LLP 0123's option numbering in
the same tree state, since the sibling document is being revised
concurrently.

## Round 3 — 2026-07-30 (fix verification)

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** round-3 fix-verification only (not a full review round):
verified the two round-2 delta defects against the working tree at
commit af9e48fc, plus a sanity skim of the full v0.2→v0.3 diff
(`git diff 97946b33 -- llp/0122-…research.md`) with spot-checks of the
new code-grounded claims; cross-family blind (the .codex.md artifact
was not read)
**Target SHA-256:** `185be0b16c4d3e2b409d3e848fafd2152d8b58e842531c9e7b59f52c18316219`
**Instruction SHA-256:** `57e44096be0052fede6bb4a749d0f8b7823258d30cd0aaf49e4b09a438cd85b8`
**Status:** completed

## 1. Per-item verification

1. **Round-2 concern 1 (LLP 0123 cross-reference): FIXED.** The
   sentence now reads "is LLP 0123's
   prebuilt-hermetic-runtime-distribution option (Option 3 after
   0123's v0.2 renumbering)." Checked against the sibling document as
   it now stands — LLP 0123 has since been revised to v0.3 — and the
   numbering holds: `### Option 3 — Prebuilt hermetic runtime
   distribution` (l. 434 of the current
   `llp/0123-runtime-readiness-and-operational-edges.research.md`;
   Option 2 remains "Server-side readiness: the process witnesses
   itself"). The v0.3 revision of 0123 did not renumber again, so both
   the option name, the number, and the "v0.2 renumbering" attribution
   are correct in the current tree.
2. **Round-2 concern 2 (facet-3 snippet location): FIXED.** The
   rewritten facet-3 passage makes exactly the corrected claim and
   every leg checks out against the guide corpus:
   `guide/getting-started/the-authoring-loop.md` contains zero
   `source=` fences, and its `examples:` frontmatter lists
   `packages/snapback-cli/templates/todo-contract`,
   `packages/snapback-cli/templates/react`, and
   `packages/snapback-cli/sessions-dev-loop.test.mjs` — the packaged
   templates and a package test, anchored via frontmatter as the text
   now says; `guide/backend/standard-patterns.md` transcludes exactly
   four snippets with
   `source=packages/snapback-codegen/standard-patterns.test.mjs`; and
   "more on the client and auth pages" is true (`guide/clients/
   contract-adapter.md`, `guide/clients/headless.md`,
   `guide/clients/react.md`, `guide/auth/protecting-data.md`,
   `guide/auth/scoped-roles.md` all carry `source=packages/…` fences).
   The passage's upgraded argument — the mechanism "verifiably renders
   them on guide pages today" — is supported by those fences.

## 2. Sanity skim of the rest of the v0.3 delta

The remaining v0.3 edits (Option 7's rename recast as a name-bound
proof-system migration, the admin-client custody re-costing, empirical
probe 8, the closed-list-by-review qualification, the Revised header)
respond to the other family's round and were skimmed, not re-reviewed.
Nothing my round 2 verified clean was damaged: the round-1 fixes
(declaration enumeration, 0041 verbatim quotes, `templates/` path,
Related header, symbol attribution) are untouched by the diff, and the
0041 alias-swap quote ("may replace this public alias without changing
authored imports") survives inside the rewritten Option 7 text.
Spot-checks of the new code-grounded claims all pass:
`packages/snapback-publication-authority/protocol.mjs` hard-codes the
nine `@ccheever/snapback-*` names and enforces the scope by regex
(`/^@ccheever\/snapback-[a-z0-9-]+$/u`, l. 323);
`scripts/snapback-package-cold-install-lib.mjs` refuses
`ledger.scopePreset !== 'ccheever'` (l. 1234); and `src/admin.rs`
l. 291 embeds the admin client with
`include_str!("../packages/snapback-admin-client/index.mjs")`,
supporting the byte-for-byte served-file claim. The v0.3 replacement of
"the ledger machinery is name-parametric, so re-proving is mechanical"
with the name-bound-machinery analysis is a strengthening grounded in
that code, not a regression.

## 3. Verdict

**READY.** Both round-2 defects are fixed as specified and verified
against the current tree; the sanity skim found no damage to previously
verified text and no new defect. Per round 2's own terms — NOT READY
solely on those two one-line items — this family's concerns are
exhausted.

## 4. Recommended next step

No further Fable review round. The author may record this family as
READY for LLP 0122 v0.3 (target SHA above) and proceed per the LLP 0005
loop with the other family's disposition.
