# Implementation plans — Q08, Q09, Q12, Q14, Q15 (10 rows)

Status: open
Date: 2026-08-24
Systems: snapback-sync, snapback-auth, snapback-engine, snapback-kernel, snapback-server
Related: LLP 0303, issues/20260824-liveness-row-bucket-assignment.md,
  issues/20260824-implementation-plan-q01.md,
  issues/20260824-implementation-plans-q02-q05.md,
  issues/20260824-implementation-plans-q04-q06-q07-q10.md,
  issues/20260824-implementation-plan-promoted-rows.md,
  issues/20260824-assertion-provenance-is-the-recurring-test-defect.md

Row-level plans for five more ruled groups. With this, planned coverage reaches **47 of the 68 P2
rows** plus the 4 promoted P1 rows.

**Coordination constraint carried in:** Q08 overlaps the authority-seal lane. An executable review of
that lane found a SECOND, bearer-free mint path for `ResolvedScopedToken` from caller-supplied
durable identifiers, alongside exact secret resolution. That path validates live catalog rows, so it
is not fabrication — but it falsified "only by exact resolution", and the seal lane corrected LLP
0303's wording rather than closing the path. Q08 must coordinate with that lane rather than propose a
conflicting fix. Q09 has the same shape against `invocation.rs`, which the seal lane owns.

**Fixture requirement stated in every plan** (nine review rounds produced it): no per-case value may
uniquely determine the derived facts. Not merely no bijection between the axes under test — any value
varying one-per-case (timestamp, offset, index, label, state string) is a reconstruction channel. An
executable review reconstructed two approval facts from `now_ms` *after* the user/session bijection
had been correctly broken.

**Scope cap:** `PreparedAuthority` remains caller-constructible on main, so no row implemented from
these plans may claim a mismatch is *unconstructible* — only that it derives from the prepared
authority.

---


```text
2026-08-24T13:32:10-07:00
docs(issues): row-level implementation plans for Q04, Q06, Q07, Q10 (9 rows)
```

The local `origin/main` ref matched that commit and the worktree was clean. Fetch was blocked by the read-only sandbox:

```text
error: cannot open '.git/FETCH_HEAD': Operation not permitted
```

I therefore cannot claim the inspected commit is current on the remote. `llp-orient` also could not load because its `vendor/llp` target is uninitialized; read-only access prevented initialization. No files or commits were changed.

All plans below make only this scoped claim: production authority at the changed boundary derives from the prepared authority. “Could not construct through the changed API” never means globally impossible.

## Q08 — resolved scoped-token service authority

### F120

1. **Signature and disposition.** Current: [invocation.rs:490](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:490):

   ```rust
   pub fn ResolvedAppAuthority::from_scoped_token(
       token: ResolvedScopedToken,
   ) -> Self
   ```

   Target, using the authority-seal lane’s final carrier name rather than creating a competing seal:

   ```rust
   pub fn ResolvedAppAuthority::from_durably_resolved_service(
       authority: DurablyResolvedServiceAuthority,
   ) -> Self
   ```

   **DERIVE.** It consumes an opaque kernel result minted by either exact secret resolution or exact durable-coordinate resolution. Do not encode “exact secret only”: [auth_agent_credentials.rs:1210](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1210) is a legitimate second mint path.

2. **Existing tested predicate.** Reuse `LocalDatabase::resolve_scoped_token` at [auth_agent_credentials.rs:1105](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1105), `resolve_retained_service_authority` at [auth_agent_credentials.rs:1210](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_agent_credentials.rs:1210), and `service_authority_witness` at line 104. The retained exact-coordinate predicate is already exercised by `retained_live_validation_checks_exact_carrier_and_committed_durable_state` around line 3125. Do not add another grant/token liveness implementation.

3. **Callers.**

   - Production retained-effect conversion: [engine.rs:5262](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5262), especially lines 5277–5300.
   - Production secret route: [engine.rs:5421](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5421), especially lines 5428–5434.
   - Engine tests at `local/tests/engine.rs:15701`, `:28052`, and `:28091`.
   - The import at `invocation.rs:34`.

   Change both production callers to pass the same opaque result first to the Q07 fence registration and then to F120 without splitting it into authored fields. **Observable:** valid secret and retained-effect behavior stays unchanged; direct struct-literal construction in tests could no longer use this API. That is a changed-surface statement, not impossibility.

4. **Production writes/readback.** F120 itself writes nothing. For the complete secret-resolution mutation route, project:

   - `_snapback_meta(key,value)` for the auth clock.
   - `_auth_agent_credentials(last_used_at_ms)`.
   - `_auth_grants(last_used_at_ms)`.
   - Every physical column of the fixture app row.
   - `_snapback_version(id,version)`.
   - `_snapback_changes(id,version,table_name,row_id,op,row_json,changed_at_ms)`.

   The retained bearer-free resolver writes only `_snapback_meta(key,value)` before the app mutation; it does not coalesce credential/grant use. Refused cases must leave the app row, version, change journal, credential, and grant unchanged.

5. **Fields actually read.** F120 reads `actor_user_id`, `effective_user_id`, `credential_id`, `credential_generation`, `grant_id`, `token_id`, `scopes`, `expires_at_ms`, and `integration_status`. It does not read `grant_expires_at_ms`; Q07’s fence does. Scope member semantics belong to the existing Q10 plan. Upstream resolvers additionally read the token secret/hash or retained IDs, token/grant revocation and deadlines, grant principals/scopes, credential status/generation/user, actor kind/deactivation, and integration status. Apply axes only to those fields.

6. **Test-support exposure.** Remove or narrow the feature-public composition of:

   - `ResolvedServiceAuthority::synthetic_for_test` at [engine.rs:3413](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:3413).
   - `ServiceAuthorityPublication::synthetic_for_test` at [service_fence.rs:277](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:277).
   - `ServiceAuthorityFenceRegistry::synthetic_publication_for_test` at line 794.

   Cross-crate tests reaching this path must use a real database resolution and fence registration. `RetainedServiceAuthority` may remain raw input because the resolver validates every coordinate.

7. **Batching.** F120 is owned by the authority-seal lane. Do not edit `invocation.rs` in a separate Q08 patch. Land its target conversion with that lane, then migrate engine callers/tests after rebasing. Batch with C002 and the Q07 carrier/fence result; otherwise the type transition will not compile.

**Fixture:** Four cases A–D. Token/catalog bundle T0 is shared by A/B and T1 by C/D. Exact-secret resolution is shared by A/C; exact retained-ID resolution by B/D. `now_ms=n0` is shared by A/D and `n1` by B/C. Every label, offset, index, state string, and other varying value uses the same A/D versus B/C diagonal. Accepted set is all four exact resolutions. For each retained coordinate mutation, substitute T0/T1 in paired cases and test both lexical directions. No per-case value may uniquely determine the derived authority.

### C002

1. **Signature and disposition.** Current public-field declaration: [auth_agent_credentials.rs:82](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_agent_credentials.rs:82):

   ```rust
   pub struct ResolvedScopedToken {
       pub token_id: String,
       // ...all other fields public...
   }
   ```

   Target, adopting the seal lane’s final name if different:

   ```rust
   pub struct DurablyResolvedServiceAuthority {
       // all fields private, including the database-origin seal
   }
   ```

   `resolve_scoped_token` and `resolve_retained_service_authority` must both return it. Provide read-only accessors and the existing witness projection; provide no `from_parts`, `Deserialize`, or feature-enabled constructor. **DERIVE.**

2. **Existing tested predicate.** The two resolver SQL predicates at lines 1116–1130 and 1222–1246 are the canonical predicate. The latter proves the bearer-free path is live catalog resolution, not fabrication.

3. **Callers.**

   - Both constructors at lines 1177 and 1271.
   - Return signatures at lines 1109 and 1214.
   - `ServingAuthDatabase` forwarding methods at lines 3525 and 3540.
   - F120 and both engine production callers listed above.
   - Literal tests at `local/tests/engine.rs:28021` and `:28061`.
   - Real-resolution test at `local/tests/engine.rs:15684`.

   **Observable:** valid results and existing `SCOPED_TOKEN_INVALID` classifications remain; source-level public-field construction disappears. That construction could not be performed through the changed public type, but no global impossibility claim follows.

4. **Production writes/readback.** Same projection as F120. Explicitly distinguish secret resolution’s `_auth_agent_credentials.last_used_at_ms` and `_auth_grants.last_used_at_ms` writes from retained resolution’s clock-only write.

5. **Fields actually read.** Secret resolution reads `token_hash` plus all durable liveness predicates. Retained resolution reads exactly `token_id`, `grant_id`, `credential_id`, `credential_generation`, `actor_user_id`, `effective_user_id`, and `now_ms`, then reads current scopes, deadlines, and integration status from the matched rows. Axes must not treat unrelated token churn or unread table fields as correlation facts.

6. **Test-support exposure.** The public fields are the primary defect. Remove the synthetic authority/publication combination listed under F120. Kernel-private `cfg(test)` fixtures may construct private fields only inside the defining module; do not re-export such a constructor under `test-support`.

7. **Batching.** This file is owned by the authority-seal lane, round 2. The Q08 lane should supply these acceptance criteria to that lane and not add a second opaque type or origin seal. C002, F120, and Q07 must converge on one carrier.

**Fixture:** Use exactly the A–D T0/T1, secret/retained, and `n0`/`n1` grid specified for F120. Every token field is shared by A/B or C/D; every resolver-lane value by A/C or B/D; every timestamp, label, offset, state, or index by A/D or B/C. Mutated durable identifiers appear in two cases each and in both lexical directions. No case-unique value may reconstruct the authority.

## Q09 — resolved session authority

### F119

1. **Signature and disposition.** Current: [invocation.rs:477](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:477):

   ```rust
   pub fn ResolvedAppAuthority::from_session(
       session: ResolvedSession,
   ) -> Self
   ```

   Target: **delete it with no replacement. DERIVE.** Production session authority already derives through `AuthCoordinator::resolve_required_bearer` at [coordinator.rs:1496](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1496), `resolve_family_bearer` at line 1541, and private `CoordinatorTopology::prepare_bearer_authority` at line 1976.

2. **Existing tested predicate.** Reuse `SessionProjection::resolve_token`, `resolve_required_bearer`, and `resolve_family_bearer`. `required_bearer_resolution_is_memory_only_and_retains_authority_instance` at `coordinator.rs:2415` already tests the production path.

3. **Callers.** `rg` found no F119 caller. Do not invent a replacement caller. Production server routes resolve at `server.rs:13438–13444` and pass `PreparedBearerAuthority` through `server.rs:13509` and `engine.rs:8329`. **Observable:** no current runtime behavior changes; the public Rust API loses an unused assertion-based constructor.

4. **Production writes/readback.** F119 and coordinator resolution are memory-only. An end-to-end accepted mutation must project every fixture app-row column, `_snapback_version(id,version)`, and all seven `_snapback_changes` columns. If the test deliberately crosses authenticated-use coalescing, also project `_auth_sessions(last_used_at_ms,expires_at_ms)`; otherwise set the fixture within the coalescing interval and assert that table unchanged.

5. **Fields actually read.** F119 currently reads `session_id`, `user_id`, `provider`, `generation`, `authority_instance_id`, `expires_at_ms`, and `absolute_expires_at_ms`; it ignores `identity_id` and `created_at_ms`. Production coordinator resolution also reads the bearer digest, current/superseded classification, supersession time, terminal state, and publication fence. Only those are correlation axes.

6. **Test-support exposure.** `AuthCoordinator::new(SessionProjection)` becomes public under `test-support` at [coordinator.rs:572](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:572), while `SessionProjection::rebuild` accepts caller-authored `ProjectionSource`. Narrow `new` to `cfg(test)` or require the opaque kernel `AdmittedProjectionSnapshot`. Feature-public `PreparedBearerAuthority::authority`/`into_parts` only dismantle an existing result, but should not gain a reconstruction counterpart.

7. **Batching.** `invocation.rs` is seal-lane-owned. Delete F119 when that lane releases or as part of its patch. No provider, kernel, engine, or server production edit is required.

**Fixture:** Session bundle S0 is shared by A/B and S1 by C/D. Required-bearer resolution is shared by A/C; family-bearer resolution by B/D. `now_ms=n0` is shared by A/D and `n1` by B/C. Every bearer, session field, label, offset, index, and state string appears in at least two cases. Exact A–D are accepted; unknown, terminal, and outside-grace mutations are paired and tested in both lexical directions. No per-case value may reconstruct session authority.

### C001

1. **Signature and disposition.** Current: [contract_types.rs:107](/Users/ccheever/projects/snapback/crates/snapback-types/src/contract_types.rs:107), public-field `ResolvedSession`. Target declaration remains a raw catalog-facts DTO for now; it must no longer be accepted by any authority constructor. **DERIVE at the authority sink, not VERIFY.** Renaming it to `CatalogSessionFacts` is optional cleanup, not required for the safety result, and would collide with the live provider lane.

2. **Existing tested predicate.** Durable fallback uses `AuthProvider::resolve_session` at [provider.rs:3561](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/provider.rs:3561) and `resolve_ordinary_lookup` at line 4931. Production invocation uses the coordinator helpers above. Do not add a new DTO-level liveness method.

3. **Callers.** Keep raw-fact uses intact:

   - Kernel construction after checked row conversion: `auth_catalog_ops.rs:550–580`.
   - `AuthSessionRecord` and `PresentedSessionLookup` at `contract_types.rs:120–141`.
   - Provider exports, `resolve_session_plan`, `resolve_session`, and lookup policy.
   - `server/src/auth/provider_tests.rs:3643`.

   The only authority-bearing edge is F119; delete that. **Observable:** provider fallback results remain unchanged. C001 literals remain possible as data, but could not become invocation authority through the changed F119 boundary. That is not an impossibility claim.

4. **Production writes/readback.** Catalog lookup and ordinary resolution are read-only. Use the same end-to-end mutation/readback requirements as F119; include `_auth_sessions(last_used_at_ms,expires_at_ms)` only when the selected route actually records use.

5. **Fields actually read.** Kernel validation reads all stored timing and generation fields to reject corrupt ordering. `resolve_ordinary_lookup` reads `revoked`, `expires_at_ms`, `superseded_at_ms`, and `now_ms`. Authority preparation uses only the seven fields listed under F119. Do not axis-test `identity_id` or `created_at_ms` at the invocation boundary.

6. **Test-support exposure.** The C001 fields are ordinary public data, but become harmless for this scoped defect only after F119 disappears. The feature-public `AuthCoordinator::new` plus authored `ProjectionSource` is the remaining reconstruction route and must be narrowed as described above.

7. **Batching.** Land C001’s “raw facts only” regression/compile test with F119 deletion. Do not edit live-owned `provider.rs`. If a later cleanup renames the DTO, schedule it after that lane releases and treat it as mechanical API churn.

**Fixture:** Reuse the F119 A–D grid exactly: S0 A/B, S1 C/D; required A/C, family B/D; `n0` A/D, `n1` B/C. Every DTO value, timestamp, label, offset, index, and state string repeats in at least one other case. Only fields read by durable classification or authority preparation are mutated.

## Q12 — authorization-commit room selection

### F240

1. **Signature and disposition.** Current: [room_authority.rs:699](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/room_authority.rs:699):

   ```rust
   pub fn AuthorizationCommitParticipant::prepare_authorization_commit(
       &self,
       preflight: AuthorizationCommitPreflight,
       cancellation: Arc<AuthorizationReservationCancellation>,
   ) -> SnapbackResult<AuthorizationCommitReservation>
   ```

   Target:

   ```rust
   pub fn prepare_authorization_commit(
       &self,
       prepared: PreparedAuthorizationCommitImpact,
       cancellation: Arc<AuthorizationReservationCancellation>,
   ) -> SnapbackResult<AuthorizationCommitReservation>
   ```

   **DERIVE.** `prepared` must come from the exact mutation preview and remain paired with its `PreparedInvocation` in an opaque engine carrier. The transaction-bind comparison at lines 1189–1199 becomes equality, not `covers`, for app writes. That equality is a stale-preview guard; it is not a VERIFY disposition replacing derivation.

2. **Existing tested predicate.** Reuse:

   - `authorization_commit_hook_in` at [authorization.rs:29](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/authorization.rs:29).
   - `selector_for_app_writes` at [room_authority.rs:2125](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/room_authority.rs:2125).
   - Existing dry-run/preview paths at `engine.rs:23403–23584`.
   - `membership_projection_selector_stays_narrow_and_unknown_fields_widen` at `room_authority.rs:3045`.

3. **Callers.**

   - Sync forwarding at `ephemeral.rs:3316` and `:3779`.
   - Engine `EphemeralApi::reserve_authorization_commit` at [engine.rs:2519](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:2519).
   - Server `DetachedActionHost::reserve_authorization_commit` at [server.rs:1620](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:1620), used at lines 1792 and 1952.
   - Writer-gate reservation at `writer_gate.rs:776`.
   - Coordinated reset at `writer_gate.rs:607`.
   - Kernel unit callers at `room_authority.rs:2400`, `:2480`, `:2562`, `:2698`, `:2746`, `:2787`, `:2952`, and `storage/tests.rs:13049`.

   Change production calls to consume/borrow the opaque staged carrier; unit tests may use module-private constructors. **Observable:** exact previews behave the same. A broader reserved selector that previously passed `covers(actual)` now refuses with `SNAPBACK_AUTH_RESERVATION_STALE`. A participant could not request arbitrary rooms through the changed API; this does not prove global impossibility.

4. **Production writes/readback.** Reservation itself writes only process memory: ticket sequence, dependency, pending-room sets. For an accepted minimal protected-row mutation, project:

   - Every physical app-row column.
   - `_snapback_version(id,version)`.
   - `_snapback_changes(id,version,table_name,row_id,op,row_json,changed_at_ms)`.
   - `_snapback_meta(key,value)` for `authorization_epoch_v1`.

   Use a fixture without membership/projection declarations so those are the complete SQL writes. Refused stale or mismatched cases must leave all four projections unchanged and leave no pending in-memory ticket.

5. **Fields actually read.** The selector reads `ChangedRow.table`, `op`, `changed_fields`, `row`, schema table/field authorization metadata, collection permission-backing table, scope-field mapping, and room routing fields. It does not use `ChangedRow.id`. F240 also reads database binding, registry identity/generation, protected-collection revision, durable predecessor, and current room keys/generations. Apply axes only to those.

6. **Test-support exposure.** Feature-public failure injectors are denial-only. The authority-bearing exposure is public `EphemeralApi::reserve_authorization_commit` accepting the raw enum; its target may remain public only with the opaque prepared carrier. Do not add a feature-public `for_test` constructor.

7. **Batching.** F240 and C013 must land atomically with the writer-gate/engine carrier changes. They do not touch the listed live lanes. Because this batch is broad across kernel, sync, engine, and server, land it separately from Q14 and Q15.

**Fixture:** Mutation M0 is shared by A/B and M1 by C/D. Prepared authority U0 is shared by A/C and U1 by B/D. `now_ms=t0` is shared by A/D and `t1` by B/C. M0’s table, row, changed fields, schema facts, and room are identical in A/B; M1’s in C/D. Every authority field repeats A/C or B/D. Every label, offset, index, state string, and ancillary timestamp repeats A/D or B/C. Accepted set is A and D; B and C are cross-authority refusals in opposite lexical directions. No per-case value may reconstruct the selector or authority.

### C013

1. **Signature and disposition.** Current: [storage.rs:771](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:771):

   ```rust
   pub enum AuthorizationCommitPreflight {
       NoAuthorizationEvent,
       AllProtectedRooms,
       AppWrites {
           schema: Box<SchemaManifest>,
           changes: Vec<ChangedRow>,
       },
   }
   ```

   Target:

   ```rust
   pub struct PreparedAuthorizationCommitImpact {
       // private selector/cause, database binding, and preview identity
   }
   ```

   There must be no public `AllProtectedRooms` constructor. Activation and destructive-boundary stages may internally derive all-rooms from the closed `AuthorizationCommitCause`. App writes derive only from exact preview changes. **DERIVE.**

2. **Existing tested predicate.** Same canonical helpers as F240. Do not create a second event classifier or selector.

3. **Callers.** Replace every raw-enum flow:

   - Engine staged structs with public `preflight` at [engine.rs:2069](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:2069).
   - Stage signatures/results at `engine.rs:17040–17191`, `17359`, `17488`, `17563`, `17655`, `17716`, and `28502`.
   - Preflight helpers at `engine.rs:22994` and `:23008`.
   - Direct engine all-room calls: schema load `:8920`, reset `:9282`, versioned seed `:9394`, auth provision `:10024`, and direct recorded mutation around `:16906`.
   - Writer-gate generic stage signatures at `writer_gate.rs:358`, `:386`, `:693`, and `:715`.
   - Server all-room closures at `server.rs:23772`, `:25733`, `:25785`, `:26731`, `:27208`, `:31476`, and `:31511`.
   - Managed host-plan flow at `server.rs:4872–4908`.
   - Sync forwarding/imports at `ephemeral.rs:14`, `:3316`, and `:3779`.
   - All kernel, sync, engine, and server tests returned by the current `AuthorizationCommitPreflight` search.

   Replace `(preflight, staged)` with one opaque `StagedAuthorizationMutation`, and after reservation with `ReservedStagedAuthorizationMutation`. Do not expose `into_parts` that recreates the split. **Observable:** valid administration/reset/seed/mutation behavior remains; stale or overbroad reservations newly refuse.

4. **Production writes/readback.** Same mandatory projections as F240. Cause-specific activation/reset tests must additionally project every metadata row that their existing production operation writes; do not use an all-room reservation test as a substitute for operation-specific durable readback.

5. **Fields actually read.** `NoAuthorizationEvent` currently carries no facts; the target derives neutrality from the exact preview. `AllProtectedRooms` carries no provenance and is therefore deleted. `AppWrites` reads the exact fields enumerated under F240. The opaque engine wrapper additionally reads the prepared invocation’s authority/admission and the database/app generation used to stage the mutation.

6. **Test-support exposure.** Delete or change [test_support.rs:71](/Users/ccheever/projects/snapback/crates/snapback-engine/src/test_support.rs:71), which currently publicly returns raw preflight under `test-support`. It should return an opaque staged seed carrier or execute the real production stage. Public staged `preflight` fields and raw feature-accessible enum variants must disappear.

7. **Batching.** Forced atomic batch with F240, the engine staged carriers, sync forwarding, and writer gate. File collisions with Q14 in `server.rs` and with Q15/Q08 in `engine.rs` make separate landings preferable.

**Fixture:** Use the same A–D grid as F240: M0 A/B, M1 C/D; U0 A/C, U1 B/D; `t0` A/D, `t1` B/C. Every schema, change, room, authority, timestamp, label, offset, index, and state value appears in at least two cases. Exact accepted set A/D and refused cross-pair set B/C must be asserted, including both lexical directions.

## Q14 — hosted target, authorization incarnation, boot nonce

### F305

1. **Signature and disposition.** Current: [deployment.rs:440](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/deployment.rs:440):

   ```rust
   pub fn HostedServingAuthority::from_authenticated_target(
       public_origin: impl Into<String>,
       admission: HostedAdmission,
       observed_at_ms: u64,
       authentication_throttle_key: [u8; 32],
   ) -> SnapbackResult<Self>
   ```

   Target: delete the public constructor and separate `install_hosted_target_admission`. The hosted-edge path should consume its existing opaque result:

   ```rust
   pub(crate) fn HostedServingAuthority::from_verified_admission(
       verified: VerifiedHostedAdmission,
       observed_at_ms: u64,
   ) -> SnapbackResult<Self>
   ```

   The authenticated-file F307 path may use a separate private legacy verified-envelope carrier. **DERIVE.**

2. **Existing tested predicate.** Reuse `verify_admission_envelope_prebind` at [hosted_edge.rs:611](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/hosted_edge.rs:611) and `verify_target_admission` at line 152. `online_admission_requires_and_verifies_v2_target_authority` at line 972 already exercises the signed target predicate.

3. **Callers.**

   - Legacy authenticated files at `deployment.rs:609`.
   - Hosted-edge prebind at `hosted_edge.rs:695`.
   - Hosted-edge install at `hosted_edge.rs:720–726`.
   - Deployment tests at `deployment.rs:980` and `:1005`.
   - Server fixture at `server/tests.rs:1862`.
   - Separate target install test at `server/tests.rs:39694`.

   Prebind should call a private pure shape/liveness validator, not construct an authority using `[0; 32]`. Installation consumes `VerifiedHostedAdmission` and installs its signed target in the same constructor. **Observable:** valid hosted installs remain identical; assertion-based test/server construction becomes a source break. It could not construct through the changed API, but this is not a global impossibility claim.

4. **Production writes/readback.** Construction itself writes nothing. Authenticated install writes `_snapback_hosted_admission_watermark(id,admission_epoch,sender_replay_epoch_floor)`; project all three columns. Refusals must leave the prior watermark exactly unchanged.

5. **Fields actually read.** Base admission validation reads canonical `public_origin`; every field used by `closed_admission_facts_hold`; `observed_at_ms`; and the authenticated throttle key. Target verification reads every `HostedAdmissionV2` field and `signature`, plus the edge admission and verification public key. Axis every verifier-read field, but do not invent axes for values merely stored and never inspected.

6. **Test-support exposure.** F305 and `install_hosted_target_admission` are ordinary public APIs, which is the primary exposure. No Q14-specific `*_for_test` or feature constructor was found. Replace raw server fixtures with signed-envelope verification and installation.

7. **Batching.** F305 must land atomically with `hosted_edge.rs` installation and F306/F312 because otherwise a caller can still attach a target after construction. This batch collides with Q12 in `server.rs`; land separately.

**Fixture:** Verified target T0 and its signing key are shared by A/B; T1/key1 by C/D. Runtime binding R0 is shared by A/C and R1 by B/D. `now_ms=n0` is shared by A/D and `n1` by B/C. Every admission field, signature, origin, timestamp, label, offset, index, and state string is shared by at least two cases. Exact installed combinations A/D are accepted; cross combinations B/C are refused or have no expression through the changed production API. That lack of expression is not an impossibility claim.

### F306

1. **Signature and disposition.** Current: [deployment.rs:492](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/deployment.rs:492):

   ```rust
   pub fn hosted_target_authority_instance_at(
       &self,
       now_ms: u64,
       authorization_incarnation: &str,
       boot_nonce: &str,
   ) -> SnapbackResult<Option<String>>
   ```

   Target:

   ```rust
   pub fn authenticated_hosted_target_at(
       &self,
       now_ms: u64,
   ) -> SnapbackResult<Option<AuthenticatedHostedTarget>>
   ```

   `AuthenticatedHostedTarget` has private fields and read-only projections. Server code privately derives the final digest from that result, `PreparedConnectionOpenAuthority.bound.authorization_stream_incarnation()`, and `AppState::server_startup_nonce()`. Apply the same target to F312 on `HostedServingHandle`. **DERIVE.**

2. **Existing tested predicate.** Reuse `admission_epoch_at`, `verify_target_admission`, and the `PreparedConnectionOpenAuthority`/`BoundGrantAuthority` stream binding. Keep canonical JSON and digest construction byte-for-byte identical.

3. **Callers.**

   - F312 forwarding at [deployment.rs:344](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/deployment.rs:344).
   - Connection open at [server.rs:9340](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:9340).
   - Public project inspection at [server.rs:23727](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:23727).
   - Server tests at `server/tests.rs:39689` and `:39712`.

   Inspection should ask only whether `authenticated_hosted_target_at(now)` is `Some`; remove fake `"public-inspection"`. Connection open computes the digest from exact server-owned facts. **Observable:** digest bytes and public `current` remain unchanged. Raw incarnation/nonce injection disappears from the API.

4. **Production writes/readback.** F306 and digest derivation write no durable columns. If tested through hosted installation, project the three watermark columns listed under F305. Connection-open state is process memory only.

5. **Fields actually read.** Liveness reads base admission epoch/window and target `issued_at_ms`, `hosted_auth_expires_at_ms`, and `routed_machine_expires_at_ms`. The digest reads `target_id`, `deployment_id`, `routed_machine_id`, `admission_generation`, exact authorization incarnation, and exact boot nonce. Other target fields are verifier axes under F305, not digest-combination axes here.

6. **Test-support exposure.** F306/F312 are ordinary public assertion-based APIs. Delete them. A public opaque target result may expose getters needed by server digest code, but no public raw “combine with incarnation/nonce” method. Server tests must install a real signed target.

7. **Batching.** Atomic with F305, F312, hosted-edge install, connection-open adaptation, inspection, and tests. Separate from Q12 because both edit `server.rs`.

**Fixture:** T0 A/B, T1 C/D; runtime `(incarnation,boot_nonce)` R0 A/C and R1 B/D; `n0` A/D and `n1` B/C. Every target identity, runtime field, signature, timestamp, label, offset, index, and state string appears twice. Accepted exact pair set A/D; B/C are opposite-direction crosses. The changed API would not let the test pass an independent cross pair; that does not mean such a value is impossible to compute elsewhere.

## Q15 — invalidation signer/root and live boot issuer

### F075

1. **Signature and disposition.** Current: [invalidation.rs:181](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/invalidation.rs:181):

   ```rust
   pub fn LiveInvalidationIssuer::new(
       authenticated: AuthenticatedBootIssuer,
   ) -> SnapbackResult<Self>
   ```

   It checks only shape/canonical MAC length. Target:

   ```rust
   pub(crate) fn LiveInvalidationIssuer::from_verified_boot(
       verified: VerifiedBootIssuer,
   ) -> SnapbackResult<Self>
   ```

   `VerifiedBootIssuer` privately carries the exact descriptor, installed signer, target profile, and app ID. It also supplies the retirement signer, replacing `with_authenticator`. **DERIVE.**

2. **Existing tested predicate.** Reuse `IssuerAuthenticator::verify` at [invalidation.rs:431](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/invalidation.rs:431) and `issuer_mac_binds_target_app_and_every_issuer_field` at line 1781. Do not add another HMAC check.

3. **Callers.**

   - Unsafe acceptance fixtures at `authorization_acceptance.rs:508` and `auth_room_kick_acceptance.rs:2173`.
   - Current safe-but-split `with_authenticator` callers at `provider.rs:2991`, `local/tests/engine.rs:28797`, and `sync/src/ephemeral.rs:9349`.
   - Engine production consumption remains `install_authenticated_auth_invalidation` at [engine.rs:8746](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8746); it should continue receiving a finished `LiveInvalidationIssuer` from the provider.

   Migrate fixtures to a real `AuthProvider`/keyring and production-shaped installation. The provider file is live-lane-owned: its owner must change the one internal construction call; the Q15 lane must wait/rebase rather than edit it concurrently. **Observable:** production behavior stays unchanged; acceptance fixtures gain retirement signing. Raw authenticated descriptors could not create a live issuer through the changed API, but that is not global impossibility.

4. **Production writes/readback.** `reserve_invalidation_boot_issuer` at [auth_invalidation.rs:591](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_invalidation.rs:591) writes `_snapback_meta(key,value)`:

   - Always advances `auth_invalidation_boot_sequence_v1`.
   - On a fresh database may initialize `auth_stream_incarnation_v1`.
   - May initialize `authorization_epoch_v1`.
   - May initialize `auth_invalidation_data_version_stream_v1`.

   Read back `key,value` for every one of these rows and baseline-diff the table. Pin an already-active, non-rotation-due keyring so signer selection is read-only; if a separate test crosses rotation, assert the complete external keyring document because it is not SQL-column state.

5. **Fields actually read.** Engine reads schema `app_id`, `target_profile` or its fallback, reserved authorization incarnation/epoch, version stream, boot sequence, optional reset successor, and generated boot nonce. Verification reads signer key ID/material; issuer incarnation, boot sequence, boot nonce; target profile; app ID; and MAC. Apply axes only to those.

6. **Test-support exposure.** Remove or narrow:

   - `EngineInvalidationBinding::from_issuer_for_test` at [engine.rs:3289](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:3289).
   - The `cfg(test)` raw tuple helper `AuthRuntime::reserve_invalidation_boot_issuer` at [runtime.rs:330](/Users/ccheever/projects/snapback/crates/snapback-server/src/auth/runtime.rs:330), or make it execute the production install and return only the opaque binding.
   - Public `LiveInvalidationIssuer::new` and `with_authenticator`.

   Cross-crate tests must use `install_authenticated_auth_invalidation`.

7. **Batching.** F075 and F081 are inseparable. Land with test migrations and the provider-lane’s small internal adaptation after that file is released. Keep separate from Q08/Q12 because `engine.rs` and engine tests overlap.

**Fixture:** Root K0 is shared by A/B and K1 by C/D. Issuer/target/app tuple U0 is shared by A/C and U1 by B/D. `now_ms=n0` is shared by A/D and `n1` by B/C; version-stream and authorization-epoch values follow the same diagonal. Every boot nonce, sequence, incarnation, target, app, key ID, label, offset, index, timestamp, and state value appears in at least two cases. Exact signed combinations A–D verify; every root or tuple substitution is refused in both directions. Live creation consumes only the corresponding verified result.

### F081

1. **Signature and disposition.** Current: [invalidation.rs:416](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/invalidation.rs:416):

   ```rust
   pub fn IssuerAuthenticator::authenticate(
       &self,
       issuer_id: IssuerId,
       target_profile_id: &str,
       app_id: &str,
   ) -> SnapbackResult<AuthenticatedBootIssuer>
   ```

   Target:

   ```rust
   pub(crate) fn IssuerAuthenticator::authenticate(
       &self,
       issuer_id: IssuerId,
       target_profile_id: &str,
       app_id: &str,
   ) -> SnapbackResult<VerifiedBootIssuer>
   ```

   `VerifiedBootIssuer` contains the serializable descriptor plus exact signer/root and target/app binding; only F075 consumes it. `AuthenticatedBootIssuer` remains a wire descriptor, not live authority. **DERIVE.**

2. **Existing tested predicate.** `IssuerAuthenticator::verify` and its existing MAC-binding test are canonical. `base_mac` at lines 605–616 already binds domain, target, app, authorization incarnation, sequence, and nonce.

3. **Callers.**

   - Live-owned provider call at `provider.rs:2990`; its lane must pass the verified result directly to F075.
   - Acceptance fixtures at `authorization_acceptance.rs:506` and `auth_room_kick_acceptance.rs:2171`.
   - Engine test at `local/tests/engine.rs:28795`.
   - Sync test at `ephemeral.rs:9347`.
   - Auth unit tests at `invalidation.rs:1783` and `:1794`; use `verified.descriptor()` where wire verification is intended.

   Narrow `IssuerAuthenticator::new` together with F081 so cross-crate fixtures cannot create arbitrary roots; keep only the provider/keyring custody path plus module-local unit fixtures. This means those external fixtures could not construct a verified result through the changed API; it does not establish impossibility for all in-crate code.

4. **Production writes/readback.** F081 itself is memory-only. Its production caller follows the F075 boot reservation, so use the same `_snapback_meta(key,value)` readback. Assert no keyring file change in the non-rotation fixture.

5. **Fields actually read.** F081 reads key bytes and key ID; `issuer_id.authorization_incarnation`, `boot_sequence`, and `boot_nonce`; `target_profile_id`; and `app_id`. The key ID is carried in the descriptor and checked by `verify`, though it is not part of the base MAC input. Do not axis-test authorization epoch or version stream at F081 itself; those belong to F075’s install binding.

6. **Test-support exposure.** Public `IssuerAuthenticator::new`, public F081, public F075, and `EngineInvalidationBinding::from_issuer_for_test` currently compose the defect without a feature and under `test-support`. Narrow all four as one change. Keep mutation-only tests inside `invalidation.rs`; do not export `VerifiedBootIssuer::for_test`.

7. **Batching.** Atomic with F075. The provider-lane owner must adjust `provider.rs:2990–2997`; Q15 should not edit that live-owned file independently. Then migrate engine/sync acceptance fixtures in the same landing so no public compatibility constructor survives.

**Fixture:** Use the same A–D grid as F075: K0 A/B, K1 C/D; U0 A/C, U1 B/D; `n0` A/D, `n1` B/C. Key IDs/material, every issuer field, target, app, timestamp, label, offset, index, and state string repeat in at least two cases. Assert the exact accepted root/tuple set and every root, target, app, incarnation, sequence, and nonce mutation in both lexical directions. No per-case value may reconstruct either the MAC facts or the live-issuer facts.