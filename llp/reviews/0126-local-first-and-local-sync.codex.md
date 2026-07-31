# LLP 0126 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model gpt-5.6-sol (reasoning effort: medium)
**Reasoning effort:** CLI default
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind
**Target SHA-256:** `c9bcf8155a3602867c50a41f34f7ce703ec5d59fd3e24192c9f4cbec6d93e60c`
**Instruction SHA-256:** `f4582d729ac4602b7ae5d3fe80e85edfaeeeb639dc7658f63fb3365ce698fc24`
**Status:** completed

## Verbatim review

## 1. Overall assessment

LLP 0126 is unusually strong research: broad, candid about unmeasured territory, and mostly accurate against current-main code, the cited diaries, and prior-art LLPs. The Contract-arm retention/replay slice, browser-client behavior, reservation retry gate, optimistic rollback, persisted RQS resume, and LLP 0051 IR/WASM status are represented substantially correctly.

It does not yet clear the stated “no flaws left without empirical work” bar. Its central embedded-runtime thesis overstates what content identity proves, calls a server-MACed lease “signed,” and under-inventories the gap between a packaged server executable and an embeddable client runtime. The option board also omits or collapses credible middle lanes and includes several recommendation-shaped “leans.”

I did not consult any LLP 0126 review artifact.

## 2. Strengths

- “What Snapback has today” is the strongest section. The narrow reservation retry claim matches the exact predicate in [packages/snapback-client/index.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:3498), including status, code, exact diagnostic keys, `short-jitter`, and `effectCommitted: false`. The 40-attempt and 20–80 ms defaults are also correct.

- The JS-arm boundary is accurately drawn:

  - `clientMutationId` is caller-supplied, not minted or durably queued by the headless client ([index.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:4885)).
  - reconnect retains last-known rows and marks them `polling` or `stale` ([index.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:7969));
  - persisted RQS resume is opt-in, verifies before render, and suppresses resume when the injected outbox is non-empty ([index.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:6449));
  - optimistic rejection removes the exact layer and recomputes from the authoritative base ([external-store.mjs](/Users/ccheever/projects/snapback/packages/snapback-client/external-store.mjs:333)).

- The Contract-arm claim is carefully bounded and matches the guide. `sync.offline` and authorized leases are locally shipped in [guide/capabilities.md](/Users/ccheever/projects/snapback/guide/capabilities.md:58), while the guide restricts `Parity` to store-configured surfaces whose entire mutation set has derivable declarative plans ([offline-and-retention.md](/Users/ccheever/projects/snapback/guide/sync/offline-and-retention.md:22)). The manifest flags are correctly quoted from [src/manifest.rs](/Users/ccheever/projects/snapback/src/manifest.rs:6100).

- The lease’s operational behavior is otherwise described well: 24-hour maximum, equality-is-expiry, delete-before-render, and renewal only through full revalidation all match [LLP 0043](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:81).

- LLP 0051 is not presented as a shipped WASM runtime. The browser ladder correctly separates the shipped/partly shipped IR-derived optimistic path from the designed but unimplemented WASM rung. [LLP 0051](/Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:754) supports the narrow IR-derived `Parity` composition; its WASM runtime remains future work ([LLP 0051](/Users/ccheever/projects/snapback/llp/0051-language-neutral-data-tier.rfc.md:1098)).

- The diary citations check out, including:

  - Convex’s warm-session retry success and cold-restart GAP ([Diary 0027](/Users/ccheever/projects/snapback/diaries/0027-todo-backend-bakeoff.diary.md:329));
  - Snapback’s three protected-offline GAPs ([Diary 0027](/Users/ccheever/projects/snapback/diaries/0027-todo-backend-bakeoff.diary.md:1354));
  - Firebase’s strong cold cache and retained revoked bytes ([Diary 0028](/Users/ccheever/projects/snapback/diaries/0028-chat-backend-bakeoff.diary.md:309));
  - the local-first issue-tracker conclusion ([Diary 0029](/Users/ccheever/projects/snapback/diaries/0029-linear-backend-bakeoff.diary.md:128));
  - Diary 0039’s exact scope exclusion and 55/45 score ([Diary 0039](/Users/ccheever/projects/snapback/diaries/0039-snapback-convex-main-rerun-report.diary.md:15), [scope](/Users/ccheever/projects/snapback/diaries/0039-snapback-convex-main-rerun-report.diary.md:67)).

- The prior-art citations mostly say what LLP 0126 attributes to them. Electric’s 2024 reversal, PowerSync’s second-generation Sync Streams, Turso’s rollback/replay, Ditto’s read-time business resolution, Jazz’s 2026 retreat, and InstantDB’s pending-queue rollback are all supported by LLPs 0022 and 0082–0085.

- Empirical restraint is substantially better than normal for an architecture survey. Finding 11 explicitly inventories the absent measurements, and the browser/mobile feasibility paragraph marks full-runtime WASM and Rust mobile embedding as unassessed.

## 3. Concerns

### A. BLOCKING-FOR-BAR — Handler content identity is overstated as execution equivalence

LLP 0126 says the replica can know from the implementation hash that it executed “byte-identical logic” to what the server will settle ([target](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:352)), then builds “same-code-both-sides,” uniqueness, moat, and receipt claims on that proposition.

The v1 hash covers a canonical handler/plan representation plus contracts, declared effects, authorization dependence, and related metadata ([codegen](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4156)). It does not bind:

- runtime binary or Hermes build;
- client evaluator implementation/version;
- conformance-corpus identity;
- host-call semantics;
- storage semantics;
- target capability activation;
- schema/data epoch beyond what happens to enter the hashed manifest fields.

Thus the hash proves source/plan identity, not equivalent execution. Two runtimes can admit the same hash and produce different behavior. That risk is especially direct for the IR rung, where separate server and client evaluators intentionally exist.

The Replicache contrast is directionally correct—its official documentation makes server/client code sharing optional and allows their results to differ—but that does not establish Snapback’s stronger proof without an execution-environment identity. [Replicache’s official model](https://doc.replicache.dev/concepts/how-it-works) is sufficient primary evidence for the comparison.

Resolution: replace “byte-identical logic” with “identical admitted handler/plan identity,” and define the additional execution-identity tuple that would be required for a parity proof: implementation hash, artifact/schema activation, runtime/evaluator identity, portable-semantics profile, and accepted corpus version. Until that exists, describe the moat as a testable architectural hypothesis.

### B. BLOCKING-FOR-BAR — The lease is MACed, not signed, and cannot support the claimed evidence analogy

The document alternates between the accurate “server-MACed `AuthorizedLease`” ([target](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:416)) and “server-signed fact,” “signed lease,” and “server-signed leases” ([target](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:431), [cross-cutting claim](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:559)).

LLP 0043 explicitly says the client does not cryptographically verify the MAC offline. It verifies structure, binding, expiry, rollback state, and an unkeyed hash of the exact stored lease bytes; the server keyring verifies the MAC later ([LLP 0043](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:93)). That is not a signature and is not a client-verifiable server attestation.

This matters because the document uses the lease as the template for speculative-versus-settled receipt evidence. A self-attested local receipt cannot become independently server-authenticated merely by copying the AuthorizedLease storage pattern.

Resolution: use “server-issued, server-MACed lease” consistently; state the client’s actual offline verification locus; remove “signed” uniqueness claims; and separate exact-byte custody from cryptographic settlement attestation. If independently verifiable offline settlement evidence is desired, name server signatures as a new design option rather than treating them as shipped precedent.

### C. BLOCKING-FOR-BAR — The embedded-runtime breakage inventory conflates packaging, subprocess hosting, and embedding

The existence of a 48,240,096-byte Darwin server binary, a Hermes framework, a Rust library target, and a four-line CLI entry point proves packaging and hostability. It does not yet prove an application-embeddable runtime. LLP 0126 sometimes acknowledges this, but still calls the runtime “an embeddable artifact” and says native targets can carry the full runtime ([target](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:369), [platform claim](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:639)).

At least two materially different lanes are collapsed:

- desktop subprocess/sidecar: spawn the existing server binary and communicate over IPC/HTTP;
- in-process mobile/native library: expose and stabilize an embeddable ABI with app-owned lifecycle.

The honest breakage inventory still needs:

- process and IPC topology;
- local database ownership and locking;
- crash recovery between speculative journal and local SQLite commit;
- app suspension/background-execution constraints;
- binary/framework code signing and store policy;
- runtime and schema upgrades while an outbox exists;
- resource ceilings and eviction;
- secure local custody and device loss;
- platform-specific availability of Hermes and Rust host dependencies.

Resolution: split sidecar and in-process embedding into separate sub-options, list these costs, and downgrade mobile plausibility to an empirical spike question.

### D. MATERIAL — The “five query-scoped systems to zero” statement is factually over-narrow

LLP 0084 does contain the five-to-zero synthesis, but LLP 0022 describes Turso as whole-database/page replication, not query-scoped sync. LLP 0126 repeats the stronger wording that five peers sync “query-scoped state deltas” ([target](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:30), [approach 5](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:260)).

The defensible count is:

- five use client-facing materialized state rather than client-authored event logs;
- four are query/subscription/bucket scoped;
- Turso is whole-database/page scoped.

Likewise, “the field retreated to Snapback’s model” is too broad. Electric retreated to read-path sync with writes outside its core; Jazz v2 moved toward trusted-server policy and LWW but retained an embedded replica, offline writes, history, and branching.

Resolution: correct the count and say the record corroborates server authority, tentative writes, and state-delta delivery—not that all systems arrived at Snapback’s exact model.

### E. BLOCKING-FOR-BAR — The option board misses credible middle lanes and treats Option B unfairly

The approach survey is broader than the actual Snapback option board. Missing or collapsed options include:

1. A Replicache-class persistent client view with local, client-specific mutators and server settlement, without requiring the full Snapback runtime or same-code proof.

2. A governed partial local database: server-authorized materialized rows stored in SQLite but exposed through generated query/result façades rather than arbitrary SQL. Such a lane need not inherently bypass egress validation; read-set capture is only required when a local read becomes mutation evidence.

3. Desktop sidecar execution as distinct from full in-process/native embedding.

Option B currently treats “SQLite replication” largely as raw SQL and then rejects the evidence regression that this chosen formulation creates. That does not fairly evaluate the governed-replica form already suggested by Electric, PowerSync, and Snapback’s own authorized-result unit.

Resolution: add the pragmatic client-mutator lane, split governed partial replication from raw SQL replication, and split desktop sidecar from mobile/in-process embedding. Reassess each against no-evidence-regression rather than treating regression as inherent.

### F. MATERIAL — Several “leans” are decisions or empirical claims in analysis clothing

Examples include:

- “Risk: low” and “highest confidence-per-cost” for Option A;
- “stage 1 is cheap” and “durable structural moat” for Option C;
- “near-zero cost” and “do regardless” for Option E;
- “beats Convex” before an acceptance run;
- Option F framed as wasting shipped work and contradicting strategy.

“Do regardless” is a decision. The cost/risk rankings lack sizing, platform proof, or an implementation spike. The confidence section’s blanket statement that leans are “structural arguments” does not neutralize recommendation-shaped wording.

Resolution: replace “Lean” with “Conditions favoring this option” and “Evidence still needed.” Replace low/cheap/near-zero with explicit hypotheses. Option E should say it composes independently, not that it must be done.

### G. MATERIAL — General-background provenance is honest but incomplete for the READY bar

The `(c)` label is transparent, but several unverified claims become load-bearing in cost arguments or uniqueness claims:

- Replicache’s dual implementation and rebase model;
- Automerge history retention;
- Yjs GC behavior;
- Couch conflict presentation;
- Figma’s centralized LWW/prediction model;
- cr-sqlite behavior and activity;
- Linear’s persisted object graph.

These can be checked without writing Snapback code. Official sources already substantiate much of the contour: [Replicache](https://doc.replicache.dev/concepts/how-it-works), [Automerge history/compaction](https://automerge.org/docs/cookbook/modeling-data/), [Figma’s multiplayer design](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [CouchDB conflicts](https://docs.couchdb.org/en/stable/replication/conflicts.html), and [cr-sqlite](https://github.com/vlcn-io/cr-sqlite).

Resolution: add a dated primary-source list and promote every load-bearing category-(c) claim to verified background. Leave only genuinely incidental historical contours unverified. Bound “only Snapback” to the explicitly surveyed comparison set.

### H. DETAIL — The ideals framing contradicts later analysis

The frame says every approach can serve ideals 1–3 ([target](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:77)), but approach 6 explicitly cannot make the network optional across restart, and local-only explicit export does not automatically prevent work from being trapped on one device.

Resolution: say the approaches serve different subsets of ideals 1–4 and add a compact coverage matrix.

## 4. Suggestions

- Add a table comparing each option across: cold boot, offline writes, local execution, arbitrary local reads, server authority, revocation bound, browser/native reach, migration risk, and evidence impact.

- Separate three identities throughout approach 9:

  - handler/plan identity;
  - execution-environment identity;
  - authoritative settlement identity.

- Clarify that LLP 0051’s shipped client evaluator currently derives optimistic overlays; it is not yet a full local transactional mutation runtime over a partial SQLite replica.

- Add encryption-at-rest/device-loss, quota/eviction, multi-tab ownership, and local-store backup/restore to the cross-cutting axes. LLP 0043 itself leaves mobile encryption open.

- Replace “most successful CRDT vendor” with a bounded factual formulation such as “the most heavily funded CRDT-focused vendor in the surveyed corpus.”

- Preserve finding 11, but connect every cost/risk statement to a named measurement or spike.

## 5. Open questions

1. What exact tuple would prove local and server executions used equivalent semantics—not merely the same handler hash?

2. Does approach 9 begin as a desktop sidecar, an in-process native library, or an IR-only client evaluator? These have different product and evidence contracts.

3. Is a governed authorized SQLite materialization compatible with result-contract validation when local reads are presentation-only?

4. Can a client-specific mutator lane provide most of Replicache’s benefit while remaining explicitly below `Parity`?

5. What offline evidence is required from a speculative receipt: exact local provenance, server-verifiable settlement, or third-party-verifiable server attestation?

6. Is public-data retention default-on acceptable, and what is the deletion/device-loss story separate from protected-query leases?

7. Which competitive set supports “only surveyed” uniqueness claims, and were retention authorities examined consistently across every member?

## 6. Verdict

**NOT READY**

The document is close in breadth and substantially correct on shipped Snapback behavior, but the central differentiator currently rests on an overstrong content-hash inference and an incorrect signed-lease analogy. The option board also needs credible middle lanes before it can claim to have exhausted pre-empirical analysis.

## 7. Recommended next step

Revise in one focused pass:

1. correct MAC/signature and five-to-zero terminology;
2. recast content identity as source/plan identity and name the missing execution identity;
3. split sidecar, governed replica, client-mutator, and in-process embedded-runtime options;
4. convert recommendation-shaped leans into conditions and evidence gates;
5. add dated primary sources for load-bearing category-(c) claims.

After that, run a second independent review concentrated on the revised approach-9 proof boundary and option-space fairness.

## Round 2 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model gpt-5.6-sol (reasoning effort: medium)
**Reasoning effort:** CLI default
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind; round-2 delta review at commit 14d73928 (`git diff b50690ec -- llp/0126-local-first-and-local-sync.research.md`) against the reviewer's own Round 1 record
**Target SHA-256:** `4814e5b3eb3781c43b3bfe9e2545099e1d7c7e9f6a831873d92ca33b4cc931d5`
**Instruction SHA-256:** `fb630c57e4ca8b653f472bcb1d48c9e9cc32f0a74568e2772c56a5831048afde`
**Status:** completed

### Verbatim review

## Round-2 delta assessment

The revision fixes most of the technical substance, especially the lease model, hosting inventory, field-retreat characterization, and ideals matrix. It does not yet meet the unusually strict “exhausted pre-empirical analysis” READY bar because the execution-identity discussion contains one factual contradiction and the option board still embeds unsized recommendations.

| Item | Resolution | Assessment |
|---|---|---|
| A | **Partial** | The five-element tuple is sound: source/plan hash; runtime/evaluator identity; portable semantics plus corpus version; captured host answers; store semantics plus schema/artifact activation ([LLP 0126](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:479)). This matches the actual hash boundary: codegen hashes handler/plan, contracts, reads/writes, auth and related metadata, but not runtime or schema activation ([codegen](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4156)). LLP 0123 supports binary+Hermes digest identity, and LLP 0051 D5 supports the version-pinned semantics/corpus component. “Same code” is correctly recast as a hypothesis. However, line 594 newly says “the hash names its schema era,” contradicting both the tuple and codegen. |
| B | **Resolved** | “Server-issued, server-MACed” is now consistent, and the client/server verification loci are accurately separated ([LLP 0126](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:596)). This matches LLP 0043’s exact custody checks and server-keyring verification rule ([LLP 0043](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:84)). |
| C | **Resolved** | Co-packaging, sidecar execution, and in-process embedding are distinguished; all nine requested cost classes are covered, with several additional costs. Mobile is correctly demoted to a spike with explicit success dimensions and OQ10 ([LLP 0126](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:514)). |
| D | **Resolved** | The count is now the defensible LLP 0084 tally: five materialized-state systems, four query/subscription/bucket scoped, Turso whole-database/page scoped, zero client-visible event logs. “Retreated to” is narrowed to “retreated toward,” with Electric and Jazz differences preserved. |
| E | **Partial** | The missing lanes are now present: Replicache-class Option C, raw/governed B1/B2, and sidecar/in-process D3a/D3b. B2 is fairly treated. The remaining board is not fully neutral: B1 has “none identified” as its conditions despite obvious public-data or deliberately lower-capability conditions; Option C claims “a fraction” of D’s cost without sizing; and D’s numbered staging makes the desktop sidecar appear dependent on the WASM stage even though those are independent platform lanes. |
| F | **Not resolved substantively** | The headings now say “conditions favoring” and “evidence gate,” but recommendation-shaped language remains: Option F is “no-regrets under every branch,” effectively replacing “do regardless”; Option G “cancels” rather than defers the graduation path and “wastes” the Contract slice; Option C asserts fractional cost. These conflict with the section’s statement that none of its cost/risk language is sizing or decision. |
| G | **Partial** | None of the named sources looks fabricated. Replicache, the 2017 JSON-CRDT paper, Yjs/YATA, CouchDB, Figma’s 2019 post, cr-sqlite, and Ink & Switch’s 2019 essay are genuine primary sources. For example: [Replicache](https://doc.replicache.dev/concepts/how-it-works), [JSON CRDT paper](https://martin.kleppmann.com/2017/04/24/json-crdt.html), [Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [CouchDB](https://docs.couchdb.org/en/stable/replication/conflicts.html), and [Ink & Switch](https://www.inkandswitch.com/essay/local-first/). But the document still says none received a dated verification pass. Moreover, Linear has an official, dated Tuomas Artman source from June 29, 2023, so “cannot confidently date” is unnecessarily weak, although keeping the detailed architecture contour uncertain is appropriate: [Scaling the Linear Sync Engine](https://linear.app/now/scaling-the-linear-sync-engine). |
| H | **Resolved** | The 9×4 matrix exists and removes the original contradiction, including explicit restart and transfer qualifications for approaches 6 and 8 ([LLP 0126](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:137)). |

## New concerns

1. **MATERIAL — schema-era detection is assigned to the wrong identity.**  
   [Line 594](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:594) says the implementation hash makes an S1/S2 mismatch detectable because it “names its schema era.” It does not. Resolution: say the complete execution tuple or settlement envelope must carry schema/artifact activation, or propose adding that activation to the hash.

2. **MATERIAL — the option board still contains disguised sizing and recommendations.**  
   “At a fraction of Option D’s cost,” “no-regrets under every branch,” and “cancels/wastes” exceed conditions-and-evidence analysis. Resolution: replace them with structural scope comparisons and neutral conditions; give B1 a real admissible condition or explicitly classify it as rejected by a named governing constraint.

3. **DETAIL — Option D’s staging implies a false dependency.**  
   Desktop sidecar execution does not inherently follow WASM handler artifacts. Present browser IR/WASM and desktop sidecar/in-process work as parallel platform ladders unless an actual dependency is identified.

4. **DETAIL — source verification metadata remains incomplete.**  
   The sources are real, but the document should record verification dates and use the available dated official Linear source while retaining uncertainty around details not established by that source.

## Verdict

**NOT READY**

The central direction is now credible, but the schema-hash contradiction is load-bearing and the option-board language has not fully cleared the round-1 empirical and decision-hygiene concerns.

## Recommended next step

Make one narrow correction pass:

- remove the schema-era claim from the implementation hash;
- neutralize the remaining cost/recommendation wording;
- separate Option D’s browser and desktop ladders;
- add verification dates, including Linear’s official 2023 source.

Then run a final delta-only check focused on those four edits; another broad research pass should not be necessary.

## Round 3 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model gpt-5.6-sol (reasoning effort: medium)
**Reasoning effort:** CLI default
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind; round-3 final delta check of the v0.3 fix pass (`git diff 14d73928 -- llp/0126-local-first-and-local-sync.research.md`) scoped to the reviewer's own four Round 2 items plus the carried B1 adjudication
**Target SHA-256:** `0cb8a9a6423fc894537b3ddfa55a9235f525196ab48a7b26fb0fafcc17b77664`
**Instruction SHA-256:** `f50707d0f1d012ac427e0187471412f584d0d50298614d6b55d901631174af02`
**Status:** completed

### Verbatim review

## Round-3 delta check

1. **Schema-era claim — RESOLVED.**  
   The hash is correctly limited to source/plan identity; schema/artifact activation is execution-identity element 5 and must travel in the settlement submission ([LLP 0126:611](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:611)).

2. **Residual recommendation/sizing language — PARTIAL.**

   - Option F’s “no-regrets” wording is now a neutral compatibility relationship.
   - Option G now states the consequences of deferral without “cancels/wastes.”
   - **MATERIAL:** Option C’s new “strictly smaller build surface” remains an unsupported total-surface comparison ([line 937](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:937)). The parenthetical proves only that C avoids three D-specific workstreams; C also introduces its own mutator and authorization surfaces. Replace it with the direct structural comparison, without “strictly smaller.”

3. **Option D staging — RESOLVED.**  
   The browser and desktop ladders are parallel, and the desktop sidecar is explicitly independent of WASM ([line 949](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:949)).

4. **Verification dates / Linear source — RESOLVED.**  
   The document records the 2026-07-30 fetch, correctly identifies Tuomas Artman and June 29, 2023, and preserves the limitation that the page is a talk pointer rather than textual support for the architecture contour. The [official Linear page](https://linear.app/now/scaling-the-linear-sync-engine) confirms those facts.

## B1 adjudication

**Needs a one-line addition.** “None identified” does not survive the option-space fairness bar ([line 904](/Users/ccheever/projects/snapback/llp/0126-local-first-and-local-sync.research.md:904)). A plausible condition is a deliberately public/non-sensitive, read-only dataset where arbitrary local SQL is required and Snapback’s governed authorization/evidence guarantees are explicitly not claimed. This is a carried MATERIAL completeness issue, despite the small fix.

No other fresh defects were found in the v0.3 changes; `git diff --check` is clean.

**Verdict: NOT READY.**

Recommended next step: make two narrow wording edits—neutralize Option C’s total-surface comparison and add B1’s public/read-only condition, ideally with a matching scope-enforcement evidence gate. Then perform a mechanical two-hunk check; no further research pass is needed.

## Round 4 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model gpt-5.6-sol (reasoning effort: medium)
**Reasoning effort:** CLI default
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind; round-4 mechanical two-hunk check of the v0.4 edits (option C's comparison sentence; option B1's conditions-favoring plus scope-enforcement evidence gate) against `git diff 14d73928 -- llp/0126-local-first-and-local-sync.research.md`, scoped to the reviewer's own Round 3 recommended next step
**Target SHA-256:** `64df5aebfc63283bb5c701f940bdb1e2c33ba5daa0723bf0e1d9be5a6c946a1d`
**Instruction SHA-256:** `5ddf3a58e7cf3d3d3a02c90330a43b0ae40ea15c5c37cffc1414648b03facf19`
**Status:** completed

### Verbatim review

**Verdict: READY**

Option C — RESOLVED: direct structural comparison replaces the unsupported total-cost claim; no fresh defect.

Option B1 — RESOLVED: fair conditions-favoring case and matching scope-enforcement evidence gate added; no fresh defect.

Recommended next step: append this round-4 READY result to the Codex review artifact, then return LLP 0126 to the author for status disposition.
