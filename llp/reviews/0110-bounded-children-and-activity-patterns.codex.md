# LLP 0104 review — Codex family

## Round 1 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule  
**Target SHA-256:** `22e8cb22bb3ba0a3afca3939805ed66d05c457119b2fdbd60f4c4a3a561751a5`  
**Capsule SHA-256:** `a148115ddd1ab630d02975cb23203f16cf96107ad2cc0d4391152d0e5670626b`  
**Instruction SHA-256:** `51d1c9d777d26e9cfa197feffac847e5ebb89da785fe66e926eaeadc77a94ee5`  
**Status:** completed — NOT READY  
**Thread ID:** `019fa620-93be-74a1-bc59-68f9c4c6c582`  
**Review body:** preserved verbatim below.

## 1. Overall assessment

LLP 0104 has a strong narrow-product shape, but it is not ready for acceptance. The bounded-child core is close; the activity profile has a material authorization hole, and both profiles promise result, replay, work-bound, and client projections that the current governing contracts cannot represent without additional normative amendments.

Several issues require specification changes rather than ordinary implementation work. In particular, authorizing one scope row does not authorize the primary mutation’s remaining reads and writes, and the proposed source binding need not identify a row actually affected by the plan.

## 2. Strengths

- Both profiles are closed, versioned data rather than callbacks, SQL fragments, or inferred naming conventions.

- The bounded-child pipeline correctly places parent visibility before cursor validation and child access, preserving missing-versus-invisible noninterference, including malformed-cursor calls ([LLP 0104 §1.3](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:153)).

- Pagination honestly disclaims cross-page snapshot consistency and defines concurrent insert, movement, and deletion behavior ([LLP 0104 §1.4](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:202)).

- Live queries conservatively claim replacement, not deltas or retention, and enumerate parent, child-range, schema, index, and authorization dependencies ([LLP 0104 §1.5](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:228)).

- The activity profile requires one transaction, recorded IDs/time, one activity insert, pre-publication result validation, durable settlement, and complete rollback. Its fault-injection and concurrent-replay acceptance cases are concrete ([LLP 0104 §8.2](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:645)).

- Capability publication is appropriately per-target, experimental-first, corpus-gated, and fail-closed without scan, handler, or multi-transaction fallbacks ([LLP 0104 §4](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:500)).

- The implementation order is Rust/schema-first and corpus-before-adapter, consistent with LLP 0037.

## 3. Concerns

### C1 — Primary authorization and provenance are not closed

**Severity:** MATERIAL

**Evidence:** `existing-owner.v1` authorizes only the scope row, after which the primary plan may read and write other tables ([LLP 0104 line 268](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:268), [line 277](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:277)). The source binding need only have the correct table-ID type and be defined on successful paths; it need not identify a row actually written or related to the scope ([line 285](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:285)). Payloads and results may then expose those bindings. A caller owning incident A could read or patch a task under incident B, declare it as the source, and append the activity under A.

Eligibility is also applied only to the named scope, source, and activity tables, not every table in the primary effect closure ([line 314](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:314)). This conflicts with LLP 0065’s per-operation owner guards and owner-partitioned uniqueness requirements ([LLP 0065 line 141](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0065-generated-data-pattern-soundness.rfc.md:141), [line 187](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0065-generated-data-pattern-soundness.rfc.md:187)).

**Resolution criteria:** Define a static scope-dominance proof for every primary read and write. Existing rows must independently satisfy owner visibility or a required FK equality to the sealed scope ID; inserts must stamp that relationship; set operations must be scope-indexed. Prove that `source` denotes an actual primary effect on every successful path. Apply authority-bearing, projection, and unique-conflict checks to the complete effect closure. Fully normalize `create-owner.v1`, including its table, owner field, unique scope insert, scope-ID binding, and subsequent relationship rules. Add split-anchor tests where scope A is owned but source B is not.

### C2 — The admitted mutation vocabulary and quantitative ceiling do not exist

**Severity:** MATERIAL

**Evidence:** LLP 0104 says it merely composes LLP 0051’s existing vocabulary, but also admits a bounded index-range read ([LLP 0104 line 78](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:78), [line 277](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:277)). The implemented `MutationStep` has only point `Get`; its set forms are `DeleteWhere` and `InsertEach`, with no range-read node or per-step declared maximum ([src/manifest.rs line 3093](/private/tmp/snapback-llp0104-r1.bLkIns/src/manifest.rs:3093)).

The Spec requires exact ranges, multiplicities, and aggregate 1,024-write admission, but `EffectCeilingV1` records only table/access/index sets and operation sets ([src/manifest.rs line 2156](/private/tmp/snapback-llp0104-r1.bLkIns/src/manifest.rs:2156)); its codegen walker likewise deduplicates effects rather than counting them ([effect-ceiling.mjs line 58](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-codegen/effect-ceiling.mjs:58)). Automatic maintained-projection reads and writes also occur after the primary step loop ([src/storage.rs line 3058](/private/tmp/snapback-llp0104-r1.bLkIns/src/storage.rs:3058)) but are not addressed by the proposed ceiling.

**Resolution criteria:** Either narrow v1 to statically countable point operations totaling at most 1,023 application writes, or amend LLP 0051 with explicit bounded range/read/write nodes, index semantics, per-step cardinalities, and aggregate admission. Introduce a versioned quantitative ceiling capable of expressing bounds and runtime-answer counts. Either prohibit all projection sources in v1 or traverse active projections and account for their reverse-index reads, fan-out writes, and global write budget.

### C3 — Idempotency conflicts with the implemented settlement contract

**Severity:** MATERIAL

**Evidence:** LLP 0104 defines business arguments plus plan hash as settlement identity and collapses all changed argument, authority, function, or plan cases to `SNAPBACK_ACTIVITY_IDEMPOTENCY_MISMATCH` ([LLP 0104 line 358](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:358)). Existing identity includes function, auth fingerprint, authority-instance ID, and an input digest containing `args`, `readSet`, and `ctxLedger`, but no plan hash ([src/storage.rs line 572](/private/tmp/snapback-llp0104-r1.bLkIns/src/storage.rs:572), [line 13191](/private/tmp/snapback-llp0104-r1.bLkIns/src/storage.rs:13191)). Existing diagnostics distinguish function/payload reuse from stale authority ([src/storage.rs line 1632](/private/tmp/snapback-llp0104-r1.bLkIns/src/storage.rs:1632)).

The “exact duplicate” guarantee is also unqualified, while implemented settlements are deleted after an authenticated client acknowledgement ([src/storage.rs line 1455](/private/tmp/snapback-llp0104-r1.bLkIns/src/storage.rs:1455)); after deletion, the same ID can execute again. Existing retained rows have no plan-hash column or migration rule.

**Resolution criteria:** State that activity identity extends the existing identity and gate order, including `readSet` and `ctxLedger`. Define the plan-hash basis and domain separation. Preserve existing diagnostic precedence or explicitly amend LLPs 0043/0051/0055/0058. Specify storage migration and legacy-row quarantine. Bound exact-once behavior to the acknowledgement lifecycle or add a permanent consumed-ID tombstone, and test retry after acknowledgement and across plan upgrades.

### C4 — The provenance `actor` is not the actor under delegation

**Severity:** MATERIAL

**Evidence:** LLP 0104 defines `actor` as the canonical effective user ([LLP 0104 line 326](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:326)). LLP 0065 admits delegated agents through the effective-user owner profile, while LLP 0055 explicitly distinguishes effective user, actual actor, and grant ([LLP 0055 line 413](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0055-agent-principals-and-scoped-grants.rfc.md:413), [line 1300](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0055-agent-principals-and-scoped-grants.rfc.md:1300)). The proposed activity would therefore attribute an agent-originated mutation to the human principal.

**Resolution criteria:** Either restrict the profile to direct-human authority or record a server-derived effective subject plus actual actor identity/kind and grant ID. Use unambiguous semantic slot names and add delegated-agent acceptance cases proving that no provenance field is caller-forgeable.

### C5 — Descending child order is not index-served by the unchanged index contract

**Severity:** MATERIAL

**Evidence:** The plan admits per-field directions and Signal Desk explicitly requires descending activity order, while retaining an ascending implicit `_id` suffix and describing LLP 0007 as unchanged ([LLP 0104 line 107](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:107), [line 589](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:589)). Current index declarations contain only field names and uniqueness ([src/manifest.rs line 740](/private/tmp/snapback-llp0104-r1.bLkIns/src/manifest.rs:740)); the builder accepts no direction ([define.mjs line 325](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-codegen/define.mjs:325)), and SQLite creates declared fields plus `_id` ascending ([src/storage.rs line 8334](/private/tmp/snapback-llp0104-r1.bLkIns/src/storage.rs:8334)). Reversing such an index gives `created DESC, _id DESC`, not the required `created DESC, _id ASC`.

**Resolution criteria:** Make v1 ascending-only, or amend LLP 0007 and the schema/builder/activation contracts with per-column index directions, including the tie-break. Require exact query/index direction compatibility and instrumented duplicate-key tests proving no temporary sort or excess scan.

### C6 — The `take + 1` bound is false for buffered read-your-writes execution

**Severity:** MATERIAL

**Evidence:** The Spec gives every authorized evaluator an at-most-`take + 1` physical-entry bound and includes the buffered overlay among execution sites ([LLP 0104 line 147](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:147), [line 502](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:502)). LLP 0007 and the current overlay deliberately overfetch by the number of buffered writes so deleted or moved base rows can be replaced ([LLP 0007 line 330](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0007-storage-portability.spec.md:330), [src/runtime.rs line 1116](/private/tmp/snapback-llp0104-r1.bLkIns/src/runtime.rs:1116)). It additionally point-reads touched IDs.

**Resolution criteria:** Define separate persisted-range, touched-row, and buffered-candidate costs with one exact combined ceiling, or declare the profile unavailable in the buffered lane. Add worst-case buffered insert, delete, FK movement, and order movement cases.

### C7 — Cursor, deletion, and live lifecycle semantics are incomplete

**Severity:** MATERIAL

**Evidence:** Cursor validation is deferred until the parent is visible, but generated Args still require `cursor?: string` ([LLP 0104 line 182](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:182), [line 438](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:438)). The Spec does not separate structural argument validation from token validation. Current relational execution rejects a non-string or expired token before reading data ([src/local.rs line 15227](/private/tmp/snapback-llp0104-r1.bLkIns/src/local.rs:15227)). Thus an invalid cursor accepted while a parent is absent can turn the same live subscription into an error when the parent becomes visible, with no specified replacement/error behavior.

Deletion also leaves children stored and binds cursors only to parent ID ([LLP 0104 line 204](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:204), [line 222](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:222)). Recreating the same ID can expose old children and revive an old cursor because no parent incarnation is bound.

**Resolution criteria:** Pin argument-shape versus token-validation order, cursor expiry, and absent→visible live behavior. Bind children/cursors to a parent incarnation, prohibit ID reuse permanently, or define cleanup. State that parent read, visibility, cursor admission, child scan, projection, and dependency capture share one authoritative snapshot/overlay. Add malformed/expired cursor transitions, delete→recreate under same/different owners, and lost security-shrinking replacement tests.

### C8 — Parent and child table eligibility is not structurally closed

**Severity:** MATERIAL

**Evidence:** `through-parent.v1` asserts that child visibility needs no independent predicate, but the Spec does not enumerate table classes for which that assertion is admissible ([LLP 0104 line 118](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:118)). LLP 0065 explicitly says visibility is per operation rather than a general table invariant ([LLP 0065 line 202](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0065-generated-data-pattern-soundness.rfc.md:202)). A membership, permission-backing, or maintained-projection output table can therefore be selected and effectively declassified through its parent.

**Resolution criteria:** Enumerate eligible parent and child table classes. At minimum, reject membership, permission-backing, protected system, and maintained-projection output tables unless a mechanical proof establishes identical visibility. Add negative generation tests for each class and apply the same checks after schema/projection activation changes.

### C9 — Exact Result and provider/Contract promises lack a normative representation

**Severity:** MATERIAL

**Evidence:** The bounded query returns one structured `{parent, children, continuation}` value, but the current query wire is `rows: Vec<Value>` with a separate outer cursor ([src/manifest.rs line 3702](/private/tmp/snapback-llp0104-r1.bLkIns/src/manifest.rs:3702)), and `live_replace` likewise transports only row arrays ([src/live_wire.rs line 47](/private/tmp/snapback-llp0104-r1.bLkIns/src/live_wire.rs:47)). React and Contract copy query deliveries as arrays ([snapback-react line 77](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-react/index.mjs:77), [snapback-contract line 2307](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-contract/index.mjs:2307)). The Spec does not define whether this needs a protocol version, a canonical envelope row, or an adapter unwrap, nor does it give an exact two-branch JSON Schema for `parent:null`.

For mutations, the proposed scalar/record inference has no rules for null `Get`, `If` branch joins, field access, or binding provenance. Current mutation descriptors contain no result field ([codegen line 1453](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-codegen/index.mjs:1453)); provider introspection rejects such a field and projects mutation arguments/effects only ([provider-introspection line 28](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-codegen/provider-introspection.mjs:28), [line 376](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-codegen/provider-introspection.mjs:376)). Contract’s provider wrapper discards mutation output ([snapback-contract line 2312](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-contract/index.mjs:2312)). The repository already tracks this as an open soundness dependency ([result-contract issue](/private/tmp/snapback-llp0104-r1.bLkIns/issues/20260727-sound-handler-result-contracts.md:14)).

**Resolution criteria:** Choose and version the structured query encoding, including placement of continuation and exact absent/visible union schema. Define a closed mutation-result type calculus or require an explicit validator and prove the expression is its subtype. Carry result schemas through the Rust function manifest, validate before settlement, return the intended payload through every client arm, and version provider-introspection/binding metadata. Land the Exact-owned Contract descriptor/runtime change or narrow the claim.

### C10 — Required client persistence and execution-class capability claims are unspecified

**Severity:** MATERIAL

**Evidence:** LLP 0104 requires every generated client to create and persist a mutation ID ([LLP 0104 line 351](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:351)). The headless client currently makes it optional ([snapback-client line 4149](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-client/index.mjs:4149)); React forwards only name, args, and user ([snapback-react line 109](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-react/index.mjs:109)); Contract Online sends no ID ([online-surface line 305](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-contract/online-surface.mjs:305)).

The profile is inherently multi-table, while current IR descriptors automatically claim optimistic execution and global codegen derives optimistic/offline flags from plan presence ([codegen line 1459](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-codegen/index.mjs:1459), [line 1720](/private/tmp/snapback-llp0104-r1.bLkIns/packages/snapback-codegen/index.mjs:1720)). LLP 0051 explicitly limits existing derived overlays to single-boundary cases. The two new target capability IDs also lack their required exact positive runtime predicates.

**Resolution criteria:** Name every supported client arm and its persistent-ID owner, storage, response-loss behavior, and failure mode; unsupported arms need client GAPs. Initially publish no derived optimistic overlay for write-with-activity unless multi-table overlay semantics are separately specified. Define Online/Parity/offline-replay classification per arm and exact registry maturity, acknowledgment, and positive target predicates for both capability IDs.

### C11 — Signal Desk acceptance is not reproducible or finitely sequenced

**Severity:** MATERIAL

**Evidence:** LLP 0104 makes Signal Desk the required first fixture and requires its native comparison suite and diary ([LLP 0104 line 582](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:582)). The capsule contains no Signal Desk fixture or Diary 0022; the only repository pointer calls them a working-copy comparison ([backend-bakeoff issue line 12](/private/tmp/snapback-llp0104-r1.bLkIns/issues/shelved/20260727-backend-bakeoff-improvement-program.md:12)). The required comparator kit is also an open ticket and says Signal Desk currently copied a private suite ([comparator-kit issue line 14](/private/tmp/snapback-llp0104-r1.bLkIns/issues/20260727-comparator-acceptance-kit.md:14)). Exact result propagation is separately scheduled as foundation work, but LLP 0104 does not declare these prerequisites.

**Resolution criteria:** Commit or revision-pin Signal Desk, Diary 0022, its baseline receipt, and the exact glue being removed. Name the result-contract, artifact, and comparator-kit prerequisite revisions—or explicitly absorb bounded deliverables into this implementation sequence. Acceptance must run from a clean checkout with one documented command and no private working-copy dependency.

### C12 — Physical index application is assigned to the wrong phase

**Severity:** DETAIL

**Evidence:** The Spec says an “unapplied” index fails generation while preserving the previous generated tree ([LLP 0104 line 143](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:143)). Offline codegen can validate the declaration but cannot inspect every target’s physical catalog. Current query-index validation checks only the manifest; physical index repair occurs during schema activation ([src/storage.rs line 8337](/private/tmp/snapback-llp0104-r1.bLkIns/src/storage.rs:8337)).

**Resolution criteria:** Split declaration/portability failures from physical-application failures. Put the latter behind an atomic activation or invocation-admission gate that retains the previously installed generation and verifies exact columns and directions.

### C13 — Cursor opacity does not protect omitted ordering fields

**Severity:** DETAIL

**Evidence:** The cursor includes complete order values even when the child projection omits them ([LLP 0104 line 197](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:197), [line 204](/private/tmp/snapback-llp0104-r1.bLkIns/llp/0104-bounded-children-and-activity-patterns.spec.md:204)). Current cursors are authenticated base64-encoded data, not encrypted state.

**Resolution criteria:** Declare order keys caller-observable, require them in the projection, encrypt them, or use server-side cursor state. “Opaque” alone must not be treated as confidentiality.

## 4. Suggestions

- Stage the profiles independently. A useful first bounded-child slice could be ascending-only, online/live-replace, with a versioned structured-result encoding. A useful first activity slice could allow only scope-proved point writes, no active projection sources, direct-human attribution, and no derived optimistic overlay.

- Add normative tables for each plan field, validation phase, artifact owner, execution site, capability predicate, and public diagnostic. Several current ambiguities come from prose spanning different lifecycle phases.

- Expand the same-landing amendment list. The required changes now include LLPs 0043/0051 for settlement and range/count semantics, LLP 0055 for attribution, LLP 0007 for index directions, LLP 0012/0037 for result projections, and potentially LLP 0080 for projection-source effects.

- Turn §8 into a machine-readable matrix naming the corpus vector, target, client arm, expected artifact, and test command for every claim.

## 5. Open questions

1. Is the activity row intended to be audit-grade attribution or only a product feed? If audit-grade, effective user alone is insufficient.

2. Does exact-once activity insertion last only until client acknowledgement, or permanently for a consumed ID?

3. Should structured query results version the wire, or should they use a canonical one-row transport envelope with generated unwrapping?

4. Is mixed `createdAt DESC, _id ASC` ordering required in v1, or can Signal Desk initially use an ascending-compatible index?

5. Are maintained-projection sources categorically ineligible for write-with-activity v1, or must their transitive effects enter the ceiling?

## 6. Readiness verdict

Not ready. C1 is independently acceptance-blocking because the proposed activity helper can authorize one scope while reading or mutating another. The remaining material concerns require additional normative contracts and amendments before the implementation sequence is finite or its capability claims can be honest.

VERDICT: NOT READY

## Round 2 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; delta-round instructions  
**Target SHA-256:** `cd2afe4fc61320a1f8df6e335c4a8866d20fb725ccf76fb26c9d76d95a2baa4d`  
**Capsule SHA-256:** `edd205f69e081c9094209337a99f9500f63454ae4c45583d19330f0a17cc1481`  
**Instruction SHA-256:** `172db757f8a00b334f9dd6a12ef9c139acd6688e62c7aea5e5a0e35cc1629d19`  
**Status:** completed

## 1. Overall assessment

Not ready. Both profiles are finite at the authored-plan level, and their authorization posture is directionally sound. However, several required guarantees cannot currently be implemented or verified: immutable parent incarnation, exact result contracts, cursor projection confidentiality, authoritative provenance, total effect accounting, and cross-deployment settlement replay.

## 2. Strengths

- Bounded children is tightly constrained: one parent, one child table, exact ascending compound index, `take <= 1024`, `take + 1` physical-entry bound, no residual filtering, and an explicit buffered-overlay GAP.
- Parent-first authorization, absent/invisible equivalence, deferred cursor validation, public-read non-widening, and audit-only distinctions are well aligned with LLP 0065/0080.
- First-page-only `live_replace`, complete dependency capture, authority fencing, and no retention/delta claim form a coherent live contract.
- Activity execution is substantially narrowed from LLP 0051: point operations, explicit source identity, one framework-owned activity insert, no opaque handler/network/set-operation escape, and through-scope visibility that grants no independent read authority.
- Settlement identity and refusal codes match the implementation’s five-part `ClientMutationIdentity`, including the full args/read-set/context-ledger input fingerprint.
- The proposed Signal Desk, Guide, comparator, codegen, clean-checkout, and fault-injection evidence is unusually concrete.

## 3. Concerns

1. **Severity: Critical — MATERIAL — The exact-result authority is absent.**

   **Evidence:** The target normatively relies on LLP 0101’s `results.records`, `results.document`, `results.value`, `ExpectedOperationV1`, `result_contract_v1`, and retained-validator replay ([§1.3](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:247), [§2.4](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:466)). No LLP 0101 or corresponding implementation exists in this capsule. Current outputs remain `Vec<Value>`/`Value` ([manifest.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/manifest.rs:3703)), and provider descriptors cannot express the required nested array/tuple shape ([provider-introspection.mjs](/private/tmp/snapback-llp0104-r2.hdXKwx/packages/snapback-codegen/provider-introspection.mjs:407)).

   **Resolution criteria:** Land or include the governing LLP 0101 authority and pin its Rust representation, nested arrays/nullability/cardinality-one tuple semantics, egress validators, schemas, generated refs, provider/Contract mappings, and retained-validator format. Re-review 0104 against that exact authority.

2. **Severity: Critical — MATERIAL — `ParentIncarnationV1` has no durable or protected source.**

   **Evidence:** The token is derived from `(createdAt, creationVersion)` and copied into framework-owned immutable fields ([§1.1](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:148)). LLP 0007 defines only `_id`, mutable-last-change `_version`, `_createdAt`, and `_updatedAt` ([LLP 0007](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0007-storage-portability.spec.md:60)); current storage agrees ([storage.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/storage.rs:8013)). `FieldManifest` also has no framework-owned/immutable-field semantics ([manifest.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/manifest.rs:702)). After a parent update, its creation version cannot be recovered, and ordinary writers could forge or modify declared incarnation fields.

   **Resolution criteria:** Define a durable immutable creation-version/incarnation source, migration/backfill and restore semantics, and central enforcement across every write, seed, and migration path. Amend LLP 0004/0007 and test parent update, delete/recreate, child creation after update, and attempted field forgery.

3. **Severity: High — MATERIAL — The readable cursor leaks an omitted child `_id`.**

   **Evidence:** The target requires authored order fields in the projection because the authenticated cursor is clear, but the complete boundary also includes the implicit child `_id` without requiring `_id` in the projection ([§1.2](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:162), [§1.4](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:258)). Current cursors are base64url-encoded JCS plus a MAC, not encrypted ([rqs.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/rqs.rs:1398)).

   **Resolution criteria:** Require child `_id` in every paginated projection, or use a confidentiality-preserving cursor representation. Add a negative test proving no omitted boundary value is recoverable.

4. **Severity: High — MATERIAL — Provenance names the wrong authority surface and is not total.**

   **Evidence:** `grant` is required exactly when the authority descriptor carries one ([§2.3](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:430)), but the descriptor is exactly `{descriptorVersion, authorityInstanceId, sessionGeneration}` ([manifest.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/manifest.rs:3397)). Grant and actor facts instead live in server-prepared `ResolvedAppAuthority` ([invocation.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/auth/invocation.rs:303)). The target also leaves dev impersonation and the newly introduced `service` actor class unmapped.

   **Resolution criteria:** Derive all provenance exclusively from prepared server authority after credential/grant admission. Provide an exhaustive mapping for direct human, delegated agent, autonomous/bare service refusal, and dev impersonation; keep the transport descriptor opaque and non-authorizing.

5. **Severity: Critical — MATERIAL — The quantitative ceiling does not close all work.**

   **Evidence:** Several paths contradict or escape the declared ceiling:

   - `create-owner.v1` has no existing scope to read and allows no second source effect, yet the ceiling always records one scope read and an optional scope patch ([§2.5](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:510)).
   - Current `Patch` and `Delete` traversal also counts an implicit point read ([manifest.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/manifest.rs:1467)); the `0..8` budget does not say whether those reads consume it.
   - Piggyback acknowledgement may process 1,024 identities in a separate committed transaction before the primary mutation ([local.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/local.rs:5431), [storage.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/storage.rs:1455)).
   - Writable projection source tables are not excluded, although current writes can trigger projection reads and extra output writes ([storage.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/storage.rs:3058)).

   **Resolution criteria:** Supply mode-indexed logical and physical operation formulas. Create mode must have zero scope reads/patches. Define implicit patch/delete reads. Either classify ACK work explicitly outside the profile with its inherited bound and independent commit semantics, or count it. Reject every active projection participant, not merely output tables, or totalize projection fan-out and writes. Test every minimum and maximum path.

6. **Severity: High — MATERIAL — “Exactly one actual source effect” lacks a runtime lower bound.**

   **Evidence:** Current execution skips empty patches and permits missing-row patch/delete to change nothing ([storage.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/storage.rs:2711)). Because observed effects need only be a subset of the ceiling, such an invocation could append activity and settle successfully despite no source mutation.

   **Resolution criteria:** Reject empty patches, require a relationship-guarded existing target for patch/delete, and verify exactly one changed source row matching the declared table, ID, and operation before activity insertion. Missing/no-op paths must roll back under stable refusal codes.

7. **Severity: High — MATERIAL — Retained evidence and cross-deployment replay are not wire- or resource-complete.**

   **Evidence:** The target adds normalized plan and result-contract evidence to every settlement while claiming exact LLP 0043 retention inheritance. Current accounting includes identity fields and output bytes only ([storage.rs](/private/tmp/snapback-llp0104-r2.hdXKwx/src/storage.rs:13342)); LLP 0043’s refuse-don’t-evict caps therefore do not cover the new evidence. Separately, replay after an incompatible result-contract deployment returns old bytes, but the response and client queue have no specified original-contract discriminator.

   **Resolution criteria:** Define a versioned retained record, migration/corruption behavior, byte caps and transactional counters covering all evidence, and full ACK/purge deletion. Pin the original expected-operation/result-contract identity in the queued attempt and response, with a client-artifact upgrade test covering an incompatible contract change.

8. **Severity: High — MATERIAL — Scope guards do not close unique-constraint disclosure.**

   **Evidence:** Relationship checks prevent cross-scope row access, but a source or activity insert can still expose another scope’s row through a global unique-index conflict. LLP 0065 requires owner-partitioned uniqueness or explicit disclosure; 0104 does not explicitly apply an equivalent rule across source and activity tables.

   **Resolution criteria:** Require every client-observable unique constraint touched by the profile to be scope/incarnation-partitioned, or require an explicit reviewed disclosure declaration. Add paired cross-scope conflict tests.

9. **Severity: Medium — DETAIL — Parent-update continuation restart is not encoded.**

   **Evidence:** The cursor binding list contains immutable incarnation but no current parent row version or authorization/projection digest, while the next paragraph promises restart after such changes ([§1.4](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:258)).

   **Resolution criteria:** Bind a current parent version or canonical authorization/projection digest, specify the mismatch outcome, and test projection and visibility updates between pages.

10. **Severity: Medium — DETAIL — Two new byte contracts are underspecified.**

    **Evidence:** “Canonical ID-byte order” has no governing encoding—LLP 0007 currently treats IDs as opaque strings. The activity mutation digest likewise lacks algorithm, domain bytes, field framing/order, output grammar, and versioning ([§2.3](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:434)).

    **Resolution criteria:** Define both encodings byte-exactly with cross-language golden vectors, or remove table-scoped IDs from v1 ordering.

11. **Severity: Medium — DETAIL — The same-landing gate permits an experimental escape.**

    **Evidence:** The target requires Signal Desk and related evidence in the implementation landing ([§7](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:731)), but only stable/Implemented claims are gated on the complete report; positive experimental capability may be published earlier ([§4](/private/tmp/snapback-llp0104-r2.hdXKwx/llp/0104-bounded-children-and-activity-patterns.spec.md:649)).

    **Resolution criteria:** Gate the first positive capability publication—including experimental—on the same committed Signal Desk, comparator, codegen, Guide, diary, and conformance evidence, or explicitly narrow the same-landing promise.

## 4. Suggestions

- Model the activity ceiling as separate `create-owner.v1` and `existing-owner.v1` records rather than conditional prose.
- Add acceptance cases for cursor `_id` disclosure, parent projection update between pages, empty/missing source effects, projection-source writes, ACK followed by primary failure, cross-scope unique conflict, and incompatible client/server contract deployment.
- Publish an explicit first-party client matrix. The current Swift mutation surface sends neither settlement ID nor authority descriptor; it should either gain the queue contract or publish a structured GAP.
- Clarify why LLP 0114 is listed as Related despite having no stated normative role in this revision.

## 5. Open questions

- Is `creationVersion` intended to become a new system field, a protected registry value, or an explicit application field?
- Is piggyback ACK work intentionally outside `WriteWithActivityEffectCeilingV1` and its atomicity boundary?
- Are all maintained-projection roots and joined sources intended to be ineligible?
- What should an upgraded client do with retained bytes validated under an older incompatible result contract?
- Is dev impersonation admitted, and if so, what exact actual-actor provenance should it record?

## 6. Readiness verdict

The profiles are finite in authored shape, but they are not yet implementable with the claimed authorization, projection, settlement, and wire guarantees. The MATERIAL concerns require another revision and fresh delta review.

VERDICT: NOT READY

## Round 3 — 2026-07-27

**Reviewer family:** OpenAI Codex  
**Provider / runtime:** Codex CLI 0.145.0, `gpt-5.6-sol`  
**Reasoning effort:** ultra  
**Date:** 2026-07-27  
**Redacted:** no  
**Method:** fresh CLI runner, read-only sandbox, mutually blind structurally
isolated capsule; final delta-round instructions  
**Target SHA-256:** `a6d7fbb38611ab7e555b55848bc88e126e16e4655008497907a902f40d211136`  
**Dependency SHA-256:** `bd1bb9aaaa4f9c9015039d09a716add5ea86dbc442d0954ff49b11931e9fb3ac`  
**Capsule SHA-256:** `59e2c65a8e33f963c2048bfb66e07558b1d14a313e4f770a2ae808b5d32d7cf7`  
**Instruction SHA-256:** `5b20a61c32ad26cf32099bd7b52d3b106342f7944bb8429188e1bfb94c613191`  
**Status before launch:** pending

**Status:** completed  
**Verdict:** NOT READY

## Overall assessment

LLP 0104 is substantially improved, but it is not ready for implementation or semantic acceptance. The final reconciliation establishes the right architecture; however, seven material closure gaps remain in lifecycle integrity, noninterference, cursor protocol, result validation, provenance, effect accounting, and acceptance evidence.

The detail-horizon rule was applied: the MATERIAL findings below affect correctness, security, interoperability, or whether acceptance can prove the claims. Lower-level implementation choices are left as DETAIL or suggestions.

## Strengths

- The final-author precedence correctly removes the fictional creation-version dependency and introduces central, protected relationship stamping.
- Parent authorization precedes cursor validation and child access, giving absent and invisible parents a strong initial noninterference contract.
- LLP 0101 is consumed narrowly: no new expected-operation identity or settlement protocol is introduced, while LLP 0043 replay, ACK, purge, and caps remain authoritative.
- Create and existing-owner modes now have separate formulas, explicit no-op refusal, and atomic activity/result/settlement behavior.
- Projection participants and unpartitioned uniqueness are conservatively excluded.
- The first-publication gate is appropriately strict and currently forces a structured GAP rather than an aspirational capability claim.
- `./ref-check --verbose` passes: 103 LLPs, 2,146 references, zero errors.

## MATERIAL concerns

### M1 — The relation-incarnation invariant contradicts orphan preservation

The registry schema permits multiple active incarnations for one `(table_name,row_id)` and arbitrary `active` values. More importantly, activation requires every existing child to carry its current parent’s incarnation ([LLP 0104 §Protected relation incarnation](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0104-bounded-children-and-activity-patterns.spec.md:900)), while the profile deliberately retains orphan children across deletion and prevents them from attaching to a reused ID ([orphan semantics](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0104-bounded-children-and-activity-patterns.spec.md:277)). After delete/recreate, the retained children correctly carry an inactive predecessor incarnation, but reactivation would either reject them forever or require rewriting them onto the successor—violating isolation.

The lifecycle also names only bounded-children parent tables, although write-with-activity scopes independently require incarnation stamping.

Resolution criteria:

- Require exactly zero or one active incarnation per parent identity and fail closed on corruption.
- Permit child references to inactive historical incarnations; require only newly inserted or retargeted children to reference the unique active incarnation.
- Preserve and validate all referenced active and inactive registry rows during restore.
- Enroll every declared activity scope, even when no bounded-children query exists.
- Add delete/recreate, orphan-preserving reactivation, corrupted-double-active, backfill, and restore tests.

### M2 — Authorization and noninterference are incomplete after initial admission

Only the scope read explicitly collapses missing and invisible outcomes ([scope admission](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0104-bounded-children-and-activity-patterns.spec.md:342)). Missing, wrong-scope, or stale-incarnation source and auxiliary rows can therefore acquire distinct guard errors. A source patch is guarded on its pre-image, but the specification does not explicitly prohibit changing its scope foreign key before central restamping.

There are two additional disclosure paths:

- Parent commits conservatively resnapshot live queries ([live behavior](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0104-bounded-children-and-activity-patterns.spec.md:307)). A patch visible only to another principal can disclose high-side activity through a new version/replacement even when the low-side rows remain identical.
- Partitioned uniqueness covers activity and source tables only ([uniqueness rule](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0104-bounded-children-and-activity-patterns.spec.md:974)), while `existing-owner.v1` may patch the scope row. A globally unique scope field can reveal another scope through conflict.

Resolution criteria:

- Pin one byte-identical public refusal for absent, wrong-scope, and wrong-incarnation source/auxiliary rows.
- Forbid profile patches from changing the authorized `(scopeId, relationIncarnation)` pair.
- Suppress externally observable replacements for byte-identical high-only resnapshots, while updating internal dependencies.
- Apply uniqueness eligibility to every changed field on every written table, including the optional scope patch.
- Add paired-store static and live tests for all four cases.

### M3 — The AEAD cursor is not yet an interoperable or restore-closed protocol

The final section requires an AEAD-protected `sbpi1` credential and golden vectors, but does not define the suite, key derivation/domain separation, nonce rules, framing, AAD, closed plaintext encoding, or rotation behavior ([cursor contract](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0104-bounded-children-and-activity-patterns.spec.md:946)). Current cursor machinery uses exposed JCS bodies protected by HMAC ([current `sbpc1`](/private/tmp/snapback-llp0104-r3.ebcL9g/src/rqs.rs:283)) and stores raw 32-byte MAC secrets ([keyring](/private/tmp/snapback-llp0104-r3.ebcL9g/src/rqs.rs:1466)); it does not supply the missing AEAD contract.

“Single restart diagnostic” is also unnamed in the stable diagnostic registry, and the text does not identify which restore-monotone field distinguishes a restore from ordinary cursor invalidity. The control plane already allocates fresh data/stream authority on restore, so this is close, but the binding and precedence remain unspecified.

Resolution criteria:

- Freeze the AEAD suite, derived-key domain, nonce generation/uniqueness rule, framing, AAD, plaintext schema, and key-retirement behavior.
- Bind the cursor explicitly to a fresh stream incarnation or restore epoch guaranteed to change across restore.
- Name the restart diagnostic and define its precedence relative to authentication failure, expiration, and general cursor invalidity.
- Add deterministic-nonce golden vectors, retired-key vectors, and a restore-of-identical-parent-version test.

### M4 — LLP 0101 cannot validate the claimed sealed result correlation

LLP 0104 claims that `results.records` validates the absent/visible union ([result claim](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0104-bounded-children-and-activity-patterns.spec.md:238)). LLP 0101 permits one closed record object and only admits object unions with a common literal discriminator ([LLP 0101 result grammar](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0101-inline-handlers-and-result-contracts.spec.md:293)). Independent nullable fields cannot enforce:

`parent == null ⇒ children == [] && continuation == null`.

Resolution criteria: use a discriminated outcome record, extend LLP 0101 with the necessary discriminated object union, or compose its structural validator with a Rust-owned profile refinement. The computed-record live-envelope amendment and all consumer/type tests must land with it.

### M5 — Prepared provenance is not total, and the mutation digest is not settlement identity

The current `DevImpersonation` authority carries only the impersonated user, roles, and local-dev flag ([authority representation](/private/tmp/snapback-llp0104-r3.ebcL9g/src/auth/invocation.rs:291)). It has no authenticated actual actor principal, so the required `actorUserId` cannot be truthfully derived solely from prepared authority. Current function attribution is available only for service principals ([attribution implementation](/private/tmp/snapback-llp0104-r3.ebcL9g/src/auth/invocation.rs:915)).

Separately, the final digest hashes operation/source/provenance fields ([digest formula](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0104-bounded-children-and-activity-patterns.spec.md:979)), but the durable settlement identity consists of client ID, function, auth fingerprint, authority-instance ID, and input fingerprint ([implemented identity](/private/tmp/snapback-llp0104-r3.ebcL9g/src/storage.rs:572)). Distinct mutations of the same source by the same actor therefore collide.

Resolution criteria:

- Provide a total prepared-authority mapping table.
- Either refuse dev impersonation for durable activity or extend it with authenticated impersonator provenance.
- Either digest the exact canonical `ClientMutationIdentity`, or rename the field as a deliberately many-to-one provenance fingerprint and remove every settlement-correlation claim.
- Add direct-human, delegated-agent, dev, distinct-mutation, and exact-replay vectors.

### M6 — The “total” effect ceiling is not total

Both formulas terminate in undefined “fixed host/projection bookkeeping” ([effect formulas](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0104-bounded-children-and-activity-patterns.spec.md:990)). Current `EffectCeilingV1` records sets of operations and tables, not quantitative counts ([current effect model](/private/tmp/snapback-llp0104-r3.ebcL9g/src/manifest.rs:2156)). Settlement performs retention-counter reads and multiple writes ([settlement path](/private/tmp/snapback-llp0104-r3.ebcL9g/src/storage.rs:13342)), while automatic relation stamping adds registry lookups, protected writes, and lifecycle maintenance across every writer.

Projection exclusion is also one-sided: profile activation rejects currently active projections, but later projection activation and invocation/activation races are not prohibited. LLP 0080 already treats the active-plan set as a commit dependency for this reason ([LLP 0080 race rule](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0080-portable-relational-queries-and-projections.rfc.md:437)).

Resolution criteria:

- Define a versioned quantitative receipt for fresh success, duplicate replay, refusal, and each mode/source operation.
- Enumerate or expressly exclude relation maintenance, uniqueness probes, settlement counters, validator retention, journal/version work, and projection work.
- Derive implicit relation effects from schema metadata into ceilings, plan hashes, inspection, and migration receipts.
- Enforce projection incompatibility in both activation orders under the existing barrier and revalidate in-flight invocations.
- Require exact receipts, not merely “observed effects are a subset.”

### M7 — Acceptance does not yet close the inherited settlement boundaries nonvacuously

LLP 0101 retains frozen-validator replay, the 65,536-byte settlement limit, and global/per-authority caps ([LLP 0101 settlement slice](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0101-inline-handlers-and-result-contracts.spec.md:650)); LLP 0043 requires refuse-without-eviction, ACK, and administrative purge semantics ([LLP 0043 caps](/private/tmp/snapback-llp0104-r3.ebcL9g/llp/0043-offline-replay-retention.rfc.md:218)). LLP 0104 does not explicitly require profile-integration evidence for:

- 65,536 versus 65,537 bytes with total rollback;
- global and per-authority retention-full rollback;
- frozen-validator replay after schema change;
- ACK/purge validator-reference GC;
- activity survival through ACK/purge; and
- the intentional loss of exactly-once protection after purge.

The current shared harness can also report `ok: true` with skipped checks because skips are excluded from failures ([harness outcome](/private/tmp/snapback-llp0104-r3.ebcL9g/demos/_kit/harness.mjs:29)), while this gate requires no skips.

Resolution criteria: require exact versioned LLP 0043/0101 conformance receipts plus profile-specific rollback/activity assertions, exact expected test IDs and target/profile rows, and `skipped === 0`.

## DETAIL concerns

- The final ordering text references “LLP 0051 canonical value order,” but LLP 0051 explicitly defines only string ordering, while the earlier 0104 section defines IDs, integers, and booleans. Retain those explicit comparisons in the final normative text and pin their encoding vectors.
- Reconcile acceptance’s “1/8 point-read boundaries” with the final `0..8` auxiliary formula.
- Explicitly prohibit `scope == source` in `existing-owner.v1`, or define merged patch/count semantics.
- Define create-mode eligibility for client-observable unique constraints and whether generated `_id` uniqueness is exempt.
- Fold the final reconciliation into the main normative body before implementation. Superseded creation-version, `service` actor-kind, and `ExpectedOperationV1` passages remain easy to implement accidentally despite the precedence clause.

## Current dependency state

The publication gate is grounded in real unmet dependencies:

- LLP 0101 remains `Review`, and the corresponding sound-result-contract issue remains open ([issue](/private/tmp/snapback-llp0104-r3.ebcL9g/issues/20260727-sound-handler-result-contracts.md:3)).
- The comparator kit and codegen review-surface tickets are open ([comparator](/private/tmp/snapback-llp0104-r3.ebcL9g/issues/20260727-comparator-acceptance-kit.md:3), [codegen](/private/tmp/snapback-llp0104-r3.ebcL9g/issues/20260727-codegen-review-surface.md:3)).
- `demos/signal-desk`, the new capability IDs, `sbpi1`, the registry, and both profiles are absent from current code.
- Clean-package proof infrastructure exists, so that part of the gate is implementable.

Accordingly, even after textual repair, every current target must continue reporting a structured GAP until the committed witnesses exist.

## Suggestions

- Add three compact normative tables: relation lifecycle/invariants, authorization outcome equivalence, and mode/outcome-indexed effect receipts.
- Give every first-publication conjunct an exact receipt/test identifier.
- Treat relation metadata as schema semantics so changes invalidate generated artifacts and plan hashes automatically.

## Open questions

1. Should dev impersonation be ineligible for durable activity, or will authenticated impersonator identity be added?
2. Is `mutation` intended as one-to-one settlement correlation or only semantic grouping?
3. Should restore restart be keyed to stream incarnation, restore epoch, or both?
4. Must high-only parent commits be completely silent to an unauthorized live subscriber?
5. Are client-observable unique constraints allowed at all on create-owner scope tables?

## Readiness verdict

Keep LLP 0104 in `Review`. The direction is implementable, but no experimental or stable positive capability should be published until the MATERIAL resolution criteria and committed acceptance evidence are satisfied.

VERDICT: NOT READY
