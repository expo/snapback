# LLP 0292: The straight path — rebuilding the authority surface

**Type:** Plan
**Status:** Draft
**Systems:** Security/authorization, Storage, Auth, Rust core, Packaging, Verification
**Author:** codex `gpt-5.6-sol`, commissioned by Claude (Opus 5) orchestrating LLP 0283 F-1,
for Charlie Cheever
**Date:** 2026-08-20
**Revised:** 2026-08-20 (a — initial straight-path plan)
**Related:** LLP 0283 (F-1), LLP 0285 (§2 rulings 5-7; superseded in part), LLP 0291,
LLP 0284, LLP 0225, LLP 0214, LLP 0059, LLP 0041, LLP 0036

## Why this document exists

LLP 0291 enumerated the authority-forgery surface: **30 no-feature families, 16 more behind
additive features, no chokepoint**, authority creation split across ~11 independent
mechanisms. That materially exceeds LLP 0285 §6 step 6, which planned to convert four
admissions.

The author then asked whether, given willingness to break backwards compatibility and
jettison code, there is a faster and straighter path to the right end state — and ruled to
take it (LLP 0285 §2 ruling 5). The licensing fact is `CLAUDE.md:160`: *"No current users
depend on stability; expected users are agents who read the docs."*

This is that plan. It supersedes LLP 0285 §6's fifteen-step migration for the forgery half.

## The counterargument, stated first

The strongest case against this plan is that **the 46 families encode more semantic diversity
than their shared forgery mechanism suggests**. A flag-day diff can make an omitted source,
deadline check, publication fence or ambiguity rule harder to see, and there is no compiler
proof of those semantics — LLP 0283 Method lesson 4 says compile-first repair works for
structure and *not* for security surface. Eleven review rounds demonstrate the surface is
genuinely difficult, not merely that the migration strategy was poor.

That argument is substantial, and it shapes this plan rather than being dismissed by it:
**the fence algorithms are not rewritten, and the family census is not skipped.** Every family
is mapped, every exact sink reviewed, and all existing concurrency evidence must stay green.

What it does not justify is keeping a forgeable authority API alive while 46 adapters are
built around it. With no installed base to protect, preserving that API is the greater risk
and the larger cost.

## Standing rulings this plan implements

- **Ruling 5** — delete and rebuild rather than migrate.
- **Ruling 6 (Q1-C)** — `config.verify` becomes a restricted probe kind, not a `System` lane.
- **Ruling 7 (Q2-A)** — the administrator anchor is required outright; no derivation, no
  grace period, no digest-at-open.

## Constraints ruling 5 does NOT relax

Anything **already published to npm is immutable forever** (LLP 0041). **Durable local
databases** — demos, dev instances, fixtures, goldens — are real, though mostly regenerable;
this plan breaks the local store format deliberately and regenerates disposable state, and
what breaks is enumerated below rather than waved at.

---

# Design: F-1 Authorization Reset

**Status:** Proposed  
**Date:** 2026-08-20  
**Scope:** Remaining LLP 0283 F-1 authorization program  
**Decision:** Replace the distributed authority-creation surface in one breaking cut. Preserve the existing authorization-transition and publication-fence semantics, but do not preserve the APIs, compatibility adapters, or legacy database format that currently expose them.

## 1. Executive decision

Yes: there is a faster and straighter path to the best end state.

Snapback should perform a scoped flag-day replacement of its authority model:

1. Delete the present authority vocabulary and every way of manufacturing it.
2. Introduce one kernel-owned authority derivation module.
3. Reconnect callers by five evidence classes, not by migrating 46 forgery families through compatibility adapters.
4. Preserve the session, service-token, room, outbox, rollback, and ambiguous-commit algorithms whose complexity protects real concurrency.
5. Require a new administrator anchor and a new store format. Do not derive either from legacy state.
6. Regenerate demos, fixtures, goldens, schemas, and guide examples.
7. Publish a breaking npm closure after full qualification.

This is not a rewrite of Snapback, SQLite storage, the runtime, auth protocols, or realtime. It is a replacement of the authority-creation layer and its public types.

The key distinction is:

> Break compatibility aggressively around who may create authority. Preserve semantics aggressively around what happens during revocation, commit, rollback, and final publication.

LLP 0285 already contains the correct permanent principle: “the kernel derives, never accepts” (`llp/0285-kernel-authorization-closure.spec.md:49`). Its mistake is primarily the compatibility-preserving path chosen to reach that state.

## 2. Evidence and premise

### 2.1 Verified

The no-installed-base premise is real:

- The author ruling says, “No current users depend on stability; expected users are agents who read the docs” (`CLAUDE.md:157`).
- The current workspace is defined by `crates/*` (`Cargo.toml:1`). This checkout contains 14 workspace crates, not 16, and all 14 set `publish = false` at line 6 of their manifests—for example, `crates/snapback/Cargo.toml:6` and `crates/snapback-kernel/Cargo.toml:6`.
- The post-rearchitecture npm publication was deliberately withheld because published packages are immutable and contain the sealed binary (`llp/0283-post-rearchitecture-followups.plan.md:47`).
- Older npm artifacts do exist: the current publication registry records 0.1.24 as the newest published closure (`guide/published-closure.json:5`). Those exact bytes are historical and cannot be retroactively changed.
- A packaged runtime includes both a sealed native binary and an immutable admin snapshot from the same source revision (`llp/0041-packaged-dev-loop.rfc.md:458`).
- LLP 0283 says the reachability half landed, while the forgery half and publication remain open (`llp/0283-post-rearchitecture-followups.plan.md:53`).

The current source also independently confirms the architectural problem:

- `ResolvedAppAuthority` remains a public, cloneable enum containing public `AdminBypass` and `System` variants (`crates/snapback-sync/src/auth/invocation.rs:294`).
- The registry currently has 48 invocation sources (`crates/snapback-sync/src/auth/invocation.rs:1031`).
- The nominal shared gate accepts the caller’s already-resolved authority and then constructs `PreparedAuthority` (`crates/snapback-sync/src/auth/invocation.rs:1940`).
- Cron and job staging explicitly pass `ResolvedAppAuthority::System` through that gate (`crates/snapback-engine/src/local/engine.rs:20904`, `crates/snapback-engine/src/local/engine.rs:20927`).
- `config.verify` enters the same generic System action path (`crates/snapback-engine/src/local/engine.rs:21600`, `crates/snapback-engine/src/local/engine.rs:21650`).

This corroborates LLP 0283’s diagnosis that the crate structure is enforced but the authorization model is not (`llp/0283-post-rearchitecture-followups.plan.md:22`).

### 2.2 Source limitation

The inspected checkout did not contain `llp/0291-authority-forgery-surface.research.md` or a local/remote-tracking `lane/f1-forge` ref. Network fetch was unavailable. Therefore:

- The exact “30 no-feature, 16 feature-gated, approximately 11 mechanisms” enumeration and the “eleven review rounds” are treated as author-supplied facts from the commission, not independently re-counted here.
- The current tree independently verifies the absence of a trustworthy authority chokepoint, but this document does not pretend to have audited LLP 0291’s exact family taxonomy.
- The recommendation concerning the partial `ResolvedPrincipal` is architectural. Its implementation was not available for code-level review.

## 3. What compatibility is and is not buying

The following compatibility machinery currently has no beneficiary and should be removed:

- Additive parallel authority types.
- One-family-at-a-time migrations that keep the old mint alive.
- Dual legacy/native carrier implementations.
- Grace periods for accepting old authority-producing APIs.
- Census-before-change as a prerequisite to breaking internal APIs.
- Deriving a new administrator anchor from an old token file.
- Preserving unbound authorization-capable backends for old tests.
- Keeping `Deref` or `DerefMut` solely so thousands of old call sites remain unchanged.
- Keeping feature-gated privilege seams because existing tests name them.
- Preserving the current database format solely so local development stores continue to boot.

But “no users” does not erase these real constraints:

- A locally existing database may contain unique app data.
- Demo instances and fixtures embody behavior that still needs testing.
- The sealed binary and its admin snapshot must be rebuilt and requalified.
- Already-published npm versions are immutable.
- In-flight branches incur genuine merge or abandonment cost.
- Session revocation, service-token termination, authorization-changing commits, room reauthorization, rollback, and ambiguous commit races remain security problems even with zero users.

LLP 0059’s load-bearing claim is that no response, outbox entry, live frame, ephemeral effect, or callback becomes observable across an authority transition without a final fence check (`llp/0059-session-projection-and-client-barrier.spec.md:197`). Its ticketed begin/commit/finalize protocol and ambiguity handling protect concurrency, not compatibility (`llp/0059-session-projection-and-client-barrier.spec.md:588`). Those semantics must survive.

## 4. Ideal end state

### 4.1 The permanent invariant

No caller outside the kernel authority module can cause the system to:

- Assert that a principal, operator, service, or internal worker has authority.
- Select a privileged writer or provenance.
- Turn an arbitrary operation into `System`.
- Turn an ordinary administrator credential into an unrestricted bypass.
- Commit an authority-bearing fact that was not derived or revalidated against the canonical store.
- Publish a result after the authority under which it was produced has ended.

A caller may select an operation and present evidence. Selection is not authority. Evidence is not authority. Only verification against canonical state creates an exact, non-widening authorization result.

This generalizes the existing identity-core design: provisioning inputs are server-derived, unavailable through public routes, and do not grant arbitrary System or admin authority (`llp/0214-snapback-identity-core.spec.md:1610`, `llp/0214-snapback-identity-core.spec.md:1617`). Handler claims are projections that cannot be presented back as proof (`llp/0214-snapback-identity-core.spec.md:1967`, `llp/0214-snapback-identity-core.spec.md:1998`).

### 4.2 Authority flow

The permanent flow has four cuts:

| Cut | Input | Result | Security rule |
|---|---|---|---|
| Admission | Exact operation selector plus untrusted evidence | Exact prepared operation | Resolve credentials and policy from canonical state; caller supplies no authority class. |
| Execution | Exact prepared operation | Handler projection and buffered intent | The handler sees a powerless projection and only the capabilities declared for that operation. |
| Commit | Prepared operation plus buffered intent | Durable result and derived receipt | Revalidate authority facts inside the committing transaction, or compare an exact durable generation there. Derive writer and provenance internally. |
| Publication | Committed result plus its exact live fences | External response/effect | Revalidate session, service, connection, room, and mode fences immediately before exposure. |

A single chokepoint does not mean “check only once.” It means there is one owner that may turn evidence into verified facts. Freshness must still be checked again at commit and publication. LLP 0285 already requires same-transaction revalidation to close the revoke-between-check-and-commit race (`llp/0285-kernel-authorization-closure.spec.md:422`).

### 4.3 Public and powerless types

The cross-crate surface should contain only the following conceptual types:

| Type | Meaning | Why it is powerless |
|---|---|---|
| `DatabaseBinding` | Identifies the store graph to which a request belongs | Cloneable routing identity; carries no authority fact. |
| `OperationRequest` | Closed selector for the exact operation and resource | Choosing “protected erasure” or “cron claim” does not satisfy its policy. |
| `PresentedCredential` | Raw credential bytes and their actual transport location | It declares no session/service/admin class; the gate resolves that. |
| `WireAuthorityFields` | Presence map for forbidden client authority fields | Used only for rejection. Never converted into authority. |
| `PreparedOperation<Kind>` | Opaque result bound to one database, operation, target, policy revision, and evidence version | No public constructor, mutation, serialization, conversion, or authority-widening method. It can be consumed only by its exact execution/commit path. |
| `HandlerAuthProjection` | Deep-frozen, bearer-free view for application code | Output-only. No server API accepts it as proof. |
| `AuditReceipt` | Record of what the kernel derived and committed | Output-only. It never authorizes a retry or follow-on operation. |
| Fence and publication handles | Exact session/service/room/connection generation ownership | They validate or release already-admitted work; they cannot mint a principal or choose a terminal outcome. |

Public exact operation selectors are safe only because every selector is treated as untrusted input. A public `OperatorCommand` selector is not the old `AdminBypass`: without a verified anchor credential it fails, and even with one it authorizes only the named operation.

### 4.4 Unnameable types

The kernel authority module privately owns:

- `VerifiedActor`
- `VerifiedOperator`
- `ClaimedWork<Kind>`
- `DerivedMembershipWriter`
- `DerivedProvenance`
- `AuthorizationSnapshot`
- `AuthorityTxn<Operation>`
- `CommitAuthorization<Operation>`
- Known-commit, rollback, and ambiguity dispositions
- Service-terminal and room-terminal state

These types are not publicly constructible, cloneable, deserializable, defaultable, or convertible from caller-owned data. Commit code accepts only private transaction-bound forms.

The kernel remains the canonical SQLite transaction owner, consistent with LLP 0225 (`llp/0225-core-modularization.decision.md:259`). Crash recovery continues to trust durable generation records rather than in-memory handles (`llp/0225-core-modularization.decision.md:280`).

### 4.5 Vocabulary that disappears

The following concepts should not exist in the final cross-crate API:

- `ResolvedAppAuthority`
- Generic `PreparedAuthority`
- `System` as a principal or authority class
- `AdminBypass`
- Caller-selected `MembershipWriter`
- `KernelCommitAuthority`
- Caller-supplied `requires_step_up`
- Public authority/provenance enums accepted by privileged sinks
- Generic “stage this action as System” APIs
- Public callback or closure factories for terminal settlement
- Feature-selected writable SQLite or privilege factories
- A wide `ServingDatabase` whose `DerefMut` preserves the old privileged surface

Anonymous access becomes absence of credentials. It is not minted authority.

Internal work becomes exact durable work:

- Cron executes a claimed due cron row.
- A job executes its exact durable lease.
- A pending effect executes or settles its exact row.
- A watch revalidates its stored principal and function basis.
- Startup reconciliation invokes a closed kernel operation over kernel-discovered rows.
- A verified-provisioning transition carries its exact sealed transition.
- A config probe uses a separate restricted probe operation.

There is no operation that first obtains “System” and then decides what to do with it.

### 4.6 What the mechanical gate proves

The replacement gate should mechanically prove:

1. Only the kernel authority module constructs the private verified types.
2. Every privileged durable sink is private or requires an unnameable transaction-bound type.
3. No public privileged sink accepts a caller-constructible authority discriminator, writer, provenance, approval boolean, credential digest, or callback.
4. No public API returns raw canonical SQLite access.
5. No workspace feature makes a privileged constructor visible to dependent crates.
6. Every cross-crate prepared type has private fields and lacks public constructors, `Clone`, `Default`, serde, and widening conversions unless duplicability is separately proved harmless.
7. Hostile compile fixtures, from every dependency rank and with every feature cell, cannot construct or substitute the private types.
8. Every registered operation maps to exactly one admission, commit, and publication path.
9. Every field accepted at a privileged operation has a recorded verification site, including the same-transaction recheck where required.
10. The old names and old constructors are absent, not allowlisted.

The gate still cannot prove policy correctness or arbitrary body-flow semantics. LLP 0284 explicitly records that its scanner is not taint analysis and can miss helper indirection and renamed sinks (`llp/0284-workspace-security-gate-threat-model.spec.md:626`). It also says the broader “caller-constructible data never selects a privileged lane” property remains a product objective rather than a scanner proof (`llp/0284-workspace-security-gate-threat-model.spec.md:677`).

Accordingly, mechanical proof must be paired with:

- A reviewed operation-to-verifier table.
- Same-transaction SQL assertions.
- Revocation/publication race tests.
- Rollback and ambiguous-commit fault injection.
- Independent review of the final integrated authority module.

## 5. Disposition of the approximately eleven creation mechanisms

Because LLP 0291 was unavailable, this is a normalized mechanism inventory derived from the available tree rather than a claim to reproduce its exact headings.

| Current mechanism | End-state disposition |
|---|---|
| 1. Wire/body authority fields | **Survive only as untrusted parsing and rejection.** They never create authority. |
| 2. Session bearer resolution | **Rewrite behind the authority core.** Keep credential hashing, deadlines, revocation generations, and session fences. Return only an exact prepared operation and projection. |
| 3. Scoped service-token resolution | **Rewrite behind the authority core.** Keep durable scope resolution and the finite service fence; delete caller-created service witnesses and generic service authority values. |
| 4. Dev impersonation | **Rewrite as a dev-only identity selector.** It may select a user for ordinary app operations on the bound dev origin, but cannot satisfy operator, protected, provisioning, or internal-work operations. |
| 5. Administrator/direct-runner authority | **Delete `AdminBypass`.** Require the administrator anchor and authorize one registered operator operation at a time. |
| 6. Generic `System` creation for cron, jobs, callbacks, and probes | **Delete completely.** Replace with exact durable claims or closed kernel operations. `config.verify` becomes a separate restricted probe lane. |
| 7. Revalidated watches, reactions, branches, and verified provisioning | **Rewrite as exact sealed transitions.** A private `VerifiedActor` may exist internally, but there is no reusable public `ResolvedPrincipal`. |
| 8. Nested invocation, live rerun, and authority inheritance | **Rewrite around exact non-widening prepared operations.** A child may inherit the verified actor and fences but must re-enter the gate for its own function and may never widen the parent. |
| 9. Kernel admissions for push, protected erasure, pending effects, and membership | **Delete the current admissions.** Rebuild them as operation-specific kernel transactions that derive all authority, writer, step-up, and provenance facts. |
| 10. Service/room closure factories and commit participants | **Preserve the fence algorithms; rewrite their ownership and APIs.** Delete public callbacks, arbitrary terminals, compatibility dual paths, and authorizing unbound backends. Opaque scheduling carriers may remain only when demonstrably powerless. |
| 11. Feature-gated test support and raw SQLite laundering | **Delete from production libraries.** Keep kernel unit seams under `cfg(test)` and ordinary dev-dependencies in dedicated integration/harness crates. |

The service and room fence implementations should not be replaced by a global epoch lock. LLP 0059 requires unrelated sessions to remain usable when one session’s outcome is uncertain (`llp/0059-session-projection-and-client-barrier.spec.md:632`) and specifies strict lock-order constraints (`llp/0059-session-projection-and-client-barrier.spec.md:726`). Its finite service fence also requires exact token-domain premark, draining, rollback, and ambiguity handling (`llp/0059-session-projection-and-client-barrier.spec.md:1187`). Those are permanent semantics.

## 6. Straight path

### Phase 0 — Adopt the final design before implementation

Accept one replacement specification whose scope is the entire authority lifecycle: evidence resolution, exact prepared operations, transactional revalidation, derived provenance, and final publication fencing.

Freeze the LLP 0291 census and the existing race/behavior suites as evidence. Do not freeze the old API or database format.

### Phase 1 — Delete the old vocabulary in one branch cut

Delete together:

- `ResolvedAppAuthority`
- Generic `PreparedAuthority`
- `System`
- `AdminBypass`
- Generic System staging
- `KernelCommitAuthority`
- Public membership-writer discriminators
- Caller-asserted pending-effect decisions
- Public closure factories
- Feature-gated privilege/test surfaces
- Wide privileged database dereferencing

The branch is expected not to compile after this cut. That is useful: with the old escape hatches absent, the compiler now identifies structural consumers rather than allowing them to move the same capability again.

This does not contradict LLP 0283’s warning that compile-first is not a security proof (`llp/0283-post-rearchitecture-followups.plan.md:279`). The compiler supplies completeness after the security design has removed the permissive fallback. Semantic review still decides whether each replacement is safe.

### Phase 2 — Build the authority core once

Implement the final private types, exact operation registry, administrator-anchor verification, prepared-operation binding, transactional revalidation, and derived receipt/provenance logic.

No compatibility adapter or legacy/native enum is introduced.

### Phase 3 — Reconnect five evidence classes

Reconnect the 46 families by category:

1. Anonymous and session-backed external requests.
2. Scoped service credentials.
3. Dev-only identity selection.
4. Exact operator operations.
5. Durable internal work and inherited long-lived work.

Each category gets one source-to-sink review. Individual call sites still must be examined, but they do not receive individual transitional authority types.

### Phase 4 — Reattach existing fence algorithms

Rehome service and room mechanisms behind concrete kernel-owned types while preserving:

- Premark before authority-ending writes.
- No process/fence locks beneath SQLite or the global writer.
- Exact ticket rollback.
- Fail-closed ambiguous outcomes.
- Final session/service/room/connection checks.
- Outbox lease and effect-fence ordering.
- Level-triggered room reauthorization.

Use the final ownership shape directly. Do not construct the legacy/native dual path described in LLP 0290’s migration sequence (`llp/0290-authorization-commit-participant.spec.md:1636`).

### Phase 5 — Make the break explicit

Introduce a new store-format boundary. An old store does not start under the new binary.

For disposable stores, reset and reseed. For valuable local data, provide a one-way, offline application-data export/import path that deliberately excludes sessions, service credentials, admin state, authority receipts, and live continuation state. Do not silently “migrate” authority facts.

Regenerate schemas, fixtures, goldens, demos, and Guide output around the new model.

### Phase 6 — Verify and publish

Require:

- The replacement gate suite green.
- All 46 families dispositioned against the new five-class map.
- Same-transaction authorization tests.
- LLP 0059 race and ambiguity tests.
- Complete schema and guide regeneration.
- Cold install and sealed-binary qualification.
- Independent review of the exact integrated commit.
- Publication as an explicitly breaking npm closure.

## 7. What existing work to keep or abandon

### 7.1 LLP 0285 steps

| LLP 0285 work | Disposition |
|---|---|
| Step 1: freeze behavioral evidence | **Keep.** This protects semantics, not compatibility. |
| Step 2: separate `DatabaseBinding` | **Keep.** A powerless binding is part of the final model. |
| Step 3: `ServingDatabase` preserving old access through dereference | **Abandon as a permanent design.** Retain a private serving-store owner if useful, but remove the wide `DerefMut` compatibility surface. LLP 0285 itself identifies stale detached snapshots and `DerefMut` as dangerous (`llp/0285-kernel-authorization-closure.spec.md:510`). |
| Step 4: make the old root private | **Keep the closure already gained, then delete the root.** Do not restore public reachability. |
| Step 5: add `ResolvedPrincipal` | **Abandon in its additive form.** The final core may have a private `VerifiedActor`, but it should be designed inside the final authority module, not introduced as an adapter for old admissions. |
| Step 6: convert admissions one by one | **Abandon the migration form.** Keep its same-transaction revalidation requirement. Rebuild operation-specific commits directly. |
| Step 7: move the service fence | **Keep the algorithms and ownership goal; abandon a compatibility-preserving line move.** Rehouse it against final types. |
| Step 8: move room authority | **Keep the semantics and kernel ownership; abandon the additive twelve-step dual path.** |
| Step 9: delete closure constructors | **Do immediately in the flag-day deletion.** |
| Steps 10–14: test-support migration | **Keep already-useful harness/dev-dependency work.** Delete the feature-visible seam in the same breaking cut instead of nursing it through further intermediate states. |
| Step 15: verification | **Keep and expand.** |

### 7.2 `lane/f1-forge`

Do not merge the partial `ResolvedPrincipal` implementation as the foundation of the new design.

The default should be to abandon the branch and harvest only:

- New behavioral tests.
- Durable-resolution query knowledge.
- Negative fixtures.
- Any independently useful census artifacts.

The type and its integration should be reimplemented in the final owner. This is an inferred design judgment; the branch was unavailable for direct inspection.

### 7.3 LLP disposition

| Document | Disposition |
|---|---|
| LLP 0285 | **Supersede.** Preserve its “kernel derives, never accepts,” same-transaction, and fence-ownership conclusions; replace its fifteen-step compatibility plan. |
| LLP 0290 | **Supersede or withdraw as an implementation plan.** Fold its lock, binding, outbox, issuer-order, and ambiguity invariants into the new authority-core spec. Do not implement its legacy/native sequence. Its own Draft status says it authorizes no implementation (`llp/0290-authorization-commit-participant.spec.md:27`). |
| LLP 0058 | **Supersede its “Shared invocation authority” portion.** Its `ResolvedAppAuthority`/`PreparedAuthority` model is exactly what changes (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1119`). Retain staged auth-mode protocol material through a split successor. |
| LLP 0059 | **Amend terminology only; do not supersede its concurrency protocol.** Its final-publication and transition invariants remain authoritative. |
| LLP 0225 | **Amend.** Retain dependency direction and kernel transaction ownership. Add a narrow authorization-surface flag-day exception to its previous “no flag-day” decision (`llp/0225-core-modularization.decision.md:132`, `llp/0225-core-modularization.decision.md:1111`). |
| LLP 0214 | **Amend references only.** Its sealed, server-derived provisioning design is the pattern to retain. |
| LLP 0284 | **Amend the gate inventory and fixtures.** Retain its threat model and honest limitations. |
| LLP 0283 | **Amend F-1 status and point to the replacement program.** Preserve its method lessons. |
| LLP 0291 | **Retain as research evidence.** Add a final family-to-new-path disposition table when available. |
| LLP 0041 | **Amend only with the new publication record.** Never rewrite the historical 0.1.24 facts. |

## 8. Head-to-head comparison

The estimates below are inferred engineering estimates, not measured schedules.

| Dimension | Incremental LLP 0285 plan | Breaking straight path |
|---|---|---|
| Semantic work | Must understand all 46 families. | Must also understand all 46 families. This work does not disappear. |
| Transition work | Steps 5–15, per-admission conversions, the approximately 1,068-line service-fence move, the room/outbox split, and LLP 0290’s twelve-step dual-path migration. | One destructive deletion, one authority core, five category reconnections, direct fence reattachment, regeneration. |
| Estimated total implementation/review work | Baseline 100%. | Approximately 55–70% of incremental work. Savings come from eliminating adapters and transitional states, not from skipping semantics. |
| Estimated serial wall-clock | Many ordered green-at-every-step barriers; likely 1.5–3 times the straight path. | One isolated flag-day branch with roughly six major review cuts. |
| “Moved one API earlier” risk | High until the final old constructor disappears. New and old authority forms coexist during most of the program. | Low after the initial deletion because there is no old type to wrap or re-export. Residual risk is concentrated in the new gate’s semantics. |
| Reviewability | Small diffs, but the system invariant changes after every step and reviewers must reason about both paths. Eleven unsuccessful rounds are evidence that locality has not produced comprehensibility. | Larger initial delta, but reviews can be separated into deletion, core, five evidence classes, transaction sinks, and fences. The final invariant is stable throughout reconnection. |
| Rollback | Easier per landing. | Git rollback remains easy, but databases created under the new format have no downgrade path. |
| Permanent result | Can reach closure if every step completes; likely retains `ServingDatabase`, a generic resolved-principal layer, and more carrier types chosen to ease migration. | Smaller permanent vocabulary: evidence, exact operations, private verified facts, exact commit paths, and preserved fences. |
| Temporary code discarded | Substantial dual paths and adapters. | Minimal; the branch may be uncompilable temporarily instead. |
| Data compatibility | Preserves more old local state. | Explicit store-format break and reset/export decision. |

The incremental plan is not irrational. It was correct under a requirement that every commit remain green and existing instances continue working. With that requirement removed, its staging machinery becomes the dominant cost and keeps the known-dangerous surface alive for most of the program.

## 9. What breaking actually costs

| Surface | What breaks | Recoverability / real loss |
|---|---|---|
| Local developer databases | Old stores refuse to open under the new binary; sessions, service credentials, authority receipts, live leases, and admin state cannot be carried forward. | Disposable stores are regenerated. Unique app rows require offline data-only export/import. If no export is made, unique app data is real loss. Security state should be intentionally lost. |
| Demo instances | Seeded databases and running demo state are invalidated. | Normally recoverable by reset and reseed. Ad hoc manually entered demo content is lost unless exported. |
| Fixtures and goldens | Serialized authority forms, SQL traces, schemas, diagnostics, and refusal precedence change. | Regenerate from the new implementation. Git history preserves old expectations. Review regeneration rather than accepting it blindly. |
| Guide examples | Examples naming System, AdminBypass, ordinary action probes, legacy store behavior, or old setup commands become false. | Rewrite and regenerate. This is material work because agents treat the Guide as the product surface. |
| Already-published npm artifacts | Nothing in 0.1.24 or earlier can be repaired in place. | No data loss: leave them immutable and historical. Publish a new breaking version and document that old binaries implement the old model. |
| Sealed binary and admin snapshot | Every supported platform artifact and embedded Guide/admin snapshot becomes stale. | Rebuild, seal, cold-install, and qualify. This is real release work, not compatibility work. |
| In-flight branches | Authority-related branches will conflict or become conceptually obsolete. | Extract tests and independent fixes first; otherwise abandon and rebase against the final API. Lost implementation time is real but bounded. |
| Backups, exports, restores, and forks | Existing durable units may lack the required anchor and contain incompatible authority rows. | Old binaries can read/archive them. New-world export/restore/fork semantics must be specified; silent reuse is forbidden. |
| Wire/client caches | Cached authority descriptors, continuation epochs, and retained data from an old instance cannot bind to the successor. | Clear client state and perform a fresh handshake. This is intended invalidation, not valuable-data loss. |

A Snapback store is already more than one SQLite file: auth keyrings, config, operation keys, assets, and admin material are separate durable members (`guide/operating/backup-and-copy.md:22`). Existing export/restore/fork behavior already treats credentials differently—faithful export preserves them, restore destroys them, and fork rotates them (`guide/operating/backup-and-copy.md:202`). The breaking design should extend this explicit posture rather than pretend old authority state can be safely inferred.

## 10. The two open author rulings

### 10.1 `config.verify`

Yes, the compatibility caveat evaporates.

Current `config.verify` stages its declared probe as an ordinary action through the generic System path (`crates/snapback-engine/src/local/engine.rs:21650`). If there are no deployed apps relying on System-only side effects, there is no reason to preserve that capability.

The final ruling should be:

> `config.verify` is a distinct, exact, powerless probe operation. It is not an ordinary action and has no System authority.

A probe may:

- Read only its named config entry and its exact revision.
- Use the secret only through a declared probe adapter.
- Perform network access only to the manifest-declared target/origin.
- Return a bounded verification result.
- Let the kernel update only that entry’s verification state after confirming the revision remains current.

A probe may not:

- Read or write application tables.
- Invoke functions or nested mutations.
- Enqueue jobs, effects, push work, or assets.
- Modify membership, auth, config values, or secrets.
- Gain operator or internal-work authority.
- Exfiltrate arbitrary secrets through unrestricted egress.

Existing probes that relied on System-only effects should fail validation and be rewritten. With no deployed applications, there is no caveat left to protect.

### 10.2 Administrator trust anchor

Yes, “require the anchor, full stop” is better.

The final ruling should be:

> Every file-backed instance is created with an explicit owner-only administrator trust anchor. Serving or executing administrator-capable operations without it fails closed. No environment token or legacy token file is accepted as the source from which the anchor is derived.

The database stores the anchor identifier/digest and generation. The owner-only durable state stores the root material. Startup requires an exact pair. Operator credentials are verified against that anchor and authorized for one registered operation.

This eliminates:

- Legacy derivation.
- Grace periods.
- “Whichever source exists” precedence.
- Accepting a caller-provided digest at open.
- Compatibility mismatches between environment-only and file-backed state.
- Migration logic for old instances.

It does not eliminate all backup/restore/fork/rotation design:

- A faithful export must carry the anchor deliberately.
- A disaster restore should create a new anchor and revoke predecessor operator credentials.
- A fork should always mint a new anchor.
- Rotation, when supported, remains an exact operator operation with an atomic generation change.

Those lifecycle rules are permanent security semantics, not backward-compatibility machinery. They may be fail-closed and minimal initially, but they cannot remain undefined.

## 11. Recommendation

Adopt the breaking straight path.

Specifically:

- Supersede LLP 0285’s migration plan.
- Do not merge the partial `ResolvedPrincipal` lane.
- Delete the old authority vocabulary before reconnecting call sites.
- Build one kernel-owned derivation module around exact operations and untrusted evidence.
- Require the administrator anchor from instance creation.
- Turn `config.verify` into a restricted probe kind.
- Preserve LLP 0059’s specialized session, service, room, outbox, rollback, and ambiguity algorithms.
- Break the local store format and regenerate disposable state.
- Publish the result as a breaking qualified npm closure.

The strongest argument against this recommendation is that the 46 families encode more semantic diversity than their shared forgery mechanism suggests. A flag-day diff can make an omitted source, deadline check, publication fence, or ambiguity rule harder to see, and there is no compiler proof of those semantics. The repeated review failures demonstrate that the security surface is difficult, not merely that the migration strategy is poor.

That argument is substantial. It is why the recommendation does not include rewriting the fence algorithms or skipping the family census. The straight path still requires every family to be mapped, every exact sink to be reviewed, and all existing concurrency evidence to remain green.

But it does not justify keeping a forgeable authority API alive while 46 adapters are constructed around it. With no installed base to protect, preserving that API is the greater risk and the larger cost.
