# Re-measurement after the detached-action fence: the top path is closed

Status: Superseded for completion scope by LLP 0298; route-closure evidence remains valid
Created: 2026-08-23
Related: issues/20260823-remeasurement-property-still-false.md (prior measurement),
issues/20260823-detached-action-nested-mutation-fence-design.md,
issues/20260823-implementation-sequencing.md

## The headline

**The property is still FALSE — but the former top violating path is CLOSED.**

The detached-action `/action/{name}` → `ctx.runMutation` route is now **route-closed for both
sessions and scoped services**. HTTP actions classify as `CallerBound` rather than
system-mode-only; each child mutation takes a fresh caller-authority reservation; the final
callback acquires the action gate and then the authority commit guard; both HostPlan and Ibex
branches carry that reservation into their guarded sinks; and every mutation commit branch reaches
the selected posture's guard immediately before the kernel commit cut.

This is the **first measured property movement of the program**. The previous measurement recorded
that seven R1 commits plus R2 produced zero property movement; this one records that six commits
and five review rounds produced actual closure of the highest-consequence route.

## What it is not

**Route-closed, not structurally impossible.** In the measurement's own words, closure "still
relies on honestly composed `PreparedAuthority` carriers and separable reservation/sink APIs."
That distinction is the one this program keeps having to re-learn, and it is why the
authority-publication binding work still matters.

## The new shortest violating path

Under the property's literal wording it is now **session-only pairing-code mint**:

1. An authenticated session starts `POST /auth/pairing-codes`.
2. The request waits for Local; the same session logs out and becomes terminal.
3. The queued closure checks only `effect_guard`, which fences the **mode epoch** but does not
   reserve session authority.

So the exposure narrowed twice over: from a route reachable by **both** sessions and scoped
services to one reachable by **sessions only**, and from arbitrary application mutation effects to
pairing-code mint.

## Scope notes

The OAuth pairing cap is landing separately. The OAuth FK wedge is **deferred**, with two
independently reproduced silent data-loss paths recorded — it must not be counted as fixed.

### Shortest surviving violating paths

Under the property’s literal wording, the shortest path is now session-only pairing-code mint:

1. An authenticated session starts `POST /auth/pairing-codes` ([server.rs:10832](crates/snapback-server/src/server.rs:10832)).
2. The request waits for Local; the same session logs out and becomes terminal.
3. The queued closure checks only `effect_guard`, which fences the mode epoch but does not reserve session authority ([server.rs:16893](crates/snapback-server/src/server.rs:16893), [server.rs:16905](crates/snapback-server/src/server.rs:16905)).
4. Storage advances the authorization clock and inserts the durable pairing row without rechecking the session ([auth_grants.rs:217](crates/snapback-kernel/src/storage/auth_grants.rs:217), [auth_grants.rs:225](crates/snapback-kernel/src/storage/auth_grants.rs:225), [auth_grants.rs:239](crates/snapback-kernel/src/storage/auth_grants.rs:239)).

**Caller class: session only.**

Under the program’s prior consequence ranking, the new top exposure is ordinary grant approval:

- `POST /auth/grant-requests/{id}/approve` is session-authenticated ([server.rs:10953](crates/snapback-server/src/server.rs:10953)).
- After optional asynchronous step-up, it takes only `effect_guard` ([server.rs:17015](crates/snapback-server/src/server.rs:17015), [server.rs:17050](crates/snapback-server/src/server.rs:17050)).
- Storage validates the user, agent, request and scopes—but not the initiating session row—then inserts a reusable delegated grant ([auth_grants.rs:438](crates/snapback-kernel/src/storage/auth_grants.rs:438), [auth_grants.rs:491](crates/snapback-kernel/src/storage/auth_grants.rs:491)).

**Caller class: session only.**

Scoped services still have an independently sufficient counterexample: `POST /watches` admits either a session or scoped token ([server.rs:11188](crates/snapback-server/src/server.rs:11188)). Creation validates the prepared identity and active integration, performs its initial query, then takes only a mode guard ([engine.rs:24525](crates/snapback-engine/src/local/engine.rs:24525), [engine.rs:24733](crates/snapback-engine/src/local/engine.rs:24733)). Storage inserts the watch—and for integrations its standing anchor grant—in an IMMEDIATE transaction ([watches.rs:412](crates/snapback-kernel/src/storage/watches.rs:412), [watches.rs:422](crates/snapback-kernel/src/storage/watches.rs:422), [watches.rs:485](crates/snapback-kernel/src/storage/watches.rs:485)).

**Caller classes: both session and scoped service.**

## 2. Refreshed subset table

`ROUTE-CLOSED` means current production routes cannot reach a terminal-first commit. `STRUCTURALLY IMPOSSIBLE` means safe Rust/type visibility prevents constructing the violating state.

| Subset | Current grade | Delta and basis |
|---|---|---|
| Ordinary `/mutation`, after the approval helper returns without creating a pending effect | **ROUTE-CLOSED** | Unchanged from the prior measurement. The route reserves before Local ([server.rs:29612](crates/snapback-server/src/server.rs:29612)); HostPlan and Ibex final cuts consume the reservation ([engine.rs:17600](crates/snapback-engine/src/local/engine.rs:17600)). |
| Eight migrated cuts: capability-link mint/revoke, three immediate-push cuts, session acknowledgement, agent-invitation mint, Ask spend reservation | **ROUTE-CLOSED** | Unchanged. Representative reservations are at [server.rs:2597](crates/snapback-server/src/server.rs:2597), [server.rs:27917](crates/snapback-server/src/server.rs:27917), [server.rs:28176](crates/snapback-server/src/server.rs:28176), [server.rs:16868](crates/snapback-server/src/server.rs:16868), [server.rs:27281](crates/snapback-server/src/server.rs:27281), and [server.rs:29407](crates/snapback-server/src/server.rs:29407). |
| Complete caller-backed asset SQLite family | **ROUTE-CLOSED** | Unchanged. Inspect and finalize reserve by phase ([asset_routes.rs:169](crates/snapback-server/src/server/asset_routes.rs:169), [asset_routes.rs:241](crates/snapback-server/src/server/asset_routes.rs:241), [asset_routes.rs:298](crates/snapback-server/src/server/asset_routes.rs:298)); storage guards immediately before commit ([asset_attempts.rs:485](crates/snapback-kernel/src/storage/asset_attempts.rs:485), [asset_reads.rs:225](crates/snapback-kernel/src/storage/asset_reads.rs:225)). |
| Watch delete/suspend/resume for sessions and scoped services; renewal for sessions | **ROUTE-CLOSED** | Newly true because of the watch-management landing. Reservation occurs before the bounded writer wait ([commit_capsule.rs:807](crates/snapback-server/src/server/commit_capsule.rs:807)); the final guard is acquired after staging ([commit_capsule.rs:659](crates/snapback-server/src/server/commit_capsule.rs:659)). Resume transition and enqueue now share one transaction ([watches.rs:702](crates/snapback-kernel/src/storage/watches.rs:702), [watches.rs:726](crates/snapback-kernel/src/storage/watches.rs:726)). |
| Detached-action nested mutations | **ROUTE-CLOSED** | Newly true because of the detached-action fence. Applies to both sessions and scoped services. It is not a type-system guarantee. |
| Preclaimed capsule bindings from graph A combined with graph B | **STRUCTURALLY IMPOSSIBLE at construction** | Newly true because of the construction-origin seal. The runtime binding is private ([admin.rs:2579](crates/snapback-server/src/admin.rs:2579)); engine bindings have private parts and graph identity ([engine.rs:3145](crates/snapback-engine/src/local/engine.rs:3145)); construction checks exact `Arc` identity before releasing the parts ([engine.rs:3418](crates/snapback-engine/src/local/engine.rs:3418)). |
| R1 runner identity → `HostSettlement` upgrade and durable-adoption witness forgery | **STRUCTURALLY IMPOSSIBLE through the safe public API** | Newly true. `StreamRunnerHost::new` is private, `HostSettlement` is module-private, and adoption requires a storage-issued witness ([stream_attempt.rs:389](crates/snapback-sync/src/stream_attempt.rs:389), [stream_attempt.rs:428](crates/snapback-sync/src/stream_attempt.rs:428), [stream_attempt.rs:1257](crates/snapback-sync/src/stream_attempt.rs:1257)). |
| R1 arbitrary stream-row persistence | **ROUTE-CLOSED**, not structurally impossible | Storage verifies issuer and HMAC ([settlement.rs:886](crates/snapback-kernel/src/storage/settlement.rs:886)), but the batch type retains a public hidden constructor ([stream_attempt.rs:249](crates/snapback-types/src/stream_attempt.rs:249)); invalid constructions are rejected at runtime. |

R2 did **not** create another positive subset for the governing property. It atomically persists a batch in one IMMEDIATE transaction ([settlement.rs:122](crates/snapback-kernel/src/storage/settlement.rs:122)), but production still supplies a no-op final guard ([settlement.rs:114](crates/snapback-kernel/src/storage/settlement.rs:114)).

## 3. What the landings did not change

The following prior exposures remain:

| Surviving exposure | Current evidence |
|---|---|
| Grant and OAuth approval | Grant approval remains mode-only at [server.rs:17050](crates/snapback-server/src/server.rs:17050). OAuth still performs grant approval and code issuance as two Local operations ([oauth.rs:567](crates/snapback-server/src/server/oauth.rs:567), [oauth.rs:582](crates/snapback-server/src/server/oauth.rs:582)), each mode-only ([engine.rs:5107](crates/snapback-engine/src/local/engine.rs:5107), [engine.rs:5127](crates/snapback-engine/src/local/engine.rs:5127)). |
| Pending-effect approval | Management authority still reaches only `effect_guard` before the durable decision ([engine.rs:5250](crates/snapback-engine/src/local/engine.rs:5250), [engine.rs:5317](crates/snapback-engine/src/local/engine.rs:5317)); storage commits the decision and journal together ([pending_effects.rs:624](crates/snapback-kernel/src/storage/pending_effects.rs:624), [pending_effects.rs:670](crates/snapback-kernel/src/storage/pending_effects.rs:670)). |
| Denial and revocation decisions | Grant denial remains mode-only ([server.rs:17083](crates/snapback-server/src/server.rs:17083)); grant revocation fences the authority being retired but not the initiating session ([server.rs:17146](crates/snapback-server/src/server.rs:17146), [server.rs:17149](crates/snapback-server/src/server.rs:17149)). OAuth and pending-effect denial are also mode-only ([engine.rs:5094](crates/snapback-engine/src/local/engine.rs:5094), [engine.rs:5237](crates/snapback-engine/src/local/engine.rs:5237)). |
| Approval-gated intent creation | The helper still inserts the pending intent before ordinary `/mutation` obtains its reservation; creation uses only `effect_guard` ([engine.rs:6313](crates/snapback-engine/src/local/engine.rs:6313), [pending_effects.rs:559](crates/snapback-kernel/src/storage/pending_effects.rs:559)). |
| Watch creation | Still mode-only and still reachable by both caller classes, as described above. The management landing covered delete/suspend/resume/renew, not creation. |
| Caller-backed stream start, premark, settlement and cancellation | R1 supplies provenance and R2 supplies atomicity, but not caller authority at commit. Cancellation derives caller provenance and immediately persists ([server.rs:30397](crates/snapback-server/src/server.rs:30397), [server.rs:30416](crates/snapback-server/src/server.rs:30416)); the engine persistence API accepts no authority ([engine.rs:7672](crates/snapback-engine/src/local/engine.rs:7672)). R1 explicitly says persistence does not acquire the runner gate ([stream_attempt.rs:332](crates/snapback-sync/src/stream_attempt.rs:332)). |
| Auxiliary artifacts | Pairing-code rows, OAuth proposals and operation ranges remain mode-only ([server.rs:16905](crates/snapback-server/src/server.rs:16905), [auth_integrations.rs:842](crates/snapback-kernel/src/storage/auth_integrations.rs:842), [engine.rs:11275](crates/snapback-engine/src/local/engine.rs:11275)). |
| Read-side lazy expiry/pruning | Pending-effect reads still update expired records ([pending_effects.rs:475](crates/snapback-kernel/src/storage/pending_effects.rs:475), [pending_effects.rs:593](crates/snapback-kernel/src/storage/pending_effects.rs:593)); grant inbox access still advances clocks and sweeps pairing requests ([auth_grants.rs:612](crates/snapback-kernel/src/storage/auth_grants.rs:612)). |
| Authorization-clock prewrites | The standalone auth transaction remains ([auth_agent_credentials.rs:1443](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1443)). |

The program’s earlier disposition treated auxiliary artifacts, cleanup and some clock writes as acceptable because they do not necessarily give the terminal caller consequential durable authority. That interpretation does not satisfy the unchanged literal property.

### Structural residuals still open

- **`PreparedAuthority` publication substitution.** Resolved authority, session publication and service publication remain independent fields ([invocation.rs:1212](crates/snapback-sync/src/auth/invocation.rs:1212)). Public setters can install publications independently ([invocation.rs:1918](crates/snapback-sync/src/auth/invocation.rs:1918), [invocation.rs:1952](crates/snapback-sync/src/auth/invocation.rs:1952)); reservations trust the installed fields ([invocation.rs:2202](crates/snapback-sync/src/auth/invocation.rs:2202)).

- **Authority/reservation substitution.** Guarded sinks still accept a `PreparedAuthority` separately from the reservation it is expected to have minted, for example capability-link mint ([engine.rs:5522](crates/snapback-engine/src/local/engine.rs:5522)).

- **`PendingCommit` remains an open trait.** A same-crate implementation can ignore the supplied authority or redirect the commit ([commit_capsule.rs:159](crates/snapback-server/src/server/commit_capsule.rs:159)); `FinalCommitCut` trusts `Ok` as committed ([commit_capsule.rs:630](crates/snapback-server/src/server/commit_capsule.rs:630), [commit_capsule.rs:684](crates/snapback-server/src/server/commit_capsule.rs:684)).

- **Closures can capture authority omitted from their parameter list.** The capsule documents this explicitly ([commit_capsule.rs:187](crates/snapback-server/src/server/commit_capsule.rs:187)); raw capsule authority is still exposed inside the server crate ([admin.rs:2618](crates/snapback-server/src/admin.rs:2618)), and watch staging/commit remain separately callable ([watches.rs:307](crates/snapback-kernel/src/storage/watches.rs:307)).

- **Same-identity semantic replay through `into_value_for`.** Operation identifiers remain caller-constructible and do not bind an intent fingerprint ([storage.rs:856](crates/snapback-kernel/src/storage.rs:856)). Consumption compares only database identity and operation-ID equality ([storage.rs:902](crates/snapback-kernel/src/storage.rs:902)); `exact_existing` treats that witness as committed ([commit_capsule.rs:701](crates/snapback-server/src/server/commit_capsule.rs:701)).

- **Post-construction graph aliasing.** `AppState.snapback` remains public ([admin.rs:2635](crates/snapback-server/src/admin.rs:2635)). The current watch pending adapter’s final database-authority comparison refuses a mismatched commit ([watches.rs:317](crates/snapback-kernel/src/storage/watches.rs:317)), so this is latent rather than a current violating route.

## 4. Reachability grading

| Surviving exposure | Reachability | Caller class |
|---|---|---|
| Pairing-code mint; ordinary grant approval | **Remote authenticated caller** | Session |
| OAuth proposal/approval/code issuance | **Local authenticated caller** | Session; OAuth requires local deployment and loopback transport ([oauth.rs:60](crates/snapback-server/src/server/oauth.rs:60)). |
| Pending-effect approval | **Remote authenticated caller** | Session |
| Grant/pending-effect denial and grant revocation | **Remote authenticated caller** | Session |
| OAuth denial | **Local authenticated caller** | Session |
| Approval-gated intent creation | **Remote authenticated caller** | Session and scoped service |
| Watch creation | **Remote authenticated caller** | Session and scoped service |
| Caller-backed stream persistence | **Remote authenticated caller** | Session and scoped service |
| Operation-range issuance | **Remote authenticated caller** | Session and scoped service |
| Lazy cleanup and associated clocks | **Remote authenticated caller** | Primarily session |
| Publication-carrier substitution | **In-process Rust/kernel embedding only** | No wire route |
| Authority/reservation substitution | **In-process Rust/kernel embedding only** | No current wire route |
| Open `PendingCommit` implementation | **In-process same-crate Rust only** | No current production route |
| Captured capsule authority | **In-process Rust/kernel embedding only** | No current production route |
| Same-ID semantic replay | **In-process Rust/kernel embedding only** | No current production route |
| Post-construction graph aliasing | **In-process Rust embedding only** | Final database check currently refuses |

No qualifying **remote unauthenticated** route was found. Anonymous and credential-free system branches can write, but they are not ordinary session or scoped-service callers.

## 5. What must land for the property to become true

Recommended dependency order:

1. **Fence pending-effect approval.** Acquire the exact approver reservation after preparation, retain it through the decision transaction, then release it before dispatching the stored invocation.

2. **Complete authority-publication binding Steps 2–5.** Replace independently installable publication fields with the sealed binding. Step 5 removes carrier substitution, but by itself closes no current remote route; it must not be reported as a property-moving landing.

3. **Fence grant/OAuth approval atomically.** Combine clock observation, grant creation and OAuth code issuance into the one intended operation. Two separately fenced OAuth transactions would preserve the existing grant-only half-state.

4. **Fence the remaining direct routes.** Denial/revocation—including their clocks—and publication-backed approval-intent creation must receive exact caller reservations.

5. **Fence watch creation after its query-classification and bounded-execution prerequisites.** Management fencing did not cover this route.

6. **Finish the stream chain:** R3 typed ordered receipts → R4 runner/watchdog linearization → actual caller-authority reservation at the R2 final cut. R1 and R2 alone do not move this property.

7. **Complete binding Steps 6–7 and seal the capsule residuals.** Make the reservation the sink’s sole authority; bind staged work and destination into owned composites; seal `PendingCommit`; eliminate captured-authority composition; and add semantic intent fingerprints.

8. **Resolve every literal residual.** Pairing/proposal artifacts, operation ranges, lazy cleanup and accepted authorization-clock writes must either be fenced or assigned to a genuinely caller-independent lifecycle. Without this, only a narrower consequence-based property can become true.

**Single highest-leverage next landing:** the pending-effect approval fence. It is the smallest ready change that closes a measured remote-authenticated counterexample. Grant/OAuth approval is higher consequence, but has larger atomicity and migration dependencies.

## OAuth cap/FK status

Neither item counts as progress on this property:

- The OAuth pairing cap is not present in this measured ref. The ordinary cap counts only rows with `consumed_at_ms IS NULL` ([auth_grants.rs:229](crates/snapback-kernel/src/storage/auth_grants.rs:229)), while OAuth directly inserts its pairing parent with `consumed_at_ms = now` ([auth_integrations.rs:874](crates/snapback-kernel/src/storage/auth_integrations.rs:874)).
- The FK wedge is **not fixed**: `_snapback_oauth_authorizations.request_id` still uses `ON DELETE RESTRICT` ([auth_integrations.rs:52](crates/snapback-kernel/src/storage/auth_integrations.rs:52), [auth_integrations.rs:72](crates/snapback-kernel/src/storage/auth_integrations.rs:72)). Its deferred status and two recorded data-loss paths remain outside this measurement’s closure claims.
