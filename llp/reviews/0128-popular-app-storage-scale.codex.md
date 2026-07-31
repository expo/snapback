# LLP 0128 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind on 0128 artifacts, network reachable (all cited external pages fetched)
**Target SHA-256:** `d2f7d6039dacd4db0900113d0a6d4b67e0f7d70e0961f41ccfaceb12c927c209`
**Instruction SHA-256:** `3e793cbd349750476d0a98ea3fc607d4ff5f3d6219bd9b3de5322a2a3f91f02d`
**Status:** completed

## Verbatim review

1. **Overall assessment**

The target hash matches `d2f7d6039dacd4db0900113d0a6d4b67e0f7d70e0961f41ccfaceb12c927c209`. The blindness rule was preserved.

This is strong research: it frames the scaling problem correctly, covers the principal architecture families, and separates present facts from recommendations better than most design surveys. It is not READY, however, because one FoundationDB characterization is false, the Postgres changefeed alternative is tagged more confidently than its sources permit, and the evidence program cannot presently discriminate several candidate families or validate the failure-sensitive contracts of its default spikes.

VERDICT: NOT READY

2. **Strengths**

- The three-way separation of application model, execution language, and authority topology is excellent (`llp/0128-popular-app-storage-scale.research.md:13-32`). It prevents “SQL does not scale” from collapsing several independent design decisions.

- The scope boundary is disciplined (`:60-83`): the document studies substrates without selecting one, reopening SQLite, or pretending to have designed sharding.

- The account of Snapback’s current authority and cursor contracts is faithful (`:127-144`, `:230-246`). LLP 0007 §Commit-version graduation and LLP 0012 §Versioning support the one-stream authority, commit-fencing, multi-stream escape hatch, and opaque `(stream identity, version)` claims.

- The SQLite, Durable Object, and D1 statements are accurate (`:108-120`, `:137-144`, `:190-194`). SQLite documents one writer per file with queued short transactions; Cloudflare documents an inherently single-threaded object with a soft 1,000-request/s limit; D1 documents primary-routed writes, asynchronous read replicas, bookmarks, and sequentially consistent sessions. [SQLite guidance](https://www.sqlite.org/whentouse.html), [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/).

- The architecture survey is broad and generally non-strawmanned (`:248-381`). In particular, it distinguishes authority scaling from specialized read services and acknowledges that every family relocates complexity.

- The contract guardrails are useful and mostly substrate-neutral (`:403-425`), especially opaque cursors, scoped sequences, named atomicity domains, and explicit freshness.

- The confidence section and open questions are unusually honest (`:527-590`). Numeric performance, real locality, distributed-SQL necessity, and log-first compatibility are correctly left empirical.

3. **Concerns**

1. **BLOCKING-FOR-BAR — FoundationDB does not give Snapback control over physical partition boundaries.**

   The document says: “**the physical key layout and partition boundaries are under Snapback's control**” (`llp/0128-popular-app-storage-scale.research.md:332-335`) and later makes “custom placement” part of the use case (`:343-345`).

   FoundationDB lets a layer control logical key encoding and key-range locality in the keyspace, but its Data Distributor decides which storage servers own physical ranges and automatically repartitions/rebalances data. Its own documentation says partitioning is handled automatically and that data is continuously repartitioned; the architecture assigns responsibility for physical ranges to the Data Distributor. [FoundationDB Features](https://apple.github.io/foundationdb/features.html), [FoundationDB Architecture](https://apple.github.io/foundationdb/architecture.html).

   This distinction affects the option space: FoundationDB offers custom logical layout, not arbitrary application-controlled physical placement.

   **Resolution:** Replace “physical key layout and partition boundaries” with “logical key layout and key-range boundaries.” State that FoundationDB controls physical placement and rebalancing. Narrow “custom placement” to custom logical clustering unless another cited substrate actually provides application-directed physical placement.

2. **BLOCKING-FOR-BAR — The evidence program preselects B and C without discriminating the full option space.**

   Phase 2 permits “at most two spikes,” defaults to Postgres plus partitioned cells, admits distributed SQL or transactional KV only for cross-partition atomicity or custom placement, and admits log-first only after narrowing semantics (`:470-482`).

   Phase 1 measures only current SQLite/DO and future Postgres (`:448-468`). It therefore cannot establish whether D or E offers a better throughput/latency/ownership tradeoff, whether G is the answer when read pressure binds, or whether F should be rejected on evidence rather than premise. Cross-partition atomicity and custom placement are not the only reasons to consider D/E; failure handling, rebalancing, regional behavior, operational ownership, and changefeed compatibility can also decide the choice.

   This conflicts with the document’s statement that no option is an unqualified winner (`:53-58`) and with the READY requirement that experiments discriminate among families.

   **Resolution:** Add a falsifiable downselection gate covering every family. For each family, define the workload observation or feasibility result that admits or eliminates it. Lightweight interface/feasibility spikes may suffice for expensive families, but D/E/F/G must be ruled in or out by named evidence rather than excluded by the default pair.

3. **BLOCKING-FOR-BAR — Phase 2 lacks the correctness and failure experiments needed to evaluate its two default spikes.**

   Phase 0 names failover and reshard recovery (`:428-446`), while Phase 3 lists snapshot cuts, duplicate handling, resharding, rollback, and refusal modes (`:484-499`). Phase 2, however, merely names two prototypes (`:470-482`) and supplies no measurements or fault matrix for them.

   Throughput alone cannot establish either prototype’s viability. The Postgres spike must test snapshot/feed cutover, transaction grouping, duplicate delivery, consumer crash, slot rollback or loss, failover, retention exhaustion, schema transitions, and mutation-response publication latency. The cell spike must test multi-cursor resume, cross-cell snapshot consistency, routing changes, live resharding or resnapshot, global auth invalidation, backup cuts, skew, and partial-cell failure.

   **Resolution:** Give each Phase-2 spike a correctness/failure acceptance matrix and attributable measurements. Require conformance and fault-injection results before either family reaches the decision docket.

4. **BLOCKING-FOR-BAR — The Postgres changefeed’s Snapback suitability is an inference tagged as confirmed.**

   The paragraph states that logical decoding and logical replication provide an ordered stream, then concludes: “**That makes a commit-log-derived Snapback stream a credible alternative to a framework-maintained version row**” (`:182-188`). The whole paragraph is tagged `[confirmed]`.

   PostgreSQL’s documentation confirms that a logical slot streams replayable changes from one database, that logical replication applies changes in transactional order, and that a crash can cause duplicate delivery. It does not establish that WAL/LSN positions satisfy Snapback’s mutation-level version, gap-free visibility, no-op mutation, schema-transition, snapshot-cut, retention, failover, or synchronous receipt requirements. [PostgreSQL logical decoding](https://www.postgresql.org/docs/current/logicaldecoding-explanation.html), [logical replication architecture](https://www.postgresql.org/docs/current/logical-replication-architecture.html). The document itself correctly admits this uncertainty in open question 3 (`:569-570`).

   **Resolution:** End the confirmed claim after the documented PostgreSQL behavior. Tag the Snapback-alternative sentence `[inferred]` or “feasibility hypothesis,” and enumerate the exact semantic obligations the Phase-2 spike must prove before removing the framework fence.

5. **MATERIAL — LLP 0127’s proposed aggregate program is presented too much like an existing profile.**

   The document says “LLP 0127's bounded profiles” include “declared keys, budgets, relational shapes, and maintained aggregates” (`:237-241`).

   LLP 0127 §Move 6 says aggregate shapes enter only after result semantics and noninterference contracts are chosen (`llp/0127-parity-and-local-first-synthesis.rfc.md:435-489`). LLP 0115 CV-8 likewise says current relational profiles exclude aggregation and that a third profile or endorsed imperative pattern remains to be decided (`llp/0115-convex-parity-course-corrections.plan.md:442-483`). LLP 0080 explicitly excludes aggregates.

   The trailing “placement use is inferred” does not fully distinguish existing bounded profiles from the accepted proposal to design future aggregate profiles.

   **Resolution:** Say that LLP 0127 proposes extending the bounded-profile program to aggregates, while current profiles provide only the already-defined keys, bounds, and relational shapes. Make placement use and future aggregate availability separately inferred/conditional.

6. **MATERIAL — The FoundationDB treatment omits load-bearing constraints and overgeneralizes ownership.**

   The document says applications inherit FoundationDB transaction limits (`:219-224`) and mentions unspecified “FoundationDB-specific transaction and operational constraints” (`:337-341`), but the cited architecture/features pages do not identify them.

   The first-party limitations page records a 10 MB affected-data hard limit, recommends redesign above 1 MB, limits transactions to roughly five seconds, and states that the database is not itself a user-level security boundary. These constraints matter directly to Snapback’s handler-duration, captured-read, large-mutation, authorization, and bulk-operation contracts. [FoundationDB Known Limitations](https://apple.github.io/foundationdb/known-limitations.html).

   FoundationDB also supplies integrated backup machinery, so “backup/restore … become [Snapback’s] responsibility” should distinguish implementing a database backup system from integrating and operating the substrate’s existing one.

   **Resolution:** Cite the limitations page, name the relevant limits, and map each to Snapback’s transaction model. Distinguish layer responsibilities from substrate-provided operations such as physical distribution and integrated backup.

7. **DETAIL — The summary and body classify family G inconsistently.**

   “The credible scale-up families are” introduces A–F only (`:40-51`), but the candidate section later adds “G. Hybrid cells with specialized read services” (`:367-381`). Since the scope explicitly includes read throughput and subscription fanout, G is part of the researched scale space even if it is not an authority replacement.

   **Resolution:** Either add G to the summary or label A–F as authority families and G as a companion read-scaling family.

8. **DETAIL — The status prose contradicts the metadata.**

   The header says `Status: Review` (`:4`), while the final status section says “Draft Research” (`:592-596`).

   **Resolution:** Change the closing sentence to “Research in Review” or otherwise make it match the metadata without accepting it on the author’s behalf.

4. **Suggestions**

- Replace vendor-level citation labels such as “PostgreSQL documentation” with exact first-party page or section anchors for each confirmed claim.

- Add a composition note showing that families are not mutually exclusive—for example A+G, B+G, C implemented with Postgres cells, or D plus specialized read services.

- Separate “one logical total-order stream” from “one physical sequencer.” The former is an observable contract; the latter is one implementation and may not describe every distributed substrate.

- Give the comparative table uncertainty markers per cell. “Hypothesis” for the whole table is honest, but some entries are documented substrate facts while others depend on unbuilt Snapback integration.

- Define numeric downselection thresholds before Phase 1: acceptable p99, conflict rate, feed lag, recovery time, reshard interruption, operational minimum, and cost per committed mutation.

5. **Open questions**

- All first-party external pages named in the target metadata were reachable. I could verify the cited SQLite, PostgreSQL, FoundationDB, CockroachDB, Durable Objects, Workers storage, and D1 documentation.

- I could not verify that a WAL/LSN-derived token satisfies Snapback’s complete stream contract. PostgreSQL documentation does not answer the framework-specific obligations, and no prototype evidence exists.

- I could not verify any comparative throughput or cost rating for Snapback on Postgres, distributed SQL, FoundationDB, or partitioned cells. The document correctly records that these measurements do not yet exist.

- I could not verify that real Snapback applications have stable, sufficiently fine-grained placement roots. That requires workload traces or diary-derived operation distributions.

6. **Recommended next step**

Revise the FoundationDB characterization, retag the Postgres changefeed conclusion, and replace Phase 2 with a discriminatory downselection plus correctness/failure matrix. Then run a focused round-2 review of the revised substrate facts and evidence program before the author considers any status transition.


## Round 2 — 2026-07-30 (delta)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox; read own round-1 artifact only, blind on Fable artifacts and journal
**Target SHA-256:** `b48178c70410fd79b31d7883afab18f6536ea95b1c83c982b0fbdb4422e0b703`
**Instruction SHA-256:** `02e295246877a2832dc61f2e459570afbae927e1507a4f2070eefcbf4ad6e986`
**Status:** completed

## Verbatim review

1. **Overall assessment**

The target SHA-256 matches `b48178c70410fd79b31d7883afab18f6536ea95b1c83c982b0fbdb4422e0b703`. Seven round-1 concerns are resolved. The evidence program is substantially stronger, but the downselection gate still excludes distributed families on criteria narrower than the document’s own decision axes, and its new numeric thresholds omit the throughput requirement needed to decide whether an architecture clears the popular-app envelope.

VERDICT: NOT READY

2. **Round-1 concern dispositions**

1. **Resolved.** Family E now says “logical key layout and key-range boundaries” are Snapback-controlled while “FoundationDB's data distributor owns physical placement and repartitions ranges automatically” (§E, lines 366–370); its use case is narrowed to custom logical clustering.

2. **Partially resolved.** Phase 2 now names admitting/eliminating evidence for A–G and permits lightweight D/E feasibility checks, but D is considered only when cross-partition atomicity or multi-region survivability is required, and E only for custom logical clustering or model control (lines 567–574). This can still exclude them without comparing failure isolation, automated rebalancing, operational ownership, or other measured tradeoffs that the document identifies as decision-relevant.

3. **Resolved.** Phase 2 now requires correctness-and-failure acceptance matrices and enumerates the required Postgres and cell experiments, including cutover, duplicate delivery, failover, retention exhaustion, resharding, backup cuts, skew, and partial failure.

4. **Resolved.** The documented PostgreSQL behavior remains `[confirmed]`, while Snapback suitability is explicitly a “credible feasibility hypothesis,” tagged `[inferred]`, with the unproven semantic obligations enumerated (lines 193–204).

5. **Resolved.** Finding 6 now distinguishes today’s declared keys, budgets, and relational shapes from the proposed aggregate extension, and makes aggregate availability conditional on LLP 0115 CV-8 and LLP 0127 Move 6.

6. **Resolved.** Finding 5 names FoundationDB’s affected-data, duration, and security-boundary limits and maps them to Snapback contracts; family E separately distinguishes substrate-provided backup machinery from Snapback’s integration and operational responsibilities.

7. **Resolved.** The Summary now labels A–F as authority families and G as a companion read/search/fanout family.

8. **Resolved.** The closing status now reads “Research in Review,” consistent with the metadata.

3. **New concerns**

1. **BLOCKING-FOR-BAR — The supposedly numeric gate has no required throughput or offered-load threshold.** Phase 0 says each profile states “row/index sizes, transaction read/write sets, concurrency, subscription count, retained history, durability class, and acceptable staleness” (lines 522–524). The pre-Phase-1 thresholds cover “p99 admission latency, conflict rate, feed lag, recovery time, reshard interruption, operational minimum, and cost per committed mutation” (lines 549–552), but omit required sustained commits/second, admitted requests/second, offered arrival rate, and test duration. Yet A and B are downselected according to whether they “clear” or are “exceeded” by the envelope. Measuring throughput is not enough without a pinned throughput bar. **Resolution:** Add required offered and admitted load, sustained successful commits/second, burst shape, and measurement duration to every Phase-0 envelope and to the numeric downselection thresholds.

2. **MATERIAL — The new family-C implementation lanes are asserted equivalent without establishing equivalent contracts.** Family C says database-owned sharding “delivers the same placement semantics” as Snapback-routed cells (lines 322–326), immediately after defining each cell as owning its own transactions, version stream, journal, invalidation, and routing relationship. A Citus/Vitess-style shard does not inherently supply those Snapback cell boundaries or stream semantics; cross-shard transactions, routing ownership, resharding, and journal topology depend on the specific integration. **Resolution:** Present database-owned sharding as a feasibility hypothesis, define the observable cell contract both lanes must satisfy, and identify which routing, stream, transaction, and reshard responsibilities differ by lane.

3. **MATERIAL — Tenant isolation is incorrectly removed as a discriminating axis.** The comparative frame says, “Tenant isolation has no row because every family preserves per-app isolation” (lines 455–457). Logical namespace isolation is not equivalent to resource, security, noisy-neighbor, operational, or failure-domain isolation. The document itself notes that FoundationDB is not a user-level security boundary, while dedicated cells, shared primaries, distributed ranges, and shared projections have materially different isolation properties. **Resolution:** Restore tenant isolation to the comparison and evidence program, separating logical/security isolation, resource contention, failure containment, and the cost of isolating one exceptional app from ordinary apps.

4. **Recommended next step.**

Revise the Phase-0/Phase-1 numeric gate to include a target load envelope, broaden D/E downselection beyond the two current admission triggers, and correct the family-C and tenant-isolation comparisons. Then run a focused delta review of those evidence-program and comparative-frame changes before treating LLP 0128 as READY.


## Round 3 — 2026-07-30 (focused check)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox; read own round-1/2 artifact only, blind on Fable artifacts and journal
**Target SHA-256:** `59dcc0cccef6d7ecd4f83d1e175ef5dc4bcf391cb9304a6e77efdf63ee18803a`
**Status:** completed

## Verbatim review

1. **Overall assessment**

The target SHA-256 matches `59dcc0cccef6d7ecd4f83d1e175ef5dc4bcf391cb9304a6e77efdf63ee18803a`. All four round-2 concerns are resolved, and the changed text introduces no new defect at the READY bar.

VERDICT: READY

2. **Round-2 concern dispositions**

1. **Resolved — round-1 concern 2, previously partial.** The D and E gates now admit feasibility checks based on failure isolation/containment, automated rebalancing, operational ownership, local parity, minimum operating footprint, licensing, and cost against the pinned thresholds. They are no longer restricted to cross-partition atomicity, survivability, or custom-layout triggers.

2. **Resolved — numeric workload gate.** Every Phase-0 profile now specifies offered arrival rate, burst shape, required sustained successful commits/second, admitted requests/second, and measurement duration. The colocated exceptional-app profile covers interference with ordinary apps. The pre-Phase-1 gate repeats these quantities and explicitly defines “clears the envelope” by the pinned numbers.

3. **Resolved — family-C implementation lanes.** Database-owned sharding is now identified as a feasibility hypothesis. Both lanes must satisfy an explicit observable cell contract, while routing, cross-shard transactions, resharding, and journal topology are correctly identified as lane-dependent responsibilities. The comparative table qualifies the machinery rating by lane.

4. **Resolved — isolation axis.** The comparative-frame prose now separates logical isolation from resource, security, and failure isolation. The companion table compares contention, security boundaries, blast radius, and the cost of dedication across families rather than assuming that per-app logical isolation makes the axis nondiscriminating.

3. **New concerns**

None.

4. **Recommended next step**

Treat the research document as ready for the author’s status decision, then begin the pinned Phase-0 workload envelopes and LLP 0125 normalized-burst measurement described by the evidence program.
