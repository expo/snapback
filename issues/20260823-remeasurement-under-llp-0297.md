# Re-measurement under LLP 0298: the property is reachable, and not yet true

Status: Open — measurement
Created: 2026-08-23
Related: llp/0298-durable-effect-scope.decision.md,
issues/20260823-remeasurement-after-detached-action-fence.md (prior measurement),
issues/20260823-pairing-fence-residual-evidence-gaps.md

## The headline

**FALSE — but for the first time the program has a finite, enumerable path to TRUE.**

LLP 0298 was ruled specifically to answer whether this property has a reachable end state. It does:

> "The ruling therefore makes the property **reachable, but not currently true**."

The ruling removes the unbounded obligation to fence every harmless clock tick or already-decided
lazy lifecycle materialization. Under the current source census, the remaining in-scope effects form
a **closure set of nine items**:

1. Fence operation-range issuance.
2. Fence or relocate OAuth proposal creation; repair or fence the mixed pairing sweep.
3. Fence grant/OAuth approval atomically.
4. Fence pending-effect decisions, settlement, denial, and refusal.
5. Fence grant/OAuth denial and grant revocation.
6. Fence approval-gated intent creation.
7. Fence watch creation.
8. Finish caller-authority fencing for stream start/premark/settlement/cancellation.
9. Seal the finite carrier/capsule structural residuals, if the claim is to include in-process
   embedding.

That is the first time this program has had a defined end state rather than an open-ended hunt.

## The new shortest path

**Operation identity-range issuance**, `POST /client-mutations/identity-range`. The request waits
for managed Local while logout commits; once admitted, the engine takes `effect_guard`, which is
explicitly **mode-only** and reserves no session authority; storage then registers the client epoch
and the requested range and commits.

It is **in scope under 0297** on all counts: it grants a finite authenticated operation-identity
capability, would not happen on another caller's next request, and is exactly what the caller asked
for.

## Both caller classes, one shortest path

The shortest *wire* path is **session-only** — in Sessions mode `app_auth_route` uses
`OptionalSessionBearer`, not the session-or-scoped-token overlay. But **scoped services retain an
independent remote counterexample**: an approval-gated mutation or action creates its pending intent
*before* the ordinary mutation reservation, on a route that accepts both classes, taking only
`effect_guard`.

So the property remains false for **both** governing caller classes even though the single shortest
path is session-only. Recorded explicitly, because "session-only" would otherwise read as narrower
progress than the evidence supports.

## What the pairing landing bought

**Exactly one new positive subset.** It did not close the operation-range, consent, management,
watch-creation, stream, or structural residuals. Worth stating plainly against three fix rounds.

## 2. Auxiliary-write enumeration

LLP 0298’s four criteria are applied individually below ([LLP 0298:34](llp/0298-durable-effect-scope.decision.md:34)). “PASS” means the criterion is satisfied; one failure keeps the write in scope.

| Write argued to be auxiliary | Criterion 1: no capability/auth decision | Criterion 2: idempotent/monotonic | Criterion 3: another caller would cause it | Criterion 4: processing, not requested outcome | Result |
|---|---|---|---|---|---|
| **Authorization-clock high-water writes**, including the clock advance now inside pairing mint. The standalone transaction is at [auth_agent_credentials.rs:1443](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1443); the monotonic update is at [auth_agent_credentials.rs:1602](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1602); pairing uses it in its guarded transaction at [auth_grants.rs:528](crates/snapback-kernel/src/storage/auth_grants.rs:528). | **PASS.** It grants no principal capability and records host-time rollback protection rather than deciding a principal, scope, grant, or consent. | **PASS.** The stored high-water value can only stay equal or advance; rollback is refused. | **PASS.** The next clock-observing auth operation from another principal advances the same global high-water mark. | **PASS.** Callers ask for pairing, listing, approval, denial, revocation, or OAuth processing—not a clock write. | **EXCLUDED as auxiliary.** |
| **Pending-effect inbox lazy expiry**, including its journal update. It conditionally changes only already-expired `pending` rows and appends one terminal journal entry ([pending_effects.rs:475](crates/snapback-kernel/src/storage/pending_effects.rs:475), [pending_effects.rs:601](crates/snapback-kernel/src/storage/pending_effects.rs:601)). | **PASS.** The timestamp has already ended approvability; materialization grants nothing and does not alter the pre-existing expiry decision. | **PASS.** `pending → expired` is one-way, conditionally applied, and the journal is appended only with that transition. | **PASS.** The next inbox request by another approver runs the same global expiry pass. | **PASS.** The caller asked to list effects, not expire them. | **EXCLUDED as auxiliary.** |
| **Pending-effect pre-approve lookup expiry**, including its journal update ([pending_effects.rs:593](crates/snapback-kernel/src/storage/pending_effects.rs:593), [effects.rs:253](crates/snapback-server/src/server/effects.rs:253)). | **PASS.** As above, the durable expiry follows an already-terminal timestamp. | **PASS.** The guarded predicate makes the exact row transition and journal append one-shot. | **PASS.** A later management session processing that effect ID would perform the same expiry before deciding it. | **PASS.** Expiry is lookup processing; the requested outcome is approval. | **EXCLUDED as auxiliary.** |
| **Global OAuth/pairing sweep** reached by pairing creation, presentation, and the grant inbox. The DELETE has no user predicate ([auth_grants.rs:1752](crates/snapback-kernel/src/storage/auth_grants.rs:1752), [auth_grants.rs:1783](crates/snapback-kernel/src/storage/auth_grants.rs:1783)). | **FAIL.** Controlling calibration: one expired OAuth parent can change whether pairing mint, presentation, or inbox access succeeds for every user. | **FAIL.** LLP 0298 expressly rules the mixed OAuth sweep non-monotonic ([LLP 0298:58](llp/0298-durable-effect-scope.decision.md:58)). The current child FK remains `ON DELETE RESTRICT` ([auth_integrations.rs:52](crates/snapback-kernel/src/storage/auth_integrations.rs:52), [auth_integrations.rs:72](crates/snapback-kernel/src/storage/auth_integrations.rs:72)). | **PASS.** It is global and the next pairing create/present or grant-inbox caller runs it. | **PASS.** It is automatic cleanup before the requested operation. | **IN SCOPE; OPEN EXPOSURE.** Ordinary expired parents can be deleted and committed after terminal authority; OAuth children additionally preserve the global wedge. |
| **OAuth proposal creation:** the pairing-parent and OAuth-child inserts ([auth_integrations.rs:821](crates/snapback-kernel/src/storage/auth_integrations.rs:821), [auth_integrations.rs:874](crates/snapback-kernel/src/storage/auth_integrations.rs:874), [auth_integrations.rs:891](crates/snapback-kernel/src/storage/auth_integrations.rs:891)). | **FAIL, conservatively.** It establishes a new pending authorization opportunity and changes which proposal can later be approved. | **FAIL.** Each request allocates fresh rows and identifiers; retrying is not an idempotent update to one monotonic fact. | **FAIL.** Another caller would not create this caller’s client, redirect, scopes, PKCE, and state proposal. | **FAIL.** Creating the proposal is the purpose of `GET /auth/oauth/authorize` ([oauth.rs:337](crates/snapback-server/src/server/oauth.rs:337)). | **IN SCOPE; OPEN EXPOSURE.** |
| **Pairing hash/consent row** produced by `POST /auth/pairing-codes` ([auth_grants.rs:518](crates/snapback-kernel/src/storage/auth_grants.rs:518), [auth_grants.rs:534](crates/snapback-kernel/src/storage/auth_grants.rs:534)). | **FAIL, conservatively.** The row is the server-recognized half of the short-lived pairing bearer. | **FAIL.** Each call generates a fresh secret, hash, request ID, and expiring row. | **FAIL.** Another caller would not mint this pairing capability. | **FAIL.** Pairing-code mint is exactly what the caller requested. | **IN SCOPE, but now ROUTE-CLOSED.** It is not excluded merely because the new fence protects it. |
| **Operation epoch/range registration** ([operation_ledger.rs:1251](crates/snapback-kernel/src/operation_ledger.rs:1251), [operation_ledger.rs:1371](crates/snapback-kernel/src/operation_ledger.rs:1371), [operation_ledger.rs:1405](crates/snapback-kernel/src/operation_ledger.rs:1405)). | **FAIL.** It grants a finite server-authenticated operation-identity range. | **PASS.** Epoch sequence and range endpoints advance monotonically; lost-response replay can return the exact existing successor. | **FAIL.** An unrelated caller would neither allocate nor own this authority/audience range. | **FAIL.** Range issuance is the requested result. | **IN SCOPE; OPEN EXPOSURE.** |

No other prior “auxiliary” acceptance is silently retained. Pending-effect decision journals, stream control state, and other bookkeeping inseparable from a requested approval, denial, cancellation, or settlement remain in scope with their parent effect; criterion 4 does not permit excluding them.

## 3. Refreshed subset table

`ROUTE-CLOSED` means current production composition cannot reach a terminal-first commit. `STRUCTURALLY IMPOSSIBLE` means the violating construction is rejected by safe Rust/type visibility.

| Subset | Current grade | Change since prior measurement |
|---|---|---|
| Ordinary `/mutation` after the approval helper returns without creating a pending effect | **ROUTE-CLOSED** | Unchanged. Reservation occurs before Local ([server.rs:30502](crates/snapback-server/src/server.rs:30502)); all HostPlan/Ibex commit branches invoke the selected final guard ([engine.rs:17793](crates/snapback-engine/src/local/engine.rs:17793), [engine.rs:17870](crates/snapback-engine/src/local/engine.rs:17870)). |
| Eight migrated cuts: capability-link mint/revoke, three immediate-push cuts, session acknowledgement, invitation mint, Ask spend reservation | **ROUTE-CLOSED** | Unchanged. Representative deepest guards remain at [engine.rs:5577](crates/snapback-engine/src/local/engine.rs:5577), [engine.rs:6328](crates/snapback-engine/src/local/engine.rs:6328), [engine.rs:6561](crates/snapback-engine/src/local/engine.rs:6561), and [engine.rs:11276](crates/snapback-engine/src/local/engine.rs:11276). |
| Complete caller-backed asset SQLite family | **ROUTE-CLOSED** | Unchanged. Routes reserve outside Local ([asset_routes.rs:26](crates/snapback-server/src/server/asset_routes.rs:26), [asset_routes.rs:241](crates/snapback-server/src/server/asset_routes.rs:241)); storage acquires the supplied final guard immediately before commit ([asset_attempts.rs:474](crates/snapback-kernel/src/storage/asset_attempts.rs:474), [asset_reads.rs:216](crates/snapback-kernel/src/storage/asset_reads.rs:216)). |
| Watch delete/suspend/resume for sessions and scoped services; renewal for sessions | **ROUTE-CLOSED** | Unchanged. The capsule creates the caller reservation under its deadline ([commit_capsule.rs:789](crates/snapback-server/src/server/commit_capsule.rs:789)), acquires the guard at the final cut ([commit_capsule.rs:659](crates/snapback-server/src/server/commit_capsule.rs:659)), and stages resume plus enqueue in one transaction ([watches.rs:685](crates/snapback-kernel/src/storage/watches.rs:685)). |
| Detached-action nested mutations | **ROUTE-CLOSED** | Unchanged. Caller-bound children reserve exact authority ([server.rs:871](crates/snapback-server/src/server.rs:871)) and use the classified commit guard at the child cut ([server.rs:925](crates/snapback-server/src/server.rs:925)). |
| **Pairing-code mint** | **ROUTE-CLOSED** | **Newly closed by `d29353375`, `b4a49bcc1`, and `88476b032`.** Exact session authority is reserved before Local ([server.rs:17229](crates/snapback-server/src/server.rs:17229)); one absolute deadline reaches blocking-worker admission ([server.rs:17263](crates/snapback-server/src/server.rs:17263), [writer_gate.rs:177](crates/snapback-server/src/server/writer_gate.rs:177)); clock and row are staged in one transaction ([auth_grants.rs:528](crates/snapback-kernel/src/storage/auth_grants.rs:528)); `commit_guard_classified` is mode-last and the reservation is dropped at transaction return ([engine.rs:5805](crates/snapback-engine/src/local/engine.rs:5805)). This is route closure, not a type-level impossibility. |
| Preclaimed capsule bindings from graph A combined with graph B | **STRUCTURALLY IMPOSSIBLE at construction** | Unchanged. Binding parts and graph identity remain private ([admin.rs:2579](crates/snapback-server/src/admin.rs:2579), [engine.rs:3145](crates/snapback-engine/src/local/engine.rs:3145)); construction compares exact `Arc` identity ([engine.rs:3418](crates/snapback-engine/src/local/engine.rs:3418)). |
| R1 runner identity → `HostSettlement` upgrade or durable-adoption witness forgery | **STRUCTURALLY IMPOSSIBLE through the safe public API** | Unchanged. `StreamRunnerHost::new` and `HostSettlement` are private ([stream_attempt.rs:389](crates/snapback-sync/src/stream_attempt.rs:389), [stream_attempt.rs:428](crates/snapback-sync/src/stream_attempt.rs:428)); adoption requires the storage-issued `DurableStreamAttempt` carrier ([stream_attempt.rs:1257](crates/snapback-sync/src/stream_attempt.rs:1257)). |
| R1 arbitrary stream-row persistence | **ROUTE-CLOSED**, not structurally impossible | Unchanged. Storage verifies the graph issuer and HMAC ([settlement.rs:886](crates/snapback-kernel/src/storage/settlement.rs:886)), but the hidden public parts constructor remains ([stream_attempt.rs:249](crates/snapback-types/src/stream_attempt.rs:249)). Valid caller-backed stream transitions remain unfenced; only forged arbitrary rows are route-closed. |

Only **pairing-code mint** changed grade because of the three-commit pairing fence. The landed evidence ticket records two test-oracle limitations, so this should not be overstated as complete structural proof; it records no production defect and confirms the production ordering twice ([pairing evidence:39](issues/20260823-pairing-fence-residual-evidence-gaps.md:39), [pairing evidence:63](issues/20260823-pairing-fence-residual-evidence-gaps.md:63)).

R2 still creates no additional closed property subset: production supplies a no-op final callback before committing the stream batch ([settlement.rs:114](crates/snapback-kernel/src/storage/settlement.rs:114), [settlement.rs:122](crates/snapback-kernel/src/storage/settlement.rs:122)).

## 4. What did not change

Aside from pairing-code mint, every prior effect exposure remains:

- **Grant approval** still takes only the mode guard after optional asynchronous step-up and can insert a reusable delegated grant after logout ([server.rs:17405](crates/snapback-server/src/server.rs:17405), [server.rs:17428](crates/snapback-server/src/server.rs:17428), [auth_grants.rs:737](crates/snapback-kernel/src/storage/auth_grants.rs:737), [auth_grants.rs:810](crates/snapback-kernel/src/storage/auth_grants.rs:810)).

- **OAuth approval and authorization-code issuance** remain two separate mode-only Local operations, preserving the grant-only half-state as well as terminal-caller writes ([oauth.rs:565](crates/snapback-server/src/server/oauth.rs:565), [oauth.rs:584](crates/snapback-server/src/server/oauth.rs:584), [engine.rs:5107](crates/snapback-engine/src/local/engine.rs:5107), [engine.rs:5127](crates/snapback-engine/src/local/engine.rs:5127)).

- **Pending-effect approval, refusal, denial, and settlement** remain mode-only management-session writes ([engine.rs:5237](crates/snapback-engine/src/local/engine.rs:5237), [engine.rs:5317](crates/snapback-engine/src/local/engine.rs:5317), [engine.rs:5328](crates/snapback-engine/src/local/engine.rs:5328), [engine.rs:5341](crates/snapback-engine/src/local/engine.rs:5341)).

- **Grant denial and single/bulk revocation** remain protected only by the mode guard and, for revocation, the target service’s terminal gate—not the initiating management session ([server.rs:17450](crates/snapback-server/src/server.rs:17450), [server.rs:17525](crates/snapback-server/src/server.rs:17525), [server.rs:17578](crates/snapback-server/src/server.rs:17578)).

- **Approval-gated intent creation** still precedes the ordinary mutation/action reservation and persists frozen arguments and caller authority under `effect_guard` ([server.rs:30788](crates/snapback-server/src/server.rs:30788), [engine.rs:6391](crates/snapback-engine/src/local/engine.rs:6391)).

- **Watch creation** remains mode-only for both sessions and active scoped integrations and can create a watch plus integration anchor grant ([server.rs:29279](crates/snapback-server/src/server.rs:29279), [engine.rs:24618](crates/snapback-engine/src/local/engine.rs:24618), [engine.rs:24826](crates/snapback-engine/src/local/engine.rs:24826), [watches.rs:412](crates/snapback-kernel/src/storage/watches.rs:412)).

- **Caller-backed stream start, cursor premark, terminal settlement, and cancellation** still persist without caller-authority reservation. The engine API accepts only the batch, and production’s R2 callback is a no-op ([engine.rs:7750](crates/snapback-engine/src/local/engine.rs:7750), [settlement.rs:114](crates/snapback-kernel/src/storage/settlement.rs:114), [server.rs:31288](crates/snapback-server/src/server.rs:31288)). R1 expressly says persistence does not acquire the runner gate ([stream_attempt.rs:332](crates/snapback-sync/src/stream_attempt.rs:332)).

- **OAuth proposal creation, operation ranges, and the global pairing sweep** remain unfenced. LLP 0298 now establishes explicitly that these are not all excludable as auxiliary.

- **Structural residuals** remain: independently installable publication carriers ([invocation.rs:1212](crates/snapback-sync/src/auth/invocation.rs:1212), [invocation.rs:1918](crates/snapback-sync/src/auth/invocation.rs:1918)); authority/reservation substitution; open `PendingCommit` implementations and captured commit authority ([commit_capsule.rs:159](crates/snapback-server/src/server/commit_capsule.rs:159), [commit_capsule.rs:187](crates/snapback-server/src/server/commit_capsule.rs:187)); and same-ID semantic replay ([storage.rs:857](crates/snapback-kernel/src/storage.rs:857), [storage.rs:903](crates/snapback-kernel/src/storage.rs:903)).

## 5. Reachability of surviving exposures

| Surviving exposure | Reachability | Governing caller class |
|---|---|---|
| Operation identity-range issuance | **Remote authenticated** | Session on the Sessions-mode wire route |
| Global pairing sweep through grant inbox | **Remote authenticated** | Session. It is also reached by public agent-credential pairing presentation, but that is not an ordinary session/scoped-service caller. |
| OAuth proposal creation | **Local, authenticated** | Session; OAuth is loopback/local-deployment only ([oauth.rs:63](crates/snapback-server/src/server/oauth.rs:63)). |
| Ordinary grant approval | **Remote authenticated** | Session |
| OAuth approval/code issuance and denial | **Local, authenticated** | Session |
| Pending-effect approval/refusal/denial/settlement | **Remote authenticated** | Session |
| Grant denial and revocation | **Remote authenticated** | Session |
| Approval-gated intent creation | **Remote authenticated** | Session and scoped service |
| Watch creation | **Remote authenticated** | Session and scoped service |
| Caller-backed stream control persistence and cancellation | **Remote authenticated** | Session and scoped service; cancellation’s Sessions overlay explicitly requires either carrier ([server.rs:11412](crates/snapback-server/src/server.rs:11412), [server.rs:9731](crates/snapback-server/src/server.rs:9731)) |
| Publication-carrier or authority/reservation substitution | **In-process embedding only** | Affects composed session or scoped-service authority; no current wire construction |
| Open `PendingCommit`, captured capsule authority, same-ID replay | **In-process embedding/same-crate only** | No current production wire route |
| Post-construction `AppState.snapback` graph aliasing | **In-process embedding only; latent** | The public graph field survives ([admin.rs:2635](crates/snapback-server/src/admin.rs:2635)), but the current watch pending commit rejects a mismatched database authority ([watches.rs:317](crates/snapback-kernel/src/storage/watches.rs:317)) |

No property-qualifying **remote unauthenticated** counterexample was found.

## 6. Does LLP 0298 make the property reachable?

**Yes—in the engineering sense the ruling was intended to establish.** It removes the unbounded obligation to fence every harmless clock or already-decided lazy lifecycle materialization. Under the current source census, the remaining in-scope effects form a finite, enumerable closure set:

1. Fence operation-range issuance.
2. Fence or relocate OAuth proposal creation and repair/fence the mixed pairing sweep.
3. Fence grant/OAuth approval atomically.
4. Fence pending-effect decisions, settlement, denial, and refusal.
5. Fence grant/OAuth denial and grant revocation.
6. Fence approval-gated intent creation.
7. Fence watch creation.
8. Finish caller-authority fencing for stream start/premark/settlement/cancellation.
9. Seal the finite carrier/capsule structural residuals if the claim includes in-process embedding.
10. Land the auxiliary-site enumeration gate required by LLP 0298; no mechanical source gate for that closed list is present yet.

Nothing structural makes this set infinite or the effect-based property permanently unprovable. The open carrier/capsule seams weaken current closures from structural impossibility to route closure, but they are themselves finite and sealable.

The ruling therefore makes the property **reachable, but not currently true**. The pairing landing produced exactly one new positive subset; it did not close the requested operation-range, consent, management, watch-creation, stream, or structural residuals.