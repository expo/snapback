**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-review
**Date:** 2026-07-24
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0081 reviews — GPT family

## Round 1 — 2026-07-24

## 1. **Overall assessment**

This is the right problem and broadly the right architecture: migrations become reviewed, content-addressed operations executed by the durability owner—not incidental startup DDL or arbitrary scripts. The exclusive first profile is appropriately conservative.

It is not yet spec-level sound. Several load-bearing formats remain undefined, the proposed publication events conflict with the existing journal grammar, crash recovery does not fully preserve the barrier, rollback is unsafe around external effects, and LLP 0063 creates a circular acceptance gate. LLP 0081 should remain Draft while these are reconciled.

## 2. **Strengths**

- **Honest initial scope.** §1 limits V1 to an exclusive single-writer profile and explicitly rejects zero-downtime, multi-writer, arbitrary-code, and cross-engine claims.

- **Good authority decomposition.** §2 correctly separates immutable plan authority from mutable preview observations and makes constants explicit rather than deriving time or randomness during apply.

- **Portable migration language.** §3’s closed typed steps, add/copy/publish/retire model, and privileged bounded keyset scan preserve LLP 0007’s portability boundary without smuggling in SQL or JavaScript.

- **Durability-owner execution.** §§1 and 4 correctly reject a long-lived CLI process and recognize Durable Object eviction as normal operation requiring durable progress.

- **Strong publication direction.** §4’s shadow generations, one publication boundary, and predecessor authority until verification are the right foundations.

- **Independent verification.** §5’s distinction that a digest without a predecessor-derived expected value is “inventory, not proof” is excellent.

- **Operational breadth.** §§6–7 address retained work, rollback boundaries, backups, rehearsals, target identity, and secret custody rather than treating migration as DDL alone.

- **Adversarial acceptance intent.** The Acceptance section includes crash injection, corruption oracles, wrong-target refusal, incompatible artifacts, rollback limits, and rehearsal isolation. The problem is primarily whether the current semantics can make those tests meaningful.

## 3. **Concerns**

1. **HIGH — LLP 0063 and LLP 0081 form a circular Step 5 gate.** LLP 0063 Workstream 6 and its Sequence table require accepted LLP 0080/0081 semantics **and executable witnesses** before migration implementation may enter Step 5. LLP 0081 Acceptance requires the implemented executor corpus and Step 5 application witness before the RFC may become Accepted. There is no valid ordering.

   **Resolution:** Separate semantic acceptance from implementation/profile graduation. Accept the normative RFC before implementation begins; move executable corpus completion and the cumulative Step 5 application witness to an `Implemented` transition or LLP 0063’s Step 5 exit gate.

2. **HIGH — Canonical plan and preview determinism are not precisely defined.** §2 does not identify a normative byte encoding, domain separator, map/number/Unicode rules, planner tie-breaks, or step-ID derivation. The hash boundary is also ambiguous because only `planId` is explicitly excluded from the “plan body,” while the serialized artifact carries both digest and ID. Acceptance’s claim that an entire preview is byte-identical contradicts `MigrationPreviewObservationV1`, which contains mutable target head, time, and health.

   **Resolution:** Define `MigrationPlanArtifactV1 { body, planDigest, planId }`, with neither outer field in `body`; use a named canonical encoding—preferably the existing RFC 8785/JCS posture from LLP 0062—plus domain separation and golden vectors. Make execution strategy and proof method canonical plan fields. Require only plan bytes to repeat; observations should be separately canonical and snapshot-pinned, not repeat-identical.

3. **HIGH — Approval and exact target fencing are under-specified.** §2 says approval retains the observation digest, but its enumerated approval fields omit that digest. Open Question 3 leaves the authenticated carrier unresolved even though Acceptance requires unauthenticated approval refusal. A file path cannot itself be hosted authority. “App, instance, target profile” also does not explicitly bind LLP 0072’s `projectId`, `targetId`, `environmentId`, `deploymentId`, `releaseId`, `activationGeneration`, `databaseId`, `streamIncarnation`, `targetProfileId`, and `operationId`; the CLI even spells `--target <profile>`, conflating a target with a profile.

   **Resolution:** Define an authenticated `MigrationApprovalV1` over plan digest, observation digest, policy digest, complete target audience, approver, issue/expiry, and one-operation identity. Define a barrier-time `MigrationAdmissionV1` binding the actual head and enforced bounds. Distinguish `planId` from `operationId`, target ID from profile ID, and static semantic-capability digest from dynamic health.

4. **HIGH — The core content-proof construction is still an open question.** §5 makes cross-target expected-versus-actual digests authoritative, while Open Question 2 leaves the digest algorithm unresolved. Row framing, table/domain separation, key order, absent versus null, decimals/floats, JSON ordering, counts, schema/generation identity, and system fields are all load-bearing. Sampling is knowingly allowed to miss corruption outside the sample while still participating in a successful receipt.

   **Resolution:** Specify `ContentDigestV1` before acceptance, preferably as a resumable streaming or Merkle digest over canonically ordered logical rows, binding algorithm, plan, schema, table, generation, row count, barrier head `H`, publication version `P`, and timestamp `T`. Require full proof for successful V1 production migrations. Treat sampling as a separately named audit-assurance class, not proof of complete preservation.

5. **HIGH — LLP 0080 and LLP 0081 currently require incompatible projection oracles.** LLP 0080 §§5–6 require the rebuilt table to byte-equal `materializeAll(core, V)` at pinned source version `V`. LLP 0081 §4 publishes at successor version `P` and stamps changed or synthesized rows with `P` and `publicationTimestamp`; its digest includes system fields. Both byte-equality claims cannot hold as written.

   **Resolution:** Either parameterize the oracle as `materializeAll(core, sourceHead=H, publicationVersion=P, publicationTimestamp=T, predecessorMetadata)`, or use separate logical user-value and physical system-field digests. Amend both RFCs together and run the coupled suite against that exact proof domain.

6. **HIGH — Publication events conflict with the governing journal and client protocols.** §§4 and 6 introduce `schema-resync` and `rollback-resync` journal events. LLP 0007 §Commit-version graduation treats unknown operations as corruption and requires exact journal-high-water equality with head. LLP 0081 promises only to amend LLP 0007’s deferred/status sections. Moreover, a generic resync plus retention-floor raise does not satisfy LLP 0053’s schema/function activation obligations: auth-scoped state requires durable quarantine/delete dispositions, fences, and acknowledgement semantics.

   **Resolution:** Normatively extend LLP 0007’s journal grammar—or define a separate schema-transition journal and amend the head/cut invariant. Define the migration handshake, old-client refusal, pruning, decoder upgrade, and mixed-reader behavior. Final publication must atomically fire LLP 0053 activation obligations. Acceptance must cover connected and cold-retained clients, dropped signals/ACKs, restart, forward publication, and rollback. Add LLPs 0008, 0012, 0043, and 0053 to `Related`.

7. **HIGH — The crash model does not prove that the barrier survives recovery.** §4 says a pre-publication crash “reopens the predecessor” and later resume reacquires the barrier. It does not state that ordinary application admission remains durably blocked between reopen and resume. An intervening predecessor commit would make a partially built shadow stale. “Progress advances only after writes commit” also does not establish atomicity between shadow writes, cursor, digest accumulator, and journal state. Cancellation is claimed in §1 but has no commands, journal states, terminal receipt, or acceptance cases.

   **Resolution:** Specify a complete durable state machine and fencing token. Every query, mutation, subscription, job, and worker lane must consult a persisted migration-admitted fence before opening. Commit each batch’s writes, cursor, digest state, and journal transition atomically or define idempotent replay. Add `cancel_requested/aborting/cancelled`, cleanup states, and fault injection inside every durable transition—not only at batch boundaries. Clarify that failed preflight may write internal journal/checkpoint state while performing no application DDL/DML.

8. **HIGH — Control-plane and resident-executor ownership do not yet compose.** LLP 0072 owns deployment leases, activation generations, backups, and traffic switching; LLP 0081 independently introduces an app migration lease, resident executor, and backup creation. Lock ordering and cross-authority crash recovery are unspecified. §4 also says function identities publish in the storage transaction, while §6 and LLP 0072 expect the new release to activate later; that is impossible if “function identity” means traffic-active release identity.

   **Resolution:** Define one controller/executor protocol under LLP 0072’s `operationId`: deployment lease first, exact activation/database/stream fence, subordinate app-local lease, barrier-consistent backup token and verified manifest, resident execution, then receipt consumption before traffic activation. Distinguish staged/compatible function identities stored with the database from control-plane traffic activation.

9. **HIGH — “Zero successor commits” is not a safe fast-rollback guard.** §6 releases retained work at publication but permits predecessor republish while the application head still equals the publication boundary. Jobs, webhooks, notifications, payments, and actions can successfully or ambiguously issue external effects without advancing that head. This rollback is also not represented by LLP 0072’s `codeOnly`, `forwardFix`, `restoreRequired`, or `blocked` postures; LLP 0072 explicitly says rollback does not silently rewind data.

   **Resolution:** Prefer restricting fast republish to a maintenance-mode, pre-traffic, pre-worker activation window. Otherwise introduce a durable successor-activity/effect epoch advanced before every invocation, claim, or egress attempt, and require it unchanged under a full worker fence. Amend LLP 0072 with an explicit generation-republish posture and test both successful and ambiguous no-commit effects.

10. **HIGH — Fast rollback breaks row version semantics unless it constructs a new generation.** Republishing retained predecessor rows at rollback version `R` would expose user-visible changes while preserving their old `_version` and `_updatedAt`, contradicting LLP 0007’s rule that `_version` is the commit that last changed the row. Conversely, byte-equality with the pre-migration checkpoint cannot hold if those fields are correctly restamped.

    **Resolution:** Define a rollback expected-value evaluator. Rows whose visible content changes from successor to predecessor receive `_version=R` and an explicit rollback timestamp; unchanged rows preserve system fields. Compare against that derived digest, not raw checkpoint bytes. Admission must also reserve sufficient commit-version budget: a forward publication at `MAX_SAFE_INTEGER` cannot later allocate `R`.

11. **MEDIUM — Retained-work and old-client compatibility claims exceed the owned semantics.** `empty` cannot be proven for disconnected client outboxes. `transformed` has no corresponding typed step or subsystem adapter, and LLP 0070 requires immutable job arguments to migrate by creating a linked successor job and terminally disposing the predecessor. Under `successor-only`, an incompatible old client cannot necessarily take the promised successor resnapshot.

    **Resolution:** Separate server-resident work from client-custodied mutation queues. For V1, admit only `empty` and proven `dual-compatible`, or require versioned adapters from each owning subsystem. Make client behavior posture-aware: compatible resnapshot, stable upgrade-required refusal with quarantine/stranding, or a closed proven transform. Test a predecessor offline mutation through resync-before-replay and settlement.

12. **MEDIUM — Allowed commit drift is not fully bounded by what the operator approved.** A migration preview may show a small population, but apply can run later against much more data while still satisfying semantic preconditions. The fixed `publicationTimestamp` can also be older than a row updated after preview, moving `_updatedAt` backward.

    **Resolution:** Put every approval-relevant row/byte/write/downtime maximum into the canonical plan as a barrier-time admission precondition. Exceeding it requires re-preview and reapproval. Require `publicationTimestamp >= max(_updatedAt)` for every changed predecessor row, or define another deterministic timestamp rule. Add drift fixtures for both resource growth and timestamp regression.

13. **MEDIUM — Synthesized IDs do not yet satisfy LLP 0007’s UUIDv7 contract.** “`planId` plus source-row identity” lacks an algorithm and destination/step/output domain separation. It can collide across tables or steps and need not produce a valid UUIDv7.

    **Resolution:** Pin a deterministic UUIDv7-compatible construction with conformance vectors, including plan digest, step ID, source table/key, destination table/generation, output ordinal, and approved timestamp; otherwise explicitly amend LLP 0007.

14. **MEDIUM — Local Step 5 acceptance is ambiguously coupled to unsupported hosting.** §1 includes the trusted hosted minimum in the first executable profile, and the acceptance reconciliation says to record which hosted target first passes. LLP 0072 states that profile remains unsupported until a first adapter is selected and witnessed.

    **Resolution:** Make the local SQLite exclusive profile the Step 5 admission profile. Admit each hosted executor later as a separately versioned LLP 0072 conformance profile; hosted evidence should not block semantic acceptance of the local migration contract.

15. **LOW — Coupled-corpus references and Cloudflare scheduling need cleanup.** LLP 0080 §6 still says “0074’s rebuild corpus uses 0075’s executor,” although the root LLP records that these documents were renumbered to 0080/0081. LLP 0081’s alarm-resumed executor also does not explicitly compose with LLP 0014’s one-alarm, one-dispatcher rule.

    **Resolution:** Correct the coupled references and give the combined suite a stable gate ID. Require migration wakeups to register with the shared Durable Object alarm dispatcher and add eviction/scheduler-contention tests.

## 4. **Suggestions**

- Model the workflow as four separately hashed records: immutable `PlanBody`, mutable snapshot-pinned `PreviewObservation`, authenticated `Approval`, and barrier-time `Admission`.

- Consider bumping `streamIncarnation` for every representation-changing V1 migration. It is more disruptive to retained caches, but dramatically simplifies cursor invalidation and avoids overloading the row-change journal before schema-transition events are fully specified.

- Use two-phase activation: stage and prove at `H`; publish storage at `P` into `activationPending`; switch the release; then release traffic and workers. This gives fast rollback a naturally safe window.

- Separate immutable publication, rollback, and cleanup receipts from mutable operation-status inspection. A receipt should never change because later cleanup advances.

- Require shadow generations for all data-transforming or constraint-tightening operations in V1. Reserve in-place execution for metadata/index operations whose rollback and crash semantics are independently trivial.

- Reuse LLP 0037’s Rust-owned schema machinery for plan, observation, approval, admission, journal, and receipt types, with committed schemas and golden digest vectors.

## 5. **Open questions**

1. Does `Accepted` mean semantic authority ready for implementation, or implementation complete? LLP 0063 and 0081 must choose one model consistently.

2. What exact canonical encoding and `ContentDigestV1` construction govern plans, rows, tables, projections, and receipts?

3. Is sampled verification ever sufficient for a successful production migration, or only for a lower-assurance rehearsal/audit result?

4. Should V1 use typed schema-transition events in the existing stream, or conservatively bump `streamIncarnation`?

5. Is fast predecessor republish permitted only before traffic/worker activation, or will the system introduce a durable effect/activity fence?

6. Which retained-work classes actually belong to Step 5, and which require the Step 6 job, payment, notification, or webhook authorities?

7. What is the precise approval carrier—signed single-use statement or opaque control-plane record—and what are its replay/revocation semantics?

8. Which exact release/function/client generations must remain compatible under each deployment posture?

9. Which hosted adapter, if any, should be the first separately admitted migration-executor profile?

## 6. **Verdict**

Verdict: NOT READY

The proposal has a strong core architecture, but multiple HIGH and MEDIUM blockers make its approval, publication, proof, crash recovery, retained-client, and rollback guarantees internally inconsistent or presently unwitnessable.
## Round 2 — 2026-07-24

**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only; non-interactive `codex exec` orchestrated by /llp-review. Reviewed the round-1-reconciled revision; permitted to read its own round-1 artifact only.

# LLP 0081 Round-2 Review

Reviewed against stable SHA-256 `1140fdda644260a0e8e7f59a4e1a45f29c2ad565f86cd40671bbcdabdbb4ecb1`.

## 1. Per-concern resolution table

| # | Round-1 concern | Resolution | Justification |
|---|---|---|---|
| 1 | Circular LLP 0063 / LLP 0081 Step 5 gate | **RESOLVED** | LLP 0081 §Acceptance separates semantic acceptance from implementation conformance and expressly authorizes implementation after acceptance, yielding a valid Accepted → implement/witness → Step 5 ordering consistent with LLP 0063 §Workstream 6 and §Sequence. |
| 2 | Canonical plan and preview determinism | **PARTIALLY RESOLVED** | LLP 0081 §2 defines the artifact/body split, JCS, domain separation, canonical strategy/proof fields, and snapshot-pinned observations, but still lacks normative planner/step-ID derivation and exact prefix-plus-body preimage framing. |
| 3 | Approval and exact target fencing | **PARTIALLY RESOLVED** | LLP 0081 §2 adds observation/policy digests, `operationId`, admission fencing, and most LLP 0072 identities, but omits `releaseId` from LLP 0072 §Identities and objects and leaves carrier, replay, and revocation semantics open in LLP 0081 Open Question 3. |
| 4 | `ContentDigestV1` construction | **PARTIALLY RESOLVED** | LLP 0081 §5 now requires full production proof and demotes sampling, but does not define the exact metadata/row framing, accumulator serialization, system-field stream, or scalar encoding needed for LLP 0007’s full numeric value domain. |
| 5 | LLP 0080/0081 projection-oracle incompatibility | **RESOLVED** | LLP 0080 §§5–6 and LLP 0081 §§4–5 now share the split logical-row/system-field oracle with explicit publication parameters. |
| 6 | Publication events versus journal/client/auth protocols | **PARTIALLY RESOLVED** | LLP 0081 §4 defines typed resync events, retention-floor publication, and LLP 0053 obligations, but current LLP 0007 §Commit-version graduation still treats unknown operations as corruption and contains none of the promised event grammar or revised cut invariant. |
| 7 | Crash recovery, durable barrier, and cancellation | **PARTIALLY RESOLVED** | LLP 0081 §4 adds a persisted fence, atomic batch progress, `published-held`, and cancellation states, but no exhaustive transition/fencing-token contract exists and post-publication cancellation remains contradictory with §6. |
| 8 | Control-plane and resident-executor ownership | **RESOLVED** | LLP 0081 §4 now supplies the LLP 0072 lock order, shared `operationId`, subordinate migration lease, control-plane-owned backup, resident execution, and staged-function versus traffic-activation split. |
| 9 | Unsafe “zero successor commits” rollback guard | **PARTIALLY RESOLVED** | LLP 0081 §§4 and 6 correctly require `published-held` with every effect lane fenced, but the required generation-republish posture has not been added to LLP 0072 §Migrations and rollback. |
| 10 | Fast rollback row-version semantics | **RESOLVED** | LLP 0081 §6 allocates rollback version `R`, reserves version capacity, restamps changed rows, preserves unchanged rows, enforces rollback-timestamp monotonicity, and verifies a derived rollback oracle. |
| 11 | Retained-work and old-client compatibility | **RESOLVED** | LLP 0081 §§4 and 6 separate server-resident work from client queues, restrict V1 to `empty`/proven `dual-compatible`, defer transforms to subsystem owners, and define resnapshot versus upgrade-required quarantine. |
| 12 | Approval-relevant drift bounds | **PARTIALLY RESOLVED** | LLP 0081 §§2 and 4 close population and timestamp drift, but the newly approved maximum barrier downtime is only called an admission precondition and has no enforceable runtime deadline. |
| 13 | Synthesized UUIDv7 IDs | **PARTIALLY RESOLVED** | LLP 0081 §3 now pins UUID version/variant and digest-derived bits, but does not refuse or encode `publicationTimestamp` values exceeding UUIDv7’s 48-bit time field despite LLP 0007 §Timestamps admitting larger values. |
| 14 | Local Step 5 coupled to unsupported hosting | **RESOLVED** | LLP 0081 §1 and §Acceptance make local SQLite the Step 5 profile and gate every hosted adapter separately under LLP 0072. |
| 15 | Coupled references and Cloudflare scheduling | **RESOLVED** | LLP 0080 §6 names the corrected RFCs and shared suite; LLP 0081 §1 uses LLP 0014’s shared alarm dispatcher and Acceptance covers eviction/contention. |

## 2. New concerns

1. **HIGH — Generic migrations bypass authority-bearing-table write contracts.** LLP 0081 §§3–5 admits generic copy/backfill/retire operations without mapping them to LLP 0056’s central membership-writer carrier, transition/provenance log, `lastHolder`, and final-state validation requirements (§Declaring a membership table, §Writes, §Invalidation). Resolve by defining a `hostOps:migrate` writer class with full subsystem validation and provenance, or refusing authority-bearing tables.

2. **HIGH — The durable fence’s explicit lane list is narrower than fast rollback requires.** LLP 0081 §4 names query, mutation, subscription, job, and worker lanes, while §6 relies on actions, cron, webhooks, payments, notifications, and other external-effect/ephemeral sinks remaining closed after crashes. Resolve with a closed capability-derived lane registry and crash tests for every admitted invocation, writer, and egress lane.

3. **MEDIUM — Idempotence is inconsistently keyed by plan and operation.** Section 2 permits separate approvals and `operationId`s for one plan, while §4 says replaying the same completed plan returns its previous receipt. Resolve by keying admission, replay, cancellation, journal lookup, and receipt recovery to the exact approved `operationId` and audience.

4. **MEDIUM — Cancellation from `published-held` is undefined.** Section 4 makes `published-held` nonterminal, while Acceptance requires cancellation from every nonterminal state to end as `cancelled`; §6 instead requires an audited rollback to leave the successor. Resolve by excluding post-publication states from cancellation, defining cancellation as successor release, or routing it through rollback and its receipt.

5. **MEDIUM — Storage and traffic activation generations are conflated.** Section 4 correctly leaves LLP 0072 traffic activation separate, but §6 says republishing advances the predecessor “schema/activation generation,” whereas LLP 0072 defines `activationGeneration` around traffic authority. Resolve with a distinct `schemaGeneration` or `storageGeneration`.

6. **MEDIUM — Fast rollback omits LLP 0053 activation obligations.** Section 6 reactivates predecessor schema/functions but specifies only `rollback-resync`; LLP 0053 §The authorization-event universe requires schema/function activation to fire event 2 atomically. Resolve by projecting the full authorization/room obligations during rollback and testing dropped delivery/acknowledgement.

7. **MEDIUM — Approved maximum downtime is not enforceable.** Section 2 cannot prove future elapsed downtime at admission, while §§4 and 8 merely measure it. Resolve by defining the measured interval, a durable deadline checked at every wake/batch/publication, safe pre-publication abort behavior, and slow/crash fault fixtures.

## 3. Verdict

Verdict: NOT READY

Multiple HIGH and MEDIUM blockers remain in authority-bearing writes, fencing, approval/proof formats, governing-corpus amendments, operation identity, rollback activation, cancellation, and enforceable downtime.