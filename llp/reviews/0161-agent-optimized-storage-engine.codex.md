# LLP 0161 agent optimized storage engine review — Codex family

## Round 1 — 2026-08-03 (target v0.1, SHA-256 b2a2bffeaca1a86bf9fd7a05aa7c63b6033cccc5bdf70aa964d04ca693ab55f7)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context over the working tree at 50ff432a; instruction capsule at review time pinned the target SHA, named the governing corpus docs to read, and barred reading llp/reviews/. Orchestrated by the Fable session that authored the draft, which therefore does not count as a reviewer; the review is recorded verbatim below.

---

## 1. Overall assessment

LLP 0161 has a strong first-principles frame and reaches the defensible conclusion that Snapback should retain SQLite as its physical substrate. It is not ready, however, because the gap table—the document’s central evidence artifact—materially mischaracterizes P2, P4, P5, and P6; understates P1; describes P3 imprecisely; and omits ambiguity-safe retry and settlement as an agent-specific property. The weaker conclusion, “no bespoke on-disk engine,” follows; the stronger claim that the remaining work is merely product surface rather than storage-engine internals does not.

## 2. Verdict — NOT READY

The document needs substantive correction before review convergence. Multiple MAJOR findings affect the property set, current-state analysis, and resulting sequencing—not merely wording or presentation.

## 3. Strengths

- **§1’s three pressures are coherent and genuinely agent-specific.** Speculation, proof over memory, and concurrency without social coordination form a useful derivation framework rather than a feature checklist ([llp/0161:20](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:20)).

- **P1 is well motivated and correctly adopts LLP 0158’s throwaway-first posture.** “Do it elsewhere, inspect, then discard” is an excellent agent-oriented primitive. The target correctly recognizes that migration rehearsal and single-mutation dry-run are real adjacent shipped capabilities; LLP 0158 makes the same verified distinction ([llp/0158:217](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:217)), and the dry-run report exposes predicted writes, dependencies, validation, and deterministic inputs ([src/host_ops.rs:1610](/Users/ccheever/projects/snapback/src/host_ops.rs:1610)).

- **P5 rests on real, load-bearing implementation.** Ibex reads capture row, missing-row, and query dependencies ([src/runtime.rs:2711](/Users/ccheever/projects/snapback/src/runtime.rs:2711)); commit validation checks them, including predicate-level query invalidation ([src/storage.rs:11745](/Users/ccheever/projects/snapback/src/storage.rs:11745)); and the live matcher consumes captured query dependencies. LLP 0007 accurately distinguishes server-captured Ibex reads from Option A’s client-supplied host-plan baseline ([llp/0007:459](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:459)).

- **The P2 “today” assessment is directionally correct.** `ContentDigestV1` is flat, streaming, resumable, and scoped to per-migration proof rather than incrementally maintained state ([llp/0081:493](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:493)). LLP 0081 honestly leaves the Merkle variant as an open question ([llp/0081:803](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:803)).

- **P7 preserves an important boundary.** The document treats Cambria/Jazz lenses as prior-art pointers, not adopted architecture, while recognizing that closed backfill expressions, explicit constants, and receipts already give Snapback a substantial proof discipline.

- **The sequencing disclaimer respects program ownership.** Calling the sequence hypothetical and conceding that LLP 0155 and LLP 0130 own actual commissioning is correct ([llp/0161:161](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:161)). LLP 0155 expressly retains product-direction and cross-cutting authority ([llp/0155:145](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:145)).

- **LLP 0126 is cited fairly.** It is used only as background and an open client-store question, not as though its research posture were an accepted product decision.

## 4. Concerns

1. **MAJOR — The seven-property set omits ambiguity-safe retry and settlement.**

   **Claim:** “Deriving an ideal engine from those three pressures yields seven properties.”

   **Evidence:** Agents retry aggressively, lose process context, and encounter ambiguous transport outcomes. Determinism and provenance do not prevent the same intent from being committed twice. Snapback already treats this as a storage correctness property: LLP 0043 requires stable `clientMutationId` settlement and recoverable acknowledgement lifecycle ([llp/0043:204](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:204), [llp/0043:224](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:224)), backed by `_snapback_client_mutations` whose settlement commits atomically with data changes ([src/storage.rs:5635](/Users/ccheever/projects/snapback/src/storage.rs:5635)). This follows directly from speculation, concurrency, and proof-over-memory, yet P1–P7 do not guarantee it.

   **What would resolve it:** Add a property such as **P8 — receipt-addressed, idempotent settlement**, covering stable operation identity, duplicate suppression, atomic result custody, and recovery after unknown outcomes. Alternatively, explicitly extend P3 or P6 to include those requirements and show why that is not merely provenance or deterministic re-execution.

2. **MAJOR — P2’s asymptotic claim is wrong, and its current implementation phase is ambiguously described.**

   **Claims:** “two states diff in O(log n)” and “computed only during migration verify.”

   **Evidence:** A Merkle tree can compare equal roots in O(1) and locate one differing leaf in O(log n), but emitting \(k\) differences necessarily costs at least Ω(k); arbitrary state diff is not O(log n). In the tree, `ContentDigestV1` is computed during the migration executor’s pre-publication `Verifying` phase ([src/storage/migration_executor.rs:1290](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:1290), [src/storage/migration_executor.rs:2956](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:2956)). The later `migrate verify` path does not re-digest tables; it re-proves the receipt/journal seal and re-presents the recorded proof ([src/storage/migration_executor.rs:3832](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:3832)).

   **What would resolve it:** State the complexity precisely: O(1) equality check, O(log n) localization of one mismatch, and output-sensitive enumeration of differences. Replace “during migration verify” with “during migration apply/rehearsal’s pre-publication verification phase.” Treat the precise Dolt performance assertion separately as sourced empirical prior art, not a consequence of Merkle storage.

3. **MAJOR — P4 conflates per-record history, database-wide time travel, and branching, and misreports LLP 0088.**

   **Claims:** “LLP 0088 (record history) — deferred,” “LLP 0158’s fork-at-version,” and “substrate exists, surface doesn’t.”

   **Evidence:** LLP 0088 recommends **pursuing bounded, opt-in, read-only per-record history** ([llp/0088:12](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:12), [llp/0088:99](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:99)). What it defers or declines is losing-version retention, branch creation, and core merge policy ([llp/0088:126](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:126), [llp/0088:148](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:148)). It remains Draft and commits no implementation ([llp/0088:277](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:277)).

   The shipped journal contains row post-images and tombstones, not a retained baseline, pre-images, or a temporal relational representation ([src/storage.rs:5600](/Users/ccheever/projects/snapback/src/storage.rs:5600)). Its pruning policy preserves a replay floor and table high-water facts, not enough history to reconstruct arbitrary database state at every retained version ([llp/0008:597](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:597)). LLP 0158 forks a current consistent snapshot and records that snapshot’s fork point; it does not materialize an arbitrary historical version ([llp/0158:368](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:368)). LLP 0043 explicitly says its “retention” is client-store retention, not server history ([llp/0043:74](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:74)).

   **What would resolve it:** Split the analysis into bounded per-record history, arbitrary relational `AS OF`, version diff, and current-state instance fork. Mark the first Draft/pursue but unimplemented, the second and third as lacking sufficient substrate, and the fourth as LLP 0158’s proposal. Reprice P4 above Medium unless a baseline/history representation is specified.

4. **MAJOR — P6’s “today” cell is false in both directions.**

   **Claims:** “Journal is authoritative for sync replay,” “general handlers may read time/randomness — effects recorded, inputs not,” and “sync-replay determinism yes; handler-replay determinism no.”

   **Evidence:** Queries and mutations are already the deterministic execution tier: ambient time and similar powers are denied ([src/runtime.rs:3826](/Users/ccheever/projects/snapback/src/runtime.rs:3826), [src/runtime.rs:3897](/Users/ccheever/projects/snapback/src/runtime.rs:3897)), while `ctx.runtime.now()` and generated IDs are recorded and replayed through `CtxAnswerLedger` ([src/manifest.rs:5897](/Users/ccheever/projects/snapback/src/manifest.rs:5897), [src/manifest.rs:6240](/Users/ccheever/projects/snapback/src/manifest.rs:6240)). Actions are deliberately nondeterministic and do not carry that ledger.

   Conversely, `_snapback_changes` is a bounded row-post-image journal, not an authoritative write/intent/effect log capable of rebuilding the whole database byte-identically. It excludes protected auth lanes, sidecars, blobs, privileged changes, and action effects; LLP 0158 documents the same journal coverage limit ([llp/0158:674](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:674)). Its valid sync-delta use does not establish P6’s full-state replay property.

   **What would resolve it:** Distinguish three contracts: deterministic handler re-execution, application of retained sync deltas, and complete engine-state reconstruction. Credit the shipped query/mutation tier and captured `{generatedIds, now}`; mark actions and full-state replay as missing. Do not call the current journal byte-identical replay substrate.

5. **MAJOR — The no-new-engine conclusion is stated more strongly than the evidence permits.**

   **Claims:** “product surface over existing substrate, not engine internals” and “P3/P4 are retention policy plus query surface over facts the substrate already produces.”

   **Evidence:** P2 requires hot-write-path digest maintenance. P3 requires a new per-commit metadata relation and propagation through write paths. P4 requires historical state representation or retained baselines beyond today’s bounded post-image journal. P6 would require a broader authoritative input/effect log. These changes can all live above SQLite, but several are unquestionably Snapback storage-engine internals rather than API veneer.

   **What would resolve it:** Narrow the conclusion to: “No property requires a bespoke physical/on-disk engine; all can be implemented in Snapback’s engine layer over SQLite.” Remove the claim that the remaining distance is merely product surface.

6. **MATERIAL — P1’s shipped-adjacent evidence is real, but the gap is underpriced.**

   **Claim:** “Medium — design exists, uncommitted; runtime-plane quarantine … is the real work.”

   **Evidence:** The spike proved a cold local APFS copy, boot, and app-row journal diff, but explicitly built or tested no runtime quarantine ([llp/0158:724](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:724)). Identity was inherited, credential isolation remains unproven, live-copy latency is unmeasured, egress mediation is net-new, asset custody needs an F0 decision, and registry/TTL/reaping are new ([llp/0158:770](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:770), [llp/0158:806](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:806)). The target’s “today” rehearsal and dry-run entries are verified; the rating and “design exists” shorthand obscure how much of P1’s safety definition remains unimplemented.

   **What would resolve it:** Rate the gap Medium-Large or Large, enumerate the unbuilt safety components, and say that only the storage-copy/diff slice is spiked.

7. **MATERIAL — P3 overstates what the general change journal records.**

   **Claim:** “Change journal records operations.”

   **Evidence:** `_snapback_changes` records only `version`, table, row ID, row operation, post-image, and timestamp ([src/storage.rs:5600](/Users/ccheever/projects/snapback/src/storage.rs:5600)); `record_change` inserts no principal, session, handler, plan, operation identity, or authority ([src/storage.rs:16587](/Users/ccheever/projects/snapback/src/storage.rs:16587)). Rich provenance exists in specialized migration, auth, membership, and activity seams, which supports the rest of the cell—but a row’s `insert/update/delete` enum is not agent-operation provenance.

   **What would resolve it:** Say “the general journal records versioned row changes; richer identity and plan provenance exists only in specialized subsystem journals.” Retain the inferred qualifier for absence across every write lane.

8. **MATERIAL — P5 is genuinely closest, but its scope and explanation gap are misstated.**

   **Claims:** “The engine knows every transaction’s read set and write set” and “the explanation surface … is unexposed.”

   **Evidence:** Capture is load-bearing for supported Ibex query/mutation paths, while host-plan Option A validates a client-supplied optimistic baseline rather than an engine-observed read set ([llp/0007:465](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:465)). Explanation is already partly public: conflict errors include the triggering dependency and all captured reads ([src/storage.rs:11886](/Users/ccheever/projects/snapback/src/storage.rs:11886)); the function runner returns captured reads/writes ([src/local.rs:1494](/Users/ccheever/projects/snapback/src/local.rs:1494)); and mutation dry-run exposes read/write sets and validation ([src/host_ops.rs:1636](/Users/ccheever/projects/snapback/src/host_ops.rs:1636)). What is missing is a uniform, durable explanation surface—especially for invalidation—not explanation altogether.

   **What would resolve it:** Scope “closest to ideal” to paved query/mutation paths and distinguish server-observed from client-asserted sets. Replace “unexposed” with “partially exposed through conflicts, runner results, and dry-run; no uniform durable conflict/invalidation explanation API.”

9. **MATERIAL — Prior-art provenance and confidence are not yet honest enough for the claims made.**

   **Claims:** “every serious database vendor’s 2025–26 repositioning,” “branching for agents (Neon, PlanetScale),” “novel-writes commit in seconds regardless of size,” and “High on the today-column.”

   **Evidence:** The Convex read-set attribution is supported and explicitly observed in LLP 0159 ([llp/0159:46](/Users/ccheever/projects/snapback/llp/0159-universal-table-storage-layout.research.md:46)); Cambria/Jazz is honestly marked as a pointer. FoundationDB OCC, Datomic `as-of`, and Dolt’s Merkle-DAG are credible general-knowledge pointers, but remain untagged here. The precise Dolt latency claim is unsourced and load-bearing for P2. PlanetScale is especially misleading: LLP 0158 characterizes it as schema branches plus backup/restore for data, not CoW agent data branching ([llp/0158:889](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:889)). “Datomic as-of is free” is defensible architecturally but not as an unqualified cost claim. The asserted High confidence in the today column is contradicted by the P2–P6 errors above.

   **What would resolve it:** Apply the corpus’s existing evidence tags—`[observed]`, `[confirmed]`, `[author knowledge — reverify]`, and `[inferred]`—to every external attribution. Narrow PlanetScale, qualify Datomic, source or remove the Dolt performance claim, and lower today-column confidence to Medium until the table is corrected.

## 5. Suggestions

- Rename “Planned/proposed” to “Corpus posture” and distinguish **Accepted/unwired**, **Draft**, **Research/OQ**, and genuinely commissioned work.

- Narrow P7’s “strongest … in the field” to “strongest among LLP 0160’s seven evaluated backends.” LLP 0160 supports that comparative scope, not a universal market superlative.

- Add a coverage legend to the gap table: app rows, protected/auth data, assets, sidecars, action effects, and privileged writes. Several apparent substrates cover only app-row state.

- Preserve P1-first/P2-second as dependency analysis, but avoid language resembling a program commission unless an owning RFC adopts it.

- Add the required `Revised` metadata field. `./ref-check --verbose` passes, but the project’s standard header still requires it.

## 6. Open questions for the author

- Is P4 intended to mean bounded per-record history, arbitrary relational `AS OF`, or both? They require materially different substrates.

- Does P6 require replaying handler intent, applying server changesets, or rebuilding every authoritative database component? What exactly must be byte-identical?

- Should ambiguity-safe operation settlement become P8, or does the author intend to make stable operation identity and duplicate suppression normative parts of P3/P6?

- Is P5 limited to agent-authored query/mutation execution, or must it include administrative, protected, migration, raw-SQL, asset, and action-triggered write paths?

- Is P1 still the first move once its full identity, egress, asset, and lifecycle obligations are priced, or should the Research document state only dependency leverage and leave ordering entirely to LLP 0155/0130?

## 7. Recommended next step

Keep LLP 0161 Draft and produce v0.2 before another review: add or explicitly subsume retry-safe settlement; correct P2, P4, P5, and P6 against the cited code and LLPs; reprice P1; rewrite P3’s journal claim; narrow “no new engine” to the physical-layer conclusion; and provenance-tag the external prior art. Then rerun the super-refine review on the corrected gap table, since that table—not the seven-property prose—is currently the readiness boundary.


---

## Round 2 — 2026-08-03 (target v0.2, SHA-256 210c8120d552c48914c336c3196aaf249dd15794e99a6b5df1a81182a536c188)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context, blind to prior rounds and to llp/reviews/; same capsule shape as round 1, retargeted at the v0.2 bytes. Recorded verbatim below.

---

## 1. Overall assessment

This is a strong, unusually well-grounded Research document: the three-pressure derivation is useful, most distinctions are sharp, P3’s journal description and P5’s local implementation claims survive source inspection, and the narrower “no bespoke on-disk engine” conclusion does follow. It is not ready as written, however, because the claimed ideal appears incomplete without authority-scoped admission/containment, and several central gap-table cells materially misstate implementation scope or corpus posture—most notably P2 resumability, P4’s LLP 0088 disposition, P5’s cross-target scope, and P8’s optionality.

## 2. Verdict — NOT READY

## 3. Strengths

- The derivation from speculation, proof, and uncoordinated concurrency gives the properties a coherent agent-specific frame rather than producing a generic database wishlist ([§1–2](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:39)).

- P4 correctly separates checkpoints, bounded per-record history, and arbitrary database-wide as-of as three different substrates ([P4](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:126)). Its retention discussion also fairly distinguishes LLP 0043’s client store from the server journal.

- P3’s “today” cell is exact. `_snapback_changes` stores version, table, row ID, operation, post-image, and timestamp, with no principal or operation digest ([schema](/Users/ccheever/projects/snapback/src/storage.rs:5600), [write path](/Users/ccheever/projects/snapback/src/storage.rs:16587)).

- P5 is genuinely shipped and load-bearing on the local SQLite/Ibex path. Runtime reads capture row, missing-row, and query dependencies ([runtime](/Users/ccheever/projects/snapback/src/runtime.rs:1531)); commit validation checks them at predicate granularity and emits the triggering dependency ([validation](/Users/ccheever/projects/snapback/src/storage.rs:11745)); the live matcher reuses the same facts ([matcher](/Users/ccheever/projects/snapback/src/live_matcher.rs:128)). The Option A distinction for host plans accurately reflects LLP 0007 ([LLP 0007](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:459)).

- P2’s execution phase is correctly identified: apply/rehearsal computes the data proof before publication ([executor](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:1290)), while `migrate verify` validates the journal seal and re-presents the recorded proof rather than digesting live tables again ([verify](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:3782)).

- The P1 ingredients are real: restore-derived rehearsal, served single-mutation dry-run with predicted writes and captured dependencies ([dry-run](/Users/ccheever/projects/snapback/src/host_ops.rs:1610)), and the unwired materialized-base/overlay/effect-ledger substrate in `src/branches.rs`.

- The sequencing disclaimer is sufficiently explicit and does not usurp LLP 0130 or LLP 0155: it calls the order “dependency leverage, not a commissioning order” ([§4](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:210)). That is consistent with LLP 0155’s two commissioned lanes and LLP 0130’s delegation boundaries.

- The individual prior-art attributions are mostly honest: uncertain Dolt/FDB/Datomic claims are marked author knowledge, Dolt’s performance statement is explicitly unverified, Neon/PlanetScale are scoped through LLP 0158, Convex is supported by LLP 0159, and Cambria/Jazz is presented as a pointer rather than adoption. None of those individual claims appears load-bearing and wrong.

## 4. Concerns

- **MAJOR — The proposed ideal omits authority-scoped admission and containment.**  
  **Claim:** “Deriving an ideal engine from those pressures yields eight properties (P1–P8 below).”  
  **Evidence:** P3 records authority after the fact; it does not ensure that an agent had least-privilege authority to read or commit. P1 quarantines speculative forks but does not protect canonical shared state. Yet shipped agent principals and scoped grants are already treated as foundational agent affordances ([LLP 0146](/Users/ccheever/projects/snapback/llp/0146-agentic-authoring-affordances.rfc.md:82)), and LLP 0158’s primary demand explicitly includes rogue-agent containment and withholding parent credentials ([LLP 0158](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:193)). High-rate autonomous concurrency makes revocable, principal-scoped admission—and plausibly bounded resource authority—an engine property, not merely an audit feature.  
  **Resolution:** Add a property covering authority-scoped reads/writes, revocation/fencing, and bounded delegated rights, or explicitly argue why this belongs outside the “agent-optimized storage engine” boundary and narrow the completeness claim accordingly.

- **MAJOR — P2’s “resumable” today claim describes the contract and primitive, not the shipped §5 executor.**  
  **Claim:** “`ContentDigestV1`: flat, streaming, resumable.”  
  **Evidence:** LLP 0081 normatively requires an accumulator checkpoint beside the batch cursor ([LLP 0081 §5](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:493)), and `ContentDigestStream` has export/import machinery. But `run_data_proof` creates four fresh streams and performs its own full-table page loops ([executor](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:2956), [fresh streams](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:3077)). The executor’s actually checkpointed `MigrationKeysetScanV1` path sets `digest: None` ([validation scan](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:2874)). A crash during the §5 proof therefore restarts that digest rather than restoring its accumulator. The apply/verify phasing is correct; resumability is the overstatement.  
  **Resolution:** Say that the digest type and generic scan substrate are resumable, while the shipped §5 proof is currently flat and streaming but restart-on-interruption—or wire the proof through the checkpointed digest scan.

- **MATERIAL — P4 misstates LLP 0088’s disposition.**  
  **Claim:** “LLP 0088 … defers losing-version retention and branching.”  
  **Evidence:** LLP 0088 says retained losing versions are **do not pursue** as a server capability ([§2](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:126)); branch creation is **defer** ([§3](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:148)); bounded read-only per-record history is the sole phase-1 capability to **pursue** ([§1](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:99)), with independent bounded retention as a prerequisite.  
  **Resolution:** Preserve those three distinct postures verbatim in the corpus-posture cell.

- **MATERIAL — P5’s gap size is only defensible for the local target.**  
  **Claim:** “Closest to ideal, on paved paths … shipped and load-bearing” with a “Small-Medium” gap.  
  **Evidence:** This is true locally. On Cloudflare, however, captured reads are recorded but not validated; serialized coordinator execution supplies isolation ([coordinator](/Users/ccheever/projects/snapback/cloudflare/src/coordinator.js:20)). Live fan-out currently wakes every live query for every non-empty commit, explicitly sacrificing dependency precision ([LLP 0146](/Users/ccheever/projects/snapback/llp/0146-agentic-authoring-affordances.rfc.md:277)). Thus capture is neither the OCC mechanism nor the current invalidation discriminator on that shipped target.  
  **Resolution:** Scope the claim to “local SQLite/Ibex,” add a separate Cloudflare disposition, and price the all-target ideal independently.

- **MATERIAL — P8 understates a same-lane gap as merely cross-lane universalization.**  
  **Claim:** “Shipped where agents live today” and “Small-Medium — per-lane today; ‘universal across write lanes’ is the residue.”  
  **Evidence:** `clientMutationId` is optional in the mutation request ([manifest](/Users/ccheever/projects/snapback/src/manifest.rs:6164)), and the ordinary client API defaults it to `null`, sending it only when explicitly supplied ([client](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:5728)). LLP 0043’s strong settlement contract is specifically the durable queued-replay lane ([LLP 0043](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:165)). Ordinary immediate app mutations can therefore still lack stable intent identity.  
  **Resolution:** Describe settlement as required and automatic on the durable outbox/replay path but optional on ordinary mutation calls. Include mandatory default identity inside the existing app-mutation lane in the gap estimate.

- **MATERIAL — P1’s gap rhetoric overstates the maturity of the fork capability.**  
  **Claim:** “The storage slice is nearly done twice over.”  
  **Evidence:** The 0097 substrate is explicitly not wired into a request path ([server](/Users/ccheever/projects/snapback/src/server.rs:38819)). LLP 0158’s spike proved a manual cold APFS clone, boot, and journal diff only; it built no quarantine and tested no credentials ([spike](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:733)). Rehearsal and mutation dry-run are genuine but operation-specific what-if mechanisms, not second fork implementations. LLP 0158 itself calls identity mint, credential isolation, effect mediation, registry, TTL, and publication safety new work.  
  **Resolution:** Replace “nearly done twice over” with “two reusable copy/rehearsal substrates exist.” Preserve the Medium-Large gap, but name wiring, crash-safe publication, lifecycle, identity, and quarantine as product-critical rather than only “safety plane” residue.

- **MATERIAL — The no-new-engine conclusion is sound, but its fsync rationale is literally too broad.**  
  **Claim:** “None of P1–P8 requires owning pages, fsync, or crash-atomicity.”  
  **Evidence:** P1’s planned publication protocol explicitly owns ordering around staging sentinels, SQLite/WAL and sidecar durability, atomic rename, directory fsync, recovery, and an intra-state crash-cut matrix ([LLP 0158](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:430)). Snapback need not implement a WAL or page format, but it does have to orchestrate and prove crash-safe filesystem publication.  
  **Resolution:** Say that the properties require Snapback-owned durability protocols above SQLite/OS primitives but do not require reimplementing page storage, WAL recovery, or the physical database engine.

- **MATERIAL — The comparative superlatives exceed the evidence tags.**  
  **Claims:** “No shipping system has the set,” “Snapback [is] structurally closer … than any general-purpose engine,” and “every fork/branch vendor repositioned around exactly this.”  
  **Evidence:** The named prior-art claims are responsibly scoped, but the universal comparisons have no exhaustive system set, date, or comparison matrix. LLP 0158 contains a useful but non-exhaustive vendor survey and explicitly marks several rows as author knowledge. The individual architecture facts appear reasonable; the problem is the jump to an unqualified universal.  
  **Resolution:** Scope the claims to “the surveyed systems named here,” tag them as inferred, or add a dated comparison matrix defining “general-purpose,” the candidate set, and the eight-property scoring rule.

- **MINOR — The today-column confidence is too high until the table is corrected.**  
  **Claim:** “Medium-high on the today-column: the load-bearing cells were verified against the tree.”  
  **Evidence:** P3 and local P5 were verified successfully, and P2’s phase was verified, but P2 resumability, P5 target scope, and P8 optionality did not survive that inspection unchanged.  
  **Resolution:** Lower this to Medium for the present revision, or restore Medium-high after a target-by-target re-audit and the corrections above.

## 5. Suggestions

- Split P7 into “reviewed/provable migration” and “mixed-version lenses.” The former is well supported; the claim that agent-authored schema churn makes mixed-version populations a steady state should be tagged as a hypothesis until LLP 0160 or a diary supplies evidence.

- Make every “today” cell target-indexed: local SQLite/Ibex, Cloudflare coordinator, host-plan lane, and protected/system lanes. The existing global coverage caveat is too coarse for P5 and P6.

- Add a compact evidence-status legend for prior art: observed primary source, observed corpus summary, author knowledge, vendor claim, and inference.

- Replace “crown jewel” and similar rhetoric with the architectural fact being relied upon. The underlying Convex attribution is sound without the valuation language.

- For P3, sketch a likely normalized shape—one commit metadata record keyed by commit version, joined to journal rows—so “per-commit provenance” is not mistaken for duplicating principal data on every row-change record.

## 6. Open questions for the author

1. Is least-privilege, revocable agent authority intentionally outside the storage-engine ideal? If so, what boundary admits P3’s authority metadata while excluding authority enforcement?

2. Does “paved paths” in P5 mean only local SQLite/Ibex, or all shipped targets and runtimes?

3. Is P7’s lens half a required ideal property or a frontier option whose agent-specific necessity remains to be demonstrated?

4. Which concrete systems constitute the comparison set behind “no shipping system” and “closer than any general-purpose engine”?

5. For P8, does “where agents live today” mean durable outbox calls, CLI-mediated operations, or ordinary direct mutations? Those have different identity guarantees.

6. Should the ideal include bounded per-principal resource admission—transaction size, fork count, retained receipts, history, and digest work—as part of authority containment or as a separate property?

## 7. Recommended next step

Revise to v0.3 by adding or explicitly excluding the missing authority/containment property, correcting P2/P4/P5/P8 and the P1 maturity language, and narrowing the universal competitive claims. Then repeat the target-by-target gap-table audit and run another independent LLP 0005 review; the no-bespoke-engine conclusion can remain, with the durability wording sharpened.
