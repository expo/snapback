# Design: fence pending-effect and grant/OAuth approval

Status: Proposed — design complete, implementation not dispatched
Created: 2026-08-23
Related: issues/20260823-remeasurement-property-still-false.md (which confirmed both unchanged),
issues/20260822-author-rulings-fence-program.md (the binding ruling),
issues/20260823-detached-action-nested-mutation-fence-design.md (the pattern reused)

## Why these two together

Both were re-confirmed as unchanged exposures by the fresh measurement, and both are approval paths
where the approver's own authority can go terminal before the decision commits. The design verified
that measurement against the code rather than restating it: **none of the cited exposures has moved.**

## The grading, which decides sequencing

**B (grant/OAuth approval) is worse than A (pending-effect approval).**

- **A releases one exact stored invocation** under the original frozen authority — arbitrary
  application authority, but **exact and one-shot, not a reusable credential**. Remote
  authenticated, bound to exact effect-session ownership.
- **B creates reusable delegated authority** defaulting to 30 days and lasting up to 90. OAuth's
  local-only reachability reduces its exposure relative to ordinary remote grant approval, **but
  the durable object it creates is the stronger capability.**

## The finding that changes the shape of the fix

OAuth performs grant approval and code issuance as **two separate Local operations**, and the
resulting half-state is not a benign intermediate:

- the user has a live grant; the approval request is no longer pending; the client receives no
  redirect code; token exchange cannot succeed because no code hash is stored.

It is not directly exploitable by the public client — dynamic registration returns no client secret
— but it is **authority-bearing and recoverable by a later authenticated same-user retry**, because
approval replay recognises the existing grant while code issuance does not recheck the original
authorization expiry. There is no `approved-awaiting-code` state, no expiry policy, no resumption
protocol, and no reconciliation owner.

**And the obvious fix makes it worse:** giving each existing operation its own reservation would
turn terminalization between them into *another deterministic way* to produce the half-state. The
merge is required, not optional.

Merging is feasible: same auth database, same transaction mechanism, no cross-database operation or
lock boundary. The split exists for **code reuse** — OAuth calls the ordinary grant-approval
operation then a façade-specific issuance — and that layering convenience does not justify a
partial durable result. Generate the raw code before reservation, store only its hash inside the
combined transaction, and return the raw code only after exact reconciliation.

## Migration hazard worth naming now

Existing grant-only half-states **may already exist in deployed databases**. Migration needs either
explicit detection and expiry or a one-time reconciliation policy, and the new operation must not
silently treat them as normal success.

## 2. The asynchronous step-up gap

The interesting B window begins when `for_step_up(...).await` returns successfully and ends when an exact caller-authority reservation is acquired.

Today that window is unbounded.

After step-up completes, ordinary grant approval waits for `with_snapback` (`crates/snapback-server/src/server.rs:15105-15116`). The underlying writer acquisition can loop indefinitely while managed handoff is closed or Local remains unavailable (`crates/snapback-server/src/server/writer_gate.rs:77-116`). There is no route-level deadline that bounds this wait.

During the window, all of these may invalidate the authority that completed step-up:

- logout or durable revocation;
- session expiry;
- family alarm, refresh reuse, reset, restore, or capability eviction;
- session-generation or authority-instance replacement;
- authorization-stream retirement or reset;
- an admission-mode transition.

The session fence distinguishes these terminal reasons (`crates/snapback-types/src/contract_types.rs:567-600`) and checks current generation, pending terminal state, committed terminal state, and deadline at reservation (`crates/snapback-sync/src/auth/session_projection.rs:654-706`). Step-up binding proves which authority satisfied the challenge; it is not a publication or liveness reservation (`crates/snapback-server/src/server.rs:14725-14746`).

The accepted split-phase reservation pattern closes this race if reservation happens immediately after step-up and before Local acquisition:

1. Terminal premark wins first: the exact reservation is refused.
2. Reservation wins first: terminalization must drain it before committing.
3. Local reacquisition is bounded from the instant of reservation, so the reservation cannot pin logout indefinitely.

The existing pattern therefore needs no stronger session primitive, but it needs all of its pieces: exact per-decision reservation, a common five-second absolute deadline, typed terminal classification, bounded FIFO Local reacquisition, and a deepest mode-last commit guard. Merely adding another `effect_guard` after Local acquisition would not close the gap.

## 3. OAuth’s two-operation problem

### Current half-state

Grant approval commits these effects in its first transaction (`crates/snapback-kernel/src/storage/auth_grants.rs:415-575`):

- authorization clock advancement;
- step-up-proof consumption, when required;
- insertion of a live `_auth_grants` row;
- transition of the pairing/grant request to `approved` with its `grant_id`.

Code issuance is a separate transaction (`crates/snapback-kernel/src/storage/auth_integrations.rs:922-987`). Until that transaction commits, the matching OAuth authorization remains:

- `status = pending`;
- `code_hash = NULL`;
- `grant_id = NULL`;
- `code_expires_at_ms = NULL`.

The state model is visible at `crates/snapback-kernel/src/storage/auth_integrations.rs:52-74`.

A current session terminalization between the operations does not reliably create that half-state: because the second operation also ignores session publication, it may issue the code post-terminal. Mode retirement, storage failure, cancellation, panic, or process loss between transactions can leave the half-state. A naïve fix that gives each existing operation its own reservation would make terminalization between them another deterministic way to produce it.

### Observability and exploitability

The half-state is observable:

- the user has a live grant;
- the approval request is no longer pending;
- the OAuth client receives no redirect code;
- token exchange cannot succeed because there is no stored code hash.

The public OAuth client cannot directly exploit that grant without a code; dynamic registration does not return a client secret (`crates/snapback-server/src/server/oauth.rs:282-292`). The state is nevertheless authority-bearing and recoverable by a later authenticated same-user retry. Approval replay recognizes the existing grant even after the request is no longer pending, while code issuance does not recheck the original OAuth authorization expiry before filling the pending row (`crates/snapback-kernel/src/storage/auth_grants.rs:1000-1027`, `crates/snapback-kernel/src/storage/auth_integrations.rs:938-980`).

This is not an acceptable intentional intermediate state. It lacks an explicit `approved-awaiting-code` state, expiry policy, resumption protocol, and reconciliation owner.

### Atomic merge feasibility

Merging is feasible and required by the binding ruling.

Both tables use the same auth database and transaction mechanism. OAuth authorization creation already inserts its pairing and OAuth rows together (`crates/snapback-kernel/src/storage/auth_integrations.rs:814-919`). There is no cross-database operation, external callback, or lock boundary requiring approval and issuance to be separate.

The apparent reason for the split is code reuse: OAuth calls the ordinary grant-approval operation and then a façade-specific issuance operation. That layering convenience does not justify a partial durable result. Generate the raw code before reservation, store only its hash inside the combined transaction, and return the raw code only after exact reconciliation.

## 4. Proposed design

### 4.1 Common decision protocol

Use one reservation per logical durable decision, never one per session or handler:

1. Perform parsing, lookup, step-up, immutable intent construction, and—where applicable—OAuth raw-code generation without a permit.
2. Acquire an exact caller-authority reservation immediately after the last asynchronous authority-establishing step.
3. Start one absolute five-second deadline at reservation acquisition.
4. Reacquire Local through the bounded FIFO writer path.
5. Re-sample time and revalidate current request, function, policy, scopes, capabilities, proof, and row state.
6. Begin one auth transaction and stage every row belonging to the logical decision.
7. Invoke `reservation.commit_guard()` as the last fallible authorization operation at the durable cut.
8. Commit SQLite.
9. Drop the commit guard and decision reservation immediately when commit returns.
10. Perform ambiguity reconciliation, response construction, recursive invocation, and other post-commit work without that reservation.

The guarded auth-transaction seam already places a callback immediately before commit (`crates/snapback-kernel/src/storage/auth.rs:1694-1724`, `crates/snapback-kernel/src/storage/auth.rs:1743-1777`). Use that seam; do not add a decorative route-level guard while leaving storage capable of unguarded commit.

The full open `PendingCommit` capsule is not necessary here. Reuse or factor the capsule’s reservation/deadline/bounded-FIFO acquisition mechanics (`crates/snapback-server/src/server/commit_capsule.rs:760-910`), while retaining the closed auth-transaction callback at the actual durable cut.

### 4.2 Typed per-decision terminal latch

Each decision owns a first-wins typed latch:

```text
ApprovalDecisionTerminalCause
  = CallerAuthority(CallerAuthorityTerminalCause)

ApprovalDecisionTerminalLatch
  = OnceLock<ApprovalDecisionTerminalCause>
```

The shared caller cause must distinguish admission-epoch retirement, authorization-stream retirement, and exact session terminal cause/disposition. Reservation refusal and final commit-guard refusal set the latch structurally.

Do not put these into the latch:

- writer timeout;
- row conflict or stale request;
- policy rejection;
- storage failure;
- commit uncertainty.

Those are separate outcomes. Do not infer terminality by parsing diagnostic strings or overload an `abandoned` boolean.

### 4.3 Pending-effect approval

Approval of the pending row and execution of the original effect are two different logical effects.

The approval decision receives one approver reservation. That reservation covers only:

- proof consumption;
- pending-row transition;
- approval journal append;
- the transaction commit.

It must be released before invoking the original stored function. The original invocation then uses its own frozen authority and ordinary mutation/action fence. Holding the approver permit across recursive dispatch would couple logout latency to arbitrary application execution and would grant the approver permit the wrong semantic scope.

The current post-commit read in `decide_pending_effect` (`crates/snapback-kernel/src/storage/pending_effects.rs:680-691`) must either be derived from staged values or run after the reservation is dropped.

The route’s string-based terminalization path (`crates/snapback-server/src/server/effects.rs:211-230`) must become structural:

- `NoDecision::CallerTerminal`: leave the effect pending; do not consume proof, append a decision journal entry, or dispatch.
- `CommittedApproval`.
- `CommittedRefusal { reason }`.

If a nonterminal revalidation failure is policy-defined to durably refuse the effect, that refusal is a new logical decision. It must obtain its own exact approver reservation and guarded commit. An approver-session terminal cause must never be converted into durable refusal merely because its error code resembles a revalidation failure.

Pending lookup’s lazy expiry mutation (`crates/snapback-kernel/src/storage/pending_effects.rs:593-598`) is a separate exposure and is not silently covered by this approval fence.

### 4.4 Ordinary grant approval

After step-up, reserve the exact approving session before waiting for Local. Inside the bounded writer section, perform one guarded transaction containing:

- authorization-clock advancement;
- proof validation and consumption;
- request and agent/integration validation;
- grant insertion;
- request transition to `approved`;
- the final mode-last commit guard.

The existing pretransaction clock write at `crates/snapback-kernel/src/storage/auth_grants.rs:427` must move into this transaction using the transaction-scoped clock helper (`crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1602-1611`).

Commit-uncertainty reconciliation occurs only after releasing the reservation. It must compare the entire expected grant tuple, proof result, request transition, and clock result—not merely the request or grant identity.

### 4.5 OAuth approval and code issuance

OAuth approval and code issuance become one logical decision, one reservation, one Local acquisition, and one auth transaction.

Generate the raw authorization code before reservation. In the combined transaction:

- advance the authorization clock;
- validate and consume step-up proof;
- insert or reconcile the exact grant;
- transition the pairing request;
- transition the OAuth authorization to `approved`;
- store the exact grant ID, code hash, and code expiry;
- run one mode-last commit guard;
- commit all changes atomically.

There is no production operation that can commit a new OAuth grant without its matching code row, nor one that can issue a new code for a separately committed approval.

After commit, release the permit before reading or reconciling. Return the pre-generated raw code only if reconciliation proves the complete expected tuple, including its exact hash and expiry. If an already-complete approval is replayed after the raw code has been lost, do not mint a replacement code against the same authorization row; require a new OAuth authorization ceremony.

### 4.6 Differences from detached actions

The reusable shape is reservation → bounded Local reacquisition → mode-last durable guard → commit → immediate permit release.

The cases are not otherwise identical:

- Approval handlers have no evaluator watchdog, abandoned invocation, host-call read barrier, or final evaluator-result override.
- The latch exists to preserve exact authority-terminal classification across step-up, writer acquisition, and error handling—not to arbitrate evaluator completion.
- A contains two legitimate logical effects: approver decision, then original-authority execution. They require separate reservations.
- B’s OAuth result spans multiple tables and must be atomic. Detached nested mutations intentionally reserve separately per child; OAuth must not reserve separately per table or existing operation.
- Approval decisions consume proofs and alter authorization metadata. Their commit-uncertainty checks must reconcile proof, clock, request, grant, and OAuth rows as one result.
- All routes in this design are session-bound; service-retirement arms remain in the common caller-cause type for consistency but are not expected at these call sites.

## 5. Migration inventory

### Common plumbing

| Location | Change | Class |
|---|---|---|
| `crates/snapback-sync/src/auth/invocation.rs:1291-1331` | Return typed terminal causes from final commit-guard refusal. | Judgement |
| `crates/snapback-sync/src/auth/invocation.rs:1753-1805` | Add/reuse classified exact reservation result instead of flattened diagnostics. | Judgement |
| `crates/snapback-sync/src/auth/session_projection.rs:654-706` | Preserve exact session/stream terminal source in reservation refusal. | Judgement |
| `crates/snapback-server/src/server/commit_capsule.rs:760-910` | Factor or reuse reservation deadline and bounded FIFO writer acquisition. | Judgement |
| `crates/snapback-kernel/src/storage/auth.rs:1694-1777` | Reuse guarded transaction callbacks; add only any typed adapter required. | Mechanical after API choice |

### A: pending effects

| Location | Change | Class |
|---|---|---|
| `crates/snapback-server/src/server/effects.rs:240-395` | Split preparation from exact decision reservation; add latch and deadline; drop permit before original dispatch. | Judgement |
| `crates/snapback-server/src/server/effects.rs:64-230` | Replace string-classified terminal/refusal behavior with structural decision outcomes. | Judgement |
| `crates/snapback-engine/src/local/engine.rs:5100-5177` | Accept guarded decision intent/reservation; remove mode-only guard as the claimed fence. | Judgement |
| `crates/snapback-engine/src/local/engine.rs:5192-5201` | Preserve denial semantics deliberately instead of inheriting an optional approval bypass. | Judgement |
| `crates/snapback-kernel/src/storage.rs:2292-2310` | Expose a guarded approval/refusal entry point with no production no-op guard. | Judgement |
| `crates/snapback-kernel/src/storage/pending_effects.rs:624-691` | Use guarded transaction callback and eliminate permit-held post-commit read. | Judgement |
| Direct storage tests near `pending_effects.rs:868-928` | Migrate to an explicit private/test guard or transaction-scoped helper. | Mechanical |
| `crates/snapback-server/src/server.rs:9335-9346`, `10974-10982` | Route/source inventory only; behavior remains session-authenticated effect management. | Mechanical |

### B: grants and OAuth

| Location | Change | Class |
|---|---|---|
| `crates/snapback-server/src/server.rs:15081-15135` | Reserve immediately after step-up; bounded Local acquisition; remove route-level mode-only fence claim. | Judgement |
| `crates/snapback-server/src/server/oauth.rs:485-603` | Replace two Local calls with one combined atomic approval operation. | Judgement |
| `crates/snapback-engine/src/local/engine.rs:4957-4989` | Replace split OAuth methods and mode guards with guarded ordinary and combined OAuth operations. | Judgement |
| `crates/snapback-engine/src/local/engine.rs:5649-5668` | Update façade forwarding to the combined operation. | Mechanical after API design |
| `crates/snapback-kernel/src/storage/auth_grants.rs:415-575` | Extract transaction-scoped approval body; fold clock update into it; return exact reconciliation evidence. | Judgement |
| `crates/snapback-kernel/src/storage/auth_integrations.rs:922-987` | Extract transaction-scoped OAuth-row update and compose it with grant approval; remove production split autocommit surface. | Judgement |
| `crates/snapback-kernel/src/storage/auth_grants.rs:2712-2729` | Replace forwarding methods with guarded API. | Mechanical |
| `crates/snapback-kernel/src/storage/auth_integrations.rs:2317-2326` | Replace issuance forwarding with combined API. | Mechanical |
| Grant tests at `auth_grants.rs:2061,2166,2232,2294,2534` | Migrate direct calls; preserve isolated transaction-body tests only through private test APIs. | Mechanical |
| OAuth tests at `auth_integrations.rs:1604-1881` | Migrate paired approve/issue calls to combined operation; retain explicit rollback coverage. | Mechanical |
| `crates/snapback-server/src/server.rs:9076-9087`, `9130-9141`, `10996-11005` | Route/source inventory; policies remain authenticated. | Mechanical |

Implement A and B as two changes over one small common prerequisite. B’s ordinary and OAuth approval work must land together because the atomicity change crosses both. A has a different state machine, error policy, and recursive execution boundary; combining it with B would enlarge review surface without providing additional atomicity.

## 6. Tests and mutation oracles

Every concurrency test must use a non-empty guarded fixture and record real event ordering. Two invalid test patterns are prohibited:

- An empty scope, row, or child-effect fixture can make the guarded loop empty; deleting the production guard then changes nothing.
- Pinning reservation or decision identity does not prove ordering. Tests must observe reservation, durable guard, SQLite commit return, permit drop, and terminal commit in order.

### A. Pending effects

| Property | Test | Shortest production mutation that must not stay green |
|---|---|---|
| Terminal-first forbids approval | Pause after step-up/preparation but before reservation. Complete approver logout, then release. Assert pending status unchanged, proof unconsumed, no decision journal entry, no original mutation, and exact typed terminal cause. | Remove reservation but return an auth error after committing approval and suppressing original dispatch. A test checking only the HTTP error or app row would remain green. |
| Reservation-first orders terminalization after commit | Pause after the exact reservation. Start logout; prove a second exact reservation fails and logout has not committed. Release and assert `reserve < before_commit_guard < SQLite commit return < permit drop < logout commit`. | Leak an unrelated session permit while omitting the decision reservation, or drop the correct permit before SQLite commit. Identity-only assertions remain green. |
| Approver permit ends at decision commit | Block original invocation after approval commit. Assert logout completes while the original invocation remains blocked. | Hold the approver permit through recursive dispatch. Ordinary successful approval tests remain green. |
| Terminal cause is structural | Exercise logout, expiry, stream retirement, and admission retirement. Assert exact cause/disposition and that durable-refusal code is not entered. | Replace the latch with an `AtomicBool` or diagnostic-string classifier. A logout-only test remains green while other causes are misclassified. |

The terminal-first test must be run against the unfixed parent and watched failing: current code can commit the approval and original non-empty mutation after logout. The failpoint must assert it was reached exactly once so an empty or bypassed fixture cannot manufacture a pass.

### B. Ordinary grant approval

| Property | Test | Shortest production mutation that must not stay green |
|---|---|---|
| Step-up completion is not durable authority | Use a non-empty scope set containing an authority-creating function. Pause after successful step-up and before reservation; logout; assert no clock, proof, grant, or request mutation. | Delete the fence while using an empty/non-authority-creating scope fixture. The protected loop and proof path become empty, so the test falsely stays green. |
| Reservation-first covers the complete transaction | Pause after reservation, start logout, then assert the same ordered sequence through grant commit and logout commit. Ensure no unrelated permits exist. | Acquire the correct reservation only after row staging, or drop it before commit. Reservation identity still matches, but ordering is wrong. |
| Reservation retention is bounded | Hold Local after reservation until the five-second absolute deadline. Assert typed timeout, no durable mutation, zero retained permits, and logout drainage. | Start timeout before reservation or never acquire a permit. A superficial timeout test stays green without testing retention. |
| Mode guard is last | Instrument staged clock/proof/grant/request rows and the actual guarded transaction callback. Assert all staging precedes the guard and exactly one commit follows it. | Add a dummy route guard while passing a no-op storage callback. Guard-count tests stay green although the durable cut is unguarded. |

### B. OAuth atomic result

| Property | Test | Shortest production mutation that must not stay green |
|---|---|---|
| Grant and code roll back together | Inject failure after the real grant/request rows are staged but before the OAuth row update. Assert neither half exists. | Move the failpoint before all row work or use an empty scope fixture. The test passes without crossing the vulnerable boundary. |
| Exactly one durable transaction | On success, assert one SQLite commit contains the exact grant and OAuth tuple. Start logout after grant staging and prove it commits only after the combined transaction. | Keep both operations in one Local closure but retain two SQLite transactions. Final identity/state tests stay green. |
| Uncertain commit requires exact reconciliation | Lose the commit acknowledgement. Return the raw code only when request, grant, scope/capability set, proof, clock, OAuth status, exact code hash, grant ID, and expiry all match. Tamper each field separately. | Reconcile only request and grant IDs. Identity tests stay green even with the wrong code hash or ordering. |
| Replay cannot regenerate a code | Retry after a fully committed result whose raw response was lost. Assert the stored hash is unchanged and no second code is returned; a new authorization is required. | Call the old issuance operation again while retaining the same grant ID. Grant-identity tests stay green while a second code is minted. |

The OAuth rollback test must also be watched failing against the parent by forcing the second Local operation to fail after the first commits. Its expected parent failure is the exact grant-only half-state.

## 7. Risks and reshape triggers

- **Permit leakage or excessive retention.** A permit held during step-up, post-commit reads, uncertainty reconciliation, or original effect execution can delay logout indefinitely. Absolute deadline and event-order tests are required.
- **Optional guard plumbing.** A public `Option<guard>` or production no-op callback would recreate the exposure. Unguarded transaction bodies must be private or test-only.
- **Commit ambiguity.** Retrying grant insertion or code issuance without exact reconciliation can duplicate authority or mint a second code.
- **Idempotency changes.** Existing-grant replay is not equivalent to replaying a lost raw OAuth code. Do not auto-retry unless the complete operation is exactly idempotent.
- **Clock atomicity.** Leaving authorization-clock observation as a pretransaction commit preserves partial state even after grant/code merging.
- **Error-policy drift in A.** Converting caller terminality into durable refusal changes the pending effect despite the decision being unauthorized.
- **Lock ordering.** `commit_guard` must remain the last fallible authorization operation and must not enclose network waits, callbacks, evaluator work, or recursive Local acquisition.
- **Recovery compatibility.** Existing grant-only OAuth half-states may already exist. Migration needs either explicit detection and expiry or a one-time reconciliation policy; the new operation must not silently treat them as normal success.

Reshape the approach if grant and OAuth rows are found to use different durable stores, if code material must be produced by an external asynchronous system inside the decision, or if product policy intentionally adopts an `approved-awaiting-code` state. That alternative requires an explicit state, retry/resume authorization, expiry, reconciliation owner, and user-visible recovery semantics. Without those requirements, the binding atomic-result design remains the smaller and safer shape.