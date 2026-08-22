# Residual exposure: ordinary callers can still commit SQLite writes after their authority ends

Status: Open — THREE CRITICAL. The program's headline property is not yet true.
Created: 2026-08-21
Related: issues/20260821-authorized-effect-remedy-classification.md,
issues/closed/20260821-asset-width-prework-and-lazy-expiry-unfenced.md,
issues/20260821-stream-attempt-fence-blocked-on-flush-api.md, LLP 0058

Update 2026-08-22: the asset subset described below is closed. Caller-backed finalize, width
SQLite materialization, and attempt-inspect/TUS-HEAD lazy expiry now use split-phase caller
reservations. The external blob PUT remains intentionally unfenced and is tracked by the separate
durable authority-to-effect handoff design. The other critical and residual families in this
ticket remain open.

## The question and the answer

Asked of current main, after the split-phase primitive, ten mode-epoch fences and six asset
migrations had landed:

> Can an ordinary session or scoped-service caller still get a durable SQLite write committed
> after their own authority has gone terminal?

**Yes. The property is not yet true.**

The ordinary HTTP mutation seam is sound — reservation before the write lane, carried to the
mutation commit, mode acquired last. The residue exists because many DIRECT routes still call
`effect_guard`, which is expressly only a mode-epoch guard and reserves neither session nor
service authority (`crates/snapback-sync/src/auth/invocation.rs:1765`).

Counting fenced sites overstated progress. Seventeen sites are fenced; the property still fails.

## Critical 1 — detached actions' nested `ctx.runMutation`

Routes `POST /action/{name}` and `/api/v1/action/{name}`. The detached host retains the outer
`PreparedAuthority` and `ctx.runMutation` inherits it. At the durable cut
(`crates/snapback-kernel/src/storage.rs:5489` HostPlan, `:6414` detached Ibex) only the mode guard
and action watchdog gate are held. `validate_live` checks abandonment, generation and deadline —
**not session or service liveness** (`crates/snapback-server/src/server.rs:1189`).

The reservation that appears at `server.rs:1411` is the protected-room authorization reservation,
not an `AuthorizedEffectReservation`.

So: outer action admitted → logout or grant retirement commits → the action calls or resumes
`ctx.runMutation` → unchanged global mode passes → the child transaction commits. Arbitrary app
rows, journal/version state, job enqueues, membership changes and mutation asset operations can
land. **The caller benefits even though the outer response is later refused.**

## Critical 2 — grant and OAuth consent approval after approver logout

Routes `POST /auth/grant-requests/{id}/approve` and `POST /auth/oauth/authorize`, both mode-guard
only. The approval transaction verifies the user exists, the request and scopes are current, and
the step-up proof is valid — but **never checks the initiating session row**
(`crates/snapback-kernel/src/storage/auth_grants.rs:438`).

A delegated function grant therefore commits after the approver logged out. **That is authority
creation, not debris.** OAuth then writes the authorization-code hash in a second transaction, so
logout can also win *between* the two commits. The stale-response fence prevents delivery of the
code; it does not remove the grant.

## Critical 3 — pending-effect approval under a logged-out management session

`POST /effects/{id}/approve`, same shape.

## The rest

High: watch renewal and management transitions. Medium: stale denial/revocation decisions;
approval-gated intent creation before any caller reservation. Low: auxiliary authority artifacts;
read-side lazy expiry/pruning; separate authorization-clock prewrites.

## What was cleared

Ordinary `/mutation` app writes; step-up challenge creation (checks the exact live session inside
its own transaction); authorized-lease creation; push-token registration and finite-session
last-used updates (exact live-row predicates/CAS); password change/set, recovery rotation and
refresh (coordinator premark protocols); post-handler response construction; and the job/watch/
webhook families that carry no session publication and are correctly mode-only.

## Shortest closure set

1. Complete the nine in-flight migrations.
2. **Completed 2026-08-22:** close the asset ticket, including finalize, width prework and
   read-side lazy expiry.
3. Refactor and fence caller-backed stream-attempt transitions per the stream ticket.
4. Add split-phase caller reservations to the new direct-route families: detached action nested
   mutations; pending-effect, grant/OAuth and watch management decisions; pending-intent,
   OAuth-consent, pairing-code and operation-range issuance; lazy cleanup and authorization-clock
   sibling writes.

**Multi-transaction routes need care.** The permit must either span every sibling transaction, or
each transaction must take its own reservation before entering `LocalSnapback`. Guarding only
grant/OAuth's main transaction would leave the earlier authorization-clock commit exposed. Mode
must remain the final guard at every commit.

## Provenance

Read-only codex audit against `90ed88798`. Full findings with interleavings and file:line
citations appended below.

---

## Verdict

**No.** On current `origin/main` at `90ed887982e79dd530ab81bbfc9137f75c96e76b`, an ordinary session or scoped-service caller can still cause SQLite writes after its own authority has terminated.

The four named commits are ancestors of this HEAD. The ordinary HTTP mutation seam is correctly split-phase: reservation occurs before entering the write lane at [server.rs](crates/snapback-server/src/server.rs:27341), is carried to the mutation commit at [server.rs](crates/snapback-server/src/server.rs:27413), and reaches the composite guard at [engine.rs](crates/snapback-engine/src/local/engine.rs:16322). The primitive retains session/service permits and acquires mode last at [invocation.rs](crates/snapback-sync/src/auth/invocation.rs:1246).

The residue exists because many direct routes still call `effect_guard`, which is expressly only a mode-epoch guard and reserves neither session nor service authority [invocation.rs](crates/snapback-sync/src/auth/invocation.rs:1765).

## New residual exposures, ranked

### 1. Critical — detached actions’ nested `ctx.runMutation`

Routes: `POST /action/{name}` and `/api/v1/action/{name}` [server.rs](crates/snapback-server/src/server.rs:9438). The detached host retains the outer `PreparedAuthority` [server.rs](crates/snapback-server/src/server.rs:757), and `ctx.runMutation` inherits it [server.rs](crates/snapback-server/src/server.rs:1375).

Exact durable cuts:

- HostPlan mutation: [storage.rs](crates/snapback-kernel/src/storage.rs:5489)
- Detached Ibex mutation: [storage.rs](crates/snapback-kernel/src/storage.rs:6414)

The apparent reservation at [server.rs](crates/snapback-server/src/server.rs:1411) is the protected-room authorization reservation, not an `AuthorizedEffectReservation`. At the final cut, HostPlan retains only the mode guard and action watchdog gate [engine.rs](crates/snapback-engine/src/local/engine.rs:17096); the Ibex path is identical [engine.rs](crates/snapback-engine/src/local/engine.rs:17399).

Interleaving:

1. Outer action is admitted.
2. Session logout/expiry commits. Alternatively, service validation succeeds at [engine.rs](crates/snapback-engine/src/local/engine.rs:17050), then the grant/credential retires.
3. The action calls or resumes `ctx.runMutation`.
4. `validate_live` checks abandonment, generation, and deadline—but not session/service liveness [server.rs](crates/snapback-server/src/server.rs:1189).
5. Unchanged global mode passes; the child transaction commits.

Result: arbitrary app rows, journal/version state, job enqueues, membership changes, and mutation asset operations can commit. This can grant, spend, expose, or corrupt whatever the application mutation can. The caller can benefit even though the outer response is later refused.

Ticket: **genuinely new**. The site appears in the commit-proof inventory, but no issue files the caller-terminal exposure.

### 2. Critical — grant and OAuth consent approval after approver logout

Routes:

- `POST /auth/grant-requests/{id}/approve` [server.rs](crates/snapback-server/src/server.rs:9071)
- `POST /auth/oauth/authorize` [server.rs](crates/snapback-server/src/server.rs:9016)

The grant handler takes only a mode guard [server.rs](crates/snapback-server/src/server.rs:15027). OAuth approval does likewise [engine.rs](crates/snapback-engine/src/local/engine.rs:4904).

Exact durable cut: the grant insert and request transition are at [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:491) and [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:509), committed at [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1738).

Interleaving:

1. Session and optional step-up proof are prepared.
2. Logout/expiry commits.
3. Mode guard succeeds because mode did not change.
4. The approval transaction checks that the user exists, the request and scopes remain current, and the proof is valid, but never checks the initiating session row [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:438).
5. The delegated grant commits after logout.

OAuth then performs a second transaction, writing the authorization-code hash at [auth_integrations.rs](crates/snapback-kernel/src/storage/auth_integrations.rs:966), committed through [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1705). Logout may win before approval or between the grant and code transactions.

Result: a real delegated function grant exists. That is authority creation. The stale response fence normally prevents delivery of a newly generated code, but it does not remove the grant.

Ticket: **genuinely new**.

### 3. Critical — pending-effect approval under a logged-out management session

Route: `POST /effects/{id}/approve` [server.rs](crates/snapback-server/src/server.rs:9275).

The handler revalidates the frozen original authority, then commits the management decision at [effects.rs](crates/snapback-server/src/server/effects.rs:299). The management guard remains mode-only [engine.rs](crates/snapback-engine/src/local/engine.rs:5114).

Exact durable cut: decision UPDATE at [pending_effects.rs](crates/snapback-kernel/src/storage/pending_effects.rs:670), committed through [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1705).

Interleaving:

1. Approver session and original effect authority are prepared.
2. Approver logout/expiry commits.
3. Approval consumes any step-up proof and changes `pending → approved`; proof consumption validates the challenge but not the approver’s current session row [auth_catalog_ops.rs](crates/snapback-kernel/src/storage/auth_catalog_ops.rs:2221).
4. The handler dispatches the original mutation or action [effects.rs](crates/snapback-server/src/server/effects.rs:326).

Result:

- If the frozen original authority is independently live or anonymous, the stale approver can authorize arbitrary application execution after logout.
- If the original authority is the same now-retired session, execution is refused, but the approval and proof-consumption rows still remain.

Ticket: **genuinely new**.

### 4. High — watch renewal and management transitions

Routes: DELETE, suspend, resume, and renew at [server.rs](crates/snapback-server/src/server.rs:9331).

Exact cuts:

- Delete/suspend/resume UPDATE is a bare autocommit at [watches.rs](crates/snapback-kernel/src/storage/watches.rs:599).
- Resume’s sibling enqueue commits at [watches.rs](crates/snapback-kernel/src/storage/watches.rs:653).
- Renewal revokes the old anchor, inserts a new grant, updates the watch, and commits at [watches.rs](crates/snapback-kernel/src/storage/watches.rs:526).

The engine uses mode-only guards for transitions [engine.rs](crates/snapback-engine/src/local/engine.rs:23485) and renewal [engine.rs](crates/snapback-engine/src/local/engine.rs:23506).

Interleaving: management session is prepared; logout/expiry commits; stale transition or renewal runs; owner/effective-user equality still matches; mode remains unchanged; SQLite commits.

Result:

- Renewal creates a new standing anchor grant lasting up to 365 days.
- Resume activates the automation and durably enqueues evaluation.
- Suspend/delete can disable an automation.

Renewal can extend delegated execution authority; resume can lead to later reactions or webhook work. Delete/suspend are destructive availability effects rather than caller benefit.

Ticket: **genuinely new**.

### 5. Medium — stale denial and revocation decisions

Affected routes and cuts:

- `POST /effects/{id}/deny`: pending-effect decision UPDATE [pending_effects.rs](crates/snapback-kernel/src/storage/pending_effects.rs:670), shared commit [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1705).
- `POST /auth/grant-requests/{id}/deny`: UPDATE [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:603), shared commit.
- OAuth denial: both consent rows updated [auth_integrations.rs](crates/snapback-kernel/src/storage/auth_integrations.rs:1009), shared commit.
- DELETE one or all grants: grant/token/watch termination at [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:770) and [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:875), committed at [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1795).

Interleaving: initiating session is prepared; logout commits; the mode-only guard succeeds; the decision or revocation commits. The service-terminal interlock correctly protects the tokens being revoked, but it does not retain the initiating management session.

Result: no privilege gain, but the stale request can destroy consent, revoke agent access, terminate tokens, and mark watches dead.

Ticket: **genuinely new**.

### 6. Medium–Low — approval-gated intent creation before any caller reservation

Routes: every approval-gated ordinary mutation or action. The helper runs before the ordinary mutation reservation [server.rs](crates/snapback-server/src/server.rs:27308); actions call the same helper [server.rs](crates/snapback-server/src/server.rs:27916).

Exact durable cut: pending-effect INSERT at [pending_effects.rs](crates/snapback-kernel/src/storage/pending_effects.rs:559), shared commit at [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1705). The helper uses only `effect_guard` [engine.rs](crates/snapback-engine/src/local/engine.rs:5966).

Interleaving: logout or service retirement commits after request preparation but before the helper; the pending intent commits; the helper returns the “approval pending” outcome, so the normal mutation reservation is never reached.

Result: frozen authority, function identity, and arguments remain durable. Because the frozen session/service authority is already terminal, later execution should fail, so this is usually debris. It can nevertheless retain and disclose application arguments to the approval inbox.

Ticket: **genuinely new**.

### 7. Low — auxiliary authority artifacts

Three independently reachable paths:

- `GET /auth/oauth/authorize`: inserts grant-request and OAuth-consent rows at [auth_integrations.rs](crates/snapback-kernel/src/storage/auth_integrations.rs:874), shared commit at `auth.rs:1705`.
- `POST /auth/pairing-codes`: inserts a pairing request at [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:239), shared commit.
- `POST /client-mutations/identity-range`: registers an operation epoch/range at [operation_ledger.rs](crates/snapback-kernel/src/operation_ledger.rs:1251) and [operation_ledger.rs](crates/snapback-kernel/src/operation_ledger.rs:1405), committed at [settlement.rs](crates/snapback-kernel/src/storage/settlement.rs:114).

Interleaving: authority terminates after preparation or, for service authority, after the pretransaction validation at [engine.rs](crates/snapback-engine/src/local/engine.rs:10722); mode-only guard then admits the write.

Result: normally unusable consent, secret, or identity-range state. The common response publication fence rechecks finite authority and suppresses a stale response [server.rs](crates/snapback-server/src/server.rs:11705), so generated pairing codes/ranges are ordinarily debris rather than usable grants.

Ticket: **genuinely new**.

### 8. Low — read-side lazy expiry/pruning

Routes:

- `GET /effects` and the lookup phase of `POST /effects/{id}/approve`: lazy transition to `expired` at [pending_effects.rs](crates/snapback-kernel/src/storage/pending_effects.rs:475), committed through `auth.rs:1705`.
- `GET /auth/grant-requests`: expired pairing/grant requests are deleted at [auth_grants.rs](crates/snapback-kernel/src/storage/auth_grants.rs:1427), committed through `auth.rs:1705`.

Interleaving: session terminates before the apparently read-only handler enters SQLite; its mode-only guard still passes; cleanup commits after logout.

Result: correct lifecycle cleanup, not a caller benefit. It neither grants nor spends, but it violates the literal property.

Ticket: **genuinely new**.

### 9. Informational/Low — separate authorization-clock prewrites

`observe_agent_authorization_clock` starts and commits its own transaction before the main operation [auth_agent_credentials.rs](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1443). It always upserts the high-water value [auth_agent_credentials.rs](crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1602), with the exact cut at `auth.rs:1705`.

This occurs on pairing-code, OAuth consent, grant inbox/list, grant approval/denial, and grant revocation routes. It therefore remains outside any reservation added only around the later “main” transaction.

Result: monotonic host security metadata only; no caller benefit or corruption. It is included because the question expressly includes counters/last-seen-style side effects.

Ticket: **genuinely new**.

## Already-filed exposure still present

### The nine in-flight migrations

The classification ticket remains accurate: [authorized-effect-remedy-classification.md](issues/20260821-authorized-effect-remedy-classification.md:55). Current source still uses mode-only guards:

| Path | Current guard and exact cut | Consequence |
|---|---|---|
| Capability-link mint | [engine.rs](crates/snapback-engine/src/local/engine.rs:5307), shared auth commit [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1705) | Usually inaccessible capability debris because the secret response is fenced. Low. |
| Capability-link revoke | [engine.rs](crates/snapback-engine/src/local/engine.rs:5385), `auth.rs:1705` | Revokes a usable bearer. Medium. |
| Immediate push reservation, claim, transmitting | [engine.rs](crates/snapback-engine/src/local/engine.rs:6931), [engine.rs](crates/snapback-engine/src/local/engine.rs:6119), [engine.rs](crates/snapback-engine/src/local/engine.rs:6135); transactions enter at [push_registry.rs](crates/snapback-kernel/src/storage/push_registry.rs:107) and commit at `auth.rs:1705` | Can progress to an external notification send. High. |
| Client-mutation acknowledgement | [engine.rs](crates/snapback-engine/src/local/engine.rs:10669), commit [settlement.rs](crates/snapback-kernel/src/storage/settlement.rs:342) | Deletes replay/retention state. Low–Medium. |
| Watch creation | [engine.rs](crates/snapback-engine/src/local/engine.rs:23386), commit [watches.rs](crates/snapback-kernel/src/storage/watches.rs:295) | Creates standing automation/anchor authority. High. |
| Agent-invitation mint | [server.rs](crates/snapback-server/src/server.rs:14850), commit [auth.rs](crates/snapback-kernel/src/storage/auth.rs:1738) | Usually secretless invitation debris. Low. |
| Ask spend reservation | [engine.rs](crates/snapback-engine/src/local/engine.rs:5901), shared auth commit | Can lead to provider spend and prompt disclosure. High. |

I treated these as in-flight, not new findings. Push, Ask, and capability settlement remain excluded under the settlement ruling.

### Asset ticket (closed 2026-08-22)

[asset-width-prework-and-lazy-expiry-unfenced.md](issues/closed/20260821-asset-width-prework-and-lazy-expiry-unfenced.md:1)
recorded the pre-fix state below. Its SQLite findings are now closed; the external blob PUT is
separately governed by the durable authority-to-effect handoff design.

- `POST /assets/attempts/{id}/finalize` has no reservation across its plan/staged/completion transactions [asset_routes.rs](crates/snapback-server/src/server/asset_routes.rs:204). The durable plan begins at [engine.rs](crates/snapback-engine/src/local/engine.rs:13565); publication/quota settlement runs at [engine.rs](crates/snapback-engine/src/local/engine.rs:13741); each unguarded asset transaction commits at [asset_attempts.rs](crates/snapback-kernel/src/storage/asset_attempts.rs:255). It can publish asset state, consume quota, and expose content. **High.**
- Strict-delivery and signed-URL width materialization occur before their reservations [asset_routes.rs](crates/snapback-server/src/server/asset_routes.rs:455), [asset_routes.rs](crates/snapback-server/src/server/asset_routes.rs:609). Variant plan/blob/rendition writes begin at [engine.rs](crates/snapback-engine/src/local/engine.rs:13423). The caller receives no URL/bytes after terminal authority, but durable blob/quota state remains. **Medium–High.**
- `GET /assets/attempts/{id}` and `HEAD /assets/tus/{id}` use the unguarded lazy-expiry path [engine.rs](crates/snapback-engine/src/local/engine.rs:11906), committing through [asset_reads.rs](crates/snapback-kernel/src/storage/asset_reads.rs:226). **Low.**

The six sites migrated by `556d18e07` are correctly fenced.

### Stream-attempt ticket

[stream-attempt-fence-blocked-on-flush-api.md](issues/20260821-stream-attempt-fence-blocked-on-flush-api.md:1) also remains accurate.

Caller-backed attempt creation, `ctx.streamAttempt.start/settle`, cursor premarks, and `/streams/{attempt_token}/cancel` reach `persist_stream_attempts` without caller reservation [server.rs](crates/snapback-server/src/server.rs:1052), [server.rs](crates/snapback-server/src/server.rs:2411), [server.rs](crates/snapback-server/src/server.rs:28127). Each row is a separate SQLite autocommit at [settlement.rs](crates/snapback-kernel/src/storage/settlement.rs:11).

Result: stale attempt/cursor/terminal control state; explicit cancellation can terminate a stream. **Medium.** Transcript persistence is host settlement and is not reported.

## What did not produce additional findings

The following are structurally safe or outside scope:

- Ordinary `/mutation` app writes now use the split-phase reservation.
- Step-up challenge creation checks the exact live session inside its own transaction [auth_catalog_ops.rs](crates/snapback-kernel/src/storage/auth_catalog_ops.rs:2755).
- Authorized-lease creation similarly validates the current authority transaction-locally.
- Push-token registration/unregistration and finite-session last-used updates use exact live-row predicates/CAS behavior.
- Password change/set, recovery rotation, and refresh use coordinator premark protocols before their terminal/issuance transactions.
- Post-handler response construction has no newly found SQLite effect beyond the safe finite-session CAS and the known stream/lazy paths.
- Job/watch/webhook execution families carrying no session publication remain correctly mode-only.

## Shortest closure set

To make the literal SQLite property true:

1. Complete the nine in-flight migrations in the existing classification ticket.
2. **Completed 2026-08-22:** close the asset ticket, including finalize, width prework, and
   read-side lazy expiry.
3. Refactor and fence caller-backed stream-attempt transitions as specified by the stream ticket.
4. Add split-phase caller reservations to the new direct-route families:
   - detached action nested mutations;
   - pending-effect, grant/OAuth, and watch management decisions;
   - pending-intent, OAuth-consent, pairing-code, and operation-range issuance;
   - lazy cleanup and authorization-clock sibling writes.

For multi-transaction routes, the permit must either span every sibling transaction or each transaction must acquire its own reservation before entering `LocalSnapback`. In particular, adding a guard only around grant/OAuth’s main transaction would leave the earlier authorization-clock commit exposed. Mode must remain the final guard at every commit.

So the plain answer is: **the “no durable SQLite write after terminal caller authority” property is not yet true. The ordinary mutation seam and the asset family are sound, but direct action-child, consent/management, auxiliary issuance, other lazy-write, stream, and nine in-flight mode-only paths still violate it.**

The original read-only audit modified no files.
