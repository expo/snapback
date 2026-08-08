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
