# LLP 0122 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind
**Target SHA-256:** `c41f584d37139c5d8544fd4a2cf1b3a75f1fe5317b99f35abf1cbecdc48bb815`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## Verbatim review

## 1. Overall assessment

LLP 0122 is strong research, but it does not yet meet the unusually high READY bar. Its evidence synthesis, current-main inventory, and coherence decomposition are valuable. However, two load-bearing parts of the analysis remain incomplete using evidence already available in the repository:

- It incorrectly attributes the guide’s checkout dialect to a structural limitation of the snippet-verification mechanism.
- It does not evaluate the packaging/custody options systematically against LLP 0115’s no-evidence-regression constraint, especially for the privileged admin client and checkout-dependent acceptance lifecycle helper.

These are pre-empirical gaps, not implementation questions, so they prevent READY.

## 2. Strengths

- **Excellent evidence framing.** “What Convex does” explicitly separates general Convex background from diary-observed behavior. The important Convex claims—coherent TypeScript flow, the 121 ms startup observation, agent-mode prompting, binary downloads, port coordination, and the Auth.js advisory—are accurately tied to the cited diaries.

- **Accurate current-main package inventory.** “What Snapback does today” correctly identifies thirteen package directories, the nine-package closure, the private and unversioned admin client, the non-package harness assets, the image-bound supervisor, and the private publication authority. The `@snapback/client/online` declaration defect is also accurately verified against `packages/snapback-client/package.json:29-57` and the absence of `online.d.mts`.

- **Good temporal hygiene.** The document distinguishes fixed historical friction from live current-main problems. In particular, it correctly recognizes that `new`, `generate`, `dev`, `doctor`, and `deploy` now exist rather than continuing to treat Diary 0031’s missing `generate` command as current.

- **Useful decomposition of coherence.** “How they differ” improves materially on “publish some packages” by separating naming, CLI, documentation, app-owned artifacts, runtime visibility, and agent-oriented diagnostics. This is the document’s strongest conceptual contribution.

- **Substantial option breadth.** The document covers incremental completion, binary consolidation, package consolidation/meta-packages, scaffold-first onboarding, default-channel governance, and custody choices. It also acknowledges that several options compose rather than compete.

- **Good decision hygiene overall.** The document generally leaves ownership with LLP 0041, 0111, 0114, 0061, 0062, and LLP 0115. Option 5 presents both sides of the `0111` versus `0074` conflict and stops short of deciding it.

- **Honest confidence section.** Registry-name availability, single-binary feasibility, and first-hour timing are correctly identified as areas not established by the current evidence.

## 3. Concerns

### BLOCKING-FOR-BAR — The guide-mechanism diagnosis is factually too strong

**Gap:** “The guide speaks the checkout dialect” says the CI-verified snippet mechanism “structurally biases every page toward checkout-relative paths,” and the later comparison says that mechanism currently “prevents” an installed-dialect guide.

The checker does not impose that restriction. `guide/conventions.md:99-107` permits a verified snippet from any named CI-exercised source file—a demo, package test, or proof script. It expressly recommends adding a technique to a “demo or fixture” at `guide/conventions.md:111-115`. The current authoring-loop page already names package templates and package tests as examples at `guide/getting-started/the-authoring-loop.md:7-8`, and already teaches installed commands at lines 28-63.

The real problem is that `your-first-backend.md` selected checkout-resident demo snippets and mixes those with installed onboarding. That is corpus/source selection, not a limitation of LLP 0061’s verification architecture.

This matters because Option 4 claims that a new create artifact fixes facet 3 “structurally.” An installed-dialect fixture would help, but neither a new command nor a change to the snippet authority is inherently required; existing package fixtures could already anchor installed-dialect snippets.

**Resolution:** Reframe the diagnosis as a current source-corpus and page-composition problem. Analyze at least these alternatives:

- transclude the existing packed starter/package fixtures;
- add an installed-dialect acceptance fixture under the existing LLP 0061 mechanism;
- split contributor-checkout and installed-user guide tracks;
- amend LLP 0061 only if those existing mechanisms prove insufficient.

### BLOCKING-FOR-BAR — Options are not tested against no-evidence-regression

**Gap:** LLP 0115’s first governing constraint says ergonomic work must not weaken evidence boundaries (`llp/0115-convex-parity-course-corrections.plan.md:91-105`). LLP 0122 mentions Snapback’s evidence culture, but does not apply that constraint across its options.

This is most significant in Option 6:

- The admin client is not an ordinary client module. It handles master admin tokens, derived console credentials, secret-read leases, response redaction, and privileged system-app operations; see `packages/snapback-admin-client/index.mjs:8-31` and `:69-147`. Folding it into the ordinary client or CLI raises authority-separation, browser-bundling, discoverability, and compatibility questions that package count alone does not capture.
- The served path is already intentionally described by current code as an external-tooling surface (`src/admin.rs:288-291`). Its analysis should therefore distinguish “current implementation intent” from “normatively endorsed public contract.”
- `demos/_kit/server-process.mjs` is not presently a portable helper awaiting publication. It imports checkout scripts, checkout identity readers, the runtime-link probe, and CLI internals at lines 42-54, then includes `cargo run` as its source fallback. “Publish a test-helper package” therefore hides a substantial boundary decomposition.
- Snapback already has a package-owned comparator acceptance surface documented at `guide/testing/acceptance.md:190-219`. Option 6 does not examine whether that surface should be extended, whether a portable lifecycle SDK should sit beneath it, or which workout-only checks must remain a digest-pinned evaluation instrument.

The same omission affects Options 2–4: their effects on exact package identity, platform-specific runtime proof, provenance receipts, and candidate-to-promoted ledger lineage are noted only sporadically.

**Resolution:** Add an option matrix evaluating every option against at least:

- public install and import coherence;
- authority and credential separation;
- exact version/runtime matching;
- package and binary provenance;
- clean-machine proof;
- compatibility/version skew;
- offline behavior;
- browser bundle exposure;
- workout evidence versus supported user testing;
- required amendments to owning LLPs.

### MATERIAL — The admin-client gap is overstated as blocking every external workout suite

**Gap:** “The two named artifact gaps” says that until both custody decisions are made, “a clean external repository cannot run a workout-arm-grade acceptance suite.”

That is too broad. The admin client is Dispatch-specific. LLP 0115’s exit explicitly allows the first external workout arm to be Campfire or Streak Lab and says “the admin-client proof rides Dispatch or a separate fixture” (`llp/0115-convex-parity-course-corrections.plan.md:235-238`). A non-Dispatch workout arm is blocked by the helper/lifecycle problem, not necessarily by admin-client custody.

Both decisions are required to close CV-1 as presently written, but they do not both block every individual external workout suite.

**Resolution:** Distinguish:

- what blocks one external workout arm;
- what blocks Dispatch;
- what blocks complete CV-1 exit.

### MATERIAL — Option 1 is presented as universally necessary even though other options can supersede it

**Gap:** Option 1 calls the existing nine-package promotion “the necessary floor.” That is true only under CV-1 and LLP 0041 as currently written. A genuine single-binary or replacement-distribution decision could amend those owners and make completion of that exact nine-package/default-channel path transitional or unnecessary.

Likewise, calling the single-binary option “the strongest coherence story available” ranks a multidimensional option before the document has compared TypeScript imports, editor types, browser delivery, platform updates, attestation, and runtime recovery.

**Resolution:** State that Option 1 is the required floor under current owners and plan exits, then separately analyze whether Options 2 or 3 are additive migrations or superseding distribution strategies.

### MATERIAL — Several empirical claims are identified but not organized into a closed empirical agenda

**Gap:** The Confidence section honestly mentions missing probes and spikes, but the document never turns them into a complete set of named empirical questions. Claims such as “buying the first command cheaply,” “strongest coherence story,” scaffold drift mitigation, and the “small declaration file” fix need explicit proof criteria if they remain load-bearing.

**Resolution:** Add a short “Empirical questions” section naming:

- registry/name availability;
- cold external install and scaffold-to-first-row commands/time;
- generated project typecheck and bundle success;
- all-export declaration resolution;
- single-binary size, launch, update, signing, and platform feasibility;
- runtime recovery and provenance after consolidation;
- whether users or agents can discover the correct noninteractive path without source archaeology.

### DETAIL — A Convex comparison escapes the declared provenance labels

**Gap:** Option 4 says, “this is how Convex, Next, and Expo actually deliver their first-hour coherence.” This is plausible general background, but it is outside the expressly labeled “General Convex background” section and introduces two new external comparators without provenance.

**Resolution:** Label it as general industry background or remove the appeal to those products; the option stands on Snapback’s own fixture and diary evidence.

### DETAIL — “Nothing consumed it” should retain its intended scope

**Gap:** The heading is rhetorically broader than the evidence. The flagship seven-arm rerun consumed none of the public `0.1.0` closure, but the staged package confirmations did consume package-only artifacts and are discussed immediately afterward.

**Resolution:** Rename it to “What the flagship rerun consumed: none of the public closure.”

## 4. Suggestions

- Add a compact facet-by-option matrix. The prose is rich, but interactions among complementary options are currently difficult to compare.
- Separate three layers that are sometimes conflated:

  1. distribution mechanics;
  2. installed-user product journey;
  3. evaluation/workout instrumentation.

- Treat export completeness as a package-wide invariant, not only an `online.d.mts` repair. Current `./agent-authority`, `./hosted-browser`, `./react-binding`, and `./rqs*` exports should be classified deliberately as typed public API, JavaScript-only API, or internal/non-exported surface.
- Clarify that the served admin client is unavailable before server launch, rather than simply “unusable offline”; most admin operations inherently require a running server.
- Replace subjective superlatives such as “most hardened” and “strongest coherence story” with explicit dimensions or mark them as hypotheses.

## 5. Open questions

1. Is CV-1 intended to preserve the nine-package closure as a durable architecture, or merely prove the current public path before a possible consolidation?
2. Which acceptance behaviors are supported application-testing API, which belong in the packaged comparator, and which must remain evaluation-only evidence instruments?
3. Must ordinary application dependency graphs be unable to resolve the privileged admin client, or is authority enforced entirely at runtime credentials?
4. Can the existing React packed fixture become the installed-dialect guide authority without any LLP 0061 amendment?
5. Should the guide explicitly maintain separate installed-user and repository-contributor command tracks?
6. What exact evidence properties must survive a binary or meta-package consolidation—component digests, platform-runtime attribution, rollback granularity, and candidate-ledger lineage?
7. Is `@snapback/app-cli` a distinct audience-facing product, or should one top-level command route to it while preserving its separate package and authority boundary?

## 6. Verdict: NOT READY

The document is close and already useful, but it has not exhausted available pre-empirical analysis. The incorrect structural diagnosis of the guide mechanism and the missing no-evidence-regression analysis for privileged/admin and acceptance custody are material flaws on the document’s central front.

## 7. Recommended next step

Revise LLP 0122 while keeping it in Review:

1. Correct the guide-mechanism diagnosis.
2. Decompose the admin and acceptance-helper boundaries against current code.
3. Add the option/evidence matrix.
4. Narrow the overstatement about both artifacts blocking every workout arm.
5. Convert unresolved implementation-dependent claims into a named empirical agenda.

After those revisions, request the second-family re-review before the author decides whether the document has reached the READY bar.
