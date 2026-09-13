# Implementation sequencing, and a correction to how this program has been run

Status: Open — process change adopted; auxiliary-write scope resolved by LLP 0298
Created: 2026-08-23
Related: issues/20260823-remeasurement-property-still-false.md,
issues/shelved/20260822-authority-publication-binding-implementation-plan.md,
issues/shelved/20260823-approval-fence-design.md, issues/shelved/20260823-test-discrimination-fix-plan.md

## Why this was commissioned

Six designs landed in one session and one was implemented. Rather than write a seventh, I asked
for an implementation order ranked by **property progress per unit of risk-adjusted effort**, and
for a direct answer on whether I am over-designing.

## The answer on process

> "The sequencing problem is real, and the session is over-designing relative to implementation
> capacity."

And the evidence offered is better than the one I proposed. It is **not** "six designs versus one
implementation" — it is that seven R1 commits plus R2 produced necessary groundwork and **zero
measured property movement**, while the next structural plan alone spans eight steps, 26 setter
sites, 49 reservations, and a 35–55-call migration.

**Adopted immediately:**

1. **WIP limit: one unimplemented accepted design, plus one implementation under review.**
2. **No new fence design until one current remote route becomes newly closed.**
3. **Every landing record labels its delta** `PROPERTY`, `STRUCTURAL PREREQUISITE`, `EVIDENCE ONLY`,
   or `ORTHOGONAL CORRECTNESS`.
4. **Remeasure after property-moving landings**, not after design or commit volume.
5. Lane one for the next property closure; lane two only for source-independent work.
6. **Do not claim convergence against an undefined completion boundary.** LLP
   0297 subsequently resolved the boundary as effect-based with a closed,
   enumerated auxiliary-write set; future measurements use that ruling.

## A correction I need to record against myself

I have repeated several times, including in a landed ticket, that **binding Step 5 subsumes
test-discrimination findings 1–4 and 11–13. That is wrong.** Verified per finding:

- #1 needs **Step 6** (removing the separate authority argument), not Step 5.
- #2 needs a restricted staging capability and sealed commit outcome; open `PendingCommit` and
  captured-Local remain.
- #3 needs Step 7's destination binding plus closing post-construction `AppState.snapback` aliasing.
- #4 needs a kernel-minted sealed exact-reconciliation proof, not `AuthorityFenceBinding`.
- #11 needs semantic-intent fingerprinting, not graph/carrier identity.
- #12 needs sealed rollback/commit outcomes.
- #13 remains a test-lifetime weakness that explicit `DevMode` does not address.

**Exactly one finding becomes moot at Step 5: #8**, because deleting both `has_*` booleans and
deriving posture exhaustively from the private binding removes the service-publication-only
misclassification.

That correction matters for scheduling: I had been treating Step 5 as clearing seven findings, so
its value was overstated relative to its very large cost.

## The cheapest real win

**Marginally: land the already-implemented detached-action fence.** Among *undispatched* work, it
is **pending-effect approval (A)** — acquire one exact approver reservation after preparation,
retain it through the guarded decision transaction, drop it before dispatching the stored
invocation. **That changes behaviour on a measured remote route.** Test #9, test #10, R3, binding
Steps 2–5, and the capsule residuals do not.

Note this inverts the grading in the approval design: grant/OAuth creates the *stronger* capability
and is the worse exposure, but pending-effect is the cheaper *property* win, and property movement
is the ranking criterion now.

## Recommended order

1. **Finish and land the in-flight detached-action nested-mutation fence.**  
   This removes the shortest, highest-consequence violation: a remote session or scoped-service caller can currently commit arbitrary application mutations after terminalization (`issues/20260823-remeasurement-property-still-false.md:11-20`; `issues/20260823-detached-action-nested-mutation-fence-design.md:10-23`). This is the best marginal return because implementation already exists. The in-flight #7/#9 test fixes may land, but count them as evidence improvements, not property progress.

2. **Implement pending-effect approval, section A of `20260823-approval-fence-design.md`.**  
   This is the cheapest undispatched real win. It closes one remote-authenticated route by reserving the exact approver through the guarded decision transaction, then releasing it before recursive execution (`issues/shelved/20260823-approval-fence-design.md:171-194,255-266`). It is materially smaller than grant/OAuth and protects a one-shot exact invocation rather than redesigning reusable delegated authority (`:15-24`).

3. **Execute authority-binding Steps 2→3→4→5 as one uninterrupted tranche.**  
   Do not misreport this as caller-effect closure:

   - Steps 2–4 explicitly make no behavior claim and only migrate producers/consumers (`issues/shelved/20260822-authority-publication-binding-implementation-plan.md:307-354`).
   - Step 5 makes carrier substitution inexpressible (`:356-371`), but no current production route exercises that in-process substitution. The measured caller-terminal-write property remains false.
   - It nevertheless belongs here because it is the common trust root, and building the larger grant/OAuth fence before it would add another substantial migration target (`issues/20260823-remeasurement-property-still-false.md:120-138`).

4. **In the second lane alongside item 3, implement the OAuth proposal cap/FK-wedge repair. Land it before item 5.**  
   This does **not** move the authorized-effect property—the design says so explicitly (`issues/shelved/20260823-oauth-proposal-bound-and-fk-wedge-design.md:142-149`). It is still worth doing because one local authenticated user can wedge pairing mint, presentation, and inbox globally, while proposal rows grow without a durable bound (`:20-50`). It is the best independent second-lane job.

5. **Implement ordinary grant approval plus atomic OAuth approval/code issuance as one change.**  
   This closes a worse property exposure than pending approval because it creates reusable authority lasting 30–90 days (`issues/shelved/20260823-approval-fence-design.md:15-24`). Do not split OAuth into two fenced transactions: that deterministically preserves the grant-only half-state (`:26-48,211-229`).  
   This item is not dispatch-ready under a strict “no new design” rule until the existing grant-only half-state policy is selected; the ticket currently offers detection/expiry versus one-time reconciliation without choosing (`:50-54,324-334`).

6. **Implement the remaining remote direct-route closures before returning to latent structural residuals.**  
   Specifically: denial/revocation and approval-gated intent creation. They remain remote-authenticated counterexamples (`issues/20260823-remeasurement-property-still-false.md:64-76,101-110`). They outrank in-process capsule hardening by the requested metric.

7. **Resume the stream chain only after its blockers are removed: R3 amendment → R3 → R4 ruling/implementation → actual caller-authority stream fence.**  
   R3 is not dispatchable under this request: its API amendment is still required (`issues/shelved/20260823-stream-r2-r3-revalidation.md:28-41`), and no stream fence may land before R4 (`:55-58`). R3 itself is structural groundwork and does not move the property. R2 is already landed and should be removed from the queue; measurement explicitly says R1/R2 produced no property improvement (`issues/20260823-remeasurement-property-still-false.md:38-46`).

8. **Then do Binding Steps 6 and 7, folding the relevant capsule and asset-carrier work into them; finish with Step 8.**  
   Steps 6–7 close authority/reservation and ticket/destination substitution (`issues/shelved/20260822-authority-publication-binding-implementation-plan.md:373-397`). These are necessary for an unqualified structural claim, but their current exposure is in-process only (`issues/20260823-remeasurement-property-still-false.md:111-116`), so they rank below live remote routes. Step 8 is cleanup/evidence only (`issues/shelved/20260822-authority-publication-binding-implementation-plan.md:399-405`).

Suggested two-lane waves:

- Current: finish detached action; finish the already-running #7/#9 branch. Serialize landing/rebase because they conflict.
- Next: pending-effect approval + test finding #10, if a second lane must remain occupied.
- Then: Binding Steps 2–5 + OAuth proposal/FK wedge.
- Then: grant/OAuth approval alone; the second lane should avoid auth, engine, server, and invocation work.

## File-level conflict map

| Work item | Principal files |
|---|---|
| Detached action, in flight | `snapback-auth/src/auth/{admission,service_fence}.rs`; `snapback-sync/src/auth/{invocation,session_projection}.rs`; `snapback-engine/src/local/engine.rs`; `snapback-server/src/server.rs`, `writer_gate.rs`, `commit_capsule.rs`, `tests.rs`; `snapback-kernel/src/storage.rs` (`20260823-detached-action-nested-mutation-fence-design.md:297-317`) |
| Test #7, in flight | `snapback-sync/src/auth/invocation.rs`; `snapback-server/src/server/{asset_routes,tests}.rs`; `snapback-server/src/server.rs`; `snapback-kernel/src/storage/{asset_attempts}.rs`; `storage.rs` (`20260823-test-discrimination-fix-plan.md:49-76`) |
| Test #9, in flight | `snapback-engine/src/local/tests/engine.rs` (`20260823-test-discrimination-fix-plan.md:78-99`) |
| Binding Steps 2–5 | `snapback-auth/src/auth/admission.rs`; `snapback-sync/src/auth/{coordinator,invocation}.rs`; `snapback-sync/src/stream_attempt.rs`; `snapback-engine/src/local/{engine,tests/engine}.rs`; `snapback-server/src/server.rs`, `tests.rs`, possibly `commit_capsule.rs` (`20260822-authority-publication-binding-implementation-plan.md:267-275,307-371`) |
| Pending-effect approval | `invocation.rs`, `session_projection.rs`, `commit_capsule.rs`, `engine.rs`, `server/effects.rs`, `server.rs`, `storage.rs`, `storage/auth.rs`, `storage/pending_effects.rs` (`20260823-approval-fence-design.md:245-266`) |
| Grant/OAuth approval | Common approval files plus `server/oauth.rs`, `storage/auth_grants.rs`, `storage/auth_integrations.rs` (`20260823-approval-fence-design.md:268-284`) |
| OAuth proposal/FK wedge | `storage/auth.rs`, `storage/auth_grants.rs`, `storage/auth_integrations.rs`, `storage/auth_mode.rs`; possibly root `storage.rs` (`20260823-oauth-proposal-bound-and-fk-wedge-design.md:101-177`) |
| Binding Steps 6–7 | `invocation.rs`, `engine.rs`, `server.rs`, `asset_routes.rs`, `commit_capsule.rs`, engine/server tests, asset/watch storage modules (`20260822-authority-publication-binding-implementation-plan.md:166-213,373-397`) |
| R3 | `snapback-sync/src/stream_attempt.rs`; `engine.rs`; `server.rs`; `storage/settlement.rs`; associated tests (`20260823-stream-r2-r3-revalidation.md:96-116`) |
| Capsule residual tranche | `server/admin.rs`, `server/commit_capsule.rs`, `engine.rs`, `storage.rs`, `storage/watches.rs` (`20260822-capsule-structural-residuals.md:88-131`) |
| Test #5 | asset carrier definitions in `snapback-kernel/src/services_assets.rs`, `snapback-services/src/assets.rs`, and a private engine carrier module plus security fixtures (`20260823-test-discrimination-fix-plan.md:16-47`) |
| Test #10 | `snapback-engine/src/local/tests/engine.rs` (`20260823-test-discrimination-fix-plan.md:101-134`) |

Every item touching `crates/snapback-sync/src/auth/invocation.rs`:

- Detached-action fence: reservation and final-guard classification.
- In-flight finding #7 fix: test markers/scope probe at `invocation.rs:1251`.
- Binding Step 4 retained-live migration, Step 5 binding/enforcement cut, and Step 6 reservation authority view.
- Approval common prerequisite used by both pending-effect and grant/OAuth approval (`invocation.rs:1291-1331,1753-1805`).
- A standalone finding #8 repair would touch its `has_*` predicates, but that repair should be dropped because Step 5 deletes them.
- Step 7 may need no further edit if Step 6 exposes the required graph view; do not create another projection opportunistically.

Pairs that **must not** run concurrently:

- Detached action ↔ Binding Steps 2–6, either approval fence, finding #7, R3, or capsule residual work.
- Binding Steps 2–5 ↔ either approval fence, R3, Steps 6–7, or findings #5/#7/#9/#10.
- Pending-effect approval ↔ grant/OAuth approval, OAuth FK wedge, R3, or capsule residuals.
- Grant/OAuth approval ↔ OAuth FK wedge, R3, or capsule residuals.
- Binding Steps 6–7 ↔ findings #5/#7/#9/#10 or capsule residuals.
- The two current in-flight branches already overlap at `invocation.rs`, `server.rs`, `server/tests.rs`, and `storage.rs`; land one and rebase the other.

Safe source-level pairs:

- **Binding Steps 2–5 + OAuth proposal/FK wedge** — the recommended two-lane pairing.
- **R3 + OAuth proposal/FK wedge**, once R3 is unblocked.
- **Pending-effect approval + finding #10**.
- **OAuth proposal/FK wedge + finding #5 or #10**, although #5 should be deferred.

Generated diagnostics/guide files may still conflict mechanically; the later landing should regenerate them after rebasing. That is not a semantic dependency (`issues/shelved/20260823-stream-r2-r3-revalidation.md:339-347`).

## Blocking relationships

Genuine blockers:

- Binding Step 5 requires Steps 2–4: the closed producers and all consumers must exist before deleting the raw setters/constructors.
- Approval B requires the shared typed reservation/terminal-cause plumbing and one atomic ordinary/OAuth operation. It also needs a ruling for pre-existing grant-only OAuth half-states.
- R3 requires its API amendment.
- R4 requires R3; the watchdog-durability ruling was resolved 2026-08-22 in
  `issues/shelved/20260822-author-rulings-fence-program.md`.
- A stream caller-authority fence requires R4.
- Binding Step 8 requires Steps 5–7.
- LLP 0298 formally selected the effect-based boundary and requires every
  excluded auxiliary site to satisfy all four criteria and appear in a gated
  enumeration. The next measurement, rather than this pre-ruling plan, owns
  the resulting completion verdict.

Merely awkward, not blocked:

- Detached action and pending-effect approval do not require Step 5. They can produce real route closure first, albeit weaker than structural impossibility.
- Binding Step 6 could mechanically precede Step 5, but would bind sinks to an authority that can still be hybrid; that defeats its intended proof.
- OAuth FK repair and approval B can land in either order, but they conflict heavily and the wedge should go first.
- Finding #5 is not blocked by binding, but doing its 3–5-day asset-carrier move before Step 7 creates duplicate churn.
- R3 is not logically dependent on Step 5, but doing it first means later rewriting its provenance carrier around `AuthorityFenceBinding`.

## Step 5 does not subsume findings 1–4 and 11–13

The claim in `issues/shelved/20260823-test-discrimination-fix-plan.md:5-7` is wrong if it means **Step 5 itself**. None of findings 1–4 or 11–13 becomes moot at Step 5:

- **#1:** Step 6 closes full authority-B/reservation-A substitution by removing the separate authority argument (`binding plan:373-381`).
- **#2:** Needs a restricted staging capability and sealed commit outcome; the open `PendingCommit`/captured-Local problem remains (`capsule residuals:88-117`).
- **#3:** Needs Step 7’s destination binding plus closure of post-construction `AppState.snapback` aliasing (`capsule residuals:23-47`).
- **#4:** Needs a kernel-minted sealed exact-reconciliation proof, not `AuthorityFenceBinding` (`landed-fence-tests...md:118-126`).
- **#11:** Needs semantic-intent fingerprinting/uniqueness, not graph/carrier identity (`capsule residuals:119-131`).
- **#12:** Needs sealed rollback/commit outcomes, alongside #2.
- **#13:** Remains a test-lifetime weakness. Explicit `DevMode` does not prove when a real session permit is dropped (`landed-fence-tests...md:210-218`).

The finding that actually becomes moot under Step 5 is **#8**: deleting both `has_*` booleans and deriving posture exhaustively from the private binding removes the service-publication-only misclassification (`binding plan:356-367`; `landed-fence-tests...md:160-168`). Step 5 also removes one prerequisite mechanism behind #1, but not #1’s full sink-level counterexample.

## Cheapest real win

Marginally, it is **landing the already-implemented detached-action nested-mutation fence**.

Among undispatched work, it is precisely **pending-effect approval A**: acquire one exact approver `AuthorizedEffectReservation` after preparation, retain it through `pending_effects.rs:624-691`’s guarded transaction callback, and drop it before dispatching the stored invocation. That changes behavior on a measured remote route. Test #10, test #9, R3, Binding Steps 2–5, and the capsule residuals do not.

## Drop or defer

- Remove R2 from the queue: it is landed.
- Do not schedule standalone fixes for findings #1–4 or #11–12. Make their adversarial tests acceptance criteria of Steps 6–7 and the sealed capsule tranche.
- Drop standalone finding #8; Step 5 makes it moot.
- Defer finding #5 and fold it into Step 7’s asset-carrier/composite migration. Its current exposure is latent, and 3–5 days is poor value now.
- Defer finding #10 until `engine` test work is otherwise active. It is cheap but evidence-only.
- Defer finding #13; it remains real but Medium and test-only.
- Defer the Low graph-identity-mint residual indefinitely unless a durable-key intern is proposed.
- Defer post-construction `AppState` aliasing while the final database-authority check continues to refuse the commit.
- Defer open-`PendingCommit`, captured-authority, and semantic-replay hardening until Step 7 or until an embedding route makes them production-reachable.
- Do **not** drop the OAuth FK wedge: it is orthogonal to this property but is a real authenticated local availability defect.

## Process sanity check
