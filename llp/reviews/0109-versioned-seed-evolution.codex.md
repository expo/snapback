# LLP 0103 review — Codex family

## Round 1 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule  
**Target SHA-256:** `82e7c47985f2d3673297b227a59e1de9e701c6456c2f65c72247c96d2cb31d11`  
**Capsule SHA-256:** `77703203ed7f541c7d813626f8c4e400f5188a9c4c61dbcd2b10f97d61ffa5be`  
**Instruction SHA-256:** `c134524e6c55b71e4fa50dbacc4a35af311c1c8f97cc7f7d5f02fc81736c55eb`  
**Status:** completed — NOT READY  
**Thread ID:** `019fa620-936c-7061-b108-d8c0435ca069`  
**Review body:** preserved verbatim below.

## 1. Overall assessment

LLP 0103 has the right conservative direction: explicit versioned operations, no legacy downgrade, stream-scoped identity, atomic installation, and no implicit adoption. It is not ready, however. Material gaps remain in predecessor safety, state classification, durable history, receipt lifecycle, migration/restore coherence, sessions startup, derived writes, authorization, and target-honest acceptance.

## 2. Strengths

- Versioned install is a distinct closed intent instead of widening legacy `provision`.
- Legacy seed-if-empty behavior and response vocabulary are preserved explicitly.
- Authorization and complete artifact validation precede identity or occupancy disclosure.
- Installed seed rows correctly become ordinary mutable application data; repeated ensure does not reconcile fixtures.
- Seed evolution cannot substitute for a reviewed migration.
- Identity, rows, authorization effects, and receipts are intended to share one transactional boundary.
- The acceptance section includes concurrency, restart, fault injection, legacy compatibility, and multiple serving surfaces.

## 3. Concerns

### 1. Destructive reset is neither predecessor-safe nor replay-safe

**Severity: MATERIAL**

**Evidence:** Section 3.3 calls the reset variants capability-gated but defines only `supportedEnsureProtocols`, without naming a reset capability, exact HTTP paths, or host-operation names. The current hosted gateway discards reset bodies before forwarding ([gateway.js](/private/tmp/snapback-llp0103-r1.pFmWF1/cloudflare/src/gateway.js:163)); the old coordinator then performs a destructive reset regardless of the proposed discriminants ([coordinator.js](/private/tmp/snapback-llp0103-r1.pFmWF1/cloudflare/src/coordinator.js:1460)). The multiplexed projection is also unsafe: `HostOpsRequest` is open ([host_ops.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/host_ops.rs:358)), nested `SeedData` ignores unknown artifact members ([manifest.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/manifest.rs:3733)), and old `app.reset` consumes that legacy projection ([server.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/server.rs:15533)). Neither reset request nor receipt has an operation identifier, so retry after a lost response rotates streams and resets again.

**Resolution criteria:** Name every direct and multiplexed operation. Use predecessor-unknown routes/operation names, or define an equally strong live reset-capability witness that guarantees rejection before effects. Add a client operation ID, canonical request digest, predecessor-stream binding, and durable replay result. Test raw requests, stale capability observations, response loss, and concurrent retries against the actual unmodified local and hosted predecessors.

### 2. The pre-bind startup carrier is missing and can silently downgrade to legacy seed

**Severity: MATERIAL**

**Evidence:** The spec grants `install` to pre-bind startup authority and requires startup acceptance, but defines only the HTTP request. The current closed `StartupArtifacts` carrier still embeds open `SeedData` ([mode.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/auth/mode.rs:329)). Putting `SeedArtifactV1` there lets an old reader ignore `formatVersion`, `appId`, `seedVersion`, and `seedDigest`, then apply `.tables` as untracked legacy seed. LLP 0058 additionally requires fresh sessions provisioning to use a stage transaction followed by a consume transaction; §6.2 instead describes one undifferentiated install transaction.

**Resolution criteria:** Define a new closed startup-carrier version or discriminated seed union that predecessors reject before effects. Specify how rows, identity, receipt, staged deployment, and pending mode are committed in LLP 0058’s stage transaction, followed by catalog activation in the consume transaction. Cover crashes between transactions, restart without reseeding, quarantine, and old-carrier compatibility, and require an LLP 0058 amendment.

### 3. Empty authored arrays can bless populated target data

**Severity: MATERIAL**

**Evidence:** Section 1 defines every table key as a seed target, including keys whose authored arrays are empty. Section 5.1 then says a map whose arrays are all empty is `uninstalled-empty` whenever identity is absent. Consequently, `{ "tables": { "todos": [] } }` over a populated `todos` table can write identity over existing rows—the forbidden adoption transition.

**Resolution criteria:** Only a truly empty `tables` map may classify vacuously. Every named target, including one with `[]`, must use actual barrier-time occupancy. Add all-nonempty and partial matrices for empty-array targets and prove zero effects on refusal.

### 4. Runtime-definitive version history is not represented durably

**Severity: MATERIAL**

**Evidence:** Section 2.2 says the runtime remains definitive when generated history is unavailable. The durable design stores only the active identity and latest receipt. After `v1/A → v2/B`, the runtime cannot detect a later `v1/C`; clear and legacy reset erase even the active evidence. This contradicts the unqualified `SNAPBACK_SEED_VERSION_REUSED` guarantee.

**Resolution criteria:** Define a protected durable `(appId, seedVersion) → seedDigest` history with explicit lineage, reset, clear, backup, restore, and migration semantics, updated atomically by every admitting operation. Alternatively narrow the uniqueness guarantee and diagnostic to the active stream. Acceptance must cover reuse after multiple evolutions, reset, clear, restore, and a clean checkout.

### 5. The response and receipt model is contradictory and lifecycle-incomplete

**Severity: MATERIAL**

**Evidence:** Section 3.1’s success DTO returns an observation plus `receiptDigest`, but no receipt body; §4.2 says success returns the receipt body and digest. For `matched`, the displayed `commitVersion` is the current head while the digest identifies an older establishing receipt. The receipt vocabulary lacks restore and generation-republish operations even though restore re-scopes identity and fast migration rollback restores predecessor identity. That leaves the latest `migration/evolved` receipt inconsistent with the restored identity, which §5 classifies as corrupt. The valid relationship between absent identity, a retained `cleared` receipt, and other receipt states is also unspecified.

**Resolution criteria:** Define exact, separate DTOs for operation observation, current head, durable receipt, and receipt digest. Add closed restore/rebase and rollback-republish semantics, or another truthful lineage model. Specify every valid identity/receipt pair and global corruption behavior. Test matched-after-restore, fast rollback, reverse migration, clear, restart, and injected failure at every metadata boundary.

### 6. `seedTransition` is not an implementable canonical LLP 0081 extension

**Severity: MATERIAL**

**Evidence:** Section 7.2 shows untyped `{}` placeholders, never defines the serialized `unchanged` variant, and alternates between identities and “complete seed artifacts.” The current `MigrationPlanBody` is a closed `migration-plan-v1` object with no extension point ([migration.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/migration.rs:471)). Receipts and rollback journals likewise do not bind a seed transition. There is also an internal contradiction: §2.1 permits a version-only change and says it can migrate, while §7.2 and §12.3 forbid metadata-only advance.

**Resolution criteria:** Introduce an explicitly versioned plan schema with exact `unchanged` and `evolve` shapes, absence representation, identities/artifact digests, stream constraints, plan-digest vectors, journal events, receipt fields, and predecessor rejection behavior. Decide whether equal-content version changes permit a no-DML evolve proved against an installed predecessor or are reset-only, then align all sections and tests.

### 7. Reset and additive provisioning semantics do not cover the claimed schema cases

**Severity: MATERIAL**

**Evidence:** `resetInstall` carries only seed, but §7.1 says a changed seed “with or without schema change” may use reset. It cannot atomically install an incompatible successor schema/functions/routes pair. For ordinary install, occupancy is read before DDL even when a candidate seed target does not yet physically exist. Section 6.2 covers only `uninstalled-empty`, despite §7.1 also allowing installed/matched seed plus additive schema. The current implementation applies schema, functions, routes, and seed sequentially ([local.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/local.rs:4512)), so the promised atomic seam does not currently exist.

**Resolution criteria:** Either carry the complete successor pair through destructive reset or restrict reset-install to the installed pair. Define read-only physical collision/absence classification for candidate tables, an atomic fresh/additive provisioning seam, and a separate installed/matched-plus-additive transition that does not churn seed metadata. Fault-inject every branch and publication boundary.

### 8. Maintained projections are omitted from seedability and the transaction

**Severity: MATERIAL**

**Evidence:** LLP 0080 requires source and projection writes in one transaction and commit version, under the aggregate 1,024-write bound, and forbids direct application writes to projection outputs. Section 6.2 contains no projection maintenance. The current raw seed path bypasses projection maintenance ([storage.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/storage.rs:9731)), while ordinary buffered mutations invoke it separately ([storage.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/storage.rs:3589)).

**Resolution criteria:** Derive seedability from the complete candidate projection graph, refuse output-table targets, and maintain projections for seeded source rows in the same transaction. Define whether `changedCount` includes derived writes and ensure the authorization hook receives the complete change set. Test fan-out ceilings, direct-output refusal, rollback, and candidate-publication failure. Add LLP 0080 to §14.

### 9. The hosted seed authority conflicts with the compiled-seed invariant

**Severity: MATERIAL**

**Evidence:** LLP 0040 requires hosted `/app/ensure` never to consume caller seed bytes; the current coordinator compares against and then applies only the compiled seed ([coordinator.js](/private/tmp/snapback-llp0103-r1.pFmWF1/cloudflare/src/coordinator.js:4437)). LLP 0103 validates a supplied artifact but does not say whether the hosted arm must match it to and apply a compiled artifact. Section 14 does not require an LLP 0040 amendment.

**Resolution criteria:** Explicitly preserve the compiled-seed rule—caller bytes may attest identity but cannot be the production write source—or formally amend LLP 0040 with an equivalent clean-object-race proof. Add malicious caller seed, compiled mismatch, rollout rollback, and clean-object concurrency cases.

### 10. Membership and generic permission-backing tables are conflated

**Severity: MATERIAL**

**Evidence:** Section 8 assigns both categories to LLP 0056’s `privileged(seed)` writer and its role/provenance checks. They are distinct schema mechanisms: ordinary `permissionBacking` tables have no membership vocabulary ([manifest.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/manifest.rs:394)). The current raw seed path performs generic inserts without membership provenance, while provenance is written through the sanctioned buffered membership path. Generic permission-backing changes are instead classified by the authorization hook ([authorization.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/storage/authorization.rs:99)). In sessions mode, protected `lastHolder` insertion additionally requires a pre-existing recoverable catalog principal, even though seed cannot create that catalog.

**Resolution criteria:** Specify separate paths for generic permission-backing and declared membership tables. Add a bulk, in-transaction `MembershipWriter::Seed` primitive with provenance and final-state validation; route generic permission-backing inserts through ordinary validation plus the authorization hook. Define provider/principal bootstrap ordering and test absent, deactivated, stranded, and valid holders.

### 11. Authorization precedence and diagnostic redaction conflict with governing behavior

**Severity: MATERIAL**

**Evidence:** Section 9 says malformed closed requests win before authorization. The centralized gate intentionally extracts only the discriminant, authorizes recognized operations, and strongest-gates indeterminate bodies before typed extraction ([server.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/server.rs:7756), [server.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/server.rs:10321)), as required by LLP 0031. Separately, LLP 0103 says diagnostics never echo membership principals, while current membership refusals include principals in both messages and details ([storage.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/storage.rs:11761)).

**Resolution criteria:** Distinguish generic JSON/framing failures from detailed closed-DTO validation. Recognizable and indeterminate effect-bearing requests must receive the required gate before shape, artifact, digest, or state details. Define a seed-specific diagnostic projection that removes principals, resources, rows, paths, and secrets from responses, logs, and receipts. Test unauthorized malformed bodies and secret-like membership values; reconcile LLP 0031 and its sessions `AdminSecretRead` inspection boundary.

### 12. Acceptance is not yet finite or target-honest

**Severity: DETAIL**

**Evidence:** Section 12 names several surfaces but provides no case-by-surface inventory distinguishing required, unsupported, and not-applicable cases. That permits hosted or packaged checks to skip vacuously while the single protocol bit is advertised. It also names `snapback ensure --json`, but neither the native command enum ([cli.rs](/private/tmp/snapback-llp0103-r1.pFmWF1/src/cli.rs:645)) nor the packaged CLI currently has an ensure command, and rollout does not define one.

**Resolution criteria:** Add a machine-readable case-by-surface matrix with runner names, required capabilities, expected check counts, and non-vacuous skip rules. Require every applicable row before advertisement. Either specify the ensure command’s authority, target selection, dry-run, JSON, and exit-code contract with packaged tests, or remove the claim.

### 13. Receipt hashes do not establish host-tamper resistance

**Severity: DETAIL**

**Evidence:** `receiptDigest` is unkeyed SHA-256. Protected metadata prevents application-path writes, but an operator or filesystem/database editor can rewrite the receipt and recompute its digest. “Editing it is corruption” does not make such editing detectable.

**Resolution criteria:** State explicitly that host storage is trusted and the digest detects accidental or protocol-level inconsistency only, or introduce a sealed/MACed witness if host/database tampering is within scope.

## 4. Suggestions

- Define one exhaustive state table over active stream, identity, receipt, historical digest map, occupancy, migration fence, and requested operation.
- Require explicit stable `_id` values for versioned seed rows, or define deterministic ID derivation and migration semantics.
- Bind migration seed receipts to LLP 0081’s `operationId` and `planDigest`.
- Expand §14’s reconciliation set to include LLP 0031, LLP 0040, LLP 0053, LLP 0058, LLP 0059, and LLP 0080.
- Add concurrency cases for install versus reset, migration publication, restore, and generation republish.

## 5. Open questions

- Is `seedVersion` uniqueness scoped to a data stream, an app lineage across resets, or authored `appId` globally?
- Should an entirely empty `tables` map establish durable identity?
- Does reset-install replace the schema/function/routes pair or only data under the installed pair?
- Are generic `permissionBacking` tables intended to remain seedable?
- What exact receipt establishes identity after restore or fast rollback?
- Does seed metadata corruption fence all application effects or only seed/admin operations?
- Is operator/filesystem tampering inside the receipt-integrity threat model?

## 6. Readiness verdict

Not ready. The predecessor-reset hazard and empty-array adoption path are independently blocking. Durable history, receipt lifecycle, migration/startup composition, projection maintenance, hosted authority, and membership semantics also need normative resolution before implementation or capability advertisement.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; delta-round instructions  
**Target SHA-256:** `26066df9c4af0f2b92c18a355a0b2e3f22919fbf91ca83eb107448f5757851f1`  
**Capsule SHA-256:** `4042773db57c2cad47a7e1e48b4c2a1dd65aae7b7a93130a27100a692678f9b3`  
**Instruction SHA-256:** `20a368c9069f3d9c41ac906e58bb6133f87cca2cf3533e5df2690451da79408e`  
**Status before launch:** received

## 1. Overall assessment

LLP 0103 is materially stronger, especially around physical occupancy, no-adoption semantics, validation order, and client-side downgrade prevention. The ordinary fresh-install state machine is convincingly refusal-safe on paper.

It is not ready, however. I cannot confirm that every destructive or identity-establishing transition is non-destructive on refusal and implementable in the repository. Cross-mode cancellation/replay, reset recovery, predecessor compatibility, migration-v2, and restore/rollback still contain material gaps.

## 2. Strengths

- Every named seed target—including an empty-array target—is physically checked before identity can be established. Only a genuinely empty `tables` map is vacuously installable. [§5.1](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:580)
- The install transition table is closed and explicitly forbids adoption, force, partial completion, overwrite, and migration from untracked rows. [§5.2](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:604)
- Authorization, profile gating, complete pair/artifact validation, schema classification, function preparation, and barrier-time rereads precede durable effects. [§6.1](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:661)
- Projection maintenance, membership validation, the aggregate write ceiling, authorization hooks, identity, and receipts are correctly required in the installation transaction. [§6.2](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:688)
- Runtime reuse claims are honestly stream-scoped, while codegen history is limited to one committed predecessor rather than claiming nonexistent global lineage. [§2.2](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:189)
- Predecessor-unknown reset carrier names, capability preflight, and the prohibition on destructive legacy fallback are the correct client-side posture. [§3.3](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:374)
- Gate precedence and diagnostic redaction are unusually explicit and well aligned with the governing authority model. [§9](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:920)
- The acceptance rules reject zero-case, unknown-runner, and unexplained-skip capability claims, providing good vacuity protection. [§12](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:1062)

## 3. Concerns

### 1. High — MATERIAL — Cross-mode install recovery and cancellation are contradictory

**Evidence:** A sessions stage commits rows, projections, identity, receipt, and pending metadata before consume. All installs during `MODE_PENDING` then refuse, while the closed install request has no client operation ID or request digest. Consequently, a lost stage response cannot replay the committed receipt or become `matched`, despite the later claim that lost acknowledgements reconcile from durable identity and receipt. [Stage semantics](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:332), [pending refusal](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:344), [closed request](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:247), [acknowledgement claim](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:722)

The operator is also told they may cancel the pending transition. Current staging applies DDL and seed before writing pending state, while unstage merely deletes the staged manifest and restores settled availability; it does not undo DDL or rows. [Current stage](/private/tmp/snapback-llp0103-r2.591AvN/src/storage/auth_mode.rs:522), [current unstage](/private/tmp/snapback-llp0103-r2.591AvN/src/storage/auth_mode.rs:686), [LLP 0058 unstage](/private/tmp/snapback-llp0103-r2.591AvN/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:874)

The success DTO also cannot distinguish “durably staged but admission closed” from “active.” [Success DTO](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:260)

**Resolution criteria:** Define a client-stable operation identity/digest or separate recovery carrier, an exact duplicate-replay exception during pending state, and an explicit staged-versus-active response. Either forbid cancellation after an effectful versioned stage or make cancellation atomically restore the complete predecessor. Test lost responses, crash/reopen, cancel, correction, and identical/different retries in both mode directions.

### 2. High — MATERIAL — `resetInstall` is not closed over auth mode or membership bootstrap

**Evidence:** Cross-mode stage/consume rules apply only to `install`. `resetInstall` carries a complete pair but no `requestedMode`, and is described as one destructive transaction. That conflicts with LLP 0058’s mandatory two-transaction sessions transition and leaves settled, pending, quarantined, same-mode, and cross-mode behavior unspecified. [Reset DTO](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:398), [reset ordering](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:735), [LLP 0058 fresh sessions](/private/tmp/snapback-llp0103-r2.591AvN/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:854)

There is also an implementation contradiction for sessions membership seed. LLP 0103 requires a recoverable catalog principal before membership validation and forbids seed from creating that catalog. The existing reset deletes users, identities, sessions, and agent authority before inserting seed rows. [Seed principal requirement](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:894), [reset order](/private/tmp/snapback-llp0103-r2.591AvN/src/storage.rs:781), [catalog deletion](/private/tmp/snapback-llp0103-r2.591AvN/src/storage/auth.rs:1873)

**Resolution criteria:** Add a finite matrix covering operation × current mode state × active mode × successor-pair mode, including barriers, stage/consume, pending metadata, publication, retry, and inert refusals. Separately define how a successor recoverable principal survives or is rebuilt through its owning protocol, or explicitly refuse membership-bearing sessions reset-install before destructive effects.

### 3. High — MATERIAL — The reset journal does not model post-commit recovery or fully define its authority

**Evidence:** The Spec says the reset journal, reset boundary, and destructive work form one durability transaction and that exact retry merely returns the receipt. Existing reset still has fallible process-local work after commit: projection publication, issuer reconstruction, stream-ticket finalization, and—under LLP 0103—the prepared function/routes generation. Current failures in this interval return uncertainty and keep admission closed. [Target reset transaction](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:737), [post-commit publication](/private/tmp/snapback-llp0103-r2.591AvN/src/server.rs:15878), [post-commit failure](/private/tmp/snapback-llp0103-r2.591AvN/src/server.rs:15942)

The destructive authority is also underspecified:

- `requestDigest` has no exact domain bytes, delimiter, encoding, or vectors.
- The described tuple key does not define the operation-ID uniqueness lookup needed to reject changed bytes under the same ID.
- Reset-specific stale-predecessor/reused-ID/replay diagnostics and statuses are absent.
- The closed receipt example omits the prose-required `seedRowCount`.
- Install, restore, and rollback operation-ID and `requestOrPlanDigest` derivation remain undefined. [Reset replay](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:390), [receipt body](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:492)

**Resolution criteria:** Define durable `committed-pending-publication` and `finalized` phases, startup fencing, complete carrier custody, and idempotent publication-only resume. Pin every digest domain and representation, operation-ID ownership/uniqueness, exact receipt fields, diagnostics, statuses, and golden vectors. After durable commit, recovery must never rotate streams or rerun DDL/DML.

### 4. High — MATERIAL — The predecessor-binary compatibility fence is asserted but not implemented

**Evidence:** Capability preflight prevents a new client from downgrading, but it cannot stop an older binary from opening the database and executing its legacy reset path. The Spec merely says such a predecessor “does not admit” after versioned metadata exists. [Compatibility assertion](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:446)

The current predecessor reset deletes selected known metadata keys; it cannot clear a future seed-identity key it does not know. [Current reset metadata handling](/private/tmp/snapback-llp0103-r2.591AvN/src/storage.rs:810) That can leave old identity beside a rotated stream, producing corruption rather than the promised clean untracked state.

**Resolution criteria:** Specify a durable must-understand compatibility floor or predecessor-visible poison that causes the relevant unmodified predecessor to refuse database open before effects. Add a pinned predecessor harness that opens and attempts legacy reset against a versioned store and proves unchanged database/WAL bytes. Testing only the new binary’s retained legacy route is insufficient.

### 5. High — MATERIAL — `migration-plan-v2` is not a closed execution authority

**Evidence:** LLP 0103 calls v2 “only” v1 plus `seedTransition` and says it participates in a “length-framed” digest. LLP 0081 instead defines prefix + newline + JCS and a `migration-v1:<digest>` plan ID; the current Rust body, domain, and artifact are hard-coded as v1. [Proposed v2](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:783), [LLP 0081 canonical authority](/private/tmp/snapback-llp0103-r2.591AvN/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:160), [current Rust authority](/private/tmp/snapback-llp0103-r2.591AvN/src/migration.rs:471)

The proposed table digests have no preimage/domain definition even though equality authorizes no-DML evolution. The text says both complete artifacts are bound, but the shown member contains only digests, with no embedded artifacts or sealed custody reference.

There is also no crash-safe predecessor deployment authority for rollback. Current publication persists the successor manifest; after reopen, fast rollback clones the now-successor `self.schema` as its alleged predecessor. [Publication](/private/tmp/snapback-llp0103-r2.591AvN/src/storage/migration_executor.rs:1367), [rollback reconstruction](/private/tmp/snapback-llp0103-r2.591AvN/src/storage/migration_executor.rs:1666)

**Resolution criteria:** Define `MigrationPlanArtifactV2`, its discriminator, body, digest domain/encoding, plan ID, approvals, admissions, journals, receipts, and v1/v2 rejection rules. Bind or checkpoint complete predecessor/successor deployment and seed artifacts, define table-digest formulas, and add a file-backed `published-held` crash/reopen/rollback test.

### 6. High — MATERIAL — Restore/rollback receipt states and carriers are incomplete

**Evidence:** Identities are nullable and restore/rollback always write a new receipt, but the “exhaustive” valid-pair list permits absent identity only with no receipt or `clear/cleared`. Restoring a never-versioned or cleared backup would yield absent identity plus `restore-rebase/restored`; an unchanged-null migration rollback can yield absent identity plus `rollback-republish/predecessor-restored`. Both become corrupt under the stated rules. [Nullable receipts](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:490), [exhaustive pairs](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:555), [rollback/restore](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:844)

The current restore system has closed `RestorePlan`, activation, result, maintenance-receipt, and pre-bind auth-restore contracts, none of which carry the proposed seed evidence. Restore is also initially inactive and separately activated, so “the sealed restore transaction” is ambiguous. [Restore plan](/private/tmp/snapback-llp0103-r2.591AvN/src/deploy.rs:578), [restore result](/private/tmp/snapback-llp0103-r2.591AvN/src/deploy.rs:826), [auth restore transaction](/private/tmp/snapback-llp0103-r2.591AvN/src/storage/auth.rs:1290)

**Resolution criteria:** Define which existing restore phase owns stream re-scope and the seed receipt, extend every closed plan/result schema involved, and specify operation identity, replay, backed-up receipt handling, and activation ordering. Add explicit valid states—or explicit refusal/no-receipt rules—for null-identity restore and rollback.

### 7. High — MATERIAL — The new direct reset routes violate the reserved system namespace

**Evidence:** LLP 0103 places destructive admin operations at `/app/reset-install-v1` and `/app/reset-clear-v1`. [New routes](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:374)

LLP 0031 requires system operations under `/_snapback/*`, explicitly guaranteeing that no system operation lives at the root so proxies may expose app routes while excluding the reserved prefix. [Namespace invariant](/private/tmp/snapback-llp0103-r2.591AvN/llp/0031-server-route-taxonomy.spec.md:78) The current destructive reset follows that rule. [Current route](/private/tmp/snapback-llp0103-r2.591AvN/src/server.rs:7358)

**Resolution criteria:** Use predecessor-unknown names under `/_snapback/api/app/`, register exact policies/sensitivity/admission behavior, update generated schemas and clients, and prove the root aliases are absent and effect-free.

### 8. Medium — MATERIAL — Dry-run and no-write refusal are not executable across the promised surfaces

**Evidence:** The install DTO is closed without a dry-run member, yet §10 normatively requires full dry-run and §12 requires every classification/refusal to be exercised without writes. No route, intent, host operation, client method, request/response schema, capability, or status contract is named. [Closed DTO](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:247), [dry-run](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:1025), [acceptance requirement](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:1177)

The current data-stream accessor creates and persists a UUID when the stream is absent. A fresh store can therefore mutate merely while obtaining the identity scope for preview/refusal unless LLP 0103 defines a strict non-creating read. [Current accessor](/private/tmp/snapback-llp0103-r2.591AvN/src/storage/auth_invalidation.rs:33)

The promised conformance manifest is not named or schematized, and its table covers only install and reset/clear rather than dry-run, inspection, migration, restore, and rollback.

**Resolution criteria:** Define a separate closed, capability-negotiated preview carrier and result for every claimed surface. Add strict `absent | present | corrupt` stream inspection and either initialize the stream in the successful install transaction or establish a separately governed pre-bind invariant. Name and schema the committed matrix with exact runners and nonzero counts.

### 9. Medium — DETAIL — Untracked-data remediation contradicts the no-adoption rule

**Evidence:** The normative state machine says migration cannot establish identity over untracked rows, but diagnostics advise operators to “choose explicit migration or destructive reset” and “migrate or reset.” [No migration remedy](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:623), [diagnostics](/private/tmp/snapback-llp0103-r2.591AvN/llp/0103-versioned-seed-evolution.spec.md:924)

**Resolution criteria:** Direct operators to preserve/export/investigate, remove the versioned declaration, or perform an authorized whole-instance reset. Do not advertise migration until a separately reviewed non-adoption transformation exists.

## 4. Suggestions

- Add four normative tables: auth-mode × operation, durable reset-journal phases, exhaustive identity/receipt pairs, and case × surface conformance.
- Replace illustrative receipt snippets with exact Rust-owned closed schemas and golden vectors.
- Add LLP 0057 and LLP 0072 to `Related`; restore and catalog semantics cannot be reconciled solely through LLP 0081.
- State explicitly that authority-bearing migration remains unavailable until a dedicated migration writer satisfies LLP 0056.
- Reuse LLP 0058’s actual-predecessor harness pattern for the versioned-seed compatibility floor.

## 5. Open questions

- Is cancellation of an effectful versioned stage intended to be legal? If so, what exact predecessor checkpoint makes it reversible?
- May `resetInstall` change auth mode, or is it settled same-mode only?
- Which host-owned protocol supplies a recoverable sessions principal after reset clears the auth catalog?
- Must pre-0103 binaries fail at storage open, or is compatibility intended to rely only on deployment tooling?
- Which restore phase owns seed re-scope: inactive restore apply, pre-bind auth restore declaration, or later activation?
- Are never-versioned and cleared backups valid restore inputs?
- Is dry-run a separate ensure intent, a system preview operation, or an inspection projection?

## 6. Readiness verdict

Not ready. The fresh-install refusal path is strong, but the material recovery, destructive-reset, compatibility, migration, and restore contracts still require implementers to invent safety-critical semantics.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; final delta-round instructions  
**Target SHA-256:** `3677ae4f5f988a21d96099e44bb041f8bf332d4ef2713d96f9ec61b491a70174`  
**Capsule SHA-256:** `e122d7cc8a53c4581e66f2e442047718d69e6be49981cf631dad4990a036721b`  
**Instruction SHA-256:** `76c6b4fbf39b58487c1ac20655a4cd97a628b7731c8e2b55aaa9100948001dd5`  
**Status:** completed

## 1. Overall assessment

The Round 2 narrowing materially improved LLP 0103. Stream-keyed identity, the constrained v1 operation set, predecessor-unknown routes, and reuse of the existing SQLite reset transaction all align with the repository.

It is not ready, however. Replay can report a historical installation as successful, `matched` cannot honor its operation-ID contract without writing, the provisioning gate is ambiguous, and §§15.4–15.5 do not yet define executable carriers, accounting, or conformance evidence.

## 2. Strengths

- The active-identity fence is sound. §15.1 keys identity to the exact existing data-version stream and rejects historical rows as active ([LLP 0103](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0103-versioned-seed-evolution.spec.md:1242)). Shipped reset rotates that stream transactionally ([storage.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/storage.rs:797)), while unknown `_snapback_*` tables survive physically ([storage.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/storage.rs:8463)). Restore also rotates it ([auth.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/storage/auth.rs:1373)).
- The v1 scope is appropriately conservative: same-mode install/match, reset-install, and clear only; cross-mode, membership bootstrap, migration publication, restore rebase, and rollback republish are explicit refusals or nonclaims.
- All four direct routes use the reserved system namespace. The four host-operation names are genuinely unknown to the predecessor; unknown names receive the stronger AdminWrite authentication floor and refuse before dispatch ([admin.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/admin.rs:1672)).
- Reset plus seed already has one SQLite commit boundary and rollback coverage for late seed and precommit failures ([storage.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/storage.rs:16802)).
- Existing JCS, UUIDv7, Rust-owned schema export, and drift-gate infrastructure make the artifact, digest, and DTO work implementable rather than speculative.

## 3. Concerns

1. **Severity: CRITICAL — MATERIAL — replay is not consistent with stream-scoped activity or write-free `matched`.**

   **Evidence:** §15.4 says an identical completed request unconditionally returns its stored receipt ([LLP 0103](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0103-versioned-seed-evolution.spec.md:1327)). After a legacy reset or restore, that operation row survives while its successor installation becomes historical. An old retry can therefore return `installed` or `reset-installed` even though §15.1 says no identity is active in the new stream.

   Separately, every install request has a database-global operation ID, but only effectful operations are stored. `matched` must change no metadata ([LLP 0103](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0103-versioned-seed-evolution.spec.md:1108)). Consequently, its ID is neither reserved nor replayable: after reset the identical request can become effectful, while changed bytes under that ID cannot produce `SNAPBACK_SEED_OPERATION_ID_REUSED`.

   **Resolution criteria:** Define replay precedence against the current strict stream and protected installation state. A historical completion must return either a distinct historical observation or a stable refusal—never a response mistaken for current activation, and never rerun effects. Then choose one coherent `matched` contract: either persist it and relax the no-write guarantee, or make it an observation returning the establishing receipt without claiming a caller-ID-bound durable operation. Add restart, legacy-reset, restore, clear, corruption, and changed-digest-under-matched-ID cases.

2. **Severity: HIGH — MATERIAL — the supposedly closed request/result carriers remain under-specified.**

   **Evidence:** `ResetSeedRequestV1` uses one format and digest domain for reset-install and clear, but contains neither an operation discriminator nor `requestedMode`; the artifact itself carries no mode ([LLP 0103](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0103-versioned-seed-evolution.spec.md:1314)). The required `expectedDataVersionStream` has no representation for the explicitly admitted missing-stream state. Preview requires an artifact even for clear, while its result is only a prose field list ([LLP 0103](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0103-versioned-seed-evolution.spec.md:1336)).

   The host projection is also unspecified: the current host carrier is a generic, flat `HostOpsRequest` ([host_ops.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/host_ops.rs:355)), so the Spec must say where the closed request lives, which siblings are forbidden, and whether wrapper fields enter the digest. Direct-route `409/503` behavior cannot simply be applied to host operations, whose governing contract returns understood failures inside HTTP-200 envelopes ([LLP 0024](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0024-agent-operating-surface.spec.md:389)).

   **Resolution criteria:** Specify Rust-owned tagged request, preview, result, and receipt unions. Bind destructive operation and mode—or explicitly defined active-mode semantics—into the request digest and stored replay record. Define `absent | present(canonical UUIDv7)` predecessor state, exact host wrappers and forbidden fields, legal operation/outcome combinations, and a code-by-code direct-HTTP versus host-envelope mapping.

3. **Severity: HIGH — MATERIAL — effectful ensure’s NonProd gate is ambiguous.**

   **Evidence:** §15.3 says ensure and preview use the “existing provisioning AdminWrite policy,” but names `AdminWrite + NonProd` only for reset and clear ([LLP 0103](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0103-versioned-seed-evolution.spec.md:1304)). The shipped invariant requires both dimensions for provisioning ([admin.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/admin.rs:99)); `app.ensure.provision` is explicitly mapped to `NonProd` ([admin.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/admin.rs:209)), and its handler applies that gate before effects ([server.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/server.rs:16867)). The Guide states the same tuple ([sessions guide](/private/tmp/snapback-llp0103-r3.zBhwur/guide/auth/sessions-and-principals.md:52)).

   **Resolution criteria:** State the complete authority/profile tuple independently for all four routes and host operations. Effectful ensure must remain `AdminWrite + NonProd` unless the provisioning invariant is explicitly amended. Decide whether effect-free preview is AdminWrite-only or also NonProd, and test both gate axes and precedence.

4. **Severity: HIGH — MATERIAL — “no publication phase” conflicts with the shipped reset safety protocol.**

   **Evidence:** §15.4 says recovery has only committed/not committed and “there is no publication phase” ([LLP 0103](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0103-versioned-seed-evolution.spec.md:1332)). LLP 0059 requires postcommit installation of the successor session projection and release of the exact stream ticket ([LLP 0059](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0059-session-projection-and-client-barrier.spec.md:1573)). The implementation performs that publication while admission remains blocked and can fail globally closed ([server.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/server.rs:15866)).

   **Resolution criteria:** Narrow the statement to “no separate seed durability publication or seed reset journal.” Preserve LLP 0059’s stream ticket, postcommit projection, issuer reconstruction, commit-uncertainty reconciliation, and response ordering.

5. **Severity: HIGH — MATERIAL — the 1,024 ceiling lacks an executable unit of account.**

   **Evidence:** §15.5 counts “direct plus derived writes, including identity/receipt projections” without defining whether those are logical rows, changed rows, SQL statements, installation rows, operation rows, stream metadata, or reset deletions ([LLP 0103](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0103-versioned-seed-evolution.spec.md:1356)). Existing LLP 0080 precisely counts direct application writes plus distinct changed projection-output rows ([LLP 0080](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0080-portable-relational-queries-and-projections.rfc.md:426)); current runtime enforces exactly that formula ([storage.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/storage.rs:5582)). Reset, meanwhile, performs unbounded table-wide deletion statements.

   **Resolution criteria:** Add a normative accounting table and per-operation formulas. Explicitly classify application deletions, projection changes, stream metadata, installation rows, and operation receipts; name the 1,025 refusal diagnostic; expose sufficient preview/receipt counts to verify it; and define concrete 1,024-success and 1,025-no-byte-change fixtures.

6. **Severity: HIGH — MATERIAL — the conformance manifest is not yet machine-executable or predecessor-verifiable.**

   **Evidence:** §15.5 names a file and broad categories, but no manifest schema, stable runner IDs, case IDs, executable entrypoints, expected counts, capability predicates, or completion-evidence format ([LLP 0103](/private/tmp/snapback-llp0103-r3.zBhwur/llp/0103-versioned-seed-evolution.spec.md:1363)). It also mixes surfaces with scenarios—“restore/migration refusal” is not a runner. The existing local proof builds only the current binary ([verify-local-proof](/private/tmp/snapback-llp0103-r3.zBhwur/scripts/verify-local-proof:152)), so “the unmodified prior binary” is not pinned or proven by the proposed contract.

   **Resolution criteria:** Define a closed manifest schema and dispatcher with stable case/runner IDs, paths, expected counts, capability/status/reason fields, and machine-readable completion evidence. Reject missing and unknown cases as well as runners. Pin predecessor provenance by revision, artifact digest, build recipe, and reported binary identity. The existing explicit Cloudflare inventory/dispatcher is a suitable pattern ([local-suite.mjs](/private/tmp/snapback-llp0103-r3.zBhwur/cloudflare/test/local-suite.mjs:28)).

## 4. Suggestions

- Do not implement strict preview by reusing `preview_seed_changes`; it opens an immediate transaction, performs inserts, then rolls back ([storage.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/storage.rs:2195)). Refactor a genuinely read-only planner.
- Add an old-tool/new-source compatibility case. Versioned source still uses `seed.json`, while current `SeedData` ignores unknown `seedVersion` ([manifest.rs](/private/tmp/snapback-llp0103-r3.zBhwur/src/manifest.rs:3732)) and current Vite forwards that file to legacy reset ([lifecycle.mjs](/private/tmp/snapback-llp0103-r3.zBhwur/packages/snapback-vite/lifecycle.mjs:317)). A predecessor-safe source filename would avoid that ambiguity.
- Once reconciled, edit or clearly strike the superseded portions of §§3–12; retaining multiple obsolete route, receipt, status, and migration contracts makes implementation error-prone despite §15’s precedence sentence.
- Define retention or bounded backpressure for historical installation and completed-operation rows.

## 5. Open questions

- Is a replay receipt intended to acknowledge only historical completion, or assert that its seed identity is currently active?
- Should preview require NonProd, or only AdminWrite?
- Is legacy interpretation of a new-format `seed.json` by old tooling an accepted rollout behavior, or should the versioned source use a predecessor-unknown filename?

## 6. Readiness verdict

The storage and scope architecture is now credible and implementable, but the remaining replay, authority, carrier, publication, and executable-proof defects are normative safety gaps. LLP 0103 needs another targeted reconciliation before acceptance or capability advertisement.

VERDICT: NOT READY
