# LLP 0119 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind
**Target SHA-256:** `0afa360ef52e3b598c141efa77a055e7d3d3948a5162644bc8aaaee5a7340305`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## Verbatim review

## 1. Overall assessment

LLP 0119 identifies a real, well-supported competitive difference and offers several useful directions, especially coarse live-search re-execution. However, it does not yet meet the stated READY bar.

Three pre-empirical flaws remain:

- It conflates function classification, invocation mode, target capability, and durable/ephemeral storage, which makes Option 1 materially less attractive than it actually is and omits important hybrid designs.
- Its quarantine-to-empty analysis conflicts with LLP 0053’s existing obligation model.
- It overstates how much of live search—and especially posting-driven precision—is already wired into the live pipeline.

There are also provenance overstatements, unsupported implementation-level Convex claims, and several empirical or sequencing judgments presented as findings. These are resolvable through further analysis without writing a prototype.

## 2. Strengths

- The core comparison is correct. “What Convex does” and “What Snapback does today” clearly distinguish Convex’s ordinary reactive queries from Snapback’s explicit `Query`/`LiveQuery` boundary. Official Convex documentation confirms that queries are cached and subscribable, that client subscriptions share consistent logical state, and that search queries are automatically reactive: [Queries](https://docs.convex.dev/functions/query-functions), [Realtime](https://docs.convex.dev/realtime), [Full Text Search](https://docs.convex.dev/search/text-search).

- “Search v1’s honest non-live posture” accurately reflects LLP 0073 and current code. Search is admitted only as `FunctionKind::Query`, and live subscription admission rejects non-`LiveQuery` functions. See [src/manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:939), [src/local.rs](/Users/ccheever/projects/snapback/src/local.rs:7701), and Diary 0037 checks 6–7.

- The document preserves LLP 0115’s no-evidence-regression constraint. It correctly refuses to relabel polling, client reissue, or an invalidation hint as live search.

- The treatment of search pagination is thoughtful. Option 4 correctly notices that a stateless 120-second continuation cursor does not automatically define a long-lived subscription contract and identifies first-page-only liveness as a coherent candidate.

- Option 6 is genuinely distinct and useful. An honest invalidation-hint protocol may be valuable even if it never becomes a live-search capability.

- “The 0112/0114 half” correctly identifies that React/query-group improvements address subscription glue without resolving the server-side classification or live-search gap.

- The confidence section is unusually candid about unverified Convex internals and unmeasured cost estimates. That is good research hygiene, even though some corresponding claims still need to be softened.

## 3. Concerns

### A. BLOCKING-FOR-BAR — Option 1 conflates four independent axes and is therefore unfairly costed

The document treats these as if they necessarily move together:

1. whether a handler is authored as `Query` or `LiveQuery`;
2. whether that function supports subscription;
3. whether a particular invocation actually establishes retained subscription state; and
4. whether presence/typing uses durable rows or Snapback’s ephemeral lane.

They do not.

Making every query subscribable does not require every one-shot invocation to retain subscription state. A `client.query` call can remain request/response while a subscription or React hook retains state. Likewise, making durable queries reactive by default does not eliminate or weaken ephemeral rooms.

Consequently:

- Option 1’s claim that it “erases the free ordinary query” is not established.
- Findings 6’s claim that erasing the classification endangers “the durable/ephemeral lane contrast” is false as stated.
- The statement that Cursor Garden’s win is “the same coin as the explicit classification” conflates the durable/ephemeral data distinction with the `Query`/`LiveQuery` function-kind distinction.
- A target without push evidence could still report that subscription capability as unavailable while permitting one-shot invocation of the same function. Universal function-level subscribability need not become a false universal target claim.

The option space consequently misses at least two distinct candidates:

- one authored `defineQuery` surface with separate callable/subscribable capability bits and target-scoped subscription admission;
- live-by-default queries with an explicit `defineOneShotQuery` or `live: false` escape hatch, preserving an authored non-live fact without static inference.

Resolution: decompose the design into an explicit matrix of authoring kind, per-function subscription capability, invocation mode, target capability, and storage lane. Reassess Options 1 and 2 and amend Findings 6 accordingly.

### B. BLOCKING-FOR-BAR — The quarantine-to-empty sub-question conflicts with LLP 0053

The document says that a write provably unrelated to authorization should ride an “ordinary data-delta/resnapshot lane, which never blanks,” and concludes that quarantine flicker is an authorization wake-precision problem.

LLP 0053 draws a more careful distinction:

- `permissionFields` already suppresses authorization events for known field-disjoint updates. That is implemented in [src/storage/authorization.rs](/Users/ccheever/projects/snapback/src/storage/authorization.rs:99).
- But an ordinary write can still require an obligation-backed, potentially shrinking `live_replace`. LLP 0053 explicitly says every auth-scoped `live_replace` is conservatively obligation-backed and that ordinary writes can create such delivery obligations; see LLP 0053 around lines 1638–1642.
- For an opaque protected JS query, proving that a write does not change authorization inputs does not prove that its previously published result cannot shrink or otherwise require fenced replacement.

Therefore “authorization relevance” alone is insufficient to bypass quarantine. The necessary proof is closer to “this update cannot remove or newly forbid any previously published row,” which is much stronger and may be unavailable for arbitrary Ibex handlers.

The Diary 0030 observation also needs diagnosis against current behavior: was the wall table missing a precise `permissionFields` declaration, or was the blank caused by the conservative obligation attached to an auth-scoped `live_replace`? Those lead to different remedies.

Resolution: reconcile the sub-question with LLP 0053. Separate:

- coarse authorization-event suppression, which already exists;
- matcher proof of non-shrinking data changes;
- obligation-backed protected `live_replace`; and
- purely cosmetic client smoothing.

Revise Finding 7 after that reconciliation.

### C. BLOCKING-FOR-BAR — Live-search feasibility is materially overstated

The cited `HandlerPlan::SearchQuery` matcher arm exists and is table-granular: [src/live_matcher.rs](/Users/ccheever/projects/snapback/src/live_matcher.rs:170). But that arm is currently unreachable through a valid search subscription:

- Manifest validation admits `SearchQuery` only with `FunctionKind::Query`, not `LiveQuery`: [src/manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:939).
- Subscription admission requires `FunctionKind::LiveQuery`: [src/local.rs](/Users/ccheever/projects/snapback/src/local.rs:7701).
- Query execution has a search arm only for `(FunctionKind::Query, SearchQuery)`: [src/local.rs](/Users/ccheever/projects/snapback/src/local.rs:16308).

Thus Option 4 requires coordinated changes to manifest admission, codegen/function identity, execution dispatch, subscription result/cursor semantics, generated client capability, and evidence—not merely activation of an existing matcher arm.

Option 5 is further away than described. The search maintainer replaces old postings and inserts new ones internally, but it does not publish an old/new posting-key carrier to the live notification path. `ChangedRow` contains only table/id/op/row/changed fields: [src/storage.rs](/Users/ccheever/projects/snapback/src/storage.rs:255). The maintainer returns `()` after updating private search tables. A precise live matcher would therefore need a new transaction-to-notification artifact or would need to reconstruct equivalent facts.

The document must also analyze how precision handles:

- prefixes as posting ranges rather than exact tokens;
- phrases with multiple positive anchors;
- equality-filter-only changes;
- visibility-partition changes;
- stored-field changes for currently returned rows;
- deletions, where the post-image is absent;
- top-page displacement despite a changed row not previously appearing in the page.

Resolution: describe the complete integration seam for coarse live search and the required change carrier for fine precision. Reclassify “mostly composition,” “already computes the exact union,” and Finding 4 as hypotheses until those seams are accounted for.

### D. MATERIAL — Diary provenance and independence are overstated

Diary 0034 does not record that “ordinary queries become reactive without a separate live classification.” That language appears in the aggregate Diary 0039, lines 110–114. Diary 0034 proves equivalent native live behavior for the Campfire arms but does not make the attributed structural observation.

Similarly, Finding 1 calls the evidence “four independent diaries” while counting Diary 0039, an aggregate report derived partly from Diaries 0034 and 0037, alongside those underlying diaries. That is not four independent observations.

Diary 0022 supports “best authoring and reactive client loop” and records manual aggregation friction, but it does not isolate the classification as the cause as precisely as Diaries 0028, 0037, and 0039 do.

Resolution: correct the Diary 0034 attribution and describe the evidence as repeated across multiple arms and two bakeoff generations, with Diary 0039 explicitly identified as an aggregate synthesis rather than an independent run.

### E. MATERIAL — The Convex mechanism is more specific than the cited provenance supports

Official documentation supports automatic dependency tracking, re-execution, caching, consistent logical snapshots, and reactive search. It does not, in the sources consulted here, establish the document’s exact internal account that the subscription layer “intersects the committed write set with recorded read sets,” nor that search invalidation works specifically because a captured read set “covers the index range it consulted.”

Those may be accurate descriptions of Convex internals, but the document labels them as general background while also admitting they were not reverified.

Resolution: either cite current authoritative source/code for the exact mechanism or soften it to the documented contract: Convex tracks query dependencies, reruns queries when relevant data changes, and updates subscriptions consistently. Mark any proposed read-set/write-set implementation account as inference.

### F. MATERIAL — Empirical and sequencing judgments are presented as settled analysis

Several claims exceed what the document has established without measurement:

- Option 6 has “tiny server cost.”
- Narrowed authorization classification would “remove most flicker.”
- Type-ahead “naturally creates many distinct subscribed queries per user.”
- Option 4 is “mostly composition.”
- Option 5 as a v1 target “would stall the practical win.”
- Option 5 should be sequenced after Option 4 “if ever.”

The last two also conflict with “This document ranks nothing and decides nothing.” They constitute a sequencing recommendation, and “would stall” is an empirical prediction.

Resolution: label these as hypotheses and add named empirical questions or evaluation criteria: fanout, wake amplification, subscription churn, first-page rerun cost, cursor behavior, protected-query transition behavior, and group/client integration. Leave sequencing to LLP 0115/0073 unless the research presents it explicitly as a recommendation for owner adjudication.

## 4. Suggestions

- Add an option-comparison table with separate columns for authoring decision count, per-function evidence, target evidence, one-shot cost, retained subscription cost, route-group eligibility, and ephemeral-state effects.

- Split “live search” into three layers:

  - subscribable search contract;
  - coarse source-table invalidation and full replacement;
  - optional posting/index-aware wake precision.

- Add a short “Current integration blockers” subsection citing the manifest and execution match arms above. This would keep “the matcher arm already exists” useful without implying that the end-to-end path already exists.

- Replace “zero-cost ordinary query” with the narrower, defensible property: one-shot invocation retains no subscription state.

- Make the evidence hierarchy explicit: direct diary observation, aggregate diary synthesis, current-code fact, owning-LLP constraint, official Convex contract, and architectural inference.

- Add LLP 0053 to `Related`; it is load-bearing for an entire sub-question.

## 5. Open questions

1. In Diary 0030’s exact app declaration, was the wall table `permissionBacking`, and did it declare `permissionFields`? Was each blank caused by an authorization-version event or by an obligation-backed auth-scoped `live_replace`?

2. Can Snapback expose one query authoring kind while retaining distinct callable and subscribable capability facts in the manifest?

3. Should subscribability be a function property, a target property, or the conjunction of both? How should a generated reference communicate that without silently changing across target selection?

4. For first-page live search, does every replacement mint a new continuation cursor, and what client behavior is required when that cursor changes while continuation pages remain non-live?

5. What exact transaction artifact would Option 5 publish: complete old/new posting keys, changed posting ranges, changed source identities plus partitions, or something else? What are its bounds?

6. Which result changes can a posting-only wake scheme miss unless it also considers prior page membership, filter changes, visibility partition changes, and stored-field changes?

7. What measurement would distinguish “React/query-group glue closed the preference gap” from “the explicit server-side classification remains the preference-shaping difference”?

## 6. Verdict: NOT READY

The document is strong and close, but it has not exhausted pre-empirical analysis. The classification/storage-axis conflation, the conflict with LLP 0053’s obligation model, and the incomplete live-search integration account are substantive flaws that can and should be resolved before implementation.

## 7. Recommended next step

Revise LLP 0119 while keeping it in Review:

1. decompose the classification option space;
2. reconcile quarantine analysis with LLP 0053 and current `permissionFields` behavior;
3. enumerate the actual coarse and fine live-search integration seams;
4. correct diary provenance;
5. soften or source the Convex internal-mechanism account; and
6. reclassify empirical and sequencing claims as hypotheses or owner decisions.

Then run another independent review round against the revised document.
