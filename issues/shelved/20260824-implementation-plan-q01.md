# Implementation plan — Q01: publication attachment (5 rows)

Status: open
Date: 2026-08-24
Systems: snapback-sync, snapback-auth, snapback-server, snapback-engine
Related: LLP 0303, issues/shelved/20260824-liveness-row-bucket-assignment.md,
  issues/shelved/20260824-implementation-plans-q02-q05.md,
  issues/shelved/20260824-assertion-provenance-is-the-recurring-test-defect.md

Row-level plan for the highest-leverage group in the program: F127, F210, F212, F213, F215.

**Why this group is first.** It is the only one whose defect is verified rather than inferred:
authority is assembled in stages and publications attach *after* identity through public methods,
so an anonymous publication — which carries a stream fence but no session fence — can be attached
to a session-resolved authority and bypass that session's generation, terminal and deadline checks.
A session can outlive its own logout.

**Scope cap:** `PreparedAuthority` remains caller-constructible, so nothing implemented from this
plan may claim a mismatch is *unconstructible* — only that it derives from the prepared authority.
See `issues/shelved/20260824-authority-provenance-is-a-prerequisite-not-a-peer.md`.

**Planning caveat, recorded verbatim from the analysis:** the plan was produced against a cached
`origin/main` at `798df8e09` under a read-only sandbox that could not fetch. Line anchors must be
re-verified before editing — main moves continuously and anchor drift has already been observed
once in this program.

---


I made no file changes or commits. `git fetch origin` could not update `.git/FETCH_HEAD` because the environment is read-only; network fallback was also unavailable. The cached `origin/main` and `HEAD` are identical at `798df8e09d002740759cc1f48b11b40f549d24fe` (`2026-08-24T09:30:33-07:00`). All lines below were confirmed against that cached `origin/main`, not a freshly fetched remote tip.

The project’s `llp-orient` skill was unavailable because `vendor/llp` is uninitialized. I manually read LLP 0303 and the two prerequisite/test-discipline issues.

## Required end state

No authority may carry a publication associated with another principal or another prepared connection carrier.

| Resolved class | Permitted publication |
|---|---|
| `Session` | Exactly its projection-produced session publication. Correlation is equality of authorization-stream incarnation, session ID, user ID, provider, generation, and authority-instance ID. The publication must retain the same session fence whose generation, terminal state, and deadline are checked. |
| `Anonymous`, sessions mode | Current stream-only publication from the same authority graph. Never a session publication. |
| `AdminBypass`, including sessions-mode operator | Current stream-only publication from the same authority graph. Never a session publication. |
| `ServicePrincipal` | Current stream-only publication plus the service publication derived from the same resolved scoped token. Service equality is token ID, grant ID, actor user ID, effective user ID, credential ID, credential generation, and token expiry, plus registry/database origin. |
| Dev `Anonymous`/`DevImpersonation` | No publication, except bootstrap’s separately ruled installed-stream identity. |
| `RevalidatedPrincipal`, `System`, bearer-free asset callback | Preserve their current no-publication posture; Q01 does not authorize adding one. |

A session publication is not connection-specific: multiple connections may legitimately use the same exact session fence. What must be impossible is extracting a publication from connection A and installing it on an authority independently prepared for connection B. Connection routes must therefore derive authority and publication from the same opaque `PreparedConnectionAct`/`PreparedConnectionOpenAuthority` carrier.

The present doc comment that anonymous publication is bound to the current stream is true but insufficient: [`coordinator.rs:1569`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1569). The resulting publication has `session: None` at [`session_projection.rs:1220`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:1220), and that absence skips every session check at [`session_projection.rs:644`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:644), especially the unconditional publication at lines 657–658.

## Type-state and sealing design

In [`invocation.rs:1214`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:1214), split the current type into:

```rust
pub struct AuthorityAssembly {
    state: AuthorityAssemblyState, // all fields private
}

#[derive(Clone, Debug)]
pub struct PreparedAuthority {
    state: SealedAuthorityState, // all fields private
}
```

`InvocationGate` root preparation returns `AuthorityAssembly`, not `PreparedAuthority`. `AuthorityAssembly` contains a private correlation requirement selected from:

```rust
enum PublicationRequirement {
    None,
    StreamOnly,
    ExactSession(SessionCorrelation),
    ExactService(ServiceCorrelation),
}
```

It also records whether stream, session, service, rehearsal, and caller-attribution bindings have been satisfied. It must not be `Clone`.

The sole transition is:

```rust
impl AuthorityAssembly {
    pub fn seal(self) -> SnapbackResult<PreparedAuthority>;
}
```

`seal` checks the complete class-specific accepted set, rejects missing or duplicate carriers, and derives `authorization_stream_incarnation` from the admitted publication. `PreparedAuthority` has no publication, service-publication, stream-incarnation, rehearsal, or attribution attachment methods. Its fields remain private.

Retain methods such as `inherit_for`, `watch_function_authority`, and `ask_query_authority` only as sealed-to-sealed derivations that clone an already-correlated carrier; they may not accept or replace a publication.

Extend `FencedPublication`, currently defined at [`session_projection.rs:436`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:436), with private correlation metadata:

```rust
enum PublicationSubject {
    StreamOnly,
    Session {
        session_id: String,
        user_id: String,
        provider: String,
        generation: u64,
        authority_instance_id: String,
    },
}
```

Populate the session form from the `ProjectedSession` at [`session_projection.rs:133`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/session_projection.rs:133), not from later caller input. Do not expose a constructor or mutable fields.

After this change:

- A mismatched pair is impossible through the public API because there is no post-seal attachment method and opaque carriers are never split.
- The crate-private assembly verifier still refuses a malformed pair injected by in-module tests. That pair remains constructible inside the owning crate, so describe this as “refused internally,” not “impossible.”
- Full “unconstructible authority” claims remain unavailable until the provenance prerequisite lands.

## Row-by-row changes

### F127 — generic attachment

Current at [`invocation.rs:1918`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:1918):

```rust
pub fn with_fenced_publication(
    mut self,
    publication: FencedPublication,
) -> Self
```

Target: delete the method. Do not replace it with another public method accepting `FencedPublication`.

Introduce these opaque paths instead:

```rust
impl AuthCoordinator {
    pub fn bind_current_stream(
        &self,
        authority: AuthorityAssembly,
    ) -> SnapbackResult<AuthorityAssembly>;
}

impl PreparedAnonymousConnectionAuthority {
    pub fn bind_route_authority(
        self,
        authority: AuthorityAssembly,
    ) -> SnapbackResult<AuthorityAssembly>;
}

impl PreparedBearerAuthority {
    pub fn prepare(/* existing preparation arguments */)
        -> SnapbackResult<AuthorityAssembly>;
}
```

`bind_current_stream` mints the stream publication itself; it accepts no caller publication. `PreparedBearerAuthority::prepare` consumes its existing inseparable authority/publication bundle at [`coordinator.rs:414`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:414).

Disposition: **DERIVE**. The generic independent parameter disappears. A private verifier still compares metadata as defense in depth because opaque values cross subsystem boundaries, but verification is not the public authority-producing surface.

Also remove raw splitting:

- `PreparedBearerAuthority::into_parts` at [`coordinator.rs:507`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:507).
- `PreparedConnectionSessionAuthority::into_parts` at [`coordinator.rs:438`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:438).
- Public `PreparedAnonymousConnectionAuthority.authorization_stream_incarnation` and `into_parts` at [`coordinator.rs:481`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:481).

Replace `BoundGrantAuthority`’s duplicated raw fields at [`server.rs:5680`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:5680) with opaque variants storing those carrier types directly. `try_publish` delegates into the carrier; it does not retrieve a raw publication.

### F210 — anonymous preparation

Current at [`engine.rs:8126`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8126):

```rust
pub fn prepare_anonymous_authority(
    &mut self,
    source: InvocationSource,
    active_mode: AuthMode,
    profile: ServerProfile,
    admission: AdmissionLease,
    wire: &WireAuthorityFields,
    now_ms: u64,
    publication: Option<crate::auth::session_projection::FencedPublication>,
) -> SnapbackResult<PreparedAuthority>
```

Target:

```rust
pub fn prepare_anonymous_authority(
    &mut self,
    source: InvocationSource,
    active_mode: AuthMode,
    profile: ServerProfile,
    admission: AdmissionLease,
    wire: &WireAuthorityFields,
    now_ms: u64,
) -> SnapbackResult<AuthorityAssembly>
```

The factory sets `PublicationRequirement::None` for Dev and `StreamOnly` for Sessions. The sessions caller then invokes `AuthCoordinator::bind_current_stream`, or consumes the exact opaque connection carrier. `seal` refuses a sessions-mode anonymous assembly with no current stream.

Disposition: **DERIVE**. The caller no longer supplies an optional publication.

### F212 — admin preparation

Current at [`engine.rs:8197`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8197):

```rust
pub fn prepare_admin_authority(
    &mut self,
    source: InvocationSource,
    profile: ServerProfile,
    admission: AdmissionLease,
    wire: &WireAuthorityFields,
    now_ms: u64,
    publication: crate::auth::session_projection::FencedPublication,
) -> SnapbackResult<PreparedAuthority>
```

Target:

```rust
pub fn prepare_admin_authority(
    &mut self,
    source: InvocationSource,
    profile: ServerProfile,
    admission: AdmissionLease,
    wire: &WireAuthorityFields,
    now_ms: u64,
) -> SnapbackResult<AuthorityAssembly>
```

Preserve the exact source allow-list at [`engine.rs:8206`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8206). The factory creates `AdminBypass` with `StreamOnly`; the coordinator derives and binds its current stream.

Disposition: **DERIVE**.

### F213 — operator preparation

Current at [`engine.rs:8234`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8234):

```rust
pub fn prepare_operator_authority(
    &mut self,
    operator: &EngineOperatorAuthority,
    admission: AdmissionLease,
    wire: &WireAuthorityFields,
    now_ms: u64,
    publication: Option<crate::auth::session_projection::FencedPublication>,
) -> SnapbackResult<PreparedAuthority>
```

Target:

```rust
pub fn prepare_operator_authority(
    &mut self,
    operator: &EngineOperatorAuthority,
    admission: AdmissionLease,
    wire: &WireAuthorityFields,
    now_ms: u64,
) -> SnapbackResult<AuthorityAssembly>
```

Derive the authority solely from the admitted mode:

```rust
AuthMode::Dev      => Anonymous + PublicationRequirement::None
AuthMode::Sessions => AdminBypass + PublicationRequirement::StreamOnly
```

Delete the current `(active_mode, publication.as_ref())` authority selection at [`engine.rs:8256`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8256). Sessions composition calls `bind_current_stream`; Dev does not.

Disposition: **DERIVE**.

### F215 — service preparation

Current at [`engine.rs:8307`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8307):

```rust
pub fn prepare_service_authority(
    &mut self,
    resolution: ResolvedServiceAuthority,
    source: InvocationSource,
    active_mode: AuthMode,
    profile: ServerProfile,
    admission: AdmissionLease,
    wire: &WireAuthorityFields,
    now_ms: u64,
    stream_publication: crate::auth::session_projection::FencedPublication,
) -> SnapbackResult<PreparedAuthority>
```

Target:

```rust
pub fn prepare_service_authority(
    &mut self,
    resolution: ResolvedServiceAuthority,
    source: InvocationSource,
    active_mode: AuthMode,
    profile: ServerProfile,
    admission: AdmissionLease,
    wire: &WireAuthorityFields,
    now_ms: u64,
) -> SnapbackResult<AuthorityAssembly>
```

Extend the opaque `ResolvedServiceAuthority` at [`engine.rs:3368`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:3368) to contain:

- The resolved service authority.
- Its service publication.
- The pre-durable-resolution stream publication.
- The registry/database binding that produced the service publication.

Both service resolvers—[`engine.rs:5224`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5224) and [`engine.rs:5383`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:5383)—must accept the opaque pre-captured stream carrier and return this single bundle. `prepare_service_authority` consumes the bundle; it never sees independently supplied publication halves.

Disposition: **DERIVE** at F215.

There is one necessary **VERIFY** seam before bundle creation: the coordinator owns the live stream while SQLite/Local owns scoped-token resolution, and the stream must be captured before the SQLite lookup to preserve the reset race ordering documented at [`server.rs:13372`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13372). The resolver must compare the captured stream incarnation/graph binding to the Local database’s installed stream before producing `ResolvedServiceAuthority`. This cross-owner join cannot be derived by either owner alone without moving ownership of the coordinator or database.

## Exact seal points

The principal HTTP seal goes immediately after caller attribution and immediately before request extension insertion: between [`server.rs:16598`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:16598) and [`server.rs:16600`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:16600).

`prepare_registered_route_authority` at [`server.rs:13203`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13203) therefore returns `Option<AuthorityAssembly>`. The poll-witness and attribution functions used before the seal accept an immutable `AuthorityView` implemented by both assembly and sealed types. Caller attribution, currently documented as non-authoritative at [`invocation.rs:1233`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:1233), moves onto `AuthorityAssembly`; no attribution method remains on `PreparedAuthority`.

Other production seals:

- Pending effects: attach attribution at [`effects.rs:191`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/effects.rs:191), then seal before the return at line 198.
- Cron staging: seal after root construction at [`engine.rs:23215`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:23215), before `prepare_function` at line 23224.
- Job staging: rehearsal binding completes at [`engine.rs:23249`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:23249); seal between lines 23259 and 23260.
- Cron drain: seal the assembly created at [`engine.rs:28242`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:28242) before `prepare_function`.
- Watch execution: attribution at [`engine.rs:25453`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:25453), then seal before returning at line 25456.
- Retained live rerun: rebuild the assembly, restore its opaque retained service/rehearsal carriers, then seal before returning from [`invocation.rs:2457`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:2457).
- Branch operation, bundle evaluation, and Dev live subscribe/unsubscribe/resume roots at [`engine.rs:11113`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:11113), [`engine.rs:19606`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:19606), [`engine.rs:20266`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:20266), [`engine.rs:21581`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:21581), and [`engine.rs:22028`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:22028): seal immediately before the first consumer requiring `PreparedAuthority`.
- Read-lane Dev preparation at [`engine.rs:32729`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:32729) returns an assembly to HTTP composition; HTTP performs the final seal.

`RehearsalAuthorityBinding::bind`, currently public at [`invocation.rs:1745`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:1745), becomes:

```rust
pub fn bind(
    &self,
    authority: AuthorityAssembly,
    deferred: Option<DeferredRehearsalAuthority>,
) -> SnapbackResult<AuthorityAssembly>
```

Its two production callers remain before their respective seals: [`server.rs:13561`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13561) and [`engine.rs:23250`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:23250).

## Complete attachment-call migration

Production `with_fenced_publication` sites:

- [`coordinator.rs:552`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:552): consume `PreparedBearerAuthority` into a session-correlated assembly.
- [`engine.rs:8146`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8146): delete; F210 sets a requirement only.
- [`engine.rs:8231`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8231): delete; coordinator binds the current stream.
- [`engine.rs:8279`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8279): delete; derive requirement from mode.
- [`engine.rs:8329`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8329): consume the opaque service-resolution bundle.
- [`server.rs:16523`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:16523): delete the entire late augmentation block. Derive the carrier from the same prepared connection act/open during route assembly.

Production `with_service_publication` sites:

- [`invocation.rs:2473`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:2473): retained live authority stores/restores an opaque correlated service carrier, then seals.
- [`engine.rs:8330`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8330): consume the opaque service bundle.
- [`engine.rs:8354`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:8354): connection service preparation consumes an opaque connection-service bundle.
- [`server.rs:16527`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:16527): delete with the late augmentation block.

Bootstrap’s raw incarnation setter at [`coordinator.rs:1871`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1871) becomes an assembly-only `bind_installed_stream`. Its server caller remains at [`server.rs:13551`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13551).

Caller-attribution calls at [`server.rs:16583`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:16583), [`server.rs:16598`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:16598), [`effects.rs:191`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/effects.rs:191), and [`engine.rs:25453`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:25453) change to assembly-only calls.

Every current test attachment must stop creating a root and bolting on a raw carrier:

- Fenced attachments: [`stream_attempt.rs:1659`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/stream_attempt.rs:1659), [`coordinator.rs:3450`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:3450), and server tests at lines [5491](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:5491), [8526](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:8526), [9365](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:9365), [9892](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:9892), [10006](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:10006), [22946](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:22946), [24169](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:24169), [33798](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:33798), [33996](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:33996), and [35088](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:35088).
- Service attachments: [`stream_attempt.rs:1674`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/stream_attempt.rs:1674); server tests at [9366](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:9366), [30325](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:30325), [30555](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:30555), and [31563](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:31563); engine tests at [15705](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/tests/engine.rs:15705), [26063](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/tests/engine.rs:26063), [28055](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/tests/engine.rs:28055), and [28095](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/tests/engine.rs:28095).

Replace these with genuine coordinator/database resolution fixtures. Do not preserve convenience helpers that reconstruct public session or scoped-token structs.

## Anonymous publication on session authority

It must be refused. There is no legitimate production flow.

Production anonymous-publication callers checked:

- Operator and admin stream carriers: [`server.rs:13326`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13326) and [`server.rs:13339`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13339).
- Service pre-resolution stream capture: [`server.rs:13382`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13382).
- Optional-auth anonymous route: [`server.rs:13456`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13456), prepared at [`server.rs:13484`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13484).
- Pending-effect anonymous and service capture: [`effects.rs:86`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/effects.rs:86) and [`effects.rs:127`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/effects.rs:127).
- Connection-open stream capture: [`server.rs:18169`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:18169).

Session routes instead obtain `PreparedBearerAuthority` at [`server.rs:13434`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13434); the coordinator creates the resolved session and its publication together at [`coordinator.rs:1976`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/coordinator.rs:1976). No production flow requires replacing that session publication with an anonymous one.

After implementation, the public mismatch is impossible because no API accepts a raw publication. The crate-private assembly verifier must still return `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` for `Session + StreamOnly`, in both lexical directions.

## Service-fence registry closure

Current holes:

- Public `ServiceAuthorityFenceRegistry: Default` at [`service_fence.rs:657`](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:657).
- Public `register(ServiceAuthorityWitness, …)` at [`service_fence.rs:821`](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:821).
- Public witness fields at [`service_authority_contract.rs:18`](/Users/ccheever/projects/snapback/crates/snapback-types/src/auth/service_authority_contract.rs:18).
- Public `ResolvedScopedToken` fields and witness projection at [`auth_agent_credentials.rs:82`](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/auth_agent_credentials.rs:82).
- Database interlock installation silently replaces an existing interlock at [`storage.rs:3433`](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:3433).

Implement:

```rust
impl ServiceAuthorityFenceRegistry {
    pub fn install_for_database(
        db: &mut ServingDatabase,
    ) -> SnapbackResult<Self>;

    pub fn register_resolved(
        &self,
        resolved: &ResolvedScopedToken,
        validated_at_ms: u64,
        monotonic_now: Instant,
    ) -> SnapbackResult<RegisteredServiceAuthority>;
}
```

- Remove `Default`.
- Keep the raw constructor and raw `register` private.
- `install_for_database` stores the database’s opaque `DatabaseBinding`, constructs the interlock, installs it, and only then returns the registry.
- Change kernel installation to refuse when `service_authority_fences` is already `Some`; reuse `SNAPBACK_KERNEL_COMMIT_AUTHORITY_INVALID` with an exact “already installed” message.
- Add the same private database binding to `ResolvedScopedToken` and the registered service carrier. `register_resolved` refuses a token resolved by another database.
- Make every `ResolvedScopedToken` field private and add read-only getters. Do not add `new`, `Default`, `From<parts>`, deserialization, or a public parts struct.
- Move `ServiceAuthorityWitness` to the kernel-owned resolved-token module, with private fields. Move `ServiceAuthorityActResolution`, which contains the witness, upward into `snapback-auth`. This respects dependency direction: `snapback-auth` already depends on `snapback-kernel`; the kernel must not depend upward.
- Remove caller-visible witness construction and `ResolvedScopedToken::service_authority_witness`.
- `ResolvedServiceAuthority::synthetic_for_test` must be `#[cfg(test)]`, not public under a shippable `test-support` feature.

Afterward, caller code cannot construct a witness in safe production Rust: the fields and constructors are private. That is “impossible through the public API,” not merely “no constructor was found.” A caller can install a legitimate registry for its own database, but the binding checks and opaque service bundle make its publication impossible to attach to a different Local database’s authority.

## Ordering and concurrent-lane collision

The first landing prerequisite is not one of these rows: Q09/Q11 and C001/C005 must close authority provenance. Today callers can construct `ResolvedAppAuthority::Session` through public fields at [`invocation.rs:327`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:327), feed it to public `prepare_admitted_authority` at [`invocation.rs:2714`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:2714), and manufacture sessions-mode leases through the surfaces identified in the prerequisite issue. The issue explicitly makes that work prerequisite at [`authority-provenance…md:27`](/Users/ccheever/projects/snapback/issues/shelved/20260824-authority-provenance-is-a-prerequisite-not-a-peer.md:27).

There is therefore a direct collision with a concurrent lane sealing `ResolvedAppAuthority`:

- That lane owns the replacement for public `ResolvedAppAuthority` construction, `prepare_admitted_authority`, and manufacturable admission leases.
- Q01 must consume its opaque resolved-authority/provenance token when constructing `AuthorityAssembly`.
- Q01 must not add a parallel public constructor, temporary session-parts type, or second graph identity.
- Work that can proceed independently before rebase is limited to `FencedPublication` correlation metadata, registry installation/witness closure, opaque connection carriers, and tests.

Within Q01, **F127 is the first row**: introduce `AuthorityAssembly`/`PreparedAuthority`, the private verifier, and delete generic attachment. Then migrate F210/F212/F213, then F215 plus the registry closure, then remove late server augmentation and enable sealing.

These should ship as one atomic capability change, even if developed as stacked commits:

- Sealing first breaks every current late publication and rehearsal attachment.
- F210/F212/F213 first leaves public F127 as a bypass.
- F215 without registry/witness closure still accepts a publication produced by an independent forgeable registry.
- Registry closure without migrating service fixtures breaks Local construction and current tests.
- Removing F127 by itself causes compile failures at every attachment site listed above.
- Q02’s planned installed-stream binding also touches coordinator/invocation assembly. Q01 should land first; Q02 rebases onto `AuthorityAssembly::bind_installed_stream` rather than restoring a setter.

## Required tests

All five rows use one real two-subject fixture:

- Subject A identifiers start with `aaa-`.
- Subject Z identifiers start with `zzz-`.
- They have distinct session IDs, users, providers, generations, authority-instance IDs, service tokens, grants, credentials, and stream/registry origins.
- A and Z must both execute accepted writes with different literal item IDs and values.
- Every mismatch is exercised A-authority/Z-carrier and Z-authority/A-carrier, killing lexical-order substitutions.

Add an in-module test-only malformed-binding hook that invokes the private verifier. Do not expose it through `test-support`.

### F127

Accepted set:

- Session A + session A publication.
- Session Z + session Z publication.
- Sessions Anonymous + current stream-only carrier.
- AdminBypass + current stream-only carrier.
- Service A + current stream + service A carrier.
- Service Z + current stream + service Z carrier.
- Dev authority + no publication.

Refused set:

- Session A/Z and Z/A.
- Session + stream-only.
- Anonymous/Admin + either session carrier.
- Service A/Z and Z/A.
- Wrong stream origin/incarnation.
- Missing required publication.
- Duplicate attachment or attempted replacement.
- Any publication on a class with `PublicationRequirement::None`.

Watched fail-first: under current code, prepare session A, attach session Z using `with_fenced_publication`, revoke or expire only A while Z remains live, then execute a mutation. The watched failure must show that the expected refusal failed because the write committed. Record the literal test output in the landing evidence.

Final structural test: a `compile_fail` doctest attempts to call `PreparedAuthority::with_fenced_publication`; it must fail because no such method exists.

Durable proof: execute a fixture mutation inserting literal rows into `items`; scan and compare the exact sorted row values. Also read exact `_auth_sessions` and `_auth_session_tokens` rows to prove only the intentionally ended session changed.

### F210

Accepted:

- Dev anonymous with no publication.
- Sessions anonymous with the current stream-only carrier.

Refused:

- Sessions anonymous with no carrier.
- Stale or foreign stream.
- Either A or Z session publication.
- Duplicate stream binding.

Exercise both production callers: optional-auth HTTP at [`server.rs:13484`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server.rs:13484) and pending-effect reconstruction at [`effects.rs:160`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/effects.rs:160). Read exact `items` rows after each accepted/refused case.

### F212

Accepted:

- Every existing allowed admin source with the current stream-only carrier.

Refused:

- Missing, stale, or foreign stream.
- Session A and session Z carriers.
- Every existing disallowed source remains refused with `SNAPBACK_INVOCATION_SOURCE_INVALID`.

Run at least `HostOperationFunctionRun` and `DirectAdminRunner` through real mutation execution. Read exact `items` rows, not a count.

### F213

Accepted:

- Dev operator + no publication.
- Sessions operator + current stream-only carrier.

Refused:

- Dev operator + any publication.
- Sessions operator + none.
- Sessions operator + session A or session Z carrier.
- Foreign/stale stream.
- Operator capability belonging to another engine graph remains refused.

Use a real operator mutation such as the integration-suspension path around [`engine.rs:6513`](/Users/ccheever/projects/snapback/crates/snapback-engine/src/local/engine.rs:6513). Read the exact `_snapback_integration_records` rows and prove unrelated grant/token rows remain byte-identical.

### F215

Create two real scoped-token authorities through durable credential/grant/token APIs; do not instantiate `ResolvedScopedToken`.

Accepted:

- Service A with A’s stream and registered service carrier.
- Service Z with Z’s corresponding carrier.

Refused:

- A/Z and Z/A service carrier swaps.
- Correct service carrier with wrong stream origin.
- Correct stream with wrong registry/database origin.
- Session publication as stream half.
- Missing stream half or service half.
- Revoked/expired A with still-live Z carrier.
- Attempted duplicate registry installation.

Watched fail-first: using current APIs, construct `ServiceAuthorityFenceRegistry::default`, build a caller witness, register it, attach the publication to a separately resolved service authority, revoke the real token, and attempt a durable write. The current code should commit or reach the wrong fence; capture that literal failure.

Final structural tests:

- `compile_fail` for `ServiceAuthorityFenceRegistry::default`.
- `compile_fail` for caller construction of `ServiceAuthorityWitness`.
- `compile_fail` for caller construction of `ResolvedScopedToken`.
- Runtime internal-origin test proving the private verifier rejects a genuine carrier from another installed database.

Extend the real finite-authority fixture at [`server/tests.rs:7529`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:7529). Replace its count-only helper at [`server/tests.rs:7707`](/Users/ccheever/projects/snapback/crates/snapback-server/src/server/tests.rs:7707) with exact sorted row reads. Assert exact `items`, `_auth_grant_tokens`, `_auth_grants`, `_auth_agent_credentials`, and integration records.

### Assertion-provenance audit

The landing report must inventory every expected value:

- Item IDs, values, user IDs, session IDs, token IDs, grant IDs, and diagnostic codes come from literals fixed before invoking production code.
- Expected hashes/digests, if any, are computed independently from test-selected inputs.
- Untouched-row expectations may come from a pre-operation snapshot, but the report must say so explicitly.
- No expected subject, carrier key, or stored value may come from `authority.resolved()`, publication getters, the post-operation database row, or another value returned by the production path under test.
- A and Z accepted outputs must differ. This prevents replacing a derivation with a constant.
- Never use an observed stored value to build its own expectation; that is the `stored == stored` defect documented at [`assertion-provenance…md:14`](/Users/ccheever/projects/snapback/issues/shelved/20260824-assertion-provenance-is-the-recurring-test-defect.md:14).

### Mutation review

Manually apply or reason through, and record kills for:

- Remove each correlation field comparison individually.
- `==` → `!=`, `<`, `<=`, `>`, or `>=`.
- A field compared with itself.
- A-side field compared with the wrong Z-side field.
- `&&` → `||`.
- Treat `StreamOnly` as `Session`, or vice versa.
- Skip stream origin or registry/database origin.
- Permit missing carrier.
- Permit duplicate binding or last-write-wins replacement.
- Move `seal` before rehearsal/publication binding.
- Reintroduce any attachment method on `PreparedAuthority`.
- Restore registry `Default`, raw `register`, public witness fields, or interlock replacement.

Both `aaa < zzz` and `zzz > aaa` attack directions must fail so lexical-order mutations cannot survive.

Before running Rust tests, the coding agent should run `scripts/bootstrap-ibex-runtime`. After affected tests, run `./ref-check --verbose` and `node scripts/check-inventories.mjs`; moving these Rust sites changes the generated diagnostics registry even if no diagnostic code is added.

## Matters not safely decided by Q01

Q01 does not decide whether `RevalidatedPrincipal`, `System`, watch reruns, or bearer-free asset callbacks must begin carrying global stream publications. Current code explicitly allows some sessions-mode internal invocations to omit them at [`invocation.rs:1925`](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:1925). Preserve that accepted set; making those publications mandatory needs a separate decision.

Q01 also does not change the authentication semantics of `AdminBypass` or operator commands. It only restricts them to a stream-only carrier from the same graph.

Everything else in these five rows is decided by LLP 0303. The service work overlaps other registry/closure rows and the authority assembly overlaps the provenance lane, but those are ownership/landing-coordination conflicts, not unresolved product rules.