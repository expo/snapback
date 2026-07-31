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
