# LLP 0103 / 0104 / 0105 — cluster review (GPT family)

**Reviewer family:** GPT
**Provider / runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (read-only sandbox)
**Targets:** LLP 0103 (RFC), 0104 (Spec), 0105 (Plan) — reviewed as a lockstep cluster; this file holds the verbatim cluster review, with per-target verdicts. 0104/0105 carry pointer stubs to this file.
**Redacted:** No (target bytes disclosed whole; context = repo minus `llp/reviews/<targets>`).

## Round 1 — 2026-07-28 (/llp-super-refine)

- **Topology:** lockstep cluster (targets tightly coupled via `Related:` and cross-references).
- **Entry revision hashes:** 0103 `cfe177f4` · 0104 `e3788e7d` · 0105 `81300b18` (git blob, at Draft→Review transition).
- **Instruction hash:** `0ec10b35` (`/tmp/sr1/instruction.md`).
- **Runtime:** OpenAI Codex CLI 0.145.0 / GPT-5, `--sandbox read-only`.
- **Blindness:** launched concurrently with the Fable review; reviewer instructed to exclude `llp/reviews/`; the two reviews were sealed from each other until both landed. Structural capsule exclusion of review artifacts.

---

## Overall assessment

The set has a strong product thesis and a credible Cloudflare architecture, but it is not yet internally consistent enough for acceptance. The largest defects are the transfer-breaking identity definition, the absence of a bounded distributed quota-enforcement design, an incomplete activation-consistency contract, and delivery dependencies that are assigned to phases later than the gates that require them.

## Strengths

- The division among Expo identity/control plane, Cloudflare substrate, and Snapback semantics is clear and strategically compelling.
- The dedicated WfP handler, narrow host bridge, platform-owned Durable Object, and separate action kill domain form a plausible isolation architecture.
- The documents correctly distinguish releases from environments and code rollback from data restoration.
- Metering uses stable identifiers, idempotent events, append-only corrections, ownership intervals, and completeness watermarks—an unusually strong billing foundation.
- The margin gate includes normal, tail, adversarial, and free-maximum-cost workloads instead of treating candidate prices as facts.
- The plan uses evidence gates, fault injection, shadow billing, reconciliation periods, restore drills, and ordinary-Hosting regression checks.
- Capability gaps and the single-coordinator/10 GB ceiling are generally stated honestly rather than hidden.

## Concerns

1. **[MATERIAL] Stable identity is incompatible with app transfer.** LLP 0103 §Project and environment identity defines the stable key as `(expoAccountId, expoAppId, snapbackEnvironmentId)`, while §Transfer and deletion says transfer changes ownership without changing the durable id. Because `expoAccountId` changes on transfer, both cannot be true. LLP 0104 §Metering identity and event contract repeats account id alongside the supposedly stable dimensions. Define durable environment identity independently of the current owner—normally `(expoAppId, snapbackEnvironmentId)` or an opaque service/environment id—and treat account ownership as a time-versioned attribution fact.

2. **[MATERIAL] Aggregate free quotas lack an enforceable distributed budget protocol.** LLP 0104 §Commercial principles and §Proposed free tier aggregate quotas per Expo account, but §Entitlements and quotas provides only cached entitlement projections and invalidation. Multiple apps/environments can therefore spend concurrently past an account-wide hard limit before ledger convergence. This contradicts “Free never creates an overage invoice” and the bounded-free-cost gate. Specify conservative per-environment allocations, leases/reservations, or another authoritative account budget protocol, including overshoot bounds, partition behavior, delayed-meter behavior, storage headroom, and reclaim/rebalance rules. LLP 0105 P0.4 and Gates 0/3 must prove this protocol, not merely calculate costs.

3. **[MATERIAL] Release activation does not define the data-plane consistency mechanism.** LLP 0103 §Deployment and lifecycle state machine selects the backend release before updating the EAS alias, while requests can also arrive through preview URLs, custom domains, and already-open WebSockets. Alias compensation alone cannot prevent old frontend traffic from observing the new backend or stale connections from invoking the wrong release. Define how each request/connection is pinned to a release, the cutover fence and compatibility window, what happens to open subscriptions, and the repair invariant. LLP 0105 P0.3 currently defers whether a saga is needed even though 0103 Decision 5 already requires one fenced operation.

4. **[MATERIAL] The paid storage contract omits the platform’s hard per-object ceiling.** LLP 0103 §Completeness gap matrix acknowledges the 10 GB Durable Object ceiling, but LLP 0104 §Proposed paid contract offers database-storage overage without a published maximum or near-cap behavior. A customer could reasonably infer that additional payment permits continued growth. Add an explicit service limit, warnings and write behavior near the ceiling, reserved operational headroom, and a supported export/graduation path before the object reaches provider exhaustion.

5. **[MATERIAL] The billable database-storage quantity is not operationally defined.** LLP 0104 §Customer-facing meters calls it “logical SQLite bytes, including indexes/system tables,” while provider billing is based on stored SQLite data and the design excludes invisible PITR overhead. “Logical SQLite bytes” has no unambiguous bill-grade measurement here: allocation, free pages, WAL state, indexes, system tables, and deleted-but-not-reclaimed pages can differ. Specify the exact query/snapshot algorithm, cadence, interpolation, compaction treatment, correction policy, and reconciliation to Cloudflare’s physical charge, then include it in P0.4 acceptance.

6. **[MATERIAL] LLP 0089 is assigned authority for operations it explicitly does not define.** LLP 0103 §Paved path says CLI, dashboard, Workflows, HTTP, and MCP are projections of LLP 0089’s provisioning operations, despite this set requiring environment creation, promotion, inspection, export, restore, transfer, suspension, and deletion. LLP 0089’s `provisioning.v0` table lacks most of these and explicitly omits deletion and billing/tenant lifecycle. LLP 0105 repeats the mismatch under §Work ownership and §Cross-repository ledger. Define a hosted lifecycle operation contract or explicitly narrow LLP 0089 to artifact provisioning and identify the authority for every remaining operation.

7. **[MATERIAL] The delivery sequence requires beta-safe config/secrets before scheduling their implementation.** LLP 0105 §Phase 2 requires safe config/secrets for private beta, but §Phase 4 lists “config acquisition/rotation” as a later GA item and Phases 0–2 contain no concrete config/secrets slice or gate. Separate the minimum private-beta contract—storage, binding, redaction, rotation/revocation, audit, and action-only exposure—from later ergonomic enhancements, and deliver/test that minimum before Gate 2. Apply the same explicit dependency treatment to the maintenance-job subset required by Phase 2.

8. **[detail] Customer-facing “backend request” boundaries need a normative operation table.** LLP 0104 §Customer-facing meters includes “platform operation” without identifying which control-plane operations are chargeable and how compound operations, retries, subscriptions, reconnects, exports, and restores count. Add examples and a versioned classification table so runtime, dashboard, pricing documentation, and invoices cannot diverge.

9. **[detail] Separate handler/action deployment needs one launch decision.** LLP 0103 §Recommended Cloudflare topology permits either a separate action role or a “demonstrably equivalent kill domain,” and LLP 0105 §Open decisions leaves one versus two scripts unresolved. Record the admissible alternatives and proof criteria before Gate 0 so cost and security experiments test the architecture that can actually ship.

10. **[detail] Backup security and retention deserve explicit acceptance assertions.** LLP 0103 assigns exports and backups to R2 and requires a privacy/retention inventory, while LLP 0105 tests restore correctness. Add encryption/key ownership, access logging, deletion propagation, transfer behavior, retention expiry, and cross-tenant restore-negative tests to the lifecycle receipts.

## Cross-document consistency

- 0103’s stable key contains the current Expo account, contradicting its transfer invariant and 0104’s ownership-interval attribution model.
- 0104 promises hard account-aggregate free limits, but neither 0103’s topology nor 0105’s gates deliver an account-wide reservation/enforcement authority.
- 0103 requires atomic-looking alias/backend activation, while 0105 leaves the coordination mechanism open and does not cover existing WebSockets or non-alias routes.
- 0103 discloses a 10 GB database ceiling, but 0104’s paid table presents uncapped GB-month overage without a maximum.
- 0103 and 0105 overstate LLP 0089’s scope; its operation table does not own the full lifecycle surface these documents require.
- 0105 requires safe config/secrets in Phase 2 but schedules the named config work in Phase 4.
- 0104’s database-storage meter is not yet tied to a measurement mechanism that 0105 P0.4 can prove or reconcile.

## Verdicts

0103: NOT READY
0104: NOT READY
0105: NOT READY
SET: NOT READY

---

## Round 2 (delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hashes (revision 2):** 0103 `dd7d7aa5` · 0104 `8bc8ec21` · 0105 `d29521e6`.
- **Instruction hash:** `04164b23` (`/tmp/sr2/instruction.md`; delta enumerated in the instruction).
- **Runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (`gpt-5.6-sol`), `--sandbox read-only`.
- **Blindness:** launched concurrently with the round-2 Fable review; reviewer instructed to exclude `llp/reviews/`; sealed until both landed.

Overall assessment

The durable identity, capability-gated PITR, pricing gates, private-beta security slices, and blocking Phase-0 proofs are materially improved. However, the round-1 concerns do not yet read as fully resolved: the release fence has an admission race, the promised scale envelope has no actual limit, lifecycle ownership contradicts LLP 0089, and the storage and account-budget contracts are not yet enforceable as written.

Concerns

1. **[MATERIAL] {IN-DELTA}** The release fence does not establish its claimed ordering. In 0103 §Release pinning and cutover fence, the gateway reads the release before the coordinator fence, leaving a request able to pin the old release, stall, and execute only after migration and activation. The compatibility rule says the *new* release accepts prior in-flight requests, but the stalled request remains pinned to the old handler. Open subscriptions also have no enforced maximum lifetime after the compatibility window. Resolve by making admission and execution participate in a coordinator-issued epoch/lease: either drain and revoke the old epoch before migration, or explicitly prove both old and new handlers operate safely on the post-migration schema until a bounded deadline, after which old requests and sockets are terminated. Update 0105 P0.3 to inject admission-to-execution delay and non-responsive WebSockets, not merely routing failures.

2. **[MATERIAL] {IN-DELTA}** The “published, enforced envelope” has no publishable ceiling. 0103 §Interim per-environment scale envelope and 0104 §Service limit only say “safely below 10 GB” and give no storage number, no write-rate number, and no derivation of reserved headroom. 0105 P0.4 does not require those numbers as Gate-0 outputs. Consequently the documents cannot be checked for the specifically required cross-document consistency, and warning/refusal thresholds cannot be implemented. Resolve by defining one concrete launch storage ceiling and write-rate envelope, or making Gate 0 select them through an explicit formula and requiring 0103/0104 ratification to pin identical dated values before beta.

3. **[MATERIAL] {IN-DELTA}** The revised LLP 0089 boundary contradicts its governing document and leaves rollback ownership ambiguous. 0103 §Paved path declares LLP 0089 authoritative only for artifact provisioning, while LLP 0089 explicitly owns `app.create`, `code.activate`, rollback policy, and the lifecycle surface that creates an app. 0105 §Work ownership and §Cross-repository ledger repeat the narrower claim without amending or superseding LLP 0089. Additionally, the new hosted-lifecycle list omits rollback even though 0103’s product contract and 0104’s operation table require it. Resolve by amending LLP 0089 and defining an exact operation mapping—especially `app.create`, `code.activate`/promote/rollback, and environment creation—or retain LLP 0089 as contract authority with Universe as hosted implementation authority.

4. **[MATERIAL] {IN-DELTA}** The logical-storage contract is not yet bill-grade. In 0104 §Defining billable “logical SQLite bytes,” `(page_count − freelist_count) × page_size` measures allocated non-freelist pages, not live logical contents: partially empty B-tree pages and deleted data awaiting page reuse remain charged despite the text claiming deleted-but-unreclaimed space is excluded. The missing-sample rule also promises correction when a “true sample lands,” although a sample never taken cannot later be recovered. Finally, Cloudflare exposes per-object `databaseSize`, but provider stored-byte analytics are namespace-level rather than a provider physical charge per stable id, so P0.4’s stated reconciliation target is unavailable directly. Resolve by naming the quantity honestly, specifying supported Cloudflare APIs and units, defining irreversible missing-sample treatment, and reconciling per-object first-party samples in aggregate to the namespace/provider bill with an explicit allocation and error bound.

5. **[MATERIAL] {IN-DELTA}** The account-budget protocol is not transfer-safe. 0104 §Authoritative account-budget protocol allows environments to spend outstanding account leases, while §Metering identity attributes events to the owner at occurrence. On transfer, an environment can therefore continue spending a lease reserved from the old account while usage is attributed to the new account, bypassing the new owner’s hard free limit and corrupting both accounts’ remaining-budget state. “Immediate invalidation” of cached entitlements does not define revocation of already-issued authoritative leases or treatment of in-flight commits. Resolve with a transfer fence that revokes or epochs all old-owner leases, bounds in-flight spend, and requires a new-owner lease before post-cutover work; add this case to 0105 P0.4 and Gate 1.

Cross-document consistency

The owner-independent durable key is consistently stated across 0103, 0104, and 0105, but transfer is incomplete at the lease boundary. The scale envelope is verbally consistent yet numerically absent from all three documents. The release-fence claims in 0103 are repeated as proof obligations in 0105 without testing the critical admission/execution race. The LLP 0089 narrowing in 0103 and 0105 conflicts with LLP 0089’s current operation table, while 0104 additionally treats rollback as a chargeable lifecycle operation that the new lifecycle authority list omits. The logical-storage algorithm in 0104 is made blocking by 0105, but 0105 assumes a per-stable-id provider reconciliation feed the named Cloudflare primitives do not provide.

**Verdicts (round 2):** 0103 NOT READY · 0104 NOT READY · 0105 NOT READY · SET NOT READY. All five concerns classified {IN-DELTA} (revision-introduced); no PRE-EXISTING MATERIAL concern reported.

---

## Round 3 (final delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hashes (revision 3):** 0103 `ad022d13` · 0104 `01290602` · 0105 `016dac73`.
- **Instruction hash:** `2714de89` (`/tmp/sr3/instruction.md`; delta enumerated).
- **Runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (`gpt-5.6-sol`), `--sandbox read-only`.
- **Blindness:** launched concurrently with the round-3 Fable review; instructed to exclude `llp/reviews/`; sealed until both landed.

## Overall assessment

Revision 3 substantially improves the epoch fence, scale-envelope derivation, storage-meter naming, operation mapping, and budget-transfer story. However, the prior MATERIAL concerns do not yet read as fully resolved: the compatibility proof remains non-enforceable, the transfer boundary is ambiguous for in-flight commits, and the defined storage meter cannot be derived consistently from the named measurements.

## Concerns

1. **[MATERIAL] {IN-DELTA}** The admission compatibility check is not a proof of the property the release fence relies on. In 0103 §Release pinning and cutover fence and 0105 §P0.3, a declared contract, schema-superset check, and “representative” replay are said to prove both handlers safe on the post-migration schema. Representative replay cannot establish this generally, while “where the superset check is insufficient” has no enforceable decision rule. Define a restrictive, machine-checkable compatibility matrix or migration language that is sufficient by construction; treat replay as supplemental evidence, not proof. Otherwise require hard drain-and-revoke.

2. **[MATERIAL] {IN-DELTA}** The transfer fence does not define which side owns an in-flight operation that is admitted before cutover but commits afterward. 0104 §Authoritative account-budget protocol says in-flight spend already committed under the old interval is bounded to the old owner, but also attributes by the interval at `occurredAt`; it never defines whether `occurredAt` is admission, execution, or commit time. 0103 §Transfer and deletion additionally says open connections are not rekeyed without specifying a coordinator execution fence. Make transfer an atomic coordinator boundary: stop admission, drain/terminate old-budget work, advance the ownership/lease epoch, then require a new-owner lease—or explicitly bind each operation’s attribution and budget reservation at admission and carry that binding through commit.

3. **[MATERIAL] {IN-DELTA}** The storage quantity and named measurement APIs do not agree. 0104 §Defining billable “logical SQLite bytes” defines `(page_count − freelist_count) × page_size`, but names `databaseSize` and/or `page_count × page_size`; neither stated path supplies the required `freelist_count`, and the document does not establish that `databaseSize` has the defined semantics. Name and validate `PRAGMA freelist_count` and `PRAGMA page_size`, or redefine the billed quantity to exactly match a supported first-party measurement.

4. **[MATERIAL] {IN-DELTA}** Missing-sample treatment is internally contradictory. In 0104 §Defining billable “logical SQLite bytes,” carry-forward from the previous sample is called a conservative estimate that never undercounts, but it undercounts whenever storage grows during the missing interval. Specify a reproducible estimator with a bounded customer-billing error and an explicit customer-favorable correction/credit policy; do not claim irreversible carry-forward is necessarily conservative.

5. **[MATERIAL] {IN-DELTA}** The revised LLP 0089 authority mapping still collides with 0089’s scope. 0103 §Paved path and 0105 §Work ownership assign `inspect` to 0103’s hosted-lifecycle contract, while LLP 0089 explicitly identifies `app.inspect` as an LLP 0024 host-operation. They also map “`app.create` / environment creation” to LLP 0089 although `provisioning.v0` defines creation of an app, not creation of additional environments. Give the hosted operations distinct stable IDs and authority—such as `environment.create` and a specifically scoped service/environment inspection operation—and amend 0089 where its surface must grow.

6. **[detail] {IN-DELTA}** The namespace reconciliation contract remains deferred rather than specified. 0104 §Defining billable “logical SQLite bytes” and 0105 §P0.4 require an “explicit allocation rule and error bound” but provide neither the candidate rule nor acceptance math. Gate 0 should record the exact aggregation window, treatment of namespace resources outside Snapback, tolerances, and escalation behavior.

7. **[detail] {IN-DELTA}** 0105 §P0.3 says a pre-fence request delayed until after migration may execute under “old-epoch drain-and-revoke.” Under hard drain-and-revoke, such a request must complete before migration or be terminated; only the proven compatibility-window path permits post-migration old-epoch execution. Tighten the test wording to preserve that distinction.

## Cross-document consistency

The coordinator epoch, maximum socket lifetime, route-independent pinning, and failure injections are otherwise aligned across 0103 and 0105. The scale-ceiling formulas and identical-dated-pin requirement are aligned across all three documents. The transfer requirements are textually repeated in 0104 and 0105 but lack matching execution-boundary semantics in 0103. The LLP 0089 tables agree with each other, but not with LLP 0089’s actual `app.create` boundary or its reservation of `app.inspect` to LLP 0024. The logical-storage formula is repeated consistently at the conceptual level, but its named APIs do not implement that formula.

**Verdicts (round 3):** 0103 NOT READY · 0104 NOT READY · 0105 NOT READY · SET NOT READY. All concerns {IN-DELTA}; no PRE-EXISTING MATERIAL concern reported.

---

## Round 4 (delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hashes (revision 4):** 0103 `12624eb4` · 0104 `efef254e` · 0105 `fd52455b`.
- **Instruction hash:** `a1da1700` (`/tmp/sr4/instruction.md`; delta enumerated).
- **Runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (`gpt-5.6-sol`), `--sandbox read-only`.
- **Blindness:** launched concurrently with the round-4 Fable review; instructed to exclude `llp/reviews/`; sealed until both landed.

Overall assessment

The revision resolves the named-PRAGMA issue and substantially improves the release-fence and admission-bound attribution language. However, the prior MATERIAL concerns do not yet read as fully resolved: the compatibility-window predicate is asserted rather than defined sufficiently by construction, app-wide transfer atomicity remains underspecified across multiple environment coordinators, and the missing-sample estimator is not actually assigned a Gate-0 proof. The set is not ready.

Concerns

1. **[MATERIAL] {IN-DELTA}** The compatibility-window rule is not yet demonstrably sufficient by construction. LLP 0103 §Release pinning and cutover fence and LLP 0105 §P0.3 name a “declared forward-compatibility contract plus schema-superset check,” but they do not define the contract’s machine-checkable predicates. A schema superset alone does not protect old handlers from changed constraints, permissions, triggers, defaults, data invariants, or semantic migrations. Resolve by specifying the admissible migration/manifest language and exact checks that prove every old-epoch read/write remains valid, with all unproved changes forced to hard drain-and-revoke.

2. **[MATERIAL] {IN-DELTA}** Transfer is described as an atomic coordinator boundary, but an app can contain multiple environments with separate coordinators. LLP 0103 §Transfer and deletion and LLP 0104 §Authoritative account-budget protocol do not define how a single authoritative ownership interval is coordinated with admission fences and lease epochs across all those coordinators, including partial failure. Resolve by defining an app-wide transfer protocol: global transfer epoch, prepare/fence acknowledgements from every environment, ownership publication point, failure recovery/rollback, and behavior for unavailable coordinators.

3. **[MATERIAL] {IN-DELTA}** The missing-sample estimator is promised but not made an enforceable delivery output. LLP 0104 §Defining billable “logical SQLite bytes” says its estimator and bounded customer-billing error are Gate-0 outputs, while LLP 0105 §P0.4 and §Gate 0 require reconciliation records but never require implementing, fault-injecting, or proving that estimator and bound. A later endpoint sample also cannot generally reconstruct time-weighted storage during a gap. Resolve by adding an explicit P0.4 experiment and Gate-0 criterion defining estimator inputs, reproducibility, worst-case error derivation, customer-favorable settlement, and credit behavior under growth and shrinkage.

4. **[MATERIAL] {IN-DELTA}** LLP 0104 §Chargeable operation classification does not consistently use the canonical stable operation ids. It lists `promote` and `rollback`, while LLP 0103 §Paved path and LLP 0105 §Work ownership say both are modes of LLP 0089’s `code.activate`. A billing classification table intended to agree exactly across runtime, dashboard, docs, and invoices cannot mix projection labels with operation ids. Resolve by classifying `code.activate` once, with an explicit promote/rollback mode if needed, and use that encoding across all three documents.

5. **[MATERIAL] {PRE-EXISTING}** The scale-ceiling headroom basis contradicts the billable-storage definition. LLP 0103 §Interim per-environment scale envelope calls index/system-table overhead an operational reserve “the customer meter does not count,” while LLP 0104 §Summary and §Defining billable “logical SQLite bytes” explicitly say the customer meter includes index and system-table pages. LLP 0104 §Service limit then subtracts that same overhead as reserved headroom. Resolve by defining whether the published ceiling applies to total allocated non-freelist bytes or user-data bytes, and subtract only capacity not already represented in that quantity.

Cross-document consistency

The `environment.create`/`environment.inspect` split now agrees with LLP 0089 across 0103 and 0105, and 0104 includes both in `operation-class.v1`; transfer and preview-TTL governance are also enumerated as non-chargeable. The exact PRAGMA formula and `databaseSize` cross-check agree between 0104 and 0105. Remaining inconsistencies are the undefined compatibility predicate shared by 0103/0105, the absent app-wide multi-coordinator transfer protocol across all three documents, the missing estimator proof in 0105, the `code.activate` versus `promote`/`rollback` operation naming in 0104, and the contradictory treatment of index/system-table bytes in the scale-ceiling formulas.

**Verdicts (round 4):** 0103 NOT READY · 0104 NOT READY · 0105 NOT READY · SET NOT READY. Four {IN-DELTA}, one {PRE-EXISTING} (concern 5).

---

## Round 5 (delta) — 2026-07-28 (/llp-super-refine)

- **Entry revision hashes (revision 5):** 0103 `ec05fc83` · 0104 `3d3751b6` · 0105 `b1d87cc3`.
- **Instruction hash:** `af973354` (`/tmp/sr5/instruction.md`; delta enumerated).
- **Runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (`gpt-5.6-sol`), `--sandbox read-only`.
- **Blindness:** launched concurrently with the round-5 Fable review; instructed to exclude `llp/reviews/`; sealed until both landed.

Overall assessment

The compatibility-window predicate, missing-sample Gate-0 experiment, and `code.activate` operation-id correction now read as resolved. The set is still not ready: the new transfer protocol lacks participant-set serialization and coherent abort semantics, while 0105 contradicts the reconciled storage-headroom basis. The PRAGMA fallback also cannot implement the specified billable quantity.

Concerns

1. **[MATERIAL] {IN-DELTA}** The app-wide transfer protocol does not freeze the participant set. LLP 0103 §App-wide multi-coordinator transfer protocol says Universe enumerates coordinators, but does not prevent an environment from being created, deleted, or restored between enumeration and ownership publication. Such a coordinator can escape prepare/fence, invalidating the claim that all environments cross ownership atomically. LLP 0104 §Authoritative account-budget protocol and LLP 0105 P0.4/Gate 1 inherit the gap. Resolve by serializing environment-lifecycle mutations against the global transfer epoch, durably snapshotting the participant set, and requiring publication to validate that the set remains unchanged.

2. **[MATERIAL] {IN-DELTA}** Transfer abort semantics conflict with prepare actions. LLP 0104 §Authoritative account-budget protocol says prepare revokes/epochs old-owner leases, but failure recovery says old-owner leases are retained app-wide. Once revoked or epoched, those leases cannot simply remain valid without an explicit rollback transition. LLP 0103 §App-wide multi-coordinator transfer protocol only says prepared coordinators resume under the old owner. Define a durable participant state machine with idempotent prepare/commit/abort, specify whether prepare merely freezes leases or revokes them, and require abort acknowledgements plus restored or freshly issued old-owner leases before admission resumes. Narrow “no partial transfer is observable” to ownership attribution unless partial prepare-time availability loss is also meant to be hidden.

3. **[MATERIAL] {IN-DELTA}** LLP 0105 P0.4 §Scale-envelope ceilings reintroduces index/system-table overhead as a measured headroom component. LLP 0103 §Interim per-environment scale envelope and LLP 0104 §Service limit explicitly count those pages in-band and forbid double-counting them as headroom. Remove index/system-table overhead from 0105’s headroom list; P0.4 should measure it as part of allocated non-freelist bytes, while headroom contains only PITR depth, compaction/allocation slack, and safety margin.

4. **[MATERIAL] {IN-DELTA}** The PRAGMA-unavailable fallback is not a viable billing source. LLP 0104 §Defining billable “logical SQLite bytes” requires `freelist_count` to compute allocated non-freelist bytes, yet says `databaseSize` is only a cross-check. LLP 0105 P0.4 then says to “fall back to the `databaseSize` cross-check,” which cannot recover freelist bytes or implement the contracted meter. Make missing PRAGMA support a Gate-0 failure that reshapes the billing basis, or specify and ratify a distinct customer-favorable fallback quantity and migration/correction policy.

5. **[detail] {IN-DELTA}** LLP 0105 P0.4/Gate 0 makes the missing-sample estimator a genuine blocking obligation, but the receipt should explicitly record estimator inputs, maximum gap duration, error-bound units, and the rule for converting a later sample into an append-only credit. This is implementation refinement, not a defective decision.

Cross-document consistency

The compatibility predicate agrees between LLP 0103 §Release pinning and cutover fence and LLP 0105 P0.3: only enumerated additive, backward-safe changes qualify, all semantic or invariant-changing migrations force hard drain-and-revoke, and replay is supplemental only. The missing-sample experiment in LLP 0105 P0.4/Gate 0 matches LLP 0104’s customer-favorable estimator contract. `code.activate` is consistently one operation with promote/rollback modes. Storage basis agrees between 0103 and 0104 but is contradicted by 0105’s headroom enumeration. The transfer documents share the intended publication point, but all omit participant-set serialization, and 0104’s lease-revocation prepare step is inconsistent with its abort claim. The PRAGMA fallback is consistently mentioned but consistently insufficient to preserve the stated non-freelist billing basis.

**Verdicts (round 5):** 0103 NOT READY · 0104 NOT READY · 0105 NOT READY · SET NOT READY. Concerns 1–4 {IN-DELTA} MATERIAL, 5 {IN-DELTA} detail; no PRE-EXISTING concern.

---

## Round 6 (delta) — 2026-07-28 (/llp-super-refine) — CONVERGED

- **Entry revision hashes (revision 6):** 0103 `0bb0859b` · 0104 `f1b4a06d` · 0105 `f0e7c43d`.
- **Instruction hash:** `57dfbe28` (`/tmp/sr6/instruction.md`; delta enumerated).
- **Runtime:** OpenAI Codex CLI 0.145.0 / GPT-5 (`gpt-5.6-sol`), `--sandbox read-only`.
- **Blindness:** launched concurrently with the round-6 Fable review; instructed to exclude `llp/reviews/`; sealed until both landed.

## Overall assessment

The revision-6 delta resolves the prior MATERIAL concerns. The participant-set freeze, lifecycle serialization, publication-time revalidation, and durable freeze/commit/abort lease semantics now form a coherent safety contract across the set. The storage-headroom and PRAGMA billing-basis fixes also landed consistently. Method: reviewed the current targets and governing context without reading `llp/reviews/`.

## Concerns

1. **[detail] {IN-DELTA} Post-publication participant recovery should be explicit.** In LLP 0103 §App-wide multi-coordinator transfer protocol and LLP 0104 §Authoritative account-budget protocol, a coordinator may acknowledge `PREPARED` and then become unavailable after ownership publication but before processing `commit`. Safety is preserved because admission remains paused and the global ownership interval has already advanced, but the documents should explicitly require durable redelivery/reconciliation of `COMMIT`, with the coordinator remaining fail-closed until it records the committed epoch and obtains a new-owner lease. LLP 0105 P0.4 should inject this failure point and Gate 1 should require convergence.

2. **[detail] {IN-DELTA} Gate 0 should name PRAGMA availability directly in its exit checklist.** LLP 0105 P0.4 correctly makes missing `page_count`/`freelist_count`/`page_size` support a Gate-0 failure and forbids `databaseSize` as a billing fallback. The consolidated §Gate 0 checklist only implies this through successful logical-storage measurement and reconciliation. Add an explicit bullet that all three PRAGMAs were verified or the DO-SQLite billing basis failed the gate.

3. **[detail] {PRE-EXISTING} Missing-sample credit detection remains underspecified.** LLP 0104 §Defining billable “logical SQLite bytes” says a later true sample can reveal an overcharge, but endpoint samples generally cannot reconstruct the time-weighted path through a missing interval. LLP 0105 P0.4 appropriately assigns estimator inputs, bounds, and customer-favorable settlement to Gate 0; the resulting receipt should state exactly what evidence can establish an overcharge and how intervals that remain unknowable are conservatively settled.

## Cross-document consistency

The three documents now agree on the transfer participant snapshot, serialization of create/delete/restore, publication revalidation, prepare-time lease freezing, commit-time revocation/epoching, abort restoration with acknowledgements, and the narrowed invariant of no partial ownership attribution. They also agree that index/system-table pages are in-band allocated non-freelist bytes, that headroom contains only PITR/compaction-allocation slack/safety margin, and that `databaseSize` is cross-check-only while missing PRAGMA support blocks the billing basis. No MATERIAL cross-document contradiction remains.

**Verdicts (round 6):** 0103 READY · 0104 READY · 0105 READY · SET READY. No MATERIAL concerns; three detail items (Gate-0/implementation-owned). **Dual-READY with the Fable family → loop converged on revision 6.**
