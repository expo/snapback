# Review artifact — gpt-5 family — cluster 0193-0197 (primary 0193)

## Round 1 — 2026-08-08

Provenance: codex exec, model gpt-5.6-sol, effort xhigh, codex-cli 0.147.0,
capsule sr-capsule-r1 (hashes in the run journal), targets at revision 54fa456cf.
Launches this round: 3 (two failed on CLI-flag/stdin mechanics, recorded; this body is launch 3). Verbatim body follows.

Reading additional input from stdin...
OpenAI Codex v0.147.0
--------
workdir: /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR]
reasoning effort: xhigh
reasoning summaries: none
session id: 019fe200-a713-7b42-a3d5-c4d9109517ef
--------
user
You are reviewing a five-document LLP set as one cluster: LLP 0193
(errors-as-docs completeness, Plan), 0194 (generated API reference, RFC),
0195 (public documentation/examples/training surface, RFC), 0196
(template and recipe portfolio, Plan), 0197 (benchmark publication
standard, RFC). CONTEXT.md carries the factual background; the five
documents are the review targets, whole and unredacted.

Review for MATERIAL concerns only at the level of: correctness (claims
wrong or unsupported), coherence (documents contradicting each other or
their cited context), feasibility (a program that cannot work as
written), safety (security/privacy/trust implications missed), and
decision-quality (a defective decision, a missing alternative that
should change the decision, an author-decision mislabeled as settled).
Altitude rule: demands for more implementation detail that identify no
defective decision are NOT material — list them separately as
implementation-phase notes if worth recording.

FORMAT your review exactly as:
1. A numbered concern list; each concern labeled [MATERIAL] or [minor],
   naming the target document and section, stating the defect and (for
   MATERIAL) what change would resolve it.
2. Per-target verdict lines: "0193: READY" or "0193: NOT READY — blocking
   concerns: <numbers>" (and likewise 0194-0197). READY means no
   unresolved MATERIAL concern in that document.
3. One set-level verdict line: "SET: READY" or "SET: NOT READY" (the set
   is READY only if the cross-document seams are coherent even where
   individual documents pass).
Be specific and quote the text you dispute. Do not rewrite the
documents; do not review style. You are the only reviewer; do not
reference other reviews.

The capsule files are in the current directory: CONTEXT.md plus the five LLP documents. Read them all in full and produce the review in exactly the instructed format.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
2026-08-08T15:32:02.102865Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server linear: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
codex
I’m using the LLP review guidance because this is an explicit LLP cluster review. I’ll read its instructions first, then all six capsule files in full, and return only the requested review format.
exec
/bin/zsh -lc 'cat /Users/ccheever/.codex/skills/llp/SKILL.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
 succeeded in 0ms:
---
name: llp
description: Create, review, and list Exact LLP documents in the Exact repository. Use when Codex is asked to work with `/llp`, `$llp`, LLP proposals, LLP reviews, LLP numbering, or files under `llp/`.
---

# llp

Use this skill for Exact's LLP document workflow. Prefer LLP terminology:
"LLP document" for the general case, "RFC" only when the document type is
actually RFC, and `# LLP NNNN: Title` for new numbered documents.

## Ground Rules

- Work from the repository root when possible.
- Search `llp/` when numbering or locating LLP documents.
- Keep documents in `llp/`.
- Numbered filenames are `NNNN-slug.type.md`, for example
  `0042-video-component.rfc.md`.
- New proposal documents default to `Type: RFC`.
- Required metadata for new documents: `Type`, `Status`, `Systems`, `Author`,
  `Date`, `Revised`, and `Related`.
- Valid proposal statuses for `RFC`, `Spec`, and `Plan`: `Draft`, `Review`,
  `Accepted`, `Implemented`, `Superseded`, `Shelved`, and `Withdrawn`.
- Normalize statuses when matching by stripping ` vN`, stripping trailing
  parenthetical notes, and comparing case-insensitively.
- Do not accept or reject LLP documents on the user's behalf.
- Do not renumber existing unnumbered documents unless the user is actively
  updating one.

## Create

For `/llp create <title> [--type <type>]`:

1. Scan existing numbered LLP files in `llp/`.
2. Pick the next number.
3. Build the slug: lowercase, replace non-alphanumerics with `-`, collapse
   repeated `-`, and trim edge `-`.
4. Create `llp/NNNN-slug.type.md` with this scaffold, using the requested type
   or defaulting to `RFC` and `.rfc.md`:

```markdown
# LLP NNNN: <Title>

**Type:** RFC
**Status:** Draft
**Systems:** TBD
**Author:** Charlie Cheever / Codex
**Date:** YYYY-MM-DD
**Revised:** YYYY-MM-DD
**Related:**

## Summary

## Design
```

5. Help draft the document from the current conversation context.

## Review

For `/llp review <identifier>`:

- The identifier may be a number like `0036`, a slug like
  `intent-level-authoring`, or omitted. If omitted, list Draft/Review
  documents and ask which one.
- Locate the document in `llp/` and read the full file.
- Review it using this prompt:

```text
What do you think of this proposal? Is it a good idea? Do we have a good plan here? How would you change it to make it better? What would you add or take away or change? Is anything definitely or possibly wrongheaded here? Do you have any novel ideas that you think might make this way better even if they are a bit non-standard? What are the key open questions we need to answer to refine this?
```

- Present findings first: overall assessment, strengths, concerns,
  suggestions, and open questions.
- Save the review artifact under
  `notes-archive/ai-reviews/{slug}.round-{N}.AGENTS.md`.
- Derive `{slug}` by stripping the leading `NNNN-` and trailing `.type.md`.
- Increment `{N}` based on existing `*.AGENTS.md` review files.
- If the document is still `Draft`, suggest updating it to `Review` after the
  review.
- Remind the user that the LLP process also recommends a GPT review unless
  this Codex review is the GPT review they wanted.

## List

For `/llp list [status]`:

1. Scan `llp/`.
2. Extract and normalize `**Status:**`.
3. Group documents by normalized status.
4. Sort numbered documents ascending, then unnumbered documents alphabetically.
5. If a status filter was provided, show only that group.

Render numbered documents as:

```text
0038  exact-inspect-skill
0039  rfc-skill
----  unnumbered-rfc
```

exec
/bin/zsh -lc "pwd && rg --files -g 'AGENTS.md' -g 'CONTEXT.md' -g '*0193*' -g '*0194*' -g '*0195*' -g '*0196*' -g '*0197*' | sort" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
 succeeded in 0ms:
/private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
0193-errors-as-docs-completeness.plan.md
0194-generated-api-reference.rfc.md
0195-public-documentation-and-training-surface.rfc.md
0196-template-and-recipe-portfolio.plan.md
0197-benchmark-publication-standard.rfc.md
CONTEXT.md

exec
/bin/zsh -lc 'cat 0194-generated-api-reference.rfc.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
 succeeded in 0ms:
# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Review
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0061 (guide design — intent-indexed by choice), LLP 0186
(measurement evidence), diaries 0068-0069

## Summary

Across five measurement runs, every remaining package-source excursion
shares one shape: a **signature or contract question** — headless
`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
(extracted from runtime binary strings in run 5), the verify-config
contract, client constructor option pairs. The guide is deliberately
intent-indexed (LLP 0061) and should stay that way; what is missing is
the complementary layer: a **complete, generated, build-bound API
reference** derived from the packages' own `.d.mts` declarations — the
types agents consistently praise — so that no signature question ever
requires opening `node_modules`.

## Design

1. **Source of truth:** the published packages' `.d.mts` files plus doc
   comments. No hand-written reference pages — generation only, so it
   cannot drift (the closure-drift lesson, LLP 0186 W0).
2. **Generation:** a build step (TypeScript compiler API, the
   export-parity test's traversal as the seed) emitting one markdown
   page per package under `guide/reference/<package>.md`, with stable
   per-symbol anchors. Runs in the same pipeline as
   `generate-guide-manifest`; output is committed generated artifact,
   checked like the flat guide.
3. **Serving:** joins the guide manifest — served at
   `/_snapback/guide/reference/...`, present in `flat.md`, indexed by
   `snapback guide <query>` and the MCP resources, listed in
   `/llms.txt`. Build-bound headers like every guide response.
4. **Joins:** intent pages link into reference anchors ("full signature:
   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
   may cite reference anchors as their fix pointer.
5. **Scope order:** `@expo/snapback-client` (headless surface — the
   largest excursion source), `snapback-react` hooks and fact types,
   `snapback-expo`, the `ctx` handler surface (which needs a declaration
   source — see OQ2), CLI verify/config contracts.

## What this kills

Run-attributed: headless args nesting (0068, 0069×2), hook state shapes
(0066), `createAssetClient` discovery (0068), verify-config contract
(0068, 0069), constructor option pairs (0069×2), `ctx.db` verbs (0069,
via binary strings). Roughly a third of the residual orientation bucket
in diary 0069's decomposition.

## Open questions

- OQ1: Page granularity and size budgets — per-package pages may exceed
  the flat-guide size discipline; per-module splitting rules needed.
- OQ2: The `ctx` handler surface (db verbs, assets, refuse) is a runtime
  contract, not a package `.d.mts` — it needs either a published
  declaration file (preferable: consumers get editor types too) or a
  hand-fenced reference section until one exists.
- OQ3: Whether doc comments in `.d.mts` are complete enough to render
  useful prose, and whether improving them (which rotates artifact
  identity — the doc-comment lesson) batches with releases.
- OQ4: Versioning — the reference is inherently build-bound (served),
  which is correct; whether the public docs surface (LLP 0195) pins
  per-release snapshots is that RFC's question.

exec
/bin/zsh -lc 'cat 0193-errors-as-docs-completeness.plan.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
 succeeded in 0ms:
# LLP 0193: Errors-as-docs completeness program

**Type:** Plan
**Status:** Review
**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
diaries 0065-0069

## Summary

Five measurement runs agree that error quality is Snapback's
best-performing agent-efficiency investment: lanes repeatedly resolved
failures fastest when the refusal named its own fix (the PNG-CRC
diagnostic naming the failing chunk is the exemplar), and every remaining
expensive detour traces to a code that didn't. LLP 0186 W3 states the
bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
the violated rule and either the fix or a resolving guide anchor** — but
the bar has only ever been applied to codes that happened to appear in
diaries. This Plan audits the entire population once and then makes the
bar structural, so it can never regress.

## Evidence

- Diary 0069: zero framework defects, yet six of the run's expensive
  moments were knowledge-shaped — half of them reachable from a refusal
  that could have carried the answer.
- The counterexamples prove the mechanism in both directions: refusals
  that named remediations (`snapback assets put --user`, the CRC chunk,
  seed-recovery messages) cost near-zero; refusals that did not (the
  0.1.10-era `host-ops response was not JSON`, the hashed field path)
  each cost a bisection session.
- The infrastructure half-exists: stable code registry, the
  production diagnostic-inventory drift gate, and 0146 D7 ratified as
  the remediation carrier.

## Program

**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
code inventory (estimated 200-500 codes) from the diagnostic registry
plus a grep sweep for unregistered emissions. Fan out grading lanes:
each code graded A (names rule + fix/anchor), B (names rule only), or
C (bare), with the emitting site and agent-triggerability recorded.
Output: a checked-in graded ledger under `tests/acceptance/diagnostics/`.

**Phase 2 — fix in evidence order.** First: every B/C code that appears
in any diary's correction-loop list. Then B/C codes on
agent-triggerable paths, batched by subsystem. Message edits follow the
house style; guide anchors must resolve (check-guide enforces). Codes
that are genuinely internal (never agent-triggerable) are marked so in
the ledger rather than polished.

**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
a new agent-triggerable code cannot land without a remediation field or
resolving guide anchor (this is 0146 D7's enforcement carrier — the
typed `remediations` shape lands here if not already built). Anchor
resolution joins CI. The graded ledger becomes the gate's baseline;
grade regressions fail.

**Phase 4 — close the loop with measurement.** The next benchmark run's
lane reports grade every refusal encountered; new B/C sightings are the
recurring audit input.

## Exit criteria

1. Graded ledger covers 100% of registered codes; zero ungraded
   emissions in the sweep.
2. Every diary-cited code is grade A.
3. The drift gate refuses a new agent-triggerable code without
   remediation/anchor (negative test).
4. A benchmark run passes with zero C-grade refusals encountered.

## Open questions

- OQ1: Whether D7's typed `remediations` array (structured) or message
  text + anchor (unstructured) is the Phase 3 minimum — structured is
  the 0146 design; text+anchor may be the pragmatic floor for the long
  tail. Proposal: structured for new codes, text+anchor acceptable for
  audited legacy codes until touched.
- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
  from any published-surface operation, decided by the grading lane,
  spot-checked in review.

exec
/bin/zsh -lc 'cat 0195-public-documentation-and-training-surface.rfc.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
 succeeded in 0ms:
# LLP 0195: Public documentation, examples, and training-data surface

**Type:** RFC
**Status:** Review
**Systems:** Documentation, Publishing, Guide, Templates, Competitive
evaluation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0186 (the orientation-gap evidence), LLP 0061 (guide),
LLP 0041 (packaging), diaries 0065-0069

## Summary

Snapback currently has **no public documentation surface**. The guide
exists only in this repository and served from installed binaries: an
agent cannot read a word of it before installing, search engines and
training pipelines never see it, and `llms.txt` exists only on loopback
origins. Meanwhile the measurement series attributes roughly a third of
the remaining efficiency gap to orientation cost that Convex does not
pay because `docs.convex.dev` is in every model's training set. A public
surface is simultaneously the pre-install orientation fix, the
discoverability fix, and the **only available lever on the training-data
moat** — and it is the largest unstarted item this program has
identified. It is proposed here rather than executed because publishing
is the author's decision.

## Proposal

1. **Public docs site, generated from `guide/`.** The corpus is already
   CI-verified, version-fenced (`published-closure.json` + `since:`
   machinery), and honest by construction (GAP rows). A static site
   generator over `guide/` — same markdown, same snippets, the 0194
   reference included — published on a real domain, with `/llms.txt` at
   the root and per-release snapshots pinned to published closures (the
   fence machinery already knows what each closure contains). The
   in-repo/served guide remains canonical; the site is a projection with
   the same content hashes.
2. **Public examples repository**, mirroring the template outputs and
   selected demo apps (the benchmark lanes' apps are strong candidates:
   complete, proof-carrying, honestly scoped). Each example pinned to a
   closure version and CI-cold-installed against the registry — the
   examples repo doubles as an external consumer canary.
3. **Skill distribution beyond scaffolds:** publish
   `snapback-authoring` wherever agent harnesses discover skills, so
   pre-scaffold orientation exists off-checkout.
4. **Deliberate training-data posture:** the site, examples, README
   funnels, and npm packages are the corpus future models learn
   Snapback from. Write them with that audience explicitly in mind
   (stable vocabulary, the Rosetta aliases, canonical snippets) — the
   measurement series is the feedback loop that will eventually show
   the moat eroding (orientation tokens per lane trending toward
   Convex's zero).

## What this does not claim

No hosted-service claims change; the site documents the local-first
surface the capability index already asserts, GAP rows included. The
honesty discipline that survived five external-consumer audits is the
asset being published, not marketing copy.

## Author decisions required

- D1: Publish at all, and where (domain; whether the repo itself goes
  public or only generated projections).
- D2: Examples licensing and repo location.
- D3: Snapshot policy (per-release docs versions vs latest-only).
- D4: Whether benchmark artifacts (briefs, records) belong on the public
  site — interacts with LLP 0197's publication standard.

## Open questions

- OQ1: Site generator and hosting (the repo has EAS/Cloudflare lanes;
  either works — pick for boring reliability).
- OQ2: How the site's `llms.txt` and sitemap best serve crawler and
  agent retrieval (the served-guide retrieval-eval corpus can be reused
  as the site's acceptance test).
- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
  public anchors, unifying citations across surfaces.

exec
/bin/zsh -lc 'cat 0196-template-and-recipe-portfolio.plan.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
 succeeded in 0ms:
# LLP 0196: Template and recipe portfolio

**Type:** Plan
**Status:** Review
**Systems:** Templates, CLI, Guide, Testing, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0186 (W2), LLP 0195 (public examples mirror), diaries
0068-0069, benchmarks/briefs/

## Summary

The five-run series established the knowledge ladder empirically:
**scaffold beats guide beats package source** — knowledge moved into
template defaults (0.1.15's sessions mode, offline registration, upload
wiring) produced the largest single-release wall-clock improvement of
the program (bare lane 41.5→29.6 min). This Plan extends the portfolio
along the measured demand: two new templates matching the committed
benchmark briefs, proof machinery registered by default, and the recipe
list the diaries priced.

## Program

**T1 — CRUD-dashboard template** (`--template crud-dashboard`), matching
`benchmarks/briefs/crud.md`: tables/list/detail/edit shapes, relational
query profile in the default path, sessions default, acceptance suite +
**registered verify profile** included. Most agent tasks are CRUD-shaped;
this becomes the default recommendation for generic briefs.

**T2 — media-feed template** (`--template media-feed`), matching
`briefs/media.md`: typed upload intents with renditions in the main
path, delivery-profile selection demonstrated (the strict-vs-public
lesson), infinite-scroll list over retained queries.

**T3 — proof-by-default across all templates:** every template ships a
registered `snapback.verify.config.mjs` (run-5's skill lane registered
profiles by hand; the done-oracle should be non-vacuous from scaffold),
and the expo templates ship web platform + deps (the two-run web-deps
papercut, ticketed 2026-08-08 — absorbed here).

**T4 — recipes** (guide sections with CI-verified snippets, in priority
order from run evidence): the headless-simulator proof kit (plistlib
scheme approval, Expo Go onboarding dismissal, drive-channel pattern —
ticketed), real-auth sign-in flows beyond test personas, the offline
supervisor-origin recipe (ticketed), verify-config authoring (ticketed).
Recipes graduate into template code where a template naturally exercises
them — the ladder says code placement beats prose.

**T5 — template freshness gate:** templates cold-install and pass their
suites against the *published* closure in CI (the staging lane covers
tarball shape; this covers registry reality), so a template can never
teach a drifted surface.

## Sequencing

T3 first (papercut absorption + verify-by-default — small), then T1
(benchmark brief pairing makes it immediately measurable), T2, with T4
recipes landing alongside whichever surface they document. T5 joins the
release checklist when T1 lands.

## Exit criteria

- A cold agent given a CRUD or media brief scaffolds the matching
  template and reaches all proofs with zero template-gap loops.
- `snapback verify` is non-vacuous on every fresh scaffold.
- The next benchmark run on the CRUD brief uses T1 and its lane report
  cites no template gaps.

## Open questions

- OQ1: Template count discipline — the portfolio should stay small
  (three app templates + recipes); additions require a measured brief.
- OQ2: Whether `create-snapback-app` grows an interactive template
  picker or stays flag-driven (agents prefer flags; humans may not).

exec
/bin/zsh -lc 'cat 0197-benchmark-publication-standard.rfc.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
 succeeded in 0ms:
# LLP 0197: Competitive benchmark publication standard

**Type:** RFC
**Status:** Review
**Systems:** Competitive evaluation, Publishing, Documentation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
(harness, records), LLP 0195 (public surface), diaries 0058-0069

## Summary

The measurement program can now produce numbers worth publishing —
five runs, a committed harness, token metering, and a series showing
the skill lane moving from 3.26x to ~2x tokens against Convex. LLP 0186
OQ5 asked what disclosure makes a public comparison credible rather
than vendor noise; this RFC proposes the standard. The governing
principle: **publish the instrument, not just the number** — every
claim reproducible by an outsider from public artifacts alone.

## The standard

A published Snapback benchmark claim requires:

1. **N≥3 runs per configuration** with all runs reported (no
   best-of): median + range. The observed ±30% per-lane variance
   (diary 0069) makes single-run ratios unpublishable. The variance
   study is therefore the prerequisite work item.
2. **The full harness public:** briefs verbatim, lane prompts, fairness
   rules, and run records (the `benchmarks/` tree, published via LLP
   0195) — an outsider with the same model can rerun the measurement.
3. **Fairness notes attached to every chart:** cold-context agents;
   published surfaces only; same model, machine, and serial discipline;
   competitor lanes free to use web docs; model prior-familiarity
   asymmetry stated plainly (it currently favors competitors).
4. **Proof-bar disclosure:** every chart states what each lane proved.
   The headline chart should be the **equal-proof-bar variant**
   (`briefs/messaging-equal-proof-bar.md`): both lanes required to
   prove identical offline semantics — the honest comparison where
   depth is priced instead of penalized. The unequal-bar table may be
   published alongside with the asymmetry stated (Convex lanes'
   own-words caveats — "not a real sync story" — quoted, not
   paraphrased).
5. **Version pinning:** every run names the exact closure and
   competitor versions; claims age out when either moves materially.
6. **Self-report symmetry:** lane reports (the diaries' raw
   correction-loop lists, both vendors') are part of the public record
   — including the runs and loop lists unfavorable to Snapback. The
   credibility of the 94-run honesty discipline is the asset.

## What publishing looks like

A benchmarks page on the LLP 0195 site: the series chart (with the
early losing runs included — the 26m-vs-11m origin is part of the
story), the current N≥3 medians, links to briefs/records/prompts, and a
"run it yourself" section. No superlatives that a record link cannot
back.

## Author decisions required

- D1: Whether to publish at all and when (proposal: after the N≥3
  study and the equal-proof-bar run, not before).
- D2: Which competitors appear (Convex is measured; Supabase/
  PocketBase/Postgres lanes are unbuilt — publishing claims about
  unmeasured competitors is out under this standard).
- D3: Whether competitor names appear in charts or as "backend A/B"
  (proposal: names, with rule 2's reproducibility as the defense).

## Open questions

- OQ1: Token-count comparability across models if the harness ever runs
  on non-Fable models (current standard: one model per published
  series, stated).
- OQ2: Whether an independent third party rerunning the harness is
  worth soliciting before first publication (strongest possible
  credibility; costs a relationship and time).

exec
/bin/zsh -lc 'cat CONTEXT.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1
 succeeded in 0ms:
# Context sheet (facts only; for reviewing the five-document set)

Snapback is a local-first backend framework: declarative schema/functions
with codegen, live queries, ephemeral state, typed assets, sessions auth,
React/Expo/headless clients, a Rust runtime shipped as prebuilt npm
binaries. Its docs are an in-repo "guide" (CI-verified snippets,
capability index with explicit GAP rows, version fences against the
published npm closure) served by running servers at /_snapback/guide and
an embedded `snapback guide` search; there is currently no public web
documentation. Packages @expo/snapback-* are on npm at 0.1.15 (eleven
packages incl. create-snapback-app). An agent skill (snapback-authoring)
ships inside scaffolded apps. A committed benchmark harness exists under
benchmarks/ (briefs, lane prompt templates, run-record schema, fairness
rules) from LLP 0186 W1.

Measurement facts cited by the documents (five serial cold-agent runs,
same brief/machine/model, token-metered): wall/tokens for the
Snapback-with-skill lane vs a Convex lane moved 26m22s/329k vs
16m36s/113k (npm 0.1.13) to 19m00s/201k vs 10m18s/90k (npm 0.1.15);
observed per-lane run-to-run variance ±30% at N=1; latest run had zero
framework-caused defects in any Snapback lane; remaining friction was
knowledge-shaped (signature/contract questions resolved by reading
package source; one case by extracting strings from the runtime binary).
Convex lanes across all runs consumed no documentation (prior model
familiarity). Diaries 0058, 0065, 0066, 0068, 0069 record the runs.
Existing related LLPs: 0186 (agent authoring efficiency program: W0
plumbing fixes shipped; W1 benchmark harness; W2 skill/scaffolds; W3
errors bar; W4 edit-loop taxes), 0146 (agent affordances; D7 = typed
remediations carried by refusals, ratified, enforcement carrier not yet
built), 0061 (guide design, intent-indexed), 0041 (packaging/releases).
A diagnostic-inventory drift gate exists in CI (production diagnostic
codes are classified; new unclassified codes fail).

codex
1. [MATERIAL] 0193, “Summary” and “Evidence”: the claim that “every remaining expensive detour traces to a code that didn’t” name its fix contradicts the document’s own statement that only “half of them [were] reachable from a refusal that could have carried the answer,” as well as CONTEXT.md’s attribution of residual friction to signature and contract questions. The related claim that error quality is the “best-performing agent-efficiency investment” is unsupported by the supplied measurements. Resolve by limiting the causal and comparative claims to the refusal-related incidents actually evidenced.

2. [MATERIAL] 0193, “Exit criteria”: the stated bar is that “every `SNAPBACK_*` refusal an authoring agent can trigger” supplies the rule and a fix or anchor, but exit requires only diary-cited codes to be A-grade and one benchmark run to encounter “zero C-grade refusals.” That permits unobserved agent-triggerable B/C codes—and encountered B codes—to remain, so the completeness program can exit without achieving its declared result. Require every ledger entry classified as agent-triggerable to be A-grade; treat benchmark observations as validation rather than proof of completeness.

3. [MATERIAL] 0193, “Phase 3” and OQ1: “typed `remediations` shape lands here if not already built” is followed by a proposal allowing “text+anchor” for audited legacy codes indefinitely. CONTEXT.md says LLP 0146 D7’s typed-remediation decision is already ratified, so this Plan cannot silently reopen it as an implementation choice. Either enforce the typed carrier as the end state, with a bounded migration if needed, or explicitly propose an amendment to LLP 0146.

4. [MATERIAL] 0194, “Design” and OQ2: the RFC promises a “complete, generated” reference whose source of truth is `.d.mts` and says “No hand-written reference pages,” while admitting that the `ctx` runtime contract has no declaration source and proposing a “hand-fenced reference section.” CLI verify/config contracts are likewise not shown to have declaration sources. Resolve by requiring machine-readable declaration/schema sources for every included runtime and CLI contract, or narrow the claimed scope and completeness until those sources exist.

5. [MATERIAL] 0195, “Summary” and Proposal item 4: “`docs.convex.dev` is in every model’s training set” and the claim that benchmark trends “will eventually show the moat eroding” are unsupported. CONTEXT.md establishes prior model familiarity, not its provenance, universal training inclusion, or a way to distinguish training effects from improvements to skills, templates, errors, and reference docs. Recast training exposure as an unverified hypothesis and ground the decision in public discoverability and retrieval, or define a separate pinned-model knowledge evaluation capable of testing that hypothesis.

6. [MATERIAL] 0196, “Summary”: neither the empirical ordering “scaffold beats guide beats package source” nor the “bare lane 41.5→29.6 min” measurement appears in CONTEXT.md, whose supplied measurements concern the Snapback-with-skill and Convex lanes. The attribution of the “largest single-release wall-clock improvement” specifically to template defaults is therefore unsupported. Supply auditable measurements and an attribution that separates the release’s changes, or remove the empirical ranking and justify the portfolio on other evidence.

7. [MATERIAL] 0196, T1/T2 and “Exit criteria”; 0197, publication-standard seam: T1 and T2 are explicitly designed to match committed benchmark briefs, and success is then measured by having “the next benchmark run on the CRUD brief” use T1. Publishing that result as general competitive authoring efficiency would reward Snapback for fitting a starter to the evaluation task. Use held-out briefs or variants for general claims; otherwise label this as a template-assisted product-bundle scenario and provide a symmetric competitor-starter policy.

8. [MATERIAL] 0196, T5: testing templates against the “published closure in CI” cannot serve as a pre-publication freshness gate for the candidate closure, because the registry still contains the preceding release; as a post-publication canary it detects drift only after publication. Thus it cannot ensure a template “can never teach a drifted surface” as written. Separate candidate-tarball validation before release from a post-publication registry canary, with explicit template/closure version pairing.

9. [MATERIAL] 0197, rules 2 and 6: requiring “the full harness public,” all run records, and “raw correction-loop lists” has no privacy, secret, licensing, or proprietary-prompt review. Raw records can contain credentials, local paths, personal data, or material that cannot lawfully be republished. Add a publication-safe artifact schema, automated secret/PII checks, human legal/security review, and transparent redaction records before public release.

10. [MATERIAL] 0197, rule 6: “the credibility of the 94-run honesty discipline” is unsupported and conflicts with the five-run factual record in CONTEXT.md and the RFC’s own opening. Replace 94 with the supported population or provide the missing public records and explain what the 94 runs count.

11. [MATERIAL] 0197, “Summary,” rules 2–3, and OQ1: “every claim reproducible by an outsider from public artifacts alone” is not achievable merely by saying an outsider with “the same model” can rerun it. The standard does not require an exact accessible model build, inference settings, tool versions, or environment specification, and OQ1 suggests the current model may be Fable, whose outsider availability is not established. Require a reproducibility manifest and a publicly accessible pinned model, or narrow the promise to independently rerunnable methodology rather than reproducible results.

12. [MATERIAL] 0197, rule 4: the required headline “equal-proof-bar variant” does not define what happens when a competitor cannot provide the required offline semantics. Medians and ratios become misleading if failures, timeouts, or proof failures are discarded or converted into arbitrary durations; the selected semantics may also encode a Snapback-specific capability rather than a neutral task outcome. Define vendor-neutral outcome requirements and a preregistered failure/timeout protocol, report capability failures separately, and calculate efficiency comparisons only across runs meeting the identical proof bar.

0193: NOT READY — blocking concerns: 1, 2, 3  
0194: NOT READY — blocking concerns: 4  
0195: NOT READY — blocking concerns: 5  
0196: NOT READY — blocking concerns: 6, 7, 8  
0197: NOT READY — blocking concerns: 7, 9, 10, 11, 12  
SET: NOT READY
tokens used
29,743
1. [MATERIAL] 0193, “Summary” and “Evidence”: the claim that “every remaining expensive detour traces to a code that didn’t” name its fix contradicts the document’s own statement that only “half of them [were] reachable from a refusal that could have carried the answer,” as well as CONTEXT.md’s attribution of residual friction to signature and contract questions. The related claim that error quality is the “best-performing agent-efficiency investment” is unsupported by the supplied measurements. Resolve by limiting the causal and comparative claims to the refusal-related incidents actually evidenced.

2. [MATERIAL] 0193, “Exit criteria”: the stated bar is that “every `SNAPBACK_*` refusal an authoring agent can trigger” supplies the rule and a fix or anchor, but exit requires only diary-cited codes to be A-grade and one benchmark run to encounter “zero C-grade refusals.” That permits unobserved agent-triggerable B/C codes—and encountered B codes—to remain, so the completeness program can exit without achieving its declared result. Require every ledger entry classified as agent-triggerable to be A-grade; treat benchmark observations as validation rather than proof of completeness.

3. [MATERIAL] 0193, “Phase 3” and OQ1: “typed `remediations` shape lands here if not already built” is followed by a proposal allowing “text+anchor” for audited legacy codes indefinitely. CONTEXT.md says LLP 0146 D7’s typed-remediation decision is already ratified, so this Plan cannot silently reopen it as an implementation choice. Either enforce the typed carrier as the end state, with a bounded migration if needed, or explicitly propose an amendment to LLP 0146.

4. [MATERIAL] 0194, “Design” and OQ2: the RFC promises a “complete, generated” reference whose source of truth is `.d.mts` and says “No hand-written reference pages,” while admitting that the `ctx` runtime contract has no declaration source and proposing a “hand-fenced reference section.” CLI verify/config contracts are likewise not shown to have declaration sources. Resolve by requiring machine-readable declaration/schema sources for every included runtime and CLI contract, or narrow the claimed scope and completeness until those sources exist.

5. [MATERIAL] 0195, “Summary” and Proposal item 4: “`docs.convex.dev` is in every model’s training set” and the claim that benchmark trends “will eventually show the moat eroding” are unsupported. CONTEXT.md establishes prior model familiarity, not its provenance, universal training inclusion, or a way to distinguish training effects from improvements to skills, templates, errors, and reference docs. Recast training exposure as an unverified hypothesis and ground the decision in public discoverability and retrieval, or define a separate pinned-model knowledge evaluation capable of testing that hypothesis.

6. [MATERIAL] 0196, “Summary”: neither the empirical ordering “scaffold beats guide beats package source” nor the “bare lane 41.5→29.6 min” measurement appears in CONTEXT.md, whose supplied measurements concern the Snapback-with-skill and Convex lanes. The attribution of the “largest single-release wall-clock improvement” specifically to template defaults is therefore unsupported. Supply auditable measurements and an attribution that separates the release’s changes, or remove the empirical ranking and justify the portfolio on other evidence.

7. [MATERIAL] 0196, T1/T2 and “Exit criteria”; 0197, publication-standard seam: T1 and T2 are explicitly designed to match committed benchmark briefs, and success is then measured by having “the next benchmark run on the CRUD brief” use T1. Publishing that result as general competitive authoring efficiency would reward Snapback for fitting a starter to the evaluation task. Use held-out briefs or variants for general claims; otherwise label this as a template-assisted product-bundle scenario and provide a symmetric competitor-starter policy.

8. [MATERIAL] 0196, T5: testing templates against the “published closure in CI” cannot serve as a pre-publication freshness gate for the candidate closure, because the registry still contains the preceding release; as a post-publication canary it detects drift only after publication. Thus it cannot ensure a template “can never teach a drifted surface” as written. Separate candidate-tarball validation before release from a post-publication registry canary, with explicit template/closure version pairing.

9. [MATERIAL] 0197, rules 2 and 6: requiring “the full harness public,” all run records, and “raw correction-loop lists” has no privacy, secret, licensing, or proprietary-prompt review. Raw records can contain credentials, local paths, personal data, or material that cannot lawfully be republished. Add a publication-safe artifact schema, automated secret/PII checks, human legal/security review, and transparent redaction records before public release.

10. [MATERIAL] 0197, rule 6: “the credibility of the 94-run honesty discipline” is unsupported and conflicts with the five-run factual record in CONTEXT.md and the RFC’s own opening. Replace 94 with the supported population or provide the missing public records and explain what the 94 runs count.

11. [MATERIAL] 0197, “Summary,” rules 2–3, and OQ1: “every claim reproducible by an outsider from public artifacts alone” is not achievable merely by saying an outsider with “the same model” can rerun it. The standard does not require an exact accessible model build, inference settings, tool versions, or environment specification, and OQ1 suggests the current model may be Fable, whose outsider availability is not established. Require a reproducibility manifest and a publicly accessible pinned model, or narrow the promise to independently rerunnable methodology rather than reproducible results.

12. [MATERIAL] 0197, rule 4: the required headline “equal-proof-bar variant” does not define what happens when a competitor cannot provide the required offline semantics. Medians and ratios become misleading if failures, timeouts, or proof failures are discarded or converted into arbitrary durations; the selected semantics may also encode a Snapback-specific capability rather than a neutral task outcome. Define vendor-neutral outcome requirements and a preregistered failure/timeout protocol, report capability failures separately, and calculate efficiency comparisons only across runs meeting the identical proof bar.

0193: NOT READY — blocking concerns: 1, 2, 3  
0194: NOT READY — blocking concerns: 4  
0195: NOT READY — blocking concerns: 5  
0196: NOT READY — blocking concerns: 6, 7, 8  
0197: NOT READY — blocking concerns: 7, 9, 10, 11, 12  
SET: NOT READY

## Round 2 — 2026-08-08 (gpt-5 family, delta round)

Provenance: codex exec, gpt-5.6-sol, xhigh, codex-cli 0.147.0, capsule
sr-capsule-r2 (hashes in run journal), targets at 601f867da. One launch.
Verbatim body follows.

Reading additional input from stdin...
OpenAI Codex v0.147.0
--------
workdir: /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR]
reasoning effort: xhigh
reasoning summaries: none
session id: 019fe20d-6dce-7ba3-b451-f5762dce30ff
--------
user
You are reviewing a five-document LLP set as one cluster in a DELTA
ROUND: the documents were revised once after a prior review round. LLP
0193 (errors-as-docs completeness, Plan), 0194 (generated API reference,
RFC), 0195 (public docs/examples/training surface, RFC), 0196 (template
and recipe portfolio, Plan), 0197 (benchmark publication standard, RFC).
CONTEXT.md carries factual background.

THE DELTA (revision r1 changed exactly these areas; everything else is
pre-existing text):
- 0193: Summary/Evidence exemplars re-cited to retained artifacts;
  Phase 1 population note; Phase 3 made carrier-agnostic pending an
  open carrier ruling (0146 OQ6) with text+anchor as bounded interim
  floor; exit criteria strengthened to the full agent-triggerable bar;
  OQ1 reworded to the migration bound.
- 0194: "What this kills" re-cited to retained records, fraction claim
  removed; reference excluded from the flat projection (OQ1); scope
  rule limiting completeness to declaration-sourced surfaces with named
  exclusions (ctx, CLI contracts) until declaration files land.
- 0195: Summary quantitative claim replaced with the diaries' actual
  language; training-data framing recast as instrumented hypothesis
  (Proposal 4 + new OQ4); audit count corrected to four
  published-consumer.
- 0196: Summary superlative corrected and scoped; T1 wording
  ("exercising the same capability surface"); T5 split into
  pre-release staged-tarball gate + post-release registry canary; exit
  criterion adds template-assisted labeling + held-out-brief rule.
- 0197: Summary series carries the directional-not-controlled caveat;
  governing principle reworded to rerunnable-methodology + a
  reproducibility manifest; new rules 4a (starter symmetry) and 4b
  (equal-proof-bar failure protocol); rule 6 rewritten with the
  publication-safe artifact schema; "94-run" corrected to five-run/
  four-audit.

Review the full documents for MATERIAL concerns (correctness, coherence,
feasibility, safety, decision-quality; altitude rule: detail-only
demands that identify no defective decision are implementation-phase
notes, not material). CLASSIFY every concern as IN-DELTA (introduced or
unresolved by the r1 changes) or PRE-EXISTING (present before r1).

FORMAT: 1) numbered concerns, each labeled [MATERIAL]/[minor] and
[IN-DELTA]/[PRE-EXISTING], naming document + section, quoting disputed
text, stating the resolving change for MATERIAL; 2) per-target verdict
lines "0193: READY"/"0193: NOT READY — blocking: <numbers>" for all
five; 3) one "SET: READY"/"SET: NOT READY" line. You are the only
reviewer; do not reference other reviews. Do not rewrite the documents.

The capsule files are in the current directory: CONTEXT.md plus the five LLP documents. Read them all in full and produce the review in exactly the instructed format.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
2026-08-08T15:45:59.342181Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server linear: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
codex
I’m using the LLP review guidance to evaluate the five revised documents as a single delta-round cluster. I’ll read the skill instructions, CONTEXT.md, and every LLP in full, then report only decision-relevant defects with explicit delta classification.
exec
/bin/zsh -lc "sed -n '1,240p' /Users/ccheever/.codex/skills/llp/SKILL.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2
 succeeded in 0ms:
---
name: llp
description: Create, review, and list Exact LLP documents in the Exact repository. Use when Codex is asked to work with `/llp`, `$llp`, LLP proposals, LLP reviews, LLP numbering, or files under `llp/`.
---

# llp

Use this skill for Exact's LLP document workflow. Prefer LLP terminology:
"LLP document" for the general case, "RFC" only when the document type is
actually RFC, and `# LLP NNNN: Title` for new numbered documents.

## Ground Rules

- Work from the repository root when possible.
- Search `llp/` when numbering or locating LLP documents.
- Keep documents in `llp/`.
- Numbered filenames are `NNNN-slug.type.md`, for example
  `0042-video-component.rfc.md`.
- New proposal documents default to `Type: RFC`.
- Required metadata for new documents: `Type`, `Status`, `Systems`, `Author`,
  `Date`, `Revised`, and `Related`.
- Valid proposal statuses for `RFC`, `Spec`, and `Plan`: `Draft`, `Review`,
  `Accepted`, `Implemented`, `Superseded`, `Shelved`, and `Withdrawn`.
- Normalize statuses when matching by stripping ` vN`, stripping trailing
  parenthetical notes, and comparing case-insensitively.
- Do not accept or reject LLP documents on the user's behalf.
- Do not renumber existing unnumbered documents unless the user is actively
  updating one.

## Create

For `/llp create <title> [--type <type>]`:

1. Scan existing numbered LLP files in `llp/`.
2. Pick the next number.
3. Build the slug: lowercase, replace non-alphanumerics with `-`, collapse
   repeated `-`, and trim edge `-`.
4. Create `llp/NNNN-slug.type.md` with this scaffold, using the requested type
   or defaulting to `RFC` and `.rfc.md`:

```markdown
# LLP NNNN: <Title>

**Type:** RFC
**Status:** Draft
**Systems:** TBD
**Author:** Charlie Cheever / Codex
**Date:** YYYY-MM-DD
**Revised:** YYYY-MM-DD
**Related:**

## Summary

## Design
```

5. Help draft the document from the current conversation context.

## Review

For `/llp review <identifier>`:

- The identifier may be a number like `0036`, a slug like
  `intent-level-authoring`, or omitted. If omitted, list Draft/Review
  documents and ask which one.
- Locate the document in `llp/` and read the full file.
- Review it using this prompt:

```text
What do you think of this proposal? Is it a good idea? Do we have a good plan here? How would you change it to make it better? What would you add or take away or change? Is anything definitely or possibly wrongheaded here? Do you have any novel ideas that you think might make this way better even if they are a bit non-standard? What are the key open questions we need to answer to refine this?
```

- Present findings first: overall assessment, strengths, concerns,
  suggestions, and open questions.
- Save the review artifact under
  `notes-archive/ai-reviews/{slug}.round-{N}.AGENTS.md`.
- Derive `{slug}` by stripping the leading `NNNN-` and trailing `.type.md`.
- Increment `{N}` based on existing `*.AGENTS.md` review files.
- If the document is still `Draft`, suggest updating it to `Review` after the
  review.
- Remind the user that the LLP process also recommends a GPT review unless
  this Codex review is the GPT review they wanted.

## List

For `/llp list [status]`:

1. Scan `llp/`.
2. Extract and normalize `**Status:**`.
3. Group documents by normalized status.
4. Sort numbered documents ascending, then unnumbered documents alphabetically.
5. If a status filter was provided, show only that group.

Render numbered documents as:

```text
0038  exact-inspect-skill
0039  rfc-skill
----  unnumbered-rfc
```

exec
/bin/zsh -lc "pwd && rg --files -g 'CONTEXT.md' -g '*0193*' -g '*0194*' -g '*0195*' -g '*0196*' -g '*0197*' | sort && wc -l CONTEXT.md *0193* *0194* *0195* *0196* *0197*" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2
 succeeded in 0ms:
/private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2
0193-errors-as-docs-completeness.plan.md
0194-generated-api-reference.rfc.md
0195-public-documentation-and-training-surface.rfc.md
0196-template-and-recipe-portfolio.plan.md
0197-benchmark-publication-standard.rfc.md
CONTEXT.md
      32 CONTEXT.md
     101 0193-errors-as-docs-completeness.plan.md
      86 0194-generated-api-reference.rfc.md
      91 0195-public-documentation-and-training-surface.rfc.md
      78 0196-template-and-recipe-portfolio.plan.md
      80 0197-benchmark-publication-standard.rfc.md
     468 total

exec
/bin/zsh -lc "for f in CONTEXT.md 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md; do printf '\\n===== %s =====\\n' \""'$f"; sed -n '"'1,240p' \""'$f"; done' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2
 succeeded in 0ms:

===== CONTEXT.md =====
# Context sheet (facts only; for reviewing the five-document set)

Snapback is a local-first backend framework: declarative schema/functions
with codegen, live queries, ephemeral state, typed assets, sessions auth,
React/Expo/headless clients, a Rust runtime shipped as prebuilt npm
binaries. Its docs are an in-repo "guide" (CI-verified snippets,
capability index with explicit GAP rows, version fences against the
published npm closure) served by running servers at /_snapback/guide and
an embedded `snapback guide` search; there is currently no public web
documentation. Packages @expo/snapback-* are on npm at 0.1.15 (eleven
packages incl. create-snapback-app). An agent skill (snapback-authoring)
ships inside scaffolded apps. A committed benchmark harness exists under
benchmarks/ (briefs, lane prompt templates, run-record schema, fairness
rules) from LLP 0186 W1.

Measurement facts cited by the documents (five serial cold-agent runs,
same brief/machine/model, token-metered): wall/tokens for the
Snapback-with-skill lane vs a Convex lane moved 26m22s/329k vs
16m36s/113k (npm 0.1.13) to 19m00s/201k vs 10m18s/90k (npm 0.1.15);
observed per-lane run-to-run variance ±30% at N=1; latest run had zero
framework-caused defects in any Snapback lane; remaining friction was
knowledge-shaped (signature/contract questions resolved by reading
package source; one case by extracting strings from the runtime binary).
Convex lanes across all runs consumed no documentation (prior model
familiarity). Diaries 0058, 0065, 0066, 0068, 0069 record the runs.
Existing related LLPs: 0186 (agent authoring efficiency program: W0
plumbing fixes shipped; W1 benchmark harness; W2 skill/scaffolds; W3
errors bar; W4 edit-loop taxes), 0146 (agent affordances; D7 = typed
remediations carried by refusals, ratified, enforcement carrier not yet
built), 0061 (guide design, intent-indexed), 0041 (packaging/releases).
A diagnostic-inventory drift gate exists in CI (production diagnostic
codes are classified; new unclassified codes fail).

===== 0193-errors-as-docs-completeness.plan.md =====
# LLP 0193: Errors-as-docs completeness program

**Type:** Plan
**Status:** Review
**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
diaries 0065-0069

## Summary

Across the retained measurement series, refusal-quality incidents
resolved fastest when the refusal named its own fix — diary 0048's
`SNAPBACK_ASSET_IMAGE_DECODE_FAILED` carrying the exact upstream parser
error, and the anonymous-upload refusal naming `snapback assets put
--user` (diary 0065's tickets) are retained exemplars — while several of
the expensive detours trace to refusals that carried neither rule nor
fix. (Additional unretained lane-report incidents exist but are not
cited as evidence here.) LLP 0186 W3 states the
bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
the violated rule and either the fix or a resolving guide anchor** — but
the bar has only ever been applied to codes that happened to appear in
diaries. This Plan audits the entire population once and then makes the
bar structural, so it can never regress.

## Evidence

- Diary 0069: zero framework defects, yet the run's expensive moments
  were knowledge-shaped — several reachable from a refusal that could
  have carried the answer.
- The retained record shows the mechanism in both directions: refusals
  that named remediations (`snapback assets put --user`, diary 0048's
  decode diagnostic, the seed-recovery messages) cost near-zero;
  refusals that did not (the 0.1.10-era `host-ops response was not
  JSON`, the hashed field path) each cost a bisection session.
- The infrastructure half-exists: stable code registry, the
  production diagnostic-inventory drift gate, and 0146 D7 ratified as
  the remediation carrier.

## Program

**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
code inventory (a raw identifier sweep finds ~2,700 `SNAPBACK_*` symbols
including env vars and test constants; the diagnostic subset is the
real population and Phase 1 establishes its size) from the diagnostic registry
plus a grep sweep for unregistered emissions. Fan out grading lanes:
each code graded A (names rule + fix/anchor), B (names rule only), or
C (bare), with the emitting site and agent-triggerability recorded.
Output: a checked-in graded ledger under `tests/acceptance/diagnostics/`.

**Phase 2 — fix in evidence order.** First: every B/C code that appears
in any diary's correction-loop list. Then B/C codes on
agent-triggerable paths, batched by subsystem. Message edits follow the
house style; guide anchors must resolve (check-guide enforces). Codes
that are genuinely internal (never agent-triggerable) are marked so in
the ledger rather than polished.

**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
a new agent-triggerable code cannot land without a remediation in the
carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
floor. The typed-remediation end state is 0146's ratified D7 and is not
reopened here; the carrier choice is OQ6's open ruling
(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
named dependency of this phase's structured half — until it rules, the
gate enforces text+anchor as a bounded interim floor, upgraded
code-by-code as the carrier lands. Anchor
resolution joins CI. The graded ledger becomes the gate's baseline;
grade regressions fail.

**Phase 4 — close the loop with measurement.** The next benchmark run's
lane reports grade every refusal encountered; new B/C sightings are the
recurring audit input.

## Exit criteria

1. Graded ledger covers 100% of registered codes; zero ungraded
   emissions in the sweep.
2. **Every ledger entry classified agent-triggerable is grade A** (the
   program's declared bar; diary-cited codes are merely the first
   batch).
3. The drift gate refuses a new agent-triggerable code without
   remediation/anchor (negative test), and refuses grade regressions.
4. A benchmark run encounters zero B- or C-grade refusals — as
   validation of criterion 2, not a substitute for it.

## Open questions

- OQ1: The migration bound — how long audited legacy codes may remain
  on the text+anchor floor after the OQ6 carrier ruling lands. Proposal:
  structured on next touch, with a dated full-migration milestone set
  when the carrier ships (the typed end state itself is settled by
  0146's ratified D7, not by this Plan).
- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
  from any published-surface operation, decided by the grading lane,
  spot-checked in review.

===== 0194-generated-api-reference.rfc.md =====
# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Review
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0061 (guide design — intent-indexed by choice), LLP 0186
(measurement evidence), diaries 0068-0069

## Summary

Across five measurement runs, every remaining package-source excursion
shares one shape: a **signature or contract question** — headless
`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
(extracted from runtime binary strings in run 5), the verify-config
contract, client constructor option pairs. The guide is deliberately
intent-indexed (LLP 0061) and should stay that way; what is missing is
the complementary layer: a **complete, generated, build-bound API
reference** derived from the packages' own `.d.mts` declarations — the
types agents consistently praise — so that no signature question ever
requires opening `node_modules`.

## Design

1. **Source of truth:** the published packages' `.d.mts` files plus doc
   comments. No hand-written reference pages — generation only, so it
   cannot drift (the closure-drift lesson, LLP 0186 W0).
2. **Generation:** a build step (TypeScript compiler API, the
   export-parity test's traversal as the seed) emitting one markdown
   page per package under `guide/reference/<package>.md`, with stable
   per-symbol anchors. Runs in the same pipeline as
   `generate-guide-manifest`; output is committed generated artifact,
   checked like the flat guide.
3. **Serving:** joins the guide manifest — served at
   `/_snapback/guide/reference/...`, indexed by
   `snapback guide <query>` and the MCP resources, listed in
   `/llms.txt`. Build-bound headers like every guide response.
4. **Joins:** intent pages link into reference anchors ("full signature:
   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
   may cite reference anchors as their fix pointer.
5. **Scope and completeness rule:** the reference includes exactly the
   surfaces that have machine-readable declaration sources, and its
   completeness claim is scoped to that set. Order:
   `@expo/snapback-client` (headless surface — the largest excursion
   source), `snapback-react` hooks and fact types, `snapback-expo`.
   The `ctx` handler surface and the CLI verify/config contracts have
   no declaration source today; they JOIN the reference when their
   declaration files land (OQ2 proposes shipping one for `ctx`, which
   also gives consumers editor types) — until then they are named
   exclusions, not hand-written pages, so the no-hand-written rule and
   the completeness claim stay true together.

## What this kills

Retained-record attributions: headless args nesting (diary 0069 residue
3), `ctx.db` verbs via binary strings (0069 residue 2), verify-config
contract (0068 and 0069 residue 5), `createAssetClient` root-export
discovery (diary 0068), the sessions client-construction option pair
(0068 residue 4, hit by two lanes). Diary 0069 calls orientation "the
dominant term" in the remaining gap; the signature-shaped items above
are the subset of its residue list this RFC removes. (No quantitative
fraction is claimed; the diaries do not decompose the bucket.)

## Open questions

- OQ1: Page granularity, size budgets, and the flat-projection
  interaction — the flat guide is already past its one-request size
  premise (`issues/20260806-guide-flat-projection-oversize.md`); the
  reference is therefore EXCLUDED from `flat.md` unless that ticket's
  diet/tier design lands first, and per-module splitting rules are
  needed regardless.
- OQ2: The `ctx` handler surface (db verbs, assets, refuse) is a runtime
  contract, not a package `.d.mts` — it needs either a published
  declaration file (preferable: consumers get editor types too) or a
  hand-fenced reference section until one exists.
- OQ3: Whether doc comments in `.d.mts` are complete enough to render
  useful prose, and whether improving them (which rotates artifact
  identity — the doc-comment lesson) batches with releases.
- OQ4: Versioning — the reference is inherently build-bound (served),
  which is correct; whether the public docs surface (LLP 0195) pins
  per-release snapshots is that RFC's question.

===== 0195-public-documentation-and-training-surface.rfc.md =====
# LLP 0195: Public documentation, examples, and training-data surface

**Type:** RFC
**Status:** Review
**Systems:** Documentation, Publishing, Guide, Templates, Competitive
evaluation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (the orientation-gap evidence), LLP 0061 (guide),
LLP 0041 (packaging), diaries 0065-0069

## Summary

Snapback currently has **no public documentation surface**. The guide
exists only in this repository and served from installed binaries: an
agent cannot read a word of it before installing, search engines and
training pipelines never see it, and `llms.txt` exists only on loopback
origins. Meanwhile the measurement series calls orientation cost "the dominant
term" in the remaining efficiency gap (diary 0069) — cost the Convex
lanes did not pay: across all five runs they consumed no documentation
at all, working from prior model familiarity. A public surface is the pre-install orientation fix and the
discoverability fix on its face; that it also feeds future model
training is a plausible but **unverified hypothesis** — prior
familiarity is measured, its provenance is not. The decision case rests
on discoverability and retrieval; the training effect, if real, is
upside this RFC proposes to instrument rather than assume (OQ4). It
remains the largest unstarted item this program has identified. It is proposed here rather than executed because publishing
is the author's decision.

## Proposal

1. **Public docs site, generated from `guide/`.** The corpus is already
   CI-verified, version-fenced (`published-closure.json` + `since:`
   machinery), and honest by construction (GAP rows). A static site
   generator over `guide/` — same markdown, same snippets, the 0194
   reference included — published on a real domain, with `/llms.txt` at
   the root and per-release snapshots pinned to published closures (the
   fence machinery already knows what each closure contains). The
   in-repo/served guide remains canonical; the site is a projection with
   the same content hashes.
2. **Public examples repository**, mirroring the template outputs and
   selected demo apps (the benchmark lanes' apps are strong candidates:
   complete, proof-carrying, honestly scoped). Each example pinned to a
   closure version and CI-cold-installed against the registry — the
   examples repo doubles as an external consumer canary.
3. **Skill distribution beyond scaffolds:** publish
   `snapback-authoring` wherever agent harnesses discover skills, so
   pre-scaffold orientation exists off-checkout.
4. **Deliberate training-data posture (hypothesis, instrumented):**
   write the site, examples, README funnels, and packages with a
   future-model audience in mind (stable vocabulary, Rosetta aliases,
   canonical snippets). Whether the moat actually erodes is testable
   but confounded — skills, templates, and error improvements also cut
   orientation cost — so the posture claims no timeline; OQ4 sketches
   the pinned-model knowledge evaluation that could isolate the
   training effect if it becomes worth measuring.

## What this does not claim

No hosted-service claims change; the site documents the local-first
surface the capability index already asserts, GAP rows included. The
honesty discipline that survived four published-consumer audits
(diaries 0065-0069; the 0058 run was in-checkout) is the asset being
published, not marketing copy.

## Author decisions required

- D1: Publish at all, and where (domain; whether the repo itself goes
  public or only generated projections).
- D2: Examples licensing and repo location.
- D3: Snapshot policy (per-release docs versions vs latest-only).
- D4: Whether benchmark artifacts (briefs, records) belong on the public
  site — interacts with LLP 0197's publication standard.

## Open questions

- OQ1: Site generator and hosting (the repo has EAS/Cloudflare lanes;
  either works — pick for boring reliability).
- OQ2: How the site's `llms.txt` and sitemap best serve crawler and
  agent retrieval (the served-guide retrieval-eval corpus can be reused
  as the site's acceptance test).
- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
  public anchors, unifying citations across surfaces.
- OQ4: The pinned-model knowledge evaluation — a fixed question set
  about Snapback answered by pinned model builds over time, isolating
  training-data presence from in-context aids; only worth building if
  the training hypothesis starts driving decisions.

===== 0196-template-and-recipe-portfolio.plan.md =====
# LLP 0196: Template and recipe portfolio

**Type:** Plan
**Status:** Review
**Systems:** Templates, CLI, Guide, Testing, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W2), LLP 0195 (public examples mirror), diaries
0068-0069, benchmarks/briefs/

## Summary

The five-run series established the knowledge ladder empirically:
**scaffold beats guide beats package source** — knowledge moved into
template defaults (0.1.15's sessions mode, offline registration, upload
wiring) produced the largest single-release wall-clock improvement of
the program (bare lane 41.5→29.6 min). This Plan extends the portfolio
along the measured demand: two new templates matching the committed
benchmark briefs, proof machinery registered by default, and the recipe
list the diaries priced.

## Program

**T1 — CRUD-dashboard template** (`--template crud-dashboard`), matching
`benchmarks/briefs/crud.md`: tables/list/detail/edit shapes, relational
query profile in the default path, sessions default, acceptance suite +
**registered verify profile** included. Most agent tasks are CRUD-shaped;
this becomes the default recommendation for generic briefs.

**T2 — media-feed template** (`--template media-feed`), matching
`briefs/media.md`: typed upload intents with renditions in the main
path, delivery-profile selection demonstrated (the strict-vs-public
lesson), infinite-scroll list over retained queries.

**T3 — proof-by-default across all templates:** every template ships a
registered `snapback.verify.config.mjs` (run-5's skill lane registered
profiles by hand; the done-oracle should be non-vacuous from scaffold),
and the expo templates ship web platform + deps (the two-run web-deps
papercut, ticketed 2026-08-08 — absorbed here).

**T4 — recipes** (guide sections with CI-verified snippets, in priority
order from run evidence): the headless-simulator proof kit (plistlib
scheme approval, Expo Go onboarding dismissal, drive-channel pattern —
ticketed), real-auth sign-in flows beyond test personas, the offline
supervisor-origin recipe (ticketed), verify-config authoring (ticketed).
Recipes graduate into template code where a template naturally exercises
them — the ladder says code placement beats prose.

**T5 — template freshness gate:** templates cold-install and pass their
suites against the *published* closure in CI (the staging lane covers
tarball shape; this covers registry reality), so a template can never
teach a drifted surface.

## Sequencing

T3 first (papercut absorption + verify-by-default — small), then T1
(benchmark brief pairing makes it immediately measurable), T2, with T4
recipes landing alongside whichever surface they document. T5 joins the
release checklist when T1 lands.

## Exit criteria

- A cold agent given a CRUD or media brief scaffolds the matching
  template and reaches all proofs with zero template-gap loops.
- `snapback verify` is non-vacuous on every fresh scaffold.
- The next benchmark run on the CRUD brief uses T1 and its lane report
  cites no template gaps.

## Open questions

- OQ1: Template count discipline — the portfolio should stay small
  (three app templates + recipes); additions require a measured brief.
- OQ2: Whether `create-snapback-app` grows an interactive template
  picker or stays flag-driven (agents prefer flags; humans may not).

===== 0197-benchmark-publication-standard.rfc.md =====
# LLP 0197: Competitive benchmark publication standard

**Type:** RFC
**Status:** Review
**Systems:** Competitive evaluation, Publishing, Documentation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
(harness, records), LLP 0195 (public surface), diaries 0058-0069

## Summary

The measurement program can now produce numbers worth publishing —
five runs, a committed harness, token metering, and a series showing
the skill lane moving from 3.26x to ~2x tokens against Convex. LLP 0186
OQ5 asked what disclosure makes a public comparison credible rather
than vendor noise; this RFC proposes the standard. The governing
principle: **publish the instrument, not just the number** — every
claim reproducible by an outsider from public artifacts alone.

## The standard

A published Snapback benchmark claim requires:

1. **N≥3 runs per configuration** with all runs reported (no
   best-of): median + range. The observed ±30% per-lane variance
   (diary 0069) makes single-run ratios unpublishable. The variance
   study is therefore the prerequisite work item.
2. **The full harness public:** briefs verbatim, lane prompts, fairness
   rules, and run records (the `benchmarks/` tree, published via LLP
   0195) — an outsider with the same model can rerun the measurement.
3. **Fairness notes attached to every chart:** cold-context agents;
   published surfaces only; same model, machine, and serial discipline;
   competitor lanes free to use web docs; model prior-familiarity
   asymmetry stated plainly (it currently favors competitors).
4. **Proof-bar disclosure:** every chart states what each lane proved.
   The headline chart should be the **equal-proof-bar variant**
   (`briefs/messaging-equal-proof-bar.md`): both lanes required to
   prove identical offline semantics — the honest comparison where
   depth is priced instead of penalized. The unequal-bar table may be
   published alongside with the asymmetry stated (Convex lanes'
   own-words caveats — "not a real sync story" — quoted, not
   paraphrased).
5. **Version pinning:** every run names the exact closure and
   competitor versions; claims age out when either moves materially.
6. **Self-report symmetry:** lane reports (the diaries' raw
   correction-loop lists, both vendors') are part of the public record
   — including the runs and loop lists unfavorable to Snapback. The
   credibility of the 94-run honesty discipline is the asset.

## What publishing looks like

A benchmarks page on the LLP 0195 site: the series chart (with the
early losing runs included — the 26m-vs-11m origin is part of the
story), the current N≥3 medians, links to briefs/records/prompts, and a
"run it yourself" section. No superlatives that a record link cannot
back.

## Author decisions required

- D1: Whether to publish at all and when (proposal: after the N≥3
  study and the equal-proof-bar run, not before).
- D2: Which competitors appear (Convex is measured; Supabase/
  PocketBase/Postgres lanes are unbuilt — publishing claims about
  unmeasured competitors is out under this standard).
- D3: Whether competitor names appear in charts or as "backend A/B"
  (proposal: names, with rule 2's reproducibility as the defense).

## Open questions

- OQ1: Token-count comparability across models if the harness ever runs
  on non-Fable models (current standard: one model per published
  series, stated).
- OQ2: Whether an independent third party rerunning the harness is
  worth soliciting before first publication (strongest possible
  credibility; costs a relationship and time).

codex
I’ve completed the first full read. The capsule reveals a consequential consistency issue: several r1 changes listed in the delta are not present in the corresponding files, so I’m checking the repository state and cross-document contracts before assigning blocking numbers and verdicts.
exec
/bin/zsh -lc "git status --short && git log --oneline --decorate -8 --all -- 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md && rg -n \"carrier|text\\+anchor|declaration|excluded|training|hypothesis|published-consumer|exercising|staged|tarball|registry canary|template-assisted|held-out|directional|controlled|starter|symmetry|failure protocol|artifact schema|94-run|five-run|four-audit\" CONTEXT.md 0193* 0194* 0195* 0196* 0197*" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2
 exited 128 in 0ms:
fatal: not a git repository (or any of the parent directories): .git

exec
/bin/zsh -lc "rg -n \"carrier|text\\+anchor|declaration|excluded|training|hypothesis|published-consumer|exercising|staged|tarball|registry canary|template-assisted|held-out|directional|controlled|starter|symmetry|failure protocol|artifact schema|94-run|five-run|four-audit\" CONTEXT.md 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2
 succeeded in 0ms:
0196-template-and-recipe-portfolio.plan.md:17:The five-run series established the knowledge ladder empirically:
0196-template-and-recipe-portfolio.plan.md:55:tarball shape; this covers registry reality), so a template can never
CONTEXT.md:29:remediations carried by refusals, ratified, enforcement carrier not yet
0193-errors-as-docs-completeness.plan.md:44:  the remediation carrier.
0193-errors-as-docs-completeness.plan.md:66:carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
0193-errors-as-docs-completeness.plan.md:68:reopened here; the carrier choice is OQ6's open ruling
0193-errors-as-docs-completeness.plan.md:69:(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
0193-errors-as-docs-completeness.plan.md:71:gate enforces text+anchor as a bounded interim floor, upgraded
0193-errors-as-docs-completeness.plan.md:72:code-by-code as the carrier lands. Anchor
0193-errors-as-docs-completeness.plan.md:95:  on the text+anchor floor after the OQ6 carrier ruling lands. Proposal:
0193-errors-as-docs-completeness.plan.md:97:  when the carrier ships (the typed end state itself is settled by
0194-generated-api-reference.rfc.md:24:reference** derived from the packages' own `.d.mts` declarations — the
0194-generated-api-reference.rfc.md:47:   surfaces that have machine-readable declaration sources, and its
0194-generated-api-reference.rfc.md:52:   no declaration source today; they JOIN the reference when their
0194-generated-api-reference.rfc.md:53:   declaration files land (OQ2 proposes shipping one for `ctx`, which
0194-generated-api-reference.rfc.md:79:  declaration file (preferable: consumers get editor types too) or a
0197-benchmark-publication-standard.rfc.md:39:   asymmetry stated plainly (it currently favors competitors).
0197-benchmark-publication-standard.rfc.md:45:   published alongside with the asymmetry stated (Convex lanes'
0197-benchmark-publication-standard.rfc.md:50:6. **Self-report symmetry:** lane reports (the diaries' raw
0197-benchmark-publication-standard.rfc.md:53:   credibility of the 94-run honesty discipline is the asset.
0195-public-documentation-and-training-surface.rfc.md:1:# LLP 0195: Public documentation, examples, and training-data surface
0195-public-documentation-and-training-surface.rfc.md:21:training pipelines never see it, and `llms.txt` exists only on loopback
0195-public-documentation-and-training-surface.rfc.md:27:training is a plausible but **unverified hypothesis** — prior
0195-public-documentation-and-training-surface.rfc.md:29:on discoverability and retrieval; the training effect, if real, is
0195-public-documentation-and-training-surface.rfc.md:53:4. **Deliberate training-data posture (hypothesis, instrumented):**
0195-public-documentation-and-training-surface.rfc.md:60:   training effect if it becomes worth measuring.
0195-public-documentation-and-training-surface.rfc.md:66:honesty discipline that survived four published-consumer audits
0195-public-documentation-and-training-surface.rfc.md:90:  training-data presence from in-context aids; only worth building if
0195-public-documentation-and-training-surface.rfc.md:91:  the training hypothesis starts driving decisions.

exec
/bin/zsh -lc "nl -ba 0193-errors-as-docs-completeness.plan.md | sed -n '45,105p'; nl -ba 0194-generated-api-reference.rfc.md | sed -n '15,90p'; nl -ba 0195-public-documentation-and-training-surface.rfc.md | sed -n '15,95p'; nl -ba 0196-template-and-recipe-portfolio.plan.md | sed -n '15,85p'; nl -ba 0197-benchmark-publication-standard.rfc.md | sed -n '15,90p'" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2
 succeeded in 0ms:
    45	
    46	## Program
    47	
    48	**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
    49	code inventory (a raw identifier sweep finds ~2,700 `SNAPBACK_*` symbols
    50	including env vars and test constants; the diagnostic subset is the
    51	real population and Phase 1 establishes its size) from the diagnostic registry
    52	plus a grep sweep for unregistered emissions. Fan out grading lanes:
    53	each code graded A (names rule + fix/anchor), B (names rule only), or
    54	C (bare), with the emitting site and agent-triggerability recorded.
    55	Output: a checked-in graded ledger under `tests/acceptance/diagnostics/`.
    56	
    57	**Phase 2 — fix in evidence order.** First: every B/C code that appears
    58	in any diary's correction-loop list. Then B/C codes on
    59	agent-triggerable paths, batched by subsystem. Message edits follow the
    60	house style; guide anchors must resolve (check-guide enforces). Codes
    61	that are genuinely internal (never agent-triggerable) are marked so in
    62	the ledger rather than polished.
    63	
    64	**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
    65	a new agent-triggerable code cannot land without a remediation in the
    66	carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
    67	floor. The typed-remediation end state is 0146's ratified D7 and is not
    68	reopened here; the carrier choice is OQ6's open ruling
    69	(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
    70	named dependency of this phase's structured half — until it rules, the
    71	gate enforces text+anchor as a bounded interim floor, upgraded
    72	code-by-code as the carrier lands. Anchor
    73	resolution joins CI. The graded ledger becomes the gate's baseline;
    74	grade regressions fail.
    75	
    76	**Phase 4 — close the loop with measurement.** The next benchmark run's
    77	lane reports grade every refusal encountered; new B/C sightings are the
    78	recurring audit input.
    79	
    80	## Exit criteria
    81	
    82	1. Graded ledger covers 100% of registered codes; zero ungraded
    83	   emissions in the sweep.
    84	2. **Every ledger entry classified agent-triggerable is grade A** (the
    85	   program's declared bar; diary-cited codes are merely the first
    86	   batch).
    87	3. The drift gate refuses a new agent-triggerable code without
    88	   remediation/anchor (negative test), and refuses grade regressions.
    89	4. A benchmark run encounters zero B- or C-grade refusals — as
    90	   validation of criterion 2, not a substitute for it.
    91	
    92	## Open questions
    93	
    94	- OQ1: The migration bound — how long audited legacy codes may remain
    95	  on the text+anchor floor after the OQ6 carrier ruling lands. Proposal:
    96	  structured on next touch, with a dated full-migration milestone set
    97	  when the carrier ships (the typed end state itself is settled by
    98	  0146's ratified D7, not by this Plan).
    99	- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
   100	  from any published-surface operation, decided by the grading lane,
   101	  spot-checked in review.
    15	## Summary
    16	
    17	Across five measurement runs, every remaining package-source excursion
    18	shares one shape: a **signature or contract question** — headless
    19	`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
    20	(extracted from runtime binary strings in run 5), the verify-config
    21	contract, client constructor option pairs. The guide is deliberately
    22	intent-indexed (LLP 0061) and should stay that way; what is missing is
    23	the complementary layer: a **complete, generated, build-bound API
    24	reference** derived from the packages' own `.d.mts` declarations — the
    25	types agents consistently praise — so that no signature question ever
    26	requires opening `node_modules`.
    27	
    28	## Design
    29	
    30	1. **Source of truth:** the published packages' `.d.mts` files plus doc
    31	   comments. No hand-written reference pages — generation only, so it
    32	   cannot drift (the closure-drift lesson, LLP 0186 W0).
    33	2. **Generation:** a build step (TypeScript compiler API, the
    34	   export-parity test's traversal as the seed) emitting one markdown
    35	   page per package under `guide/reference/<package>.md`, with stable
    36	   per-symbol anchors. Runs in the same pipeline as
    37	   `generate-guide-manifest`; output is committed generated artifact,
    38	   checked like the flat guide.
    39	3. **Serving:** joins the guide manifest — served at
    40	   `/_snapback/guide/reference/...`, indexed by
    41	   `snapback guide <query>` and the MCP resources, listed in
    42	   `/llms.txt`. Build-bound headers like every guide response.
    43	4. **Joins:** intent pages link into reference anchors ("full signature:
    44	   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
    45	   may cite reference anchors as their fix pointer.
    46	5. **Scope and completeness rule:** the reference includes exactly the
    47	   surfaces that have machine-readable declaration sources, and its
    48	   completeness claim is scoped to that set. Order:
    49	   `@expo/snapback-client` (headless surface — the largest excursion
    50	   source), `snapback-react` hooks and fact types, `snapback-expo`.
    51	   The `ctx` handler surface and the CLI verify/config contracts have
    52	   no declaration source today; they JOIN the reference when their
    53	   declaration files land (OQ2 proposes shipping one for `ctx`, which
    54	   also gives consumers editor types) — until then they are named
    55	   exclusions, not hand-written pages, so the no-hand-written rule and
    56	   the completeness claim stay true together.
    57	
    58	## What this kills
    59	
    60	Retained-record attributions: headless args nesting (diary 0069 residue
    61	3), `ctx.db` verbs via binary strings (0069 residue 2), verify-config
    62	contract (0068 and 0069 residue 5), `createAssetClient` root-export
    63	discovery (diary 0068), the sessions client-construction option pair
    64	(0068 residue 4, hit by two lanes). Diary 0069 calls orientation "the
    65	dominant term" in the remaining gap; the signature-shaped items above
    66	are the subset of its residue list this RFC removes. (No quantitative
    67	fraction is claimed; the diaries do not decompose the bucket.)
    68	
    69	## Open questions
    70	
    71	- OQ1: Page granularity, size budgets, and the flat-projection
    72	  interaction — the flat guide is already past its one-request size
    73	  premise (`issues/20260806-guide-flat-projection-oversize.md`); the
    74	  reference is therefore EXCLUDED from `flat.md` unless that ticket's
    75	  diet/tier design lands first, and per-module splitting rules are
    76	  needed regardless.
    77	- OQ2: The `ctx` handler surface (db verbs, assets, refuse) is a runtime
    78	  contract, not a package `.d.mts` — it needs either a published
    79	  declaration file (preferable: consumers get editor types too) or a
    80	  hand-fenced reference section until one exists.
    81	- OQ3: Whether doc comments in `.d.mts` are complete enough to render
    82	  useful prose, and whether improving them (which rotates artifact
    83	  identity — the doc-comment lesson) batches with releases.
    84	- OQ4: Versioning — the reference is inherently build-bound (served),
    85	  which is correct; whether the public docs surface (LLP 0195) pins
    86	  per-release snapshots is that RFC's question.
    15	
    16	## Summary
    17	
    18	Snapback currently has **no public documentation surface**. The guide
    19	exists only in this repository and served from installed binaries: an
    20	agent cannot read a word of it before installing, search engines and
    21	training pipelines never see it, and `llms.txt` exists only on loopback
    22	origins. Meanwhile the measurement series calls orientation cost "the dominant
    23	term" in the remaining efficiency gap (diary 0069) — cost the Convex
    24	lanes did not pay: across all five runs they consumed no documentation
    25	at all, working from prior model familiarity. A public surface is the pre-install orientation fix and the
    26	discoverability fix on its face; that it also feeds future model
    27	training is a plausible but **unverified hypothesis** — prior
    28	familiarity is measured, its provenance is not. The decision case rests
    29	on discoverability and retrieval; the training effect, if real, is
    30	upside this RFC proposes to instrument rather than assume (OQ4). It
    31	remains the largest unstarted item this program has identified. It is proposed here rather than executed because publishing
    32	is the author's decision.
    33	
    34	## Proposal
    35	
    36	1. **Public docs site, generated from `guide/`.** The corpus is already
    37	   CI-verified, version-fenced (`published-closure.json` + `since:`
    38	   machinery), and honest by construction (GAP rows). A static site
    39	   generator over `guide/` — same markdown, same snippets, the 0194
    40	   reference included — published on a real domain, with `/llms.txt` at
    41	   the root and per-release snapshots pinned to published closures (the
    42	   fence machinery already knows what each closure contains). The
    43	   in-repo/served guide remains canonical; the site is a projection with
    44	   the same content hashes.
    45	2. **Public examples repository**, mirroring the template outputs and
    46	   selected demo apps (the benchmark lanes' apps are strong candidates:
    47	   complete, proof-carrying, honestly scoped). Each example pinned to a
    48	   closure version and CI-cold-installed against the registry — the
    49	   examples repo doubles as an external consumer canary.
    50	3. **Skill distribution beyond scaffolds:** publish
    51	   `snapback-authoring` wherever agent harnesses discover skills, so
    52	   pre-scaffold orientation exists off-checkout.
    53	4. **Deliberate training-data posture (hypothesis, instrumented):**
    54	   write the site, examples, README funnels, and packages with a
    55	   future-model audience in mind (stable vocabulary, Rosetta aliases,
    56	   canonical snippets). Whether the moat actually erodes is testable
    57	   but confounded — skills, templates, and error improvements also cut
    58	   orientation cost — so the posture claims no timeline; OQ4 sketches
    59	   the pinned-model knowledge evaluation that could isolate the
    60	   training effect if it becomes worth measuring.
    61	
    62	## What this does not claim
    63	
    64	No hosted-service claims change; the site documents the local-first
    65	surface the capability index already asserts, GAP rows included. The
    66	honesty discipline that survived four published-consumer audits
    67	(diaries 0065-0069; the 0058 run was in-checkout) is the asset being
    68	published, not marketing copy.
    69	
    70	## Author decisions required
    71	
    72	- D1: Publish at all, and where (domain; whether the repo itself goes
    73	  public or only generated projections).
    74	- D2: Examples licensing and repo location.
    75	- D3: Snapshot policy (per-release docs versions vs latest-only).
    76	- D4: Whether benchmark artifacts (briefs, records) belong on the public
    77	  site — interacts with LLP 0197's publication standard.
    78	
    79	## Open questions
    80	
    81	- OQ1: Site generator and hosting (the repo has EAS/Cloudflare lanes;
    82	  either works — pick for boring reliability).
    83	- OQ2: How the site's `llms.txt` and sitemap best serve crawler and
    84	  agent retrieval (the served-guide retrieval-eval corpus can be reused
    85	  as the site's acceptance test).
    86	- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
    87	  public anchors, unifying citations across surfaces.
    88	- OQ4: The pinned-model knowledge evaluation — a fixed question set
    89	  about Snapback answered by pinned model builds over time, isolating
    90	  training-data presence from in-context aids; only worth building if
    91	  the training hypothesis starts driving decisions.
    15	## Summary
    16	
    17	The five-run series established the knowledge ladder empirically:
    18	**scaffold beats guide beats package source** — knowledge moved into
    19	template defaults (0.1.15's sessions mode, offline registration, upload
    20	wiring) produced the largest single-release wall-clock improvement of
    21	the program (bare lane 41.5→29.6 min). This Plan extends the portfolio
    22	along the measured demand: two new templates matching the committed
    23	benchmark briefs, proof machinery registered by default, and the recipe
    24	list the diaries priced.
    25	
    26	## Program
    27	
    28	**T1 — CRUD-dashboard template** (`--template crud-dashboard`), matching
    29	`benchmarks/briefs/crud.md`: tables/list/detail/edit shapes, relational
    30	query profile in the default path, sessions default, acceptance suite +
    31	**registered verify profile** included. Most agent tasks are CRUD-shaped;
    32	this becomes the default recommendation for generic briefs.
    33	
    34	**T2 — media-feed template** (`--template media-feed`), matching
    35	`briefs/media.md`: typed upload intents with renditions in the main
    36	path, delivery-profile selection demonstrated (the strict-vs-public
    37	lesson), infinite-scroll list over retained queries.
    38	
    39	**T3 — proof-by-default across all templates:** every template ships a
    40	registered `snapback.verify.config.mjs` (run-5's skill lane registered
    41	profiles by hand; the done-oracle should be non-vacuous from scaffold),
    42	and the expo templates ship web platform + deps (the two-run web-deps
    43	papercut, ticketed 2026-08-08 — absorbed here).
    44	
    45	**T4 — recipes** (guide sections with CI-verified snippets, in priority
    46	order from run evidence): the headless-simulator proof kit (plistlib
    47	scheme approval, Expo Go onboarding dismissal, drive-channel pattern —
    48	ticketed), real-auth sign-in flows beyond test personas, the offline
    49	supervisor-origin recipe (ticketed), verify-config authoring (ticketed).
    50	Recipes graduate into template code where a template naturally exercises
    51	them — the ladder says code placement beats prose.
    52	
    53	**T5 — template freshness gate:** templates cold-install and pass their
    54	suites against the *published* closure in CI (the staging lane covers
    55	tarball shape; this covers registry reality), so a template can never
    56	teach a drifted surface.
    57	
    58	## Sequencing
    59	
    60	T3 first (papercut absorption + verify-by-default — small), then T1
    61	(benchmark brief pairing makes it immediately measurable), T2, with T4
    62	recipes landing alongside whichever surface they document. T5 joins the
    63	release checklist when T1 lands.
    64	
    65	## Exit criteria
    66	
    67	- A cold agent given a CRUD or media brief scaffolds the matching
    68	  template and reaches all proofs with zero template-gap loops.
    69	- `snapback verify` is non-vacuous on every fresh scaffold.
    70	- The next benchmark run on the CRUD brief uses T1 and its lane report
    71	  cites no template gaps.
    72	
    73	## Open questions
    74	
    75	- OQ1: Template count discipline — the portfolio should stay small
    76	  (three app templates + recipes); additions require a measured brief.
    77	- OQ2: Whether `create-snapback-app` grows an interactive template
    78	  picker or stays flag-driven (agents prefer flags; humans may not).
    15	## Summary
    16	
    17	The measurement program can now produce numbers worth publishing —
    18	five runs, a committed harness, token metering, and a series showing
    19	the skill lane moving from 3.26x to ~2x tokens against Convex. LLP 0186
    20	OQ5 asked what disclosure makes a public comparison credible rather
    21	than vendor noise; this RFC proposes the standard. The governing
    22	principle: **publish the instrument, not just the number** — every
    23	claim reproducible by an outsider from public artifacts alone.
    24	
    25	## The standard
    26	
    27	A published Snapback benchmark claim requires:
    28	
    29	1. **N≥3 runs per configuration** with all runs reported (no
    30	   best-of): median + range. The observed ±30% per-lane variance
    31	   (diary 0069) makes single-run ratios unpublishable. The variance
    32	   study is therefore the prerequisite work item.
    33	2. **The full harness public:** briefs verbatim, lane prompts, fairness
    34	   rules, and run records (the `benchmarks/` tree, published via LLP
    35	   0195) — an outsider with the same model can rerun the measurement.
    36	3. **Fairness notes attached to every chart:** cold-context agents;
    37	   published surfaces only; same model, machine, and serial discipline;
    38	   competitor lanes free to use web docs; model prior-familiarity
    39	   asymmetry stated plainly (it currently favors competitors).
    40	4. **Proof-bar disclosure:** every chart states what each lane proved.
    41	   The headline chart should be the **equal-proof-bar variant**
    42	   (`briefs/messaging-equal-proof-bar.md`): both lanes required to
    43	   prove identical offline semantics — the honest comparison where
    44	   depth is priced instead of penalized. The unequal-bar table may be
    45	   published alongside with the asymmetry stated (Convex lanes'
    46	   own-words caveats — "not a real sync story" — quoted, not
    47	   paraphrased).
    48	5. **Version pinning:** every run names the exact closure and
    49	   competitor versions; claims age out when either moves materially.
    50	6. **Self-report symmetry:** lane reports (the diaries' raw
    51	   correction-loop lists, both vendors') are part of the public record
    52	   — including the runs and loop lists unfavorable to Snapback. The
    53	   credibility of the 94-run honesty discipline is the asset.
    54	
    55	## What publishing looks like
    56	
    57	A benchmarks page on the LLP 0195 site: the series chart (with the
    58	early losing runs included — the 26m-vs-11m origin is part of the
    59	story), the current N≥3 medians, links to briefs/records/prompts, and a
    60	"run it yourself" section. No superlatives that a record link cannot
    61	back.
    62	
    63	## Author decisions required
    64	
    65	- D1: Whether to publish at all and when (proposal: after the N≥3
    66	  study and the equal-proof-bar run, not before).
    67	- D2: Which competitors appear (Convex is measured; Supabase/
    68	  PocketBase/Postgres lanes are unbuilt — publishing claims about
    69	  unmeasured competitors is out under this standard).
    70	- D3: Whether competitor names appear in charts or as "backend A/B"
    71	  (proposal: names, with rule 2's reproducibility as the defense).
    72	
    73	## Open questions
    74	
    75	- OQ1: Token-count comparability across models if the harness ever runs
    76	  on non-Fable models (current standard: one model per published
    77	  series, stated).
    78	- OQ2: Whether an independent third party rerunning the harness is
    79	  worth soliciting before first publication (strongest possible
    80	  credibility; costs a relationship and time).

codex
1. [MATERIAL] [IN-DELTA] 0194 — Design §5 / Open Questions OQ2. Design requires “named exclusions, not hand-written pages,” but OQ2 permits “a hand-fenced reference section until one exists.” This leaves the declaration-only completeness boundary undecided and contradicts the no-hand-written rule. Resolving change: remove the hand-written alternative, or explicitly redefine the source-of-truth and completeness rules to accommodate that exception.

2. [minor] [IN-DELTA] 0195 — Proposal 4 / OQ4. A question set “answered by pinned model builds over time” cannot isolate training-data exposure: changing model builds introduce other training and architecture differences, while an actually pinned build will not acquire later training. It can measure knowledge availability without in-context aids, but not attribute changes causally to Snapback’s publication.

3. [MATERIAL] [IN-DELTA] 0196 — Summary, T1, Sequencing, and Exit criteria. The plan still proposes templates “matching the committed benchmark briefs,” makes that pairing “immediately measurable,” and exits when “the next benchmark run on the CRUD brief uses T1.” This validates against the design target and can present brief-specific optimization as general template effectiveness; it also lacks the promised template-assisted labeling and held-out-brief rule. Resolving change: describe T1 as exercising the same capability surface, label all known-brief results as template-assisted, and require success on a held-out brief not used to design the template before making portfolio-level claims.

4. [MATERIAL] [IN-DELTA] 0196 — T5. “Templates cold-install and pass their suites against the published closure in CI” is only a post-publication check, so it cannot support “a template can never teach a drifted surface.” Resolving change: require a blocking pre-release test against the exact staged tarballs, followed by a non-blocking-or-alerting post-release registry canary against the published closure, with explicit ownership of release blocking and rollback/escalation.

5. [MATERIAL] [IN-DELTA] 0197 — Summary. “The measurement program can now produce numbers worth publishing” and “3.26x to ~2x tokens” are unsupported by the supplied facts and contradict the RFC’s own N≥3-per-configuration prerequisite. The retained rounded figures imply approximately 2.91x to 2.23x, and the five-run longitudinal series is directional rather than controlled. Resolving change: use record-derived values and state that the existing series motivates the standard but is not itself a publishable controlled comparison.

6. [MATERIAL] [IN-DELTA] 0197 — Summary, governing principle. “Every claim reproducible by an outsider from public artifacts alone” is infeasible for stochastic agent runs and depends on access to the same model build and execution environment. Resolving change: require rerunnable methodology plus a reproducibility manifest identifying the harness commit, prompts, model/build, closure and competitor versions, environment, machine class, stopping rules, seeds where available, and raw outcome records; reserve “reproduced” for observed reruns.

7. [MATERIAL] [IN-DELTA] 0197 — Standard rules 3–4. “Published surfaces only” and an equal proof bar do not establish starter symmetry, particularly when LLP 0196 supplies Snapback templates tailored to benchmark capability surfaces. Resolving change: add a starter-symmetry rule that predeclares and applies the same public-availability and selection criteria to both vendors, and reports task-specific/template-assisted and bare-start configurations separately where equivalent starters do not exist.

8. [MATERIAL] [IN-DELTA] 0197 — Standard rule 4. “Both lanes required to prove identical offline semantics” does not say how an inability to reach that proof affects timing, token accounting, retries, or inclusion. This permits asymmetric retries, silent exclusions, or substitution of a weaker result. Resolving change: add a precommitted equal-proof-bar failure protocol with identical budgets and stopping rules, retention of every failed attempt, explicit failed/censored outcomes, and no promotion of an unequal-proof result into the headline comparison.

9. [MATERIAL] [IN-DELTA] 0197 — Standard rules 2 and 6. Requiring “the `benchmarks/` tree” and “the diaries’ raw correction-loop lists” to be public has no publication-safe artifact boundary and can disclose credentials, private paths, proprietary material, or unrelated user data. Resolving change: define a symmetric public schema preserving prompts, measurements, outcomes, proof evidence, and correction-loop categories while requiring secret/PII/private-material scanning, documented redactions with reason codes, and retained hashes or private originals for auditability.

10. [MATERIAL] [IN-DELTA] 0197 — Standard rule 6. “The credibility of the 94-run honesty discipline” inflates the evidence base; the supplied record is five runs and four published-consumer audits. Resolving change: replace the claim with those exact, separately named counts.

11. [MATERIAL] [PRE-EXISTING] 0197 — What publishing looks like. “The 26m-vs-11m origin” conflicts with the supplied retained measurement of 26m22s versus 16m36s for the initial Snapback-with-skill/Convex comparison. Resolving change: cite the exact retained pair and lane definitions, or identify a different retained record if the sentence intends another configuration.

12. [MATERIAL] [PRE-EXISTING] 0197 — Standard rule 1. “N≥3 runs per configuration with all runs reported” does not prospectively define configurations, started attempts, pilots, exclusions, or stopping rules. A vendor could tune prompts or configurations after observing results and still report every run it later designates as part of the study. Resolving change: preregister the run matrix, frozen harness/prompt commits, attempt IDs, budgets, stopping and exclusion rules before results are observed, and publish every started attempt and deviation.

0193: READY  
0194: NOT READY — blocking: 1  
0195: READY  
0196: NOT READY — blocking: 3, 4  
0197: NOT READY — blocking: 5, 6, 7, 8, 9, 10, 11, 12

SET: NOT READY
tokens used
64,846
1. [MATERIAL] [IN-DELTA] 0194 — Design §5 / Open Questions OQ2. Design requires “named exclusions, not hand-written pages,” but OQ2 permits “a hand-fenced reference section until one exists.” This leaves the declaration-only completeness boundary undecided and contradicts the no-hand-written rule. Resolving change: remove the hand-written alternative, or explicitly redefine the source-of-truth and completeness rules to accommodate that exception.

2. [minor] [IN-DELTA] 0195 — Proposal 4 / OQ4. A question set “answered by pinned model builds over time” cannot isolate training-data exposure: changing model builds introduce other training and architecture differences, while an actually pinned build will not acquire later training. It can measure knowledge availability without in-context aids, but not attribute changes causally to Snapback’s publication.

3. [MATERIAL] [IN-DELTA] 0196 — Summary, T1, Sequencing, and Exit criteria. The plan still proposes templates “matching the committed benchmark briefs,” makes that pairing “immediately measurable,” and exits when “the next benchmark run on the CRUD brief uses T1.” This validates against the design target and can present brief-specific optimization as general template effectiveness; it also lacks the promised template-assisted labeling and held-out-brief rule. Resolving change: describe T1 as exercising the same capability surface, label all known-brief results as template-assisted, and require success on a held-out brief not used to design the template before making portfolio-level claims.

4. [MATERIAL] [IN-DELTA] 0196 — T5. “Templates cold-install and pass their suites against the published closure in CI” is only a post-publication check, so it cannot support “a template can never teach a drifted surface.” Resolving change: require a blocking pre-release test against the exact staged tarballs, followed by a non-blocking-or-alerting post-release registry canary against the published closure, with explicit ownership of release blocking and rollback/escalation.

5. [MATERIAL] [IN-DELTA] 0197 — Summary. “The measurement program can now produce numbers worth publishing” and “3.26x to ~2x tokens” are unsupported by the supplied facts and contradict the RFC’s own N≥3-per-configuration prerequisite. The retained rounded figures imply approximately 2.91x to 2.23x, and the five-run longitudinal series is directional rather than controlled. Resolving change: use record-derived values and state that the existing series motivates the standard but is not itself a publishable controlled comparison.

6. [MATERIAL] [IN-DELTA] 0197 — Summary, governing principle. “Every claim reproducible by an outsider from public artifacts alone” is infeasible for stochastic agent runs and depends on access to the same model build and execution environment. Resolving change: require rerunnable methodology plus a reproducibility manifest identifying the harness commit, prompts, model/build, closure and competitor versions, environment, machine class, stopping rules, seeds where available, and raw outcome records; reserve “reproduced” for observed reruns.

7. [MATERIAL] [IN-DELTA] 0197 — Standard rules 3–4. “Published surfaces only” and an equal proof bar do not establish starter symmetry, particularly when LLP 0196 supplies Snapback templates tailored to benchmark capability surfaces. Resolving change: add a starter-symmetry rule that predeclares and applies the same public-availability and selection criteria to both vendors, and reports task-specific/template-assisted and bare-start configurations separately where equivalent starters do not exist.

8. [MATERIAL] [IN-DELTA] 0197 — Standard rule 4. “Both lanes required to prove identical offline semantics” does not say how an inability to reach that proof affects timing, token accounting, retries, or inclusion. This permits asymmetric retries, silent exclusions, or substitution of a weaker result. Resolving change: add a precommitted equal-proof-bar failure protocol with identical budgets and stopping rules, retention of every failed attempt, explicit failed/censored outcomes, and no promotion of an unequal-proof result into the headline comparison.

9. [MATERIAL] [IN-DELTA] 0197 — Standard rules 2 and 6. Requiring “the `benchmarks/` tree” and “the diaries’ raw correction-loop lists” to be public has no publication-safe artifact boundary and can disclose credentials, private paths, proprietary material, or unrelated user data. Resolving change: define a symmetric public schema preserving prompts, measurements, outcomes, proof evidence, and correction-loop categories while requiring secret/PII/private-material scanning, documented redactions with reason codes, and retained hashes or private originals for auditability.

10. [MATERIAL] [IN-DELTA] 0197 — Standard rule 6. “The credibility of the 94-run honesty discipline” inflates the evidence base; the supplied record is five runs and four published-consumer audits. Resolving change: replace the claim with those exact, separately named counts.

11. [MATERIAL] [PRE-EXISTING] 0197 — What publishing looks like. “The 26m-vs-11m origin” conflicts with the supplied retained measurement of 26m22s versus 16m36s for the initial Snapback-with-skill/Convex comparison. Resolving change: cite the exact retained pair and lane definitions, or identify a different retained record if the sentence intends another configuration.

12. [MATERIAL] [PRE-EXISTING] 0197 — Standard rule 1. “N≥3 runs per configuration with all runs reported” does not prospectively define configurations, started attempts, pilots, exclusions, or stopping rules. A vendor could tune prompts or configurations after observing results and still report every run it later designates as part of the study. Resolving change: preregister the run matrix, frozen harness/prompt commits, attempt IDs, budgets, stopping and exclusion rules before results are observed, and publish every started attempt and deviation.

0193: READY  
0194: NOT READY — blocking: 1  
0195: READY  
0196: NOT READY — blocking: 3, 4  
0197: NOT READY — blocking: 5, 6, 7, 8, 9, 10, 11, 12

SET: NOT READY

## Round 3 — 2026-08-08 (gpt-5 family, delta round)

Provenance: codex exec, gpt-5.6-sol, xhigh, capsule sr-capsule-r3,
targets at c4c4bb6a5. One launch. Verbatim body follows.

Reading additional input from stdin...
OpenAI Codex v0.147.0
--------
workdir: /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR]
reasoning effort: xhigh
reasoning summaries: none
session id: 019fe21d-714a-7581-bbe3-2bb4f5b57fbe
--------
user
You are reviewing a five-document LLP set as one cluster in a DELTA
ROUND (third round; the documents were revised twice after prior
rounds). Targets: LLP 0193 (errors-as-docs completeness, Plan), 0194
(generated API reference, RFC), 0195 (public docs/examples/training
surface, RFC), 0196 (template and recipe portfolio, Plan), 0197
(benchmark publication standard, RFC). CONTEXT.md carries factual
background.

STATE: 0193 and 0195 were verdicted READY by both prior review families
at the previous revision; the r2/r3 delta touched them only in the
narrow ways listed below. The r2+r3 DELTA (everything else is
pre-existing, previously-reviewed text):
- 0193: Evidence exemplars gained exact citations (diary 0058 quote +
  two closed-ticket pointers); Related enumerates diaries
  0065/0066/0068/0069 instead of a range.
- 0194: OQ2 no longer permits a hand-written interim section (named
  exclusion until a declaration file lands); the kills list splits
  initial-scope entries from OQ2-contingent entries.
- 0195: diary enumeration replaces the range (two places).
- 0196: Summary superlative scoped to knowledge-placement releases with
  the 0.1.13-vs-0.1.15 mechanism distinction; T1/T2 "exercising the
  same capability surface" wording; T5 split into a blocking
  pre-release staged-tarball gate + post-release registry canary with
  ownership; exit criterion adds template-assisted labeling and the
  held-out-brief rule referencing LLP 0197 4a/4b.
- 0197: Summary restated (2.91x→2.24x directional series, explicit
  not-itself-publishable statement, reproducibility manifest, reserved
  "reproduced"); rule 1 gains preregistration (run matrix, budgets,
  stopping/exclusion rules, attempt IDs); rules 4a (starter symmetry,
  split reporting when no equivalent starter) and 4b (equal-proof-bar
  failure protocol) added; rule 6 rewritten (five-run/four-audit
  counts, publication-safe artifact schema with redaction reason codes,
  retained hashes, human disclosure-authority review); "What publishing
  looks like" exempts the historical series chart from rule 1 as dated
  narrative and cites diary 0058's 26m03s-vs-11m15s.

Review the full documents for MATERIAL concerns (correctness, coherence,
feasibility, safety, decision-quality; altitude rule: detail-only
demands identifying no defective decision are implementation-phase
notes). CLASSIFY every concern IN-DELTA vs PRE-EXISTING.

FORMAT: 1) numbered concerns, labeled [MATERIAL]/[minor] and
[IN-DELTA]/[PRE-EXISTING], naming document + section, quoting disputed
text, stating the resolving change for MATERIAL; 2) per-target verdict
lines for all five ("0193: READY" / "0193: NOT READY — blocking:
<numbers>"); 3) one "SET: READY"/"SET: NOT READY" line. You are the only
reviewer; do not reference other reviews; do not rewrite the documents.

The capsule files are in the current directory: CONTEXT.md plus the five LLP documents. Read them all in full and produce the review in exactly the instructed format.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
2026-08-08T16:03:28.867938Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server linear: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
2026-08-08T16:03:28.946351Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server linear: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
codex
I’m using the LLP review guidance because this is a formal LLP cluster delta review. I’ll read its instructions plus all six capsule files in full, then report only decision-relevant concerns with delta classification.
exec
/bin/zsh -lc "pwd && rg --files -g 'AGENTS.md' -g 'CONTEXT.md' -g '*0193*' -g '*0194*' -g '*0195*' -g '*0196*' -g '*0197*' . /Users/ccheever/.codex/skills/llp 2>/dev/null && wc -l /Users/ccheever/.codex/skills/llp/SKILL.md && sed -n '1,240p' /Users/ccheever/.codex/skills/llp/SKILL.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3
 succeeded in 0ms:
/private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3
./0195-public-documentation-and-training-surface.rfc.md
./0196-template-and-recipe-portfolio.plan.md
./0194-generated-api-reference.rfc.md
./0193-errors-as-docs-completeness.plan.md
./CONTEXT.md
./0197-benchmark-publication-standard.rfc.md
     100 /Users/ccheever/.codex/skills/llp/SKILL.md
---
name: llp
description: Create, review, and list Exact LLP documents in the Exact repository. Use when Codex is asked to work with `/llp`, `$llp`, LLP proposals, LLP reviews, LLP numbering, or files under `llp/`.
---

# llp

Use this skill for Exact's LLP document workflow. Prefer LLP terminology:
"LLP document" for the general case, "RFC" only when the document type is
actually RFC, and `# LLP NNNN: Title` for new numbered documents.

## Ground Rules

- Work from the repository root when possible.
- Search `llp/` when numbering or locating LLP documents.
- Keep documents in `llp/`.
- Numbered filenames are `NNNN-slug.type.md`, for example
  `0042-video-component.rfc.md`.
- New proposal documents default to `Type: RFC`.
- Required metadata for new documents: `Type`, `Status`, `Systems`, `Author`,
  `Date`, `Revised`, and `Related`.
- Valid proposal statuses for `RFC`, `Spec`, and `Plan`: `Draft`, `Review`,
  `Accepted`, `Implemented`, `Superseded`, `Shelved`, and `Withdrawn`.
- Normalize statuses when matching by stripping ` vN`, stripping trailing
  parenthetical notes, and comparing case-insensitively.
- Do not accept or reject LLP documents on the user's behalf.
- Do not renumber existing unnumbered documents unless the user is actively
  updating one.

## Create

For `/llp create <title> [--type <type>]`:

1. Scan existing numbered LLP files in `llp/`.
2. Pick the next number.
3. Build the slug: lowercase, replace non-alphanumerics with `-`, collapse
   repeated `-`, and trim edge `-`.
4. Create `llp/NNNN-slug.type.md` with this scaffold, using the requested type
   or defaulting to `RFC` and `.rfc.md`:

```markdown
# LLP NNNN: <Title>

**Type:** RFC
**Status:** Draft
**Systems:** TBD
**Author:** Charlie Cheever / Codex
**Date:** YYYY-MM-DD
**Revised:** YYYY-MM-DD
**Related:**

## Summary

## Design
```

5. Help draft the document from the current conversation context.

## Review

For `/llp review <identifier>`:

- The identifier may be a number like `0036`, a slug like
  `intent-level-authoring`, or omitted. If omitted, list Draft/Review
  documents and ask which one.
- Locate the document in `llp/` and read the full file.
- Review it using this prompt:

```text
What do you think of this proposal? Is it a good idea? Do we have a good plan here? How would you change it to make it better? What would you add or take away or change? Is anything definitely or possibly wrongheaded here? Do you have any novel ideas that you think might make this way better even if they are a bit non-standard? What are the key open questions we need to answer to refine this?
```

- Present findings first: overall assessment, strengths, concerns,
  suggestions, and open questions.
- Save the review artifact under
  `notes-archive/ai-reviews/{slug}.round-{N}.AGENTS.md`.
- Derive `{slug}` by stripping the leading `NNNN-` and trailing `.type.md`.
- Increment `{N}` based on existing `*.AGENTS.md` review files.
- If the document is still `Draft`, suggest updating it to `Review` after the
  review.
- Remind the user that the LLP process also recommends a GPT review unless
  this Codex review is the GPT review they wanted.

## List

For `/llp list [status]`:

1. Scan `llp/`.
2. Extract and normalize `**Status:**`.
3. Group documents by normalized status.
4. Sort numbered documents ascending, then unnumbered documents alphabetically.
5. If a status filter was provided, show only that group.

Render numbered documents as:

```text
0038  exact-inspect-skill
0039  rfc-skill
----  unnumbered-rfc
```

exec
/bin/zsh -lc 'wc -l -w -c CONTEXT.md 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3
 succeeded in 0ms:
      35     288    2168 CONTEXT.md
     104     737    5298 0193-errors-as-docs-completeness.plan.md
      91     690    5164 0194-generated-api-reference.rfc.md
      91     666    4901 0195-public-documentation-and-training-surface.rfc.md
      93     652    4980 0196-template-and-recipe-portfolio.plan.md
     122     928    7028 0197-benchmark-publication-standard.rfc.md
     536    3961   29539 total

exec
/bin/zsh -lc "for f in CONTEXT.md 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md; do printf '\\n===== %s =====\\n' \""'$f"; sed -n '"'1,240p' \""'$f"; done' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3
 succeeded in 0ms:

===== CONTEXT.md =====
# Context sheet (facts only; for reviewing the five-document set)

Snapback is a local-first backend framework: declarative schema/functions
with codegen, live queries, ephemeral state, typed assets, sessions auth,
React/Expo/headless clients, a Rust runtime shipped as prebuilt npm
binaries. Its docs are an in-repo "guide" (CI-verified snippets,
capability index with explicit GAP rows, version fences against the
published npm closure) served by running servers at /_snapback/guide and
an embedded `snapback guide` search; there is currently no public web
documentation. Packages @expo/snapback-* are on npm at 0.1.15 (eleven
packages incl. create-snapback-app). An agent skill (snapback-authoring)
ships inside scaffolded apps. A committed benchmark harness exists under
benchmarks/ (briefs, lane prompt templates, run-record schema, fairness
rules) from LLP 0186 W1.

Measurement facts cited by the documents (five serial cold-agent runs,
same brief/machine/model, token-metered): wall/tokens for the
Snapback-with-skill lane vs a Convex lane moved 26m22s/329k vs
16m36s/113k (npm 0.1.13) to 19m00s/201k vs 10m18s/90k (npm 0.1.15);
observed per-lane run-to-run variance ±30% at N=1; latest run had zero
framework-caused defects in any Snapback lane; remaining friction was
knowledge-shaped (signature/contract questions resolved by reading
package source; one case by extracting strings from the runtime binary).
Convex lanes across all runs consumed no documentation (prior model
familiarity). Diaries 0058, 0065, 0066, 0068, 0069 record the runs.
Existing related LLPs: 0186 (agent authoring efficiency program: W0
plumbing fixes shipped; W1 benchmark harness; W2 skill/scaffolds; W3
errors bar; W4 edit-loop taxes), 0146 (agent affordances; D7 = typed
remediations carried by refusals, ratified, enforcement carrier not yet
built), 0061 (guide design, intent-indexed), 0041 (packaging/releases).
A diagnostic-inventory drift gate exists in CI (production diagnostic
codes are classified; new unclassified codes fail).

Additional retained fact for this round: diary 0058 records the first
run (in-checkout, Codex-model era): Snapback 26m03s vs Convex 11m15s.

===== 0193-errors-as-docs-completeness.plan.md =====
# LLP 0193: Errors-as-docs completeness program

**Type:** Plan
**Status:** Review
**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
diaries 0065/0066/0068/0069

## Summary

Across the retained measurement series, refusal-quality incidents
resolved fastest when the refusal named its own fix — diary 0048's
`SNAPBACK_ASSET_IMAGE_DECODE_FAILED` carrying the exact upstream parser
error, and the anonymous-upload refusal naming `snapback assets put
--user` (diary 0065's tickets) are retained exemplars — while several of
the expensive detours trace to refusals that carried neither rule nor
fix. (Additional unretained lane-report incidents exist but are not
cited as evidence here.) LLP 0186 W3 states the
bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
the violated rule and either the fix or a resolving guide anchor** — but
the bar has only ever been applied to codes that happened to appear in
diaries. This Plan audits the entire population once and then makes the
bar structural, so it can never regress.

## Evidence

- Diary 0069: zero framework defects, yet the run's expensive moments
  were knowledge-shaped — several reachable from a refusal that could
  have carried the answer.
- The retained record shows the mechanism in both directions: refusals
  that named remediations (`snapback assets put --user`, diary 0048's
  decode diagnostic, the seed-recovery messages) cost near-zero;
  refusals that did not each cost a bisection session — diary 0058's
  "host-ops error response was not JSON" (in-checkout era;
  `issues/closed/20260805-managed-dev-multi-json-load.md`) and the
  SHA-256-hashed field path
  (`issues/closed/20260805-result-contract-violation-hashes-field-path.md`).
- The infrastructure half-exists: stable code registry, the
  production diagnostic-inventory drift gate, and 0146 D7 ratified as
  the remediation carrier.

## Program

**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
code inventory (a raw identifier sweep finds ~2,700 `SNAPBACK_*` symbols
including env vars and test constants; the diagnostic subset is the
real population and Phase 1 establishes its size) from the diagnostic registry
plus a grep sweep for unregistered emissions. Fan out grading lanes:
each code graded A (names rule + fix/anchor), B (names rule only), or
C (bare), with the emitting site and agent-triggerability recorded.
Output: a checked-in graded ledger under `tests/acceptance/diagnostics/`.

**Phase 2 — fix in evidence order.** First: every B/C code that appears
in any diary's correction-loop list. Then B/C codes on
agent-triggerable paths, batched by subsystem. Message edits follow the
house style; guide anchors must resolve (check-guide enforces). Codes
that are genuinely internal (never agent-triggerable) are marked so in
the ledger rather than polished.

**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
a new agent-triggerable code cannot land without a remediation in the
carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
floor. The typed-remediation end state is 0146's ratified D7 and is not
reopened here; the carrier choice is OQ6's open ruling
(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
named dependency of this phase's structured half — until it rules, the
gate enforces text+anchor as a bounded interim floor, upgraded
code-by-code as the carrier lands. Anchor
resolution joins CI. The graded ledger becomes the gate's baseline;
grade regressions fail.

**Phase 4 — close the loop with measurement.** The next benchmark run's
lane reports grade every refusal encountered; new B/C sightings are the
recurring audit input.

## Exit criteria

1. Graded ledger covers 100% of registered codes; zero ungraded
   emissions in the sweep.
2. **Every ledger entry classified agent-triggerable is grade A** (the
   program's declared bar; diary-cited codes are merely the first
   batch).
3. The drift gate refuses a new agent-triggerable code without
   remediation/anchor (negative test), and refuses grade regressions.
4. A benchmark run encounters zero B- or C-grade refusals — as
   validation of criterion 2, not a substitute for it.

## Open questions

- OQ1: The migration bound — how long audited legacy codes may remain
  on the text+anchor floor after the OQ6 carrier ruling lands. Proposal:
  structured on next touch, with a dated full-migration milestone set
  when the carrier ships (the typed end state itself is settled by
  0146's ratified D7, not by this Plan).
- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
  from any published-surface operation, decided by the grading lane,
  spot-checked in review.

===== 0194-generated-api-reference.rfc.md =====
# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Review
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration, OQ2-contingency marking). 2026-08-08 (r2) — r2 also resolves the OQ2 hand-written-interim contradiction (named exclusion until a declaration file lands). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0061 (guide design — intent-indexed by choice), LLP 0186
(measurement evidence), diaries 0068-0069

## Summary

Across five measurement runs, every remaining package-source excursion
shares one shape: a **signature or contract question** — headless
`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
(extracted from runtime binary strings in run 5), the verify-config
contract, client constructor option pairs. The guide is deliberately
intent-indexed (LLP 0061) and should stay that way; what is missing is
the complementary layer: a **complete, generated, build-bound API
reference** derived from the packages' own `.d.mts` declarations — the
types agents consistently praise — so that no signature question ever
requires opening `node_modules`.

## Design

1. **Source of truth:** the published packages' `.d.mts` files plus doc
   comments. No hand-written reference pages — generation only, so it
   cannot drift (the closure-drift lesson, LLP 0186 W0).
2. **Generation:** a build step (TypeScript compiler API, the
   export-parity test's traversal as the seed) emitting one markdown
   page per package under `guide/reference/<package>.md`, with stable
   per-symbol anchors. Runs in the same pipeline as
   `generate-guide-manifest`; output is committed generated artifact,
   checked like the flat guide.
3. **Serving:** joins the guide manifest — served at
   `/_snapback/guide/reference/...`, indexed by
   `snapback guide <query>` and the MCP resources, listed in
   `/llms.txt`. Build-bound headers like every guide response.
4. **Joins:** intent pages link into reference anchors ("full signature:
   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
   may cite reference anchors as their fix pointer.
5. **Scope and completeness rule:** the reference includes exactly the
   surfaces that have machine-readable declaration sources, and its
   completeness claim is scoped to that set. Order:
   `@expo/snapback-client` (headless surface — the largest excursion
   source), `snapback-react` hooks and fact types, `snapback-expo`.
   The `ctx` handler surface and the CLI verify/config contracts have
   no declaration source today; they JOIN the reference when their
   declaration files land (OQ2 proposes shipping one for `ctx`, which
   also gives consumers editor types) — until then they are named
   exclusions, not hand-written pages, so the no-hand-written rule and
   the completeness claim stay true together.

## What this kills

Retained-record attributions: headless args nesting (diary 0069 residue
3), `createAssetClient` root-export discovery (diary 0068), the sessions
client-construction option pair (0068 residue 4, hit by two lanes) —
all in the initial declaration-sourced scope. Contingent on OQ2's
declaration files landing: `ctx.db` verbs via binary strings (0069
residue 2) and the verify-config contract (0068 and 0069 residue 5) —
the two most expensive named excursions sit behind that exclusion,
which is the strongest argument for scheduling OQ2 early. Diary 0069 calls orientation "the
dominant term" in the remaining gap; the signature-shaped items above
are the subset of its residue list this RFC removes. (No quantitative
fraction is claimed; the diaries do not decompose the bucket.)

## Open questions

- OQ1: Page granularity, size budgets, and the flat-projection
  interaction — the flat guide is already past its one-request size
  premise (`issues/20260806-guide-flat-projection-oversize.md`); the
  reference is therefore EXCLUDED from `flat.md` unless that ticket's
  diet/tier design lands first, and per-module splitting rules are
  needed regardless.
- OQ2: The `ctx` handler surface (db verbs, assets, refuse) is a runtime
  contract, not a package `.d.mts` — it joins the reference only via a
  published declaration file (which also gives consumers editor types).
  No hand-written interim section: until the declaration lands, `ctx`
  remains a named exclusion per Design 5, documented in the intent
  guide as today.
- OQ3: Whether doc comments in `.d.mts` are complete enough to render
  useful prose, and whether improving them (which rotates artifact
  identity — the doc-comment lesson) batches with releases.
- OQ4: Versioning — the reference is inherently build-bound (served),
  which is correct; whether the public docs surface (LLP 0195) pins
  per-release snapshots is that RFC's question.

===== 0195-public-documentation-and-training-surface.rfc.md =====
# LLP 0195: Public documentation, examples, and training-data surface

**Type:** RFC
**Status:** Review
**Systems:** Documentation, Publishing, Guide, Templates, Competitive
evaluation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (the orientation-gap evidence), LLP 0061 (guide),
LLP 0041 (packaging), diaries 0065/0066/0068/0069

## Summary

Snapback currently has **no public documentation surface**. The guide
exists only in this repository and served from installed binaries: an
agent cannot read a word of it before installing, search engines and
training pipelines never see it, and `llms.txt` exists only on loopback
origins. Meanwhile the measurement series calls orientation cost "the dominant
term" in the remaining efficiency gap (diary 0069) — cost the Convex
lanes did not pay: across all five runs they consumed no documentation
at all, working from prior model familiarity. A public surface is the pre-install orientation fix and the
discoverability fix on its face; that it also feeds future model
training is a plausible but **unverified hypothesis** — prior
familiarity is measured, its provenance is not. The decision case rests
on discoverability and retrieval; the training effect, if real, is
upside this RFC proposes to instrument rather than assume (OQ4). It
remains the largest unstarted item this program has identified. It is proposed here rather than executed because publishing
is the author's decision.

## Proposal

1. **Public docs site, generated from `guide/`.** The corpus is already
   CI-verified, version-fenced (`published-closure.json` + `since:`
   machinery), and honest by construction (GAP rows). A static site
   generator over `guide/` — same markdown, same snippets, the 0194
   reference included — published on a real domain, with `/llms.txt` at
   the root and per-release snapshots pinned to published closures (the
   fence machinery already knows what each closure contains). The
   in-repo/served guide remains canonical; the site is a projection with
   the same content hashes.
2. **Public examples repository**, mirroring the template outputs and
   selected demo apps (the benchmark lanes' apps are strong candidates:
   complete, proof-carrying, honestly scoped). Each example pinned to a
   closure version and CI-cold-installed against the registry — the
   examples repo doubles as an external consumer canary.
3. **Skill distribution beyond scaffolds:** publish
   `snapback-authoring` wherever agent harnesses discover skills, so
   pre-scaffold orientation exists off-checkout.
4. **Deliberate training-data posture (hypothesis, instrumented):**
   write the site, examples, README funnels, and packages with a
   future-model audience in mind (stable vocabulary, Rosetta aliases,
   canonical snippets). Whether the moat actually erodes is testable
   but confounded — skills, templates, and error improvements also cut
   orientation cost — so the posture claims no timeline; OQ4 sketches
   the pinned-model knowledge evaluation that could isolate the
   training effect if it becomes worth measuring.

## What this does not claim

No hosted-service claims change; the site documents the local-first
surface the capability index already asserts, GAP rows included. The
honesty discipline that survived four published-consumer audits
(diaries 0065/0066/0068/0069; the 0058 run was in-checkout) is the asset being
published, not marketing copy.

## Author decisions required

- D1: Publish at all, and where (domain; whether the repo itself goes
  public or only generated projections).
- D2: Examples licensing and repo location.
- D3: Snapshot policy (per-release docs versions vs latest-only).
- D4: Whether benchmark artifacts (briefs, records) belong on the public
  site — interacts with LLP 0197's publication standard.

## Open questions

- OQ1: Site generator and hosting (the repo has EAS/Cloudflare lanes;
  either works — pick for boring reliability).
- OQ2: How the site's `llms.txt` and sitemap best serve crawler and
  agent retrieval (the served-guide retrieval-eval corpus can be reused
  as the site's acceptance test).
- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
  public anchors, unifying citations across surfaces.
- OQ4: The pinned-model knowledge evaluation — a fixed question set
  about Snapback answered by pinned model builds over time, isolating
  training-data presence from in-context aids; only worth building if
  the training hypothesis starts driving decisions.

===== 0196-template-and-recipe-portfolio.plan.md =====
# LLP 0196: Template and recipe portfolio

**Type:** Plan
**Status:** Review
**Systems:** Templates, CLI, Guide, Testing, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain: capability-surface wording, T5 two-gate split, template-assisted labeling + held-out-brief rule. 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W2), LLP 0195 (public examples mirror), diaries
0068-0069, benchmarks/briefs/

## Summary

The measurement diaries repeatedly rank knowledge placement:
**scaffold beats guide beats package source** (every lane's
knowledge-source ladder ends in package source; the scaffold is
unanimously the cheapest). Knowledge moved into template defaults
(0.1.15's sessions mode, offline registration, upload wiring) produced
the largest improvement of any release whose changes were
knowledge-placement rather than defect fixes — bare lane 41m32s→29m35s
(diaries 0068/0069; the larger 80m→41m step at 0.1.13 came from the
seven-defect fix layer, a different mechanism). This Plan extends the portfolio
along the measured demand: two new templates exercising the capability
surfaces of the committed benchmark briefs, proof machinery registered by default, and the recipe
list the diaries priced.

## Program

**T1 — CRUD-dashboard template** (`--template crud-dashboard`),
exercising the same capability surface as `benchmarks/briefs/crud.md`
(not authored against the brief document): tables/list/detail/edit shapes, relational
query profile in the default path, sessions default, acceptance suite +
**registered verify profile** included. Most agent tasks are CRUD-shaped;
this becomes the default recommendation for generic briefs.

**T2 — media-feed template** (`--template media-feed`), exercising the
same capability surface as `briefs/media.md`: typed upload intents with renditions in the main
path, delivery-profile selection demonstrated (the strict-vs-public
lesson), infinite-scroll list over retained queries.

**T3 — proof-by-default across all templates:** every template ships a
registered `snapback.verify.config.mjs` (run-5's skill lane registered
profiles by hand; the done-oracle should be non-vacuous from scaffold),
and the expo templates ship web platform + deps (the two-run web-deps
papercut, ticketed 2026-08-08 — absorbed here).

**T4 — recipes** (guide sections with CI-verified snippets, in priority
order from run evidence): the headless-simulator proof kit (plistlib
scheme approval, Expo Go onboarding dismissal, drive-channel pattern —
ticketed), real-auth sign-in flows beyond test personas, the offline
supervisor-origin recipe (ticketed), verify-config authoring (ticketed).
Recipes graduate into template code where a template naturally exercises
them — the ladder says code placement beats prose.

**T5 — template freshness, two gates:** (a) pre-release and blocking:
templates cold-install and pass their suites against the exact
*candidate staged tarballs* during release qualification, so a release
cannot ship with a template failing against its own closure; (b)
post-release canary: the same suites re-run against the *published*
registry closure, alerting (not blocking) on drift the staging
environment cannot see, with the release owner holding
rollback/fix-forward escalation. Neither alone suffices.

## Sequencing

T3 first (papercut absorption + verify-by-default — small), then T1
(benchmark brief pairing makes it immediately measurable), T2, with T4
recipes landing alongside whichever surface they document. T5 joins the
release checklist when T1 lands.

## Exit criteria

- A cold agent given a CRUD or media brief scaffolds the matching
  template and reaches all proofs with zero template-gap loops.
- `snapback verify` is non-vacuous on every fresh scaffold.
- The next benchmark run on the CRUD brief uses T1 with no template-gap
  loops — measured and labeled as a **template-assisted scenario**.
  Templates deliberately cover benchmark-brief capability surfaces, so
  template-assisted results are never published as general
  authoring-efficiency claims: portfolio-level claims require success
  on a held-out brief variant not used to design any template, and
  competitor lanes get a symmetric starter-availability policy
  (LLP 0197 rules 4a/4b govern).

## Open questions

- OQ1: Template count discipline — the portfolio should stay small
  (three app templates + recipes); additions require a measured brief.
- OQ2: Whether `create-snapback-app` grows an interactive template
  picker or stays flag-driven (agents prefer flags; humans may not).

===== 0197-benchmark-publication-standard.rfc.md =====
# LLP 0197: Competitive benchmark publication standard

**Type:** RFC
**Status:** Review
**Systems:** Competitive evaluation, Publishing, Documentation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain, plus round-2 finds: preregistration in rule 1, rules 4a/4b, publication-safe schema in rule 6, reproducibility manifest, diary-0058 citation, series restated 2.91x→2.24x. 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
(harness, records), LLP 0195 (public surface), diaries 0058-0069

## Summary

The measurement program can now produce the raw material for
publication — five runs, a committed harness, token metering, and a
directional series (2.91x tokens for the first published-consumer
skill-adjacent lane on 0.1.13 to 2.24x on 0.1.15; bases differ across
rows, the records themselves say the series is directional rather than
a controlled sequence, and diary 0069 disclaims N=1 ratio movement as
signal). The existing series motivates this standard; it is not itself
a publishable controlled comparison. LLP 0186 OQ5 asked what disclosure
makes a public comparison credible rather than vendor noise; this RFC
proposes the standard. The governing principle: **publish the
instrument, not just the number** — the methodology independently
rerunnable by an outsider from public artifacts alone, carried by a
reproducibility manifest per record (harness commit, prompts, model
identity/build and settings as run, closure and competitor versions,
tool versions, environment and machine class, stopping rules, seeds
where available). Where the measuring model is not publicly accessible,
the standard promises rerunnable methodology and comparable
measurement, not bit-identical results — stated on every chart;
"reproduced" is reserved for observed reruns.

## The standard

A published Snapback benchmark claim requires:

1. **N≥3 runs per configuration, preregistered:** the run matrix
   (configurations, budgets, stopping and exclusion rules, frozen
   harness/prompt commits) is committed before results are observed;
   every started attempt gets an ID and is reported — no best-of, no
   post-hoc configuration designation. Median + range. The observed
   ±30% per-lane variance (diary 0069) makes single-run ratios
   unpublishable; the variance study is the prerequisite work item.
2. **The full harness public:** briefs verbatim, lane prompts, fairness
   rules, and run records (the `benchmarks/` tree, published via LLP
   0195) — an outsider with the same model can rerun the measurement.
3. **Fairness notes attached to every chart:** cold-context agents;
   published surfaces only; same model, machine, and serial discipline;
   competitor lanes free to use web docs; model prior-familiarity
   asymmetry stated plainly (it currently favors competitors).
4. **Proof-bar disclosure:** every chart states what each lane proved.
   The headline chart should be the **equal-proof-bar variant**
   (`briefs/messaging-equal-proof-bar.md`), with the bar stated as
   vendor-neutral outcomes (e.g. "cold-start reads of prior history
   with the backend unreachable"), not feature names — the honest
   comparison where depth is priced instead of penalized. The
   unequal-bar table may be published alongside with the asymmetry
   stated (competitor lanes' own-words caveats quoted, not
   paraphrased).
   4a. **Starter symmetry:** where a Snapback lane uses a shipped
   template, the scenario is labeled template-assisted; competitor
   lanes get the same predeclared public-availability and selection
   criteria for their ecosystems' starters; general
   authoring-efficiency claims use held-out brief variants no template
   was designed against (LLP 0196's exit criteria adopt this); where no
   equivalent starter exists, template-assisted and bare-start
   configurations publish separately.
   4b. **Equal-proof-bar failure protocol (preregistered):** identical
   budgets and stopping rules per lane; every failed attempt retained
   and reported as a capability failure — never converted to a timeout
   duration, silently excluded, or substituted with a weaker result;
   efficiency ratios computed only across runs meeting the identical
   bar, with the capability-failure table published beside them.
5. **Version pinning:** every run names the exact closure and
   competitor versions; claims age out when either moves materially.
6. **Self-report symmetry, publication-safe:** lane reports and
   correction-loop content (both vendors') are part of the public
   record — including runs unfavorable to Snapback; the credibility of
   the five-measurement-run, four-published-consumer-audit honesty
   discipline is the asset. Publication passes through a
   **publication-safe artifact schema**: a symmetric public projection
   preserving prompts, measurements, outcomes, proof evidence, and
   correction-loop categories; automated secret/credential/PII and
   private-material scanning; path and machine-identifier scrubbing
   with documented redactions and reason codes; retained hashes of the
   private originals for auditability; and a human with
   repository-disclosure authority reviewing before anything ships.
   Raw transcripts never publish.

## What publishing looks like

A benchmarks page on the LLP 0195 site: the historical series chart as
a dated narrative annotation, exempt from rule 1 because it makes no
controlled-comparison claim (the early losing runs included — the
26m03s-vs-11m15s origin, diary 0058, is part of the story), the current
N≥3 medians as the only comparative claims, links to briefs/records/
prompts, a "run it yourself" section stating expected run cost, and the
reproducibility manifest per record. No superlatives that a record link
cannot back.

## Author decisions required

- D1: Whether to publish at all and when (proposal: after the N≥3
  study and the equal-proof-bar run, not before).
- D2: Which competitors appear (Convex is measured; Supabase/
  PocketBase/Postgres lanes are unbuilt — publishing claims about
  unmeasured competitors is out under this standard).
- D3: Whether competitor names appear in charts or as "backend A/B"
  (proposal: names, with rule 2's reproducibility as the defense).

## Open questions

- OQ1: Token-count comparability across models if the harness ever runs
  on non-Fable models (current standard: one model per published
  series, stated).
- OQ2: Whether an independent third party rerunning the harness is
  worth soliciting before first publication (strongest possible
  credibility; costs a relationship and time).

codex
1. [MATERIAL] [IN-DELTA] 0194 — “What this kills” / OQ2. The kills list says, “Contingent on OQ2’s declaration files landing: `ctx.db` verbs … and the verify-config contract,” but OQ2 proposes a declaration file only for `ctx`. The RFC therefore has no decision or dependency capable of bringing verify-config into the generated reference. Resolving change: add an explicit machine-readable declaration source and decision path for verify-config, or remove it from the OQ2-contingent kills.

2. [MATERIAL] [IN-DELTA] 0197 — “The standard,” rule 4a. The protection applies only “where a Snapback lane uses a shipped template” and requires variants that “no template was designed against.” This misses other benchmark-targeted aids, particularly 0195’s proposal that “the benchmark lanes’ apps are strong candidates” for public examples. An exact solution exposed as an example, recipe, or skill can create the same assistance and benchmark contamination without triggering rule 4a. Resolving change: extend assisted labeling, starter symmetry, split reporting, and held-out eligibility to all vendor-authored benchmark-targeted artifacts, not only templates.

3. [MATERIAL] [IN-DELTA] 0197 — “What publishing looks like.” The proposed “historical series chart … exempt from rule 1” would display single-run cross-vendor figures such as “26m03s-vs-11m15s,” despite the Summary stating that the series “is not itself a publishable controlled comparison.” A comparative chart communicates the comparison even when labeled narrative, creating a direct exemption from the standard’s central N≥3 rule. Resolving change: either omit cross-vendor numbers/ratios from the exempt historical presentation or subject that chart to the publication standard; retain the old observations only in linked records or non-comparative program history.

0193: READY  
0194: NOT READY — blocking: 1  
0195: READY  
0196: READY  
0197: NOT READY — blocking: 2, 3

SET: NOT READY
tokens used
34,770
1. [MATERIAL] [IN-DELTA] 0194 — “What this kills” / OQ2. The kills list says, “Contingent on OQ2’s declaration files landing: `ctx.db` verbs … and the verify-config contract,” but OQ2 proposes a declaration file only for `ctx`. The RFC therefore has no decision or dependency capable of bringing verify-config into the generated reference. Resolving change: add an explicit machine-readable declaration source and decision path for verify-config, or remove it from the OQ2-contingent kills.

2. [MATERIAL] [IN-DELTA] 0197 — “The standard,” rule 4a. The protection applies only “where a Snapback lane uses a shipped template” and requires variants that “no template was designed against.” This misses other benchmark-targeted aids, particularly 0195’s proposal that “the benchmark lanes’ apps are strong candidates” for public examples. An exact solution exposed as an example, recipe, or skill can create the same assistance and benchmark contamination without triggering rule 4a. Resolving change: extend assisted labeling, starter symmetry, split reporting, and held-out eligibility to all vendor-authored benchmark-targeted artifacts, not only templates.

3. [MATERIAL] [IN-DELTA] 0197 — “What publishing looks like.” The proposed “historical series chart … exempt from rule 1” would display single-run cross-vendor figures such as “26m03s-vs-11m15s,” despite the Summary stating that the series “is not itself a publishable controlled comparison.” A comparative chart communicates the comparison even when labeled narrative, creating a direct exemption from the standard’s central N≥3 rule. Resolving change: either omit cross-vendor numbers/ratios from the exempt historical presentation or subject that chart to the publication standard; retain the old observations only in linked records or non-comparative program history.

0193: READY  
0194: NOT READY — blocking: 1  
0195: READY  
0196: READY  
0197: NOT READY — blocking: 2, 3

SET: NOT READY

## Round 4 — 2026-08-08 (gpt-5 family, delta round)

Provenance: codex exec, gpt-5.6-sol, xhigh, capsule sr-capsule-r4,
targets at 68da5ad37. One launch. Verbatim body follows.

Reading additional input from stdin...
OpenAI Codex v0.147.0
--------
workdir: /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR]
reasoning effort: xhigh
reasoning summaries: none
session id: 019fe222-d77c-7d31-b904-307cef852b59
--------
user
You are an independent LLP reviewer. Read CONTEXT.md then all five LLP documents (0193-0197) in the current directory, in full. This is a FOURTH-round delta review; the r4 delta (everything else is previously-reviewed pre-existing text) is exactly: 0194 — OQ2 names declaration sources for BOTH contingent surfaces (ctx declaration file AND a verify-config types/schema export) and Design 5 orders them immediately after the initial scope; 0197 — rule 4a widened from templates to ALL vendor-authored benchmark-targeted aids (incl. published example apps, recipes, skill content), rule 4b adds per-lane success counts on the ratio chart itself, the history narrative in 'What publishing looks like' now contains NO cross-vendor numbers or ratios (prose + links only), Related enumerates diaries with slug disambiguation; 0193 — colliding diary-number citations gained filename slugs; 0196 — the motivating N=1 step gained an inline variance caveat; all five gained an r4 Revised entry.

Review the full documents for MATERIAL concerns (correctness, coherence, feasibility, safety, decision-quality; altitude rule — detail-only demands identifying no defective decision are implementation-phase notes). Classify every concern IN-DELTA vs PRE-EXISTING.

FORMAT: 1) numbered concerns labeled [MATERIAL]/[minor] and [IN-DELTA]/[PRE-EXISTING] with document+section+quote+resolving change; 2) per-target verdict lines '0193: READY'/'0193: NOT READY — blocking: <numbers>' for all five; 3) one 'SET: READY'/'SET: NOT READY' line. You are the only reviewer; do not reference other reviews; do not rewrite the documents.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
2026-08-08T16:09:22.637752Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server linear: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
codex
I’m using the LLP review guidance because this is a formal delta review. I’ll first load its instructions, then read `CONTEXT.md` followed by LLPs 0193–0197 in full, and report only decision-relevant concerns in your exact format.
exec
/bin/zsh -lc "pwd && rg --files -g 'AGENTS.md' -g 'CONTEXT.md' -g '*0193*' -g '*0194*' -g '*0195*' -g '*0196*' -g '*0197*' && sed -n '1,240p' /Users/ccheever/.codex/skills/llp/SKILL.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4
 succeeded in 0ms:
/private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4
0195-public-documentation-and-training-surface.rfc.md
0196-template-and-recipe-portfolio.plan.md
0194-generated-api-reference.rfc.md
0193-errors-as-docs-completeness.plan.md
CONTEXT.md
0197-benchmark-publication-standard.rfc.md
---
name: llp
description: Create, review, and list Exact LLP documents in the Exact repository. Use when Codex is asked to work with `/llp`, `$llp`, LLP proposals, LLP reviews, LLP numbering, or files under `llp/`.
---

# llp

Use this skill for Exact's LLP document workflow. Prefer LLP terminology:
"LLP document" for the general case, "RFC" only when the document type is
actually RFC, and `# LLP NNNN: Title` for new numbered documents.

## Ground Rules

- Work from the repository root when possible.
- Search `llp/` when numbering or locating LLP documents.
- Keep documents in `llp/`.
- Numbered filenames are `NNNN-slug.type.md`, for example
  `0042-video-component.rfc.md`.
- New proposal documents default to `Type: RFC`.
- Required metadata for new documents: `Type`, `Status`, `Systems`, `Author`,
  `Date`, `Revised`, and `Related`.
- Valid proposal statuses for `RFC`, `Spec`, and `Plan`: `Draft`, `Review`,
  `Accepted`, `Implemented`, `Superseded`, `Shelved`, and `Withdrawn`.
- Normalize statuses when matching by stripping ` vN`, stripping trailing
  parenthetical notes, and comparing case-insensitively.
- Do not accept or reject LLP documents on the user's behalf.
- Do not renumber existing unnumbered documents unless the user is actively
  updating one.

## Create

For `/llp create <title> [--type <type>]`:

1. Scan existing numbered LLP files in `llp/`.
2. Pick the next number.
3. Build the slug: lowercase, replace non-alphanumerics with `-`, collapse
   repeated `-`, and trim edge `-`.
4. Create `llp/NNNN-slug.type.md` with this scaffold, using the requested type
   or defaulting to `RFC` and `.rfc.md`:

```markdown
# LLP NNNN: <Title>

**Type:** RFC
**Status:** Draft
**Systems:** TBD
**Author:** Charlie Cheever / Codex
**Date:** YYYY-MM-DD
**Revised:** YYYY-MM-DD
**Related:**

## Summary

## Design
```

5. Help draft the document from the current conversation context.

## Review

For `/llp review <identifier>`:

- The identifier may be a number like `0036`, a slug like
  `intent-level-authoring`, or omitted. If omitted, list Draft/Review
  documents and ask which one.
- Locate the document in `llp/` and read the full file.
- Review it using this prompt:

```text
What do you think of this proposal? Is it a good idea? Do we have a good plan here? How would you change it to make it better? What would you add or take away or change? Is anything definitely or possibly wrongheaded here? Do you have any novel ideas that you think might make this way better even if they are a bit non-standard? What are the key open questions we need to answer to refine this?
```

- Present findings first: overall assessment, strengths, concerns,
  suggestions, and open questions.
- Save the review artifact under
  `notes-archive/ai-reviews/{slug}.round-{N}.AGENTS.md`.
- Derive `{slug}` by stripping the leading `NNNN-` and trailing `.type.md`.
- Increment `{N}` based on existing `*.AGENTS.md` review files.
- If the document is still `Draft`, suggest updating it to `Review` after the
  review.
- Remind the user that the LLP process also recommends a GPT review unless
  this Codex review is the GPT review they wanted.

## List

For `/llp list [status]`:

1. Scan `llp/`.
2. Extract and normalize `**Status:**`.
3. Group documents by normalized status.
4. Sort numbered documents ascending, then unnumbered documents alphabetically.
5. If a status filter was provided, show only that group.

Render numbered documents as:

```text
0038  exact-inspect-skill
0039  rfc-skill
----  unnumbered-rfc
```

exec
/bin/zsh -lc "rg --files -uu | rg '("'^|/)AGENTS'"\\.md"'$'"' || true
wc -l -c CONTEXT.md 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md
sed -n '1,260p' CONTEXT.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4
 succeeded in 0ms:
      35    2168 CONTEXT.md
     104    5643 0193-errors-as-docs-completeness.plan.md
      96    5829 0194-generated-api-reference.rfc.md
      91    5178 0195-public-documentation-and-training-surface.rfc.md
      95    5384 0196-template-and-recipe-portfolio.plan.md
     129    7788 0197-benchmark-publication-standard.rfc.md
     550   31990 total
# Context sheet (facts only; for reviewing the five-document set)

Snapback is a local-first backend framework: declarative schema/functions
with codegen, live queries, ephemeral state, typed assets, sessions auth,
React/Expo/headless clients, a Rust runtime shipped as prebuilt npm
binaries. Its docs are an in-repo "guide" (CI-verified snippets,
capability index with explicit GAP rows, version fences against the
published npm closure) served by running servers at /_snapback/guide and
an embedded `snapback guide` search; there is currently no public web
documentation. Packages @expo/snapback-* are on npm at 0.1.15 (eleven
packages incl. create-snapback-app). An agent skill (snapback-authoring)
ships inside scaffolded apps. A committed benchmark harness exists under
benchmarks/ (briefs, lane prompt templates, run-record schema, fairness
rules) from LLP 0186 W1.

Measurement facts cited by the documents (five serial cold-agent runs,
same brief/machine/model, token-metered): wall/tokens for the
Snapback-with-skill lane vs a Convex lane moved 26m22s/329k vs
16m36s/113k (npm 0.1.13) to 19m00s/201k vs 10m18s/90k (npm 0.1.15);
observed per-lane run-to-run variance ±30% at N=1; latest run had zero
framework-caused defects in any Snapback lane; remaining friction was
knowledge-shaped (signature/contract questions resolved by reading
package source; one case by extracting strings from the runtime binary).
Convex lanes across all runs consumed no documentation (prior model
familiarity). Diaries 0058, 0065, 0066, 0068, 0069 record the runs.
Existing related LLPs: 0186 (agent authoring efficiency program: W0
plumbing fixes shipped; W1 benchmark harness; W2 skill/scaffolds; W3
errors bar; W4 edit-loop taxes), 0146 (agent affordances; D7 = typed
remediations carried by refusals, ratified, enforcement carrier not yet
built), 0061 (guide design, intent-indexed), 0041 (packaging/releases).
A diagnostic-inventory drift gate exists in CI (production diagnostic
codes are classified; new unclassified codes fail).

Additional retained fact for this round: diary 0058 records the first
run (in-checkout, Codex-model era): Snapback 26m03s vs Convex 11m15s.

codex
The context establishes that the remaining benchmark gap is primarily knowledge-shaped, with meaningful N=1 variance and no framework-caused defects in the latest run. I’m now checking every proposal end-to-end, including cross-document dependencies and whether the r4 edits actually close the named ambiguities.
exec
/bin/zsh -lc 'for f in 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md; do
  echo "===== $f ====="
  sed -n '"'1,240p' \""'$f"
done' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4
 succeeded in 0ms:
===== 0193-errors-as-docs-completeness.plan.md =====
# LLP 0193: Errors-as-docs completeness program

**Type:** Plan
**Status:** Review
**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
diaries 0065/0066/0068/0069

## Summary

Across the retained measurement series, refusal-quality incidents
resolved fastest when the refusal named its own fix — diary 0048's (`0048-upload-bakeoff-faceplate`)
`SNAPBACK_ASSET_IMAGE_DECODE_FAILED` carrying the exact upstream parser
error, and the anonymous-upload refusal naming `snapback assets put
--user` (diary 0065's tickets) are retained exemplars — while several of
the expensive detours trace to refusals that carried neither rule nor
fix. (Additional unretained lane-report incidents exist but are not
cited as evidence here.) LLP 0186 W3 states the
bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
the violated rule and either the fix or a resolving guide anchor** — but
the bar has only ever been applied to codes that happened to appear in
diaries. This Plan audits the entire population once and then makes the
bar structural, so it can never regress.

## Evidence

- Diary 0069: zero framework defects, yet the run's expensive moments
  were knowledge-shaped — several reachable from a refusal that could
  have carried the answer.
- The retained record shows the mechanism in both directions: refusals
  that named remediations (`snapback assets put --user`, diary 0048's
  decode diagnostic, the seed-recovery messages) cost near-zero;
  refusals that did not each cost a bisection session — diary 0058's (`0058-relay-room-expo-backend-bakeoff`)
  "host-ops error response was not JSON" (in-checkout era;
  `issues/closed/20260805-managed-dev-multi-json-load.md`) and the
  SHA-256-hashed field path
  (`issues/closed/20260805-result-contract-violation-hashes-field-path.md`).
- The infrastructure half-exists: stable code registry, the
  production diagnostic-inventory drift gate, and 0146 D7 ratified as
  the remediation carrier.

## Program

**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
code inventory (a raw identifier sweep finds ~2,700 `SNAPBACK_*` symbols
including env vars and test constants; the diagnostic subset is the
real population and Phase 1 establishes its size) from the diagnostic registry
plus a grep sweep for unregistered emissions. Fan out grading lanes:
each code graded A (names rule + fix/anchor), B (names rule only), or
C (bare), with the emitting site and agent-triggerability recorded.
Output: a checked-in graded ledger under `tests/acceptance/diagnostics/`.

**Phase 2 — fix in evidence order.** First: every B/C code that appears
in any diary's correction-loop list. Then B/C codes on
agent-triggerable paths, batched by subsystem. Message edits follow the
house style; guide anchors must resolve (check-guide enforces). Codes
that are genuinely internal (never agent-triggerable) are marked so in
the ledger rather than polished.

**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
a new agent-triggerable code cannot land without a remediation in the
carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
floor. The typed-remediation end state is 0146's ratified D7 and is not
reopened here; the carrier choice is OQ6's open ruling
(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
named dependency of this phase's structured half — until it rules, the
gate enforces text+anchor as a bounded interim floor, upgraded
code-by-code as the carrier lands. Anchor
resolution joins CI. The graded ledger becomes the gate's baseline;
grade regressions fail.

**Phase 4 — close the loop with measurement.** The next benchmark run's
lane reports grade every refusal encountered; new B/C sightings are the
recurring audit input.

## Exit criteria

1. Graded ledger covers 100% of registered codes; zero ungraded
   emissions in the sweep.
2. **Every ledger entry classified agent-triggerable is grade A** (the
   program's declared bar; diary-cited codes are merely the first
   batch).
3. The drift gate refuses a new agent-triggerable code without
   remediation/anchor (negative test), and refuses grade regressions.
4. A benchmark run encounters zero B- or C-grade refusals — as
   validation of criterion 2, not a substitute for it.

## Open questions

- OQ1: The migration bound — how long audited legacy codes may remain
  on the text+anchor floor after the OQ6 carrier ruling lands. Proposal:
  structured on next touch, with a dated full-migration milestone set
  when the carrier ships (the typed end state itself is settled by
  0146's ratified D7, not by this Plan).
- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
  from any published-surface operation, decided by the grading lane,
  spot-checked in review.
===== 0194-generated-api-reference.rfc.md =====
# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Review
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration, OQ2-contingency marking). 2026-08-08 (r2) — r2 also resolves the OQ2 hand-written-interim contradiction (named exclusion until a declaration file lands). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0061 (guide design — intent-indexed by choice), LLP 0186
(measurement evidence), diaries 0068-0069

## Summary

Across five measurement runs, every remaining package-source excursion
shares one shape: a **signature or contract question** — headless
`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
(extracted from runtime binary strings in run 5), the verify-config
contract, client constructor option pairs. The guide is deliberately
intent-indexed (LLP 0061) and should stay that way; what is missing is
the complementary layer: a **complete, generated, build-bound API
reference** derived from the packages' own `.d.mts` declarations — the
types agents consistently praise — so that no signature question ever
requires opening `node_modules`.

## Design

1. **Source of truth:** the published packages' `.d.mts` files plus doc
   comments. No hand-written reference pages — generation only, so it
   cannot drift (the closure-drift lesson, LLP 0186 W0).
2. **Generation:** a build step (TypeScript compiler API, the
   export-parity test's traversal as the seed) emitting one markdown
   page per package under `guide/reference/<package>.md`, with stable
   per-symbol anchors. Runs in the same pipeline as
   `generate-guide-manifest`; output is committed generated artifact,
   checked like the flat guide.
3. **Serving:** joins the guide manifest — served at
   `/_snapback/guide/reference/...`, indexed by
   `snapback guide <query>` and the MCP resources, listed in
   `/llms.txt`. Build-bound headers like every guide response.
4. **Joins:** intent pages link into reference anchors ("full signature:
   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
   may cite reference anchors as their fix pointer.
5. **Scope and completeness rule:** the reference includes exactly the
   surfaces that have machine-readable declaration sources, and its
   completeness claim is scoped to that set. Order:
   `@expo/snapback-client` (headless surface — the largest excursion
   source), `snapback-react` hooks and fact types, `snapback-expo`.
   The `ctx` handler surface and the CLI verify/config contracts have
   no declaration source today; they JOIN the reference when their
   declaration sources land (OQ2 proposes both: a `ctx` declaration
   file and a verify-config types/schema export) and are ordered
   immediately after the initial package scope — until then they are
   named exclusions, not hand-written pages, so the no-hand-written
   rule and the completeness claim stay true together.

## What this kills

Retained-record attributions: headless args nesting (diary 0069 residue
3), `createAssetClient` root-export discovery (diary 0068), the sessions
client-construction option pair (0068 residue 4, hit by two lanes) —
all in the initial declaration-sourced scope. Contingent on OQ2's
declaration files landing: `ctx.db` verbs via binary strings (0069
residue 2) and the verify-config contract (0068 and 0069 residue 5) —
the two most expensive named excursions sit behind that exclusion,
which is the strongest argument for scheduling OQ2 early. Diary 0069 calls orientation "the
dominant term" in the remaining gap; the signature-shaped items above
are the subset of its residue list this RFC removes. (No quantitative
fraction is claimed; the diaries do not decompose the bucket.)

## Open questions

- OQ1: Page granularity, size budgets, and the flat-projection
  interaction — the flat guide is already past its one-request size
  premise (`issues/20260806-guide-flat-projection-oversize.md`); the
  reference is therefore EXCLUDED from `flat.md` unless that ticket's
  diet/tier design lands first, and per-module splitting rules are
  needed regardless.
- OQ2: Declaration sources for the two contingent surfaces. The `ctx`
  handler surface (db verbs, assets, refuse) joins only via a published
  declaration file (which also gives consumers editor types); the
  verify-config contract joins only via a published machine-readable
  source (a types export or schema from `@expo/snapback-cli`'s verify
  module). No hand-written interim sections: until each source lands,
  its surface remains a named exclusion per Design 5, documented in the
  intent guide as today. The two most expensive measured excursions sit
  behind these exclusions, so Design 5 orders them immediately after
  the initial package scope rather than leaving them unscheduled.
- OQ3: Whether doc comments in `.d.mts` are complete enough to render
  useful prose, and whether improving them (which rotates artifact
  identity — the doc-comment lesson) batches with releases.
- OQ4: Versioning — the reference is inherently build-bound (served),
  which is correct; whether the public docs surface (LLP 0195) pins
  per-release snapshots is that RFC's question.
===== 0195-public-documentation-and-training-surface.rfc.md =====
# LLP 0195: Public documentation, examples, and training-data surface

**Type:** RFC
**Status:** Review
**Systems:** Documentation, Publishing, Guide, Templates, Competitive
evaluation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (the orientation-gap evidence), LLP 0061 (guide),
LLP 0041 (packaging), diaries 0065/0066/0068/0069

## Summary

Snapback currently has **no public documentation surface**. The guide
exists only in this repository and served from installed binaries: an
agent cannot read a word of it before installing, search engines and
training pipelines never see it, and `llms.txt` exists only on loopback
origins. Meanwhile the measurement series calls orientation cost "the dominant
term" in the remaining efficiency gap (diary 0069) — cost the Convex
lanes did not pay: across all five runs they consumed no documentation
at all, working from prior model familiarity. A public surface is the pre-install orientation fix and the
discoverability fix on its face; that it also feeds future model
training is a plausible but **unverified hypothesis** — prior
familiarity is measured, its provenance is not. The decision case rests
on discoverability and retrieval; the training effect, if real, is
upside this RFC proposes to instrument rather than assume (OQ4). It
remains the largest unstarted item this program has identified. It is proposed here rather than executed because publishing
is the author's decision.

## Proposal

1. **Public docs site, generated from `guide/`.** The corpus is already
   CI-verified, version-fenced (`published-closure.json` + `since:`
   machinery), and honest by construction (GAP rows). A static site
   generator over `guide/` — same markdown, same snippets, the 0194
   reference included — published on a real domain, with `/llms.txt` at
   the root and per-release snapshots pinned to published closures (the
   fence machinery already knows what each closure contains). The
   in-repo/served guide remains canonical; the site is a projection with
   the same content hashes.
2. **Public examples repository**, mirroring the template outputs and
   selected demo apps (the benchmark lanes' apps are strong candidates:
   complete, proof-carrying, honestly scoped). Each example pinned to a
   closure version and CI-cold-installed against the registry — the
   examples repo doubles as an external consumer canary.
3. **Skill distribution beyond scaffolds:** publish
   `snapback-authoring` wherever agent harnesses discover skills, so
   pre-scaffold orientation exists off-checkout.
4. **Deliberate training-data posture (hypothesis, instrumented):**
   write the site, examples, README funnels, and packages with a
   future-model audience in mind (stable vocabulary, Rosetta aliases,
   canonical snippets). Whether the moat actually erodes is testable
   but confounded — skills, templates, and error improvements also cut
   orientation cost — so the posture claims no timeline; OQ4 sketches
   the pinned-model knowledge evaluation that could isolate the
   training effect if it becomes worth measuring.

## What this does not claim

No hosted-service claims change; the site documents the local-first
surface the capability index already asserts, GAP rows included. The
honesty discipline that survived four published-consumer audits
(diaries 0065/0066/0068/0069; the 0058 run was in-checkout) is the asset being
published, not marketing copy.

## Author decisions required

- D1: Publish at all, and where (domain; whether the repo itself goes
  public or only generated projections).
- D2: Examples licensing and repo location.
- D3: Snapshot policy (per-release docs versions vs latest-only).
- D4: Whether benchmark artifacts (briefs, records) belong on the public
  site — interacts with LLP 0197's publication standard.

## Open questions

- OQ1: Site generator and hosting (the repo has EAS/Cloudflare lanes;
  either works — pick for boring reliability).
- OQ2: How the site's `llms.txt` and sitemap best serve crawler and
  agent retrieval (the served-guide retrieval-eval corpus can be reused
  as the site's acceptance test).
- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
  public anchors, unifying citations across surfaces.
- OQ4: The pinned-model knowledge evaluation — a fixed question set
  about Snapback answered by pinned model builds over time, isolating
  training-data presence from in-context aids; only worth building if
  the training hypothesis starts driving decisions.
===== 0196-template-and-recipe-portfolio.plan.md =====
# LLP 0196: Template and recipe portfolio

**Type:** Plan
**Status:** Review
**Systems:** Templates, CLI, Guide, Testing, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain: capability-surface wording, T5 two-gate split, template-assisted labeling + held-out-brief rule. 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W2), LLP 0195 (public examples mirror), diaries
0068-0069, benchmarks/briefs/

## Summary

The measurement diaries repeatedly rank knowledge placement:
**scaffold beats guide beats package source** (every lane's
knowledge-source ladder ends in package source; the scaffold is
unanimously the cheapest). Knowledge moved into template defaults
(0.1.15's sessions mode, offline registration, upload wiring) produced
the largest improvement of any release whose changes were
knowledge-placement rather than defect fixes — bare lane 41m32s→29m35s
(diaries 0068/0069 — a single N=1 step inside the series' demonstrated
±30% variance, used here as plan motivation, not as a publishable
claim; the larger 80m→41m step at 0.1.13 came from the seven-defect
fix layer, a different mechanism). This Plan extends the portfolio
along the measured demand: two new templates exercising the capability
surfaces of the committed benchmark briefs, proof machinery registered by default, and the recipe
list the diaries priced.

## Program

**T1 — CRUD-dashboard template** (`--template crud-dashboard`),
exercising the same capability surface as `benchmarks/briefs/crud.md`
(not authored against the brief document): tables/list/detail/edit shapes, relational
query profile in the default path, sessions default, acceptance suite +
**registered verify profile** included. Most agent tasks are CRUD-shaped;
this becomes the default recommendation for generic briefs.

**T2 — media-feed template** (`--template media-feed`), exercising the
same capability surface as `briefs/media.md`: typed upload intents with renditions in the main
path, delivery-profile selection demonstrated (the strict-vs-public
lesson), infinite-scroll list over retained queries.

**T3 — proof-by-default across all templates:** every template ships a
registered `snapback.verify.config.mjs` (run-5's skill lane registered
profiles by hand; the done-oracle should be non-vacuous from scaffold),
and the expo templates ship web platform + deps (the two-run web-deps
papercut, ticketed 2026-08-08 — absorbed here).

**T4 — recipes** (guide sections with CI-verified snippets, in priority
order from run evidence): the headless-simulator proof kit (plistlib
scheme approval, Expo Go onboarding dismissal, drive-channel pattern —
ticketed), real-auth sign-in flows beyond test personas, the offline
supervisor-origin recipe (ticketed), verify-config authoring (ticketed).
Recipes graduate into template code where a template naturally exercises
them — the ladder says code placement beats prose.

**T5 — template freshness, two gates:** (a) pre-release and blocking:
templates cold-install and pass their suites against the exact
*candidate staged tarballs* during release qualification, so a release
cannot ship with a template failing against its own closure; (b)
post-release canary: the same suites re-run against the *published*
registry closure, alerting (not blocking) on drift the staging
environment cannot see, with the release owner holding
rollback/fix-forward escalation. Neither alone suffices.

## Sequencing

T3 first (papercut absorption + verify-by-default — small), then T1
(benchmark brief pairing makes it immediately measurable), T2, with T4
recipes landing alongside whichever surface they document. T5 joins the
release checklist when T1 lands.

## Exit criteria

- A cold agent given a CRUD or media brief scaffolds the matching
  template and reaches all proofs with zero template-gap loops.
- `snapback verify` is non-vacuous on every fresh scaffold.
- The next benchmark run on the CRUD brief uses T1 with no template-gap
  loops — measured and labeled as a **template-assisted scenario**.
  Templates deliberately cover benchmark-brief capability surfaces, so
  template-assisted results are never published as general
  authoring-efficiency claims: portfolio-level claims require success
  on a held-out brief variant not used to design any template, and
  competitor lanes get a symmetric starter-availability policy
  (LLP 0197 rules 4a/4b govern).

## Open questions

- OQ1: Template count discipline — the portfolio should stay small
  (three app templates + recipes); additions require a measured brief.
- OQ2: Whether `create-snapback-app` grows an interactive template
  picker or stays flag-driven (agents prefer flags; humans may not).
===== 0197-benchmark-publication-standard.rfc.md =====
# LLP 0197: Competitive benchmark publication standard

**Type:** RFC
**Status:** Review
**Systems:** Competitive evaluation, Publishing, Documentation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain, plus round-2 finds: preregistration in rule 1, rules 4a/4b, publication-safe schema in rule 6, reproducibility manifest, diary-0058 citation, series restated 2.91x→2.24x. 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
(harness, records), LLP 0195 (public surface), diaries
0058/0065/0066/0068/0069 (measurement runs; 0058 by filename
`0058-relay-room-expo-backend-bakeoff`, a colliding number exists)

## Summary

The measurement program can now produce the raw material for
publication — five runs, a committed harness, token metering, and a
directional series (2.91x tokens for the first published-consumer
skill-adjacent lane on 0.1.13 to 2.24x on 0.1.15; bases differ across
rows, the records themselves say the series is directional rather than
a controlled sequence, and diary 0069 disclaims N=1 ratio movement as
signal). The existing series motivates this standard; it is not itself
a publishable controlled comparison. LLP 0186 OQ5 asked what disclosure
makes a public comparison credible rather than vendor noise; this RFC
proposes the standard. The governing principle: **publish the
instrument, not just the number** — the methodology independently
rerunnable by an outsider from public artifacts alone, carried by a
reproducibility manifest per record (harness commit, prompts, model
identity/build and settings as run, closure and competitor versions,
tool versions, environment and machine class, stopping rules, seeds
where available). Where the measuring model is not publicly accessible,
the standard promises rerunnable methodology and comparable
measurement, not bit-identical results — stated on every chart;
"reproduced" is reserved for observed reruns.

## The standard

A published Snapback benchmark claim requires:

1. **N≥3 runs per configuration, preregistered:** the run matrix
   (configurations, budgets, stopping and exclusion rules, frozen
   harness/prompt commits) is committed before results are observed;
   every started attempt gets an ID and is reported — no best-of, no
   post-hoc configuration designation. Median + range. The observed
   ±30% per-lane variance (diary 0069) makes single-run ratios
   unpublishable; the variance study is the prerequisite work item.
2. **The full harness public:** briefs verbatim, lane prompts, fairness
   rules, and run records (the `benchmarks/` tree, published via LLP
   0195) — an outsider with the same model can rerun the measurement.
3. **Fairness notes attached to every chart:** cold-context agents;
   published surfaces only; same model, machine, and serial discipline;
   competitor lanes free to use web docs; model prior-familiarity
   asymmetry stated plainly (it currently favors competitors).
4. **Proof-bar disclosure:** every chart states what each lane proved.
   The headline chart should be the **equal-proof-bar variant**
   (`briefs/messaging-equal-proof-bar.md`), with the bar stated as
   vendor-neutral outcomes (e.g. "cold-start reads of prior history
   with the backend unreachable"), not feature names — the honest
   comparison where depth is priced instead of penalized. The
   unequal-bar table may be published alongside with the asymmetry
   stated (competitor lanes' own-words caveats quoted, not
   paraphrased).
   4a. **Aid symmetry (all vendor-authored benchmark-targeted
   artifacts):** the rule covers every vendor-authored aid a lane can
   reach — templates, published example apps (including any benchmark
   lane apps LLP 0195 publishes), recipes, and skill content — not
   templates alone. Where a Snapback lane uses any such aid, the
   scenario is labeled aid-assisted; competitor lanes get the same
   predeclared public-availability and selection criteria for their
   ecosystems' aids; general authoring-efficiency claims use held-out
   brief variants no vendor-authored aid was designed against
   (LLP 0196's exit criteria adopt this); where no equivalent aid
   exists, aid-assisted and bare-start configurations publish
   separately.
   4b. **Equal-proof-bar failure protocol (preregistered):** identical
   budgets and stopping rules per lane; every failed attempt retained
   and reported as a capability failure — never converted to a timeout
   duration, silently excluded, or substituted with a weaker result;
   efficiency ratios computed only across runs meeting the identical
   bar, with the capability-failure table published beside them and
   per-lane success counts stated on the ratio chart itself.
5. **Version pinning:** every run names the exact closure and
   competitor versions; claims age out when either moves materially.
6. **Self-report symmetry, publication-safe:** lane reports and
   correction-loop content (both vendors') are part of the public
   record — including runs unfavorable to Snapback; the credibility of
   the five-measurement-run, four-published-consumer-audit honesty
   discipline is the asset. Publication passes through a
   **publication-safe artifact schema**: a symmetric public projection
   preserving prompts, measurements, outcomes, proof evidence, and
   correction-loop categories; automated secret/credential/PII and
   private-material scanning; path and machine-identifier scrubbing
   with documented redactions and reason codes; retained hashes of the
   private originals for auditability; and a human with
   repository-disclosure authority reviewing before anything ships.
   Raw transcripts never publish.

## What publishing looks like

A benchmarks page on the LLP 0195 site: a program-history narrative
that contains NO cross-vendor numbers or ratios — the single-run era
(including the losing origin run, diary 0058) is told as dated prose
with links to the raw records, because a comparative chart communicates
a comparison whatever its label; the current N≥3 medians as the only
comparative presentation; links to briefs/records/prompts; a "run it
yourself" section stating expected run cost; and the reproducibility
manifest per record. No superlatives that a record link cannot back.

## Author decisions required

- D1: Whether to publish at all and when (proposal: after the N≥3
  study and the equal-proof-bar run, not before).
- D2: Which competitors appear (Convex is measured; Supabase/
  PocketBase/Postgres lanes are unbuilt — publishing claims about
  unmeasured competitors is out under this standard).
- D3: Whether competitor names appear in charts or as "backend A/B"
  (proposal: names, with rule 2's reproducibility as the defense).

## Open questions

- OQ1: Token-count comparability across models if the harness ever runs
  on non-Fable models (current standard: one model per published
  series, stated).
- OQ2: Whether an independent third party rerunning the harness is
  worth soliciting before first publication (strongest possible
  credibility; costs a relationship and time).

codex
1. [MATERIAL] [IN-DELTA] — **0194, Design 1 / Design 5 / OQ2.** Design 1 fixes the source of truth as “the published packages’ `.d.mts` files plus doc comments,” while OQ2 permits verify-config to join through “a types export or schema.” A runtime or JSON-schema export is not necessarily represented sufficiently in `.d.mts` or traversable by the proposed TypeScript-based generator, leaving the authoritative-source and completeness rules contradictory for a priority surface. **Resolving change:** either broaden Design 1 and the generation rule to explicitly support version-bound schema exports, or require verify-config to expose a declaration-file/type source.

2. [MATERIAL] [PRE-EXISTING] — **0197, rules 1 and 4b.** Rule 1 says single-run ratios are unpublishable and requires “N≥3 runs per configuration,” but rule 4b permits efficiency ratios across successful runs without a minimum successful sample. A lane succeeding once in three attempts could therefore produce an effectively N=1 ratio; adding success counts to the chart discloses but does not cure that contradiction. **Resolving change:** preregister a variance-calibrated minimum number of successful observations per lane for any ratio, and require omission of the ratio—publishing only capability outcomes—when either lane misses that threshold.

0193: READY  
0194: NOT READY — blocking: 1  
0195: READY  
0196: READY  
0197: NOT READY — blocking: 2  

SET: NOT READY
tokens used
34,353
1. [MATERIAL] [IN-DELTA] — **0194, Design 1 / Design 5 / OQ2.** Design 1 fixes the source of truth as “the published packages’ `.d.mts` files plus doc comments,” while OQ2 permits verify-config to join through “a types export or schema.” A runtime or JSON-schema export is not necessarily represented sufficiently in `.d.mts` or traversable by the proposed TypeScript-based generator, leaving the authoritative-source and completeness rules contradictory for a priority surface. **Resolving change:** either broaden Design 1 and the generation rule to explicitly support version-bound schema exports, or require verify-config to expose a declaration-file/type source.

2. [MATERIAL] [PRE-EXISTING] — **0197, rules 1 and 4b.** Rule 1 says single-run ratios are unpublishable and requires “N≥3 runs per configuration,” but rule 4b permits efficiency ratios across successful runs without a minimum successful sample. A lane succeeding once in three attempts could therefore produce an effectively N=1 ratio; adding success counts to the chart discloses but does not cure that contradiction. **Resolving change:** preregister a variance-calibrated minimum number of successful observations per lane for any ratio, and require omission of the ratio—publishing only capability outcomes—when either lane misses that threshold.

0193: READY  
0194: NOT READY — blocking: 1  
0195: READY  
0196: READY  
0197: NOT READY — blocking: 2  

SET: NOT READY

## Round 5 — 2026-08-08 (gpt-5 family, delta round)

Provenance: codex exec, gpt-5.6-sol, xhigh, capsule sr-capsule-r5,
targets at 567fab93b. One launch. Verbatim body follows.

Reading additional input from stdin...
OpenAI Codex v0.147.0
--------
workdir: /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR]
reasoning effort: xhigh
reasoning summaries: none
session id: 019fe22b-19b5-7da1-8b3d-c9dfffee4c96
--------
user
You are an independent LLP reviewer. Read CONTEXT.md then all five LLP documents (0193-0197) in the current directory, in full. This is a FIFTH-round delta review; the r5 delta (everything else is previously-reviewed pre-existing text) is exactly: 0194 — verify-config moved into the INITIAL reference scope (its published declaration source @expo/snapback-cli/verify → verify.d.mts already exists, landed 2026-08-04); OQ2 narrowed to the ctx declaration file only; kills list updated accordingly. 0197 — rule 4b gains a ratio floor (preregistered minimum N>=3 successful observations per lane; ratio omitted and the capability-outcome comparison becomes the headline when either lane misses the floor or success counts differ beyond the preregistered threshold). 0193 — the assets-put-user exemplar honestly relabeled as the retrofitted A-grade case (ticket-cited, 0058-era) vs diary 0048's observed exemplar; Phase 3 gains reclassification gating; 0065 citation slug. 0195 — 0065 citation slug only. 0196 — no body change. Per-document r5 Revised entries.

Review the full documents for MATERIAL concerns (correctness, coherence, feasibility, safety, decision-quality; altitude rule — detail-only demands identifying no defective decision are implementation-phase notes). Classify every concern IN-DELTA vs PRE-EXISTING.

FORMAT: 1) numbered concerns labeled [MATERIAL]/[minor] and [IN-DELTA]/[PRE-EXISTING] with document+section+quote+resolving change; 2) per-target verdict lines '0193: READY'/'0193: NOT READY — blocking: <numbers>' for all five; 3) one 'SET: READY'/'SET: NOT READY' line. You are the only reviewer; do not reference other reviews; do not rewrite the documents.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
2026-08-08T16:18:24.060540Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server linear: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
codex
I’ll perform the fifth-round delta review exactly as scoped: read `CONTEXT.md` and LLPs 0193–0197 in full, verify the declared r5 changes against the surrounding decisions, then return only classified concerns and verdicts in the requested format. I’m using the `llp` skill because this is an LLP review task.
exec
/bin/zsh -lc 'cat /Users/ccheever/.codex/skills/llp/SKILL.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 succeeded in 0ms:
---
name: llp
description: Create, review, and list Exact LLP documents in the Exact repository. Use when Codex is asked to work with `/llp`, `$llp`, LLP proposals, LLP reviews, LLP numbering, or files under `llp/`.
---

# llp

Use this skill for Exact's LLP document workflow. Prefer LLP terminology:
"LLP document" for the general case, "RFC" only when the document type is
actually RFC, and `# LLP NNNN: Title` for new numbered documents.

## Ground Rules

- Work from the repository root when possible.
- Search `llp/` when numbering or locating LLP documents.
- Keep documents in `llp/`.
- Numbered filenames are `NNNN-slug.type.md`, for example
  `0042-video-component.rfc.md`.
- New proposal documents default to `Type: RFC`.
- Required metadata for new documents: `Type`, `Status`, `Systems`, `Author`,
  `Date`, `Revised`, and `Related`.
- Valid proposal statuses for `RFC`, `Spec`, and `Plan`: `Draft`, `Review`,
  `Accepted`, `Implemented`, `Superseded`, `Shelved`, and `Withdrawn`.
- Normalize statuses when matching by stripping ` vN`, stripping trailing
  parenthetical notes, and comparing case-insensitively.
- Do not accept or reject LLP documents on the user's behalf.
- Do not renumber existing unnumbered documents unless the user is actively
  updating one.

## Create

For `/llp create <title> [--type <type>]`:

1. Scan existing numbered LLP files in `llp/`.
2. Pick the next number.
3. Build the slug: lowercase, replace non-alphanumerics with `-`, collapse
   repeated `-`, and trim edge `-`.
4. Create `llp/NNNN-slug.type.md` with this scaffold, using the requested type
   or defaulting to `RFC` and `.rfc.md`:

```markdown
# LLP NNNN: <Title>

**Type:** RFC
**Status:** Draft
**Systems:** TBD
**Author:** Charlie Cheever / Codex
**Date:** YYYY-MM-DD
**Revised:** YYYY-MM-DD
**Related:**

## Summary

## Design
```

5. Help draft the document from the current conversation context.

## Review

For `/llp review <identifier>`:

- The identifier may be a number like `0036`, a slug like
  `intent-level-authoring`, or omitted. If omitted, list Draft/Review
  documents and ask which one.
- Locate the document in `llp/` and read the full file.
- Review it using this prompt:

```text
What do you think of this proposal? Is it a good idea? Do we have a good plan here? How would you change it to make it better? What would you add or take away or change? Is anything definitely or possibly wrongheaded here? Do you have any novel ideas that you think might make this way better even if they are a bit non-standard? What are the key open questions we need to answer to refine this?
```

- Present findings first: overall assessment, strengths, concerns,
  suggestions, and open questions.
- Save the review artifact under
  `notes-archive/ai-reviews/{slug}.round-{N}.AGENTS.md`.
- Derive `{slug}` by stripping the leading `NNNN-` and trailing `.type.md`.
- Increment `{N}` based on existing `*.AGENTS.md` review files.
- If the document is still `Draft`, suggest updating it to `Review` after the
  review.
- Remind the user that the LLP process also recommends a GPT review unless
  this Codex review is the GPT review they wanted.

## List

For `/llp list [status]`:

1. Scan `llp/`.
2. Extract and normalize `**Status:**`.
3. Group documents by normalized status.
4. Sort numbered documents ascending, then unnumbered documents alphabetically.
5. If a status filter was provided, show only that group.

Render numbered documents as:

```text
0038  exact-inspect-skill
0039  rfc-skill
----  unnumbered-rfc
```

exec
/bin/zsh -lc "pwd && rg --files -g 'CONTEXT.md' -g '*0193*' -g '*0194*' -g '*0195*' -g '*0196*' -g '*0197*' | sort" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 succeeded in 0ms:
/private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
0193-errors-as-docs-completeness.plan.md
0194-generated-api-reference.rfc.md
0195-public-documentation-and-training-surface.rfc.md
0196-template-and-recipe-portfolio.plan.md
0197-benchmark-publication-standard.rfc.md
CONTEXT.md

exec
/bin/zsh -lc 'wc -l CONTEXT.md 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 succeeded in 0ms:
      39 CONTEXT.md
     111 0193-errors-as-docs-completeness.plan.md
     100 0194-generated-api-reference.rfc.md
      91 0195-public-documentation-and-training-surface.rfc.md
      95 0196-template-and-recipe-portfolio.plan.md
     134 0197-benchmark-publication-standard.rfc.md
     570 total

exec
/bin/zsh -lc "sed -n '1,240p' 0194-generated-api-reference.rfc.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
exec
/bin/zsh -lc "sed -n '1,240p' CONTEXT.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 succeeded in 0ms:
# LLP 0194: Generated API reference surface

**Type:** RFC
**Status:** Review
**Systems:** Guide, Documentation, Client packages, Types, Build
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r5, this document: verify-config moved to the INITIAL scope — its verify.d.mts declaration source already exists and is published (round-4 find); OQ2 narrows to the ctx declaration file.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration, OQ2-contingency marking). 2026-08-08 (r2) — r2 also resolves the OQ2 hand-written-interim contradiction (named exclusion until a declaration file lands). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0061 (guide design — intent-indexed by choice), LLP 0186
(measurement evidence), diaries 0068-0069

## Summary

Across five measurement runs, every remaining package-source excursion
shares one shape: a **signature or contract question** — headless
`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
(extracted from runtime binary strings in run 5), the verify-config
contract, client constructor option pairs. The guide is deliberately
intent-indexed (LLP 0061) and should stay that way; what is missing is
the complementary layer: a **complete, generated, build-bound API
reference** derived from the packages' own `.d.mts` declarations — the
types agents consistently praise — so that no signature question ever
requires opening `node_modules`.

## Design

1. **Source of truth:** the published packages' `.d.mts` files plus doc
   comments. No hand-written reference pages — generation only, so it
   cannot drift (the closure-drift lesson, LLP 0186 W0).
2. **Generation:** a build step (TypeScript compiler API, the
   export-parity test's traversal as the seed) emitting one markdown
   page per package under `guide/reference/<package>.md`, with stable
   per-symbol anchors. Runs in the same pipeline as
   `generate-guide-manifest`; output is committed generated artifact,
   checked like the flat guide.
3. **Serving:** joins the guide manifest — served at
   `/_snapback/guide/reference/...`, indexed by
   `snapback guide <query>` and the MCP resources, listed in
   `/llms.txt`. Build-bound headers like every guide response.
4. **Joins:** intent pages link into reference anchors ("full signature:
   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
   may cite reference anchors as their fix pointer.
5. **Scope and completeness rule:** the reference includes exactly the
   surfaces that have machine-readable declaration sources, and its
   completeness claim is scoped to that set. Order:
   `@expo/snapback-client` (headless surface — the largest excursion
   source), `snapback-react` hooks and fact types, `snapback-expo`.
   The verify-config contract already has a published declaration
   source — `@expo/snapback-cli/verify` exports `verify.d.mts` with the
   full typed contract (landed 2026-08-04) — so it sits in the INITIAL
   scope; its measured excursions were a discoverability failure, not
   a missing source, which this reference and a guide anchor fix
   together. The `ctx` handler surface has no declaration source today;
   it JOINS the reference when its declaration file lands (OQ2),
   ordered immediately after the initial scope — until then it is a
   named exclusion, not a hand-written page, so the no-hand-written
   rule and the completeness claim stay true together.

## What this kills

Retained-record attributions: headless args nesting (diary 0069 residue
3), `createAssetClient` root-export discovery (diary 0068), the sessions
client-construction option pair (0068 residue 4, hit by two lanes) —
all in the initial declaration-sourced scope. In the initial scope
also: the verify-config contract (0068 and 0069 residue 5) — its
declaration source (`@expo/snapback-cli/verify` → `verify.d.mts`)
already exists and is published; the excursions were pure
discoverability. Contingent on OQ2's declaration file landing: `ctx.db`
verbs via binary strings (0069 residue 2) — the most expensive named
excursion sits behind that one exclusion, the strongest argument for
scheduling OQ2 early. Diary 0069 calls orientation "the
dominant term" in the remaining gap; the signature-shaped items above
are the subset of its residue list this RFC removes. (No quantitative
fraction is claimed; the diaries do not decompose the bucket.)

## Open questions

- OQ1: Page granularity, size budgets, and the flat-projection
  interaction — the flat guide is already past its one-request size
  premise (`issues/20260806-guide-flat-projection-oversize.md`); the
  reference is therefore EXCLUDED from `flat.md` unless that ticket's
  diet/tier design lands first, and per-module splitting rules are
  needed regardless.
- OQ2: The `ctx` declaration file — the one remaining surface without
  a machine-readable source. It joins only via a published declaration
  file (which also gives consumers editor types); no hand-written
  interim section — until it lands, `ctx` remains a named exclusion per
  Design 5, documented in the intent guide as today, ordered
  immediately after the initial scope. (Verify-config needs no OQ: its
  `verify.d.mts` export exists and is `.d.mts`-traversable by the
  Design-2 generator.)
- OQ3: Whether doc comments in `.d.mts` are complete enough to render
  useful prose, and whether improving them (which rotates artifact
  identity — the doc-comment lesson) batches with releases.
- OQ4: Versioning — the reference is inherently build-bound (served),
  which is correct; whether the public docs surface (LLP 0195) pins
  per-release snapshots is that RFC's question.

 succeeded in 0ms:
# Context sheet (facts only; for reviewing the five-document set)

Snapback is a local-first backend framework: declarative schema/functions
with codegen, live queries, ephemeral state, typed assets, sessions auth,
React/Expo/headless clients, a Rust runtime shipped as prebuilt npm
binaries. Its docs are an in-repo "guide" (CI-verified snippets,
capability index with explicit GAP rows, version fences against the
published npm closure) served by running servers at /_snapback/guide and
an embedded `snapback guide` search; there is currently no public web
documentation. Packages @expo/snapback-* are on npm at 0.1.15 (eleven
packages incl. create-snapback-app). An agent skill (snapback-authoring)
ships inside scaffolded apps. A committed benchmark harness exists under
benchmarks/ (briefs, lane prompt templates, run-record schema, fairness
rules) from LLP 0186 W1.

Measurement facts cited by the documents (five serial cold-agent runs,
same brief/machine/model, token-metered): wall/tokens for the
Snapback-with-skill lane vs a Convex lane moved 26m22s/329k vs
16m36s/113k (npm 0.1.13) to 19m00s/201k vs 10m18s/90k (npm 0.1.15);
observed per-lane run-to-run variance ±30% at N=1; latest run had zero
framework-caused defects in any Snapback lane; remaining friction was
knowledge-shaped (signature/contract questions resolved by reading
package source; one case by extracting strings from the runtime binary).
Convex lanes across all runs consumed no documentation (prior model
familiarity). Diaries 0058, 0065, 0066, 0068, 0069 record the runs.
Existing related LLPs: 0186 (agent authoring efficiency program: W0
plumbing fixes shipped; W1 benchmark harness; W2 skill/scaffolds; W3
errors bar; W4 edit-loop taxes), 0146 (agent affordances; D7 = typed
remediations carried by refusals, ratified, enforcement carrier not yet
built), 0061 (guide design, intent-indexed), 0041 (packaging/releases).
A diagnostic-inventory drift gate exists in CI (production diagnostic
codes are classified; new unclassified codes fail).

Additional retained fact for this round: diary 0058 records the first
run (in-checkout, Codex-model era): Snapback 26m03s vs Convex 11m15s.

Additional fact: packages/snapback-cli/verify.d.mts exists on main
(landed 2026-08-04) exporting the typed verify-config contract via the
package exports map ("./verify": types verify.d.mts).

exec
/bin/zsh -lc "sed -n '1,240p' 0193-errors-as-docs-completeness.plan.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 succeeded in 0ms:
# LLP 0193: Errors-as-docs completeness program

**Type:** Plan
**Status:** Review
**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r5, this document: exemplar reattributed (assets-put-user is the retrofit case, ticket-cited); reclassification gating in Phase 3; 0065 slug.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
diaries 0065 (`0065-rematch-published-closure-bakeoff`)/0066/0068/0069

## Summary

Across the retained measurement series, refusal-quality incidents
resolved fastest when the refusal named its own fix — diary 0048's (`0048-upload-bakeoff-faceplate`)
`SNAPBACK_ASSET_IMAGE_DECODE_FAILED` carrying the exact upstream parser
error, is the retained observed exemplar; the anonymous-upload refusal
(`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`, which now names
`snapback assets put --user`) is the retained RETROFIT exemplar — the
0058-era run paid the source-reading excursion
(`issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`)
and the remediation-carrying message is that ticket's fix, exactly the
before/after this program generalizes — while several of
the expensive detours trace to refusals that carried neither rule nor
fix. (Additional unretained lane-report incidents exist but are not
cited as evidence here.) LLP 0186 W3 states the
bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
the violated rule and either the fix or a resolving guide anchor** — but
the bar has only ever been applied to codes that happened to appear in
diaries. This Plan audits the entire population once and then makes the
bar structural, so it can never regress.

## Evidence

- Diary 0069: zero framework defects, yet the run's expensive moments
  were knowledge-shaped — several reachable from a refusal that could
  have carried the answer.
- The retained record shows the mechanism in both directions: refusals
  that named remediations (`snapback assets put --user`, diary 0048's
  decode diagnostic, the seed-recovery messages) cost near-zero;
  refusals that did not each cost a bisection session — diary 0058's (`0058-relay-room-expo-backend-bakeoff`)
  "host-ops error response was not JSON" (in-checkout era;
  `issues/closed/20260805-managed-dev-multi-json-load.md`) and the
  SHA-256-hashed field path
  (`issues/closed/20260805-result-contract-violation-hashes-field-path.md`).
- The infrastructure half-exists: stable code registry, the
  production diagnostic-inventory drift gate, and 0146 D7 ratified as
  the remediation carrier.

## Program

**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
code inventory (a raw identifier sweep finds ~2,700 `SNAPBACK_*` symbols
including env vars and test constants; the diagnostic subset is the
real population and Phase 1 establishes its size) from the diagnostic registry
plus a grep sweep for unregistered emissions. Fan out grading lanes:
each code graded A (names rule + fix/anchor), B (names rule only), or
C (bare), with the emitting site and agent-triggerability recorded.
Output: a checked-in graded ledger under `tests/acceptance/diagnostics/`.

**Phase 2 — fix in evidence order.** First: every B/C code that appears
in any diary's correction-loop list. Then B/C codes on
agent-triggerable paths, batched by subsystem. Message edits follow the
house style; guide anchors must resolve (check-guide enforces). Codes
that are genuinely internal (never agent-triggerable) are marked so in
the ledger rather than polished; later reclassification of an
agent-triggerable code to internal is a gated ledger change under the
same review bar as a grade regression.

**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
a new agent-triggerable code cannot land without a remediation in the
carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
floor. The typed-remediation end state is 0146's ratified D7 and is not
reopened here; the carrier choice is OQ6's open ruling
(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
named dependency of this phase's structured half — until it rules, the
gate enforces text+anchor as a bounded interim floor, upgraded
code-by-code as the carrier lands. Anchor
resolution joins CI. The graded ledger becomes the gate's baseline;
grade regressions fail.

**Phase 4 — close the loop with measurement.** The next benchmark run's
lane reports grade every refusal encountered; new B/C sightings are the
recurring audit input.

## Exit criteria

1. Graded ledger covers 100% of registered codes; zero ungraded
   emissions in the sweep.
2. **Every ledger entry classified agent-triggerable is grade A** (the
   program's declared bar; diary-cited codes are merely the first
   batch).
3. The drift gate refuses a new agent-triggerable code without
   remediation/anchor (negative test), and refuses grade regressions.
4. A benchmark run encounters zero B- or C-grade refusals — as
   validation of criterion 2, not a substitute for it.

## Open questions

- OQ1: The migration bound — how long audited legacy codes may remain
  on the text+anchor floor after the OQ6 carrier ruling lands. Proposal:
  structured on next touch, with a dated full-migration milestone set
  when the carrier ships (the typed end state itself is settled by
  0146's ratified D7, not by this Plan).
- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
  from any published-surface operation, decided by the grading lane,
  spot-checked in review.

exec
/bin/zsh -lc "sed -n '1,260p' 0196-template-and-recipe-portfolio.plan.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
exec
/bin/zsh -lc "sed -n '1,260p' 0195-public-documentation-and-training-surface.rfc.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 succeeded in 0ms:
# LLP 0196: Template and recipe portfolio

**Type:** Plan
**Status:** Review
**Systems:** Templates, CLI, Guide, Testing, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r5, this document: no body change this round.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain: capability-surface wording, T5 two-gate split, template-assisted labeling + held-out-brief rule. 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W2), LLP 0195 (public examples mirror), diaries
0068-0069, benchmarks/briefs/

## Summary

The measurement diaries repeatedly rank knowledge placement:
**scaffold beats guide beats package source** (every lane's
knowledge-source ladder ends in package source; the scaffold is
unanimously the cheapest). Knowledge moved into template defaults
(0.1.15's sessions mode, offline registration, upload wiring) produced
the largest improvement of any release whose changes were
knowledge-placement rather than defect fixes — bare lane 41m32s→29m35s
(diaries 0068/0069 — a single N=1 step inside the series' demonstrated
±30% variance, used here as plan motivation, not as a publishable
claim; the larger 80m→41m step at 0.1.13 came from the seven-defect
fix layer, a different mechanism). This Plan extends the portfolio
along the measured demand: two new templates exercising the capability
surfaces of the committed benchmark briefs, proof machinery registered by default, and the recipe
list the diaries priced.

## Program

**T1 — CRUD-dashboard template** (`--template crud-dashboard`),
exercising the same capability surface as `benchmarks/briefs/crud.md`
(not authored against the brief document): tables/list/detail/edit shapes, relational
query profile in the default path, sessions default, acceptance suite +
**registered verify profile** included. Most agent tasks are CRUD-shaped;
this becomes the default recommendation for generic briefs.

**T2 — media-feed template** (`--template media-feed`), exercising the
same capability surface as `briefs/media.md`: typed upload intents with renditions in the main
path, delivery-profile selection demonstrated (the strict-vs-public
lesson), infinite-scroll list over retained queries.

**T3 — proof-by-default across all templates:** every template ships a
registered `snapback.verify.config.mjs` (run-5's skill lane registered
profiles by hand; the done-oracle should be non-vacuous from scaffold),
and the expo templates ship web platform + deps (the two-run web-deps
papercut, ticketed 2026-08-08 — absorbed here).

**T4 — recipes** (guide sections with CI-verified snippets, in priority
order from run evidence): the headless-simulator proof kit (plistlib
scheme approval, Expo Go onboarding dismissal, drive-channel pattern —
ticketed), real-auth sign-in flows beyond test personas, the offline
supervisor-origin recipe (ticketed), verify-config authoring (ticketed).
Recipes graduate into template code where a template naturally exercises
them — the ladder says code placement beats prose.

**T5 — template freshness, two gates:** (a) pre-release and blocking:
templates cold-install and pass their suites against the exact
*candidate staged tarballs* during release qualification, so a release
cannot ship with a template failing against its own closure; (b)
post-release canary: the same suites re-run against the *published*
registry closure, alerting (not blocking) on drift the staging
environment cannot see, with the release owner holding
rollback/fix-forward escalation. Neither alone suffices.

## Sequencing

T3 first (papercut absorption + verify-by-default — small), then T1
(benchmark brief pairing makes it immediately measurable), T2, with T4
recipes landing alongside whichever surface they document. T5 joins the
release checklist when T1 lands.

## Exit criteria

- A cold agent given a CRUD or media brief scaffolds the matching
  template and reaches all proofs with zero template-gap loops.
- `snapback verify` is non-vacuous on every fresh scaffold.
- The next benchmark run on the CRUD brief uses T1 with no template-gap
  loops — measured and labeled as a **template-assisted scenario**.
  Templates deliberately cover benchmark-brief capability surfaces, so
  template-assisted results are never published as general
  authoring-efficiency claims: portfolio-level claims require success
  on a held-out brief variant not used to design any template, and
  competitor lanes get a symmetric starter-availability policy
  (LLP 0197 rules 4a/4b govern).

## Open questions

- OQ1: Template count discipline — the portfolio should stay small
  (three app templates + recipes); additions require a measured brief.
- OQ2: Whether `create-snapback-app` grows an interactive template
  picker or stays flag-driven (agents prefer flags; humans may not).

 succeeded in 0ms:
# LLP 0195: Public documentation, examples, and training-data surface

**Type:** RFC
**Status:** Review
**Systems:** Documentation, Publishing, Guide, Templates, Competitive
evaluation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r5, this document: 0065 citation slug only.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (the orientation-gap evidence), LLP 0061 (guide),
LLP 0041 (packaging), diaries 0065 (`0065-rematch-published-closure-bakeoff`)/0066/0068/0069

## Summary

Snapback currently has **no public documentation surface**. The guide
exists only in this repository and served from installed binaries: an
agent cannot read a word of it before installing, search engines and
training pipelines never see it, and `llms.txt` exists only on loopback
origins. Meanwhile the measurement series calls orientation cost "the dominant
term" in the remaining efficiency gap (diary 0069) — cost the Convex
lanes did not pay: across all five runs they consumed no documentation
at all, working from prior model familiarity. A public surface is the pre-install orientation fix and the
discoverability fix on its face; that it also feeds future model
training is a plausible but **unverified hypothesis** — prior
familiarity is measured, its provenance is not. The decision case rests
on discoverability and retrieval; the training effect, if real, is
upside this RFC proposes to instrument rather than assume (OQ4). It
remains the largest unstarted item this program has identified. It is proposed here rather than executed because publishing
is the author's decision.

## Proposal

1. **Public docs site, generated from `guide/`.** The corpus is already
   CI-verified, version-fenced (`published-closure.json` + `since:`
   machinery), and honest by construction (GAP rows). A static site
   generator over `guide/` — same markdown, same snippets, the 0194
   reference included — published on a real domain, with `/llms.txt` at
   the root and per-release snapshots pinned to published closures (the
   fence machinery already knows what each closure contains). The
   in-repo/served guide remains canonical; the site is a projection with
   the same content hashes.
2. **Public examples repository**, mirroring the template outputs and
   selected demo apps (the benchmark lanes' apps are strong candidates:
   complete, proof-carrying, honestly scoped). Each example pinned to a
   closure version and CI-cold-installed against the registry — the
   examples repo doubles as an external consumer canary.
3. **Skill distribution beyond scaffolds:** publish
   `snapback-authoring` wherever agent harnesses discover skills, so
   pre-scaffold orientation exists off-checkout.
4. **Deliberate training-data posture (hypothesis, instrumented):**
   write the site, examples, README funnels, and packages with a
   future-model audience in mind (stable vocabulary, Rosetta aliases,
   canonical snippets). Whether the moat actually erodes is testable
   but confounded — skills, templates, and error improvements also cut
   orientation cost — so the posture claims no timeline; OQ4 sketches
   the pinned-model knowledge evaluation that could isolate the
   training effect if it becomes worth measuring.

## What this does not claim

No hosted-service claims change; the site documents the local-first
surface the capability index already asserts, GAP rows included. The
honesty discipline that survived four published-consumer audits
(diaries 0065/0066/0068/0069; the 0058 run was in-checkout) is the asset being
published, not marketing copy.

## Author decisions required

- D1: Publish at all, and where (domain; whether the repo itself goes
  public or only generated projections).
- D2: Examples licensing and repo location.
- D3: Snapshot policy (per-release docs versions vs latest-only).
- D4: Whether benchmark artifacts (briefs, records) belong on the public
  site — interacts with LLP 0197's publication standard.

## Open questions

- OQ1: Site generator and hosting (the repo has EAS/Cloudflare lanes;
  either works — pick for boring reliability).
- OQ2: How the site's `llms.txt` and sitemap best serve crawler and
  agent retrieval (the served-guide retrieval-eval corpus can be reused
  as the site's acceptance test).
- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
  public anchors, unifying citations across surfaces.
- OQ4: The pinned-model knowledge evaluation — a fixed question set
  about Snapback answered by pinned model builds over time, isolating
  training-data presence from in-context aids; only worth building if
  the training hypothesis starts driving decisions.

exec
/bin/zsh -lc "sed -n '1,260p' 0197-benchmark-publication-standard.rfc.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 succeeded in 0ms:
# LLP 0197: Competitive benchmark publication standard

**Type:** RFC
**Status:** Review
**Systems:** Competitive evaluation, Publishing, Documentation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r5, this document: rule 4b ratio floor (minimum successful observations per lane; ratio omitted below floor, capability-outcome headline instead); 0065 slug.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain, plus round-2 finds: preregistration in rule 1, rules 4a/4b, publication-safe schema in rule 6, reproducibility manifest, diary-0058 citation, series restated 2.91x→2.24x. 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
(harness, records), LLP 0195 (public surface), diaries
0058/0065/0066/0068/0069 (measurement runs; 0058 by filename
`0058-relay-room-expo-backend-bakeoff`, a colliding number exists)

## Summary

The measurement program can now produce the raw material for
publication — five runs, a committed harness, token metering, and a
directional series (2.91x tokens for the first published-consumer
skill-adjacent lane on 0.1.13 to 2.24x on 0.1.15; bases differ across
rows, the records themselves say the series is directional rather than
a controlled sequence, and diary 0069 disclaims N=1 ratio movement as
signal). The existing series motivates this standard; it is not itself
a publishable controlled comparison. LLP 0186 OQ5 asked what disclosure
makes a public comparison credible rather than vendor noise; this RFC
proposes the standard. The governing principle: **publish the
instrument, not just the number** — the methodology independently
rerunnable by an outsider from public artifacts alone, carried by a
reproducibility manifest per record (harness commit, prompts, model
identity/build and settings as run, closure and competitor versions,
tool versions, environment and machine class, stopping rules, seeds
where available). Where the measuring model is not publicly accessible,
the standard promises rerunnable methodology and comparable
measurement, not bit-identical results — stated on every chart;
"reproduced" is reserved for observed reruns.

## The standard

A published Snapback benchmark claim requires:

1. **N≥3 runs per configuration, preregistered:** the run matrix
   (configurations, budgets, stopping and exclusion rules, frozen
   harness/prompt commits) is committed before results are observed;
   every started attempt gets an ID and is reported — no best-of, no
   post-hoc configuration designation. Median + range. The observed
   ±30% per-lane variance (diary 0069) makes single-run ratios
   unpublishable; the variance study is the prerequisite work item.
2. **The full harness public:** briefs verbatim, lane prompts, fairness
   rules, and run records (the `benchmarks/` tree, published via LLP
   0195) — an outsider with the same model can rerun the measurement.
3. **Fairness notes attached to every chart:** cold-context agents;
   published surfaces only; same model, machine, and serial discipline;
   competitor lanes free to use web docs; model prior-familiarity
   asymmetry stated plainly (it currently favors competitors).
4. **Proof-bar disclosure:** every chart states what each lane proved.
   The headline chart should be the **equal-proof-bar variant**
   (`briefs/messaging-equal-proof-bar.md`), with the bar stated as
   vendor-neutral outcomes (e.g. "cold-start reads of prior history
   with the backend unreachable"), not feature names — the honest
   comparison where depth is priced instead of penalized. The
   unequal-bar table may be published alongside with the asymmetry
   stated (competitor lanes' own-words caveats quoted, not
   paraphrased).
   4a. **Aid symmetry (all vendor-authored benchmark-targeted
   artifacts):** the rule covers every vendor-authored aid a lane can
   reach — templates, published example apps (including any benchmark
   lane apps LLP 0195 publishes), recipes, and skill content — not
   templates alone. Where a Snapback lane uses any such aid, the
   scenario is labeled aid-assisted; competitor lanes get the same
   predeclared public-availability and selection criteria for their
   ecosystems' aids; general authoring-efficiency claims use held-out
   brief variants no vendor-authored aid was designed against
   (LLP 0196's exit criteria adopt this); where no equivalent aid
   exists, aid-assisted and bare-start configurations publish
   separately.
   4b. **Equal-proof-bar failure protocol (preregistered):** identical
   budgets and stopping rules per lane; every failed attempt retained
   and reported as a capability failure — never converted to a timeout
   duration, silently excluded, or substituted with a weaker result;
   efficiency ratios computed only across runs meeting the identical
   bar, with the capability-failure table published beside them and
   per-lane success counts stated on the ratio chart itself. Ratio
   floor: a ratio requires the preregistered minimum successful
   observations per lane (N≥3 successes, matching rule 1); when either
   lane misses the floor or success counts differ beyond the
   preregistered threshold, the ratio is omitted and the
   capability-outcome comparison is the headline instead.
5. **Version pinning:** every run names the exact closure and
   competitor versions; claims age out when either moves materially.
6. **Self-report symmetry, publication-safe:** lane reports and
   correction-loop content (both vendors') are part of the public
   record — including runs unfavorable to Snapback; the credibility of
   the five-measurement-run, four-published-consumer-audit honesty
   discipline is the asset. Publication passes through a
   **publication-safe artifact schema**: a symmetric public projection
   preserving prompts, measurements, outcomes, proof evidence, and
   correction-loop categories; automated secret/credential/PII and
   private-material scanning; path and machine-identifier scrubbing
   with documented redactions and reason codes; retained hashes of the
   private originals for auditability; and a human with
   repository-disclosure authority reviewing before anything ships.
   Raw transcripts never publish.

## What publishing looks like

A benchmarks page on the LLP 0195 site: a program-history narrative
that contains NO cross-vendor numbers or ratios — the single-run era
(including the losing origin run, diary 0058) is told as dated prose
with links to the raw records, because a comparative chart communicates
a comparison whatever its label; the current N≥3 medians as the only
comparative presentation; links to briefs/records/prompts; a "run it
yourself" section stating expected run cost; and the reproducibility
manifest per record. No superlatives that a record link cannot back.

## Author decisions required

- D1: Whether to publish at all and when (proposal: after the N≥3
  study and the equal-proof-bar run, not before).
- D2: Which competitors appear (Convex is measured; Supabase/
  PocketBase/Postgres lanes are unbuilt — publishing claims about
  unmeasured competitors is out under this standard).
- D3: Whether competitor names appear in charts or as "backend A/B"
  (proposal: names, with rule 2's reproducibility as the defense).

## Open questions

- OQ1: Token-count comparability across models if the harness ever runs
  on non-Fable models (current standard: one model per published
  series, stated).
- OQ2: Whether an independent third party rerunning the harness is
  worth soliciting before first publication (strongest possible
  credibility; costs a relationship and time).

codex
I’ve completed the full read. The r5 edits are internally consistent with the supplied facts so far; I’m now stress-testing the two decision-bearing changes—the 0194 scope move and 0197’s publication ratio floor—against their exact surrounding rules, while checking whether any full-document material defect remains.
exec
/bin/zsh -lc 'git status --short && git diff -- CONTEXT.md 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 exited 128 in 0ms:
fatal: not a git repository (or any of the parent directories): .git

exec
/bin/zsh -lc 'nl -ba 0194-generated-api-reference.rfc.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
exec
/bin/zsh -lc 'nl -ba 0193-errors-as-docs-completeness.plan.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 succeeded in 0ms:
     1	# LLP 0194: Generated API reference surface
     2	
     3	**Type:** RFC
     4	**Status:** Review
     5	**Systems:** Guide, Documentation, Client packages, Types, Build
     6	**Author:** Charlie Cheever / Claude
     7	**Date:** 2026-08-08
     8	**Revised:** 2026-08-08 (r5, this document: verify-config moved to the INITIAL scope — its verify.d.mts declaration source already exists and is published (round-4 find); OQ2 narrows to the ctx declaration file.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration, OQ2-contingency marking). 2026-08-08 (r2) — r2 also resolves the OQ2 hand-written-interim contradiction (named exclusion until a declaration file lands). 2026-08-08 (r1) — super-refine round-1 revision against the
     9	dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
    10	unretained/incorrect quantitative claims corrected to retained-artifact
    11	citations; see the review artifacts for the concern ledger.
    12	**Related:** LLP 0061 (guide design — intent-indexed by choice), LLP 0186
    13	(measurement evidence), diaries 0068-0069
    14	
    15	## Summary
    16	
    17	Across five measurement runs, every remaining package-source excursion
    18	shares one shape: a **signature or contract question** — headless
    19	`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
    20	(extracted from runtime binary strings in run 5), the verify-config
    21	contract, client constructor option pairs. The guide is deliberately
    22	intent-indexed (LLP 0061) and should stay that way; what is missing is
    23	the complementary layer: a **complete, generated, build-bound API
    24	reference** derived from the packages' own `.d.mts` declarations — the
    25	types agents consistently praise — so that no signature question ever
    26	requires opening `node_modules`.
    27	
    28	## Design
    29	
    30	1. **Source of truth:** the published packages' `.d.mts` files plus doc
    31	   comments. No hand-written reference pages — generation only, so it
    32	   cannot drift (the closure-drift lesson, LLP 0186 W0).
    33	2. **Generation:** a build step (TypeScript compiler API, the
    34	   export-parity test's traversal as the seed) emitting one markdown
    35	   page per package under `guide/reference/<package>.md`, with stable
    36	   per-symbol anchors. Runs in the same pipeline as
    37	   `generate-guide-manifest`; output is committed generated artifact,
    38	   checked like the flat guide.
    39	3. **Serving:** joins the guide manifest — served at
    40	   `/_snapback/guide/reference/...`, indexed by
    41	   `snapback guide <query>` and the MCP resources, listed in
    42	   `/llms.txt`. Build-bound headers like every guide response.
    43	4. **Joins:** intent pages link into reference anchors ("full signature:
    44	   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
    45	   may cite reference anchors as their fix pointer.
    46	5. **Scope and completeness rule:** the reference includes exactly the
    47	   surfaces that have machine-readable declaration sources, and its
    48	   completeness claim is scoped to that set. Order:
    49	   `@expo/snapback-client` (headless surface — the largest excursion
    50	   source), `snapback-react` hooks and fact types, `snapback-expo`.
    51	   The verify-config contract already has a published declaration
    52	   source — `@expo/snapback-cli/verify` exports `verify.d.mts` with the
    53	   full typed contract (landed 2026-08-04) — so it sits in the INITIAL
    54	   scope; its measured excursions were a discoverability failure, not
    55	   a missing source, which this reference and a guide anchor fix
    56	   together. The `ctx` handler surface has no declaration source today;
    57	   it JOINS the reference when its declaration file lands (OQ2),
    58	   ordered immediately after the initial scope — until then it is a
    59	   named exclusion, not a hand-written page, so the no-hand-written
    60	   rule and the completeness claim stay true together.
    61	
    62	## What this kills
    63	
    64	Retained-record attributions: headless args nesting (diary 0069 residue
    65	3), `createAssetClient` root-export discovery (diary 0068), the sessions
    66	client-construction option pair (0068 residue 4, hit by two lanes) —
    67	all in the initial declaration-sourced scope. In the initial scope
    68	also: the verify-config contract (0068 and 0069 residue 5) — its
    69	declaration source (`@expo/snapback-cli/verify` → `verify.d.mts`)
    70	already exists and is published; the excursions were pure
    71	discoverability. Contingent on OQ2's declaration file landing: `ctx.db`
    72	verbs via binary strings (0069 residue 2) — the most expensive named
    73	excursion sits behind that one exclusion, the strongest argument for
    74	scheduling OQ2 early. Diary 0069 calls orientation "the
    75	dominant term" in the remaining gap; the signature-shaped items above
    76	are the subset of its residue list this RFC removes. (No quantitative
    77	fraction is claimed; the diaries do not decompose the bucket.)
    78	
    79	## Open questions
    80	
    81	- OQ1: Page granularity, size budgets, and the flat-projection
    82	  interaction — the flat guide is already past its one-request size
    83	  premise (`issues/20260806-guide-flat-projection-oversize.md`); the
    84	  reference is therefore EXCLUDED from `flat.md` unless that ticket's
    85	  diet/tier design lands first, and per-module splitting rules are
    86	  needed regardless.
    87	- OQ2: The `ctx` declaration file — the one remaining surface without
    88	  a machine-readable source. It joins only via a published declaration
    89	  file (which also gives consumers editor types); no hand-written
    90	  interim section — until it lands, `ctx` remains a named exclusion per
    91	  Design 5, documented in the intent guide as today, ordered
    92	  immediately after the initial scope. (Verify-config needs no OQ: its
    93	  `verify.d.mts` export exists and is `.d.mts`-traversable by the
    94	  Design-2 generator.)
    95	- OQ3: Whether doc comments in `.d.mts` are complete enough to render
    96	  useful prose, and whether improving them (which rotates artifact
    97	  identity — the doc-comment lesson) batches with releases.
    98	- OQ4: Versioning — the reference is inherently build-bound (served),
    99	  which is correct; whether the public docs surface (LLP 0195) pins
   100	  per-release snapshots is that RFC's question.

 succeeded in 0ms:
     1	# LLP 0193: Errors-as-docs completeness program
     2	
     3	**Type:** Plan
     4	**Status:** Review
     5	**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
     6	**Author:** Charlie Cheever / Claude
     7	**Date:** 2026-08-08
     8	**Revised:** 2026-08-08 (r5, this document: exemplar reattributed (assets-put-user is the retrofit case, ticket-cited); reclassification gating in Phase 3; 0065 slug.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
     9	dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
    10	unretained/incorrect quantitative claims corrected to retained-artifact
    11	citations; see the review artifacts for the concern ledger.
    12	**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
    13	remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
    14	diaries 0065 (`0065-rematch-published-closure-bakeoff`)/0066/0068/0069
    15	
    16	## Summary
    17	
    18	Across the retained measurement series, refusal-quality incidents
    19	resolved fastest when the refusal named its own fix — diary 0048's (`0048-upload-bakeoff-faceplate`)
    20	`SNAPBACK_ASSET_IMAGE_DECODE_FAILED` carrying the exact upstream parser
    21	error, is the retained observed exemplar; the anonymous-upload refusal
    22	(`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`, which now names
    23	`snapback assets put --user`) is the retained RETROFIT exemplar — the
    24	0058-era run paid the source-reading excursion
    25	(`issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`)
    26	and the remediation-carrying message is that ticket's fix, exactly the
    27	before/after this program generalizes — while several of
    28	the expensive detours trace to refusals that carried neither rule nor
    29	fix. (Additional unretained lane-report incidents exist but are not
    30	cited as evidence here.) LLP 0186 W3 states the
    31	bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
    32	the violated rule and either the fix or a resolving guide anchor** — but
    33	the bar has only ever been applied to codes that happened to appear in
    34	diaries. This Plan audits the entire population once and then makes the
    35	bar structural, so it can never regress.
    36	
    37	## Evidence
    38	
    39	- Diary 0069: zero framework defects, yet the run's expensive moments
    40	  were knowledge-shaped — several reachable from a refusal that could
    41	  have carried the answer.
    42	- The retained record shows the mechanism in both directions: refusals
    43	  that named remediations (`snapback assets put --user`, diary 0048's
    44	  decode diagnostic, the seed-recovery messages) cost near-zero;
    45	  refusals that did not each cost a bisection session — diary 0058's (`0058-relay-room-expo-backend-bakeoff`)
    46	  "host-ops error response was not JSON" (in-checkout era;
    47	  `issues/closed/20260805-managed-dev-multi-json-load.md`) and the
    48	  SHA-256-hashed field path
    49	  (`issues/closed/20260805-result-contract-violation-hashes-field-path.md`).
    50	- The infrastructure half-exists: stable code registry, the
    51	  production diagnostic-inventory drift gate, and 0146 D7 ratified as
    52	  the remediation carrier.
    53	
    54	## Program
    55	
    56	**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
    57	code inventory (a raw identifier sweep finds ~2,700 `SNAPBACK_*` symbols
    58	including env vars and test constants; the diagnostic subset is the
    59	real population and Phase 1 establishes its size) from the diagnostic registry
    60	plus a grep sweep for unregistered emissions. Fan out grading lanes:
    61	each code graded A (names rule + fix/anchor), B (names rule only), or
    62	C (bare), with the emitting site and agent-triggerability recorded.
    63	Output: a checked-in graded ledger under `tests/acceptance/diagnostics/`.
    64	
    65	**Phase 2 — fix in evidence order.** First: every B/C code that appears
    66	in any diary's correction-loop list. Then B/C codes on
    67	agent-triggerable paths, batched by subsystem. Message edits follow the
    68	house style; guide anchors must resolve (check-guide enforces). Codes
    69	that are genuinely internal (never agent-triggerable) are marked so in
    70	the ledger rather than polished; later reclassification of an
    71	agent-triggerable code to internal is a gated ledger change under the
    72	same review bar as a grade regression.
    73	
    74	**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
    75	a new agent-triggerable code cannot land without a remediation in the
    76	carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
    77	floor. The typed-remediation end state is 0146's ratified D7 and is not
    78	reopened here; the carrier choice is OQ6's open ruling
    79	(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
    80	named dependency of this phase's structured half — until it rules, the
    81	gate enforces text+anchor as a bounded interim floor, upgraded
    82	code-by-code as the carrier lands. Anchor
    83	resolution joins CI. The graded ledger becomes the gate's baseline;
    84	grade regressions fail.
    85	
    86	**Phase 4 — close the loop with measurement.** The next benchmark run's
    87	lane reports grade every refusal encountered; new B/C sightings are the
    88	recurring audit input.
    89	
    90	## Exit criteria
    91	
    92	1. Graded ledger covers 100% of registered codes; zero ungraded
    93	   emissions in the sweep.
    94	2. **Every ledger entry classified agent-triggerable is grade A** (the
    95	   program's declared bar; diary-cited codes are merely the first
    96	   batch).
    97	3. The drift gate refuses a new agent-triggerable code without
    98	   remediation/anchor (negative test), and refuses grade regressions.
    99	4. A benchmark run encounters zero B- or C-grade refusals — as
   100	   validation of criterion 2, not a substitute for it.
   101	
   102	## Open questions
   103	
   104	- OQ1: The migration bound — how long audited legacy codes may remain
   105	  on the text+anchor floor after the OQ6 carrier ruling lands. Proposal:
   106	  structured on next touch, with a dated full-migration milestone set
   107	  when the carrier ships (the typed end state itself is settled by
   108	  0146's ratified D7, not by this Plan).
   109	- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
   110	  from any published-surface operation, decided by the grading lane,
   111	  spot-checked in review.

exec
/bin/zsh -lc 'nl -ba 0197-benchmark-publication-standard.rfc.md' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5
 succeeded in 0ms:
     1	# LLP 0197: Competitive benchmark publication standard
     2	
     3	**Type:** RFC
     4	**Status:** Review
     5	**Systems:** Competitive evaluation, Publishing, Documentation
     6	**Author:** Charlie Cheever / Claude
     7	**Date:** 2026-08-08
     8	**Revised:** 2026-08-08 (r5, this document: rule 4b ratio floor (minimum successful observations per lane; ratio omitted below floor, capability-outcome headline instead); 0065 slug.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain, plus round-2 finds: preregistration in rule 1, rules 4a/4b, publication-safe schema in rule 6, reproducibility manifest, diary-0058 citation, series restated 2.91x→2.24x. 2026-08-08 (r1) — super-refine round-1 revision against the
     9	dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
    10	unretained/incorrect quantitative claims corrected to retained-artifact
    11	citations; see the review artifacts for the concern ledger.
    12	**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
    13	(harness, records), LLP 0195 (public surface), diaries
    14	0058/0065/0066/0068/0069 (measurement runs; 0058 by filename
    15	`0058-relay-room-expo-backend-bakeoff`, a colliding number exists)
    16	
    17	## Summary
    18	
    19	The measurement program can now produce the raw material for
    20	publication — five runs, a committed harness, token metering, and a
    21	directional series (2.91x tokens for the first published-consumer
    22	skill-adjacent lane on 0.1.13 to 2.24x on 0.1.15; bases differ across
    23	rows, the records themselves say the series is directional rather than
    24	a controlled sequence, and diary 0069 disclaims N=1 ratio movement as
    25	signal). The existing series motivates this standard; it is not itself
    26	a publishable controlled comparison. LLP 0186 OQ5 asked what disclosure
    27	makes a public comparison credible rather than vendor noise; this RFC
    28	proposes the standard. The governing principle: **publish the
    29	instrument, not just the number** — the methodology independently
    30	rerunnable by an outsider from public artifacts alone, carried by a
    31	reproducibility manifest per record (harness commit, prompts, model
    32	identity/build and settings as run, closure and competitor versions,
    33	tool versions, environment and machine class, stopping rules, seeds
    34	where available). Where the measuring model is not publicly accessible,
    35	the standard promises rerunnable methodology and comparable
    36	measurement, not bit-identical results — stated on every chart;
    37	"reproduced" is reserved for observed reruns.
    38	
    39	## The standard
    40	
    41	A published Snapback benchmark claim requires:
    42	
    43	1. **N≥3 runs per configuration, preregistered:** the run matrix
    44	   (configurations, budgets, stopping and exclusion rules, frozen
    45	   harness/prompt commits) is committed before results are observed;
    46	   every started attempt gets an ID and is reported — no best-of, no
    47	   post-hoc configuration designation. Median + range. The observed
    48	   ±30% per-lane variance (diary 0069) makes single-run ratios
    49	   unpublishable; the variance study is the prerequisite work item.
    50	2. **The full harness public:** briefs verbatim, lane prompts, fairness
    51	   rules, and run records (the `benchmarks/` tree, published via LLP
    52	   0195) — an outsider with the same model can rerun the measurement.
    53	3. **Fairness notes attached to every chart:** cold-context agents;
    54	   published surfaces only; same model, machine, and serial discipline;
    55	   competitor lanes free to use web docs; model prior-familiarity
    56	   asymmetry stated plainly (it currently favors competitors).
    57	4. **Proof-bar disclosure:** every chart states what each lane proved.
    58	   The headline chart should be the **equal-proof-bar variant**
    59	   (`briefs/messaging-equal-proof-bar.md`), with the bar stated as
    60	   vendor-neutral outcomes (e.g. "cold-start reads of prior history
    61	   with the backend unreachable"), not feature names — the honest
    62	   comparison where depth is priced instead of penalized. The
    63	   unequal-bar table may be published alongside with the asymmetry
    64	   stated (competitor lanes' own-words caveats quoted, not
    65	   paraphrased).
    66	   4a. **Aid symmetry (all vendor-authored benchmark-targeted
    67	   artifacts):** the rule covers every vendor-authored aid a lane can
    68	   reach — templates, published example apps (including any benchmark
    69	   lane apps LLP 0195 publishes), recipes, and skill content — not
    70	   templates alone. Where a Snapback lane uses any such aid, the
    71	   scenario is labeled aid-assisted; competitor lanes get the same
    72	   predeclared public-availability and selection criteria for their
    73	   ecosystems' aids; general authoring-efficiency claims use held-out
    74	   brief variants no vendor-authored aid was designed against
    75	   (LLP 0196's exit criteria adopt this); where no equivalent aid
    76	   exists, aid-assisted and bare-start configurations publish
    77	   separately.
    78	   4b. **Equal-proof-bar failure protocol (preregistered):** identical
    79	   budgets and stopping rules per lane; every failed attempt retained
    80	   and reported as a capability failure — never converted to a timeout
    81	   duration, silently excluded, or substituted with a weaker result;
    82	   efficiency ratios computed only across runs meeting the identical
    83	   bar, with the capability-failure table published beside them and
    84	   per-lane success counts stated on the ratio chart itself. Ratio
    85	   floor: a ratio requires the preregistered minimum successful
    86	   observations per lane (N≥3 successes, matching rule 1); when either
    87	   lane misses the floor or success counts differ beyond the
    88	   preregistered threshold, the ratio is omitted and the
    89	   capability-outcome comparison is the headline instead.
    90	5. **Version pinning:** every run names the exact closure and
    91	   competitor versions; claims age out when either moves materially.
    92	6. **Self-report symmetry, publication-safe:** lane reports and
    93	   correction-loop content (both vendors') are part of the public
    94	   record — including runs unfavorable to Snapback; the credibility of
    95	   the five-measurement-run, four-published-consumer-audit honesty
    96	   discipline is the asset. Publication passes through a
    97	   **publication-safe artifact schema**: a symmetric public projection
    98	   preserving prompts, measurements, outcomes, proof evidence, and
    99	   correction-loop categories; automated secret/credential/PII and
   100	   private-material scanning; path and machine-identifier scrubbing
   101	   with documented redactions and reason codes; retained hashes of the
   102	   private originals for auditability; and a human with
   103	   repository-disclosure authority reviewing before anything ships.
   104	   Raw transcripts never publish.
   105	
   106	## What publishing looks like
   107	
   108	A benchmarks page on the LLP 0195 site: a program-history narrative
   109	that contains NO cross-vendor numbers or ratios — the single-run era
   110	(including the losing origin run, diary 0058) is told as dated prose
   111	with links to the raw records, because a comparative chart communicates
   112	a comparison whatever its label; the current N≥3 medians as the only
   113	comparative presentation; links to briefs/records/prompts; a "run it
   114	yourself" section stating expected run cost; and the reproducibility
   115	manifest per record. No superlatives that a record link cannot back.
   116	
   117	## Author decisions required
   118	
   119	- D1: Whether to publish at all and when (proposal: after the N≥3
   120	  study and the equal-proof-bar run, not before).
   121	- D2: Which competitors appear (Convex is measured; Supabase/
   122	  PocketBase/Postgres lanes are unbuilt — publishing claims about
   123	  unmeasured competitors is out under this standard).
   124	- D3: Whether competitor names appear in charts or as "backend A/B"
   125	  (proposal: names, with rule 2's reproducibility as the defense).
   126	
   127	## Open questions
   128	
   129	- OQ1: Token-count comparability across models if the harness ever runs
   130	  on non-Fable models (current standard: one model per published
   131	  series, stated).
   132	- OQ2: Whether an independent third party rerunning the harness is
   133	  worth soliciting before first publication (strongest possible
   134	  credibility; costs a relationship and time).

codex
1) Concerns

1. [MATERIAL] [IN-DELTA] **0193 — Summary / Evidence.** The Summary correctly calls `snapback assets put --user` “the retained RETROFIT exemplar” whose 0058-era incident required source reading, but Evidence still claims that remediated refusal was among those that “cost near-zero.” This leaves the evidentiary reclassification incomplete and presents an unobserved retrofit as an observed outcome. Resolving change: remove it from the observed near-zero list or explicitly label it there as a retrofit; reserve the observed claim for diary 0048 and other genuinely observed cases.

2. [MATERIAL] [IN-DELTA] **0197 — The standard, rule 4b.** “N≥3 successes” and a threshold on differing success counts do not account for total attempts. Both lanes could record three successes from many attempts—or from unequal attempt counts—and still qualify for a headline efficiency ratio based only on atypical successful runs. Resolving change: require equal preregistered attempt counts and a denominator-aware minimum success-rate criterion; when either lane misses that criterion or their rates differ beyond the preregistered threshold, make capability outcomes the headline and omit or subordinate the conditional efficiency ratio.

2) Per-target verdicts

0193: NOT READY — blocking: 1  
0194: READY  
0195: READY  
0196: READY  
0197: NOT READY — blocking: 2

3) Set verdict

SET: NOT READY
tokens used
45,542
1) Concerns

1. [MATERIAL] [IN-DELTA] **0193 — Summary / Evidence.** The Summary correctly calls `snapback assets put --user` “the retained RETROFIT exemplar” whose 0058-era incident required source reading, but Evidence still claims that remediated refusal was among those that “cost near-zero.” This leaves the evidentiary reclassification incomplete and presents an unobserved retrofit as an observed outcome. Resolving change: remove it from the observed near-zero list or explicitly label it there as a retrofit; reserve the observed claim for diary 0048 and other genuinely observed cases.

2. [MATERIAL] [IN-DELTA] **0197 — The standard, rule 4b.** “N≥3 successes” and a threshold on differing success counts do not account for total attempts. Both lanes could record three successes from many attempts—or from unequal attempt counts—and still qualify for a headline efficiency ratio based only on atypical successful runs. Resolving change: require equal preregistered attempt counts and a denominator-aware minimum success-rate criterion; when either lane misses that criterion or their rates differ beyond the preregistered threshold, make capability outcomes the headline and omit or subordinate the conditional efficiency ratio.

2) Per-target verdicts

0193: NOT READY — blocking: 1  
0194: READY  
0195: READY  
0196: READY  
0197: NOT READY — blocking: 2

3) Set verdict

SET: NOT READY

## Round 6 — 2026-08-08 (gpt-5 family, author-merge delta round)

Provenance: codex exec, gpt-5.6-sol, xhigh, capsule sr-capsule-r6,
targets at 10cf97887 (r7, author-merge revision). One launch. Verbatim
body follows.

Reading additional input from stdin...
OpenAI Codex v0.147.0
--------
workdir: /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6
model: gpt-5.6-sol
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR]
reasoning effort: xhigh
reasoning summaries: none
session id: 019fe23f-bbe4-7720-8ab3-0b9ca72a4aca
--------
user
You are reviewing a five-document LLP set as one cluster in an
AUTHOR-MERGE DELTA ROUND (sixth round). The five documents went through
five prior dual-family review rounds; then the human author (the
project owner) independently revised them against the ORIGINAL pre-loop
text, and the orchestrator merged the author's content onto the
review-refined text as revision r7. Your job: review r7 in full, with
special attention to MERGE QUALITY — places where the author's intent
and the review-round corrections may have been combined wrongly,
contradictorily, or lossily.

THE r7 DELTA (author content merged; everything else is
previously-reviewed text):
- 0193: causal claim bounded (three-of-six moments refusal-reachable,
  rest routed to 0194/0196); ledger gains carrier/target/closure-
  applicability/one-attempt-witness fields; anchors must resolve
  against the published closure; exit criterion 5 (one-attempt recovery
  evidence); OQ1 = migration cadence.
- 0194: restructured around a canonical machine-readable symbol
  registry as authority with Markdown/CLI/MCP as projections; budgeted
  exact-symbol lookup; a published ctx declaration source REQUIRED with
  a hand-fenced prose section permitted only as a temporary bootstrap
  (an explicit author decision reversing the loop's earlier
  no-interim rule); Acceptance section (export parity, cold
  signature-task suite with zero source reads, bounded lookups, shared
  symbol identities); verify-config remains in the initial scope (its
  verify.d.mts source exists — a review-verified fact the merge kept).
- 0195: publication binds to a qualified closure/content digest rather
  than moving HEAD; public examples are generated projections with one
  canonical owner; a "Success measures: two clocks" section separates
  immediate retrieval (testable now) from long-horizon training
  familiarity (pinned-model epochs only, no dates promised).
- 0196: new T0 (complete the existing chat starter's common breadth
  first, possibly as reusable feature modules, using existing LLP
  0176/0179 primitives); every template exposes one proof command
  delegating to LLP 0146 D2 verify with receipt identity preserved; T4
  becomes executable carrier kits (headless-simulator path as one
  bounded command registered under the verify profile); sequencing
  T3→T0→T1/T2; exit criteria add zero-source-reads and semantic-action
  measures; OQ3 holdout/starter eligibility.
- 0197: restructured to twelve rules — preregistration merged into
  rule 1; NEW counterbalanced repetitions (rule 2); mandatory
  schema-valid machine records (rule 4); action-economy evidence with
  semantic action classes and redaction limits merged with the
  publication-safe schema (rule 5); receipt-backed proof over LLP 0146
  verify plus a neutral checker (rule 8); aid disclosure widened and
  merged with holdout policy (rule 10); the snapback-defect attribution
  class (rule 11); recomputed publication via a checked publisher
  (rule 12); the equal-proof-bar failure protocol and denominator-aware
  ratio floor retained as 7a/7b; corrected series numbers and
  directional caveat in the Summary; no-cross-vendor-numbers history
  narrative; new Acceptance criteria; D4; OQ3/OQ4.

Review the full documents for MATERIAL concerns (correctness, coherence,
feasibility, safety, decision-quality; altitude rule — detail-only
demands identifying no defective decision are implementation-phase
notes). Classify every concern IN-DELTA vs PRE-EXISTING. Check
especially: cross-document seam consistency after the merge (0193
Phase 3 vs 0146-OQ6 carrier dependency vs the new structured-carrier
language; 0194's bootstrap-permitted rule vs its Acceptance criteria;
0196's proof command vs 0197 rule 8; 0197 rules 1/2/7b thresholds
internal consistency; 0195's two clocks vs 0197's fairness notes).

FORMAT: 1) numbered concerns labeled [MATERIAL]/[minor] and
[IN-DELTA]/[PRE-EXISTING] with document+section+quote+resolving change;
2) per-target verdict lines for all five; 3) one SET verdict line. You
are the only reviewer; do not reference other reviews; do not rewrite
the documents.

The capsule files are in the current directory: CONTEXT.md plus the five LLP documents. Read them all in full and produce the review in exactly the instructed format.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
warning: `--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.
2026-08-08T16:40:56.979975Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server linear: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
codex
I’m using the LLP review guidance because this is a clustered LLP delta review. I’ll first read that workflow and the entire capsule, then trace the named cross-document seams before issuing only decision-level concerns.
exec
/bin/zsh -lc "sed -n '1,260p' /Users/ccheever/.codex/skills/llp-review/SKILL.md && printf '\\nFILES\\n' && rg --files -g 'CONTEXT.md' -g '*.md' . && printf '\\nLINE COUNTS\\n' && wc -l CONTEXT.md *.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6
 succeeded in 0ms:
---
name: llp-review
description: Run the LLP 0005 review loop for an LLP document — orchestrate reviews from other model families, write one provenance-tracked artifact per review actually received under llp/reviews/, and never fabricate a review or accept on the author's behalf. Review intensity scales with stakes; the author decides when it's enough.
source: ccheever/llp@v0.3.0
---

# llp-review

<!-- @ref https://github.com/ccheever/llp/blob/v0.3.0/llp/0005-rfc-process.guide.md#honesty-rules-always-in-force — the rules this enforces -->
<!-- @ref https://github.com/ccheever/llp/blob/v0.3.0/llp/0005-rfc-process.guide.md#review-artifacts — artifact + provenance header format -->

Review an LLP the way LLP 0005 prescribes: as much critical review as the stakes warrant, captured honestly. Different model families catch different blind spots, so a single session cannot stand in for a multi-family loop — this skill makes the honest path the only path.

Invoke as `/llp-review <number | slug | filename>`. Bare: list `Draft`/`Review` LLPs and ask.

## Trigger

A document enters `Review` (the author's opt-in to a formal loop), or review is explicitly requested. Otherwise *offer* review scaled to stakes (LLP 0005 §How much review to buy) — don't impose it.

## Invariants

- MUST NOT fabricate a review, record one that wasn't actually provided, or mark a loop complete by intent.
- MUST NOT count the session that authored the draft as an independent reviewer — if this session wrote the document, say so and gather reviews elsewhere.
- MUST NOT change `**Status:**` or accept/reject — propose transitions; the author decides.
- MUST write one artifact per review actually received: `llp/reviews/NNNN-slug.<family>.md`, opening with the LLP 0005 provenance header (family · provider/runtime · date · redacted? · method). Re-reviews by the same family get a dated section, never an overwrite.
- MUST NOT send content to an external provider without an explicit human action; redact secrets by default.

## Workflow

> **Recipe (advisory)** — locate and read the document fully. If this session can act as one independent family reviewer (and didn't author the draft), write that review using the LLP 0005 standard prompt. For each further input the author wants — pasted manual review, sub-agent on a different family, CLI runner — prepare the prompt and **stop until it is actually provided**. Structure each review body: overall assessment · strengths (cite sections) · concerns (with severity and what would resolve each) · suggestions · open questions · recommended next step.

## Artifact

Review files under `llp/reviews/` with provenance headers, plus a summary of the feedback and a *proposed* next step (revise and stay `Draft` / gather another family / ready for the author to accept).

## Hand-offs

- Feedback that amounts to a new design direction → a fresh LLP via `llp-create`.
- The author applies status changes; this skill never does.

FILES
./0195-public-documentation-and-training-surface.rfc.md
./0196-template-and-recipe-portfolio.plan.md
./0194-generated-api-reference.rfc.md
./0193-errors-as-docs-completeness.plan.md
./CONTEXT.md
./0197-benchmark-publication-standard.rfc.md

LINE COUNTS
      39 CONTEXT.md
     147 0193-errors-as-docs-completeness.plan.md
     124 0194-generated-api-reference.rfc.md
     119 0195-public-documentation-and-training-surface.rfc.md
     135 0196-template-and-recipe-portfolio.plan.md
     221 0197-benchmark-publication-standard.rfc.md
      39 CONTEXT.md
     824 total

exec
/bin/zsh -lc "for f in CONTEXT.md 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md; do printf '\\n===== %s =====\\n' \""'$f"; nl -ba "$f"; done' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6
 succeeded in 0ms:

===== CONTEXT.md =====
     1	# Context sheet (facts only; for reviewing the five-document set)
     2	
     3	Snapback is a local-first backend framework: declarative schema/functions
     4	with codegen, live queries, ephemeral state, typed assets, sessions auth,
     5	React/Expo/headless clients, a Rust runtime shipped as prebuilt npm
     6	binaries. Its docs are an in-repo "guide" (CI-verified snippets,
     7	capability index with explicit GAP rows, version fences against the
     8	published npm closure) served by running servers at /_snapback/guide and
     9	an embedded `snapback guide` search; there is currently no public web
    10	documentation. Packages @expo/snapback-* are on npm at 0.1.15 (eleven
    11	packages incl. create-snapback-app). An agent skill (snapback-authoring)
    12	ships inside scaffolded apps. A committed benchmark harness exists under
    13	benchmarks/ (briefs, lane prompt templates, run-record schema, fairness
    14	rules) from LLP 0186 W1.
    15	
    16	Measurement facts cited by the documents (five serial cold-agent runs,
    17	same brief/machine/model, token-metered): wall/tokens for the
    18	Snapback-with-skill lane vs a Convex lane moved 26m22s/329k vs
    19	16m36s/113k (npm 0.1.13) to 19m00s/201k vs 10m18s/90k (npm 0.1.15);
    20	observed per-lane run-to-run variance ±30% at N=1; latest run had zero
    21	framework-caused defects in any Snapback lane; remaining friction was
    22	knowledge-shaped (signature/contract questions resolved by reading
    23	package source; one case by extracting strings from the runtime binary).
    24	Convex lanes across all runs consumed no documentation (prior model
    25	familiarity). Diaries 0058, 0065, 0066, 0068, 0069 record the runs.
    26	Existing related LLPs: 0186 (agent authoring efficiency program: W0
    27	plumbing fixes shipped; W1 benchmark harness; W2 skill/scaffolds; W3
    28	errors bar; W4 edit-loop taxes), 0146 (agent affordances; D7 = typed
    29	remediations carried by refusals, ratified, enforcement carrier not yet
    30	built), 0061 (guide design, intent-indexed), 0041 (packaging/releases).
    31	A diagnostic-inventory drift gate exists in CI (production diagnostic
    32	codes are classified; new unclassified codes fail).
    33	
    34	Additional retained fact for this round: diary 0058 records the first
    35	run (in-checkout, Codex-model era): Snapback 26m03s vs Convex 11m15s.
    36	
    37	Additional fact: packages/snapback-cli/verify.d.mts exists on main
    38	(landed 2026-08-04) exporting the typed verify-config contract via the
    39	package exports map ("./verify": types verify.d.mts).

===== 0193-errors-as-docs-completeness.plan.md =====
     1	# LLP 0193: Errors-as-docs completeness program
     2	
     3	**Type:** Plan
     4	**Status:** Review
     5	**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
     6	**Author:** Charlie Cheever / Claude
     7	**Date:** 2026-08-08
     8	**Revised:** 2026-08-08 (r7, author-merge: Charlie's reconciliation —
     9	the evidence claim narrowed to the refusal-reachable three-of-six subset
    10	with the rest routed to 0194/0196; the ledger grades resolution quality
    11	and closure binding (carrier/target/applicability/one-attempt witness
    12	fields); exit criterion 5 adds the one-attempt recovery test; OQ1 recast
    13	as migration cadence — merged onto the r6 review spine, keeping the
    14	retained-exemplar corrections, the ~2,700-symbol population note, the
    15	OQ6 carrier dependency, mechanical reclassification refusal, and
    16	post-run grading.) 2026-08-08 (r6, this document: sibling-ticket provenance corrected (excursion vs product-half fix), retrofit removed from the observed list, reclassification refusal made mechanical + exit-criterion negative test, post-run grading outside the metered window. UNREVIEWED — applied after the final authorized round; every change resolves an enumerated round-5 concern.) 2026-08-08 (r5, this document: exemplar reattributed (assets-put-user is the retrofit case, ticket-cited); reclassification gating in Phase 3; 0065 slug.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
    17	dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
    18	unretained/incorrect quantitative claims corrected to retained-artifact
    19	citations; see the review artifacts for the concern ledger.
    20	**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
    21	remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
    22	LLP 0194 (generated reference anchors), LLP 0197 (benchmark
    23	disclosure), diaries 0065
    24	(`0065-rematch-published-closure-bakeoff`)/0066/0068/0069
    25	
    26	## Summary
    27	
    28	Across the retained measurement series, refusal-quality incidents
    29	resolved fastest when the refusal named its own fix — diary 0048's (`0048-upload-bakeoff-faceplate`)
    30	`SNAPBACK_ASSET_IMAGE_DECODE_FAILED` carrying the exact upstream parser
    31	error, is the retained observed exemplar; the anonymous-upload refusal
    32	(`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`, which now names
    33	`snapback assets put --user`) is the retained RETROFIT exemplar — the
    34	0058-era run paid the source-reading excursion (recorded in
    35	`issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`)
    36	and the remediation-carrying message is the sibling product-half fix
    37	(`issues/closed/20260805-expo-asset-upload-guide-gap.md`, resolved
    38	2026-08-06), exactly the before/after this program generalizes — while several of
    39	the expensive detours trace to refusals that carried neither rule nor
    40	fix. (Additional unretained lane-report incidents exist but are not
    41	cited as evidence here.) Refusal quality is one high-leverage subset of
    42	the remaining cost, not the whole remainder: run 5 also paid for a
    43	template defect, simulator-proof assembly, and signature discovery that
    44	no refusal could repair — those route to LLP 0196 and LLP 0194 and keep
    45	this Plan's causal claim bounded. LLP 0186 W3 states the
    46	bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
    47	the violated rule and either the fix or a resolving guide anchor** — but
    48	the bar has only ever been applied to codes that happened to appear in
    49	diaries. This Plan audits the entire population once and then makes the
    50	bar structural, so it can never regress.
    51	
    52	## Evidence
    53	
    54	- Diary 0069: six expensive moments were knowledge-shaped; three were
    55	  reachable from a refusal that could have carried the answer. The
    56	  other three route to LLP 0194/0196 and keep this Plan's causal claim
    57	  bounded.
    58	- The retained record shows the mechanism in both directions: observed
    59	  refusals that named remediations (diary 0048's decode diagnostic, the
    60	  seed-recovery messages) cost near-zero (the `assets put --user`
    61	  remediation is the retrofit case above, not an observed resolution);
    62	  refusals that did not each cost a bisection session — diary 0058's (`0058-relay-room-expo-backend-bakeoff`)
    63	  "host-ops error response was not JSON" (in-checkout era;
    64	  `issues/closed/20260805-managed-dev-multi-json-load.md`) and the
    65	  SHA-256-hashed field path
    66	  (`issues/closed/20260805-result-contract-violation-hashes-field-path.md`).
    67	- The infrastructure half-exists: stable code registry, the
    68	  production diagnostic-inventory drift gate, and 0146 D7 ratified as
    69	  the remediation carrier.
    70	
    71	## Program
    72	
    73	**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
    74	code inventory (a raw identifier sweep finds ~2,700 `SNAPBACK_*` symbols
    75	including env vars and test constants; the diagnostic subset is the
    76	real population and Phase 1 establishes its size) from the diagnostic registry
    77	plus a grep sweep for unregistered emissions. Fan out grading lanes:
    78	each code graded A (names rule + current fix/anchor), B (names rule
    79	only), or C (bare). The ledger also records the emitting site,
    80	agent-triggerability, remediation carrier
    81	(`structured | message | guide | reference`), target, closure/version
    82	applicability, anchor/symbol resolution, and whether a cold one-attempt
    83	recovery witness exists. Output: a checked-in graded ledger under
    84	`tests/acceptance/diagnostics/`.
    85	
    86	**Phase 2 — fix in evidence order.** First: every B/C code that appears
    87	in any diary's correction-loop list. Then B/C codes on
    88	agent-triggerable paths, batched by subsystem. Message edits follow the
    89	house style; guide and LLP 0194 reference anchors must resolve against
    90	the published closure the remediation claims to teach (check-guide and
    91	the reference checks enforce). Codes
    92	that are genuinely internal (never agent-triggerable) are marked so in
    93	the ledger rather than polished; later reclassification of an
    94	agent-triggerable code to internal is refused mechanically by the drift
    95	gate absent an explicit override marker, under the same review bar as a
    96	grade regression.
    97	
    98	**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
    99	a new agent-triggerable code cannot land without a remediation in the
   100	carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
   101	floor. The typed-remediation end state is 0146's ratified D7 and is not
   102	reopened here; the carrier choice is OQ6's open ruling
   103	(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
   104	named dependency of this phase's structured half — until it rules, the
   105	gate enforces text+anchor as a bounded interim floor, upgraded
   106	code-by-code as the carrier lands (new codes use the structured carrier
   107	once it exists; audited legacy codes may hold the floor until touched).
   108	Anchor and generated-symbol resolution join CI. The graded ledger
   109	becomes the gate's baseline; grade or closure-applicability regressions
   110	fail.
   111	
   112	**Phase 4 — close the loop with measurement.** Refusal grading happens
   113	post-run from retained lane reports and transcripts — outside the
   114	metered window, so Snapback-only grading duty never skews the
   115	comparison (LLP 0197's fairness rules assume this) — and records
   116	whether each supplied remediation resolved the condition in one
   117	attempt. New B/C sightings and A-grade remediations that still caused
   118	search or bisection are the recurring audit input.
   119	
   120	## Exit criteria
   121	
   122	1. Graded ledger covers 100% of registered codes; zero ungraded
   123	   emissions in the sweep.
   124	2. **Every ledger entry classified agent-triggerable is grade A** (the
   125	   program's declared bar; diary-cited codes are merely the first
   126	   batch).
   127	3. The drift gate refuses a new agent-triggerable code without
   128	   remediation/anchor, refuses grade regressions, and refuses
   129	   unmarked agent-triggerable-to-internal reclassification (negative
   130	   tests for all three).
   131	4. A benchmark run encounters zero B- or C-grade refusals — as
   132	   validation of criterion 2, not a substitute for it.
   133	5. Every encountered A-grade refusal either produces a one-attempt
   134	   recovery or files evidence explaining why its remediation was
   135	   ineffective.
   136	
   137	## Open questions
   138	
   139	- OQ1: Migration cadence — how quickly audited legacy codes graduate
   140	  from the text+anchor floor to D7's structured `remediations` carrier
   141	  once the 0146 OQ6 carrier ruling lands. New codes use the structured
   142	  carrier from that point; the open question is cadence, not the target
   143	  shape (settled by 0146's ratified D7). Proposal: structured on next
   144	  touch, dated full-migration milestone set when the carrier ships.
   145	- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
   146	  from any published-surface operation, decided by the grading lane,
   147	  spot-checked in review.

===== 0194-generated-api-reference.rfc.md =====
     1	# LLP 0194: Generated API reference surface
     2	
     3	**Type:** RFC
     4	**Status:** Review
     5	**Systems:** Guide, Documentation, Client packages, Types, Build
     6	**Author:** Charlie Cheever / Claude
     7	**Date:** 2026-08-08
     8	**Revised:** 2026-08-08 (r7, author-merge: Charlie's action-economy revision
     9	— a canonical machine-readable symbol registry becomes the authority behind
    10	Markdown, CLI, and MCP projections; a published `ctx` declaration source is
    11	required with hand-fenced prose permitted only as a temporary bootstrap
    12	[author decision, reversing the loop's no-interim rule]; Acceptance section
    13	added — merged onto the r6 review spine, keeping the round-verified facts:
    14	verify-config's declaration source already exists and sits in the initial
    15	scope; no numeric orientation fraction is claimed.) 2026-08-08 (r5, this
    16	document: verify-config moved to the INITIAL scope — its verify.d.mts
    17	declaration source already exists and is published (round-4 find); OQ2
    18	narrows to the ctx declaration file.) 2026-08-08 (r4/r3/r1 — see
    19	llp/reviews/0193-*.run.md for the full round ledger.)
    20	**Related:** LLP 0061 (guide design — intent-indexed by choice), LLP 0186
    21	(measurement evidence), LLP 0193 (diagnostic remediations), LLP 0195
    22	(public projection), diaries 0068-0069
    23	
    24	## Summary
    25	
    26	Across five measurement runs, every remaining package-source excursion
    27	shares one shape: a **signature or contract question** — headless
    28	`query`/`liveQuery` call shapes, hook fact types, the `ctx.db` verb set
    29	(extracted from runtime binary strings in run 5), the verify-config
    30	contract, client constructor option pairs. The guide is deliberately
    31	intent-indexed (LLP 0061) and should stay that way; what is missing is
    32	the complementary layer: a **complete, generated, build-bound API
    33	reference** derived from the packages' own declarations — the types
    34	agents consistently praise — so that no signature question ever requires
    35	opening `node_modules`. The authority is a queryable symbol registry,
    36	not a pile of Markdown pages; Markdown is one projection for humans and
    37	broad retrieval.
    38	
    39	## Design
    40	
    41	1. **Declaration sources:** the published packages' `.d.mts` files plus
    42	   doc comments, checked against the runtime export map. The handler
    43	   `ctx` surface gains a published declaration source too; a hand-fenced
    44	   prose section is permitted only as a temporary bootstrap and is not
    45	   the target design.
    46	2. **Canonical symbol registry:** a build step using the TypeScript
    47	   compiler API and the export-parity traversal emits one build-bound
    48	   registry. Each symbol records package/module, runtime export names,
    49	   complete signature, overload/member structure, doc text, source
    50	   provenance, stable identity, and closure applicability. No projection
    51	   independently parses or rewrites the public API.
    52	3. **Generated projections:** the registry emits size-bounded Markdown
    53	   under `guide/reference/` with stable per-symbol anchors, plus a
    54	   compact index. Output is a committed generated artifact in the same
    55	   pipeline as `generate-guide-manifest`, checked like the flat guide.
    56	4. **Budgeted exact lookup:** `snapback guide <exact-symbol>` and the
    57	   docs-only MCP surface can return one symbol or bounded module slice
    58	   directly from the registry, without forcing a package-sized Markdown
    59	   read. Results carry the same guide/build identity and explicit
    60	   truncation markers.
    61	5. **Serving:** the Markdown, compact index, and registry resources join
    62	   the guide manifest — served under `/_snapback/guide/reference/`,
    63	   indexed by `snapback guide <query>` and MCP, and listed in
    64	   `/llms.txt`. The oversized flat projection remains an explicit
    65	   fallback, not the primary reference carrier
    66	   (`issues/20260806-guide-flat-projection-oversize.md`).
    67	6. **Joins:** intent pages link into reference anchors ("full signature:
    68	   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
    69	   may cite reference or exact-symbol targets as their fix pointer.
    70	7. **Scope order:** `@expo/snapback-client` (headless surface — the
    71	   largest excursion source), `snapback-react` hooks and fact types,
    72	   `snapback-expo`, and the verify-config contract — whose declaration
    73	   source already exists and is published (`@expo/snapback-cli/verify` →
    74	   `verify.d.mts`, landed 2026-08-04; its measured excursions were pure
    75	   discoverability), so it sits in the initial declaration-sourced
    76	   scope. The `ctx` handler surface joins when its declaration source
    77	   lands (OQ2 owns placement), ordered immediately after.
    78	
    79	## What this kills
    80	
    81	Retained-record attributions: headless args nesting (diary 0069 residue
    82	3), `createAssetClient` root-export discovery (diary 0068), the sessions
    83	client-construction option pair (0068 residue 4, hit by two lanes), and
    84	the verify-config contract (0068 and 0069 residue 5) — all in the
    85	initial scope. Contingent on OQ2's `ctx` declaration landing: `ctx.db`
    86	verbs via binary strings (0069 residue 2) — the most expensive named
    87	excursion, the strongest argument for scheduling OQ2 early. Diary 0069
    88	did not retain a numeric phase decomposition, so this is a qualitative,
    89	enumerated target set rather than a claimed fraction of the remaining
    90	gap.
    91	
    92	## Acceptance
    93	
    94	1. Registry/runtime export parity fails if a declared symbol is absent
    95	   at runtime or a public runtime export lacks a registry entry.
    96	2. The `ctx` handler surface is available to consumers as declarations
    97	   and in the same registry as package APIs.
    98	3. A cold signature-task suite covering headless args nesting,
    99	   constructor custody pairs, verify-config, hook facts, and `ctx.db`
   100	   completes with zero package-source reads and zero binary-string
   101	   excavation.
   102	4. Exact-symbol lookup returns a bounded, identity-bearing result; a
   103	   request exceeding its budget names what was elided and how to request
   104	   the next slice.
   105	5. Markdown, CLI, MCP, diagnostics, and the public LLP 0195 projection
   106	   resolve the same stable symbol identities.
   107	
   108	## Open questions
   109	
   110	- OQ1: Initial registry and projection size budgets. Per-package
   111	  Markdown may exceed the flat-guide discipline; module/symbol slicing
   112	  must be measured.
   113	- OQ2: Which published package/module owns the `ctx` declaration file.
   114	  The requirement for a declaration source is decided here; only its
   115	  placement and compatibility rollout remain open. (Verify-config needs
   116	  no OQ: its `verify.d.mts` export exists and is `.d.mts`-traversable
   117	  by the Design-2 registry builder.)
   118	- OQ3: Whether doc comments in `.d.mts` are complete enough to render
   119	  useful prose, and whether improving them (which rotates artifact
   120	  identity — the doc-comment lesson) batches with releases.
   121	- OQ4: Versioning — the served reference is build-bound, which is
   122	  correct; whether the public docs surface (LLP 0195) pins per-release
   123	  snapshots is that RFC's question, and reference entries for symbols
   124	  newer than the published closure carry the guide's fence treatment.

exec
/bin/zsh -lc "for f in 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md; do printf '\\n===== %s =====\\n' \""'$f"; nl -ba "$f"; done' in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6
 succeeded in 0ms:

===== 0195-public-documentation-and-training-surface.rfc.md =====
     1	# LLP 0195: Public documentation, examples, and training-data surface
     2	
     3	**Type:** RFC
     4	**Status:** Review
     5	**Systems:** Documentation, Publishing, Guide, Templates, Competitive
     6	evaluation
     7	**Author:** Charlie Cheever / Claude
     8	**Date:** 2026-08-08
     9	**Revised:** 2026-08-08 (r7, author-merge: Charlie's revision — publication
    10	binds to a qualified closure/content digest rather than moving HEAD; public
    11	examples become generated projections with a single canonical owner; the
    12	two-clocks success measures separate immediate retrieval from long-horizon
    13	training familiarity — merged onto the r6 review spine, which keeps the
    14	retained "dominant term" citation, the four-audit count, and the
    15	instrumented-hypothesis framing.) 2026-08-08 (r5, this document: 0065 citation slug only.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
    16	dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
    17	unretained/incorrect quantitative claims corrected to retained-artifact
    18	citations; see the review artifacts for the concern ledger.
    19	**Related:** LLP 0186 (the orientation-gap evidence), LLP 0061 (guide),
    20	LLP 0041 (packaging), diaries 0065 (`0065-rematch-published-closure-bakeoff`)/0066/0068/0069
    21	
    22	## Summary
    23	
    24	Snapback currently has **no public documentation surface**. The guide
    25	exists only in this repository and served from installed binaries: an
    26	agent cannot read a word of it before installing, search engines and
    27	training pipelines never see it, and `llms.txt` exists only on loopback
    28	origins. Meanwhile the measurement series calls orientation cost "the dominant
    29	term" in the remaining efficiency gap (diary 0069) — cost the Convex
    30	lanes did not pay: across all five runs they consumed no documentation
    31	at all, working from prior model familiarity. A public surface is the pre-install orientation fix and the
    32	discoverability fix on its face; that it also feeds future model
    33	training is a plausible but **unverified hypothesis** — prior
    34	familiarity is measured, its provenance is not. The decision case rests
    35	on discoverability and retrieval; the training effect, if real, is
    36	upside this RFC proposes to instrument rather than assume (OQ4). It
    37	remains the largest unstarted item this program has identified. It is proposed here rather than executed because publishing
    38	is the author's decision.
    39	
    40	## Proposal
    41	
    42	1. **Public docs site, generated from `guide/`.** The corpus is already
    43	   CI-verified, version-fenced (`published-closure.json` + `since:`
    44	   machinery), and honest by construction (GAP rows). A static site
    45	   generator over `guide/` — same markdown, same snippets, the 0194
    46	   reference included — published on a real domain, with `/llms.txt` at
    47	   the root and per-release snapshots pinned to published closures (the
    48	   fence machinery already knows what each closure contains). The
    49	   in-repo/served guide remains canonical; the site is a projection with
    50	   the same content hashes. Publication consumes a qualified
    51	   closure/content digest, not whatever commit happens to be HEAD while
    52	   `main` moves.
    53	2. **Public examples repository**, projecting the template outputs and
    54	   selected demo apps (the benchmark lanes' apps are strong candidates:
    55	   complete, proof-carrying, honestly scoped — LLP 0197 rule 10's aid
    56	   disclosure applies once published). Each example pinned to a closure
    57	   version and CI-cold-installed against the registry — the examples
    58	   repo doubles as an external consumer canary. Generated examples are
    59	   not independently editable: changes land at the canonical template or
    60	   demo owner and regenerate the public projection, preventing two
    61	   sources of truth.
    62	3. **Skill distribution beyond scaffolds:** publish
    63	   `snapback-authoring` wherever agent harnesses discover skills, so
    64	   pre-scaffold orientation exists off-checkout.
    65	4. **Deliberate training-data posture (hypothesis, instrumented):**
    66	   write the site, examples, README funnels, and packages with a
    67	   future-model audience in mind (stable vocabulary, Rosetta aliases,
    68	   canonical snippets). Whether the moat actually erodes is testable
    69	   but confounded — skills, templates, and error improvements also cut
    70	   orientation cost — so the posture claims no timeline; OQ4 sketches
    71	   the pinned-model knowledge evaluation that could isolate the
    72	   training effect if it becomes worth measuring.
    73	
    74	## Success measures: two clocks
    75	
    76	**Immediate retrieval.** Before installing Snapback, a cold agent can
    77	answer the existing retrieval-eval intents and reach the exact LLP 0194
    78	symbol or guide decision within the same tool budget as the served
    79	corpus. Public bytes carry a qualified closure/content identity that
    80	matches the canonical guide, and a stale or unqualified projection is
    81	not published.
    82	
    83	**Long-horizon familiarity.** A later pinned model epoch may show
    84	reduced orientation time, source reads, or tokens in LLP 0186 W1. That
    85	trend is measured only when the model/harness epoch changes
    86	deliberately; it is not retroactively attributed to crawler
    87	availability, and no date is promised for training uptake. (OQ4's
    88	pinned-model knowledge evaluation is this clock's instrument.)
    89	
    90	## What this does not claim
    91	
    92	No hosted-service claims change; the site documents the local-first
    93	surface the capability index already asserts, GAP rows included. The
    94	honesty discipline that survived four published-consumer audits
    95	(diaries 0065/0066/0068/0069; the 0058 run was in-checkout) is the asset being
    96	published, not marketing copy.
    97	
    98	## Author decisions required
    99	
   100	- D1: Publish at all, and where (domain; whether the repo itself goes
   101	  public or only generated projections).
   102	- D2: Examples licensing and repo location.
   103	- D3: Snapshot policy (per-release docs versions vs latest-only).
   104	- D4: Whether benchmark artifacts (briefs, records) belong on the public
   105	  site — interacts with LLP 0197's publication standard.
   106	
   107	## Open questions
   108	
   109	- OQ1: Site generator and hosting (the repo has EAS/Cloudflare lanes;
   110	  either works — pick for boring reliability).
   111	- OQ2: How the site's `llms.txt` and sitemap best serve crawler and
   112	  agent retrieval (the served-guide retrieval-eval corpus can be reused
   113	  as the site's acceptance test).
   114	- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
   115	  public anchors, unifying citations across surfaces.
   116	- OQ4: The pinned-model knowledge evaluation — a fixed question set
   117	  about Snapback answered by pinned model builds over time, isolating
   118	  training-data presence from in-context aids; only worth building if
   119	  the training hypothesis starts driving decisions.

===== 0196-template-and-recipe-portfolio.plan.md =====
     1	# LLP 0196: Template and recipe portfolio
     2	
     3	**Type:** Plan
     4	**Status:** Review
     5	**Systems:** Templates, CLI, Guide, Testing, Agent experience
     6	**Author:** Charlie Cheever / Claude
     7	**Date:** 2026-08-08
     8	**Revised:** 2026-08-08 (r7, author-merge: Charlie's action-economy
     9	revision — T0 completes the existing chat starter before portfolio breadth;
    10	every template exposes one proof command delegating to LLP 0146 D2's
    11	`snapback verify`; the headless-simulator recipe becomes an executable
    12	carrier kit registered under the verify profile; exit criteria add
    13	zero-source-read and semantic-action measures; OQ3 holdout/starter
    14	eligibility — merged onto the r6 review spine, keeping the two-gate T5
    15	split, capability-surface wording, and template-assisted labeling.) 2026-08-08 (r5, this document: no body change this round.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain: capability-surface wording, T5 two-gate split, template-assisted labeling + held-out-brief rule. 2026-08-08 (r1) — super-refine round-1 revision against the
    16	dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
    17	unretained/incorrect quantitative claims corrected to retained-artifact
    18	citations; see the review artifacts for the concern ledger.
    19	**Related:** LLP 0146 (D2 verify owner), LLP 0176 (messaging golden
    20	path), LLP 0179 (AppDescriptor and surfaces), LLP 0186 (W2/W5), LLP 0194
    21	(generated API reference), LLP 0195 (public examples projection), LLP
    22	0197 (benchmark publication), diaries 0068-0069, benchmarks/briefs/
    23	
    24	## Summary
    25	
    26	The measurement diaries repeatedly rank knowledge placement:
    27	**scaffold beats guide beats package source** (every lane's
    28	knowledge-source ladder ends in package source; the scaffold is
    29	unanimously the cheapest). Knowledge moved into template defaults
    30	(0.1.15's sessions mode, offline registration, upload wiring) produced
    31	the largest improvement of any release whose changes were
    32	knowledge-placement rather than defect fixes — bare lane 41m32s→29m35s
    33	(diaries 0068/0069 — a single N=1 step inside the series' demonstrated
    34	±30% variance, used here as plan motivation, not as a publishable
    35	claim; the larger 80m→41m step at 0.1.13 came from the seven-defect
    36	fix layer, a different mechanism). This Plan extends the portfolio
    37	along the measured demand: two new templates exercising the capability
    38	surfaces of the committed benchmark briefs, proof machinery registered by default, and the recipe
    39	list the diaries priced.
    40	
    41	## Program
    42	
    43	**T0 — complete the existing Expo chat starter.** Before adding
    44	portfolio breadth, absorb the common messaging work every measured lane
    45	still authors: memberships/DM-vs-group shape, reply pointers, reactions,
    46	and the labeled test persona switcher, with acceptance profiles covering
    47	each. This may be a small set of reusable feature modules rather than
    48	one monolithic template. It uses the existing LLP 0176/0179 primitives
    49	and owners; it does not infer new auth or surface semantics from the
    50	word `chat`.
    51	
    52	**T1 — CRUD-dashboard template** (`--template crud-dashboard`),
    53	exercising the same capability surface as `benchmarks/briefs/crud.md`
    54	(not authored against the brief document): tables/list/detail/edit shapes, relational
    55	query profile in the default path, sessions default, acceptance suite +
    56	**registered verify profile** included. Most agent tasks are CRUD-shaped;
    57	this becomes the default recommendation for generic briefs. LLP 0197's
    58	aid-disclosure and holdout rules prevent this brief pairing from
    59	standing alone as a public generalization claim.
    60	
    61	**T2 — media-feed template** (`--template media-feed`), exercising the
    62	same capability surface as `briefs/media.md`: typed upload intents with renditions in the main
    63	path, delivery-profile selection demonstrated (the strict-vs-public
    64	lesson), infinite-scroll list over retained queries.
    65	
    66	**T3 — proof-by-default across all templates:** every template ships a
    67	registered `snapback.verify.config.mjs` (run-5's skill lane registered
    68	profiles by hand; the done-oracle should be non-vacuous from scaffold),
    69	and the expo templates ship web platform + deps (the two-run web-deps
    70	papercut, ticketed 2026-08-08 — absorbed here). Every template also
    71	exposes one ordinary proof command (for example `bun run prove`) that
    72	delegates to LLP 0146 D2's `snapback verify`, retains its receipt
    73	identity and `next[]`, and adds no second verifier, receipt format, or
    74	product-completeness claim.
    75	
    76	**T4 — recipes and executable carrier kits.** Guide sections keep
    77	CI-verified explanation, but the headless-simulator path is executable:
    78	one bounded command/helper owns simulator boot/install/launch, scheme
    79	approval, Expo Go onboarding dismissal, deep-link drive, screenshots,
    80	backend-stop offline relaunch, cleanup, and artifact paths. Its evidence
    81	is registered under T3's verify profile rather than becoming a parallel
    82	proof system. The remaining recipe order is real-auth sign-in beyond
    83	test personas, the offline supervisor-origin lane (ticketed), and
    84	verify-config authoring (ticketed). Recipes graduate into template code
    85	whenever a template naturally exercises them — the ladder says code
    86	placement beats prose.
    87	
    88	**T5 — template freshness, two gates:** (a) pre-release and blocking:
    89	templates cold-install and pass their suites against the exact
    90	*candidate staged tarballs* during release qualification, so a release
    91	cannot ship with a template failing against its own closure; (b)
    92	post-release canary: the same suites re-run against the *published*
    93	registry closure, alerting (not blocking) on drift the staging
    94	environment cannot see, with the release owner holding
    95	rollback/fix-forward escalation. Neither alone suffices.
    96	
    97	## Sequencing
    98	
    99	T3 first (papercut absorption + verify-by-default — small), then T0 so
   100	the already-published starter stops making every messaging lane rebuild
   101	common breadth. T1 and T2 follow; T4 executable paths land alongside the
   102	first template that exercises them. T5 joins the release checklist when
   103	T1 lands.
   104	
   105	## Exit criteria
   106	
   107	- A cold agent given a CRUD or media brief scaffolds the matching
   108	  template and reaches all proofs with zero template-gap loops.
   109	- `snapback verify` is non-vacuous on every fresh scaffold, and the
   110	  template-level proof command produces the same LLP 0146 D2 receipt a
   111	  direct invocation would.
   112	- Cold template lanes perform zero package-source reads and zero
   113	  binary-string excavation.
   114	- W1 records semantic actions before and after T0/T3/T4; success means
   115	  fewer discovery and proof operations, not a shell-command bundling
   116	  trick.
   117	- The next benchmark run on the CRUD brief uses T1 with no template-gap
   118	  loops — measured and labeled as a **template-assisted scenario**.
   119	  Templates deliberately cover benchmark-brief capability surfaces, so
   120	  template-assisted results are never published as general
   121	  authoring-efficiency claims: portfolio-level claims require success
   122	  on a held-out brief variant not used to design any template, and
   123	  competitor lanes get a symmetric starter-availability policy
   124	  (LLP 0197 rules 4a/4b govern).
   125	
   126	## Open questions
   127	
   128	- OQ1: Template count discipline — the portfolio should stay small
   129	  (three app templates + recipes); additions require a measured brief.
   130	- OQ2: Whether `create-snapback-app` grows an interactive template
   131	  picker or stays flag-driven (agents prefer flags; humans may not).
   132	- OQ3: Holdout selection and official-starter eligibility for public
   133	  comparisons. LLP 0197 owns the disclosure rule; this Plan must supply
   134	  at least one workload not directly solved by a template added for its
   135	  brief.

===== 0197-benchmark-publication-standard.rfc.md =====
     1	# LLP 0197: Competitive benchmark publication standard
     2	
     3	**Type:** RFC
     4	**Status:** Review
     5	**Systems:** Competitive evaluation, Publishing, Documentation
     6	**Author:** Charlie Cheever / Claude
     7	**Date:** 2026-08-08
     8	**Revised:** 2026-08-08 (r7, author-merge: Charlie's restructure after the
     9	first harness-native run — counterbalanced repetitions, mandatory machine
    10	records, action-economy evidence with semantic action classes,
    11	receipt-backed proof over LLP 0146 verify, the `snapback-defect`
    12	attribution class, recomputed publication via a checked publisher,
    13	implementation-first sequencing, Acceptance criteria, D4 and OQ3/OQ4 —
    14	merged onto the r6 review spine, which contributes the corrected series
    15	numbers and directional caveat, rule-1 preregistration items, the
    16	equal-proof-bar failure protocol and denominator-aware ratio floor, the
    17	publication-safe redaction/human-review requirements, and the
    18	no-cross-vendor-numbers history-narrative rule.) 2026-08-08 (r6/r5/r4/r2/r1
    19	— see llp/reviews/0193-*.run.md for the full round ledger.)
    20	**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
    21	(harness, records), LLP 0146 (`snapback verify` receipt), LLP 0195
    22	(public surface), LLP 0196 (template portfolio), diaries
    23	0058 (`0058-relay-room-expo-backend-bakeoff`)/0065
    24	(`0065-rematch-published-closure-bakeoff`)/0066/0068/0069
    25	
    26	## Summary
    27	
    28	The measurement program can now produce candidate numbers worth
    29	calibrating — five runs, a committed harness, token metering, and a
    30	directional series (2.91x tokens for the first published-consumer lane
    31	on 0.1.13 to 2.24x for the skill lane on 0.1.15; bases differ across
    32	rows, the records themselves say the series is directional rather than
    33	a controlled sequence, and diary 0069 disclaims N=1 ratio movement as
    34	signal). The existing series motivates this standard; it is not itself
    35	a publishable controlled comparison. LLP 0186 OQ5 asked what disclosure
    36	makes a public comparison credible rather than vendor noise; this RFC
    37	proposes the standard. The governing principle is **publish the
    38	instrument, not just the number**: every claim must be inspectable from
    39	public artifacts and rerunnable wherever the pinned model and harness
    40	are available; "reproduced" is reserved for observed reruns.
    41	
    42	## The standard
    43	
    44	A published Snapback benchmark claim requires:
    45	
    46	1. **N≥3 runs per configuration, preregistered**, with all runs
    47	   reported (no best-of, no post-hoc configuration designation): the
    48	   run matrix — configurations, budgets, stopping and exclusion rules,
    49	   frozen harness/prompt commits, attempt IDs, and the rule-7
    50	   thresholds — is committed before results are observed. Charts show
    51	   median, range, every constituent value, and the exact aggregation
    52	   rule. The observed approximately ±30% per-lane spread (diary 0069)
    53	   makes a single run evidence of existence, not magnitude. N≥8 remains
    54	   the floor for a variance or regression-attribution claim under the
    55	   W1 protocol.
    56	2. **Counterbalanced repetitions.** Lanes remain serial and
    57	   same-machine within a comparison set, but their order rotates across
    58	   repetitions using a predeclared balanced schedule. The record pins
    59	   machine state and load, package-manager/cache posture, fresh versus
    60	   reused backend state, occupied ports, model, effort, harness, and
    61	   package versions. A favorable lane may not always receive the same
    62	   warm-cache or machine-load position.
    63	3. **The full harness public:** briefs verbatim, instantiated lane
    64	   prompts, fairness rules, ordering schedule, record schema, and run
    65	   records (the `benchmarks/` tree, published via LLP 0195), plus a
    66	   reproducibility manifest per record (harness commit, model
    67	   identity/build and settings as run, closure and competitor versions,
    68	   tool versions, environment and machine class, stopping rules, seeds
    69	   where available). Public artifacts identify every parameter needed
    70	   to rerun the measurement; unavailable proprietary model or harness
    71	   access is stated as a reproducibility limit rather than papered
    72	   over.
    73	4. **A schema-valid machine record for every lane run.** The current
    74	   optional JSON record becomes mandatory before publication. The
    75	   human-readable comparison record and diary are generated from or
    76	   linked to those records, not used as a substitute for them. Missing
    77	   metrics remain explicit nulls and cannot support a derived claim.
    78	5. **Action-economy evidence, not only aggregate tool counts.** Each
    79	   record retains raw tool invocations, input/output/cache token fields
    80	   exposed by the harness, phase times, and a sanitized action trace.
    81	   The trace classifies at least guide/reference lookups,
    82	   package-source reads, binary/string excavation, edits, process
    83	   launches, proof commands, and retries. Raw tool calls remain
    84	   visible, but semantic action classes are the cross-harness
    85	   diagnostic because tool APIs batch work differently. Redaction
    86	   passes through the publication-safe artifact schema — automated
    87	   secret/credential/PII and private-material scanning, path and
    88	   machine-identifier scrubbing with documented redactions and reason
    89	   codes, retained hashes of private originals, and a human with
    90	   repository-disclosure authority reviewing before anything ships —
    91	   and may not remove the action class, timestamp, result status, or a
    92	   stable evidence pointer. Raw transcripts never publish.
    93	6. **Fairness notes attached to every chart:** cold-context agents;
    94	   published surfaces only; same model, effort, and within-set machine;
    95	   counterbalanced serial discipline; competitor lanes free to use web
    96	   docs; model prior-familiarity asymmetry stated plainly where it can
    97	   be supported. Prior familiarity is a caveat, not a numeric causal
    98	   adjustment.
    99	7. **Proof-bar disclosure:** every chart states what each lane proved.
   100	   The headline chart should be the **equal-proof-bar variant**
   101	   (`briefs/messaging-equal-proof-bar.md`), with the bar stated as
   102	   vendor-neutral outcomes (e.g. "cold-start reads of prior history
   103	   with the backend unreachable"), not feature names. The unequal-bar
   104	   table may be published alongside with the asymmetry stated
   105	   (competitor lanes' own-words caveats quoted, not paraphrased).
   106	   7a. **Equal-proof-bar failure protocol (preregistered):** identical
   107	   budgets and stopping rules per lane; every failed attempt retained
   108	   and reported as a capability failure — never converted to a timeout
   109	   duration, silently excluded, or substituted with a weaker result.
   110	   7b. **Denominator-aware ratio floor:** attempt counts per lane are
   111	   equal and preregistered; a ratio requires the preregistered minimum
   112	   successful observations per lane (N≥3 successes — the same floor as
   113	   rule 1's run count, applied to successes) AND a preregistered
   114	   minimum success rate; when either lane misses either criterion, or
   115	   success rates differ beyond the preregistered threshold, the ratio
   116	   is omitted or subordinated and the capability-outcome comparison is
   117	   the headline, with per-lane success counts stated on the chart
   118	   itself.
   119	8. **Receipt-backed proof.** A lane's final report is evidence, not the
   120	   proof oracle. The harness independently executes the brief's
   121	   acceptance checks and retains their receipts and UI artifacts. A
   122	   Snapback lane reuses the canonical LLP 0146 `snapback verify`
   123	   profiles and receipt rather than inventing a second system verifier;
   124	   the neutral benchmark checker then grades the brief-level claims for
   125	   every lane. Any proof that still needs human judgment is identified
   126	   and its evidence retained.
   127	9. **Version pinning:** every run names the exact closure and
   128	   competitor versions; claims age out when either moves materially.
   129	10. **Aid and starter disclosure.** Every lane names any official
   130	    starter, template, recipe, published example app, skill content, or
   131	    generated scaffold it used — any vendor-authored
   132	    benchmark-targeted artifact (including examples LLP 0195 publishes)
   133	    — with its version and the policy that made it eligible.
   134	    Competitors receive the same right to their public official
   135	    accelerators under predeclared selection criteria. An aid-assisted
   136	    result is a valid measure of the recommended path but is labeled as
   137	    such; a broad claim about authoring-surface generality additionally
   138	    needs a predeclared holdout brief not substantially implemented by
   139	    any such aid. LLP 0196 owns the portfolio and holdout policy; where
   140	    no equivalent aid exists, aid-assisted and bare-start
   141	    configurations publish separately.
   142	11. **Attribution symmetry:** lane reports and correction-loop content
   143	    (both vendors') are part of the public record — including runs
   144	    unfavorable to Snapback; the credibility of the
   145	    five-measurement-run, four-published-consumer-audit honesty
   146	    discipline is the asset. The canonical class `snapback-defect`
   147	    means a defect in the platform under test for every lane and
   148	    includes platform-owned documentation, templates, CLI, SDK, and
   149	    runtime — not only the backend. Charts may add a component label
   150	    such as `docs` or `backend`, but may not turn "zero backend loops"
   151	    into "zero platform loops."
   152	12. **Recomputed publication.** Tables and charts are produced from the
   153	    committed machine records by a checked publisher that verifies
   154	    schema conformance, evidence pointers, record digests, aggregation,
   155	    and disclosure completeness. The headline ratio convention is
   156	    predeclared: ratio of lane medians for the primary chart, with the
   157	    median of paired repetition ratios and all raw values shown beside
   158	    it. Hand-transcribed arithmetic is not a publication source.
   159	
   160	## What publishing looks like
   161	
   162	A benchmarks page on the LLP 0195 site: a program-history narrative
   163	that contains NO cross-vendor numbers or ratios — the single-run era
   164	(including the losing origin run, diary
   165	`0058-relay-room-expo-backend-bakeoff`) is told as dated prose with
   166	links to the raw records, because a comparative chart communicates a
   167	comparison whatever its label; the current N≥3 medians as the only
   168	comparative presentation, with distribution and action-economy views;
   169	links to briefs/records/prompts/proof receipts; a "run it yourself"
   170	section stating expected run cost; and the reproducibility manifest per
   171	record. Aid-assisted and holdout results are visually distinct. No
   172	superlatives that a record and its scoped evidence cannot back.
   173	
   174	The first implementation step is therefore not a marketing page. It is
   175	to extend the machine-record schema and harness capture, counterbalance
   176	an N≥3 calibration set, and build the deterministic record-to-chart
   177	check. Existing historical records remain visible with their missing
   178	fields labeled; they are not silently upgraded from diary prose.
   179	
   180	## Acceptance criteria
   181	
   182	This RFC is implementable when:
   183	
   184	1. the protocol, schema, and lane runner encode the ordering, cache,
   185	   action-trace, proof-receipt, and aid fields above;
   186	2. an N≥3 calibration set validates every machine record and exposes
   187	   all constituent values without transcript reconstruction;
   188	3. the checked publisher reproduces every displayed aggregate from the
   189	   committed records and fails closed on missing claim evidence;
   190	4. at least one aid-assisted result and, before making a generality
   191	   claim, one eligible holdout result meet the same disclosure bar; and
   192	5. a person outside the benchmark run can follow the public rerun
   193	   instructions and obtain a valid record, even if their result differs
   194	   because agent execution is nondeterministic.
   195	
   196	## Author decisions required
   197	
   198	- D1: Whether to publish at all and when (proposal: after the N≥3
   199	  calibration set and the equal-proof-bar run, not before).
   200	- D2: Which competitors appear (Convex is measured; Supabase/
   201	  PocketBase/Postgres lanes are unbuilt — publishing claims about
   202	  unmeasured competitors is out under this standard).
   203	- D3: Whether competitor names appear in charts or as "backend A/B"
   204	  (proposal: names, with rule 3's reproducibility as the defense).
   205	- D4: Whether the first publication waits for a holdout brief
   206	  (proposal: required only for a generality claim; a clearly labeled
   207	  recommended-path/aid-assisted claim may publish earlier).
   208	
   209	## Open questions
   210	
   211	- OQ1: Token-count comparability across models if the harness ever runs
   212	  on non-Fable models (current standard: one model per published
   213	  series, stated).
   214	- OQ2: Whether an independent third party rerunning the harness is
   215	  worth soliciting before first publication (strongest possible
   216	  credibility; costs a relationship and time).
   217	- OQ3: Which trace representation preserves enough evidence to audit
   218	  semantic action classification without publishing prompts, secrets,
   219	  or proprietary harness internals.
   220	- OQ4: What cache posture best represents a real first use while still
   221	  being portable across npm, package managers, and competitor CLIs.

codex
The first concrete merge defect is a stale normative seam: LLP 0196 still delegates fairness to “LLP 0197 rules 4a/4b,” but r7’s twelve-rule structure moved that policy to rule 10 and no longer has 4a/4b. I’m now checking whether the surrounding holdout language also preserved rule 10’s broader “any aid,” rather than only templates.
exec
/bin/zsh -lc "rg -n -C 3 '4a|4b|holdout|starter|carrier|structured|bootstrap|runtime export|receipt|pinned model|familiarity|raw tool|private originals|balanced schedule|N≥3' 0193-errors-as-docs-completeness.plan.md 0194-generated-api-reference.rfc.md 0195-public-documentation-and-training-surface.rfc.md 0196-template-and-recipe-portfolio.plan.md 0197-benchmark-publication-standard.rfc.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6
 succeeded in 0ms:
0197-benchmark-publication-standard.rfc.md-8-**Revised:** 2026-08-08 (r7, author-merge: Charlie's restructure after the
0197-benchmark-publication-standard.rfc.md-9-first harness-native run — counterbalanced repetitions, mandatory machine
0197-benchmark-publication-standard.rfc.md-10-records, action-economy evidence with semantic action classes,
0197-benchmark-publication-standard.rfc.md:11:receipt-backed proof over LLP 0146 verify, the `snapback-defect`
0197-benchmark-publication-standard.rfc.md-12-attribution class, recomputed publication via a checked publisher,
0197-benchmark-publication-standard.rfc.md-13-implementation-first sequencing, Acceptance criteria, D4 and OQ3/OQ4 —
0197-benchmark-publication-standard.rfc.md-14-merged onto the r6 review spine, which contributes the corrected series
--
0197-benchmark-publication-standard.rfc.md-18-no-cross-vendor-numbers history-narrative rule.) 2026-08-08 (r6/r5/r4/r2/r1
0197-benchmark-publication-standard.rfc.md-19-— see llp/reviews/0193-*.run.md for the full round ledger.)
0197-benchmark-publication-standard.rfc.md-20-**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
0197-benchmark-publication-standard.rfc.md:21:(harness, records), LLP 0146 (`snapback verify` receipt), LLP 0195
0197-benchmark-publication-standard.rfc.md-22-(public surface), LLP 0196 (template portfolio), diaries
0197-benchmark-publication-standard.rfc.md-23-0058 (`0058-relay-room-expo-backend-bakeoff`)/0065
0197-benchmark-publication-standard.rfc.md-24-(`0065-rematch-published-closure-bakeoff`)/0066/0068/0069
--
0197-benchmark-publication-standard.rfc.md-36-makes a public comparison credible rather than vendor noise; this RFC
0197-benchmark-publication-standard.rfc.md-37-proposes the standard. The governing principle is **publish the
0197-benchmark-publication-standard.rfc.md-38-instrument, not just the number**: every claim must be inspectable from
0197-benchmark-publication-standard.rfc.md:39:public artifacts and rerunnable wherever the pinned model and harness
0197-benchmark-publication-standard.rfc.md-40-are available; "reproduced" is reserved for observed reruns.
0197-benchmark-publication-standard.rfc.md-41-
0197-benchmark-publication-standard.rfc.md-42-## The standard
0197-benchmark-publication-standard.rfc.md-43-
0197-benchmark-publication-standard.rfc.md-44-A published Snapback benchmark claim requires:
0197-benchmark-publication-standard.rfc.md-45-
0197-benchmark-publication-standard.rfc.md:46:1. **N≥3 runs per configuration, preregistered**, with all runs
0197-benchmark-publication-standard.rfc.md-47-   reported (no best-of, no post-hoc configuration designation): the
0197-benchmark-publication-standard.rfc.md-48-   run matrix — configurations, budgets, stopping and exclusion rules,
0197-benchmark-publication-standard.rfc.md-49-   frozen harness/prompt commits, attempt IDs, and the rule-7
--
0197-benchmark-publication-standard.rfc.md-55-   W1 protocol.
0197-benchmark-publication-standard.rfc.md-56-2. **Counterbalanced repetitions.** Lanes remain serial and
0197-benchmark-publication-standard.rfc.md-57-   same-machine within a comparison set, but their order rotates across
0197-benchmark-publication-standard.rfc.md:58:   repetitions using a predeclared balanced schedule. The record pins
0197-benchmark-publication-standard.rfc.md-59-   machine state and load, package-manager/cache posture, fresh versus
0197-benchmark-publication-standard.rfc.md-60-   reused backend state, occupied ports, model, effort, harness, and
0197-benchmark-publication-standard.rfc.md-61-   package versions. A favorable lane may not always receive the same
--
0197-benchmark-publication-standard.rfc.md-76-   linked to those records, not used as a substitute for them. Missing
0197-benchmark-publication-standard.rfc.md-77-   metrics remain explicit nulls and cannot support a derived claim.
0197-benchmark-publication-standard.rfc.md-78-5. **Action-economy evidence, not only aggregate tool counts.** Each
0197-benchmark-publication-standard.rfc.md:79:   record retains raw tool invocations, input/output/cache token fields
0197-benchmark-publication-standard.rfc.md-80-   exposed by the harness, phase times, and a sanitized action trace.
0197-benchmark-publication-standard.rfc.md-81-   The trace classifies at least guide/reference lookups,
0197-benchmark-publication-standard.rfc.md-82-   package-source reads, binary/string excavation, edits, process
--
0197-benchmark-publication-standard.rfc.md-86-   passes through the publication-safe artifact schema — automated
0197-benchmark-publication-standard.rfc.md-87-   secret/credential/PII and private-material scanning, path and
0197-benchmark-publication-standard.rfc.md-88-   machine-identifier scrubbing with documented redactions and reason
0197-benchmark-publication-standard.rfc.md:89:   codes, retained hashes of private originals, and a human with
0197-benchmark-publication-standard.rfc.md-90-   repository-disclosure authority reviewing before anything ships —
0197-benchmark-publication-standard.rfc.md-91-   and may not remove the action class, timestamp, result status, or a
0197-benchmark-publication-standard.rfc.md-92-   stable evidence pointer. Raw transcripts never publish.
0197-benchmark-publication-standard.rfc.md-93-6. **Fairness notes attached to every chart:** cold-context agents;
0197-benchmark-publication-standard.rfc.md-94-   published surfaces only; same model, effort, and within-set machine;
0197-benchmark-publication-standard.rfc.md-95-   counterbalanced serial discipline; competitor lanes free to use web
0197-benchmark-publication-standard.rfc.md:96:   docs; model prior-familiarity asymmetry stated plainly where it can
0197-benchmark-publication-standard.rfc.md:97:   be supported. Prior familiarity is a caveat, not a numeric causal
0197-benchmark-publication-standard.rfc.md-98-   adjustment.
0197-benchmark-publication-standard.rfc.md-99-7. **Proof-bar disclosure:** every chart states what each lane proved.
0197-benchmark-publication-standard.rfc.md-100-   The headline chart should be the **equal-proof-bar variant**
--
0197-benchmark-publication-standard.rfc.md-109-   duration, silently excluded, or substituted with a weaker result.
0197-benchmark-publication-standard.rfc.md-110-   7b. **Denominator-aware ratio floor:** attempt counts per lane are
0197-benchmark-publication-standard.rfc.md-111-   equal and preregistered; a ratio requires the preregistered minimum
0197-benchmark-publication-standard.rfc.md:112:   successful observations per lane (N≥3 successes — the same floor as
0197-benchmark-publication-standard.rfc.md-113-   rule 1's run count, applied to successes) AND a preregistered
0197-benchmark-publication-standard.rfc.md-114-   minimum success rate; when either lane misses either criterion, or
0197-benchmark-publication-standard.rfc.md-115-   success rates differ beyond the preregistered threshold, the ratio
--
0197-benchmark-publication-standard.rfc.md-118-   itself.
0197-benchmark-publication-standard.rfc.md-119-8. **Receipt-backed proof.** A lane's final report is evidence, not the
0197-benchmark-publication-standard.rfc.md-120-   proof oracle. The harness independently executes the brief's
0197-benchmark-publication-standard.rfc.md:121:   acceptance checks and retains their receipts and UI artifacts. A
0197-benchmark-publication-standard.rfc.md-122-   Snapback lane reuses the canonical LLP 0146 `snapback verify`
0197-benchmark-publication-standard.rfc.md:123:   profiles and receipt rather than inventing a second system verifier;
0197-benchmark-publication-standard.rfc.md-124-   the neutral benchmark checker then grades the brief-level claims for
0197-benchmark-publication-standard.rfc.md-125-   every lane. Any proof that still needs human judgment is identified
0197-benchmark-publication-standard.rfc.md-126-   and its evidence retained.
0197-benchmark-publication-standard.rfc.md-127-9. **Version pinning:** every run names the exact closure and
0197-benchmark-publication-standard.rfc.md-128-   competitor versions; claims age out when either moves materially.
0197-benchmark-publication-standard.rfc.md:129:10. **Aid and starter disclosure.** Every lane names any official
0197-benchmark-publication-standard.rfc.md:130:    starter, template, recipe, published example app, skill content, or
0197-benchmark-publication-standard.rfc.md-131-    generated scaffold it used — any vendor-authored
0197-benchmark-publication-standard.rfc.md-132-    benchmark-targeted artifact (including examples LLP 0195 publishes)
0197-benchmark-publication-standard.rfc.md-133-    — with its version and the policy that made it eligible.
--
0197-benchmark-publication-standard.rfc.md-135-    accelerators under predeclared selection criteria. An aid-assisted
0197-benchmark-publication-standard.rfc.md-136-    result is a valid measure of the recommended path but is labeled as
0197-benchmark-publication-standard.rfc.md-137-    such; a broad claim about authoring-surface generality additionally
0197-benchmark-publication-standard.rfc.md:138:    needs a predeclared holdout brief not substantially implemented by
0197-benchmark-publication-standard.rfc.md:139:    any such aid. LLP 0196 owns the portfolio and holdout policy; where
0197-benchmark-publication-standard.rfc.md-140-    no equivalent aid exists, aid-assisted and bare-start
0197-benchmark-publication-standard.rfc.md-141-    configurations publish separately.
0197-benchmark-publication-standard.rfc.md-142-11. **Attribution symmetry:** lane reports and correction-loop content
--
0197-benchmark-publication-standard.rfc.md-164-(including the losing origin run, diary
0197-benchmark-publication-standard.rfc.md-165-`0058-relay-room-expo-backend-bakeoff`) is told as dated prose with
0197-benchmark-publication-standard.rfc.md-166-links to the raw records, because a comparative chart communicates a
0197-benchmark-publication-standard.rfc.md:167:comparison whatever its label; the current N≥3 medians as the only
0197-benchmark-publication-standard.rfc.md-168-comparative presentation, with distribution and action-economy views;
0197-benchmark-publication-standard.rfc.md:169:links to briefs/records/prompts/proof receipts; a "run it yourself"
0197-benchmark-publication-standard.rfc.md-170-section stating expected run cost; and the reproducibility manifest per
0197-benchmark-publication-standard.rfc.md:171:record. Aid-assisted and holdout results are visually distinct. No
0197-benchmark-publication-standard.rfc.md-172-superlatives that a record and its scoped evidence cannot back.
0197-benchmark-publication-standard.rfc.md-173-
0197-benchmark-publication-standard.rfc.md-174-The first implementation step is therefore not a marketing page. It is
0197-benchmark-publication-standard.rfc.md-175-to extend the machine-record schema and harness capture, counterbalance
0197-benchmark-publication-standard.rfc.md:176:an N≥3 calibration set, and build the deterministic record-to-chart
0197-benchmark-publication-standard.rfc.md-177-check. Existing historical records remain visible with their missing
0197-benchmark-publication-standard.rfc.md-178-fields labeled; they are not silently upgraded from diary prose.
0197-benchmark-publication-standard.rfc.md-179-
--
0197-benchmark-publication-standard.rfc.md-182-This RFC is implementable when:
0197-benchmark-publication-standard.rfc.md-183-
0197-benchmark-publication-standard.rfc.md-184-1. the protocol, schema, and lane runner encode the ordering, cache,
0197-benchmark-publication-standard.rfc.md:185:   action-trace, proof-receipt, and aid fields above;
0197-benchmark-publication-standard.rfc.md:186:2. an N≥3 calibration set validates every machine record and exposes
0197-benchmark-publication-standard.rfc.md-187-   all constituent values without transcript reconstruction;
0197-benchmark-publication-standard.rfc.md-188-3. the checked publisher reproduces every displayed aggregate from the
0197-benchmark-publication-standard.rfc.md-189-   committed records and fails closed on missing claim evidence;
0197-benchmark-publication-standard.rfc.md-190-4. at least one aid-assisted result and, before making a generality
0197-benchmark-publication-standard.rfc.md:191:   claim, one eligible holdout result meet the same disclosure bar; and
0197-benchmark-publication-standard.rfc.md-192-5. a person outside the benchmark run can follow the public rerun
0197-benchmark-publication-standard.rfc.md-193-   instructions and obtain a valid record, even if their result differs
0197-benchmark-publication-standard.rfc.md-194-   because agent execution is nondeterministic.
0197-benchmark-publication-standard.rfc.md-195-
0197-benchmark-publication-standard.rfc.md-196-## Author decisions required
0197-benchmark-publication-standard.rfc.md-197-
0197-benchmark-publication-standard.rfc.md:198:- D1: Whether to publish at all and when (proposal: after the N≥3
0197-benchmark-publication-standard.rfc.md-199-  calibration set and the equal-proof-bar run, not before).
0197-benchmark-publication-standard.rfc.md-200-- D2: Which competitors appear (Convex is measured; Supabase/
0197-benchmark-publication-standard.rfc.md-201-  PocketBase/Postgres lanes are unbuilt — publishing claims about
0197-benchmark-publication-standard.rfc.md-202-  unmeasured competitors is out under this standard).
0197-benchmark-publication-standard.rfc.md-203-- D3: Whether competitor names appear in charts or as "backend A/B"
0197-benchmark-publication-standard.rfc.md-204-  (proposal: names, with rule 3's reproducibility as the defense).
0197-benchmark-publication-standard.rfc.md:205:- D4: Whether the first publication waits for a holdout brief
0197-benchmark-publication-standard.rfc.md-206-  (proposal: required only for a generality claim; a clearly labeled
0197-benchmark-publication-standard.rfc.md-207-  recommended-path/aid-assisted claim may publish earlier).
0197-benchmark-publication-standard.rfc.md-208-
--
0194-generated-api-reference.rfc.md-8-**Revised:** 2026-08-08 (r7, author-merge: Charlie's action-economy revision
0194-generated-api-reference.rfc.md-9-— a canonical machine-readable symbol registry becomes the authority behind
0194-generated-api-reference.rfc.md-10-Markdown, CLI, and MCP projections; a published `ctx` declaration source is
0194-generated-api-reference.rfc.md:11:required with hand-fenced prose permitted only as a temporary bootstrap
0194-generated-api-reference.rfc.md-12-[author decision, reversing the loop's no-interim rule]; Acceptance section
0194-generated-api-reference.rfc.md-13-added — merged onto the r6 review spine, keeping the round-verified facts:
0194-generated-api-reference.rfc.md-14-verify-config's declaration source already exists and sits in the initial
--
0194-generated-api-reference.rfc.md-39-## Design
0194-generated-api-reference.rfc.md-40-
0194-generated-api-reference.rfc.md-41-1. **Declaration sources:** the published packages' `.d.mts` files plus
0194-generated-api-reference.rfc.md:42:   doc comments, checked against the runtime export map. The handler
0194-generated-api-reference.rfc.md-43-   `ctx` surface gains a published declaration source too; a hand-fenced
0194-generated-api-reference.rfc.md:44:   prose section is permitted only as a temporary bootstrap and is not
0194-generated-api-reference.rfc.md-45-   the target design.
0194-generated-api-reference.rfc.md-46-2. **Canonical symbol registry:** a build step using the TypeScript
0194-generated-api-reference.rfc.md-47-   compiler API and the export-parity traversal emits one build-bound
0194-generated-api-reference.rfc.md:48:   registry. Each symbol records package/module, runtime export names,
0194-generated-api-reference.rfc.md-49-   complete signature, overload/member structure, doc text, source
0194-generated-api-reference.rfc.md-50-   provenance, stable identity, and closure applicability. No projection
0194-generated-api-reference.rfc.md-51-   independently parses or rewrites the public API.
--
0194-generated-api-reference.rfc.md-62-   the guide manifest — served under `/_snapback/guide/reference/`,
0194-generated-api-reference.rfc.md-63-   indexed by `snapback guide <query>` and MCP, and listed in
0194-generated-api-reference.rfc.md-64-   `/llms.txt`. The oversized flat projection remains an explicit
0194-generated-api-reference.rfc.md:65:   fallback, not the primary reference carrier
0194-generated-api-reference.rfc.md-66-   (`issues/20260806-guide-flat-projection-oversize.md`).
0194-generated-api-reference.rfc.md-67-6. **Joins:** intent pages link into reference anchors ("full signature:
0194-generated-api-reference.rfc.md-68-   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
--
0194-generated-api-reference.rfc.md-91-
0194-generated-api-reference.rfc.md-92-## Acceptance
0194-generated-api-reference.rfc.md-93-
0194-generated-api-reference.rfc.md:94:1. Registry/runtime export parity fails if a declared symbol is absent
0194-generated-api-reference.rfc.md:95:   at runtime or a public runtime export lacks a registry entry.
0194-generated-api-reference.rfc.md-96-2. The `ctx` handler surface is available to consumers as declarations
0194-generated-api-reference.rfc.md-97-   and in the same registry as package APIs.
0194-generated-api-reference.rfc.md-98-3. A cold signature-task suite covering headless args nesting,
--
0193-errors-as-docs-completeness.plan.md-8-**Revised:** 2026-08-08 (r7, author-merge: Charlie's reconciliation —
0193-errors-as-docs-completeness.plan.md-9-the evidence claim narrowed to the refusal-reachable three-of-six subset
0193-errors-as-docs-completeness.plan.md-10-with the rest routed to 0194/0196; the ledger grades resolution quality
0193-errors-as-docs-completeness.plan.md:11:and closure binding (carrier/target/applicability/one-attempt witness
0193-errors-as-docs-completeness.plan.md-12-fields); exit criterion 5 adds the one-attempt recovery test; OQ1 recast
0193-errors-as-docs-completeness.plan.md-13-as migration cadence — merged onto the r6 review spine, keeping the
0193-errors-as-docs-completeness.plan.md-14-retained-exemplar corrections, the ~2,700-symbol population note, the
0193-errors-as-docs-completeness.plan.md:15:OQ6 carrier dependency, mechanical reclassification refusal, and
0193-errors-as-docs-completeness.plan.md-16-post-run grading.) 2026-08-08 (r6, this document: sibling-ticket provenance corrected (excursion vs product-half fix), retrofit removed from the observed list, reclassification refusal made mechanical + exit-criterion negative test, post-run grading outside the metered window. UNREVIEWED — applied after the final authorized round; every change resolves an enumerated round-5 concern.) 2026-08-08 (r5, this document: exemplar reattributed (assets-put-user is the retrofit case, ticket-cited); reclassification gating in Phase 3; 0065 slug.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations; 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
0193-errors-as-docs-completeness.plan.md-17-dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
0193-errors-as-docs-completeness.plan.md-18-unretained/incorrect quantitative claims corrected to retained-artifact
--
0193-errors-as-docs-completeness.plan.md-66-  (`issues/closed/20260805-result-contract-violation-hashes-field-path.md`).
0193-errors-as-docs-completeness.plan.md-67-- The infrastructure half-exists: stable code registry, the
0193-errors-as-docs-completeness.plan.md-68-  production diagnostic-inventory drift gate, and 0146 D7 ratified as
0193-errors-as-docs-completeness.plan.md:69:  the remediation carrier.
0193-errors-as-docs-completeness.plan.md-70-
0193-errors-as-docs-completeness.plan.md-71-## Program
0193-errors-as-docs-completeness.plan.md-72-
--
0193-errors-as-docs-completeness.plan.md-77-plus a grep sweep for unregistered emissions. Fan out grading lanes:
0193-errors-as-docs-completeness.plan.md-78-each code graded A (names rule + current fix/anchor), B (names rule
0193-errors-as-docs-completeness.plan.md-79-only), or C (bare). The ledger also records the emitting site,
0193-errors-as-docs-completeness.plan.md:80:agent-triggerability, remediation carrier
0193-errors-as-docs-completeness.plan.md:81:(`structured | message | guide | reference`), target, closure/version
0193-errors-as-docs-completeness.plan.md-82-applicability, anchor/symbol resolution, and whether a cold one-attempt
0193-errors-as-docs-completeness.plan.md-83-recovery witness exists. Output: a checked-in graded ledger under
0193-errors-as-docs-completeness.plan.md-84-`tests/acceptance/diagnostics/`.
--
0193-errors-as-docs-completeness.plan.md-97-
0193-errors-as-docs-completeness.plan.md-98-**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
0193-errors-as-docs-completeness.plan.md-99-a new agent-triggerable code cannot land without a remediation in the
0193-errors-as-docs-completeness.plan.md:100:carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
0193-errors-as-docs-completeness.plan.md-101-floor. The typed-remediation end state is 0146's ratified D7 and is not
0193-errors-as-docs-completeness.plan.md:102:reopened here; the carrier choice is OQ6's open ruling
0193-errors-as-docs-completeness.plan.md:103:(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
0193-errors-as-docs-completeness.plan.md:104:named dependency of this phase's structured half — until it rules, the
0193-errors-as-docs-completeness.plan.md-105-gate enforces text+anchor as a bounded interim floor, upgraded
0193-errors-as-docs-completeness.plan.md:106:code-by-code as the carrier lands (new codes use the structured carrier
0193-errors-as-docs-completeness.plan.md-107-once it exists; audited legacy codes may hold the floor until touched).
0193-errors-as-docs-completeness.plan.md-108-Anchor and generated-symbol resolution join CI. The graded ledger
0193-errors-as-docs-completeness.plan.md-109-becomes the gate's baseline; grade or closure-applicability regressions
--
0193-errors-as-docs-completeness.plan.md-137-## Open questions
0193-errors-as-docs-completeness.plan.md-138-
0193-errors-as-docs-completeness.plan.md-139-- OQ1: Migration cadence — how quickly audited legacy codes graduate
0193-errors-as-docs-completeness.plan.md:140:  from the text+anchor floor to D7's structured `remediations` carrier
0193-errors-as-docs-completeness.plan.md:141:  once the 0146 OQ6 carrier ruling lands. New codes use the structured
0193-errors-as-docs-completeness.plan.md:142:  carrier from that point; the open question is cadence, not the target
0193-errors-as-docs-completeness.plan.md:143:  shape (settled by 0146's ratified D7). Proposal: structured on next
0193-errors-as-docs-completeness.plan.md:144:  touch, dated full-migration milestone set when the carrier ships.
0193-errors-as-docs-completeness.plan.md-145-- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
0193-errors-as-docs-completeness.plan.md-146-  from any published-surface operation, decided by the grading lane,
0193-errors-as-docs-completeness.plan.md-147-  spot-checked in review.
--
0196-template-and-recipe-portfolio.plan.md-6-**Author:** Charlie Cheever / Claude
0196-template-and-recipe-portfolio.plan.md-7-**Date:** 2026-08-08
0196-template-and-recipe-portfolio.plan.md-8-**Revised:** 2026-08-08 (r7, author-merge: Charlie's action-economy
0196-template-and-recipe-portfolio.plan.md:9:revision — T0 completes the existing chat starter before portfolio breadth;
0196-template-and-recipe-portfolio.plan.md-10-every template exposes one proof command delegating to LLP 0146 D2's
0196-template-and-recipe-portfolio.plan.md-11-`snapback verify`; the headless-simulator recipe becomes an executable
0196-template-and-recipe-portfolio.plan.md:12:carrier kit registered under the verify profile; exit criteria add
0196-template-and-recipe-portfolio.plan.md:13:zero-source-read and semantic-action measures; OQ3 holdout/starter
0196-template-and-recipe-portfolio.plan.md-14-eligibility — merged onto the r6 review spine, keeping the two-gate T5
0196-template-and-recipe-portfolio.plan.md-15-split, capability-surface wording, and template-assisted labeling.) 2026-08-08 (r5, this document: no body change this round.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain: capability-surface wording, T5 two-gate split, template-assisted labeling + held-out-brief rule. 2026-08-08 (r1) — super-refine round-1 revision against the
0196-template-and-recipe-portfolio.plan.md-16-dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
--
0196-template-and-recipe-portfolio.plan.md-40-
0196-template-and-recipe-portfolio.plan.md-41-## Program
0196-template-and-recipe-portfolio.plan.md-42-
0196-template-and-recipe-portfolio.plan.md:43:**T0 — complete the existing Expo chat starter.** Before adding
0196-template-and-recipe-portfolio.plan.md-44-portfolio breadth, absorb the common messaging work every measured lane
0196-template-and-recipe-portfolio.plan.md-45-still authors: memberships/DM-vs-group shape, reply pointers, reactions,
0196-template-and-recipe-portfolio.plan.md-46-and the labeled test persona switcher, with acceptance profiles covering
--
0196-template-and-recipe-portfolio.plan.md-55-query profile in the default path, sessions default, acceptance suite +
0196-template-and-recipe-portfolio.plan.md-56-**registered verify profile** included. Most agent tasks are CRUD-shaped;
0196-template-and-recipe-portfolio.plan.md-57-this becomes the default recommendation for generic briefs. LLP 0197's
0196-template-and-recipe-portfolio.plan.md:58:aid-disclosure and holdout rules prevent this brief pairing from
0196-template-and-recipe-portfolio.plan.md-59-standing alone as a public generalization claim.
0196-template-and-recipe-portfolio.plan.md-60-
0196-template-and-recipe-portfolio.plan.md-61-**T2 — media-feed template** (`--template media-feed`), exercising the
--
0196-template-and-recipe-portfolio.plan.md-69-and the expo templates ship web platform + deps (the two-run web-deps
0196-template-and-recipe-portfolio.plan.md-70-papercut, ticketed 2026-08-08 — absorbed here). Every template also
0196-template-and-recipe-portfolio.plan.md-71-exposes one ordinary proof command (for example `bun run prove`) that
0196-template-and-recipe-portfolio.plan.md:72:delegates to LLP 0146 D2's `snapback verify`, retains its receipt
0196-template-and-recipe-portfolio.plan.md:73:identity and `next[]`, and adds no second verifier, receipt format, or
0196-template-and-recipe-portfolio.plan.md-74-product-completeness claim.
0196-template-and-recipe-portfolio.plan.md-75-
0196-template-and-recipe-portfolio.plan.md:76:**T4 — recipes and executable carrier kits.** Guide sections keep
0196-template-and-recipe-portfolio.plan.md-77-CI-verified explanation, but the headless-simulator path is executable:
0196-template-and-recipe-portfolio.plan.md-78-one bounded command/helper owns simulator boot/install/launch, scheme
0196-template-and-recipe-portfolio.plan.md-79-approval, Expo Go onboarding dismissal, deep-link drive, screenshots,
--
0196-template-and-recipe-portfolio.plan.md-97-## Sequencing
0196-template-and-recipe-portfolio.plan.md-98-
0196-template-and-recipe-portfolio.plan.md-99-T3 first (papercut absorption + verify-by-default — small), then T0 so
0196-template-and-recipe-portfolio.plan.md:100:the already-published starter stops making every messaging lane rebuild
0196-template-and-recipe-portfolio.plan.md-101-common breadth. T1 and T2 follow; T4 executable paths land alongside the
0196-template-and-recipe-portfolio.plan.md-102-first template that exercises them. T5 joins the release checklist when
0196-template-and-recipe-portfolio.plan.md-103-T1 lands.
--
0196-template-and-recipe-portfolio.plan.md-107-- A cold agent given a CRUD or media brief scaffolds the matching
0196-template-and-recipe-portfolio.plan.md-108-  template and reaches all proofs with zero template-gap loops.
0196-template-and-recipe-portfolio.plan.md-109-- `snapback verify` is non-vacuous on every fresh scaffold, and the
0196-template-and-recipe-portfolio.plan.md:110:  template-level proof command produces the same LLP 0146 D2 receipt a
0196-template-and-recipe-portfolio.plan.md-111-  direct invocation would.
0196-template-and-recipe-portfolio.plan.md-112-- Cold template lanes perform zero package-source reads and zero
0196-template-and-recipe-portfolio.plan.md-113-  binary-string excavation.
--
0196-template-and-recipe-portfolio.plan.md-120-  template-assisted results are never published as general
0196-template-and-recipe-portfolio.plan.md-121-  authoring-efficiency claims: portfolio-level claims require success
0196-template-and-recipe-portfolio.plan.md-122-  on a held-out brief variant not used to design any template, and
0196-template-and-recipe-portfolio.plan.md:123:  competitor lanes get a symmetric starter-availability policy
0196-template-and-recipe-portfolio.plan.md:124:  (LLP 0197 rules 4a/4b govern).
0196-template-and-recipe-portfolio.plan.md-125-
0196-template-and-recipe-portfolio.plan.md-126-## Open questions
0196-template-and-recipe-portfolio.plan.md-127-
--
0196-template-and-recipe-portfolio.plan.md-129-  (three app templates + recipes); additions require a measured brief.
0196-template-and-recipe-portfolio.plan.md-130-- OQ2: Whether `create-snapback-app` grows an interactive template
0196-template-and-recipe-portfolio.plan.md-131-  picker or stays flag-driven (agents prefer flags; humans may not).
0196-template-and-recipe-portfolio.plan.md:132:- OQ3: Holdout selection and official-starter eligibility for public
0196-template-and-recipe-portfolio.plan.md-133-  comparisons. LLP 0197 owns the disclosure rule; this Plan must supply
0196-template-and-recipe-portfolio.plan.md-134-  at least one workload not directly solved by a template added for its
0196-template-and-recipe-portfolio.plan.md-135-  brief.
--
0195-public-documentation-and-training-surface.rfc.md-10-binds to a qualified closure/content digest rather than moving HEAD; public
0195-public-documentation-and-training-surface.rfc.md-11-examples become generated projections with a single canonical owner; the
0195-public-documentation-and-training-surface.rfc.md-12-two-clocks success measures separate immediate retrieval from long-horizon
0195-public-documentation-and-training-surface.rfc.md:13:training familiarity — merged onto the r6 review spine, which keeps the
0195-public-documentation-and-training-surface.rfc.md-14-retained "dominant term" citation, the four-audit count, and the
0195-public-documentation-and-training-surface.rfc.md-15-instrumented-hypothesis framing.) 2026-08-08 (r5, this document: 0065 citation slug only.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
0195-public-documentation-and-training-surface.rfc.md-16-dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
--
0195-public-documentation-and-training-surface.rfc.md-28-origins. Meanwhile the measurement series calls orientation cost "the dominant
0195-public-documentation-and-training-surface.rfc.md-29-term" in the remaining efficiency gap (diary 0069) — cost the Convex
0195-public-documentation-and-training-surface.rfc.md-30-lanes did not pay: across all five runs they consumed no documentation
0195-public-documentation-and-training-surface.rfc.md:31:at all, working from prior model familiarity. A public surface is the pre-install orientation fix and the
0195-public-documentation-and-training-surface.rfc.md-32-discoverability fix on its face; that it also feeds future model
0195-public-documentation-and-training-surface.rfc.md-33-training is a plausible but **unverified hypothesis** — prior
0195-public-documentation-and-training-surface.rfc.md:34:familiarity is measured, its provenance is not. The decision case rests
0195-public-documentation-and-training-surface.rfc.md-35-on discoverability and retrieval; the training effect, if real, is
0195-public-documentation-and-training-surface.rfc.md-36-upside this RFC proposes to instrument rather than assume (OQ4). It
0195-public-documentation-and-training-surface.rfc.md-37-remains the largest unstarted item this program has identified. It is proposed here rather than executed because publishing
--
0195-public-documentation-and-training-surface.rfc.md-80-matches the canonical guide, and a stale or unqualified projection is
0195-public-documentation-and-training-surface.rfc.md-81-not published.
0195-public-documentation-and-training-surface.rfc.md-82-
0195-public-documentation-and-training-surface.rfc.md:83:**Long-horizon familiarity.** A later pinned model epoch may show
0195-public-documentation-and-training-surface.rfc.md-84-reduced orientation time, source reads, or tokens in LLP 0186 W1. That
0195-public-documentation-and-training-surface.rfc.md-85-trend is measured only when the model/harness epoch changes
0195-public-documentation-and-training-surface.rfc.md-86-deliberately; it is not retroactively attributed to crawler
--
0195-public-documentation-and-training-surface.rfc.md-114-- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
0195-public-documentation-and-training-surface.rfc.md-115-  public anchors, unifying citations across surfaces.
0195-public-documentation-and-training-surface.rfc.md-116-- OQ4: The pinned-model knowledge evaluation — a fixed question set
0195-public-documentation-and-training-surface.rfc.md:117:  about Snapback answered by pinned model builds over time, isolating
0195-public-documentation-and-training-surface.rfc.md-118-  training-data presence from in-context aids; only worth building if
0195-public-documentation-and-training-surface.rfc.md-119-  the training hypothesis starts driving decisions.

exec
/bin/zsh -lc "rg -n 'rule[s -][0-9]+[a-z]?|criterion [0-9]+|OQ[0-9]+|D[0-9]+' *.md" in /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6
 succeeded in 0ms:
0195-public-documentation-and-training-surface.rfc.md:36:upside this RFC proposes to instrument rather than assume (OQ4). It
0195-public-documentation-and-training-surface.rfc.md:55:   complete, proof-carrying, honestly scoped — LLP 0197 rule 10's aid
0195-public-documentation-and-training-surface.rfc.md:70:   orientation cost — so the posture claims no timeline; OQ4 sketches
0195-public-documentation-and-training-surface.rfc.md:87:availability, and no date is promised for training uptake. (OQ4's
0195-public-documentation-and-training-surface.rfc.md:100:- D1: Publish at all, and where (domain; whether the repo itself goes
0195-public-documentation-and-training-surface.rfc.md:102:- D2: Examples licensing and repo location.
0195-public-documentation-and-training-surface.rfc.md:103:- D3: Snapshot policy (per-release docs versions vs latest-only).
0195-public-documentation-and-training-surface.rfc.md:104:- D4: Whether benchmark artifacts (briefs, records) belong on the public
0195-public-documentation-and-training-surface.rfc.md:109:- OQ1: Site generator and hosting (the repo has EAS/Cloudflare lanes;
0195-public-documentation-and-training-surface.rfc.md:111:- OQ2: How the site's `llms.txt` and sitemap best serve crawler and
0195-public-documentation-and-training-surface.rfc.md:114:- OQ3: Whether `snapback guide <query>` gains a `--web` mode linking the
0195-public-documentation-and-training-surface.rfc.md:116:- OQ4: The pinned-model knowledge evaluation — a fixed question set
0196-template-and-recipe-portfolio.plan.md:10:every template exposes one proof command delegating to LLP 0146 D2's
0196-template-and-recipe-portfolio.plan.md:13:zero-source-read and semantic-action measures; OQ3 holdout/starter
0196-template-and-recipe-portfolio.plan.md:19:**Related:** LLP 0146 (D2 verify owner), LLP 0176 (messaging golden
0196-template-and-recipe-portfolio.plan.md:72:delegates to LLP 0146 D2's `snapback verify`, retains its receipt
0196-template-and-recipe-portfolio.plan.md:110:  template-level proof command produces the same LLP 0146 D2 receipt a
0196-template-and-recipe-portfolio.plan.md:128:- OQ1: Template count discipline — the portfolio should stay small
0196-template-and-recipe-portfolio.plan.md:130:- OQ2: Whether `create-snapback-app` grows an interactive template
0196-template-and-recipe-portfolio.plan.md:132:- OQ3: Holdout selection and official-starter eligibility for public
0197-benchmark-publication-standard.rfc.md:13:implementation-first sequencing, Acceptance criteria, D4 and OQ3/OQ4 —
0197-benchmark-publication-standard.rfc.md:15:numbers and directional caveat, rule-1 preregistration items, the
0197-benchmark-publication-standard.rfc.md:20:**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
0197-benchmark-publication-standard.rfc.md:35:a publishable controlled comparison. LLP 0186 OQ5 asked what disclosure
0197-benchmark-publication-standard.rfc.md:49:   frozen harness/prompt commits, attempt IDs, and the rule-7
0197-benchmark-publication-standard.rfc.md:113:   rule 1's run count, applied to successes) AND a preregistered
0197-benchmark-publication-standard.rfc.md:198:- D1: Whether to publish at all and when (proposal: after the N≥3
0197-benchmark-publication-standard.rfc.md:200:- D2: Which competitors appear (Convex is measured; Supabase/
0197-benchmark-publication-standard.rfc.md:203:- D3: Whether competitor names appear in charts or as "backend A/B"
0197-benchmark-publication-standard.rfc.md:204:  (proposal: names, with rule 3's reproducibility as the defense).
0197-benchmark-publication-standard.rfc.md:205:- D4: Whether the first publication waits for a holdout brief
0197-benchmark-publication-standard.rfc.md:211:- OQ1: Token-count comparability across models if the harness ever runs
0197-benchmark-publication-standard.rfc.md:214:- OQ2: Whether an independent third party rerunning the harness is
0197-benchmark-publication-standard.rfc.md:217:- OQ3: Which trace representation preserves enough evidence to audit
0197-benchmark-publication-standard.rfc.md:220:- OQ4: What cache posture best represents a real first use while still
0193-errors-as-docs-completeness.plan.md:12:fields); exit criterion 5 adds the one-attempt recovery test; OQ1 recast
0193-errors-as-docs-completeness.plan.md:15:OQ6 carrier dependency, mechanical reclassification refusal, and
0193-errors-as-docs-completeness.plan.md:20:**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
0193-errors-as-docs-completeness.plan.md:68:  production diagnostic-inventory drift gate, and 0146 D7 ratified as
0193-errors-as-docs-completeness.plan.md:100:carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
0193-errors-as-docs-completeness.plan.md:101:floor. The typed-remediation end state is 0146's ratified D7 and is not
0193-errors-as-docs-completeness.plan.md:102:reopened here; the carrier choice is OQ6's open ruling
0193-errors-as-docs-completeness.plan.md:132:   validation of criterion 2, not a substitute for it.
0193-errors-as-docs-completeness.plan.md:139:- OQ1: Migration cadence — how quickly audited legacy codes graduate
0193-errors-as-docs-completeness.plan.md:140:  from the text+anchor floor to D7's structured `remediations` carrier
0193-errors-as-docs-completeness.plan.md:141:  once the 0146 OQ6 carrier ruling lands. New codes use the structured
0193-errors-as-docs-completeness.plan.md:143:  shape (settled by 0146's ratified D7). Proposal: structured on next
0193-errors-as-docs-completeness.plan.md:145:- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
0194-generated-api-reference.rfc.md:17:declaration source already exists and is published (round-4 find); OQ2
0194-generated-api-reference.rfc.md:68:   reference/…#liveQuery"); diagnostics and D7 remediations (LLP 0193)
0194-generated-api-reference.rfc.md:77:   lands (OQ2 owns placement), ordered immediately after.
0194-generated-api-reference.rfc.md:85:initial scope. Contingent on OQ2's `ctx` declaration landing: `ctx.db`
0194-generated-api-reference.rfc.md:87:excursion, the strongest argument for scheduling OQ2 early. Diary 0069
0194-generated-api-reference.rfc.md:110:- OQ1: Initial registry and projection size budgets. Per-package
0194-generated-api-reference.rfc.md:113:- OQ2: Which published package/module owns the `ctx` declaration file.
0194-generated-api-reference.rfc.md:118:- OQ3: Whether doc comments in `.d.mts` are complete enough to render
0194-generated-api-reference.rfc.md:121:- OQ4: Versioning — the served reference is build-bound, which is
CONTEXT.md:28:errors bar; W4 edit-loop taxes), 0146 (agent affordances; D7 = typed

codex
## 1) Concerns

1. [MATERIAL] [IN-DELTA] 0193 §Program, Phases 1 and 3 — “remediation carrier (`structured | message | guide | reference`), target” and “carrier LLP 0146 OQ6 selects.” The merged schema does not actually separate carrier from target: `structured` and `message` are representation/carrier choices, while `guide` and `reference` are usually targets that either carrier can cite. This makes combinations such as a structured remediation targeting an exact registry symbol unrepresentable and blurs D7’s settled shape with OQ6’s remaining implementation decision. Resolving change: define orthogonal fields for emitted representation, remediation target kind, and OQ6-selected enforcement/storage mechanism; allow their valid combinations explicitly.

2. [MATERIAL] [IN-DELTA] 0193 §Program, Phases 2 and 3 — anchors “must resolve against the published closure the remediation claims to teach,” while “a new agent-triggerable code cannot land” without such an anchor during the interim. A newly introduced diagnostic may target only the staged candidate closure, which cannot yet resolve against the currently published closure. The ratchet can therefore make unreleased diagnostics impossible to land before the structured carrier exists. Resolving change: validate unreleased diagnostics against the exact candidate/build closure digest, then revalidate against the qualified published digest during release; require the remediation and anchor to name the same closure.

3. [MATERIAL] [IN-DELTA] 0193 §Exit criteria — “Every encountered A-grade refusal either produces a one-attempt recovery or files evidence explaining why its remediation was ineffective.” This allows the program to exit while known A-grade remediations are ineffective, contradicting grade A’s “current fix/anchor” meaning and weakening the new recovery-evidence objective into documentation of failure. Resolving change: an ineffective witness must trigger downgrade/remediation and a successful retest before exit; if one-attempt recovery is intrinsically inappropriate for a class, define a bounded alternative witness rather than accepting an ineffective A grade.

4. [MATERIAL] [IN-DELTA] 0194 §Acceptance — “Registry/runtime export parity fails if a declared symbol is absent at runtime.” Type-only exports and declaration-only contracts are erased at runtime; the initial scope expressly includes hook fact types and the `verify.d.mts` contract. Literal enforcement would reject valid required inputs. Resolving change: require runtime parity only for value-space exports and applicable runtime export conditions; require type-space exports to appear in the declaration registry with an explicit non-runtime kind.

5. [MATERIAL] [IN-DELTA] 0194 §Design and §Acceptance — the `ctx` prose section is “permitted only as a temporary bootstrap,” but Acceptance merely requires that `ctx` eventually appear as declarations and in the registry. The RFC can therefore satisfy Acceptance while retaining an independently maintained prose authority, contrary to the canonical-registry decision. Resolving change: make final acceptance require removal of the hand-owned bootstrap or conversion into a generated projection, with CI rejecting duplicate symbol ownership once the declaration source lands.

6. [MATERIAL] [IN-DELTA] 0195 §Success measures and §Open questions, against 0197 §The standard rule 6 — OQ4 describes pinned model builds “isolating training-data presence from in-context aids,” although changing model epochs cannot establish corpus presence or isolate it from other model changes. This reintroduces causal interpretation that 0195 otherwise rejects and that 0197 limits to a nonnumeric familiarity caveat. Resolving change: define this as familiarity surveillance only; hold closure, harness, questions, and aids fixed within each separately reported model epoch, and require corpus evidence or a controlled training ablation before attributing changes to training-data inclusion.

7. [MATERIAL] [IN-DELTA] 0196 §Exit criteria and §Open questions, against 0197 rule 10 — 0196 requires a holdout “not used to design any template,” says the workload need only avoid being “directly solved by a template added for its brief,” and cites nonexistent “rules 4a/4b.” R7’s rule 10 is broader: a holdout cannot be substantially implemented by any eligible starter, template, recipe, example, skill, or scaffold. T0 or another non-template aid could therefore solve the nominal holdout while 0196 still permits a generality claim. Resolving change: point to rule 10 and adopt its complete aid scope and “substantially implemented” test throughout 0196, including OQ3.

8. [MATERIAL] [IN-DELTA] 0197 §The standard, rule 5 — public records retain “raw tool invocations” and “hashes of private originals,” while “Raw transcripts never publish.” Because rule 3 publishes run records, this leaves the public/private boundary undefined. Tool arguments can contain secrets or private material, and ordinary hashes of paths, identifiers, or other low-entropy values permit confirmation attacks. Resolving change: specify separate private raw evidence and public sanitized records; publish normalized invocation metadata and opaque evidence IDs, keep sensitive originals and keyed integrity commitments access-controlled, and make the publisher fail closed when safe redaction would destroy required auditability.

9. [minor] [IN-DELTA] 0197 §The standard rules 1–2 and §Acceptance — the floor permits N=3 while requiring a “balanced schedule.” An exactly balanced order is impossible for a two-lane comparison with three repetitions. Rule 7b’s success thresholds are otherwise internally consistent, but the ordering requirement needs an operational definition. Resolving change: either require repetition counts compatible with exact balance—four for two lanes—or define near-balance as position counts differing by at most one.

## 2) Per-target verdicts

0193 VERDICT: REVISE — material in-delta concerns.

0194 VERDICT: REVISE — material in-delta concerns.

0195 VERDICT: REVISE — material in-delta concern.

0196 VERDICT: REVISE — material in-delta cross-document seam.

0197 VERDICT: REVISE — material publication-safety concern; one minor protocol ambiguity.

## 3) SET verdict

SET VERDICT: REVISE — r7 is not ready for author acceptance.
tokens used
56,031
## 1) Concerns

1. [MATERIAL] [IN-DELTA] 0193 §Program, Phases 1 and 3 — “remediation carrier (`structured | message | guide | reference`), target” and “carrier LLP 0146 OQ6 selects.” The merged schema does not actually separate carrier from target: `structured` and `message` are representation/carrier choices, while `guide` and `reference` are usually targets that either carrier can cite. This makes combinations such as a structured remediation targeting an exact registry symbol unrepresentable and blurs D7’s settled shape with OQ6’s remaining implementation decision. Resolving change: define orthogonal fields for emitted representation, remediation target kind, and OQ6-selected enforcement/storage mechanism; allow their valid combinations explicitly.

2. [MATERIAL] [IN-DELTA] 0193 §Program, Phases 2 and 3 — anchors “must resolve against the published closure the remediation claims to teach,” while “a new agent-triggerable code cannot land” without such an anchor during the interim. A newly introduced diagnostic may target only the staged candidate closure, which cannot yet resolve against the currently published closure. The ratchet can therefore make unreleased diagnostics impossible to land before the structured carrier exists. Resolving change: validate unreleased diagnostics against the exact candidate/build closure digest, then revalidate against the qualified published digest during release; require the remediation and anchor to name the same closure.

3. [MATERIAL] [IN-DELTA] 0193 §Exit criteria — “Every encountered A-grade refusal either produces a one-attempt recovery or files evidence explaining why its remediation was ineffective.” This allows the program to exit while known A-grade remediations are ineffective, contradicting grade A’s “current fix/anchor” meaning and weakening the new recovery-evidence objective into documentation of failure. Resolving change: an ineffective witness must trigger downgrade/remediation and a successful retest before exit; if one-attempt recovery is intrinsically inappropriate for a class, define a bounded alternative witness rather than accepting an ineffective A grade.

4. [MATERIAL] [IN-DELTA] 0194 §Acceptance — “Registry/runtime export parity fails if a declared symbol is absent at runtime.” Type-only exports and declaration-only contracts are erased at runtime; the initial scope expressly includes hook fact types and the `verify.d.mts` contract. Literal enforcement would reject valid required inputs. Resolving change: require runtime parity only for value-space exports and applicable runtime export conditions; require type-space exports to appear in the declaration registry with an explicit non-runtime kind.

5. [MATERIAL] [IN-DELTA] 0194 §Design and §Acceptance — the `ctx` prose section is “permitted only as a temporary bootstrap,” but Acceptance merely requires that `ctx` eventually appear as declarations and in the registry. The RFC can therefore satisfy Acceptance while retaining an independently maintained prose authority, contrary to the canonical-registry decision. Resolving change: make final acceptance require removal of the hand-owned bootstrap or conversion into a generated projection, with CI rejecting duplicate symbol ownership once the declaration source lands.

6. [MATERIAL] [IN-DELTA] 0195 §Success measures and §Open questions, against 0197 §The standard rule 6 — OQ4 describes pinned model builds “isolating training-data presence from in-context aids,” although changing model epochs cannot establish corpus presence or isolate it from other model changes. This reintroduces causal interpretation that 0195 otherwise rejects and that 0197 limits to a nonnumeric familiarity caveat. Resolving change: define this as familiarity surveillance only; hold closure, harness, questions, and aids fixed within each separately reported model epoch, and require corpus evidence or a controlled training ablation before attributing changes to training-data inclusion.

7. [MATERIAL] [IN-DELTA] 0196 §Exit criteria and §Open questions, against 0197 rule 10 — 0196 requires a holdout “not used to design any template,” says the workload need only avoid being “directly solved by a template added for its brief,” and cites nonexistent “rules 4a/4b.” R7’s rule 10 is broader: a holdout cannot be substantially implemented by any eligible starter, template, recipe, example, skill, or scaffold. T0 or another non-template aid could therefore solve the nominal holdout while 0196 still permits a generality claim. Resolving change: point to rule 10 and adopt its complete aid scope and “substantially implemented” test throughout 0196, including OQ3.

8. [MATERIAL] [IN-DELTA] 0197 §The standard, rule 5 — public records retain “raw tool invocations” and “hashes of private originals,” while “Raw transcripts never publish.” Because rule 3 publishes run records, this leaves the public/private boundary undefined. Tool arguments can contain secrets or private material, and ordinary hashes of paths, identifiers, or other low-entropy values permit confirmation attacks. Resolving change: specify separate private raw evidence and public sanitized records; publish normalized invocation metadata and opaque evidence IDs, keep sensitive originals and keyed integrity commitments access-controlled, and make the publisher fail closed when safe redaction would destroy required auditability.

9. [minor] [IN-DELTA] 0197 §The standard rules 1–2 and §Acceptance — the floor permits N=3 while requiring a “balanced schedule.” An exactly balanced order is impossible for a two-lane comparison with three repetitions. Rule 7b’s success thresholds are otherwise internally consistent, but the ordering requirement needs an operational definition. Resolving change: either require repetition counts compatible with exact balance—four for two lanes—or define near-balance as position counts differing by at most one.

## 2) Per-target verdicts

0193 VERDICT: REVISE — material in-delta concerns.

0194 VERDICT: REVISE — material in-delta concerns.

0195 VERDICT: REVISE — material in-delta concern.

0196 VERDICT: REVISE — material in-delta cross-document seam.

0197 VERDICT: REVISE — material publication-safety concern; one minor protocol ambiguity.

## 3) SET verdict

SET VERDICT: REVISE — r7 is not ready for author acceptance.
