# Row-level bucket assignment for the liveness-only factories

Status: open
Date: 2026-08-24
Systems: snapback-auth, snapback-sync, snapback-engine, snapback-kernel, snapback-server
Related: issues/20260824-liveness-factory-triage-and-count-correction.md,
  issues/20260824-p1-ship-rows-enumerated.md,
  issues/20260824-authority-minting-factory-inventory.md

## Why this document exists

I previously published bucket counts (9/68/17/40) without the row assignments, in a ticket that
itself stated counts must be tied to enumerated rows. A follow-up analysis correctly refused to
work from those aggregates because the row set did not exist. This is the assignment that should
have accompanied the counts.

**Corrected totals: 7 P1-SHIP / 68 P2-POLICY / 17 P3-LOW / 40 P4-DUPLICATE / 2 RESOLVED = 134.**

> **Superseded in part (2026-08-25).** An audit of the P4 bucket found that only **12** of the 40 are
> true duplicates; **28** are siblings that survive their canonical row's correction and remain
> actionable. The actionable total is therefore **120**, not 92. See
> `issues/20260825-twenty-eight-of-forty-p4-rows-are-siblings-not-duplicates.md`.

The published P1 count of 9 is no longer current: F190 and F191 (the grant-revocation planners)
were P1 at `8ded451f8` and are RESOLVED at HEAD by `a5d66e941` + `23db84b46`. The P2/P3/P4 counts
were independently re-derived and happen to match the previously published aggregates — but they
are now verifiable against row IDs rather than asserted. No row remains UNCLEAR.

Derived against `bda23afc7` with current line numbers, so it supersedes the `8ded451f8`-era
inventory line references where the two disagree.

---


I re-derived the assignment from the 134 named LIVENESS-ONLY rows and current code at `bda23afc79f7caeb8c59d2b02292ae9228c3a88c`.

| Current disposition | Rows |
|---|---:|
| P1-SHIP | **7** |
| P2-POLICY | **68** |
| P3-LOW | **17** |
| P4-DUPLICATE | **40** |
| RESOLVED since inventory | **2** |
| **Total** | **134** |

The published `9/68/17/40` is not current. The corrected current count is **7/68/17/40 plus 2 resolved**. F190 and F191 were P1 at `8ded451f8`, but are resolved at current HEAD. The independently derived P2/P3/P4 counts happen to equal the previously published aggregates; the row assignment below now makes them verifiable.

No requested row remains UNCLEAR.

Source locations below are current lines. Short path labels expand as follows:

- `provider` = `crates/snapback-auth/src/auth/provider.rs`
- `auth-invalidation` = `crates/snapback-auth/src/auth/invalidation.rs`
- `types-invalidation` = `crates/snapback-types/src/auth/invalidation.rs`
- `projection` = `crates/snapback-sync/src/auth/session_projection.rs`
- `invocation` = `crates/snapback-sync/src/auth/invocation.rs`
- `coordinator` = `crates/snapback-sync/src/auth/coordinator.rs`
- `engine` = `crates/snapback-engine/src/local/engine.rs`
- `storage` = `crates/snapback-kernel/src/storage.rs`
- `room` = `crates/snapback-kernel/src/storage/room_authority.rs`

## P1-SHIP — 7

| Row | Current site | Predicate and existing helper |
|---|---|---|
| F053 | `provider:3385` | `(session_id, expected_generation)` must equal the resolved connection session tuple. `PreparedConnectionAct::authenticated_use_key`, `crates/snapback-server/src/server.rs:6247`; production call `server.rs:13497`. |
| F171 | `engine:5099` | Session authority, source `AgentGrantManagement`, and `authority.user_id == consenting_user_id`. `require_grant_session`, `server.rs:16952`; OAuth route derives the user at `server/oauth.rs:377` and calls at `:388`. |
| F172 | `engine:5137` | Exact authority user and session equal `effective_user_id/session_id`; request belongs to that user. `require_grant_session`, `server.rs:16952`; route derivation/call at `server/oauth.rs:506` and `:571`. |
| F173 | `engine:5157` | `authority.user_id == consenting_user_id`, with the request remaining the storage-verified request for that user. `require_grant_session`, `server.rs:16952`; route at `server/oauth.rs:506` and `:586`. |
| F183 | `engine:5760` | Exact inviter session, management source, authority user equality, and exact step-up binding. Helpers `require_grant_session`, `server.rs:16952`, and `agent_invitation_step_up_binding`, `:16989`; guarded production flow at `:17145` and `:17181`. |
| F185 | `engine:5810` | Session authority, management source, and exact user equality. `require_pairing_code_mint_authority`, `engine:5849`, layered on `require_agent_grant_management_session`, `:5877`; production route at `server.rs:17225` and `:17268`. |
| F188 | `engine:5929` | Exact user, session, and management source. `require_grant_session`, `server.rs:16952`; production route derives the tuple at `:17401` and calls at `:17433`. |

“I found no cross-principal caller” was not used as the P1 proof. Each row has an existing predicate/helper already exercised by its intended route family.

## Resolved since the inventory — 2

| Row | Current site | Resolution |
|---|---|---|
| F190 | `engine:5993` | `plan_grant_revocation_service_terminal` no longer accepts an independent `user_id`; it derives the effective user through `require_agent_grant_management_session` at `engine:5877`. Fixed by `a5d66e941` and refined by `23db84b46`. |
| F191 | `engine:6023` | The bulk planner likewise derives the effective user from the admitted management session; `actor_id` only selects within that user’s grants. Same fixes. |

These are not current P1 work and should not be counted as unfixed rows.

## P2-POLICY — 68

Each row points to one question group defined and ranked below.

| Row | Current site | Question |
|---|---|---|
| F001 | `crates/snapback-auth/src/auth/database_plan.rs:38` | Q40 |
| F005 | `provider:3088` | Q41 |
| F011 | `provider:662` | Q05 |
| F022 | `provider:1258` | Q05 |
| F061 | `provider:4331` | Q37 |
| F062 | `provider:4350` | Q38 |
| F067 | `provider:4420` | Q39 |
| F069 | `provider:4439` | Q36 |
| F070 | `provider:4448` | Q05 |
| F073 | `crates/snapback-kernel/src/auth/lease.rs:260` | Q16 |
| F075 | `auth-invalidation:181` | Q15 |
| F081 | `auth-invalidation:416` | Q15 |
| F082 | `auth-invalidation:459` | Q42 |
| F084 | `auth-invalidation:830` | Q43 |
| F094 | `projection:866` | Q17 |
| F097 | `projection:1144` | Q18 |
| F100 | `projection:1811` | Q03 |
| F101 | `projection:1967` | Q03 |
| F102 | `projection:2057` | Q03 |
| F112 | `crates/snapback-auth/src/auth/service_fence.rs:753` | Q19 |
| F113 | `crates/snapback-sync/src/auth/service_fence.rs:821` | Q07 |
| F117 | `crates/snapback-kernel/src/auth/service_fence.rs:98` | Q20 |
| F118 | `invocation:397` | Q10 |
| F119 | `invocation:477` | Q09 |
| F120 | `invocation:490` | Q08 |
| F122 | `invocation:814` | Q44 |
| F126 | `invocation:1745` | Q21 |
| F127 | `invocation:1918` | Q01 |
| F129 | `invocation:1957` | Q45 |
| F143 | `invocation:2714` | Q11 |
| F145 | `invocation:2839` | Q22 |
| F146 | `invocation:2895` | Q23 |
| F149 | `invocation:3302` | Q02 |
| F150 | `invocation:3312` | Q02 |
| F157 | `coordinator:1729` | Q06 |
| F175 | `engine:5224` | Q06 |
| F182 | `engine:5733` | Q24 |
| F187 | `engine:5899` | Q25 |
| F202 | `engine:6270` | Q26 |
| F203 | `engine:6351` | Q13 |
| F205 | `engine:6483` | Q27 |
| F210 | `engine:8126` | Q01 |
| F212 | `engine:8197` | Q01 |
| F213 | `engine:8234` | Q01 |
| F215 | `engine:8307` | Q01 |
| F220 | `storage:891` | Q28 |
| F232 | `storage:16619` | Q04 |
| F233 | `storage:16623` | Q04 |
| F236 | `storage:16876` | Q29 |
| F237 | `room:596` | Q30 |
| F240 | `room:699` | Q12 |
| F244 | `room:953` | Q31 |
| F272 | `engine:15361` | Q32 |
| F279 | `engine:16996` | Q02 |
| F283 | `engine:21448` | Q33 |
| F297 | `crates/snapback-server/src/admin_secret_read.rs:670` | Q34 |
| F299 | `crates/snapback-server/src/admin_secret_read.rs:207` | Q35 |
| F305 | `crates/snapback-auth/src/auth/deployment.rs:440` | Q14 |
| F306 | `crates/snapback-auth/src/auth/deployment.rs:492` | Q14 |
| C001 | `crates/snapback-types/src/contract_types.rs:107` | Q09 |
| C002 | `crates/snapback-kernel/src/storage/auth_agent_credentials.rs:82` | Q08 |
| C003 | `crates/snapback-kernel/src/storage/auth_grants.rs:117` | Q10 |
| C005 | `invocation:327` | Q11 |
| C006 | `crates/snapback-types/src/auth/service_authority_contract.rs:18` | Q07 |
| C007 | `storage:16599` | Q04 |
| C012 | `crates/snapback-types/src/manifest/types.rs:11020` | Q02 |
| C013 | `storage:771` | Q12 |
| C014 | `crates/snapback-kernel/src/storage/ask_spend.rs:41` | Q13 |

## Ranked P2 question groups

Ranking is primarily rows resolved per decision. Ties put live-authority or durable-write consequences ahead of external effects and descriptive/audit-only consequences.

| Rank | Group | Rows | Decision and production flow |
|---:|---|---|---|
| 1 | Q01 | 5: F127, F210, F212, F213, F215 | **Which authority classes may carry a session/stream publication belonging to a different principal or connection, and under which exact correlation rule?** Covers anonymous, admin, operator, service, and generic attachment. Production composition occurs in `crates/snapback-server/src/server.rs:13382` and connection augmentation at `:16418`. Live authority follows. |
| 2 | Q02 | 4: F149, F150, F279, C012 | **Must every durable `AuthorityDescriptor` be generated from the exact `PreparedAuthority` and its installed stream, or may a resolved-only/handshake flow assert one separately?** Production descriptor creation at `server.rs:17950`; mutation staging checks expected descriptors at `engine:16965`. Durable writes and later authority attribution follow. |
| 3 | Q03 | 3: F100, F101, F102 | **Which producer may insert, mutate, revoke, rotate, or expire whose projected session, and must the tuple come from the exact durable commit/due-expiry batch?** Coordinator mutation flows begin around `coordinator.rs:684`, `:716`, `:765`, and `:842`. Live session authority follows. |
| 4 | Q04 | 3: F232, F233, C007 | **Which admitted caller may write memberships as a user, service, system, or admin, and when may it assert authority-creating consent?** Production obtains the writer through `PreparedInvocation::membership_writer`, `invocation:2545`. Durable authority-creating writes follow. |
| 5 | Q05 | 3: F011, F022, F070 | **Must session issuance/rotation plans, address admissions, committed sessions, and revocation outputs share one opaque operation identity before joining?** Coordinated issuance is recombined in `coordinator.rs:1208` and `:1363`, then committed by `server.rs:18392`. Bearer authority follows. |
| 6 | Q06 | 2: F157, F175 | **May an effect approver reconstruct a retained session or service principal only from the exact pending effect it is entitled to approve, or may it select another live principal?** Reconstruction is performed in `crates/snapback-server/src/server/effects.rs:64` and consumed through `:198`. Live authority follows. |
| 7 | Q07 | 2: F113, C006 | **Which durable token-resolution producer may register a live `ServiceAuthorityWitness`, for whose token/grant/actor/effective user?** Production registration follows storage resolution at `engine:5259` and `:5393`. Live service authority follows. |
| 8 | Q08 | 2: F120, C002 | **May a `ResolvedScopedToken` become service authority only after exact token-secret and durable-grant resolution, or may trusted internal callers assert it?** Production conversions follow database resolution at `engine:5262` and `:5396`. |
| 9 | Q09 | 2: F119, C001 | **May `ResolvedSession` become session authority only after bearer/catalog resolution, or are there approved assertion-based producers?** Bearer production flow is `coordinator.rs:1502` through `:1532`. |
| 10 | Q10 | 2: F118, C003 | **Who may assert an exact function/grant scope, especially `authority_creating`, and must it come from a durable grant or exact app-callback basis?** Asset callback authority is prepared at `engine:8429`; scoped-token mapping occurs at `engine:25436`. |
| 11 | Q11 | 2: F143, C005 | **Is mode-valid `AdmissionLease` sufficient for any caller-constructed `ResolvedAppAuthority`, or must subject provenance be produced by the same engine authority graph?** General route preparation occurs at `server.rs:13382` and `engine:8114`. |
| 12 | Q12 | 2: F240, C013 | **Must each authorization-commit room selector derive from the exact staged mutation and its authority, or may a database participant reserve arbitrary live rooms?** Writer-gate production flow is `server.rs:1620`; reservation reaches `room:699`. Durable authorization commit follows. |
| 13 | Q13 | 2: F203, C014 | **Whose principal/integration/app budget is charged for session, delegated-service, system, and caller-key requests, and must it derive from the exact prepared authority?** Production selection occurs at `server.rs:28184`; durable counters are reserved at `engine:6351`. |
| 14 | Q14 | 2: F305, F306 | **Which authenticated hosted target may combine with which current authorization incarnation and server boot nonce, and are assertion-based target constructors permitted outside authenticated adapters?** Authenticated construction is F307; serving/open flows use it at `server.rs:9340` and `:23614`. |
| 15 | Q15 | 2: F075, F081 | **Which installed signer/root may authenticate which boot issuer, target, and app, and must live-issuer creation require that exact verified result?** Installed invalidation setup is consumed at `engine:8702`. |
| 16 | Q16 | 1: F073 | **Which component may sign an `AuthorizedLease` for whose query/principal/session, and must all issue fields derive from one exact `AuthorizedLeaseCapture`?** Correct production capture issuance is `engine:4452`. Live lease authority follows. |
| 17 | Q17 | 1: F094 | **Who may rebuild session/token authority from which durable snapshot, and must the snapshot carry database provenance or a startup receipt?** Production rebuild is `coordinator.rs:565`. |
| 18 | Q18 | 1: F097 | **Who holding a projection may mint a publication for which session, and must the session derive from an exact bearer/effect record?** Production bearer preparation is `coordinator.rs:1532` and retained preparation `:1729`. |
| 19 | Q19 | 1: F112 | **Who may terminal which service token IDs, under which disposition, and what capability must authorize the selected set?** Terminal plans are acquired through `engine:3311`; durable token revocation follows. |
| 20 | Q20 | 1: F117 | **May the kernel terminal interlock trust arbitrary fact-asserting callbacks, or must the callback return a transaction-produced receipt for the exact tokens and disposition?** Commit interlock use is in `crates/snapback-sync/src/auth/service_fence.rs:1205`. |
| 21 | Q21 | 1: F126 | **Which prepared authority may receive which deferred rehearsal provenance/window, and must both derive from the same rehearsal grant/effect?** Route binding occurs at `server.rs:13464`; deferred execution reaches `engine:23250`. |
| 22 | Q22 | 1: F145 | **May asset callbacks assert any service principal and grant scope, or only a principal derived from the current app catalog and exact callback function basis?** Production preparation is `engine:8429`. |
| 23 | Q23 | 1: F146 | **In development mode, which sources may impersonate which `input.user_id`: unrestricted local development, owner-bound identity, or fixture-bound identity?** Production preparation occurs at `server.rs:13383` and `engine:8374`. |
| 24 | Q24 | 1: F182 | **Who may register an agent/integration principal, under which open/invitation mode, and whose invitation/owner facts may be used?** Production registration route is `server.rs:17325`; OAuth registration is in `server/oauth.rs:247`. |
| 25 | Q25 | 1: F187 | **May an admitted route pair any agent credential with any pairing request/code/scopes, or must their exact pending-request relation be the authorization?** Production presentation is `server.rs:17295`. |
| 26 | Q26 | 1: F202 | **Who may mint a rehearsal window for which provenance/contact, and under what host or operator grant?** Production mint is reached at `server.rs:24260`. |
| 27 | Q27 | 1: F205 | **May an ambient process operator terminal all tokens for any integration principal, and under what command/source/tenant restriction?** Production operator path is `server.rs:20545`. |
| 28 | Q28 | 1: F220 | **What semantic operation identity, beyond database binding and string equality, must `ExactCommitRows` prove before reconciliation releases its value?** Reconciliation consumes it in `crates/snapback-kernel/src/watches.rs:953` and commit capsules. |
| 29 | Q29 | 1: F236 | **Must `AuthorizedMembershipPlan` prove that its writer is the exact writer that policy-checked that `MembershipPlan`?** Planning and commit are in `crates/snapback-kernel/src/storage/membership_plans.rs:205` and `:343`. |
| 30 | Q30 | 1: F237 | **Which participant/invocation may begin a protected act for which ephemeral room, and what membership or connection condition authorizes it?** Production room acts originate in `crates/snapback-sync/src/ephemeral.rs:3934`. |
| 31 | Q31 | 1: F244 | **Who may clear a resync obligation and reactivate which room generation?** Completion is used in `crates/snapback-sync/src/ephemeral.rs:4008`. |
| 32 | Q32 | 1: F272 | **Must an `AssetWidthPlanTicket` and `AuthorizedEffectReservation` represent the same request, authority, attempt, and publication?** Asset route staging is in `crates/snapback-server/src/server/asset_routes.rs:622` and `:822`. Durable asset writes follow. |
| 33 | Q33 | 1: F283 | **Must live-subscribe authority, input connection, invalidation admission, and effect fence all derive from the same `PreparedConnectionAct`?** Production subscribe assembly is `server.rs:31652`. Live subscription authority follows. |
| 34 | Q34 | 1: F297 | **Which operator may mint which secret-read scopes and budgets, and is ambient possession of the root intentionally sufficient for every valid request?** Operator/registry construction is in `crates/snapback-server/src/admin.rs:2814`. |
| 35 | Q35 | 1: F299 | **Must the secret-read proof root, startup nonce, and mint operator all belong to one registry/root instance?** Bridge construction is in `admin.rs:2849`. |
| 36 | Q36 | 1: F069 | **Which host or rehearsal principal may mint a session for an email without password/code proof, and under what explicit grant?** Production host/rehearsal minting is at `server.rs:24651` and `:24779`; coordinated session minting reaches `:18332`. |
| 37 | Q37 | 1: F061 | **May a bearer-authenticated guest claim any admitted address, or only an address controlled under a specified code/registration condition?** Production guest-claim flow is `server.rs:19520`. |
| 38 | Q38 | 1: F062 | **May password registration set credentials for any admitted email, or must email challenge or existing-identity proof precede preparation?** Production registration is `server.rs:19632`. |
| 39 | Q39 | 1: F067 | **Who may cause a challenge to be sent to whose address, under what abuse, rate, or invitation condition?** Production request-code route is `server.rs:18926`. An external effect follows even before ownership is proved. |
| 40 | Q40 | 1: F001 | **May any crate-local holder create an auth-database plan over any subject, or must plans carry subject-bound admission from the initiating route?** Public execution is `engine:6809`; a durable example is F053 at `server.rs:13497`. |
| 41 | Q41 | 1: F005 | **May any caller with generic provider access select any email/address stripe, relying on later proof, or must each address admission be flow- and proof-bound?** Production callers include request-code at `server.rs:18935` and registration at `:19632`. |
| 42 | Q42 | 1: F082 | **May one authenticated boot issuer retire any namespace/prefix, or only namespaces allocated to the same obligation/authorization stream?** Retirement is prepared at `engine:3737`. |
| 43 | Q43 | 1: F084 | **Who may instantiate an obligation registry for which issuer, authorization incarnation, and data-version stream?** Production installation is at `engine:8656`. |
| 44 | Q44 | 1: F122 | **When may claims be supplied for a session authority, and must they be derived from the exact resolved session and generation?** Production claims are obtained by `engine:8090` before authority preparation. |
| 45 | Q45 | 1: F129 | **Who may set durable caller/approver attribution for whose authority, and must it derive from the exact prepared authority/effect?** Attribution is assembled at `server.rs:16460` and `server/effects.rs:191`. |

## P3-LOW — 17

These are structurally bounded in current production code. I did not infer “impossible” merely from being unable to find an abusive caller.

| Row | Current site | Structural bound |
|---|---|---|
| F006 | `provider:3096` | Process-local keyed mutex only. Dropping the guard releases serialization; it neither writes durable state nor yields a bearer/capability. |
| F043 | `provider:3283` | Read-only step-up coordination. Exact challenge, binding, digest, and code are checked later by F008/F029 before authority or a write. |
| F044 | `provider:3293` | Read-only exchange coordination. F045 later verifies the exact challenge/code/client before credential issuance. |
| F054 | `provider:3448` | Computes digest and holds a stripe; the later database plan compares exact challenge, binding, and digest. This admission cannot itself authorize or write. |
| F055 | `provider:4016` | Holds an address stripe only. The exchange transaction still checks the code before issuance. |
| F063 | `provider:4362` | Preparation only; F026 verifies the password for the embedded identity before session authority can follow. |
| F089 | `types-invalidation:495` | Mutates only the caller-provided in-memory retry registry, bounded by time/count/capacity. Current production uses the separate persisted registry implementation; no production authority consumer of this method was found. A future consumer would require reclassification. |
| F091 | `projection:175` | Data carrier only. `resolve_bound_connection_session` compares incarnation, session, user, provider, and generation exactly at `projection:1630` before authority follows. |
| F096 | `projection:1138` | Returns a crate-visible `SessionFence` whose operative methods remain private to the projection module; no production caller can turn the selected handle into usable authority. |
| F242 | `room:926` | `RoomCreationAdmission` is only a held mutex guard (`room:1729`) with no methods. Production uses it solely to prevent a room-creation race at `ephemeral.rs:6934`. |
| F243 | `room:940` | Can only retire/remove in-memory room authority through `retire_generation_exhausted`, `room:1739`; it cannot create authority or perform a durable write. |
| F285 | `engine:21687` | Staged unsubscribe has no effect before exact commit. Finalization checks `subscription.is_owned_by(authority, fence)` at `engine:21629`. |
| F286 | `engine:21781` | Staged ACK has no effect before exact connection/fence commit; finalization checks the installed connection and exact ACK token at `engine:21749`. |
| F287 | `engine:21961` | Manual-retry finalization checks the subscription connection and `is_owned_by` at `engine:21999` after exact stage commit. |
| F288 | `engine:22581` | Resume finalization checks `subscription.is_owned_by(authority, effect_fence)` at `engine:22104` after exact stage commit. |
| C004 | `projection:150` | Direct construction alone has no production sink. The only authority-producing consumer, private `coordinator:1976`, is reached in production from exact bearer resolution at `coordinator:1502`. |
| C009 | `auth-invalidation:110` | Client-visible connection DTO. Consumers compare installed issuer, authorization, version stream, connection stage, fence, and ACK token before any effect. Construction alone cannot mint authority. |

## P4-DUPLICATE — 40

| Row | Current site | Duplicates |
|---|---|---|
| F002 | `provider:3011` | F073 — provider wrapper around the raw lease signer. |
| F014 | `provider:877` | F011 — sibling unchecked session-response join. |
| F019 | `provider:1090` | F022 — sibling credential-issue join with supplied commit outputs. |
| F020 | `provider:1100` | F070 — sibling unchecked admission/issuance-plan correlation. |
| F032 | `provider:2705` | F061 — downstream guest-claim wrapper inherits the same guest/address policy. |
| F037 | `provider:3209` | F061 — plan wrapper for the same guest/address composition. |
| F056 | `provider:4032` | F005 — canonical-address form of the same address admission. |
| F068 | `provider:4428` | F067 — rehearsal-window wrapper around challenge creation. |
| F078 | `auth-invalidation:333` | F082 — issuer-bound sibling for the same namespace-retirement policy. |
| F095 | `projection:1117` | F094 — fresh-startup-ID wrapper around projection rebuild. |
| F115 | `crates/snapback-kernel/src/auth/service_fence.rs:41` | F117 — prepared callback carrier for the terminal interlock. |
| F121 | `invocation:508` | F146 — dev-impersonation value constructor beneath admitted preparation. |
| F128 | `invocation:1952` | F215 — generic service-publication attachment beneath service preparation. |
| F133 | `invocation:2085` | F158 — raw stream-incarnation sibling; F158 is the coordinator-bound production wrapper. |
| F144 | `invocation:2736` | F143 — private implementation leaf. |
| F160 | `coordinator:1976` | F153 — private leaf beneath exact bearer resolution. |
| F161 | `engine:2481` | F240 — engine forwarding wrapper for room authorization commit reservation. |
| F162 | `engine:2585` | F237 — engine forwarding wrapper for protected room acts. |
| F170 | `engine:5059` | F182 — OAuth-specific wrapper around the same agent/integration registration decision. |
| F189 | `engine:5971` | F112 — local terminal-plan packaging over the raw registry terminal gate. |
| F204 | `engine:6371` | F203 — authorized-effect variant of the same ask-budget subject decision. |
| F211 | `engine:8152` | F146 — engine dev-authority wrapper. |
| F224 | `storage:1757` | F208 — lower user-push authority layer. F208 remains an UNCLEAR root outside the requested LIVENESS population. |
| F227 | `storage:1994` | F117 — serving-database forwarding wrapper for terminal callbacks. |
| F238 | `room:627` | F237 — operation-guard sibling using the same selected-room admission. |
| F257 | `crates/snapback-kernel/src/storage/ask_spend.rs:215` | F203 — kernel leaf for the same budget-subject policy. |
| F258 | `ask_spend.rs:224` | F203 — guarded kernel leaf. |
| F259 | `ask_spend.rs:561` | F203 — serving-database wrapper. |
| F260 | `ask_spend.rs:569` | F203 — guarded serving wrapper. |
| F264 | `crates/snapback-server/src/server/commit_capsule.rs:468` | F266 — uncertain-retention component of the capsule correlation question. |
| F265 | `commit_capsule.rs:603` | F266 — final-cut join beneath the same capsule correlation question. |
| F270 | `engine:13785` | F267 — private current-attempt leaf; production callers first use the ownership-checked entry point. |
| F273 | `crates/snapback-services/src/assets.rs:663` | F274 — raw lease acquisition beneath the proof-checked publication finalizer. |
| F280 | `engine:17022` | F279 — generation wrapper. |
| F281 | `engine:17051` | F279 — settlement/issuance wrapper. |
| F282 | `engine:17091` | F279 — wire/media wrapper. |
| F284 | `engine:21464` | F283 — generation wrapper for live subscribe. |
| F298 | `crates/snapback-server/src/admin_secret_read.rs:721` | F297 — public operator wrapper. |
| F302 | `admin_secret_read.rs:309` | F303 — mechanical I/O leaf beneath the owner-only pinned-sibling production wrapper. |
| F312 | `crates/snapback-auth/src/auth/deployment.rs:344` | F306 — handle forwarding wrapper. |

## Stale-row flags

The inventory’s code provenance is materially stale in one family:

- **F190 and F191:** semantic and signature changes; both are resolved by `a5d66e941` plus `23db84b46`.
- **F185:** its own raw factory remains unchanged, but its relied-on guarded sibling/helper was refactored. The current helper is at `engine:5849` and now delegates admission/source extraction to `engine:5877`.
- **Line drift without changed classification:** the relevant engine file changed, moving F170–F215 and F270–F288 to the current lines cited above. The other bodies in those rows retain their inventoried semantics.
- **Storage line drift without changed classification:** F232, F233, F236, and C007 moved to `storage:16619`, `:16623`, `:16876`, and `:16599` because of unrelated graph work; their bodies are unchanged.
- I diffed each inventoried definition against `8ded451f8`. No other requested row had a subject-correlation semantic change.

## UNCLEAR list

Within the 134 requested rows: **none**.

Three pre-existing UNCLEAR inventory roots lie outside this population:

- **F208 and F256, push reservation:** would be settled by an exhaustive production trace of every `trigger_mode × audience` combination, identifying exactly when System/Deferred authority may intentionally select another recipient.
- **F266, commit capsule:** would be settled by deciding whether value-equal operation IDs are sufficient or whether the intent, uncertain-retention slot, reservation, and reconciliation result must share an unforgeable instance-bound identity.

F224 duplicates the unresolved push root; F264/F265 duplicate the unresolved capsule root. Their forwarding/leaf status is nevertheless determinate.

## Search boundary

I checked all 134 listed rows against current definitions, diffed their source from `8ded451f8` to `bda23afc7`, and followed named constructors/consumers with repository-wide Rust searches across the production crates covered by the inventory. Tests were consulted only to identify existing tested helpers; authorization intent came from production callers and downstream checks.

I did not expand the original inventory boundary to excluded CLI, conformance, harness, tools/bin wiring, most activation/runtime VM capability surfaces, generated/macro expansion, JavaScript/TypeScript authority, FFI, or unrelated service families. Therefore this verifies the assignment of the 134 inventoried rows; it is not a claim that the repository has no additional unenumerated authority factories. No files were written and no tests or builds were run.