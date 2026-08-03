# LLP 0162 agent-safe storage profile review — Codex family

## Round 1 — 2026-08-03 (target v0.1, SHA-256 659c28c53c8f587b5543cb9b5f88d7ac848aed09d4721a76aec40e913d6099dd)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context over the working tree at 50ff432a; instruction capsule pinned the target SHA, named the governing corpus docs to read, and barred reading llp/reviews/. Orchestrated by a Fable session acting as loop coordinator (which did not author the draft and does not count itself as a reviewer); the review is recorded verbatim below.

---

## 1. Overall assessment

The requested SHA-256 and commit were verified exactly: `659c28c53c8f587b5543cb9b5f88d7ac848aed09d4721a76aec40e913d6099dd` at `50ff432a`. LLP 0162 is a disciplined and mostly honest 80/20 synthesis of LLP 0161: it preserves stock SQLite, explicitly declines maintained Merkle state, general `AS OF`, lenses, and action replay, and correctly keeps promotion outside sync-core merge machinery. The tree substantiates most claimed foundations. However, three central contracts are not yet implementable as written: commit version cannot uniquely key every covered operation, the proposed fork crosses the incompatible LLP 0097 branch and LLP 0158 derived-deployment models without selecting or defining a bridge, and promotion lacks the replay-sufficient operation/effect-causality record LLP 0097 requires. The read-fact provenance, digest reuse, history policy, program ownership, and performance gates also need specification before review convergence.

## 2. Verdict — NOT READY

The RFC is not ready to advance because C1–C3 affect identity, isolation, and promotion correctness rather than wording or implementation detail. They can cause envelope collisions, ambiguous stream/schema authority, or canonicalization of state that was never safely re-executed. C4–C8 are material gaps in claim honesty and executable acceptance. The core direction is sound, but the RFC needs another revision before a fresh LLP 0005 review.

## 3. Strengths

- The P1–P9 mapping is unusually candid about deliberate remainders, especially the substitution of journal diff and boundary digests for P2, bounded checkpoints/history for P4, and narrow replay/evolution claims for P6/P7 ([llp/0162-agent-safe-storage-profile.rfc.md:124](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:124)). This is faithful to LLP 0161’s distinction between ideal properties and presently affordable substrate ([llp/0161-agent-optimized-storage-engine.research.md:227](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:227)).

- The merge ruling is correct and explicit: advanced-head promotion refuses, successful promotion re-executes into staging, and no sync-core merge or post-image application is permitted ([llp/0162-agent-safe-storage-profile.rfc.md:261](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:261)). This matches LLP 0088’s permanent rejection of semantic merge as sync-core machinery ([llp/0088-record-history-and-branching.rfc.md:173](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:173)).

- The proof posture is sound: boundary digests are not advertised as proof without an independently derived expected value ([llp/0162-agent-safe-storage-profile.rfc.md:253](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:253)), preserving LLP 0081’s most important evidentiary distinction ([llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:533](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:533)).

- The effect posture correctly allows deny-all egress as the first honest safety slice and distinguishes host-mediated from end-to-end isolation ([llp/0162-agent-safe-storage-profile.rfc.md:214](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:214)). That aligns with LLP 0158 F0a’s live scope cut ([llp/0158-instance-forking.rfc.md:861](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:861)) and LLP 0097’s mediation boundary ([llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:60](/Users/ccheever/projects/snapback/llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:60)).

- The source-level foundations are real: canonical versions and post-image journals exist ([src/storage.rs:5593](/Users/ccheever/projects/snapback/src/storage.rs:5593), [src/storage.rs:16587](/Users/ccheever/projects/snapback/src/storage.rs:16587)); Ibex dependencies and deterministic ctx answers are captured and replayed ([src/runtime.rs:1181](/Users/ccheever/projects/snapback/src/runtime.rs:1181), [src/runtime.rs:1359](/Users/ccheever/projects/snapback/src/runtime.rs:1359)); dry-run exposes read/write facts ([src/host_ops.rs:1610](/Users/ccheever/projects/snapback/src/host_ops.rs:1610)); migration receipts, fencing, and independent digest evaluation are implemented ([src/storage/migration_executor.rs:181](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:181), [src/storage/migration_executor.rs:542](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:542)); and scoped function grants are enforced ([src/auth/invocation.rs:1518](/Users/ccheever/projects/snapback/src/auth/invocation.rs:1518)).

- LLP 0097’s claimed landed-but-unwired substrate is also present: materialized bases, enumerable overlays, closed effect classes, and capture ledgers exist ([src/branches.rs:341](/Users/ccheever/projects/snapback/src/branches.rs:341), [src/branches.rs:400](/Users/ccheever/projects/snapback/src/branches.rs:400), [src/branches.rs:578](/Users/ccheever/projects/snapback/src/branches.rs:578)). The RFC does not misrepresent this as a served capability.

- The acceptance section has strong crash-cut, bypass, differential, authority-revocation, and coverage-honesty fixtures ([llp/0162-agent-safe-storage-profile.rfc.md:418](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:418)). Those are the right evidence forms for this profile.

## 4. Concerns

C1. **MAJOR — Commit version is not a unique key for covered operation envelopes.** The RFC requires one envelope per covered durable transition, keyed by target commit version, and makes the receipt and deduplication record part of that transaction ([llp/0162-agent-safe-storage-profile.rfc.md:140](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:140), [llp/0162-agent-safe-storage-profile.rfc.md:163](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:163)). Today a no-op mutation retains the current version ([src/storage.rs:4748](/Users/ccheever/projects/snapback/src/storage.rs:4748)) while still committing a distinct client-mutation settlement ([src/storage.rs:4815](/Users/ccheever/projects/snapback/src/storage.rs:4815)); LLP 0043 explicitly recognizes authoritative version zero for a fresh-database no-op ([llp/0043-offline-replay-retention.rfc.md:214](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:214)). Multiple durable receipt-only operations can therefore share one commit version, while `_snapback_client_mutations` keys them independently by operation identity ([src/storage.rs:5635](/Users/ccheever/projects/snapback/src/storage.rs:5635)). Resolve this by defining commit identity separately from output snapshot version—most naturally an operation-keyed envelope with a nullable or non-unique commit-version association—or by explicitly changing version-allocation semantics and reconciling that change with LLP 0007/0043 and fan-out behavior.

C2. **MAJOR — “Fork” is an unresolved hybrid of two incompatible corpus abstractions.** LLP 0162 calls its fork a short-lived derived deployment while claiming reuse of both LLP 0097 and LLP 0158 mechanics and LLP 0097 promotion ([llp/0162-agent-safe-storage-profile.rfc.md:206](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:206)). An LLP 0097 branch is in-process, shares schema/function/auth namespaces, owns a typed child stream, and v1 starts only at current head ([llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:47](/Users/ccheever/projects/snapback/llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:47), [llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:51](/Users/ccheever/projects/snapback/llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:51)). An LLP 0158 fork is a separate instance with its own canonical stream, may diverge schema/functions, and explicitly has no promotion or merge-back ([llp/0158-instance-forking.rfc.md:283](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:283), [llp/0158-instance-forking.rfc.md:893](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:893)). Named-checkpoint creation also extends 0097’s current-head-only contract. Resolve this by choosing one abstraction for `AgentSafeV1`, or specifying a real bridge: process/trust boundary, stream identity, schema and artifact compatibility, checkpoint semantics, authority namespace, operation-log transport, and the exact dated amendments to 0097/0158.

C3. **MAJOR — The proposed promotion record is insufficient for safe re-execution, and the landed promotion code follows the forbidden post-image path.** The envelope retains an argument digest, read/write facts, and effect intents, but does not require retention of canonical argument values, simulated outcomes, or a causal dependency graph ([llp/0162-agent-safe-storage-profile.rfc.md:145](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:145)). LLP 0097 requires a durable invocation log containing canonical arguments and the observed simulated-effect outcomes in causal order, with transitive dependency enforcement ([llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:82](/Users/ccheever/projects/snapback/llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:82), [llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:84](/Users/ccheever/projects/snapback/llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:84)). LLP 0162 mentions provisional effect-dependent writes but omits 0097’s required transitive multi-command acceptance fixture ([llp/0162-agent-safe-storage-profile.rfc.md:311](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:311)). Moreover, the landed `BranchOp` is only an overlay post-image or captured effect ([src/branches.rs:778](/Users/ccheever/projects/snapback/src/branches.rs:778)), and `promote` directly invokes `apply_write` on those post-images ([src/branches.rs:897](/Users/ccheever/projects/snapback/src/branches.rs:897), [src/branches.rs:954](/Users/ccheever/projects/snapback/src/branches.rs:954)). Resolve this with a normative replay-sufficient `BranchOperationV1`, explicit causal dependency enforcement, refusal when inputs/artifacts are unavailable, the transitive fixture from LLP 0097, and a statement that the present `branches::promote` implementation must be replaced or disabled rather than merely wired.

C4. **MATERIAL — The strong P5 claim erases read-fact provenance.** LLP 0162 describes the foundation as server-captured read/write facts and claims strong public captured sets on both Ibex and host-plan paved paths ([llp/0162-agent-safe-storage-profile.rfc.md:74](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:74), [llp/0162-agent-safe-storage-profile.rfc.md:130](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:130)). LLP 0007 instead draws a load-bearing distinction: Ibex reads are host-captured, while host-plan deciding reads are client-supplied baselines that the server validates ([llp/0007-storage-portability.spec.md:459](/Users/ccheever/projects/snapback/llp/0007-storage-portability.spec.md:459)). The implementation validates `input.read_set` separately from handler-captured dependencies ([src/storage.rs:5080](/Users/ccheever/projects/snapback/src/storage.rs:5080), [src/storage.rs:5125](/Users/ccheever/projects/snapback/src/storage.rs:5125)). LLP 0146 already defines the needed `complete | incomplete | unsupported` provenance vocabulary ([llp/0146-agentic-authoring-affordances.rfc.md:365](/Users/ccheever/projects/snapback/llp/0146-agentic-authoring-affordances.rfc.md:365)). Resolve this by recording source and completeness per fact class—such as `serverCaptured`, `clientSuppliedValidated`, and `serverEvaluatedConditional`—and narrowing the P5 claim accordingly.

C5. **MATERIAL — `ContentDigestV1` is not yet specified for the new boundaries that depend on it.** LLP 0162 assigns the existing digest to promotion, named checkpoints, and audit and makes those fixtures part of acceptance ([llp/0162-agent-safe-storage-profile.rfc.md:253](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:253), [llp/0162-agent-safe-storage-profile.rfc.md:451](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:451)). The shipped V1 header is migration-shaped: it binds a plan digest, generation, barrier head, publication version, and publication timestamp ([src/rqs.rs:1070](/Users/ccheever/projects/snapback/src/rqs.rs:1070)), and its expected-value evaluator is instantiated from a migration artifact and successor schema ([src/storage/migration_executor.rs:3064](/Users/ccheever/projects/snapback/src/storage/migration_executor.rs:3064)). The RFC does not define what those fields mean for a checkpoint or promotion, nor how each expected value is independently derived. Resolve this with boundary-specific canonical preimages, headers, and independent evaluators—either a compatible wrapper/domain separation around V1 or a new versioned digest contract. Checkpoint-only inventory must remain labeled inventory.

C6. **MATERIAL — Bounded history does not carry forward LLP 0088’s mandatory retention and authorization invariants.** LLP 0162 permits owner-paid pins, generally invokes an “applicable history policy,” and asks acceptance only to authorize fail-closed and avoid moving the replay floor “incorrectly” ([llp/0162-agent-safe-storage-profile.rfc.md:293](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:293), [llp/0162-agent-safe-storage-profile.rfc.md:298](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:298)). LLP 0088 is more specific: history and resume have independent retention clocks; v1 history has finite age and version bounds with no unbounded option; and each returned historical post-image must pass both current-record authorization and per-version policy evaluation ([llp/0088-record-history-and-branching.rfc.md:195](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:195), [llp/0088-record-history-and-branching.rfc.md:205](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:205), [llp/0088-record-history-and-branching.rfc.md:218](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:218)). Resolve this by incorporating those rules normatively, separating renewable checkpoints from per-record-history retention, and specifying deletion/erasure behavior for pinned snapshots and retained explanation details.

C7. **MATERIAL — Sequencing acknowledges but does not map program ownership.** The RFC correctly says its sequence is not implementation authorization, but steps 1–2 alter ordinary mutation identity, settlement, provenance, client behavior, and potentially wire artifacts without naming the owning amendments ([llp/0162-agent-safe-storage-profile.rfc.md:460](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:460)). LLP 0155 assigns local execution and settlement to LLP 0051/0129/0133, retention to LLP 0043/0053/0090, and wire shapes/lifecycle to LLP 0094/0095, requiring amendments rather than centralization ([llp/0155-local-sync-product-direction.rfc.md:145](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:145)). LLP 0161 likewise says LLP 0155/0130 own the roadmap and only LLP 0158 F0a currently has author intent ([llp/0161-agent-optimized-storage-engine.research.md:250](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:250)). Resolve this with an ownership/amendment table, add LLP 0130 and 0155 to `Related`, and state explicitly that 0158 F0a remains the sole live adjacent lane and does not include capture-ledger integration or promotion.

C8. **MATERIAL — The performance gate is not executable and conflates document status with implementation status.** The RFC requires profile-on versus profile-off measurements before advancing beyond Draft while also stating that Draft does not commission implementation ([llp/0162-agent-safe-storage-profile.rfc.md:42](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:42), [llp/0162-agent-safe-storage-profile.rfc.md:380](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:380)). “No statistically meaningful regression,” “representative data sizes,” and the combined 15% throughput/latency threshold lack fixtures, sample counts, confidence/noise rules, hardware class, and individual metric treatment ([llp/0162-agent-safe-storage-profile.rfc.md:395](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:395)). Resolve this by separating RFC acceptance from capability implementation/advertisement, pinning the benchmark protocol and datasets, and defining how each metric passes, fails, or qualifies for an explicit exception.

## 5. Suggestions (non-blocking)

- Change “including Ibex query/mutation execution” in durable-transition coverage to distinguish durable mutation envelopes from read-only query explanation; otherwise it appears to conflict with the no-idle-write budget.

- Give envelope, explanation, diff, history, and checkpoint outputs explicit coverage-manifest versions so aggregate `AgentSafeV1` never depends on prose interpretation.

- Domain-separate or key digests of low-entropy arguments and identities where an unkeyed digest could become an offline guessing oracle.

- Distinguish client-minted `operationId`, server-minted invocation identity, commit identity, and effect-settlement identity in one terminology table.

- Treat the current `src/branches.rs` promotion API as a negative conformance fixture: no product path should be able to invoke post-image promotion after strict re-execution lands.

## 6. Open questions

- Is the first promotable profile an LLP 0097 in-app branch, an LLP 0158 derived deployment, or a newly specified composition of the two?

- Is `commitVersion` an operation identity, a state-snapshot coordinate, or only a journal join key when a data-changing commit occurred?

- What independently computed value proves a named checkpoint: source-versus-copy equality, base-plus-operation evaluation, or another oracle?

- Can a checkpoint or history pin be renewed indefinitely, and how do erasure, revocation, and protected-lane deletion override such pins?

- Which owning documents must accept amendments before automatic operation identity or public envelope fields can ship?

## 7. Recommended next step

Revise LLP 0162 to v0.2 by resolving C1–C3 first, then add normative provenance, digest-boundary, history, ownership, and benchmark contracts for C4–C8. Keep the status Draft and the capability `Missing`, explicitly preserve LLP 0158 F0a as the only commissioned adjacent work, and request a fresh mutually blind LLP 0005 review after the revision.

---

## Round 2 — 2026-08-03 (target v0.2, SHA-256 2bee843df7bd4de89776f83170df558abc4d275fcef9e8e51d0398a0483ad18e)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context over the working tree at 50ff432a (target uncommitted, SHA-pinned); same capsule discipline as round 1 with the v0.2 SHA; barred from llp/reviews/ and from knowledge of prior rounds; recorded verbatim below.

---

## 1. Overall assessment

I verified SHA-256 `2bee843df7bd4de89776f83170df558abc4d275fcef9e8e51d0398a0483ad18e` at commit `50ff432a`. LLP 0162 is a disciplined and mostly corpus-consistent reduction of LLP 0161: it preserves strict re-execution instead of merge, distinguishes promotable branches from derived deployments, limits history and proof claims, and accurately characterizes the existing implementation substrate. However, two load-bearing contracts remain underdefined: the current writable-copy/post-image journal cannot necessarily produce the promised exact base-to-head logical diff, and universal duplicate suppression has no finite retention/acknowledgement horizon. Several associated capability, identity, custody, and performance questions also remain too open for the acceptance corpus to determine conformance unambiguously.

## 2. Verdict — NOT READY

The RFC is ready for another revision, but not for review convergence or advancement. C1 and C2 are major correctness gaps in two of the profile’s three central primitives: exact fork inspection and retry-safe universal envelopes. They cannot be deferred solely to schema follow-on work because the missing choices determine required storage, retention cost, observable semantics, and acceptance fixtures. The remaining material findings should be settled in the same revision so `AgentSafeV1` becomes a bounded, testable capability rather than a collection of individually sound but incompletely composed components.

## 3. Strengths

- The P1–P9 mapping is candid about strong, partial, and substitute coverage, and the non-claims avoid presenting journals as maintained Merkle state, checkpoints as database-wide `AS OF`, or migration proofs as general lenses (`llp/0162-agent-safe-storage-profile.rfc.md:35-43`, `llp/0162-agent-safe-storage-profile.rfc.md:110-148`; compare `llp/0161-agent-optimized-storage-engine.research.md:104-180`).

- The “existing foundations” inventory is materially accurate. Commit versions, row post-image journals, and optional settlement records exist (`src/storage.rs:5593-5647`, `src/storage.rs:16587-16612`); Ibex execution captures writes, reads, and deterministic answers (`src/runtime.rs:389-448`, `src/runtime.rs:478-529`); dry-run exposes read/write sets and deterministic inputs (`src/host_ops.rs:1610-1667`); and `ContentDigestV1` is a domain-separated resumable stream with the migration-shaped header the RFC identifies (`src/rqs.rs:1070-1149`).

- The branch taxonomy cleanly prevents LLP 0158’s schema-divergent derived deployment from acquiring an accidental promotion path (`llp/0162-agent-safe-storage-profile.rfc.md:244-266`). Promotion is explicitly re-execution into staging, never sync-core merge or post-image application, matching LLP 0097 and LLP 0088 (`llp/0162-agent-safe-storage-profile.rfc.md:324-353`, `llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:80-87`, `llp/0088-record-history-and-branching.rfc.md:173-188`).

- The RFC honestly identifies the landed `branches::promote` implementation as superseded. The source currently enumerates `OverlayWrite` post-images and applies them through `apply_write` (`src/branches.rs:778-803`, `src/branches.rs:897-1017`), exactly the unsafe shortcut the RFC prohibits (`llp/0162-agent-safe-storage-profile.rfc.md:339-342`).

- The proof language preserves LLP 0081’s critical distinction between inventory and independently derived evidence (`llp/0162-agent-safe-storage-profile.rfc.md:309-322`, `llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:485-535`).

- Sequencing respects program ownership and LLP 0158’s live scope cut: F0a remains deny-all-egress and does not silently become capture or promotion work (`llp/0162-agent-safe-storage-profile.rfc.md:586-616`, `llp/0158-instance-forking.rfc.md:858-897`).

## 4. Concerns

1. **C1 — MAJOR. Claim at issue:** The profile promises an exact logical base-to-head fork diff derived primarily from the journal. **Evidence:** The RFC requires added, updated, and deleted logical rows and acceptance equality with an independent base/head comparison (`llp/0162-agent-safe-storage-profile.rfc.md:290-307`, `llp/0162-agent-safe-storage-profile.rfc.md:564-566`). The landed substrate has one materialized database that becomes the writable fork (`src/branches.rs:355-377`, `src/branches.rs:400-408`), while both overlay and ordinary journals retain post-images, not first-write preimages (`src/branches.rs:439-471`, `src/storage.rs:5600-5607`). Consequently, update-then-revert or delete-then-reinsert can be indistinguishable from a net change without an immutable base or retained preimage. LLP 0158 already records that whole-state comparison requires a separately retained immutable base because the backup destination itself becomes writable (`llp/0158-instance-forking.rfc.md:699-707`). **Resolution:** Define whether the API returns an ordered change history or a net base-to-head state diff. For a net diff, require an immutable base, first-write preimages, or an equivalent independently sufficient base identity; define canonical folding for reversions, insert/delete cancellation, delete/reinsert, system fields, and retention expiry; then make those cases explicit acceptance fixtures.

2. **C2 — MAJOR. Claim at issue:** Universal envelopes provide duplicate-safe retries while remaining bounded. **Evidence:** Every covered transition creates an atomic envelope and suppression record (`llp/0162-agent-safe-storage-profile.rfc.md:154-205`), and compact explanation identity survives detail expiry (`llp/0162-agent-safe-storage-profile.rfc.md:231-242`), but no rule says when that identity may be reclaimed or what a retry observes afterward. Generic resource limits and preservation of “open” receipts do not define the lifecycle (`llp/0162-agent-safe-storage-profile.rfc.md:397-403`, `llp/0162-agent-safe-storage-profile.rfc.md:560-563`). The existing settlement authority solves precisely this tension with consumption acknowledgements, refusal at capacity, and an explicit operator purge that admits loss of exactly-once semantics (`llp/0043-offline-replay-retention.rfc.md:204-259`, `llp/0043-offline-replay-retention.rfc.md:332-352`). Without such a boundary, compact envelopes either grow forever or eventually disappear while P8 still appears guaranteed. **Resolution:** Specify the envelope state machine, acknowledgement or expiry authority, per-audience quotas, operation-ID reuse horizon, late-retry response after reclamation, and semantics of administrative purge. Add crash, cap-exhaustion, delayed-ACK, and retry-after-GC fixtures.

3. **C3 — MATERIAL. Claim at issue:** Every ordinary paved mutation can satisfy the stable operation-identity contract. **Evidence:** The RFC says first-party clients mint IDs and initial coverage includes all ordinary Ibex and host-plan mutations (`llp/0162-agent-safe-storage-profile.rfc.md:200-220`), but it does not define admission for clients that omit an ID or the rollout boundary at which omission refuses. Today `clientMutationId` defaults to `null` and is sent only when supplied (`packages/snapback-client/index.mjs:5728-5770`); the wire schema remains optional (`src/manifest.rs:6164-6176`); and the server-minted response ID is not installed as a durable replay identity when the request omitted one (`src/local.rs:11965-11984`). A server-generated ID returned after execution cannot repair an ambiguous first response. The physical key is also ambiguous between “audience-scoped operationId” and a globally unique operation identity, whereas migration precedent keys recovery by operation ID plus audience (`llp/0162-agent-safe-storage-profile.rfc.md:154-165`, `llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:229-233`). **Resolution:** Define a versioned client capability transition, require or stably refuse missing IDs once envelope coverage is advertised, specify legacy-client behavior, and normatively define the composite operation key and canonical audience bytes. Test every paved transport, omitted IDs, same ID across audiences, and ambiguous delivery.

4. **C4 — MATERIAL. Claim at issue:** `AgentSafeV1` is an actionable aggregate capability. **Evidence:** The aggregate may be claimed only when every “required component” passes (`llp/0162-agent-safe-storage-profile.rfc.md:425-448`), yet Open Question 2 leaves the required ordinary and specialized lanes undecided, Open Question 5 leaves schema/capability ownership open, and Open Question 7 leaves specialized receipt compatibility unresolved (`llp/0162-agent-safe-storage-profile.rfc.md:662-677`). Therefore an implementation cannot determine whether the aggregate passes even if every enumerated acceptance test succeeds. **Resolution:** Add a normative v1 capability matrix naming mandatory lanes, optional separately advertised lanes, required retention/proof classes, and the exact schema/version owner. Specialized lanes not required for v1 should remain individually advertised rather than blocking or silently joining the aggregate.

5. **C5 — MATERIAL. Claim at issue:** A fork can remain promotable while replay inputs are retained under the stated privacy and derived-deployment rules. **Evidence:** Promotion requires full canonical argument values, ctx answers, and effect outcomes, not merely digests (`llp/0162-agent-safe-storage-profile.rfc.md:330-337`), while security permits those values to be redacted, encrypted, or refused (`llp/0162-agent-safe-storage-profile.rfc.md:514-520`). LLP 0146 permits full argument retention only through explicit opt-in (`llp/0146-agentic-authoring-affordances.rfc.md:951-960`). The RFC does not say when an unretainable operation makes a nominally `Promotable` fork non-promotable, nor how copied envelope, suppression, history, and checkpoint stores are treated by LLP 0158’s mechanical custody sweep (`llp/0158-instance-forking.rfc.md:824-829`, `llp/0158-instance-forking.rfc.md:861-875`). **Resolution:** Define admission-time replay eligibility and consent, protected storage and key lifecycle, erasure consequences, and an immediate capability transition to capture-only/non-promotable when inputs cannot be retained. Add explicit copy/scrub/rotate/refuse classifications for every new `_snapback_*` store in derived deployments.

6. **C6 — MATERIAL. Claim at issue:** The 80/20 performance gate is objectively pass/fail. **Evidence:** The RFC uses “no statistically meaningful read-path regression” and a proposed 15% mutation threshold (`llp/0162-agent-safe-storage-profile.rfc.md:486-512`), while leaving the threshold itself open (`llp/0162-agent-safe-storage-profile.rfc.md:666-668`). The cited LLP 0035 baseline explicitly describes its measurements as a single developer-machine run, order-of-magnitude evidence rather than a statistically controlled benchmark (`llp/0035-local-target-benchmarks.research.md:33-52`). Neither document defines equivalence bounds, sample count, confidence rule, noise rejection, or the directional calculation for throughput versus latency. **Resolution:** Commit a reproducible statistical protocol and named baseline artifact: warm-up, run count, estimator/spread, equivalence or confidence criterion, hardware class, fixture sizes, and explicit formulas for throughput and latency regression. Ratification should occur before capability promotion, not after an ambiguous result.

7. **C7 — MINOR. Claim at issue:** The history authorization acceptance test fully exercises the imported LLP 0088 rule. **Evidence:** LLP 0162 imports LLP 0088 §6 and says history authorizes fail-closed, but its acceptance criterion only repeats that general phrase (`llp/0162-agent-safe-storage-profile.rfc.md:364-371`, `llp/0162-agent-safe-storage-profile.rfc.md:392-395`, `llp/0162-agent-safe-storage-profile.rfc.md:573-575`). LLP 0088’s actual rule is more specific: authorize the record now, evaluate every historical post-image, and silently elide failing versions (`llp/0088-record-history-and-branching.rfc.md:218-234`). **Resolution:** Add fixtures for visibility changing between versions, currently unauthorized/deleted records, per-version elision, pagination across elisions, and horizon markers that disclose no hidden-version metadata.

## 5. Suggestions (non-blocking)

- Include one canonical `CommitEnvelopeV1` example and one receipt-only example to expose keying and optional-field mistakes early.

- Give acceptance requirements stable IDs and pair each refusal path with its diagnostic code.

- Use LLP 0037’s generated-schema pattern for envelope, diff, checkpoint, and capability artifacts rather than allowing independently handwritten wire shapes.

- Name ordered journal history and net state diff as separate surfaces even if they share implementation machinery.

- Add a compact implementation-status table distinguishing shipped substrate, required modification, and net-new components.

## 6. Open questions

- Is “exact fork diff” fundamentally a net state comparison or an attributed sequence of committed changes?

- What event ends the universal retry guarantee and authorizes envelope/suppression reclamation?

- Can a fork advertise `Promotable` before every admitted operation has passed replay-input retention classification?

- Which precise local lanes constitute the first `AgentSafeV1` aggregate, and is host-plan coverage mandatory while LLP 0007 Option A remains unratified?

- Do derived deployments inherit historical envelopes and explanations, or only application state plus newly minted fork-local provenance?

## 7. Recommended next step

Revise LLP 0162 to v0.3 by resolving C1–C6 normatively and adding C7’s authorization fixtures. The minimum convergence package is: a realizable net-diff substrate or narrower diff claim, a finite envelope/identity lifecycle, mandatory operation-ID negotiation and composite-key semantics, a closed `AgentSafeV1` capability matrix, replay-input and derived-deployment custody rules, and an executable performance protocol. Then run the LLP 0005 review loop again on the revised bytes.

---

## Round 3 — 2026-08-03 (target v0.3, SHA-256 07229078450b6c2b14b003996e94605b2559a03f0c7ceffc8f9b4fb0bd4b2389; later committed as d26f946e with a Revised-line concatenation, SHA-256 6bf1a9dd0f1a7a04418227beb1df482f0f9d1a0eb9e969369a86727aabb49f4e — body bytes identical)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context; same capsule discipline with the v0.3 SHA; barred from llp/reviews/ and prior rounds; recorded verbatim below.

---

## 1. Overall assessment

I verified the reviewed v0.3 bytes at SHA-256 `07229078450b6c2b14b003996e94605b2559a03f0c7ceffc8f9b4fb0bd4b2389` and reviewed them independently without consulting `llp/reviews/`. LLP 0162 is a thoughtful, unusually candid 80/20 profile: its P1–P9 mapping is faithful to LLP 0161, its exclusions are explicit, its treatment of merge, promotion, derived deployments, and digest proof agrees with the governing corpus, and the implementation foundations it cites are present. It is nevertheless not ready for review convergence because bounded duplicate suppression cannot currently guarantee the promised stable late-retry result after all identifying records are reclaimed, and the authorization model does not cover several sensitive non-row facts exposed by explanations and diffs. The capability model, aggregate definition, performance gate, and erasure behavior also need sharper, testable contracts.

## 2. Verdict — NOT READY

The RFC should remain Draft. The central architecture is credible, and no wholesale redesign is needed, but C1 and C2 are blocking semantic and security gaps in primitives described as universal. C3–C7 are narrower amendments needed to make the profile’s advertised capability, acceptance criteria, and operational guarantees unambiguous. Resolving those concerns would put the RFC in strong shape for another independent review.

## 3. Strengths

- The scope is disciplined: the RFC claims an envelope, safe current-head forks, and bounded history while explicitly declining maintained Merkle state, database-wide `AS OF`, general lenses, universal action replay, and sync-core merge (`llp/0162-agent-safe-storage-profile.rfc.md:11-50,110-134`).

- The P1–P9 table honestly distinguishes direct coverage from bounded approximation and deliberate remainder (`llp/0162-agent-safe-storage-profile.rfc.md:138-148`; `llp/0161-agent-optimized-storage-engine.research.md:104-205`).

- Corpus rulings are handled correctly. Merge remains outside sync-core machinery; promotion is by re-execution; derived deployments remain separate instances; and F0a remains the live deny-all-egress lane (`llp/0162-agent-safe-storage-profile.rfc.md:35-43,304-361,416-447,721-755`; `llp/0088-local-sync-core.rfc.md:173-188`; `llp/0097-ephemeral-data-branches.rfc.md:80-89`; `llp/0158-instance-forking.rfc.md:283-320,861-877`).

- The RFC correctly identifies that the landed branch promotion implementation directly applies overlay postimages instead of re-executing the operation log (`llp/0162-agent-safe-storage-profile.rfc.md:431-436`; `src/branches.rs:897-980`).

- The claimed foundations exist: commit versions and `_snapback_changes` (`src/storage.rs:5600-5615,16587-16626`), authenticated mutation identity (`src/storage.rs:617-757`), row/missing-row/query/predicate validation (`src/storage.rs:11650-11857`), dry-run captured facts (`src/host_ops.rs:1610-1725`), branch materialization and effect capture (`src/branches.rs:344-500,540-755`), and `ContentDigestV1` (`src/rqs.rs:878-1150`).

- The proof language is precise: a digest is inventory unless checked against an independently derived expectation, matching LLP 0081’s governing rule (`llp/0162-agent-safe-storage-profile.rfc.md:401-414`; `llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:485-535`).

- The acceptance plan includes useful adversarial tests—crash cuts, bypass attempts, randomized net-diff comparison, transitive effect capture, strict-head promotion, and per-version historical authorization (`llp/0162-agent-safe-storage-profile.rfc.md:654-719`).

- Sequencing respects program ownership: LLP 0130/0155 retain commissioning authority, and acceptance of this RFC alone does not authorize implementation (`llp/0162-agent-safe-storage-profile.rfc.md:721-755`; `llp/0155-local-sync-product-direction.rfc.md:145-162`).

## 4. Concerns

1. **C1 — MAJOR — Bounded duplicate suppression cannot yet provide the promised permanent late-retry classification.** Claim: after a suppression record is reclaimed, every retry returns `identity-horizon-passed` and never re-executes, while all retained artifacts remain bounded (`llp/0162-agent-safe-storage-profile.rfc.md:249-259,498-504,659-667,713-716`). Evidence: existing ACK processing deletes the identity record (`src/storage.rs:2026-2031`), after which the current lifecycle treats a replay as an ordinary miss; LLP 0043 likewise permits identity GC after acknowledgement and describes later absence as a miss rather than proof of expiry (`llp/0043-function-effect-settlement.rfc.md:247-259,291-302`). With an opaque operation ID and no retained tombstone, trusted issuance epoch, or audience generation, an expired retry is indistinguishable from a never-seen operation once both suppression and compact-envelope records have expired. Resolution: specify a bounded anti-replay primitive—such as structured epoch-bearing identities plus a persisted minimum accepted epoch—or retain a sufficient tombstone until retries are cryptographically impossible. Add an acceptance test after every relevant envelope and suppression record has been reclaimed.

2. **C2 — MAJOR — Authorization is defined for historical row images but not for all facts exposed by explanations and fork diffs.** Claim: explanation joins and fork-diff rows are independently authorized under the LLP 0088 per-version rule (`llp/0162-agent-safe-storage-profile.rfc.md:283-302,487-495,634-652`). Evidence: explanations may expose missing-row reads, query predicates, result membership, authorization decisions, context answers, and effects, while LLP 0088 only defines authorization of current records and historical postimages (`llp/0088-local-sync-core.rfc.md:218-234`). The existing dry-run representation confirms that captured reads include missing rows, queries, predicates, and row sets (`src/host_ops.rs:1697-1725`). Acceptance tests cover joins and row-history authorization but not disclosure policy for those non-row facts (`llp/0162-agent-safe-storage-profile.rfc.md:668-671,700-705`). Resolution: define authorization/redaction rules for each fact class, including pagination and low-entropy digest leakage, and add fail-closed tests under changing principals and grants.

3. **C3 — MATERIAL — The proposed fork capability axis collapses orthogonal properties.** Claim: fork behavior is one class among `Missing`, `DenyAll`, `CaptureOnly`, and `Promotable` (`llp/0162-agent-safe-storage-profile.rfc.md:526-560`). Evidence: LLP 0097 defines branch capability as `Missing | CaptureOnly | Promotable` and isolation as a separate axis (`llp/0097-ephemeral-data-branches.rfc.md:99-101`). `DenyAll` describes egress policy, while `Promotable` describes keep behavior; a deny-all branch can still be promotable when its operation log has no external effects. Resolution: model base, egress policy, keep/promotion capability, isolation scope, and coverage as separate axes, then define `AgentSafeV1` over their product.

4. **C4 — MATERIAL — The “closed” v1 aggregate still has unresolved membership.** Claim: `AgentSafeV1` is a closed aggregate requiring ordinary Ibex, host-plan, branch promotion, bounded history, and proof (`llp/0162-agent-safe-storage-profile.rfc.md:555-564`). Evidence: open question 2 asks whether host-plan must remain mandatory or an Ibex-only variant should be admitted (`llp/0162-agent-safe-storage-profile.rfc.md:801-803`), while host-plan read facts remain client-supplied and Option A is not yet ratified (`llp/0007-storage-portability.rfc.md:445-496`). Resolution: decide the aggregate membership now, or call it provisional and make closure depend explicitly on the host-plan amendment.

5. **C5 — MATERIAL — Target capability and effective application coverage are not connected.** Claim: a target can advertise the aggregate even though actual history coverage is an application opt-in fact outside the target claim (`llp/0162-agent-safe-storage-profile.rfc.md:545-560`). Evidence: this permits `AgentSafeV1` to be true on a target where the application has enabled history for none of the tables an agent needs, making the aggregate insufficient for safe agent planning. Resolution: expose separate target-support and application-effective conformance, including the covered operation/table projection, and reserve the unqualified aggregate for configurations satisfying both.

6. **C6 — MATERIAL — The performance gate contains incompatible baseline definitions and lacks a reproducible statistical contract.** Claim: measurements compare profile-off and profile-on using the same binary and fixture (`llp/0162-agent-safe-storage-profile.rfc.md:602-607`), but the RFC later says there is no supported off mode and defines “off” as a pre-profile baseline binary (`llp/0162-agent-safe-storage-profile.rfc.md:619-621`). Run count, equivalence formula, environment, and the 15% threshold remain unsettled (`llp/0162-agent-safe-storage-profile.rfc.md:622-630,710-712,805-807`); the existing benchmark is explicitly not controlled evidence (`llp/0035-storage-performance-baseline.research.md:33-52`). Resolution: choose one comparison design and pin the baseline artifact, hardware class, fixture, warm-up, repetitions, confidence/equivalence calculation, and thresholds before making performance an acceptance gate.

7. **C7 — MATERIAL — Erasure of materialized checkpoints is a requirement without a mechanism or acceptance test.** Claim: erasure overrides pins and must invalidate or rewrite checkpoint evidence (`llp/0162-agent-safe-storage-profile.rfc.md:498-504`). Evidence: materialized checkpoints are full SQLite copies (`llp/0162-agent-safe-storage-profile.rfc.md:467-485`), potentially offline or independently retained, while the security and acceptance sections do not define discovery, custody, cryptographic destruction, invalidation, or an erasure test (`llp/0162-agent-safe-storage-profile.rfc.md:634-652,700-709`). Resolution: define the checkpoint ownership and erasure protocol, including what happens to receipts and digests, and test both reachable and temporarily unavailable checkpoint copies.

## 5. Suggestions (non-blocking)

- Split follow-on implementation specifications into envelope, fork/promotion, and history/proof documents; these have independent owners and convergence paths.

- Define child transition identities for jobs or actions that produce multiple durable commits, derived from a durable parent identity and stable ordinal.

- Replace “F0a ships exactly `DenyAll`” with wording that distinguishes the accepted scope from implementation already landed (`llp/0162-agent-safe-storage-profile.rfc.md:352-360`).

- Resolve artifact ownership editorially: LLP 0162 or a follow-on spec can own semantics, while LLP 0037 already governs Rust-owned generated carrier schemas (`llp/0037-host-runtime-type-contracts.rfc.md:17-25,73-93`).

## 6. Open questions

- What durable information distinguishes an expired operation identity from a novel identity after every bounded record has been reclaimed?

- Which principal and policy authorize absent-row, predicate, result-membership, context-answer, and effect facts?

- Is `AgentSafeV1` intended to mean platform support, effective application coverage, or both?

- Can a deny-all current-head fork be promotable when its retained log contains no external effects?

- How are erasure obligations enforced for offline or independently copied materialized checkpoints?

## 7. Recommended next step

Revise the RFC to resolve C1 and C2 first, then normalize the capability axes, close the aggregate membership, define application-effective coverage, pin the benchmark protocol, and add checkpoint-erasure acceptance tests. Keep the document Draft and submit that revision for a fresh independent review.

---

## Round 4 — 2026-08-03 (target v0.4, SHA-256 cb8bbf194b6782d28c1efc1eac3a6a5ded1dae26c1e3ffee26be6adbc171f2eb)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context over the working tree at d26f946e; same capsule discipline with the v0.4 SHA; barred from llp/reviews/ and prior rounds; recorded verbatim below.

---

## 1. Overall assessment

I verified that the reviewed bytes have SHA-256 `cb8bbf194b6782d28c1efc1eac3a6a5ded1dae26c1e3ffee26be6adbc171f2eb` and that HEAD is `d26f946ece53e47de8a81b62644f0913227c4a4f`; I reviewed them without consulting `llp/reviews/`. LLP 0162 is a disciplined, credible 80/20 profile: it maps P1–P9 honestly, preserves its stated remainders, stays on stock SQLite, and does not contradict LLP 0088’s merge ruling, LLP 0097’s promotion-by-re-execution requirement, LLP 0158’s F0a/derived-deployment boundary, or LLP 0081’s distinction between inventory and independently derived proof. Its descriptions of the existing implementation are materially accurate. The remaining problems are narrower than the architecture but still load-bearing: the identity-horizon protocol is incomplete, checkpoint proof lacks a snapshot-pinning contract, authorization for retained non-row facts is ambiguous, the supposedly closed aggregate and performance gate retain undecided pass conditions, and promotion identity does not yet rule out branch-incarnation collisions.

## 2. Verdict — NOT READY

The RFC is close, but five unresolved MATERIAL concerns prevent review convergence. Each affects a safety or acceptance boundary the profile presents as normative: exactly-once settlement, independent proof, historical-data authorization, aggregate qualification, or promotion idempotency. These can be resolved within the proposed architecture; no return to maintained Merkle state, general temporal storage, merge machinery, or universal replay is required.

## 3. Strengths

- The P1–P9 mapping is unusually honest about substitutions and deliberate remainder: journal-derived boundary proofs do not masquerade as maintained Merkle state, bounded checkpoints/history do not masquerade as database-wide `AS OF`, and deterministic handler replay does not extend to arbitrary actions ([llp/0162-agent-safe-storage-profile.rfc.md:139–149](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:139), [llp/0161-agent-optimized-storage-engine.research.md:104–205](/Users/ccheever/projects/snapback/llp/0161-agent-optimized-storage-engine.research.md:104)).

- “Covered” is defined by a versioned manifest, complete write-path journaling, and envelope mapping, with missing coverage reported rather than treated as empty proof. That is the right honesty boundary for a profile spanning heterogeneous durable lanes ([llp/0162-agent-safe-storage-profile.rfc.md:153–165](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:153), [llp/0162-agent-safe-storage-profile.rfc.md:413–415](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:413)).

- The existing-foundations account checks out. SQLite commit versions and row journals exist ([src/storage.rs:5593–5615](/Users/ccheever/projects/snapback/src/storage.rs:5593)); Ibex commits validate server-captured row, missing-row, and predicate dependencies ([src/storage.rs:5118–5128](/Users/ccheever/projects/snapback/src/storage.rs:5118), [src/storage.rs:11745–11864](/Users/ccheever/projects/snapback/src/storage.rs:11745)); host plans explicitly validate their client-supplied baseline ([src/storage.rs:3977–4002](/Users/ccheever/projects/snapback/src/storage.rs:3977)); and dry-run already exposes read/write sets and deterministic inputs ([src/host_ops.rs:1610–1664](/Users/ccheever/projects/snapback/src/host_ops.rs:1610)).

- The branch substrate is represented accurately: `MaterializedBase`, the writable overlay, closed `EffectClass`, and capture ledger exist ([src/branches.rs:331–408](/Users/ccheever/projects/snapback/src/branches.rs:331), [src/branches.rs:578–618](/Users/ccheever/projects/snapback/src/branches.rs:578), [src/branches.rs:664–716](/Users/ccheever/projects/snapback/src/branches.rs:664)). The RFC also correctly refuses to call that product-wired isolation.

- The RFC candidly identifies the landed promotion path as nonconforming: the current “operation log” contains post-images and captured effects ([src/branches.rs:778–804](/Users/ccheever/projects/snapback/src/branches.rs:778)), and `promote` applies those post-images directly ([src/branches.rs:897–980](/Users/ccheever/projects/snapback/src/branches.rs:897)). Requiring its replacement with replay-sufficient staged re-execution preserves Accepted LLP 0097 rather than laundering the implementation deviation ([llp/0162-agent-safe-storage-profile.rfc.md:437–469](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:437), [llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:80–87](/Users/ccheever/projects/snapback/llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:80)).

- The proof language correctly applies LLP 0081: new boundaries need domain-separated preimages and independently derived expected values, while unmatched digests remain inventory ([llp/0162-agent-safe-storage-profile.rfc.md:417–435](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:417), [llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:485–535](/Users/ccheever/projects/snapback/llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:485)). It also notices that the shipped `ContentDigestV1` header is migration-shaped ([src/rqs.rs:1047–1118](/Users/ccheever/projects/snapback/src/rqs.rs:1047)).

- The sequencing section respects ownership: it explicitly disclaims implementation authorization, leaves commissioning with LLP 0129/0130/0155, and preserves LLP 0158 F0a as the sole live adjacent lane with deny-all egress and no promotion ([llp/0162-agent-safe-storage-profile.rfc.md:796–827](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:796), [llp/0155-local-sync-product-direction.rfc.md:1075–1081](/Users/ccheever/projects/snapback/llp/0155-local-sync-product-direction.rfc.md:1075), [llp/0158-instance-forking.rfc.md:861–897](/Users/ccheever/projects/snapback/llp/0158-instance-forking.rfc.md:861)).

## 4. Concerns

1. **C1 — MATERIAL — The issuance-epoch floor does not yet define a safe identity-retirement protocol.** The RFC says reclaimed suppression entries remain safe because identities carry an issuance epoch and each audience has a minimum accepted epoch, but it does not define who issues or authenticates epochs, when the floor may advance, how an offline client or host task loses the ability to mint under an old epoch, how restore/reset affects the floor, or whether restamping an old `operationId` into a current epoch is a collision ([llp/0162-agent-safe-storage-profile.rfc.md:240–273](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:240)). Acceptance tests only the already-below-floor retry ([llp/0162-agent-safe-storage-profile.rfc.md:723–730](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:723), [llp/0162-agent-safe-storage-profile.rfc.md:785–789](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:785)). LLP 0043’s current safety relies on exact-cohort acknowledgment before GC and otherwise refuses capacity; operator purge explicitly forfeits exactly-once ([llp/0043-offline-replay-retention.rfc.md:204–212](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:204), [llp/0043-offline-replay-retention.rfc.md:224–259](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:224), [llp/0043-offline-replay-retention.rfc.md:332–352](/Users/ccheever/projects/snapback/llp/0043-offline-replay-retention.rfc.md:332)). Resolve this by specifying an authenticated, monotonic issuer/incarnation protocol; exact floor-advance preconditions; backup, reset, and authority-change behavior; and negative fixtures for offline issuers, concurrent epochs, restored stores, and an old ID restamped into a newer epoch.

2. **C2 — MATERIAL — Materialized-checkpoint proof lacks the snapshot-pinning protocol needed to derive the source digest at the copied version.** The RFC requires the checkpoint path to digest the copy while an independent scanner digests the source “at the same stream-qualified version” ([llp/0162-agent-safe-storage-profile.rfc.md:425–435](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:425)). The existing backup primitive proves that the destination and the version read back from that destination are consistent, even if the source advances ([src/branches.rs:355–377](/Users/ccheever/projects/snapback/src/branches.rs:355)); without database-wide `AS OF`, however, a later independent source scan cannot recover that version. Resolve this by defining how one pinned SQLite source snapshot feeds both the backup and independent scanner, its transaction/WAL lifetime and resource budget, and crash behavior. Acceptance should include concurrent writers before, during, and after backup and prove either same-snapshot equality or a stable refusal.

3. **C3 — MATERIAL — Authorization for retained non-row explanation facts is underspecified and can be read as reusing historical policy as present authority.** For row history the RFC imports LLP 0088’s two gates—authorized for the record now and authorized against each historical post-image—but for missing-row and predicate facts it says only to authorize against the table and lane policy “captured under” ([llp/0162-agent-safe-storage-profile.rfc.md:520–535](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:520)). That wording does not say whether current table/lane authority is also mandatory, how changed or retired policy code is evaluated, or how failure to load the captured policy version behaves. LLP 0088’s ruling is explicitly current-plus-historical ([llp/0088-record-history-and-branching.rfc.md:218–234](/Users/ccheever/projects/snapback/llp/0088-record-history-and-branching.rfc.md:218)), and the RFC itself says historical authority is evidence, never authority ([llp/0162-agent-safe-storage-profile.rfc.md:696–709](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:696)). Resolve this with a normative per-fact authorization table requiring present lane/table admission plus the appropriate captured-fact evaluation, versioned policy custody or fail-closed unavailability, and fixtures covering policy/manifest evolution as well as principal and grant changes.

4. **C4 — MATERIAL — The aggregate and performance acceptance gate are not closed despite being described as closed and executable.** Section 8 says the v1 aggregate is closed and makes host-plan coverage mandatory ([llp/0162-agent-safe-storage-profile.rfc.md:601–608](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:601)), while OQ2 still asks whether to retain that requirement or create an Ibex-only aggregate ([llp/0162-agent-safe-storage-profile.rfc.md:874–878](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:874)). Likewise, the measurement gate calls 15% merely “proposed,” leaves equivalence formulas to a later artifact, and permits ratified exceptions ([llp/0162-agent-safe-storage-profile.rfc.md:681–694](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:681)), while OQ4 still asks what threshold acceptance should use ([llp/0162-agent-safe-storage-profile.rfc.md:881–883](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:881)). Acceptance item 13 consequently has no fixed pass condition ([llp/0162-agent-safe-storage-profile.rfc.md:782–784](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:782)). Resolve this by deciding aggregate membership and ratifying concrete statistical formulas, thresholds, fixture classes, and exception authority—or by naming a prerequisite benchmark Spec whose acceptance must precede any affected capability claim and removing “closed” until then.

5. **C5 — MATERIAL — Canonical promotion identities do not bind a non-reusable branch incarnation.** Promotion derives canonical identities from `(branchId, childVersion, sourceOperationId)` ([llp/0162-agent-safe-storage-profile.rfc.md:193–203](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:193)), but the RFC also requires TTL reaping and branch-local receipt disposal ([llp/0162-agent-safe-storage-profile.rfc.md:343–369](/Users/ccheever/projects/snapback/llp/0162-agent-safe-storage-profile.rfc.md:343)). The current registry enforces `branch_id` and `child_stream_id` uniqueness only among retained registry rows ([src/branches.rs:130–162](/Users/ccheever/projects/snapback/src/branches.rs:130)); neither LLP 0097 nor this RFC declares `branchId` globally non-reusable across teardown, restore, and registry reconstruction. Recreating a branch identifier with the same child version and source ID could therefore collide with a canonical suppression record from an unrelated promotion. Resolve this by deriving the canonical identity from a durable, globally non-reusable branch incarnation—preferably `childStreamId` plus creation identity/base stream—or by normatively requiring collision-resistant non-reuse with retained tombstones. Add teardown/recreation, restore, and repeated-promotion fixtures.

## 5. Suggestions (non-blocking)

- Commit the new promotion, checkpoint, and audit digest domains with golden vectors before wiring any caller; this will keep the generic `ContentDigestV1` label from obscuring incompatible preimages.

- Make the replay-sufficient branch log a named schema with explicit artifact identity, canonical arguments, ctx answers, effect observations, causal dependencies, and redaction/custody classes.

- When implementation begins, remove or quarantine comments that currently call overlay post-images the promotion “replay list” or “op-log”; those descriptions contradict LLP 0097 even though LLP 0162 correctly identifies the deviation ([src/branches.rs:400–410](/Users/ccheever/projects/snapback/src/branches.rs:400), [src/branches.rs:778–804](/Users/ccheever/projects/snapback/src/branches.rs:778)).

- Add manifest conformance fixtures that compare target support with app-effective coverage and prove that missing specialized lanes remain visibly missing.

- Keep the explicit distinction between `DenyAll`, ledger-backed `CaptureOnly`, host-mediated isolation, and end-to-end isolation; it is one of the RFC’s strongest claim-honesty choices.

## 6. Open questions

- Must an app with any uncovered specialized durable lane be denied the unqualified `AgentSafeV1-core` aggregate, or is the aggregate intended to certify only its enumerated ordinary lanes while separately exposing those absences?

- May each target choose independently between an immutable fork base and first-write preimages for exact net diff, provided the receipt names the substrate and the same folding corpus passes?

- Who owns and ratifies performance exceptions: the commissioning program, the capability owner, or the author under a specific LLP 0130 rule?

- Should receipt-only checkpoints without independent verification participate in any aggregate at all, or remain a separately named inventory-only capability?

## 7. Recommended next step

Keep LLP 0162 in Draft and revise it to v0.5: close the epoch/floor protocol, define pinned-snapshot checkpoint proof, specify current-plus-historical authorization for every retained fact class, decide aggregate membership and performance adjudication, and bind promotion identities to a non-reusable branch incarnation. Add the corresponding acceptance fixtures, then run a fresh mutually blind cross-family LLP 0005 review before proposing Review or Accepted status.

---

## Round 5 — 2026-08-03 (target v0.5, SHA-256 8dd7e37be339c846c186693662665f8a0ed0481caf7d6e459e18227a81f6516c)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context; same capsule discipline with the v0.5 SHA; barred from llp/reviews/ and prior rounds; recorded verbatim below.

---

## 1. Overall assessment

The requested SHA-256 matches exactly. LLP 0162 is a thoughtful, bounded realization of LLP 0161: it preserves SQLite, separates inventory from proof, keeps merge out of sync, and accurately identifies substantial existing substrate. Its direction is sound, but several load-bearing contracts remain internally inconsistent or underspecified—especially effect-denial evidence, promotion approval and identity, epoch closure, tiered acceptance, and retention bounds. Those gaps prevent reliable implementation from the current text.

## 2. Verdict — NOT READY

The RFC should remain Draft. The `DenyAll` contradiction and incomplete promotion boundary are major safety defects, while the epoch lifecycle does not establish its claimed no-stranding property. Several material corpus and acceptance inconsistencies also need repair before review convergence. These appear fixable without changing the proposal’s overall architecture.

## 3. Strengths

- The P1–P9 mapping is unusually honest about deliberate remainders, including no maintained Merkle state, general `AS OF`, lenses, or universal action replay (`llp/0162-agent-safe-storage-profile.rfc.md:35`, `:111`, `:139`; compare `llp/0161-agent-optimized-storage-engine.research.md:102`).
- The merge ruling is preserved correctly: promotion is strict-base re-execution, not sync-core or storage merge (`llp/0162-agent-safe-storage-profile.rfc.md:39`, `:491`; `llp/0088-record-history-and-branching.rfc.md:173`; `llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:80`).
- Proof language is disciplined. Runtime digests remain inventory unless an independently derived expected value exists, and new proof boundaries require domain-separated preimages and vectors (`llp/0162-agent-safe-storage-profile.rfc.md:453`, `:464`; `llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:493`, `:533`).
- Existing-foundation claims are substantially accurate: commit versions and row journals exist (`src/storage.rs:5593`, `src/storage.rs:5600`, `src/storage.rs:16587`); durable settlement identity and atomic result recording exist (`src/storage.rs:621`, `src/storage.rs:5462`); Ibex captures row, missing-row, and query dependencies (`src/runtime.rs:2711`, `src/runtime.rs:2753`); dry-run exposes read/write facts and deterministic inputs (`src/host_ops.rs:1610`, `src/host_ops.rs:1879`); and `ContentDigestV1` is implemented with resumable state and vectors (`src/rqs.rs:878`, `src/rqs.rs:1070`).
- The branch-substrate assessment is candid: materialization, overlay and effect-ledger primitives exist, while product wiring does not (`src/branches.rs:341`, `src/branches.rs:449`, `src/branches.rs:578`; `src/server.rs:38934`).
- The RFC correctly identifies the landed `branches::promote` implementation as post-image application inconsistent with LLP 0097 (`llp/0162-agent-safe-storage-profile.rfc.md:512`; `src/branches.rs:933`, `src/branches.rs:956`).
- Acceptance covers difficult cases—crash cuts, identity collision, provenance expiry, randomized net-diff folding, transitive provisional effects, authorization elision, and independent boundary proofs (`llp/0162-agent-safe-storage-profile.rfc.md:820`).

## 4. Concerns

1. **C1 — MAJOR — `DenyAll` cannot satisfy its promotion rule as defined.** The RFC defines `DenyAll` as refusing egress while recording nothing, but later requires any attempted egress to foreclose promotion and proposes fixtures proving the log contains no attempts (`llp/0162-agent-safe-storage-profile.rfc.md:167`, `:525`, `:660`). A handler may catch an egress refusal and still commit branch writes, leaving no durable evidence of the attempt. Resolve this by recording a bounded, payload-free attempt marker, making the refusal terminal and uncatchable for the whole operation, or explicitly allowing reproducible denied attempts during promotion and changing the rule and fixtures.

2. **C2 — MAJOR — The promotion boundary lacks a sealed branch-head approval and complete retry identity.** Promotion compares staged facts with undefined “approved facts,” but no artifact binds the reviewed branch head, operation-log digest, diff digest, coverage manifest, or approver; nor is there a branch-head CAS preventing writes after review (`llp/0162-agent-safe-storage-profile.rfc.md:423`, `:497`, `:519`). The RFC also derives canonical identities per source operation while LLP 0097 requires the replay batch to commit as one canonical transaction/version, leaving the promotion-level envelope and retry receipt ambiguous (`llp/0162-agent-safe-storage-profile.rfc.md:208`; `llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:84`). Define a canonical `PromotionRequestV1` binding the exact child-stream head, log/diff/manifest digests, authority and stable promotion identity; require branch-head CAS or sealing; and specify whether the canonical transaction writes one aggregate envelope, per-source envelopes sharing one version, or both.

3. **C3 — MATERIAL — The epoch-closure protocol does not prove its claimed no-stranding property.** Client operations are minted before first attempt, but an epoch closes after its issuer terminates and all *admitted* identities settle (`llp/0162-agent-safe-storage-profile.rfc.md:253`, `:279`). A client-minted operation delayed before admission is invisible to that closure test and can later fall below the advanced floor, contradicting “stranding impossible by construction” (`llp/0162-agent-safe-storage-profile.rfc.md:287`). Add a mint-range/high-water closure handshake or server-recorded issuance, or weaken the claim and explicitly classify delayed never-admitted operations as outcome-unknown. Acceptance must cover an identity minted before issuer termination but first delivered after floor advancement.

4. **C4 — MATERIAL — Tiered capability claims and global acceptance are not reconciled.** `AgentSafeV1-core` is presented as independent of the LLP 0088-gated history tier, yet the acceptance preamble says the profile is unimplemented until all criteria pass, including history and checkpoint requirements (`llp/0162-agent-safe-storage-profile.rfc.md:687`, `:700`, `:820`, `:885`). This makes the core hostage to the tier it claims not to require. Add a normative matrix mapping each capability and aggregate tier to its semantic acceptance rows and performance metrics.

5. **C5 — MATERIAL — Owner pins reopen indefinite history despite the explicit non-claim and LLP 0088’s finite-retention rule.** The RFC disclaims indefinite history and imports LLP 0088’s bounded design, but later permits retention without a bound when an owner “pins and pays” (`llp/0162-agent-safe-storage-profile.rfc.md:118`, `:562`, `:613`). LLP 0088 requires finite max-age and max-version bounds with no unbounded v1 option (`llp/0088-record-history-and-branching.rfc.md:195`). Restrict history pins to finite renewable leases, or state that only independently materialized checkpoint copies—not history rows—may outlive the history window.

6. **C6 — MATERIAL — Credential-isolation acceptance is not fork-class-specific.** The design distinguishes scrubbed derived deployments from in-app branches carrying branch-scoped authority, while LLP 0097’s in-app branch shares the parent auth and secrets namespaces (`llp/0162-agent-safe-storage-profile.rfc.md:352`, `:383`; `llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:47`). Acceptance nevertheless requires canonical credentials to be “absent from the fork” without naming a class (`llp/0162-agent-safe-storage-profile.rfc.md:859`). Specify derived-deployment credential absence separately from in-app capability non-reachability and branch-scoped authority.

7. **C7 — MATERIAL — LLP 0130 is not presently an exception authority for this performance gate.** The RFC allows threshold replacement and exceptions through “LLP 0130’s standing-decision mechanism” (`llp/0162-agent-safe-storage-profile.rfc.md:785`). LLP 0130 contains specific bounded standing decisions, and SD-4 only accepts commissioned documents (`llp/0130-program-standing-decisions.decision.md:61`). It supplies no general authority to alter LLP 0162 performance thresholds. Require a direct dated author adjudication or an explicit LLP 0130 amendment; do not describe the current document as existing exception authority.

8. **C8 — MATERIAL — The claim that every design behind the core is Accepted or owned here is false.** The core depends on host-plan provenance and ordinary mutation identity/retention contracts in LLP 0007, 0043 and 0051, all Draft; LLP 0007 also still labels Option A pending ratification (`llp/0162-agent-safe-storage-profile.rfc.md:687`; `llp/0007-storage-portability.spec.md:3`, `:483`; `llp/0043-offline-replay-retention.rfc.md:506`; `llp/0051-language-neutral-data-tier.rfc.md:3`). Remove that assertion or enumerate the dated owner amendments and their required status/evidence before the aggregate can advertise.

9. **C9 — MINOR — The sequencing cross-reference is stale.** The in-app `DenyAll` prerequisite is called sequencing step `3(a)`, but mediation is step `5(a)` (`llp/0162-agent-safe-storage-profile.rfc.md:414`, `:942`). Correct the reference.

## 5. Suggestions (non-blocking)

- Split the envelope, promotion/fork, and history/checkpoint contracts into independently reviewable follow-on Specs; the RFC exceeds LLP 0005’s approximate large-document threshold and already has independently gated tiers.
- Add one capability matrix covering fork class, egress policy, promotion, credential posture, required owners, acceptance rows, and performance metrics.
- Require materialized checkpoints to reuse an explicit backup-custody profile, including encryption/private-file handling and protection against booting credential-bearing copies.
- Qualify “strong P9” to reflect that ordinary-mutation fencing and read-side auditing remain deliberate remainders.

## 6. Open questions

1. Which exact boundary proof satisfies `AgentSafeV1-core`: promotion proof alone, or must migration and checkpoint domains also pass?
2. Are history/detail pins finite renewable leases, and what maximum duration remains mandatory?
3. Which concrete SQLite snapshot protocol lets both backup and independent scanning consume one pinned snapshot without an unbounded WAL pin?
4. Does a promotion produce one aggregate envelope, one envelope per replayed source operation, or both?
5. Which follow-on document owns the envelope, promotion-request, disposition, and capability-extension schemas?

## 7. Recommended next step

Revise LLP 0162 to close C1–C8, add the per-tier conformance matrix, and run a fresh independent review of the resulting bytes. Keep the RFC at Draft until those contracts are explicit and testable.

---

## Round 6 — 2026-08-03 (target v0.6, SHA-256 f4fd64274a2ec7646d1950073e1f40da14ea899d94b9ecefe94baab128c6273c)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context; same capsule discipline with the v0.6 SHA; barred from llp/reviews/ and prior rounds; recorded verbatim below.

---

## 1. Overall assessment

The reviewed bytes match SHA-256 `f4fd64274a2ec7646d1950073e1f40da14ea899d94b9ecefe94baab128c6273c`. LLP 0162 is a thoughtful, substantially honest profile: its P1–P9 mapping is faithful to LLP 0161, its non-claims are disciplined, and its description of the existing SQLite, journal, read-capture, settlement, digest, and branch foundations is accurate. It also correctly preserves LLP 0088’s no-sync-merge ruling, LLP 0097’s promotion-by-re-execution rule, LLP 0158’s derived-deployment boundary, and LLP 0081’s inventory-versus-proof distinction. The proposal nevertheless has unresolved load-bearing gaps in offline operation identity, checkpoint publication, promotion liveness, and aggregate composition. Those gaps affect claimed safety and executable acceptance rather than merely follow-on schema naming.

## 2. Verdict — NOT READY

The architecture is promising, but this Draft is not ready for convergence. Three MAJOR issues prevent implementing or falsifying central guarantees: the server-recorded identity-epoch protocol does not compose with offline client minting as specified; materialized-checkpoint crash atomicity is asserted without a publication protocol; and bounded progress under contention lacks the conditions needed to make it true. Additional MATERIAL inconsistencies leave promotion retry identity, the derived-deployment core dependency, and the promotion proof domain ambiguous. These should be resolved in the governing design before acceptance.

## 3. Strengths

- The P1–P9 profile is unusually honest about both its realizations and deliberate remainders, including no maintained Merkle state, database-wide `AS OF`, general lenses, or universal action replay (`llp/0162-agent-safe-storage-profile.rfc.md:141-151`; `llp/0161-agent-optimized-storage-engine.research.md:104-205`).

- The “existing foundations” account is well supported by the tree: the row journal and settlement table exist (`src/storage.rs:5600-5645`); Ibex captures row, missing-row, and predicate/query reads (`src/runtime.rs:2711-2808`) and validates them at commit (`src/storage.rs:11745-11864`); and dry-run exposes captured read/write facts and deterministic inputs (`src/host_ops.rs:1610-1667`).

- The branch-substrate characterization is accurate. `MaterializedBase` uses SQLite backup and reads the base version from the copied pages (`src/branches.rs:341-378`); the COW divergence and effect ledgers exist (`src/branches.rs:400-535`, `src/branches.rs:578-715`). The RFC is commendably explicit that this is landed-but-unwired substrate, not a shipped profile.

- Promotion correctly adopts LLP 0097’s strict-CAS, staged re-execution contract and rejects sync-core merge (`llp/0162-agent-safe-storage-profile.rfc.md:539-565`; `llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:80-87`; `llp/0088-record-history-and-branching.rfc.md:173-188`). It also accurately discloses that the current implementation applies post-images directly (`src/branches.rs:951-980`).

- The proof posture is strong: ordinary diff digests are called inventory, while proof requires an independently derived expected value and a domain-specific preimage (`llp/0162-agent-safe-storage-profile.rfc.md:488-537`). This matches the actual migration proof’s expected-versus-actual comparison (`src/storage/migration_executor.rs:3292-3315`) and does not overgeneralize the migration-shaped `ContentDigestHeaderV1` (`src/rqs.rs:1070-1094`).

- Retention and authorization preserve the important LLP 0088 constraints: bounded independent clocks, no history pinning of the sync floor, current-plus-per-version row authorization, and explicit erasure obligations (`llp/0162-agent-safe-storage-profile.rfc.md:623-691`; `llp/0088-record-history-and-branching.rfc.md:190-234`).

- Sequencing is appropriately non-commissioning and owner-aware (`llp/0162-agent-safe-storage-profile.rfc.md:1024-1062`). It correctly recognizes LLP 0158 F0a as the sole live adjacent lane and preserves its deny-all, no-capture-ledger, no-promotion cut (`llp/0158-instance-forking.rfc.md:861-897`).

## 4. Concerns

1. **C1 — MAJOR: The bounded identity-epoch protocol is not closed for offline-minted operations.** The RFC requires client operations to carry an identity before their first attempt (`llp/0162-agent-safe-storage-profile.rfc.md:271-283`), while the shipped offline contract durably enqueues an intent and client-local sequence before reconnect (`llp/0043-offline-replay-retention.rfc.md:165-190`, `llp/0043-offline-replay-retention.rfc.md:224-254`). Yet epoch closure assumes the server has durably recorded the mint high-water and can reason about every minted-but-never-delivered identity (`llp/0162-agent-safe-storage-profile.rfc.md:297-315`). An offline client cannot update a server high-water at mint time, and the RFC defines neither authenticated finite ranges nor a monotone counter/closure handshake by which the server can enumerate or conservatively bound those identities. Consequently, the delayed-first-delivery acceptance case is not implementable as written (`llp/0162-agent-safe-storage-profile.rfc.md:929-936`). Resolve this with a closed protocol—such as server-preallocated authenticated finite counter ranges, atomic client counter persistence, an explicit last-issuable bound, lost-store/epoch-closure rules, and crash vectors—or split offline-minted operations out of the reclaimable P8 class.

2. **C2 — MAJOR: Materialized-checkpoint crash atomicity is asserted without a publication state machine.** The RFC says a crash leaves either no checkpoint or a complete verified one (`llp/0162-agent-safe-storage-profile.rfc.md:523-537`) and requires checkpoint receipts and copies to survive crash/reopen (`llp/0162-agent-safe-storage-profile.rfc.md:991-1004`). The cited implementation primitive only opens the destination, runs SQLite backup, and returns it; it defines no staged pathname, fsync order, atomic publication point, receipt/registry reconciliation, orphan handling, or recovery rule (`src/branches.rs:362-377`). LLP 0158 demonstrates why an external SQLite copy needs those decisions explicitly, including staging sentinels, rename, directory fsync, and recovery by the rename’s verdict (`llp/0158-instance-forking.rfc.md:421-490`). Resolve this by specifying or normatively importing an equivalent checkpoint-specific publication state machine, including receipt linearization and crash cuts, before retaining the none-or-complete claim.

3. **C3 — MAJOR: The bounded-progress promotion guarantee is neither defined nor generally true under the stated scheduler.** LLP 0162 serializes promotion attempts and inherits FIFO tickets across rebases, then claims bounded progress for all forks under a “steady arrival rate” (`llp/0162-agent-safe-storage-profile.rfc.md:598-612`; acceptance at `llp/0162-agent-safe-storage-profile.rfc.md:985-990`). It gives no service-rate assumption, upper bound on replay/review work, ticket lifetime, relationship to fork TTL, or formula connecting the rebase budget to `k`. More importantly, it serializes only promotion admission: ordinary canonical mutations can keep advancing the head and make every rebased promotion lose indefinitely. Resolve this with a closed liveness model—defining which head-advancing operations share admission, an explicit `arrival < service` condition, finite work bounds, ticket/TTL behavior, and a worst-case attempt/time bound—or weaken the claim to conditional fairness without bounded eventual progress.

4. **C4 — MATERIAL: Promotion has two insufficiently reconciled canonical identity models.** Section 1 says promotion deterministically mints canonical identities per `(childStreamId, sourceOperationId)` and that retrying “the canonical identity” returns the canonical receipt (`llp/0162-agent-safe-storage-profile.rfc.md:225-234`). Section 5 instead defines one aggregate envelope keyed by a separate promotion identity, with per-source join records and the aggregate envelope as the retry receipt (`llp/0162-agent-safe-storage-profile.rfc.md:567-579`). Acceptance retains the singular ambiguity (`llp/0162-agent-safe-storage-profile.rfc.md:980-983`). It is therefore unclear which identity participates in duplicate suppression, collision comparison, retention floors, and receipt lookup. Resolve this by selecting one primary model and specifying the other as non-admissible provenance joins, or by defining atomic alias/suppression records mapping every per-source derived identity to the aggregate receipt, including collision and GC semantics.

5. **C5 — MATERIAL: `AgentSafeV1-core` implicitly depends on LLP 0158 while claiming no core component depends on an undecided design.** Rows 5–10 gate the core (`llp/0162-agent-safe-storage-profile.rfc.md:913-918`), and rows 5 and 7 explicitly require proof for both the in-app and derived-deployment classes (`llp/0162-agent-safe-storage-profile.rfc.md:951-963`). Yet the core dependency table omits LLP 0158 and says no core component depends on an undecided decision (`llp/0162-agent-safe-storage-profile.rfc.md:757-779`), even though the derived-deployment vocabulary and mechanics come from still-Draft LLP 0158 (`llp/0162-agent-safe-storage-profile.rfc.md:389-417`). Resolve this by making derived deployment a separately advertised additive tier/capability, leaving core as the in-app branch class, or by declaring LLP 0158 acceptance an explicit core dependency and adding it to the dependency matrix.

6. **C6 — MATERIAL: The core-required promotion proof domain remains a requirement to design, not a design an implementer can execute.** Core requires promotion boundary proof (`llp/0162-agent-safe-storage-profile.rfc.md:757-766`), and acceptance requires independently derived expected and actual values under a boundary-specific preimage (`llp/0162-agent-safe-storage-profile.rfc.md:999-1004`). The RFC correctly notes that the shipped header is migration-specific, but it only instructs a future specification to define the promotion preimage and golden vectors (`llp/0162-agent-safe-storage-profile.rfc.md:516-523`); artifact ownership is itself open (`llp/0162-agent-safe-storage-profile.rfc.md:1121-1127`). Resolve this by defining the exact promotion digest domain, canonical header/preimage, expected-state derivation, actual-state scan, coverage binding, and golden vectors here, or by making an accepted focused proof Spec a named prerequisite rather than labeling the component decided here.

7. **C7 — MINOR: Performance exception authority is internally inconsistent.** The normative section says only the author, through a dated revision to LLP 0162, may change or except the budget and explicitly says LLP 0130 does not cover this RFC (`llp/0162-agent-safe-storage-profile.rfc.md:871-883`). OQ4 then says the author may change the threshold “under LLP 0130’s mechanism” (`llp/0162-agent-safe-storage-profile.rfc.md:1116-1120`). LLP 0130 SD-4 applies only to commissioned documents within its scope (`llp/0130-program-standing-decisions.decision.md:61-72`). Resolve by making OQ4 cite the dated-revision authority in the performance section, unless a new LLP 0130 standing decision is actually adopted.

## 5. Suggestions (non-blocking)

- Split the approximately 1,150-line RFC into an umbrella plus independently reviewable envelope/identity, fork/promotion, and history/checkpoint/proof documents. The components already have independent advertisement timelines (`llp/0162-agent-safe-storage-profile.rfc.md:842-848`), matching LLP 0005’s split guidance (`vendor/llp/llp/0005-rfc-process.guide.md:101-103`).

- Consider public naming such as “covered-lane commit envelope”; “universal” is internally qualified correctly but is likely to be quoted without the coverage fence.

- Pre-register numeric read-path equivalence bounds and idle-observation tolerances in the step-0 protocol so “no regression” and “no new idle writes” cannot depend on measurement resolution chosen afterward.

- Preserve the existing post-image promotion deviation as a named filesystem ticket and require its closure reference in the capability evidence.

## 6. Open questions

- Whether offline clients receive finite authenticated identity ranges, or whether offline-minted operations form a distinct non-reclaimable identity class.

- Whether the core aggregate covers only LLP 0097 in-app branches or also LLP 0158 derived deployments.

- Whether promotion admission can fence or coordinate ordinary canonical writers, or whether its liveness claim must remain conditional on quiescent/limited canonical writes.

- Which focused owner defines the envelope schemas, promotion replay log, proof domains, retention dispositions, and capability extension before any component can advertise support.

## 7. Recommended next step

Revise LLP 0162 to close C1–C3 with explicit protocols and executable bounds, reconcile C4–C6 into one unambiguous capability/dependency design, and correct C7. Prefer extracting the identity/envelope, promotion, and checkpoint/proof contracts into focused numbered LLPs while retaining LLP 0162 as the profile umbrella. Then run a fresh cross-family LLP 0005 review against the revised bytes before moving the RFC from Draft.

---

## Round 7 — 2026-08-03 (target v0.7, SHA-256 2145942d7af59d4e24caf1acd7e9402e73b4b9aabaf8201043f85e33dc6ecb1e; delta-scoped final round)

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, codex exec, model gpt-5.6-sol, model_reasoning_effort=xhigh, sandbox read-only
**Date:** 2026-08-03
**Redacted:** no
**Method:** fresh non-author codex exec context; same capsule discipline with the v0.7 SHA plus the delta-scope instruction; barred from llp/reviews/ and prior rounds; recorded verbatim below.

---

## 1. Overall assessment

The target SHA-256 matches `2145942d7af59d4e24caf1acd7e9402e73b4b9aabaf8201043f85e33dc6ecb1e`, and the checkout is at `d26f946ece53`. The architecture is coherent and honestly bounded: it preserves SQLite, distinguishes the two fork classes, keeps merge outside sync, maps P1–P9 without claiming the ideal remainder, and accurately characterizes the implementation foundations. The v0.7 revisions substantially improve capability honesty, checkpoint claims, identity partitioning, and program ownership. However, fresh review finds unresolved correctness gaps in identity reclamation, promotion re-sealing, journal-completeness derivation, authorization after explanation-detail expiry, and the conditional-fairness contract. These are concentrated in the changed contracts rather than the converged architecture.

## 2. Verdict — NOT READY

The RFC should remain Draft. Most of the design is ready for convergence, but C1 permits duplicate execution after the last identity marker is reclaimed while its epoch remains open; C2 allows automatic promotion re-sealing across changes LLP 0097 says require renewed approval; and C3 does not yet turn the journal-completeness registry into an enforceable completeness proof. C4 is also a privacy-contract contradiction. These affect P8, promotion safety, exact-diff honesty, and authorization—the profile’s central guarantees—not optional refinements.

## 3. Strengths

- The P1–P9 mapping is unusually honest about strength and remainder (`llp/0162-agent-safe-storage-profile.rfc.md:35-45`, `:141-151`) and agrees with the parent derivation (`llp/0161-agent-optimized-storage-engine.research.md:104-205`).

- Corpus boundaries are respected: promotion is strict re-execution, not merge (`llp/0162-agent-safe-storage-profile.rfc.md:574-600`); derived deployments remain non-promotable (`:410-427`); and commissioning stays with LLP 0155/0130 while F0a remains the live adjacent lane (`:1098-1108`).

- The implementation-foundation claims are accurate. SQLite commit allocation, validation, journal writes, and head advancement share transactions (`src/storage.rs:3977-4002`, `:4114-4122`, `:5118-5128`, `:5204-5212`); dry-run exposes captured reads, writes, result, and deterministic inputs (`src/host_ops.rs:1610-1668`, `:1879-1916`); and the migration proof independently derives expected state (`src/storage/migration_executor.rs:2956-2961`) before using the shipped digest implementation (`src/rqs.rs:1070-1149`).

- The branch-substrate description is candid. `MaterializedBase` really is a writable snapshot (`src/branches.rs:341-377`), overlay recording currently leaves the physical write to its caller (`:466-471`), effect classes and a capture ledger exist (`:578-715`), and current promotion does apply recorded writes directly (`:951-980`), matching the RFC’s deviation disclosure.

- The checkpoint revision correctly narrows its claim to verified copy fidelity at one pinned snapshot, rather than laundering digest equality into LLP 0081-style predecessor-derived proof (`llp/0162-agent-safe-storage-profile.rfc.md:539-572`; LLP 0081’s governing distinction is at `llp/0081-reviewed-storage-evolution-and-migrations.rfc.md:493-535`).

- The capability split is conservative and useful: derived deployments are additive rather than core, `Promotable(noEffects)` is explicitly narrower, and its legacy projection fails weak rather than overstating support (`llp/0162-agent-safe-storage-profile.rfc.md:767-863`).

## 4. Concerns

1. **C1 — MAJOR. The epoch floor does not prevent duplicate execution once one identity’s final marker disappears while another identity keeps the same epoch open.** Reclamation may remove an acknowledged identity’s suppression record (`llp/0162-agent-safe-storage-profile.rfc.md:296-301`), and the independently timed compact envelope can later disappear (`:339-354`). But the epoch cannot close or move below the floor while any other identity in its ranges remains unacknowledged (`:314-330`). Thus, with identities A and B in one epoch, A may be acknowledged and lose both records while B holds the epoch open; retrying A is neither a ledger hit nor below-floor and can execute as novel. This contradicts the claim that the floor covers the “both records gone” regime (`:339-345`) and Acceptance 2 (`:990-1004`). Resolve by retaining a payload-free last marker until the relevant floor has advanced, using per-range/per-identity floors, or prohibiting final-marker reclamation while the epoch remains admissible. Add a two-identity/same-epoch fixture, define host-originated epoch closure separately, and specify `result-expired` versus `identity-horizon-passed` lookup precedence.

2. **C2 — MAJOR. `PromotionRequestV1` re-seals on a comparison narrower than LLP 0097’s meaning-preservation rule.** Automatic re-sealing compares only write-set, effect-set, and coverage-manifest digests (`llp/0162-agent-safe-storage-profile.rfc.md:603-616`). A re-execution can read different facts or return a different application result while producing the same final writes and effects; such divergence is not necessarily visible in the state diff promised at `:628-633`. LLP 0097 explicitly requires comparison of canonicalized decisions and relevant read/output facts, with renewed approval on divergence (`llp/0097-ephemeral-data-branches-and-effect-isolation.rfc.md:84-86`). Resolve by binding the approved-facts digest to normalized decision/result facts, relevant read dependencies, retained ctx answers, writes, effects, artifact, and coverage. Preserve the original approver signature over that digest and make re-sealing a separately identified engine attestation, not a new approval attributed to the original signer. Acceptance 10 needs a fixture where writes/effects remain equal but reads or return values diverge.

3. **C3 — MAJOR. The proposed write-path registry is a classification scheme, not yet a journal-completeness derivation.** Coverage requires a proof for every lane write path (`llp/0162-agent-safe-storage-profile.rfc.md:157-164`), but §4 merely states that a build sweep will detect unregistered paths and runtime will refuse them (`:522-529`). `EffectClass::classify` only rejects callers that actually invoke it (`src/branches.rs:603-616`); it cannot detect an egress or SQL write that bypasses the classifier. Existing journal coverage is manually paired with physical writes (`src/storage.rs:4105-4122`), and branch overlay recording explicitly makes physical mutation the caller’s responsibility (`src/branches.rs:466-471`). Resolve by defining an enforceable write-authority choke point—such as an unforgeable lane writer token, SQLite authorizer/trigger enforcement, or generated transaction API—plus the registry’s unit, discovery mechanism, bypass prevention, and compile/runtime negative fixtures. Acceptance 4’s fixture enumeration alone cannot establish completeness.

4. **C4 — MAJOR. Per-fact current-policy authorization cannot be enforced from the compact explanation after detail expires or is truncated.** The compact identity permanently retains aggregate digests and counts, and §2 promises to return them after detail expiry or truncation (`llp/0162-agent-safe-storage-profile.rfc.md:378-395`). Section 6 instead requires current policy to authorize each retained non-row fact (`:705-726`), while the security section says to fail closed when policy cannot be proved (`:953-970`). Once constituent facts are gone, the server cannot evaluate their current policies or construct an authorized filtered aggregate; returning original counts or membership digests can disclose facts whose detail is no longer authorized. Resolve by defining whole-operation fail-closed behavior for unverifiable aggregates, retaining authorization-class-partitioned commitments, or returning only non-sensitive operation metadata with an explicit `authorization-unprovable` disposition. Add expired and truncated-detail fixtures under changed grants to Acceptance 3.

5. **C5 — MATERIAL. The conditional-fairness parameters do not imply the bounded progress Acceptance 10 claims.** The rebase-budget floor is only the observed concurrent-fork count, while head reservation begins after `R` consecutive losses (`llp/0162-agent-safe-storage-profile.rfc.md:639-665`). With `k = 1` and `R > 1`, one ordinary writer can exhaust the minimum budget before reservation becomes reachable. Likewise, “finite replay work” does not ensure completion before the branch TTL or within the bounded reservation interval. Acceptance nevertheless requires bounded eventual progress for all `k` forks (`:1055-1064`). Resolve with a formula tying budget to queue position, `R`, canonical-write losses, and retries; a TTL lower bound or renewal rule; a maximum promotion-commit duration; and a defined result when reservation expires mid-attempt. Bound reservation frequency so an agent cannot repeatedly impose unmeasured ordinary-write latency.

6. **C6 — MATERIAL. The acceptance-to-component performance mapping contradicts the measurement gate.** The measurement section says each applicable metric gates the component it measures (`llp/0162-agent-safe-storage-profile.rfc.md:906-925`), but the Acceptance preface assigns row 13 only to envelope/explanation, while fork, history, checkpoint, and proof components are mapped without their performance gate (`:975-982`). That permits those components to advertise after functional rows pass despite failing their own measured budgets. Resolve by stating that row 13’s applicable submetrics gate every component and tier, with the complete metric set gating the aggregate.

7. **C7 — MINOR. Checkpoint copy fidelity lacks an unambiguous capability value.** Section 4 says it is not LLP 0081-style boundary proof (`llp/0162-agent-safe-storage-profile.rfc.md:550-556`), yet Acceptance 12 groups it under “Boundary proof” (`:1073-1080`) and §8 offers only inventory versus independent boundary proof (`:799-800`). Add a distinct `verifiedCopyFidelity` proof/receipt class or split the checkpoint fixture from the boundary-proof row so projections cannot accidentally upgrade the narrower claim.

## 5. Suggestions (non-blocking)

- Extract identity/envelope, fork/promotion, and checkpoint/proof into focused Specs after resolving the findings. At 1,241 lines with independent prerequisite timelines, LLP 0005’s large-document guidance applies (`vendor/llp/llp/0005-rfc-process.guide.md:101-103`).

- Put the identity lifecycle and promotion scheduler into explicit transition tables and run model/property tests over crash, expiry, acknowledgement, retry, rebase, and reservation interleavings.

- Resolve OQ5 in favor of LLP 0037’s Rust-owned artifact-schema pattern unless a concrete non-Rust owner emerges; it already governs Snapback-owned shared artifacts (`llp/0037-schema-source-of-truth.decision.md:73-93`).

- Add one complete example capability manifest showing core, history, checkpoint-copy-fidelity, derived-deployment, and legacy projections together.

## 6. Open questions

- Is the aggregate promotion identity client-minted or host-derived, and which epoch/closure protocol governs it across automatic re-sealing?

- Does re-sealing preserve an original signed approval plus a new server attestation, or mutate one approval artifact in place?

- Can SQLite’s backup API and an independent scanner actually share one held source snapshot within a bounded WAL budget, and what stable refusal occurs if they cannot?

- What exact aggregate information, if any, remains safely discloseable when constituent explanation facts have expired or changed authorization?

- What bounds protect ordinary canonical writers from repeated promotion head reservations while still delivering the conditional fairness claim?

## 7. Recommended next step

Revise to v0.8 while remaining Draft: close the last-marker/epoch invariant, widen and attest the promotion re-seal comparison, specify an enforceable journal write-authority seam, define authorization behavior for expired aggregates, and make the scheduler and performance gates algebraically testable. Add the named adversarial fixtures to Acceptance 2, 3, 4, 10, 12, and 13, then obtain a fresh targeted non-author review of those changed contracts; any status transition remains the author’s decision.
