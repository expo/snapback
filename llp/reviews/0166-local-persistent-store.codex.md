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
---

## Round 2 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author `codex exec` context over the working tree at
34bddf62 (v0.2); instructed to read the revised document in full, audit
both round-1 artifacts for actual resolution in the current text, hunt
fix-introduced defects in the new machinery, and spot-check every repo/
owner fact relied on. Orchestrated by the authoring session, which does
not count as a reviewer; recorded verbatim below. Author verification
before application: the LLP 0080 server pipeline claim (filter → cursor →
order → take → join → projection over source rows), the LLP 0053
payload-compaction fence-survival rule, the 0043 boundary-note
non-renderability order, and the file-carrier corrupt-blob and
no-cross-process-channel facts were checked against the tree and are
accurate.

---

1. **Overall assessment**: **NOT READY — 0.99 confidence.** V0.2 resolves several round-one findings cleanly, especially the LLP 0157 classification amendment, anonymous-retention precondition, P8/P9 maturity split, and cited outbox constants. However, multiple round-one BLOCKING findings remain only partially resolved. The result-transform still lacks executable semantics; registration opt-outs do not affect the persistence predicate; the demand broker lacks a closed liveness/authority protocol; eviction contradicts LLP 0053’s mandatory fence survival; fresh-sync lease convergence publishes in the wrong order; and `wipe` claims atomic coverage that the stated store topology cannot provide. These are implementation- and security-significant contract defects, not author-choice details.

2. **Round-1 resolution audit**:

| Finding | Status | Explanation |
| --- | --- | --- |
| Codex-1 | resolved | |
| Codex-2 | partial | The input is narrowed to post-projection results, but the transform has no normative pipeline, overlay ordering, or owner-defined parity target. |
| Codex-3 | partial | Identity, durability, and merge fields exist, but `retentionRequest` is absent from the persistence rule and scope/address authority remains underdefined. |
| Codex-4 | partial | A broker is named, but liveness, release, acknowledgement, authority binding, and carrier-channel semantics remain open. |
| Codex-5 | partial | The two axes and precedence are clearer, but whole-record eviction conflicts with mandatory LLP 0053 bookkeeping survival. |
| Codex-6 | partial | The answer table and `refused` state exist, but the legacy-lease classification contradicts the document’s definition of authoritative answers. |
| Codex-7 | partial | Legacy TTL and relative recency are grandfathered, but shared-budget competition and the new final tie-break still change legacy behavior while claiming it is unchanged. |
| Codex-8 | partial | Direct cross-artifact adoption is forbidden, but the fresh-sync path does not fence the predecessor before publishing the successor. |
| Codex-9 | partial | Logical formulas and a tie-break were added, but metadata coverage, proof deduplication, and out-of-budget durable-registration bounds remain unspecified. |
| Codex-10 | partial | Client/grant/query scoping is stated, but the full-wipe contract contradicts the separate lease artifact and corrupt-store reset path. |
| Codex-11 | resolved | |
| Codex-12 | resolved | |
| Fable-1 | resolved | |
| Fable-2 | partial | The record and lattice are substantially improved, but effective retention and scope serialization are not total. |
| Fable-3 | partial | Writer mediation exists only as prose; the liveness and handoff protocol is not closed. |
| Fable-4 | resolved | |
| Fable-5 | resolved | |
| Fable-6 | resolved | |
| Fable-7 | partial | Survival and key-rotation intent are stated, but they cannot be honored for an unparseable whole-blob store without another mechanism. |

3. **New concerns**

1. **BLOCKING — `result-transform.v1` is still not an executable algebra.** The operator list does not define an execution order, especially whether optimistic overlays apply before or after filtering, ordering, and limiting. Its parity oracle requires “the server’s plan semantics applied to the same established result,” but LLP 0080’s server semantics consume source rows and run `filter → cursor → order → take → join → projection`; ordering fields need not even appear in the projected result ([0166 §D7](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:827), [0080 §2](/Users/ccheever/projects/snapback-0166/llp/0080-portable-relational-queries-and-projections.rfc.md:209)). Consequently S6 has no defined reference computation. Resolve this with a closed, versioned transform-plan record: exact pipeline, overlay position, eligible projected fields, output encoding, identity/hash binding, and refusals, plus a server implementation of that same transform. An overlay-only profile would also be coherent if that is the intended product.

2. **BLOCKING — `retentionRequest: "none"` does not actually opt out of persistence.** D2 defines and merges the field, and maps `persistResume: false`/manifest `persist: false` to it, but D3’s exhaustive persistence conditions require only an eligible profile, owner authority, a registration or grace, and LLP 0053 admission—never an effective `"durable"` request ([0166 §D2](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:323), [0166 §D3](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:469)). Thus an eligible plan registered with `"none"` still satisfies the normative persistence rule. Add effective `retentionRequest === "durable"` as a necessary condition and define the fenced transition when the last durable requester releases while `"none"` registrations remain.

3. **BLOCKING — The multi-tab demand broker lacks the protocol needed to make its guarantees true.** The text names a “liveness signal,” context death, acknowledgement, and re-announcement window, but defines no message records, monotonic revision/idempotency rules, heartbeat or lease expiry, programmatic release acknowledgement, or binding to the registration’s authority partition and expected fence ([0166 §D2 broker](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:387)). It also defers only pressure eviction during handoff, not every demand-derived release/GC transition. The shipped file carrier currently provides only lock-file writer ownership plus reader adoption, with no cross-process demand channel ([rqs-store-file.mjs](/Users/ccheever/projects/snapback-0166/packages/snapback-client/rqs-store-file.mjs:17)). Define a closed broker protocol and a qualified transport or explicit degradation for each carrier; suppress all demand-derived GC/eviction until handoff reconciliation completes.

4. **BLOCKING — Eviction simultaneously removes and preserves the same owner state.** D3 says the whole materialization—including product and authority state—is atomically present or absent; D5 likewise evicts whole records and says registration bookkeeping moves atomically. Yet D5 later says eviction never deletes owner bookkeeping ([0166 §D3](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:461), [0166 §D5](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:685)). LLP 0053 requires the exact current-instance fence and allocator/frontier high-water to survive payload compaction until terminal retirement ([0053 §Client fences](/Users/ccheever/projects/snapback-0166/llp/0053-authorization-invalidation.rfc.md:1583)). Evicting durable programmatic registration bookkeeping would also violate the sync-set contract. Split evictable payload custody from non-evictable `QueryAuthorizationState` and registration state, then define the post-eviction status and re-establishment transition.

5. **BLOCKING — Fresh-sync lease convergence publishes in the unsafe order.** V0.2 says fresh sync establishes the new `qmk1` address and then the legacy record becomes non-renderable; S5 nevertheless requires that both are never renderable ([0166 §D6](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:794), [0166 S5](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:1100)). With separate artifacts and no cross-artifact transaction, that ordering admits a dual-render window. LLP 0043 already gives the safe order: the old record remains non-renderable under its fence until fresh sync creates the successor ([0043 boundary](/Users/ccheever/projects/snapback-0166/llp/0043-offline-replay-retention.rfc.md:536)). Specify a monotonic protocol: durably close the predecessor fence, then establish/publish `qmk1`, then retire the predecessor, with crash cuts for every boundary.

6. **BLOCKING — The `wipe` contract cannot be implemented over the stated topology.** The legacy lease store is explicitly outside the shared transaction domain, but `wipe` later claims to clear “all three families” plus the outbox in one transaction ([0166 §D1 composition](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:230), [0166 §D1 wipe](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:262)). Separately, corrupt/future bytes may only be reset by `wipe`, while allocator and fence high-waters must survive; an unparseable whole-blob file cannot supply those values. The current file carrier explicitly treats the entire corrupt blob as opaque until wipe ([rqs-store-file.mjs](/Users/ccheever/projects/snapback-0166/packages/snapback-client/rqs-store-file.mjs:25)). Limit the atomic transaction claim to `qmk1`/legacy-resume/outbox state and make the lease store a separate LLP 0059 barrier participant. Put monotone high-waters in an independently verifiable envelope, or define an owner-approved store-identity rotation protocol for destructive corrupt reset.

7. **MATERIAL — Legacy RQS is still normatively changed while described as byte-unchanged.** A materialization commit may evict legacy entries under the newly shared budget, even when the legacy section alone is below its former budget; this changes Channel-B retention exposure without an LLP 0090 amendment ([0166 §D5](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:705), [0090 D3](/Users/ccheever/projects/snapback-0166/llp/0090-resumable-query-snapshots.rfc.md:772)). In addition, the mandated address-byte final tie-break is not the shipped comparator: code compares only `resumedAt`, then `savedAt` ([rqs-store.mjs](/Users/ccheever/projects/snapback-0166/packages/snapback-client/rqs-store.mjs:210)). Either reserve the legacy budget and retain its exact comparator, or carry a dated LLP 0090 successor-store amendment and test the changed competition/tie behavior explicitly.

8. **MATERIAL — The legacy-lease answer row contradicts the authoritative-answer definition.** Vocabulary defines an authoritative local answer as a successful LLP 0157 `readRenderable` with derived `CompletenessStatusV1 === complete`; row 14 labels a separate legacy lease record authoritative even though it has no `CompletenessProofV1` and does not use that interface ([0166 Vocabulary](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:164), [0166 answer table](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:594)). Use a distinct `lease-authorized-retained` answer class, or widen the definition with an exact owner-backed alternative basis without claiming LLP 0157 completeness.

9. **MATERIAL — Canonical budget accounting is not total and leaves durable registration growth unbounded.** The formula counts fragment bytes and selected proof/manifest/membership JCS, but omits materialization identities, product/authority/subscription state, references, and any rule for proofs duplicated between `productState.heldProofs` and fragment records. Durable programmatic registrations are outside the budget and have no independent count/byte cap ([0166 §D3 budgets](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:529), [0157 materialization record](/Users/ccheever/projects/snapback-0166/llp/0157-composition-algebra-and-completeness.spec.md:1311)). Define one canonical logical serialization or an explicit payload-only projection with deduplication rules, then bound all excluded durable metadata separately.

10. **MATERIAL — Acceptance requires an inspection surface that the Spec never defines.** D2 and S1 require inspection to name retaining registrations and hydration reasons, while D3/D5 require store-wide budget and eviction facts. LLP 0157’s closed client inspection schema contains none of the new registration/broker/policy fields and deliberately restricts retaining-identity exposure ([0166 S1](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:1065), [0157 §D6](/Users/ccheever/projects/snapback-0166/llp/0157-composition-algebra-and-completeness.spec.md:1250)). Add a versioned, authority-scoped store-policy inspection record or carry a dated LLP 0157 §D6 amendment with exact redaction rules.

4. **Suggestions**

- Use distinct terms for payload eviction, registration release, authorization deletion, terminal retirement, and full-store reset.
- Add one worked trace covering two tabs, mixed registration policies, writer death, late re-announcement, policy downgrade, eviction, and re-demand.
- Record the shipped 256-KiB per-outbox-record cap alongside the two cited count caps.
- Keep the provisional constants in a versioned capability/inspection record so their measured revision does not depend on prose interpretation.

5. **Recommended next step**

Keep LLP 0166 in Draft. First close concerns 1–6 with owner-aligned normative records and crash-order protocols; then repair the legacy budget/comparator, answer taxonomy, accounting, and inspection schema. After those revisions, run a focused round 3 against LLP 0157, LLP 0043/0053, and LLP 0090 before seeking READY.
---

## Round 3 — 2026-08-03

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author `codex exec` context over the working tree at
5bfcf869 (v0.3); focused round auditing round-2 resolution and probing the
round-2 repairs, with owner/repo spot-checks. Orchestrated by the
authoring session, which does not count as a reviewer; recorded verbatim
below. Author verification before application: the LLP 0155 §Query
execution commissioned text, the LLP 0051 scalar-ordering scope, the
external-store arbitrary-callback overlay facts, and the LLP 0053 closed
disposition set were checked against the tree and are accurate. Its
finding 8 (the truncated Fable round-2 artifact) was repaired immediately
at 46127881, before this fix pass.

---

1. **Overall assessment**: **NOT READY — 0.99 confidence.** V0.3 genuinely resolves payload-compaction survival, partitioned budgets, answer taxonomy, accounting, and inspection. However, five blocking defects remain: D7 silently narrows Accepted LLP 0155’s commissioned query execution, `TransformPlanV1` is not total or dual-runtime implementable, the broker cannot safely release or authority-bind durable registrations, retention and grace contradict each other, and `migration-closed` has no owner-defined state. The missing Fable round-2 body also prevents an honest audit of its three MATERIAL findings.

2. **Round-2 resolution audit**

| Finding id | Status | Explanation |
| --- | --- | --- |
| Codex-R2-B1 — transform algebra | partial | A record and pipeline now exist, but the grammar, ordering, overlay parity, and parent-RFC authority remain defective; see concerns 1–2. |
| Codex-R2-B2 — `retentionRequest` | partial | `"durable"` was added as necessary, but final release makes grace unsatisfiable and blockers allow effective-none payload to persist without a modeled reason; see concern 4. |
| Codex-R2-B3 — demand broker | partial | Full-set revisions, heartbeat, handoff suppression, and carrier degradation landed, but durable unregister, context-incarnation, and forwarded authority binding remain absent; see concern 3. |
| Codex-R2-B4 — compaction survival | resolved | |
| Codex-R2-B5 — lease convergence order | partial | Publication order and crash cuts are corrected, but step 1 depends on an undefined owner disposition; see concern 5. |
| Codex-R2-B6 — `wipe` topology/reset | partial | Lease participation and corrupt-store identity rotation are sound; parseable `wipe` still omits durable registrations from its exact clear set; see concern 6. |
| Codex-R2-M1 — legacy budget/comparator | resolved | |
| Codex-R2-M2 — legacy-lease answer class | resolved | |
| Codex-R2-M3 — total accounting | resolved | |
| Codex-R2-M4 — inspection surface | resolved | |
| Fable-R2-M1–M3 / N1–N6 | unresolved | The artifact ends after the Round-2 provenance header and contains none of the claimed nine findings, so their identities and resolution criteria cannot be audited. |

3. **New concerns**

1. **BLOCKING — D7 does not implement the Accepted Move-2 query-execution commission.**  
   **Exact defect:** Accepted LLP 0155 says generated query plans run over the local store and match the server’s ordering and projection. D7 instead defines a separate presentation transform and explicitly forbids invoking the plan’s source-row pipeline. The carried amendments do not amend LLP 0155 or LLP 0157’s corresponding “local plan evaluation” gate. [LLP 0155 §Query execution](/Users/ccheever/projects/snapback-0166/llp/0155-local-sync-product-direction.rfc.md:693), [LLP 0157 §D7](/Users/ccheever/projects/snapback-0166/llp/0157-composition-algebra-and-completeness.spec.md:1463), [LLP 0166 §D7](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:1013).  
   **Why it matters:** An owning Spec cannot silently substitute a narrower capability for its Accepted commission.  
   **What resolves it:** Either specify real owner-authorized plan evaluation over sufficient inputs, or carry an explicit LLP 0155/0157 amendment making the result-transform profile the revised Move-2 outcome.

2. **BLOCKING — `TransformPlanV1` remains non-total and its parity target is impossible for overlays.**  
   **Exact defect:** `filter: object` names no exact grammar/version; `orderFields` has no direction, missing/null/mixed-type comparison, or duplicate rule; `limit` has no integer/range contract; page-chain flattening and non-row result shapes are undefined. The cited LLP 0051 “canonical scalar ordering” supplies only string scalar ordering, not a total row comparator. More decisively, shipped optimistic layers are arbitrary client callbacks, while D7 requires a server implementation of the same overlay-applying transform over only the same established result bytes. [LLP 0051 value model](/Users/ccheever/projects/snapback-0166/llp/0051-language-neutral-data-tier.rfc.md:517), [external-store overlay execution](/Users/ccheever/projects/snapback-0166/packages/snapback-client/external-store.mjs:133), [overlay construction](/Users/ccheever/projects/snapback-0166/packages/snapback-client/external-store.mjs:356).  
   **Why it matters:** Neither evaluator nor S6’s reference output can be implemented deterministically.  
   **What resolves it:** Freeze a bounded transform grammar, directions and total comparator, result-shape/page assembly, and limit semantics. Either encode overlays in a portable IR consumed by both runtimes or exclude overlay application from the dual-runtime transform oracle and test client-only composition separately.

3. **BLOCKING — The broker still cannot safely own the full registration lifecycle.**  
   **Exact defect:** `RegisterForwardV1` can create a durable registration but no message can explicitly release it, despite D2 requiring release by API. `contextId` is merely lifetime-stable, not never-reused or incarnation-bound, so revision reset can cause a new live context’s announces to be ignored or delayed old announces to resurrect demand. Forwarded registration carries neither `authorityPartitionDigest` nor an expected fence; “store’s current fence” is insufficient for multi-partition clients. [Broker protocol](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:449).  
   **Why it matters:** Durable registrations can be stranded, and live-tab demand can be wrongly ignored or scoped to another authority partition.  
   **What resolves it:** Add never-reused context-session identity, authority/fence-bound register and unregister requests with outcomes, idempotent crash recovery, and validation of which sources may appear in volatile announces.

4. **BLOCKING — `retentionRequest`, release grace, and compaction blockers do not form a total persistence rule.**  
   **Exact defect:** D3 requires both effective `"durable"` and a registration or grace. After the final registration releases, no effective merged retention request remains, so even `"default"` or `"pinned"` grace cannot satisfy the rule. Conversely, a downgrade to `"none"` may remain durably stored while a compaction blocker holds, contradicting the claimed necessary condition; inspection has no blocker-based retaining reason. [Merge/downgrade](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:401), [persistence conditions](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:581), [compaction blockers](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:851).  
   **Why it matters:** The normal release path contradicts S1/S3, while safety-held effective-none bytes violate the inspection invariant.  
   **What resolves it:** Pin the last effective durable-retention decision into grace or make grace an explicit alternative condition. Model blocker-forced custody separately from discretionary retention, including its inspection reason and release transition.

5. **BLOCKING — `migration-closed` is not a state LLP 0043/0053 can currently persist.**  
   **Exact defect:** D6 calls it an LLP 0043-owned disposition, but LLP 0053’s closed dispositions remain `retain | quarantine | delete`, LLP 0043 defines no `migration-closed` state, and the existing boundary note only requires predecessor non-renderability. [LLP 0043 boundary](/Users/ccheever/projects/snapback-0166/llp/0043-offline-replay-retention.rfc.md:536), [LLP 0166 convergence acceptance](/Users/ccheever/projects/snapback-0166/llp/0166-local-persistent-store.spec.md:1367).  
   **Why it matters:** The protocol’s first durable step—and therefore every crash-cut guarantee—has no record shape or legal transition.  
   **What resolves it:** Express step 1 through an existing owner transition such as terminal retirement, or carry a real LLP 0043/0053 schema and state-machine amendment defining the durable, non-releasable close state.

6. **MATERIAL — Parseable `wipe` does not clear everything D2 says store reset releases.**  
   **Exact defect:** Durable programmatic registrations live in `storeMeta` and release on store reset, but D1’s atomic clear list omits `storeMeta` and never specifies field-level clearing within it.  
   **Why it matters:** A reset may preserve registrations that rehydrate data the caller intended to discard.  
   **What resolves it:** Define the exact `storeMeta` projection cleared versus preserved: destroy registrations and policy facts while retaining allocator, fence/barrier high-waters, and other named survivals.

7. **MATERIAL — Governed-family scoping remains contradictory in D3.**  
   **Exact defect:** D3’s universal “Persistence requires all” list includes legacy Channel-B authority but also requires `retentionRequest` plus registration/grace. Grandfathered legacy entries have neither and are supposed to persist indefinitely under LLP 0090, as D5/S4 state.  
   **Why it matters:** One reading deletes legacy entries; the other makes D3’s exhaustive conditions false.  
   **What resolves it:** Scope conditions 1–5 explicitly to `qmk1` materialization payload and state the legacy envelope’s independent LLP 0090 persistence predicate separately.

8. **MATERIAL — The claimed verbatim Fable round-2 artifact is incomplete.**  
   **Exact defect:** [The artifact](/Users/ccheever/projects/snapback-0166/llp/reviews/0166-local-persistent-store.fable.md:323) ends immediately after its provenance separator; it contains no assessment, audit, or findings.  
   **Why it matters:** The three prior MATERIAL findings cannot be identified or honestly declared resolved under LLP 0005.  
   **What resolves it:** Recover and append the actual review with provenance, or correct the claims and rerun an independent Fable-family round.

4. **Suggestions**

- If the narrower result-transform direction is retained, rename its retention class so it does not imply source-plan evaluation.
- Add one broker fixture covering commit → writer crash before outcome → retry → non-writer unregister → context-ID collision.
- Add one retention trace covering final durable release, grace, a blocker, blocker discharge, and exact inspection reasons.
- Keep the compaction, answer-table, and partitioned-budget repairs unchanged; those converged cleanly.

5. **Recommended next step**

Keep LLP 0166 in Draft. Resolve concerns 1–5 first, repair D1/D3 scoping, and recover or rerun the missing Fable review. Then run another focused dual-family review of D2, D3/D5, D6, and D7 before considering acceptance.