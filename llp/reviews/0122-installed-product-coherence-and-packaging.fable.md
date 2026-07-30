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
