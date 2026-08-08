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
