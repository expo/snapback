# LLP 0124 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (banner reported: medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind
**Target SHA-256:** `19348a3dbf8bb0d0d4bdd519490050dd0b51027b1377bf10354382849a1ab3ac`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## Verbatim review

## 1. Overall assessment

LLP 0124 is a strong, well-sourced inventory of two genuine Snapback product gaps. Its current-state analysis, diary reconstruction, ownership mapping, and relationship to LLP 0115 are mostly accurate.

It does not yet meet the stated READY bar. Three pre-empirical areas remain insufficiently analyzed:

- storage delivery authorization and revocation semantics;
- vector-search consistency, authorization, and evidence boundaries;
- separation of orthogonal design axes from claimed “paths” and “minimum viable” conclusions.

These are central to the document’s subject, can be analyzed further without implementation, and interact directly with LLP 0115’s no-evidence-regression constraint.

## 2. Strengths

- The current Snapback nonclaim is accurately established. The local capability gaps include `assets` in [src/manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:6009), and both Cloudflare and local profiles retain that gap. The guide correctly lists both capabilities as `targets: none`, `design-only` in [guide/capabilities.md](/Users/ccheever/projects/snapback/guide/capabilities.md:50).

- The ownership asymmetry is correctly identified. LLP 0044 is a Draft design for assets, while LLP 0019 explicitly calls runtime AI an unmade product decision and leaves vector ownership open. The distinction between a research recommendation and an owning RFC/Spec is well handled in “What Snapback does today.”

- The diary evidence is used carefully and usually quoted precisely. In particular:

  - Convex’s cohesive storage lifecycle is supported by [Diary 0030](/Users/ccheever/projects/snapback/diaries/0030-partiful-backend-bakeoff.diary.md:742).
  - Convex’s schema-level vector experience and composition overhead are supported by [Diary 0031](/Users/ccheever/projects/snapback/diaries/0031-research-room-backend-bakeoff.diary.md:726).
  - The unchanged Snapback gaps after remediation are supported by [Diary 0031](/Users/ccheever/projects/snapback/diaries/0031-research-room-backend-bakeoff.diary.md:800).

- “One neighboring gap already retired” correctly avoids reopening full-text search. This respects LLP 0115’s retired-gap boundary and distinguishes semantic/vector retrieval from the shipped full-text profile.

- “Why LLP 0115 does not cover this” is persuasive. LLP 0115 explicitly places LLP 0124 outside its seven-app frame and delegates the question to OQ7 in [LLP 0115](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:112).

- The document preserves honest capability admission. The repeated insistence on target-specific claims, explicit GAPs, acceptance evidence, and separately claimed accelerators is aligned with LLP 0115’s governing constraints and LLP 0073’s staged admission model.

- The option discussion recognizes important distinctions: local versus hosted storage, Snapback-owned versus external bytes, embedding generation versus vector indexing, exact versus approximate retrieval, and design ownership versus scheduling.

## 3. Concerns

### BLOCKING-FOR-BAR — Storage delivery authorization is materially oversimplified

The general-background statement at lines 59–64 says delivery and deletion go through `ctx.storage` “under the same function-level authorization as data.” That is not generally true for Convex delivery. A function can authorize issuance of a file URL, but the resulting URL is a reusable bearer URL accessible without further application authentication. Per-request authorization requires an HTTP action or equivalent proxy. Convex documents this distinction explicitly in [Serving Files](https://docs.convex.dev/file-storage/serve-files).

That distinction is also unresolved in the Snapback option analysis. S1 and S2 promise “authority-checked delivery,” while LLP 0044 includes signed download URLs and says they are not the source of permission truth. The document never compares:

- authorization when a URL is minted versus authorization on every byte request;
- URL expiry, sharing, cache behavior, and revocation before expiry;
- deletion as revocation versus retaining the file while revoking one principal;
- proxy delivery versus direct object-store delivery, including range requests and size limits;
- what denial and post-revocation evidence each model can honestly claim.

This is a load-bearing security and product-surface choice, not implementation detail.

Resolution: correct the Convex background and add a storage-delivery axis comparing bearer URLs, short-lived signed URLs, and per-request authorized proxying, including their revocation and evidence consequences for S1–S3.

### BLOCKING-FOR-BAR — Vector consistency and authorization are asserted rather than analyzed

V1 says candidates will pass generated visibility before release, “structurally removing” Convex’s manual composition. That conclusion is premature.

The document does not establish whether candidate selection and document hydration occur:

- in one transaction or snapshot;
- across an action/query boundary;
- before or after authorization filtering;
- against an asynchronously maintained or external index;
- with score, candidate identity, count, or timing leakage from unauthorized rows.

It also does not analyze update/delete synchronization, stale candidates, read-set participation, reactive behavior, filter fields, or what happens when authorization changes between candidate selection and hydration. Convex’s own documentation warns that vector results may be mutated or deleted before a subsequent query hydrates them because action-based vector search is nontransactional; see [Vector Search](https://docs.convex.dev/search/vector-search).

These questions directly invoke LLP 0115’s no-evidence-regression requirement in [LLP 0115](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:91). A convenient vector API cannot silently weaken Snapback’s snapshot, authorization, or commit-version evidence.

Resolution: add a candidate-to-release consistency model for each vector path. Name the snapshot boundary, authorization filter class, index freshness contract, update/delete behavior, reactive nonclaim or claim, leakage model, and required receipts. Treat feasibility and cost as hypotheses where implementation evidence is needed.

### BLOCKING-FOR-BAR — Orthogonal axes are presented as paths, leaving important combinations unanalyzed

The document acknowledges that S1–S3 compose and that V2 is a boundary condition rather than an alternative. V3 is likewise a layer over V1/V2. Consequently, “four storage paths” and “five vector paths” do not actually partition the option space.

For storage, at least four independent choices are entangled:

- who owns lifecycle metadata and authorization;
- where bytes live;
- direct versus proxied delivery;
- whether processing is included in the initial capability.

For vectors, the independent choices include:

- portable vector value/type versus index-only schema surface;
- exact k-NN versus approximate ANN as the base claim;
- canonical Snapback index versus engine-native adapter versus remote service;
- application-supplied versus platform-generated embeddings;
- synchronous/transactional versus asynchronously maintained indexing.

This matters because the most consequential vector alternative—an engine-native approximate base profile with probabilistic evidence—is raised only as an open question, while V1 receives substantially fuller favorable development.

Resolution: replace or supplement the path lists with a compact design-axis matrix. Then assess the meaningful combinations, especially exact canonical search, engine-native ANN, and remote ANN, against portability, authorization, freshness, evidence, scale, and operational cost.

### MATERIAL — “Minimum viable surface” smuggles conclusions not established by the evidence

S1 states that the seven-step Convex lifecycle “is the minimum viable surface” and that the diaries ask for nothing more. The diaries establish a valuable acceptance scenario, but they do not prove product minimality.

LLP 0044 itself additionally treats abandoned-session expiry, quota/size facts, content-type verification, processing state, and garbage collection as part of the proposed first asset subsystem. Conversely, processing may be separable from the asset lifecycle needed to close the Partiful gap. The document has not analyzed that boundary enough to pronounce a minimum.

Similar empirical claims include:

- S2 being the rare case where hosted is easier than local;
- S3 being the smallest way to turn the diary arm green;
- the frozen 32-dimensional fixture being sufficient acceptance for the proposed portable vector capability.

Resolution: label these as hypotheses or candidate acceptance floors. Distinguish “minimum exercised by the diary” from “minimum product capability,” and list the empirical work needed to validate cost, feasibility, and adequacy.

### MATERIAL — The “field-wide floor” conclusion overstates the vector evidence

Lines 98–108 say Snapback is below a “field-wide floor on these two rows.” Storage is broadly supported across the competitors, but vector retrieval is not field-wide:

- SpacetimeDB explicitly lacked an ordinary vector path in [Diary 0031](/Users/ccheever/projects/snapback/diaries/0031-research-room-backend-bakeoff.diary.md:192).
- InstantDB recorded native vector similarity as a GAP in [Diary 0031](/Users/ccheever/projects/snapback/diaries/0031-research-room-backend-bakeoff.diary.md:481).
- Appwrite’s sole product GAP was semantic/vector retrieval in [Diary 0031](/Users/ccheever/projects/snapback/diaries/0031-research-room-backend-bakeoff.diary.md:581).

The supported conclusion is that vector search is a meaningful competitive differentiator offered by several important competitors, not a universal field floor.

Resolution: narrow the language and separately characterize storage prevalence and vector prevalence.

### MATERIAL — The agent-era frequency claim lacks provenance

“This is also the agent-era default workload” asserts that agents reach for uploads and semantic retrieval “about as often as” auth. Neither the cited diaries nor LLP 0019 establish comparative frequency. This is a market/product hypothesis presented as fact.

Resolution: cite actual evidence or reframe it explicitly as a strategic hypothesis. The stronger supported claim is that both capabilities recur in representative agent-built app classes and are called strategically important by LLPs 0019 and 0074.

### DETAIL — Minor factual and provenance drift

- The confidence section says the tree carries LLP 0115 v0.3, but the governing document now labels the analysis layer v0.4 in [LLP 0115](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:112).

- “Cross-family reviewed and ratified” can be read as saying LLP 0044 itself was ratified, although its status remains Draft. Its metadata more narrowly says the review revisions were ratified. Clarify that distinction.

- The target’s `Related` metadata omits several documents central to its analysis, notably LLPs 0044, 0019, 0007, and 0111.

Resolution: make these small wording and metadata corrections.

## 4. Suggestions

- Separate “diary-evidenced Convex behavior” from current official-product background even more sharply where the latter affects security or consistency.

- Give each option an explicit row for:

  - capability claim;
  - authorization boundary;
  - consistency/freshness;
  - evidence required;
  - target portability;
  - empirical unknowns.

- For vector retrieval, discuss metric normalization, tie-breaking, score portability, filtered nearest-neighbor behavior, corpus bounds, index rebuilds, dimension/model migrations, and hybrid lexical/vector retrieval. These can remain owning-document questions, but their effect on option costs belongs in this research.

- For storage, distinguish asset identity from content identity. Promoting checksum to identity has deduplication, privacy, mutation, retention, and tenant-isolation consequences and should not ride casually inside S1.

- Add an explicit “empirical questions” subsection rather than leaving empirical uncertainties mixed into confidence prose and option judgments.

- Preserve the document’s decision-free posture. A lean or favored option may be reported, but normative choices such as the minimum surface should be attributed to an owner once decided.

## 5. Open questions

1. Is authorized delivery required on every byte request, or is authorized issuance of a reusable URL sufficient for the first capability claim?

2. Must revoking one user’s access invalidate an already issued URL without deleting or re-uploading the asset?

3. Is processing part of `asset-lifecycle-v1`, or should storage lifecycle and media processing be separately claimed capabilities?

4. Can vector candidate selection participate in Snapback’s ordinary read snapshot and read-set validation, or must vector retrieval define a weaker, separately named consistency profile?

5. Are unauthorized rows excluded before nearest-neighbor selection, or filtered afterward? What information may scores, result counts, and timing reveal?

6. Does exact k-NN remain viable under a declared local corpus/work bound, and what observation would justify crossing to an ANN base profile?

7. If ANN is admitted, what evidence vocabulary replaces deterministic equality—recall against a pinned corpus, lower bounds, probabilistic envelopes, or provider-specific claims?

8. Are filtered vector search and hybrid lexical/vector ranking part of the minimum semantic-retrieval profile, or explicit later capabilities?

9. Which costs in S2 and V4 arise from third-party dependence itself, and which arise from Snapback’s evidence requirements and could also affect native hosted adapters?

## 6. Verdict: NOT READY

The document is close in factual inventory and strategic framing, but it has not exhausted the pre-empirical analysis available for storage authorization or vector consistency/evidence. It also overstates several conclusions and does not yet normalize its option space into genuinely comparable choices.

## 7. Recommended next step

Revise LLP 0124 while keeping it in Review:

1. correct the Convex storage authorization description and the field-wide/vector prevalence claim;
2. add storage-delivery and vector consistency/evidence analyses;
3. reorganize the option space around orthogonal design axes;
4. reclassify cost, feasibility, workload-frequency, and minimum-surface assertions as hypotheses or named empirical questions;
5. apply the minor provenance and metadata corrections;
6. then request the second-family review or a focused re-review of the blocking sections.

Final verdict: **NOT READY**.
