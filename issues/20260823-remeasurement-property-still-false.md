# Re-measurement at 4776e028e: still false, and R1/R2 did not move it

Status: Open — measurement
Created: 2026-08-23
Related: issues/20260822-residual-exposure-remeasurement.md (prior measurement at 261e595ad),
issues/20260821-residual-caller-terminal-write-exposure.md (original),
issues/20260822-authorized-effect-program-status.md

## The answer

**Still FALSE, in the same top-level way as the prior measurement.** Detached-action nested
`ctx.runMutation` remains the shortest and highest-consequence violating path, and this
measurement sharpens its reachability: it is available to a **remotely authenticated session or
scoped-service caller** through `/action/{name}`, and can commit arbitrary application mutation
effects. The detached worker retains a clone of the caller's `PreparedAuthority`; the final
callbacks check action abandonment, generation, deadline and the action commit gate — **not
session or service liveness**.

Its fence is designed (`issues/20260823-detached-action-nested-mutation-fence-design.md`) and in
review, not landed.

## What sixteen commits actually bought

Newly true since the last measurement:

- **Watch delete, suspend, resume** — route-closed for sessions *and* scoped services.
- **Watch renewal** — route-closed for sessions only.
- **Preclaimed capsule bindings from graph A with `SharedSnapback` graph B** — *structurally
  impossible at construction*, the strongest grade any subset holds.
- **R1 host/provider settlement provenance** — true only for a narrow public-API boundary.

The prior three positive subsets are unchanged. So **watch management is the only newly-true
caller-effect subset**; the capsule and R1 results are real but are structural support properties,
not caller-effect closures.

## The finding worth reading twice

**Caller-backed stream-attempt writes remain FALSE, with no property improvement from R1 or R2.**

R1 classified provenance and R2 made batches atomic. **Neither installed caller authority at the
final cut.** Production still supplies a no-op guard (`settlement.rs:114-150`) and the engine
persistence API accepts no authority or reservation (`engine.rs:7470-7477`).

That is worth stating plainly against a night that landed seven R1 commits plus R2: those changes
were necessary groundwork and they did not advance the governing property. Commit volume is not
progress on the property, and the record should not let it read that way.

## A distinction this measurement introduces

**"Route-closed" is weaker than "structurally impossible."** Route-closed means no current
production route can commit that subset terminal-first; it depends on `PreparedAuthority`,
reservations, staged values and capsule adapters not yet being fully bound by types. Only the
capsule construction property currently earns the stronger grade. Future claims should say which
they mean.

## Unchanged exposures

Grant/OAuth approval (still `effect_guard` only after asynchronous step-up; approval and code
issuance remain two separate Local operations) and pending-effect approval (mode-only decision
guard) are both unchanged from the prior measurement.

### Prior route exposures

| Prior finding | Current status | Current evidence |
|---|---|---|
| 1. Detached-action nested mutation | **Unchanged; still the top violation** | Retained/inherited authority and action-only final callbacks remain as described above. |
| 2. Grant/OAuth approval | **Unchanged** | Grant approval still takes only `effect_guard` after asynchronous step-up ([server.rs:15081–15129](crates/snapback-server/src/server.rs:15081)). OAuth grant approval and code issuance remain two separate Local operations ([oauth.rs:562–591](crates/snapback-server/src/server/oauth.rs:562)), each with a mode-only guard ([engine.rs:4967–4988](crates/snapback-engine/src/local/engine.rs:4967)). |
| 3. Pending-effect approval | **Unchanged** | The session approver reaches a mode-only decision guard ([effects.rs:240–309](crates/snapback-server/src/server/effects.rs:240), [engine.rs:5165–5169](crates/snapback-engine/src/local/engine.rs:5165)); storage commits the decision and journal in its auth transaction ([pending_effects.rs:624–691](crates/snapback-kernel/src/storage/pending_effects.rs:624)). |
| 4. Watch renewal/management | **Moved: closed for current publication-backed routes** | This is the substantive newly closed prior finding. |
| 5. Denial/revocation | **Unchanged** | Grant denial remains mode-only ([server.rs:15137–15153](crates/snapback-server/src/server.rs:15137)); grant revocation protects the target service while the initiating session still has only `effect_guard` ([server.rs:15179–15229](crates/snapback-server/src/server.rs:15179)). OAuth and pending-effect denial are also mode-only ([engine.rs:4945–4954](crates/snapback-engine/src/local/engine.rs:4945), [engine.rs:5196–5201](crates/snapback-engine/src/local/engine.rs:5196)). |
| 6. Approval-gated intent creation | **Unchanged** | It still occurs before the ordinary mutation reservation ([server.rs:27644–27678](crates/snapback-server/src/server.rs:27644)), freezes session or service authority data, and inserts under a mode-only guard ([server.rs:27963–28050](crates/snapback-server/src/server.rs:27963), [engine.rs:6154–6163](crates/snapback-engine/src/local/engine.rs:6154)). |
| 7. Auxiliary artifacts | **Behavior unchanged; still accepted by program policy** | OAuth proposals, pairing hashes, and operation ranges remain mode-only ([engine.rs:4932](crates/snapback-engine/src/local/engine.rs:4932), [server.rs:14969–14972](crates/snapback-server/src/server.rs:14969), [engine.rs:11057–11074](crates/snapback-engine/src/local/engine.rs:11057)). |
| 8. Read-side lazy expiry/pruning | **Behavior unchanged; still accepted by program policy** | Pending-effect expiry still mutates rows during reads ([pending_effects.rs:475–503](crates/snapback-kernel/src/storage/pending_effects.rs:475)); grant-inbox access still observes the clock and sweeps requests ([auth_grants.rs:612–629](crates/snapback-kernel/src/storage/auth_grants.rs:612)). |
| 9. Authorization-clock prewrites | **Physically unchanged** | The standalone transaction remains ([auth_agent_credentials.rs:1443–1445](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1443)); approval/denial parents have not yet absorbed it. |
| Separately excluded watch creation | **Unchanged and still mode-only** | The remote route admits sessions or scoped tokens ([server.rs:9365–9376](crates/snapback-server/src/server.rs:9365)); the engine still takes only `effect_guard` ([engine.rs:24398–24404](crates/snapback-engine/src/local/engine.rs:24398)); storage commits directly ([watches.rs:420–485](crates/snapback-kernel/src/storage/watches.rs:420)). |
| Caller-authored stream starts, premar​​ks, settles, and cancellation | **Final-cut exposure unchanged** | Detached start/settle still flush through `flush_stream_attempts_required` without a caller reservation ([server.rs:2405–2455](crates/snapback-server/src/server.rs:2405), [server.rs:991–1002](crates/snapback-server/src/server.rs:991)); Ask start and direct cancellation do likewise ([server.rs:25201–25237](crates/snapback-server/src/server.rs:25201), [server.rs:28463–28503](crates/snapback-server/src/server.rs:28463)). |

The accepted disposition for findings 7–9 tests whether the caller gains consequential durable value, not whether any SQLite write occurs after logout ([disposition:49–64](issues/20260822-residual-findings-4-9-disposition.md:49)). Therefore:

- Under the program’s established consequence-based interpretation, these are not active closure items.
- Under the property’s strict literal wording—“a durable SQLite write committed after terminal”—they remain counterexamples. An eventual unqualified literal `TRUE` requires fencing them or formally narrowing the property.

### Structural residuals still open

- **`PreparedAuthority` publication substitution.** Resolved authority and its two publication carriers remain independent fields ([invocation.rs:1183–1215](crates/snapback-sync/src/auth/invocation.rs:1183)); public setters still install arbitrary publication carriers without identity comparison ([invocation.rs:1527–1531](crates/snapback-sync/src/auth/invocation.rs:1527), [invocation.rs:1561–1564](crates/snapback-sync/src/auth/invocation.rs:1561)). `reserve_authorized_effect` trusts those independently installed carriers ([invocation.rs:1763–1804](crates/snapback-sync/src/auth/invocation.rs:1763)).

- **Authority/reservation substitution.** Guarded engine sinks still accept a separate `PreparedAuthority` and `AuthorizedEffectReservation`, for example capability-link mint ([engine.rs:5373–5378](crates/snapback-engine/src/local/engine.rs:5373)). Step 6 remains necessary to make `(authority_B, reservation_A)` unrepresentable ([binding plan:373–381](issues/20260822-authority-publication-binding-implementation-plan.md:373)).

- **`PendingCommit` remains an open trait.** A same-crate implementation can ignore the supplied authority or redirect the durable commit ([commit_capsule.rs:159–185](crates/snapback-server/src/server/commit_capsule.rs:159)); `FinalCommitCut` treats `Ok` as committed even though the trait contract is not compiler-enforced ([commit_capsule.rs:659–690](crates/snapback-server/src/server/commit_capsule.rs:659)).

- **Closures can capture authority that the parameter list no longer passes.** `CommitCapsuleTransaction` explicitly acknowledges that narrowing its argument does not prevent captured authority or direct stage/commit calls ([commit_capsule.rs:187–197](crates/snapback-server/src/server/commit_capsule.rs:187)). Raw capsule authority remains obtainable inside the server ([admin.rs:2618–2620](crates/snapback-server/src/admin.rs:2618)), while watch staging and commit remain callable separately ([engine.rs:24527–24558](crates/snapback-engine/src/local/engine.rs:24527), [watches.rs:317–337](crates/snapback-kernel/src/storage/watches.rs:317)).

- **Same-identity semantic replay through `into_value_for`.** Operation identifiers remain caller-constructible and do not bind an intent fingerprint ([storage.rs:852–875](crates/snapback-kernel/src/storage.rs:852)); consumption checks only database identity and operation-ID equality ([storage.rs:898–912](crates/snapback-kernel/src/storage.rs:898)). This can misattribute a decoy witness as the target intent, although it does not itself create a new write.

- **Post-construction graph aliasing remains latent.** `AppState.snapback` is public ([admin.rs:2634–2637](crates/snapback-server/src/admin.rs:2634)), so safe Rust can replace the `LocalSnapback` behind the shared mutex after valid construction. The current database-authority comparison rejects the final commit ([watches.rs:322–336](crates/snapback-kernel/src/storage/watches.rs:322)), so this reaches the final defense but is not a current committed-write route.

## 4. Reachability grading

The grade below is the most externally reachable relevant form. “Remote authenticated” routes are also usable locally; no surviving route is only a local HTTP/CLI exposure.

| Surviving exposure | Most external grade | Caller class |
|---|---|---|
| Detached-action nested mutation | **Remote authenticated** | Session and scoped service |
| Grant/OAuth approval | **Remote authenticated** | Session |
| Pending-effect approval | **Remote authenticated** | Approving session |
| Grant/OAuth/pending-effect denial and grant revocation | **Remote authenticated** | Session |
| Approval-gated intent creation | **Remote authenticated** | Session and scoped service |
| Watch creation | **Remote authenticated** | Session and scoped service |
| Caller-authored stream persistence | **Remote authenticated** | Session and scoped service |
| Auxiliary artifacts, lazy cleanup, and associated clocks | **Remote authenticated** for the relevant terminal-authority form | Primarily session; operation-range variants also cover scoped callers |
| Publication-carrier substitution | **In-process Rust embedding only** | Constructed/prepared authorities; no wire seam |
| Separate authority/reservation substitution | **In-process Rust embedding only** | Engine/API embedding |
| Open `PendingCommit` implementation | **In-process same-crate Rust only** | No current production route |
| Captured capsule authority bypass | **In-process Rust/kernel embedding only** | No current production route |
| Same-ID `into_value_for` replay | **In-process Rust/kernel embedding only** | No current production route |
| Post-construction `AppState.snapback` aliasing | **In-process Rust embedding only** | No current production route; final DB check currently refuses |

**No remote-unauthenticated caller is needed for the current violation, and no remote-unauthenticated route was found that qualifies as an ordinary session or scoped-service caller.** Anonymous or credential-free branches may write in several areas, but they fall outside the property’s caller classes.

## 5. What must land for the property to become true

Dependency order for an unqualified, structurally credible claim:

1. **Land authority/publication binding Step 5—the single highest-leverage next item.** Replace the independent resolved/publication fields with a sealed binding, delete the publication setters, and derive reservation and R1 provenance exhaustively from that binding ([binding plan:356–371](issues/20260822-authority-publication-binding-implementation-plan.md:356)). This is the common trust root for every other fence.

2. **Land Steps 6 and 7.** Make the reservation the sink’s sole authority, then bind staged work, tickets, destination graph, and reservation into owned composites ([binding plan:373–397](issues/20260822-authority-publication-binding-implementation-plan.md:373)). In the same structural tranche, seal `PendingCommit`, remove capture-reachable raw authority/commit composition, bind reconciliation to a semantic intent fingerprint, and close post-construction graph aliasing.

3. **Land the detached-action nested-mutation fence.** Reserve once per nested mutation, acquire the action gate before the authority commit guard, and latch terminal authority separately from watchdog abandonment ([detached-action design:51–83](issues/20260823-detached-action-nested-mutation-fence-design.md:51)). This removes the current highest-consequence remote violation.

4. **Migrate the remaining direct routes.** Atomically combine grant/OAuth approval with their clocks and code issuance; fence pending-effect approval; fence denial/revocation with their clocks; fence publication-backed approval-intent creation. The required transaction shapes are already designed ([critical design:208–280](issues/20260822-critical-direct-route-fence-design.md:208)).

5. **Fence watch creation after its remaining prerequisites.** The chosen design still requires the `ClosedAppQueryV1` classifier, bounded HostPlan execution, the capsule, and off-writer DNS; only the capsule has landed ([watch-creation decision:78–87](issues/20260822-watch-creation-fence-design-decision.md:78)).

6. **Complete the stream sequence.** R2 is done. R3 must first replace the mixed dirty set with typed ordered receipts; R4 must linearize caller/mode persistence against the runner/watchdog gate; only then may the caller-authority final-cut fence be installed ([stream design:339–350](issues/20260822-stream-attempt-refactor-design.md:339)).

7. **Resolve the literal-property issue.** If the quoted property truly means every caller-triggered SQLite write, auxiliary artifacts, lazy cleanup, and accepted clock writes must also be fenced or transferred to a clearly independent system-owned lifecycle. Leaving their behavior unchanged permits only the narrower consequence-based property to become true.

The immediate remote risk item is detached `ctx.runMutation`; the **highest-leverage program item is Step 5**, because without it every route fence continues to depend on publication carriers that in-process code can substitute.