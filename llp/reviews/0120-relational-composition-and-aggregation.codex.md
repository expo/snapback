# LLP 0120 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind
**Target SHA-256:** `43bdb65cc7b7a411bf3db4c06f7ea5b20aa2b2f5793deb2ff4ed650efa14e82c`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## Verbatim review

## 1. Overall assessment

LLP 0120 has the right central diagnosis and is unusually strong at separating Snapback’s semantic capabilities from its evidence model. Its descriptions of the existing relational profiles, the LLP 0113 maturity boundary, and the rerun’s principal authoring friction are substantially accurate.

It does not yet meet the stated READY bar. Three pre-empirical gaps remain load-bearing:

- “bounded aggregation” is discussed without mapping the possible exactness, overflow, and visibility semantics;
- the option space does not independently assess server-side composition of already-admitted bounded nodes;
- the proposed imperative evidence tier conflates enforced ceilings with diagnostic-only budgets, even though only the former can satisfy LLP 0115’s no-evidence-regression constraint.

There are also correctable factual and provenance overstatements about inline-handler declarations and what Convex structurally cannot prove.

## 2. Strengths

- The document correctly identifies the actual shape mismatch. “The gap is aggregation and multi-child fan-out, not joins” is supported by LLP 0080’s explicit exclusions and LLP 0110’s one-parent/one-child boundary. The current builder confirms that `defineBoundedChildrenQuery` accepts one `children` specification and one `take` ([define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:1052)).

- “What Snapback does today” accurately describes the stable relational plan’s major constraints: one root, one joined source, 1–4 equality pairs, a unique joined index, and `take <= 1024` ([define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:1239)). It also correctly identifies the experimental maturity of `bounded_children_v1` and `write_activity_v1` in the code-owned registry ([manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:5325)).

- The LLP 0113 correction is important and correct. Publication changes runtime support, not static maturity; stable promotion requires later ratified design and evidence. This aligns with CV-8’s governing text ([LLP 0115](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:442)).

- “How they differ and why agents preferred Convex” usefully separates:

  - snapshot/transaction semantics;
  - result-type inference versus declared result contracts;
  - evidence about bounded reach and authorization;
  - missing aggregate/profile shapes.

  That decomposition prevents the relational work from incorrectly absorbing CV-4/CV-6.

- Diary use is generally careful. The Relay 148→224 and Split 379→427 comparisons are supported, as are Relay’s 6/6 result, Split’s imperative N+1 derivation, and Campfire’s scan-based sequence allocation.

- The six options cover several genuinely different strategic directions and consistently relate them to the no-evidence-regression constraint. Options 2 and 4 make the especially useful distinction between declaration and post-hoc capture.

- Decision ownership is handled correctly. The “Relationship to LLP 0115 and owning documents” section leaves substantive decisions with LLPs 0080, 0108, 0110, 0113, and LLP 0115 rather than smuggling an acceptance decision into this Research document.

## 3. Concerns

### BLOCKING-FOR-BAR — Bounded aggregation has no defined result semantics

The document repeatedly treats “bounded grouped counts” as an available conceptual shape ([LLP 0120](/Users/ccheever/projects/snapback/llp/0120-relational-composition-and-aggregation.research.md:199)), but it never distinguishes:

- an exact count over a statically bounded domain;
- an exact count that refuses when a work ceiling is exceeded;
- a capped or lower-bound count;
- a paginated partial aggregate requiring a fold;
- an exact transactionally maintained aggregate.

A bounded scan cannot return an exact total when the matching population exceeds its examination ceiling. “Declared group count times per-group index range” also leaves unanswered whether the count is over the whole group or only the admitted range, what happens at overflow, and whether a missing group means zero, invisible, or unexamined.

This affects the central comparison between Options 1 and 5. Maintained aggregates can potentially return exact values without read-time scans, while callable bounded aggregation must either prove a cardinality bound, refuse, or weaken its result semantics. Those are materially different products and evidence claims.

Resolution: add an explicit semantic matrix covering exactness, work exhaustion, pagination/partial results, integer overflow, empty groups, and update behavior for each callable and maintained aggregate variant.

### BLOCKING-FOR-BAR — Visibility and aggregate noninterference are left as an open question despite being analytically answerable

Option 1 says it preserves the “full evidence model,” yet the document later asks whether grouped counts need a noninterference statement. They necessarily do whenever invisible rows can affect a returned count. A count can disclose existence even when no contributing row is returned.

This is not an empirical question. The research should map at least these alternatives:

- public-only aggregate sources;
- count only caller-visible rows, with visibility-before-aggregation;
- sealed refusal when visibility composition cannot be proved;
- maintained aggregates partitioned by authority or subject;
- deliberately weaker aggregate claims, explicitly failing the full-evidence option.

Resolution: state that protected aggregates require a noninterference contract, then compare the viable visibility models and their work/evidence costs. Until then, Option 1 cannot claim preservation of the full evidence model.

### BLOCKING-FOR-BAR — A distinct bounded-node composition path is not independently assessed

Option 3 briefly mentions a static tree of already-admitted bounded nodes, but then characterizes the honest version as “option 1, iterated” and sequences it after profiles exist. Relevant profiles already exist: stable unique joins and the experimental bounded-children plan.

A narrower path deserves its own assessment: allow a closed server-side composite to invoke several admitted profile nodes within one authoritative transaction, retain each node’s individual cursor and visibility contract, and enforce a composite cumulative work ceiling. Relay’s three child collections could then be expressed by composing bounded-children nodes without first designing one monolithic multi-child/aggregate profile.

This differs materially from:

- a new aggregate profile;
- a general GraphQL-like language;
- free-form imperative reads with declared budgets.

It has its own costs: repeated parent authorization, independent versus coordinated cursors, composite result identity, total budget accounting, live invalidation, and whether data-dependent node invocation is admitted.

Resolution: add this as a separate option or fully analyze it as a first-class sub-option, including why it can or cannot solve Relay and bounded Split-style derivations.

### BLOCKING-FOR-BAR — Option 2 conflates enforcement and diagnostics

Option 2 proposes that the runtime “refuse — or loudly diagnose” budget excess ([LLP 0120](/Users/ccheever/projects/snapback/llp/0120-relational-composition-and-aggregation.research.md:229)), then describes the result as “runtime enforcement.”

Those variants have different evidence consequences:

- fail-closed refusal can enforce a declared ceiling;
- a diagnostic permits the over-budget operation to complete and therefore does not preserve the bounded-work claim.

The declaration model is also incomplete for N+1 execution. “Per-loop bound” does not state how the runtime limits the number of loop iterations, how multiple reads share a cumulative budget, whether dynamic index prefixes are constrained, or how mutation failure rolls back after a late budget exhaustion.

Resolution: split Option 2 into enforced and observational variants. State that diagnostic-only operation does not satisfy no-evidence-regression, and map per-read, per-loop, and whole-invocation ceilings plus mutation rollback semantics.

### MATERIAL — Inline-handler evidence is overstated

The document says each handler declares its read/write tables, an exact result contract, and an `outgrewIr` rationale ([LLP 0120](/Users/ccheever/projects/snapback/llp/0120-relational-composition-and-aggregation.research.md:126)).

The authoring API does not require all of those:

- JS queries require non-empty `reads`, but their result contract is optional ([define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:1680)).
- JS mutations require non-empty `writes`, while `reads`, `result`, and `outgrewIr` are optional ([define.mjs](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:2226)).
- `outgrewIr` is not a query field at all.

The rerun applications often supplied exact results, but that is application evidence, not an invariant of the tier.

Resolution: distinguish API requirements from practices used by the cited arms. For example: queries must declare read tables; mutations must declare write tables; the rerun arms supplied exact results; only applicable JS mutations may optionally declare an `outgrewIr` class.

### MATERIAL — The imperative workloads are overgeneralized as N+1 and “correct”

The summary calls the apps’ imperative handlers “N+1-shaped” and “correct.” Split’s ledger is genuinely N+1-shaped, but Relay’s board view is a fixed number of fan-outs, and Campfire’s sequence allocation is an unbounded range scan rather than N+1.

The diaries establish that retained acceptance cases passed, not general correctness over all states. “Correct” exceeds the empirical evidence.

Resolution: say that the apps use imperative handlers with fixed fan-out, N+1, and unbounded-scan shapes, and that they passed their retained acceptance checks while remaining snapshot-consistent.

### MATERIAL — Claims about Convex’s proof limitations need provenance labels and narrower wording

The first Convex paragraph is properly labeled general background. Later claims—such as Convex not surfacing bounds and its free-form reads “structurally” being unable to prove what Snapback proves—are not consistently labeled.

The product comparison supports “Convex does not currently surface or enforce a declared static reach/work ceiling.” “Structurally cannot” is too strong: static analysis, restricted helper APIs, or external review could in principle prove properties of imperative code.

Resolution: mark those passages as general product-background analysis and replace impossibility language with current-surface language unless a stronger source is supplied.

### MATERIAL — Sequence allocation is under-analyzed and one demand count is overstated

Option 5 calls sequence allocation a small primitive that retires three independent demands, including Linear’s cursor scheme. Diary 0029 shows that Linear used stable sequence cursors successfully; it does not establish sequence allocation there as a pain point comparable to the Campfire and Relay scans.

The proposed counter also needs pre-empirical analysis of:

- scope identity and delete/recreate behavior;
- retry/idempotency interaction;
- gaps after aborted or retried work;
- integer exhaustion;
- whether sequence order means allocation order or commit order;
- hot-key contention;
- authorization to allocate within a scope.

Resolution: characterize Campfire and Relay as the two demonstrated scan-removal demands, treat Linear only as possible reuse, and map counter semantics before calling the primitive small or sufficient.

### DETAIL — Runtime budget refusal is not inherently “in production”

Option 2 says runtime-enforced budgets are weaker because “the refusal arrives in production, not in review.” The same refusal can be exercised during generation-adjacent tests, qualification, or acceptance. The real weakness is that code inspection cannot prove all executions fit; the runtime is the enforcement cut.

Resolution: rephrase the tradeoff around static proof versus dynamic enforcement, not test versus production environment.

## 4. Suggestions

- Add a compact comparison table across the options with rows for exactness, static reach, static work ceiling, runtime refusal, visibility/noninterference, snapshot consistency, cursor model, live invalidation, and applicability to Relay/Split/sequence allocation.

- Separate “multi-child composition,” “aggregation,” and “sequence allocation” earlier. They share diary provenance but have different semantics and likely different owners.

- In Option 5, distinguish incremental maintenance cost from rebuild cost. Count and sum have simple local deltas only after group movement, deletion preimages, overflow, and idempotent replay are specified.

- Replace “anything beyond [a static bounded tree] forfeits declared reach” with a more qualified analysis. Data-dependent execution can still retain a global ceiling if the number of node invocations and cumulative examined entries are dynamically enforced.

- Clarify whether “exact result contract” is evidence about value shape/cardinality only; it does not prove that every source row relevant to an aggregate was examined.

## 5. Open questions

1. For callable aggregation, what result is returned when the examination ceiling is reached: refusal, partial aggregate, capped value, or continuation?

2. Must aggregate values count only rows visible to the caller, and how is that property proved for maintained outputs?

3. Can a composite plan call several existing bounded profile instances within one transaction while preserving additive budgets and independent cursor identities?

4. For Option 2, what binds a dynamic read to its declared index, prefix shape, and cumulative invocation budget?

5. Is a diagnostic-only over-budget execution intentionally offered as a lower evidence tier, or is fail-closed enforcement mandatory under LLP 0115?

6. What ordering guarantee does a sequence allocator provide, and what happens across retries, aborted transactions, scope recreation, and integer exhaustion?

7. Is Split’s required result an exact current ledger for an arbitrarily populated group, or is application-level cardinality admission acceptable? That answer changes which options can actually fit it.

## 6. Verdict: NOT READY

The factual core and overall framing are strong, but the document has not exhausted the available pre-empirical analysis. In particular, aggregate exactness/noninterference, bounded-node composition, and the enforcement-versus-diagnostics split materially change the option space and the no-evidence-regression assessment.

## 7. Recommended next step

Revise LLP 0120 while keeping it in Review:

1. add the bounded-aggregation semantic matrix;
2. resolve the noninterference analysis rather than leaving it as a yes/no open question;
3. assess closed composition of existing bounded nodes as a distinct path;
4. split Option 2’s enforced and diagnostic variants;
5. correct the inline-handler, N+1, Convex-proof, and sequence-demand overstatements.

Then request a targeted round-2 review focused on those deltas.
