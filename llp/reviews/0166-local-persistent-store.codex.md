# LLP 0166 local persistent store review — Codex family

## Round 1 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author `codex exec` context over the working tree at
b9fd27af; instructed to read LLP 0166 in full plus LLP 0155 §Move 2/OQs,
LLP 0157 (§Vocabulary, §D2, §D3, §D6, §D7, §Migration), LLP 0008 DK-9 +
dated note, LLP 0080 retention section + dated note, LLP 0043, LLP 0053,
LLP 0090, LLP 0161 OQ5 + §3, LLP 0162 §Non-goals/§1, and to spot-check the
cited code facts; instructed not to read anything under `llp/reviews/`
concerning 0166. Orchestrated by the Fable session that authored the
draft, which therefore does not count as a reviewer; this artifact records
the Codex review verbatim below. Author verification before application:
the `rqsEntryKey` NUL-separator claim, the `rqsEntryRecordBytes`
`{rows, meta, token}` budget formula, the outbox
`{sequence, records, acks}` state shape, and the LLP 0157 retention-union
lines were checked against the tree and are accurate.

---

1. **Overall assessment**: **NOT READY — 0.99 confidence.** The draft has strong ownership discipline and correctly preserves many authorization and completeness invariants, but its central contracts are not yet implementable without guessing. Most importantly, the proposed retention class contradicts Accepted LLP 0157’s closed identity-bound classification, the registration/lifecycle/answer models are not total, the evaluator lacks a coherent input model, legacy RQS behavior is simultaneously declared unchanged and changed, and cross-store lease migration has no atomic mechanism.

2. **Strengths**

- §Scope and authority clearly separates identity, authorization, custody, settlement, carrier, and wire owners. It does not falsely claim that the proposed LLP 0008/0080 amendments have already landed.
- §D3 honestly preserves three address families instead of fabricating `PlanHashV1` or completeness proofs for legacy RQS entries. This matches LLP 0157 §Vocabulary and §Migration.
- §D4 correctly preserves the important proof rules: no row-count completeness, no absence inference, no local proof minting, retained freshness is never current, and auth-scoped lease expiry deletes before read.
- §D5 correctly treats eviction as subordinate to LLP 0053 obligations, tombstones, leases, pending intent, and acknowledgement custody.
- §D6 accurately carries the RQS outbox rule: retained rows remain displayable while `resumeFromToken` is withheld when pending intent exists.
- The proposed LLP 0008 amendment is appropriately SQL-neutral, and the LLP 0080 amendment preserves opaque authorization, lease custody, and the prohibition on unprojected joined-row retention.
- Most repository facts are accurate:
  - Database name, 32 MiB/256-entry limits, and schema version 2 match [packages/snapback-client/rqs-store.mjs:30](/Users/ccheever/projects/snapback-0166/packages/snapback-client/rqs-store.mjs:30).
  - `rqsEntryKey` is indeed query name plus canonical args, using a NUL separator, at [packages/snapback-client/rqs-store.mjs:91](/Users/ccheever/projects/snapback-0166/packages/snapback-client/rqs-store.mjs:91).
  - Shipped RQS eviction is `resumedAt`, then `savedAt`, at [packages/snapback-client/rqs-store.mjs:210](/Users/ccheever/projects/snapback-0166/packages/snapback-client/rqs-store.mjs:210).
  - Outbox caps are 1,024 records and 4,096 pending acknowledgements at [packages/snapback-client/outbox-shared.mjs:20](/Users/ccheever/projects/snapback-0166/packages/snapback-client/outbox-shared.mjs:20).
  - `retainedQueryKey` is the separate `name:stableJson(args)` family at [packages/snapback-contract/client-store.mjs:64](/Users/ccheever/projects/snapback-0166/packages/snapback-contract/client-store.mjs:64).
  - `rqsEligible` is derived, not authored, and enforces authority independence, public `LiveQuery`, HostPlan query shape, closed inputs, and a complete single-table summary at [src/manifest.rs:2845](/Users/ccheever/projects/snapback-0166/src/manifest.rs:2845).

3. **Concerns**

1. **BLOCKING — The new retention class is unrepresentable under Accepted LLP 0157.**  
   **Exact defect:** §D7 adds `fragment-evaluated-snapshot-v1` while claiming LLP 0157 is consumed byte-for-byte and while the acceptance path names amendments only to LLP 0008 and LLP 0080. LLP 0157 §D2 defines both retention unions as closed to `"none" | "opaque-authorized-snapshot-v1"`, binds that classification into `PlanHashV1`, and §D4 requires richer retention to arrive through a dated LLP 0157 amendment. Even §D3’s persistence allowlist omits the proposed class.  
   **Why it matters:** No client or server can encode, hash, admit, or compare the new classification without violating an Accepted identity owner. Changing the classification also rotates `PlanHashV1` and therefore `QueryMaterializationKeyV1`; the draft does not specify that rotation or predecessor treatment.  
   **What resolves it:** Carry an exact LLP 0157 amendment covering both closed unions, classification derivation, plan-hash vectors, capability admission, storage profile behavior, and QMK rotation/migration. Update §D3’s allowlist and the LLP 0080 manifest/codegen mapping in the same amendment set.

2. **BLOCKING — “Plan evaluation over its own result fragments” has no coherent execution semantics.**  
   **Exact defect:** LLP 0157 §Vocabulary and §D7 define a fragment as an opaque, contract-validated whole-page **result**. §D7 nevertheless requires the same plan evaluator as the server to run over those result fragments, while forbidding cross-address reads and retention of unprojected joined rows. A relational plan normally evaluates against source tables, indexes, and join inputs—not against its already-projected output. Changed arguments also rotate QMK, so “filter/order refresh” cannot silently use another materialization’s rows.  
   **Why it matters:** Implementers must guess whether this is full plan evaluation, a result-transform algebra, or optimistic-overlay recomputation. For joins and projections, server parity can be impossible from the retained bytes permitted by the proposed amendment.  
   **What resolves it:** Choose and specify one exact model. Either define an owner-governed result/overlay transformation IR over result bytes, including proof/freshness propagation, or admit additional authorized plan-input fragments with a new authority design. Define input schemas, operator subset, changed-argument behavior, evaluator identity/version, output digest semantics, and all refusal cases.

3. **BLOCKING — The registration record cannot safely represent multiple registrants.**  
   **Exact defect:** §D2 supplies no registration identity, owner/context identity, release token, or durable generation. It says registrations are idempotent “at the address” and stores only a count, but registrations at one address may disagree on `requestedScope`, `retentionRequest`, `idleTtlClass`, `priorityClass`, and `source`. LLP 0157 §D3 has one singular `requestedScope` per materialization, so concurrent page and page-set demands are especially unresolved.  
   **Why it matters:** Release of one caller can drop another caller’s demand; scope, priority, retention, and TTL become order-dependent; and a crash cannot distinguish a live registration from an abandoned count. Raw canonical args also have no specified storage section or LLP 0053 deletion/quarantine treatment.  
   **What resolves it:** Define a stable registration key/handle and exact per-source persistence rules; a closed aggregation lattice or explicit conflict refusal for every field; scope-demand semantics compatible with LLP 0157; idempotent release and crash recovery; and registration-record custody/redaction/barrier behavior.

4. **BLOCKING — Multi-tab registration is incompatible with the declared single-writer discipline.**  
   **Exact defect:** §D1 says non-writer tabs read and adopt but never write. §D2 says every active subscription registers and controls whether a record is `active`, hence non-evictable. There is no writer-broker protocol, cross-tab registration message, liveness lease, or context-loss reaping rule.  
   **Why it matters:** An active query in a reader tab either cannot register, violating sync-set fidelity, or must write, violating the single-writer contract. A dead tab can strand an `active` registration forever.  
   **What resolves it:** Specify writer-mediated registration/release, tab identity and liveness, crash/context-loss cleanup, handoff on writer change, and the exact moment the shared registration state becomes committed and observable.

5. **BLOCKING — §D5 is not a total lifecycle and contradicts both owners and itself.**  
   **Exact defect:** The table mixes registration demand (`active`/`idle`/`released`) with LLP 0053 lifecycle, omits owner state `retiring`, and introduces `retired` as a materialization state even though LLP 0157 §D3 says retired means absent/no status object. It does not define combinations such as active registration plus `quarantine`, `delete`, or `retiring`. Separately, §D3 permits unregistered in-grace custody while the Guardrails prohibit any unregistered retained materialization. “Released” records are first in eviction order, but TTL says they survive before eviction eligibility; `pinned` records are “held” yet idle records remain evictable.  
   **Why it matters:** Authorization precedence, rendering, syncing, release, and eviction cannot be implemented consistently. Different readings either retain revoked state incorrectly or destroy valid grace-period state.  
   **What resolves it:** Model separate axes—registration demand, LLP 0053 lifecycle, disposition, attempt, and freshness—and give their total product/precedence table. Define whether unexpired grace blocks pressure eviction, how `pinned` behaves, what happens without a prior establishment timestamp, clock/rollback semantics, and automatic GC triggers.

6. **BLOCKING — The promised answer matrix does not exist and §D4 misstates LLP 0157’s total state.**  
   **Exact defect:** §D4 says “everything else is `unknown`,” although LLP 0157 §D3 produces `refused` for a current refused attempt with no valid matching proof. S2 claims to test “this Spec’s tables exactly,” but §D4 contains no total table. Its common `{valid, absent, expired, wrong-scope}` dimension is not semantically common: token expiry permits legacy offline display but refuses resume to rung 3; lease expiry deletes before read; proof defects may discard, quarantine, or delete depending on the failed check. The output class for a valid legacy lease record is also not explicitly assigned.  
   **Why it matters:** The central completeness-honesty oracle is non-executable. Implementations may incorrectly blank valid legacy data, render expired protected state, or collapse refusal into ignorance.  
   **What resolves it:** Add a closed per-family transition/answer table containing owner lifecycle/disposition, activation, proof/token/lease checks, requested scope/version, connection state, outbox state, result class, freshness label, resume action, and required store mutation.

7. **BLOCKING — Legacy RQS lifecycle is both declared unchanged and normatively changed.**  
   **Exact defect:** §D3/§D6/S4 promise legacy entries retain LLP 0090 behavior and byte-compatible parity. But §D5 replaces LLP 0090 §D3’s least-recently-successfully-resumed ordering with last-authoritative-establishment ordering, adds a 14-day release TTL where LLP 0090 permits retained offline display indefinitely, and shares the legacy 256-entry budget with new materializations. Existing code implements the owner’s exact `resumedAt`/`savedAt` ordering at [packages/snapback-client/rqs-store.mjs:210](/Users/ccheever/projects/snapback-0166/packages/snapback-client/rqs-store.mjs:210).  
   **Why it matters:** This contradicts an Accepted owner while claiming unchanged consumption. The unmodified RQS suite and new lifecycle cannot both be normative. Existing `persistResume` entries also have no defined synthesized registration or TTL class during upgrade.  
   **What resolves it:** Either grandfather legacy entries under the exact LLP 0090 order, display duration, and a defined budget reservation, or carry an explicit dated LLP 0090 amendment and revise S4. Define migration from `persistResume` and `persist:false` to registration state.

8. **BLOCKING — Legacy lease-to-`qmk1` migration has no atomic carrier mechanism.**  
   **Exact defect:** §D1 deliberately leaves the Contract lease store separate in v1, while §D6 and S5 require atomic movement of payload, lease, fences, obligations, pending-intent references, and renderability into the successor domain. In the browser, the shipped lease store is a separate client-store adapter while the RQS successor is IndexedDB; no transaction can atomically span those artifacts. No two-phase protocol, durable migration marker, recovery ordering, or publication barrier is specified.  
   **Why it matters:** A crash can produce dual render, lost custody, or a state where neither owner can safely retire its copy. S5’s “prior or successor, never hybrid” oracle is currently unimplementable.  
   **What resolves it:** For v1, either forbid direct adoption and require fresh sync followed by fenced retirement, first move the lease store into the shared transaction domain, or specify an exact crash-safe two-phase bridge with a durable non-renderable marker and recovery protocol.

9. **BLOCKING — Budget accounting and eviction order are not carrier-independent or total.**  
   **Exact defect:** “32 MiB total payload bytes” does not define whether proof bytes, page-set manifests, memberships, optimistic references, keys, registration records, or serialization overhead count. The shipped legacy formula is exact—JSON bytes of `{rows, meta, token}` at [packages/snapback-client/rqs-store.mjs:199](/Users/ccheever/projects/snapback-0166/packages/snapback-client/rqs-store.mjs:199)—but no corresponding logical-byte formula exists for materializations. Equal recency has no final deterministic tie-break. The new 1,024-fragment and 14-day values are also fixed normatively while OQ4 says LLP 0155 OQ9’s measured freeze is still pending.  
   **Why it matters:** IndexedDB, file, memory, and SQLite carriers can admit and evict different records under the same workload, defeating carrier parity and making S3 non-deterministic.  
   **What resolves it:** Define canonical logical byte/count formulas, deduplication rules, deterministic final tie-break keys, blocker behavior, and an evidence-backed budget freeze before calling the values v1 constants.

10. **MATERIAL — `wipe` is not scoped precisely enough for LLP 0053’s authority model.**  
    **Exact defect:** §D1/§D5 describe `wipe` as the identity barrier’s store-wide retained-state-plus-outbox tool. LLP 0053 §Dispositions distinguishes client-wide session transitions from grant-scoped agent transitions and query-scoped quarantine/delete. A store may contain multiple authority partitions and grant cohorts.  
    **Why it matters:** Treating every authority rotation as a whole-store wipe can destroy unrelated grant custody and acknowledgements; treating wipe as optional can let another user replay predecessor intent.  
    **What resolves it:** State that full `wipe` is limited to caller-authorized reset and owner-required client-wide session transitions. Give separate exact behavior for grant-scoped and query-scoped barriers, including which outbox/ACK records remain opaque, stranded, or destroyed.

11. **MATERIAL — §D8 conflates shipped outbox behavior with accepted-but-unimplemented LLP 0163-family contracts.**  
    **Exact defect:** P8 is labeled “native and shipped” and then includes preallocated identity ranges, range exhaustion, epoch floors, `result-expired`, and `identity-horizon-passed`. The current shared outbox state is only `{sequence, records, acks}` at [packages/snapback-client/outbox-shared.mjs:299](/Users/ccheever/projects/snapback-0166/packages/snapback-client/outbox-shared.mjs:299). LLP 0163 remains Draft and explicitly owns the range/epoch/tombstone schemas, with exact shapes and parameters still open. LLP 0162 also says capability remains Missing until its gates pass.  
    **Why it matters:** The seam answer obscures a real maturity and dependency boundary. Either Move 2 needs new client-store schema work, or these contracts are merely future consumers; “nothing is pulled forward” cannot coexist with treating them as shipped store obligations.  
    **What resolves it:** Split P8 into “shipped base outbox/settlement” and “accepted semantic contract, unimplemented/schema-owned by LLP 0163.” State whether Move 2 depends on the latter; if not, keep it outside the Move-2 profile and capability claim.

12. **MATERIAL — §D8 overstates P9’s resource-bound coverage.**  
    **Exact defect:** LLP 0161 defines P9 as authority-scoped admission with resource bounds per principal. §D8 calls enforcement native, but §D3’s limits are global per store, hydration concurrency is global, and active registrations are unbounded and non-evictable. No per-principal or per-authority-partition registration, byte, or work quota exists.  
    **Why it matters:** One principal or grant can monopolize the store and establishment queue, including in a multi-grant agent client. That is exactly the containment failure P9 names.  
    **What resolves it:** Either add per-authority/principal admission budgets and refusal behavior or classify P9 as partial—fencing native, resource governance still open.

4. **Suggestions**

- Replace “shipped,” “accepted contract,” “proposed amendment,” and “future capability” with explicit maturity columns wherever they coexist.
- Give registration demand, authorization state, and completeness state separate names; the current reuse of `active` obscures different axes.
- Add a normative owner-crosswalk table listing every amended closed union and every identity that rotates.
- Make every eviction comparator end in a stable address-byte tie-break so replayed acceptance fixtures are deterministic.
- Clarify that legacy digest verification detects corruption, not client-side authenticity, matching LLP 0090’s threat model.
- Add exact diagnostic ownership beside each placeholder rather than relying on a single blanket sentence in §D7.

5. **Open questions** the document should carry but does not.

- Are simultaneous different completeness scopes at one QMK unioned, independently tracked, or refused?
- Which registration sources survive process restart, activation change, authority rotation, route departure, and tab death?
- How does a non-writer tab register and release demand through the shared writer?
- Is v1 lease-family convergence fresh-sync-only on browser carriers, or is a cross-artifact migration protocol required?
- Does the 14-day TTL apply to legacy RQS entries, and if so, is that an explicit LLP 0090 amendment?
- What exact logical bytes count toward the shared budget, and are quotas partitioned by address family or authority principal?
- What data model is actually evaluated locally: opaque result bytes, optimistic overlays, or authorized source fragments?
- Which registration fields are destroyed, quarantined, or retained across LLP 0053 transitions?
- Does enabling `fragment-evaluated-snapshot-v1` rotate existing QMKs and require fresh establishment?
- Is the LLP 0163 identity-range state part of this store’s first shipping profile or only a future adjacent outbox extension?

6. **Recommended next step**

Keep LLP 0166 in Draft and revise before round 2. First reconcile the amendment set with LLP 0157 and LLP 0090; then replace the registration, lifecycle, answer, and eviction prose with closed schemas and total tables; choose a coherent evaluator input model; and make browser lease migration fresh-sync-only unless an explicit cross-artifact crash protocol is designed. After those repairs, run a focused owner-consistency re-review before continuing the dual-family loop.