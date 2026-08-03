# LLP 0159 universal table storage layout review — Codex family

## Round 1 — 2026-08-03 (target v0.1, SHA-256 cd69332a25d05d40aa64dabc3f270fb3fce48a112f73d5edc017ec3196960587)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context over the working tree at 50ff432a; instruction capsule at review time pinned the target SHA, named the governing corpus docs to read, and barred reading llp/reviews/. Orchestrated by the Fable session that authored the draft, which therefore does not count as a reviewer; the review is recorded verbatim below.

---

## 1. Overall assessment

The reviewed file matches the supplied SHA-256. It is a clear, decision-oriented Research document with a plausible recommendation and useful reopening triggers. Its strongest findings—Snapback’s native physical constraints, staged generations, and the separability of Convex’s deployment-global coupling—survive spot-checking. It is not yet decision-grade, however: several load-bearing claims turn future or partial Snapback capabilities into things “we already have,” broaden cited LLPs beyond what they say, and incompletely account for the universal layout’s benefits. The recommendation may remain “do not remake,” but it needs a more accurate argument.

## 2. Verdict — NOT READY

The central recommendation is plausible, but the current evidence and confidence calibration are not yet fit to leave Draft.

## 3. Strengths

- §“The two layouts, precisely” accurately describes Snapback’s physical mapping. LLP 0007 specifies relational tables and physical columns ([LLP 0007:68](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:68)); implementation emits `NOT NULL` columns and atomic rebuilds ([storage.rs:10714](/Users/ccheever/projects/snapback/src/storage.rs:10714), [storage.rs:10842](/Users/ccheever/projects/snapback/src/storage.rs:10842)) and real `CREATE UNIQUE INDEX` statements ([storage.rs:11050](/Users/ccheever/projects/snapback/src/storage.rs:11050)). Schema DDL and manifest publication share one `IMMEDIATE` transaction ([auth_mode.rs:1353](/Users/ccheever/projects/snapback/src/storage/auth_mode.rs:1353), [auth_mode.rs:1371](/Users/ccheever/projects/snapback/src/storage/auth_mode.rs:1371), [auth_mode.rs:1394](/Users/ccheever/projects/snapback/src/storage/auth_mode.rs:1394)).

- F1 correctly names `StageTableGeneration`; it is both a real LLP 0081 step ([LLP 0081:287](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:287)) and implemented as migration-private successor storage ([migration_executor.rs:2193](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:2193)).

- F4 is careful and well-supported. LLP 0102 attributes the observed index deletion to deployment-wide function/schema reconciliation ([LLP 0102:132](/Users/ccheever/projects/snapback/llp/0102-seven-backend-five-app-bakeoff.plan.md:132)), while LLP 0074 explicitly limits what can be inferred from that incident ([LLP 0074:640](/Users/ccheever/projects/snapback/llp/0074-convex-competitive-strategy.rfc.md:640)).

- §“Should we remake Snapback around it?” gives falsifiable reopening triggers instead of pretending the decision is timeless. In particular, it acknowledges the absence of hosted DDL evidence and connects reopening to measured pain.

- External facts and F5 are at least labeled `observed` or `inferred`, and §Confidence admits that the Convex facts were not verified against implementation source. That is honest, even though the provenance needs strengthening.

## 4. Concerns

1. **BLOCKING — implemented engine portability is claimed where only a draft contract and an unimplemented path exist.**

   - **Claim:** “engine portability, which we already have at the cost LLP 0007 already paid” ([0159:169](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:169)).
   - **Evidence:** LLP 0046 is Draft and says Postgres remains “a design promise” ([LLP 0046:27](/Users/ccheever/projects/snapback/llp/0046-postgres-graduation-path.rfc.md:27)). It also says there is no storage abstraction yet and that extracting one is the largest prerequisite cost ([LLP 0046:38](/Users/ccheever/projects/snapback/llp/0046-postgres-graduation-path.rfc.md:38)). LLP 0007 itself remains Draft ([LLP 0007:1](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:1)).
   - **Resolution:** Separate “portable semantics specified,” “SQLite implementation shipped,” and “second-engine portability proven.” Recost the universal layout’s smaller persistence-adapter surface as a genuine benefit, even if the total custom-engine cost still dominates.

2. **MAJOR — the Postgres citation is sharpened into a promise the RFC does not make.**

   - **Claim:** “the graduation promise (‘your data in a real relational database’) becomes marketing rather than architecture” ([0159:127](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:127)).
   - **Evidence:** That quoted promise does not appear in LLP 0046. Its stated promise is moving without rewriting schema, handlers, clients, or tests ([LLP 0046:15](/Users/ccheever/projects/snapback/llp/0046-postgres-graduation-path.rfc.md:15)); its proposed implementation does map fields and indexes into native Postgres DDL ([LLP 0046:91](/Users/ccheever/projects/snapback/llp/0046-postgres-graduation-path.rfc.md:91)).
   - **Resolution:** Say that a universal layout would abandon LLP 0046’s proposed native application-shaped Postgres schema and therefore require re-ratification. Remove the invented quotation and distinguish operational use of Postgres from native relational inspectability.

3. **MAJOR — LLP 0011 requires query-plan pushdown, not specifically SQL, and its general permission language is unimplemented.**

   - **Claim:** “LLP 0011’s visibility model is pushdown-compilable to SQL” and “the whole authorization-evaluation strategy would need a new home” ([0159:112](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:112)).
   - **Evidence:** LLP 0011 says predicates must compile into “the query plan,” evaluable by storage and matcher layers ([LLP 0011:432](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:432)); it explicitly says no general permission language exists yet ([LLP 0011:446](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:446)). The narrower shipped path does lower closed filters, including auth-derived values, into SQLite `WHERE` clauses ([storage.rs:11267](/Users/ccheever/projects/snapback/src/storage.rs:11267), [storage.rs:11432](/Users/ccheever/projects/snapback/src/storage.rs:11432)), while the live matcher already evaluates the same plan independently ([live_matcher.rs:304](/Users/ccheever/projects/snapback/src/live_matcher.rs:304)).
   - **Resolution:** Distinguish the abstract pushdown requirement, the shipped closed SQL lowering, and the unbuilt general language. A universal layout would replace the SQL lowering and require an index-aware executor; it need not discard the rule IR, auth projection, or matcher semantics.

4. **MAJOR — the online-first causal claim is too strong and the benefit inventory is incomplete.**

   - **Claim:** the universal layout is “the price of admission” for online-first evolution, while staged generations provide benefits “we can mostly obtain” already ([0159:30](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:30)).
   - **Evidence:** LLP 0081’s implemented profile is explicitly exclusive and maintenance-mode ([LLP 0081:90](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:90), [LLP 0081:131](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:131)); zero-downtime migration is a non-goal, and a per-table online/dual-write profile remains open ([LLP 0081:789](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:789), [LLP 0081:810](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:810)). The target itself concedes that layout alone does not deliver online execution ([0159:92](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:92)).
   - **Resolution:** Recast universal layout as making a broad class of schema and index operations logical/background operations, not as necessary or sufficient for online migration. Account separately for homogeneous persistence adapters, catalog-object scaling, schema-less data, uniform MVCC/reactivity, and custom cross-engine semantics.

5. **MAJOR — LLP 0057’s rescue path is mischaracterized and does not depend on application-shaped managed data.**

   - **Claim:** “LLP 0057’s foreign-database rescue path … has no meaning if Snapback-managed data is not shaped like a database” ([0159:124](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:124)).
   - **Evidence:** LLP 0057 owns a narrow reserved-name collision rescue: a foreign `_auth_*` table is copied to a nonreserved physical name ([LLP 0057:1154](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:1154), [LLP 0057:1207](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:1207)). It explicitly refuses to become a generic object editor ([LLP 0057:1200](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:1200)). A universal store could still coexist with foreign tables and rescue collisions around its smaller reserved physical vocabulary.
   - **Resolution:** Remove this as a cost of universal layout. If the intended advantage is direct SQL interoperability or adoption of preexisting relational tables, cite a governing document that actually promises that capability.

6. **MAJOR — F5 attributes an unestablished storage workload to LLP 0087.**

   - **Claim:** LLP 0087 “implies apps whose schemas are created and evolved by the system at runtime,” with “many small schemas, created programmatically, high churn, low per-table row counts” ([0159:155](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:155)).
   - **Evidence:** LLP 0087 makes app **code artifacts** data loaded at runtime ([LLP 0087:11](/Users/ccheever/projects/snapback/llp/0087-facets-hosted-adoption.plan.md:11)). It repeatedly preserves app rows in the coordinator’s existing SQLite and excludes moving app-data ownership into facets ([LLP 0087:38](/Users/ccheever/projects/snapback/llp/0087-facets-hosted-adoption.plan.md:38), [LLP 0087:492](/Users/ccheever/projects/snapback/llp/0087-facets-hosted-adoption.plan.md:492)). Phase 2 mentions schema/code compatibility and isolation, but supplies no high-churn or low-row-count finding ([LLP 0087:390](/Users/ccheever/projects/snapback/llp/0087-facets-hosted-adoption.plan.md:390)).
   - **Resolution:** Present this as a separate workload hypothesis, not an implication of LLP 0087. Require measured per-app DDL churn or a concrete programmatic-schema requirement before recommending a facet-specific universal profile.

7. **MAJOR — load-bearing Convex facts are honestly labeled but not reproducibly sourced or adequately scoped.**

   - **Claim:** all logical data uses exactly four physical tables, with Convex owning its planner, indexes, constraints, and transaction semantics ([0159:46](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:46)).
   - **Evidence:** The provenance names two sources generically but gives no URL, repository commit, file path, or section. It also does not state whether “four tables” is per deployment, persistence database, tenant, or cluster. That scope matters to F5 and catalog-churn arguments. The existing corpus separately says Convex’s hosted tenancy substrate is unverified ([LLP 0074:998](/Users/ccheever/projects/snapback/llp/0074-convex-competitive-strategy.rfc.md:998)).
   - **Resolution:** Add exact URLs, access dates, and `convex-backend` commit/file references; pin the physical-table scope; and distinguish source-observed facts from deductions. Clarify the Aurora/MySQL-to-PlanetScale-Postgres chronology, whose current wording is internally awkward.

8. **MATERIAL — F3 understates what the backing SQL engine still guarantees.**

   - **Claim:** the hardened SQL engine “guarantees only ordering and durability of opaque rows” while “isolation lives in Convex’s … Rust code” ([0159:134](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:134)).
   - **Evidence:** The cited provenance does not establish that “only” boundary. Even with logical OCC/MVCC above it, the physical database still supplies atomic transactions, physical isolation/locking, durable uniqueness over its own keys, and crash recovery. What moves upward is application-logical serializability, logical index consistency, and logical constraints.
   - **Resolution:** Add a layer-ownership matrix separating physical ACID guarantees from logical document/database guarantees and source each Convex-side assignment.

9. **MATERIAL — the inspectability claim is rhetorically absolute.**

   - **Claim:** “A universal store is opaque bytes to every standard tool” ([0159:119](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:119)).
   - **Evidence:** Standard tools would still inspect the four physical tables, physical indexes, row counts, and SQL transaction behavior; what they cannot directly interpret is the application’s logical schema, index semantics, and query plan. Diary 0029 supports the value of native Postgres plan/policy/schema inspection ([diary 0029:373](/Users/ccheever/projects/snapback/diaries/0029-linear-backend-bakeoff.diary.md:373)), but its “one command” statement is a recommendation for Snapback, not evidence that such a complete tool already ships ([diary 0029:414](/Users/ccheever/projects/snapback/diaries/0029-linear-backend-bakeoff.diary.md:414)).
   - **Resolution:** Narrow the claim to loss of direct logical-data and logical-plan interpretation by generic SQL tools; distinguish existing SQLite access from planned first-class inspection UX.

10. **MAJOR — §Confidence overstates the maturity of the cited Snapback authorities.**

    - **Claim:** “High on the Snapback-side couplings (LLP 0007, 0011, 0046, 0057 are shipped or Accepted)” ([0159:190](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:190)).
    - **Evidence:** LLP 0007 is Draft, albeit substantially implemented; LLP 0011 is Draft with general permission language open ([LLP 0011:576](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:576)); LLP 0046 is Draft and unimplemented; only LLP 0057 is Accepted. LLP 0081, omitted from this sentence, is Implemented.
    - **Resolution:** Calibrate confidence per claim: high for current SQLite layout and implemented migration machinery; medium for future authorization-language coupling; low-to-medium for Postgres graduation until the second-engine proof exists.

11. **MINOR — required metadata is incomplete.**

    - **Claim:** The header contains `Type`, `Status`, `Systems`, `Author`, `Date`, and `Related`, but no `Revised` field ([0159:3](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:3)).
    - **Evidence:** Repository instructions require `Revised` in the standard LLP metadata header.
    - **Resolution:** Add the field, even if its initial value is the creation date or an explicit initial-revision note.

## 5. Suggestions

- Add a comparison matrix covering online migration, logical schema flexibility, cross-engine adapter size, query execution, native constraints, inspectability, write/storage amplification, DDL/catalog scaling, failure blast radius, and operational tooling.

- Mark each Snapback premise as `shipped`, `implemented local-only`, `accepted`, `draft direction`, or `hypothesis`.

- Replace absolutes such as “real product,” “rebuilding the database,” “opaque bytes,” and “marketing rather than architecture” with narrower layer-specific statements.

- Add measurable reopening thresholds: number of logical tables/apps, DDL latency, catalog-lock incidents, index-build downtime, write amplification, and per-target limits.

- Explain LLP 0158’s relevance or remove it from `Related`: whole-file SQLite forking appears largely layout-neutral because both designs can live in one clonable database file.

## 6. Open questions for the author

1. What is the exact scope of Convex’s four physical tables: deployment, tenant, persistence database, or a broader hosted unit?

2. Is native application-shaped SQL storage an explicit Snapback product commitment, or only the current proposed implementation of portability?

3. Which existing `FilterExpr`, `ValueExpr`, matcher, and membership-semi-join machinery would survive a custom logical executor, and which pieces truly require replacement?

4. Which migration classes does the author believe StageTableGeneration “mostly” covers, given that connected-client availability and concurrent writes remain excluded?

5. What concrete facets workload predicts high schema churn and low rows per table, beyond runtime-loaded code artifacts?

6. Should this recommendation compare present shipped Snapback with present Convex, or compare each system’s intended end state? The draft currently mixes those two frames.

## 7. Recommended next step

Revise and remain Draft. Correct the portability, Postgres, authorization, rescue, and facets claims; add exact Convex provenance and a complete benefit/cost matrix; then obtain a fresh independent review. The likely surviving recommendation is still “do not remake the paved path,” but it should follow from accurately costed alternatives rather than capabilities Snapback does not yet have.


---

## Round 2 — 2026-08-03 (target v0.2, SHA-256 78a5c754a153d5a432f76a8c0f93d5cb190c58c23a74ae80a97581c850ed3496)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context, blind to prior rounds and to llp/reviews/; same capsule shape as round 1, retargeted at the v0.2 bytes. Recorded verbatim below.

---

## 1. Overall assessment

This is a strong, unusually candid research draft whose Snapback-side implementation checks mostly hold and whose immediate recommendation—do not remake Snapback now—is plausible. It is not yet decision-grade, however, because it repeatedly attributes properties of Convex’s complete architecture—custom execution, OCC/MVCC, immutable history, and engine-managed indexes—to the universal-table layout itself. That confounding inflates both the layout’s benefits and its required costs. Several narrower corpus claims also need correction, particularly the current state of time travel/forking, LLP 0087’s status, and what the Convex deployment incident proved. The recommendation may survive revision, but the present findings do not establish the stronger “low probability ever right” conclusion.

## 2. Verdict — NOT READY

## 3. Strengths

- The provenance posture is candid. The Convex facts are dated, attributed to named first-party sources, assigned Medium confidence, and explicitly marked as not verified against schema source files (§The two layouts; §Confidence).

- The Snapback physical-layout claims check out. Required fields become physical `NOT NULL` columns, optional-to-required changes rebuild inside the surrounding schema transaction, and declared uniqueness creates a real SQLite `UNIQUE INDEX`: [src/storage.rs:10714–10727](/Users/ccheever/projects/snapback/src/storage.rs:10714), [src/storage.rs:10842–10937](/Users/ccheever/projects/snapback/src/storage.rs:10842), [src/storage.rs:11098–11107](/Users/ccheever/projects/snapback/src/storage.rs:11098), [src/storage/auth_mode.rs:1353–1407](/Users/ccheever/projects/snapback/src/storage/auth_mode.rs:1353).

- `StageTableGeneration` is the exact LLP 0081 step name and is implemented, so F1’s migration-time-indirection observation is grounded: [llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:287–300](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:287), [src/storage/migration_executor.rs:2193](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:2193).

- LLP 0011 really does impose the quoted pushdown-compilability requirement over `(document, resolved auth context)` at snapshot and live-delta time: [llp/0011-auth-and-permissions.rfc.md:432–444](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:432). Current closed filters and membership predicates really are lowered into SQLite `WHERE` and correlated `EXISTS`: [src/storage.rs:11237–11435](/Users/ccheever/projects/snapback/src/storage.rs:11237), [src/storage.rs:11469](/Users/ccheever/projects/snapback/src/storage.rs:11469).

- F2 commendably credits the universal approach’s real Postgres-adapter benefit rather than presenting a one-sided rejection.

- The brownfield characterization is substantially fair. LLP 0007 preserves a foreign-only adoption lane, and LLP 0057’s dormant `_auth_*` collision rescue is a narrow implemented subcase: [llp/0007-storage-portability.spec.md:217–225](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:217), [llp/0057-auth-provider-protocol.spec.md:1154–1164](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:1154).

- F5 correctly labels programmatically created, high-churn schemas as a hypothesis rather than something LLP 0087 implies. Its substantive description—runtime-loaded code artifacts while app rows remain in coordinator SQLite and facet SQLite stays role-local—is accurate: [llp/0087-facets-hosted-adoption.plan.md:38–46](/Users/ccheever/projects/snapback/llp/0087-facets-hosted-adoption.plan.md:38), [llp/0087-facets-hosted-adoption.plan.md:92–123](/Users/ccheever/projects/snapback/llp/0087-facets-hosted-adoption.plan.md:92).

- The reopening triggers are concrete and falsifiable. Requiring a failed spike or measured workload is much better than reopening the architecture on sentiment.

## 4. Concerns

1. **BLOCKING — The document does not isolate the physical-layout variable.**

   - **Claim:** “adopting it would require Snapback to rebuild its query, index, constraint, and snapshot-path authorization-evaluation stack”; “What the universal layout moves up into the vendor’s own code is … application-level serializability (OCC)”; and F6 assigns immutable-MVCC-log benefits to the layout.
   - **Evidence:** A universal document/index schema does not inherently require a custom physical query planner or custom race-freedom. Snapback could still compile its existing query IR into SQL over generic document/index tables, letting SQLite/Postgres plan execution; a generic index-entry table can still use native `UNIQUE(index_id, encoded_key)` enforcement. Current code already demonstrates IR-to-SQL lowering rather than exposing SQL to authors: [src/storage.rs:11237–11435](/Users/ccheever/projects/snapback/src/storage.rs:11237). Likewise, OCC, retained MVCC history, immutable logs, and online migration protocols are independent architectural axes. LLP 0161 explicitly concludes that historical representation can be built above SQLite without replacing the on-disk engine: [llp/0161-agent-optimized-storage-engine.research.md:201–208](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:201).
   - **What would resolve it:** Recast the analysis around at least four independent axes: physical layout, planner/executor ownership, version-retention model, and migration protocol. For every claimed benefit or cost, mark it as layout-forced, Convex-specific, or optional. Evaluate a SQL-lowered universal-layout counterfactual before recalculating the recommendation.

2. **MAJOR — F6 and the conclusion overstate what Snapback currently serves.**

   - **Claim:** fork/time-travel is “currently served more cheaply at file and journal granularity.”
   - **Evidence:** LLP 0158 is experimental and explicitly commits no implementation; its spike proved only cold physical copying and a journal-derived diff, without identity minting, quarantine, custody, or a fork product surface: [llp/0158-instance-forking.rfc.md:733–789](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:733), [llp/0158-instance-forking.rfc.md:1041–1059](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:1041). LLP 0161 says the fork gap is Medium-Large and that arbitrary database-wide as-of is a Large gap; the bounded journal lacks a baseline and cannot reconstruct arbitrary past state: [llp/0161-agent-optimized-storage-engine.research.md:190–195](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:190).
   - **What would resolve it:** Distinguish current checkpoints/backups, proven physical-copy substrate, unbuilt safe instance forking, bounded per-record post-images, and absent arbitrary as-of. Base rejection on lack of demonstrated demand and the possibility of adding a temporal layer above SQLite—not on present feature parity.

3. **MAJOR — LLP 0081 OQ4 is treated as a specified substitute when it is only an open question.**

   - **Claim:** benefits are “mostly obtainable through narrower mechanisms we already have or have specified,” and online schema change is “better pursued as LLP 0081’s OQ4 (a narrow dual-write profile).”
   - **Evidence:** LLP 0081 declares zero-downtime migration a non-goal, while OQ4 merely asks which migration class might be the smallest safe online/dual-write profile: [llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:789–811](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:789). No protocol, cost, or feasibility evidence is specified there.
   - **What would resolve it:** Call OQ4 a candidate investigation, not an available substitute. Either cost a representative per-table dual-write design or rest the present recommendation on “online migration is not currently required.”

4. **MAJOR — The Postgres tradeoff imports an unsupported identity premise and overstates what is lost.**

   - **Claim:** under a universal layout “Postgres degenerates into a KV shelf,” while application-shaped DDL is “the reason inspectability, ecosystem tooling, and SQL-literate operators transfer”; the document then judges this identity cost greater than the adapter saving.
   - **Evidence:** LLP 0046’s stated goals are cross-engine portability, scale-up, conformance, and storage-seam extraction—not direct relational inspectability as the reason graduation is worthwhile: [llp/0046-postgres-graduation-path.rfc.md:15–34](/Users/ccheever/projects/snapback/llp/0046-postgres-graduation-path.rfc.md:15), [llp/0046-postgres-graduation-path.rfc.md:91–103](/Users/ccheever/projects/snapback/llp/0046-postgres-graduation-path.rfc.md:91). A universal layout loses application-shaped SQL access, but still retains Postgres durability, HA, backup, replication, monitoring, and physical operational tooling. F2’s own inspectability paragraph already acknowledges that physical SQL tooling remains.
   - **What would resolve it:** Separate logical relational tooling from physical operational tooling, cite a governing LLP if application-shaped Postgres is truly an identity requirement, and label “identity cost larger” as an author value judgment rather than an LLP 0046 finding.

5. **MAJOR — “Low probability this is ever right” exceeds the evidence and omits important tradeoffs.**

   - **Claim:** “No — low probability this is ever right for the paved path.”
   - **Evidence:** F5 says no relevant dynamic-schema workload is measured, and trigger 3 admits no hosted DDL evidence exists. The document also does not assess catalog/table-count pressure, generic-index storage amplification, serialization/decoding cost, query latency, MVCC garbage collection, cross-engine semantic uniformity, replication/backup simplicity, or the one-time conversion and dual-format migration cost.
   - **What would resolve it:** Add a workload-and-cost decision matrix with explicit assumptions and thresholds. Until then, narrow the conclusion to “do not remake Snapback now; no present requirement justifies a rewrite.”

6. **MATERIAL — The authorization account is correct at snapshot time but too broad about the live matcher.**

   - **Claim:** “The live-delta half already executes in Snapback’s own matcher.”
   - **Evidence:** The matcher directly evaluates ordinary `plan.filters`, but membership-gated queries explicitly fall back to authoritative replacement because the matcher does not evaluate their membership predicate: [src/live_matcher.rs:311–337](/Users/ccheever/projects/snapback/src/live_matcher.rs:311), [src/live_matcher.rs:665–676](/Users/ccheever/projects/snapback/src/live_matcher.rs:665). LLP 0011 also states that no general permission language exists yet: [llp/0011-auth-and-permissions.rfc.md:446–454](/Users/ccheever/projects/snapback/llp/0011-auth-and-permissions.rfc.md:446).
   - **What would resolve it:** Narrow the shipped claim to auth-valued single-table filters. Describe membership as dependency-aware wakeup plus authoritative SQL resnapshot, and keep general permission-language behavior explicitly prospective.

7. **MATERIAL — F4 uses “atomicity” where the controlling corpus permits only a replacement-scope inference.**

   - **Claim:** the cross-arm incident “comes from schema-and-functions-as-one-deployment-unit atomicity.”
   - **Evidence:** LLP 0074 says the incident proves deployment-global replacement scope for root applications and explicitly “does not prove deploy atomicity”: [llp/0074-convex-competitive-strategy.rfc.md:640–657](/Users/ccheever/projects/snapback/llp/0074-convex-competitive-strategy.rfc.md:640). LLP 0102 likewise records whole-function replacement and whole-schema reconciliation as the operative provider limit: [llp/0102-seven-backend-five-app-bakeoff.plan.md:132–145](/Users/ccheever/projects/snapback/llp/0102-seven-backend-five-app-bakeoff.plan.md:132).
   - **What would resolve it:** Replace “atomicity” with “deployment-global schema/function replacement and reconciliation scope.” F4’s separability conclusion can remain.

8. **MATERIAL — LLP 0087 is not a shipped direction.**

   - **Claim:** “LLP 0087’s shipped direction makes app code artifacts data loaded at runtime.”
   - **Evidence:** LLP 0087 is Draft; its end state is expressly “a target, not a commitment,” Phase 0 is still gated, and adoption requires re-ratification of LLP 0014: [llp/0087-facets-hosted-adoption.plan.md:11–30](/Users/ccheever/projects/snapback/llp/0087-facets-hosted-adoption.plan.md:11), [llp/0087-facets-hosted-adoption.plan.md:47–54](/Users/ccheever/projects/snapback/llp/0087-facets-hosted-adoption.plan.md:47), [llp/0087-facets-hosted-adoption.plan.md:525–529](/Users/ccheever/projects/snapback/llp/0087-facets-hosted-adoption.plan.md:525).
   - **What would resolve it:** Say “LLP 0087’s proposed, gated end state.” The remaining characterization is fair.

9. **MATERIAL — One externally sourced fact is load-bearing but remains too coarsely pinned.**

   - **Claim:** “Convex’s SQLite/Postgres/MySQL abstraction demonstrates” that graduation becomes a persistence-adapter swap.
   - **Evidence:** The provenance block honestly says the evidence is prose-only and not checked against repository schema files; physical-table scope remains unknown. That is adequate for the non-load-bearing “four tables” shorthand, but the persistence-abstraction claim materially supports F2 and the recommendation.
   - **What would resolve it:** Pin each load-bearing architecture claim to an exact URL plus convex-backend commit/file, distinguishing cloud history from current open-source/self-host behavior. Until then, label the adapter conclusion as reported by first-party prose and conditional.

10. **MINOR — The `_id` index wording is physically imprecise.**

   - **Claim:** “Indexes are real engine indexes (with the implicit trailing `_id` component); uniqueness is a real `UNIQUE` index.”
   - **Evidence:** For unique indexes, `_id` is scan-order-only in the logical contract and is deliberately absent from the physical unique key; otherwise it would defeat uniqueness: [llp/0007-storage-portability.spec.md:416–437](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:416), [src/storage.rs:11064–11083](/Users/ccheever/projects/snapback/src/storage.rs:11064).
   - **What would resolve it:** Say that non-unique physical indexes append `_id`, while unique physical indexes cover only declared fields.

## 5. Suggestions

- Replace “necessary-ish” with the precise claim: universal storage makes many logical schema changes DDL-free, but is neither necessary nor sufficient for online migration.
- Add a compact table classifying every finding as layout-inherent, Convex-specific, or optional.
- Report confidence per finding rather than only by source category.
- Use “shipped,” “implemented,” “spiked,” “specified,” and “hypothesized” consistently.
- Consider dropping “four physical tables” from the title until names and scope are source-pinned.
- Add the substantial one-time migration and compatibility cost of converting existing Snapback databases; it strengthens the recommendation without relying on disputed coupling.

## 6. Open questions for the author

1. Is this document deciding only the physical mapping, or comparing Snapback against Convex’s full logical database engine? The current analysis alternates between those questions.
2. Is application-shaped Postgres DDL an explicit Snapback identity requirement? If so, which accepted or active LLP establishes it?
3. What paved-path workload assumptions—logical table count, schema churn, row count, query mix—make “low probability ever” defensible?
4. Would a SQL-lowered universal profile, using generic native indexes and constraints, preserve enough planner/race-freedom benefit to change F2?
5. Is arbitrary as-of/time travel a product requirement, or merely a trigger to monitor?
6. Must the Convex source-level verification close before this Research document leaves Draft, or only before its claims are reused competitively?

## 7. Recommended next step

Revise and remain Draft. First separate layout from executor, concurrency, history, and migration-protocol choices; then correct the LLP 0161, 0087, 0074, authorization-matcher, and unique-index statements; finally pin the load-bearing Convex sources and recalculate the recommendation against a SQL-lowered universal-layout counterfactual. A focused independent re-review should then judge whether “do not remake now” still follows and whether the stronger “unlikely ever” claim should remain.
