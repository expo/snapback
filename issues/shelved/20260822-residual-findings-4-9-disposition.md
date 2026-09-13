# Disposition of residual findings 4–9: fix two, accept three, collapse one

Status: Open — findings 4 and 5 are implementable now; 7, 8 and the 9 remainder are ACCEPT
Created: 2026-08-22
Related: issues/shelved/20260821-residual-caller-terminal-write-exposure.md,
issues/shelved/20260822-critical-direct-route-fence-design.md,
issues/shelved/20260823-oauth-pairing-fk-wedge-deferred.md, LLP 0058

> **Correction (2026-08-23):** the Finding 7 acceptance remains about terminal
> fencing only; its claim that OAuth/pairing debris had bounded storage cost was
> false when written. OAuth proposal creation is now covered by the shared
> unresolved-ceremony cap, closing unbounded per-user growth. The child FK wedge
> remains open: expiry cleanup and destructive parent purges can still fail.

## Summary

| Finding | Decision | Effort vs the asset migration |
|---|---|---|
| 4. Watch renewal / management | **Fix** — split-phase | Smaller |
| 5. Denial / revocation decisions | **Fix** — split-phase, absorbing related clock writes | Larger; **riskiest item** |
| 6. Approval-gated intent creation | **Conditional** — split-phase only where a real caller publication exists; mode-only otherwise | Smaller |
| 7. Auxiliary authority artifacts | **Accept** — keep mode-only | Acceptance smaller; fencing would be comparable |
| 8. Read-side expiry / pruning (non-asset remainder) | **Accept** — keep mode-only | Smaller |
| 9. Authorization-clock prewrites | **No independent fence** — collapse into the parent transactions fixed by 4/5, accept the remainder | Collapse smaller |

Two fixes, one conditional, three acceptances. Fencing all six was never the right shape.

## The governing rule, restated because a lane got it wrong

The discriminator is the **actual `PreparedAuthority.publication` / `service_publication`** — never
`trigger_mode`, an invocation-source label, or any correlated enum. A recent migration broke
credential-free watch-reaction push by keying off `trigger_mode`, which was exhaustively matched
and still wrong. Reservation already validates the real publications; use that.

At every migrated cut, **replace** the existing `effect_guard()`, never wrap it — both `validate()`
and `effect_guard()` take the same non-reentrant mutex. After reservation, use the Critical
design's deadline-bounded Local capsule, because `lock_managed_snapback()` retries indefinitely.

## 4. Watch renewal and management — fix

Scoped routes are delete, suspend, resume and renew (creation is excluded; a separate lane owns
it). Delete/suspend/resume share a common transition; **resume performs a second durable
evaluation enqueue**, so it is multi-transaction. Renewal's single transaction revokes the old
grant, creates the replacement and updates the watch.

These have real consequences — delete/suspend retire the watch, resume reactivates it and queues
work, renewal mints a long-lived replacement grant — so split-phase is warranted. Credential-free
scheduled evaluation and reaction stay mode-only and untouched.

## 5. Denial and revocation — fix, and the riskiest item

Marked larger than the asset migration and the riskiest of the six. It absorbs the related
authorization-clock writes from finding 9 rather than leaving them as an unguarded earlier sibling
— which is the trap the residual audit already flagged for grant/OAuth.

## 7, 8 and the 9 remainder — ACCEPT, with the consequence boundary stated

The test applied is not "can this write happen after logout" but **"does the caller gain anything
durable from it"**.

**7 — auxiliary artifacts.** OAuth authorization proposal: a terminal-first race can leave a
proposal, but no grant, token, or delivered code, and any later approval needs a fresh explicit
consent. Pairing code: storage persists only the *hash*, so a lost race leaves unusable debris,
and rows are capped per user. Identity range: a lost range can be re-served only to the same
authority/audience while unused — a fresh session cannot claim the terminated authority's range.

**8 — read-side lazy expiry/pruning** (pending-effect inbox and pre-approve lookup, grant-request
inbox): these realize authority-independent lifecycle expiry or bounded pruning. No caller value,
privilege, spend, exposure, or caller-supplied content. Notably: **do not extend Critical 3's
decision permit backward across lookup, step-up or lazy expiry** — the Critical design keeps
lookup separate on purpose.

Each acceptance still carries characterization tests proving both orderings converge and that
neither creates authority, spend, or executable intent. Acceptance is documented and tested, not
assumed.

## Provenance

Read-only codex design against `f7c01d84f`. Full per-finding design with file:line citations
appended below.

---

No files were modified. This design is based on current `origin/main`/HEAD `f7c01d84f5e21d53e78879edfc7d8bd6df3c5665`.

## Decision summary

| Finding | Decision | Relative effort |
|---|---|---|
| 4. Watch renewal/management | Fix with split-phase fencing | Smaller than asset migration |
| 5. Denial/revocation | Fix with split-phase fencing; absorb related clock writes | Larger; riskiest item |
| 6. Approval-gated intent creation | Split-phase only when an actual caller publication exists; mode-only otherwise | Smaller |
| 7. Auxiliary artifacts | Accept; retain mode-only behavior | Acceptance work smaller; fencing all three would be comparable |
| 8. Read-side expiry/pruning remainder | Accept; retain mode-only behavior | Smaller |
| 9. Authorization-clock prewrites | No independent fence. Collapse into fixed parent transactions; accept the remainder | Collapse smaller; standalone migration comparable/larger |

The governing discriminator is the actual `PreparedAuthority.publication` / `service_publication`, not `trigger_mode`, an invocation-source label, or any correlated enum. Those fields are defined in [invocation.rs](crates/snapback-sync/src/auth/invocation.rs:1185), and reservation already validates the real publications in [invocation.rs](crates/snapback-sync/src/auth/invocation.rs:1664).

At every migrated cut, replace the existing `effect_guard()`; do not wrap it. `commit_guard()` acquires the mode guard last in [invocation.rs](crates/snapback-sync/src/auth/invocation.rs:1253). After reservation, use the Critical design’s deadline-bounded Local completion capsule: ordinary `lock_managed_snapback()` retries indefinitely in [writer_gate.rs](crates/snapback-server/src/server/writer_gate.rs:85).

## 4. Watch renewal and management transitions — fix

### Exact routes and durable cuts

Creation is excluded. Its current entry and mode guard are at [engine.rs](crates/snapback-engine/src/local/engine.rs:23378), and the separate lane owns that migration.

The scoped management routes are delete, suspend, resume, and renew at [server.rs](crates/snapback-server/src/server.rs:26292).

- Delete/suspend/resume reach the common transition at [engine.rs](crates/snapback-engine/src/local/engine.rs:23485). The bare durable status update is [watches.rs](crates/snapback-kernel/src/storage/watches.rs:568).
- Resume then performs a second durable evaluation enqueue at [engine.rs](crates/snapback-engine/src/local/engine.rs:23494), whose sibling transaction commits at [watches.rs](crates/snapback-kernel/src/storage/watches.rs:616).
- Renewal reaches [engine.rs](crates/snapback-engine/src/local/engine.rs:23506). Its one write transaction revokes the old grant, creates the replacement, updates the watch, and commits at [watches.rs](crates/snapback-kernel/src/storage/watches.rs:459).

### Authority and remedy

Current successful management routes are session-backed, so a live caller publication exists. There is a service-authority branch in the ownership helper at [engine.rs](crates/snapback-engine/src/local/engine.rs:37647), but the current `WatchManagement` authority gate accepts sessions at [invocation.rs](crates/snapback-sync/src/auth/invocation.rs:2512). Regardless of future reachability changes, reservation must inspect the actual publication.

Remedy: split-phase. These writes have real availability or authority consequences: delete/suspend retire the watch, resume reactivates it and queues work, and renewal creates a long-lived replacement grant.

Credential-free scheduled evaluation/reaction remains mode-only and untouched. That boundary is explicit in [engine.rs](crates/snapback-engine/src/local/engine.rs:23533) and LLP 0058’s remedy classification at [LLP 0058](llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1371).

### Permit lifetime and transactions

- Reserve after request parsing and authority preparation, outside Local.
- Enter a finite-deadline Local helper.
- Validate and stage the transaction.
- Replace the old mode guard with `reservation.commit_guard()` immediately before the durable commit.
- Drop the guard and reservation immediately after commit/rollback, before response publication or any watch execution.

For resume, do not retain the current two-transaction shape. Introduce one management storage transaction that changes status and enqueues the evaluation atomically, protected by one commit guard.

**INFERRED:** status activation and its wake-up enqueue are one logical effect. The current engine always sequences them together, but no source explicitly declares atomicity. A failure-injection regression should make that intended contract explicit.

No permit may cover watch evaluation, reaction JS, webhook delivery, push delivery, DNS, or network work.

### Regression

- Terminal-first matrix for delete/suspend/resume/renew: logout wins before reservation; exact watch status, pending-job state, and renewal grant rows remain unchanged.
- Reservation-first matrix: pause immediately before commit; logout blocks; release commit; mutation lands, then logout completes.
- Resume failure injection immediately before the combined commit: neither activation nor enqueue survives.
- Credential-free scheduled evaluation and reaction after the creator session has logged out still commit their mode-only state and push/webhook reservation. Extend the existing credential-free fixtures in [admission_fence_tests.rs](crates/snapback-engine/src/local/admission_fence_tests.rs:669) and [admission_fence_tests.rs](crates/snapback-engine/src/local/admission_fence_tests.rs:932).

Effort: smaller than the asset migration, roughly one bounded server seam plus two guarded storage methods.

## 5. Stale denial and revocation decisions — fix

### Exact routes and durable cuts

Pending-effect denial:

- Route: [effects.rs](crates/snapback-server/src/server/effects.rs:398)
- Existing mode guard: [engine.rs](crates/snapback-engine/src/local/engine.rs:5138)
- Durable status/journal transaction: [pending_effects.rs](crates/snapback-kernel/src/storage/pending_effects.rs:624), committing through [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1694)

Grant-request denial:

- Route and existing server guard: [server.rs](crates/snapback-server/src/server.rs:15051)
- Durable denial: [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:579)
- Separate clock prewrite currently occurs at line 585.

OAuth denial:

- Route: [oauth.rs](crates/snapback-server/src/server/oauth.rs:485)
- Existing engine guard: [engine.rs](crates/snapback-engine/src/local/engine.rs:4891)
- Clock prewrite plus OAuth/pairing decision transaction: [auth_integrations.rs](crates/snapback-kernel/src/storage/auth_integrations.rs:989)

Grant revocation:

- Single route, including target-service drain: [server.rs](crates/snapback-server/src/server.rs:15093)
- Bulk route: [server.rs](crates/snapback-server/src/server.rs:15146)
- Durable single and bulk mutations: [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:733) and [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:825)
- Their service-terminal transaction commits at [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1795).

### Authority and remedy

All these management routes require a live initiating session publication: pending-effect denial uses an exact effect-management session in [effects.rs](crates/snapback-server/src/server/effects.rs:13), and grant management uses the session gate at [server.rs](crates/snapback-server/src/server.rs:14620).

Revocation also retires separate target service-token publications, grants, and dependent watches. The target terminal gate does not retain the initiating management session.

Remedy: split-phase. A stale denial destroys another pending authorization opportunity; revocation destroys active authority and availability. Those are consequential even if the stale caller gains no new privilege.

### Permit lifetime and transactions

Simple denials:

- Complete parsing, provider work, and other preparation first.
- Reserve the management session outside Local.
- Use bounded Local.
- Put the authorization-clock advance, status mutation, journal mutation, and related OAuth pairing mutation in one transaction.
- Acquire `commit_guard()` last and retain it through that sole commit.

Revocation requires stricter ordering because target-service drain has no deadline in [service_fence.rs](crates/snapback-auth/src/auth/service_fence.rs:711):

1. Build the target plan read-only under Local; release Local.
2. Acquire and drain the target service terminal gate with **no caller permit held**.
3. Reserve the initiating management session.
4. If reservation fails, drop the prepared target gate so its premark rolls back.
5. Transfer both objects immediately into the bounded owned completion capsule.
6. Reacquire Local with a finite deadline, stage the grant/token/watch mutations, and advance the clock inside the same transaction.
7. Prepare the target terminal interlock, acquire the caller `commit_guard()` last, and commit.
8. Drop the caller permit before post-commit token termination or any other external/irreversible work.

The current post-Local token termination at [server.rs](crates/snapback-server/src/server.rs:15133) remains outside the caller permit.

Multi-transaction answer: collapse every clock sibling into its parent transaction. Planning stays read-only; the target process gate is not another SQLite transaction. One logical decision/revocation gets one caller reservation and one guarded durable commit.

### Regression

- Each denial, terminal-first: request remains pending and the authorization clock is unchanged.
- Each denial, reservation-first: decision and clock commit atomically; logout completes afterward.
- OAuth denial additionally proves the OAuth and pairing rows cannot diverge.
- Each revocation, terminal-first: no grant, token, watch, or clock mutation; the prepared target terminal state is reopened.
- Each revocation, reservation-first: logout blocks until the combined grant/token/watch transaction commits.
- Liveness regression: hold target service active work, begin revocation, then log out the management session. Logout must complete while revocation is still draining. Once target work drains, caller reservation must fail and the target premark must roll back. Every wait needs a test deadline.
- Preserve the current commit-uncertainty reconciliation, now including the in-transaction clock result.

Effort: larger than the asset migration. The revoke path composes two independent fence protocols and is the riskiest item in this plan.

## 6. Approval-gated intent creation — fix, but not covered by Critical 2/3

### Exact route and cut

The approval gate runs before the ordinary mutation reservation at [server.rs](crates/snapback-server/src/server.rs:27308); the ordinary reservation is not acquired until [server.rs](crates/snapback-server/src/server.rs:27341). Action invocation has the corresponding call at [server.rs](crates/snapback-server/src/server.rs:27916).

The helper performs an unbounded Local acquisition at [server.rs](crates/snapback-server/src/server.rs:27627) and inserts the retained intent through [engine.rs](crates/snapback-engine/src/local/engine.rs:5966). The durable transaction and stored arguments are at [pending_effects.rs](crates/snapback-kernel/src/storage/pending_effects.rs:507).

Critical 2/3 governs later approval or decision of an existing row. It does not cover creation of this earlier retained intent.

### Authority and remedy

This is branch-sensitive:

- If `PreparedAuthority` carries a live session or service publication, use split-phase.
- If it carries no caller publication, retain mode-only admission.

Use `reserve_authorized_effect()` to make that determination from the actual publications. Do not inspect `trigger_mode` or infer publication existence from `EffectExecution`.

Retaining arguments and caller authority in an approval inbox has privacy and attribution consequences, so the publication-backed branch is worth fencing.

### Permit lifetime and transactions

1. First Local pass, with no permit: determine whether approval is required and build an immutable intent plan.
2. Release Local.
3. Reserve from the actual prepared authority.
4. Reenter through bounded Local.
5. Cheaply revalidate function generation, policy, and the approval-gate decision.
6. Perform one guarded insert, replacing the existing mode guard.
7. Drop the permit immediately after commit, before returning `202`.

No permit spans JS execution or later approval/execution. The later decision gets its own Critical 3 reservation, and the approved mutation gets its normal route reservation.

### Regression

- Session and service terminal-first: no pending row or retained arguments.
- Reservation-first: logout/service retirement blocks until the intent row commits.
- Anonymous/no-publication branch still commits mode-only.
- `EffectExecution` remains exempt at [server.rs](crates/snapback-server/src/server.rs:27640): an approved credential-free execution commits its mutation and does not recursively create another intent.
- Credential-free watch reaction remains commit-capable.

Effort: smaller than the asset migration, especially if it reuses Critical 3’s guarded pending-effect transaction seam.

## 7. Auxiliary artifacts — accept without split-phase fencing

Retain existing mode-only checks.

### OAuth authorization proposal

The session-backed GET route starts at [oauth.rs](crates/snapback-server/src/server/oauth.rs:334). It writes the pending OAuth and pairing rows at [auth_integrations.rs](crates/snapback-kernel/src/storage/auth_integrations.rs:821), while stale response publication is rejected at [server.rs](crates/snapback-server/src/server.rs:11676).

A terminal-first race can leave a proposal, but not a grant, token, or delivered authorization code. Any later approval requires a fresh explicit consent action.

### Pairing code

The session route is [server.rs](crates/snapback-server/src/server.rs:14873). Storage generates the plaintext for the response but persists only its hash at [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:208). If terminal response publication loses, the durable hash is unusable debris; rows are also capped per user at line 229.

### Identity range

The route is [server.rs](crates/snapback-server/src/server.rs:27168), with the storage commit at [settlement.rs](crates/snapback-kernel/src/storage/settlement.rs:86). Lost ranges can be re-served only to the same authority/audience while unused at [operation_ledger.rs](crates/snapback-kernel/src/storage/operation_ledger.rs:1333). A fresh session authority cannot claim the terminated authority’s range.

**CORRECTED:** the terminal-fencing conclusion is limited to caller benefit,
authority gain, spend, and disclosure after response suppression. OAuth
proposal growth is now bounded by shared durable admission, but the FK cleanup
wedge is deferred and is not an accepted lifecycle remainder. The
characterization tests below address the terminal consequence boundary only.

Permit lifetime: none. Multi-transaction shapes remain unchanged; OAuth and pairing may retain their accepted clock sibling.

Regression:

- Artifact-first and terminal-first characterization for all three.
- Terminal-first proves response suppression and absence of any usable grant/token/code/range.
- Pairing proves only the hash remains.
- Identity-range anonymous/no-publication use still commits mode-only.

Acceptance work is smaller than the asset migration. Fencing all three unrelated kernels would be comparable and is not justified by the consequence.

## 8. Read-side lazy expiry/pruning — accept the non-asset remainder

The only remainder I mean is:

- Pending-effect inbox GET at [effects.rs](crates/snapback-server/src/server/effects.rs:26), with lazy expiry at [pending_effects.rs](crates/snapback-kernel/src/storage/pending_effects.rs:601).
- Pending-effect lookup before approve at [effects.rs](crates/snapback-server/src/server/effects.rs:240), with lazy expiry at [pending_effects.rs](crates/snapback-kernel/src/storage/pending_effects.rs:593).
- Grant-request inbox at [server.rs](crates/snapback-server/src/server.rs:14980), with clock observation/pruning at [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:612).

TUS HEAD, attempt-inspect, and asset-finalize/lazy-expiry are excluded per [the asset lane](issues/20260821-asset-width-prework-and-lazy-expiry-unfenced.md:30).

Remedy: retain mode-only behavior. These writes merely realize authority-independent lifecycle expiry or bounded pruning. They create no caller value, privilege, spend, exposure, or durable content supplied by the caller.

Permit lifetime: none. Do not extend Critical 3’s decision permit backward across lookup, step-up, or lazy expiry; the Critical design already keeps lookup separate at [the Critical design](issues/shelved/20260822-critical-direct-route-fence-design.md:286).

Multi-transaction behavior remains unchanged: cleanup may commit before the later read or approval decision.

Regression:

- Cleanup-first and terminal-first both converge to the same expired/pruned state.
- Neither ordering creates authority, spend, or executable intent.
- The later approval decision retains its independent Critical 3 both-ordering test.

Effort: acceptance documentation and characterization are smaller than the asset migration.

## 9. Authorization-clock prewrites — collapse, then accept the remainder

The standalone clock transaction is `observe_agent_authorization_clock()` at [auth_agent_credentials.rs](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1443). Its monotonic write is implemented at [auth_agent_credentials.rs](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1602).

Do not create an independent clock reservation.

- Grant/OAuth approval clocks collapse into the Critical 2 parent transaction, as already designed at [the Critical design](issues/shelved/20260822-critical-direct-route-fence-design.md:208).
- Denial and revocation clocks collapse into Finding 5’s guarded parent transaction.
- OAuth/pairing artifact clocks remain accepted with Finding 7.
- Grant inbox/lookup clock writes remain accepted with Finding 8.

For fixed parents, one parent reservation spans the single combined transaction and one final commit guard. There is never an earlier unguarded clock sibling.

Tests for fixed parents assert that terminal-first leaves both parent state and clock unchanged, while reservation-first commits them atomically. For accepted parents, characterize both orderings and prove the clock remains only a monotonic defensive high-water mark.

The remaining clock debris has no authority, spend, exposure, or caller benefit. A standalone migration would touch many unrelated callers and be comparable to or larger than the asset migration for negligible gain.

## Accept-without-fixing list

I recommend explicitly accepting:

1. Finding 7's terminal-fencing remainder only: OAuth proposal rows, pairing
   hashes, and inaccessible identity ranges. Proposal growth is separately
   bounded; the pairing-parent FK wedge remains an open defect.
2. Finding 8: pending-effect expiry and grant-inbox pruning only; no asset callers.
3. Finding 9: clock writes associated with accepted Findings 7/8.

Finding 9 is otherwise not an independent issue: its consequential instances collapse into Critical approval work or Finding 5.

Finding 6 does not collapse into Critical 2/3. It is the earlier creation of the row those designs later decide.

None of Findings 4–9 writes stream-attempt state. If approved intent execution later reaches stream state, that remains deferred until R4 of [the stream refactor design](issues/shelved/20260822-stream-attempt-refactor-design.md:339).

## Ordered implementation sequence

1. Reuse/land the Critical lane’s deadline-bounded Local capsule and guarded auth transaction seams.
2. Finding 4: renewal, then atomic management transitions. Highest user consequence.
3. Finding 5 simple denials, folding their clock siblings into the parent transactions.
4. Finding 5 revocation. This is the riskiest work because target-service drain must precede caller reservation without introducing a cancellation or hang window.
5. Finding 6 intent creation, reusing the Critical 3 pending-effect seam.
6. Record and characterize the accepted Findings 7/8/9 exceptions.

One author ruling is needed: is the intended invariant literally “no SQLite write after caller terminal,” or “no caller-beneficial, authority-sensitive, exposure-bearing, or spend-bearing durable effect”? I recommend the second. A literal invariant would require fencing or relocating Findings 7–9 despite their lack of consequence, materially increasing complexity and hang surface for debris and defensive metadata.
