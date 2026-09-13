# Closing the Snapback kernel authorization model (LLP 0283 F-1)

**Status:** design proposal, independent of the three prior fix attempts
**Scope:** `crates/snapback-kernel`, `crates/snapback-auth`, `crates/snapback-services`,
`crates/snapback-engine`, `crates/snapback-cli`, `crates/allowed-dependencies.v1.json`,
`scripts/check-workspace-graph.mjs`
**Author's caveat:** nothing here was compiled — every claim about what builds comes from
reading the source. Steps 1–3 of the migration exist specifically to falsify that early.
See Risk 7.

**Two corrections to the brief, both found by enumeration and both making the defect
worse than described.** (a) Defect 3 has **four** launderer crates and 33 sites, not two —
`snapback` and `snapback-server` are also consumers (§2.3). (b) The
`join_kernel_commit_authority_for_test` seam is reached from
`LocalSnapback::open_commit_graph_sibling_for_test`, which is `#[cfg(feature =
"test-support")]` and **clones the authority** — a public, feature-selectable API that
opens a second writable handle onto a serving store's authority graph (§3).

---

## 0. Why the previous three attempts failed (the diagnosis this design is built on)

Rust gives exactly three primitives that make a capability **unrepresentable** across a
crate boundary:

1. **Non-`pub` items** — unnameable outside the defining crate.
2. **Private fields with no public constructor** — a value can only be *received*, never
   *made*.
3. **Non-duplicability** — no `Clone`, `Copy`, `Default`, `Deserialize`, `From`, `FromStr`.

There is no `pub(crate X)`, no `friend`, and Cargo features are additive and
caller-selected. Two corollaries follow, and both were missed:

**Corollary A — façade curation is not a security mechanism here.** Every workspace crate
of rank ≥ 1 has a *direct* `snapback-kernel` dependency edge
(`crates/allowed-dependencies.v1.json`: auth, activation, services, sync, engine, server,
cli, snapback, conformance, tools all list `snapback-kernel`). So any `pub` item in the
kernel is reachable by eleven crates regardless of what `snapback-auth/src/lib.rs:9` or
`crates/snapback/src/lib.rs` re-export. Removing the wholesale `pub use ... storage` is
correct hygiene, but it closes nothing inside this workspace. Attempts that consisted
mostly of re-export narrowing could not have worked.

**Corollary B — after the fix, each capability must satisfy one of exactly two
conditions.** Either

- **(i)** it is `pub(crate)` in the kernel and its former cross-crate users have moved
  inside the kernel; or
- **(ii)** it is `pub`, but exercising it confers **no authority the caller did not
  already have**, because every security-relevant fact is re-derived by the kernel from
  durable state inside the same transaction. The "authority" then degenerates into a
  routing/binding token, and its reachability stops mattering.

A design that is neither (i) nor (ii) is a restatement of the failed attempts, however
opaque its carriers are. The three attempts all produced opaque carriers minted from
caller-supplied facts — the carrier laundered the assertion instead of removing it.

**The structural mistake that made the root spread.** `KernelCommitAuthority`
(`crates/snapback-kernel/src/storage.rs:536`) is doing three unrelated jobs:

| Job | Field | Privileged? | How widely needed |
| --- | --- | --- | --- |
| **Binding** — "this carrier belongs to database X" | `identity: Arc<()>` | No | ~15 sites: `ReadLane`, `execute_query_invocation`, every `is_for` check |
| **Exclusivity** — take-once per file identity | `_lease` | No (ordering/DoS only) | 1 site |
| **Fact assertion** — `admit_system_push`, `admit_protected_record_erasure(12 args)`, `admit_pending_effect_decision(approver, approve, requires_step_up)` | none | **Yes, and unverified** | ~5 sites |

The binding job is why the value had to be `Clone` and had to be threaded to twenty
call sites; the fact-assertion job is the actual privilege. Conflating them forced the
root to be broadly public. **Splitting them shrinks the privileged root to something
small enough to make `pub(crate)`** — and that, plus the one-production-caller fact, is
what makes this design cheap.

---

## 1. Threat model

### Attacker A — a direct dependent crate inside this workspace (live today)

Any of `snapback-auth`, `-activation`, `-services`, `-sync`, `-engine`, `-server`,
`-cli`, `-tools`, `-conformance`, `snapback`, or any crate added to `crates/*` later
(`Cargo.toml` members is `crates/*`).

**Can:** name and call any `pub` item in `snapback-kernel`; enable any Cargo feature of
any crate it depends on, including `snapback-kernel/test-support` and
`snapback-services/remainder-tests`; open its own SQLite files with its own rusqlite (if
allowed) or a laundered one; construct any type with all-public fields; implement any
non-sealed public trait; clone any `Clone` value it receives.

**Cannot:** name a `pub(crate)` item; construct a struct that has even one private field
and no public constructor; write an inherent `impl` for a type defined in another crate
(`issues/shelved/20260818-inherent-impl-blocks-owner-based-carves.md`); add a workspace
dependency edge or an external crate outside `externalConfinement` without editing
**two** committed artifacts that `scripts/check-workspace-graph.mjs` compares against
each other (`crates/allowed-dependencies.v1.json` and the duplicated `EXPECTED_CRATES` /
`EXPECTED_CONFINEMENT` literals at lines 17–39).

This is the binding threat. All three defects are exploitable by A today.

### Attacker B — a future third-party crate depending on published packages

**Does not currently exist.** All thirteen members set `publish = false`, and the gate
asserts it (`scripts/check-workspace-graph.mjs:921`); the npm runtime packages carry a
sealed binary rather than Rust source. B is a *forward-looking* constraint that justifies
façade hygiene (defect 1d), but it must not be the design driver — designing for B is
exactly what produced three rounds of re-export narrowing while A stayed fully armed.

### Attacker C — a future module inside an already-trusted crate (the one that actually matters)

Most of Snapback's own code lives above the kernel. The property worth buying is that a
well-intentioned `snapback-engine` or `snapback-services` module **cannot accidentally
cause the kernel to durably record an authority fact the kernel did not verify** — a
forged approver on a pending effect, a fabricated credential digest on a protected-record
erasure, a self-declared `System` push. No visibility change addresses C. Only
"the kernel derives, never accepts" does. C is why §2.1b is the load-bearing part of this
design and §2.1a is merely the cheap part.

### Explicit non-threats (state these so nothing is designed around them)

- **A process that already holds the SQLite file has full write access.** The kernel
  cannot defend against that and must not pretend to. Therefore obtaining a commit
  authority for a database *you opened yourself* is not an escalation, and a design that
  makes that harmless is a complete design.
- **The take-once lease registry is ordering, not authorization.** Agreed with the
  reviewers. Nothing in this design's safety argument may depend on it. It stays only to
  prevent a second handle from creating a parallel authority graph for a serving store —
  a correctness/DoS property.

---

## 2. Per-defect closure design

### Preliminary: split binding from authority

Two new/changed types in `crates/snapback-kernel/src/storage.rs`:

```rust
/// Non-privileged proof that a carrier belongs to one database. Clone is
/// correct here: duplicating a binding grants nothing.
#[derive(Clone)]
pub struct DatabaseBinding(Arc<()>);          // field private; no pub constructor

impl LocalDatabase {
    pub fn binding(&self) -> DatabaseBinding;  // the only mint
}

/// The privileged root. No Clone, no Copy, no Default, no Deserialize, no From.
pub(crate) struct KernelCommitAuthority {      // note: pub(crate), not pub
    binding: DatabaseBinding,
    lease: KernelCommitAuthorityLease,         // by value, not Arc<...> — non-duplicable
}
```

Note the lease changes from `Arc<KernelCommitAuthorityLease>` (storage.rs:539) to an
owned value. That is what makes `!Clone` actually mean something: today `Clone` on
`KernelCommitAuthority` is only possible *because* the lease is behind an `Arc`.

Everything that currently threads `&KernelCommitAuthority` purely for identity —
`ReadLane` (`crates/snapback-engine/src/local/engine.rs:29837`),
`execute_query_invocation` (`:34676`), `read_ledger_projection_for_prepared`
(`crates/snapback-engine/src/push.rs:49`), `auth_room_kick_acceptance.rs:1693`, every
`is_for(&Arc<()>)` check in `push.rs:66`, `service_fence.rs:70`,
`pending_effects.rs:268` — takes `&DatabaseBinding` instead. `ReadLane` keeps its
`#[derive(Clone)]` honestly.

---

### Defect 1 — the publicly claimable authority root

#### 1a. Delete the cross-crate root and serve the one production caller directly

`LocalDatabase::claim_kernel_commit_authority` (`storage.rs:2158`) becomes
`pub(crate) fn claim_commit_authority`. `KernelCommitAuthority` becomes `pub(crate)` and
is not re-exported anywhere.

The **one** production caller outside the kernel is
`LocalSnapback::from_database` at `crates/snapback-engine/src/local/engine.rs:24202`. It
is served by a new kernel-owned owning wrapper — not by a new claim seam:

```rust
// crates/snapback-kernel/src/storage/commit_graph.rs   (new file)

/// A database handle that owns its one commit authority. Non-Clone,
/// non-Default, non-Deserialize. There is no accessor for the authority: it
/// can be exercised only through this type's inherent methods, which live in
/// the kernel and therefore verify before they write.
pub struct ServingDatabase {
    db: LocalDatabase,
    authority: KernelCommitAuthority,      // pub(crate) type, private field
}

impl ServingDatabase {
    /// Consumes the handle. Fails if this file identity is already serving.
    pub fn adopt(db: LocalDatabase) -> SnapbackResult<Self>;
    pub fn memory() -> SnapbackResult<Self>;          // open + adopt, for tests
    pub fn binding(&self) -> DatabaseBinding;         // non-privileged
}

impl std::ops::Deref    for ServingDatabase { type Target = LocalDatabase; /* &self.db */ }
impl std::ops::DerefMut for ServingDatabase { /* &mut self.db */ }
```

`LocalSnapback.db` (`engine.rs:3194`) changes type from `LocalDatabase` to
`ServingDatabase`, and the `kernel_commit_authority` field (`:3195`) is **deleted**.

**Why this is cheap:** because of `Deref`/`DerefMut`, every one of the thousands of
`self.db.<method>()` call sites in `engine.rs` compiles unchanged. Only the ~5 sites that
name the authority need edits, and after the binding split (above) most of those became
`DatabaseBinding` sites already.

**`ServingDatabase::adopt` is still `pub` — why is that not the same defect?** Because
after 1b, holding a `ServingDatabase` for a database you opened yourself grants exactly
the powers you already had by holding the file: there is no fact you can assert that the
kernel does not verify. This is Corollary B(ii), applied deliberately. If 1b is not
completed, 1a alone **is** the fourth failed attempt, and should not be shipped as a
closure.

#### 1b. The load-bearing half: admissions stop accepting unverified facts

This is what the previous three attempts never attempted. Per admission:

**(i) `admit_protected_record_erasure` — `crates/snapback-kernel/src/proof_checkpoint.rs:769`**

Today it takes twelve parameters, seven of which are free-form `&str`/`u64` authority
facts that the kernel writes into a durable audit receipt
(`ProtectedRecordErasureReceiptV1`, `:817`) as if verified. Delete the standalone
admission. Replace with an inherent operation on `ServingDatabase` that runs inside the
erasure transaction and derives each fact:

```rust
impl ServingDatabase {
    pub fn erase_protected_record(
        &mut self,
        request: ProtectedRecordErasureWireRequestV1,   // operation_id, qualified_table, row_id — already the wire shape
        principal: &ResolvedPrincipal,                  // kernel-minted; see (ii)
        now_ms: u64,
    ) -> SnapbackResult<ProtectedRecordErasureReceiptV1>;
}
```

| Parameter today | Disposition |
| --- | --- |
| `authorization_stream_incarnation: &str` | **Deleted.** Kernel reads it via `ensure_authorization_stream_incarnation()` (already kernel-owned; engine.rs:24240 calls it). |
| `transition_generation: u64` | **Deleted.** Read from the durable auth-mode row in the same transaction. |
| `credential_class: &str`, `credential_digest_sha256: &str` | **Deleted.** Read from the durable credential row keyed by the resolved principal. |
| `principal_id: &str` | **Replaced** by `&ResolvedPrincipal`. |
| `mode: &str`, `audit_class: &str`, `profile: &str` | **Typed** to kernel enums (`AuthMode`, `ErasureAuditClass`, `ServerProfile`) *and* cross-checked against durable state, so a caller cannot spell a value the store contradicts. |
| `operation_id`, `qualified_table`, `row_id`, `now_ms` | Kept. These are *what to do*, not *who says you may*. |

Net: zero caller-asserted authority facts. `ProtectedRecordErasureRequestV1`
(`proof_checkpoint.rs:758`, currently `#[derive(Clone)]`) loses `Clone` and becomes a
transaction-local value that never leaves the kernel.

**(ii) `ResolvedPrincipal` — the durable proof the reviewers asked for**

```rust
// crates/snapback-kernel/src/auth/session_projection.rs
pub struct ResolvedPrincipal {              // no Clone/Copy/Default/Deserialize/From/FromStr
    binding: DatabaseBinding,
    principal_id: String,
    credential_row_id: i64,
    resolved_at_version: u64,               // store version at resolution
    class: ResolvedPrincipalClass,          // User | InternalService | Anonymous
}
```

The **only** constructors are kernel-internal and each performs a durable read:

```rust
impl LocalDatabase {
    pub fn resolve_principal_from_session(&self, digest: &SessionTokenDigest)
        -> SnapbackResult<ResolvedPrincipal>;
    pub fn resolve_principal_from_credential(&self, /* … */)
        -> SnapbackResult<ResolvedPrincipal>;
}
```

No `ResolvedPrincipal::new`, no `system()`, no `From<&str>`. The mechanism is not the
name: the type has private fields and no public constructor, so a caller can only
*receive* one from a durable resolution. That is what "kernel-verifiable durable proof"
means concretely, and it is the property a gate can check (§5).

**(iii) `admit_system_push` — `crates/snapback-kernel/src/push.rs:43` — the hardest one**

"System" is a *process* fact (this invocation came from a trusted internal lane), not a
durable one, so it cannot be read from a row. Two options:

- *Rejected:* keep `admit_system_push` but require a `ResolvedPrincipal`. Useless — the
  System branch would still be a free choice for any caller who resolved any principal.
- **Chosen:** make System-ness something the kernel **computes** rather than something a
  caller **declares**. Delete `admit_system_push` / `admit_user_push` / `admit_other_push`
  (`push.rs:43–62`) and replace with one constructor:

```rust
impl LocalDatabase {
    pub fn push_authority_for(&self, principal: Option<&ResolvedPrincipal>)
        -> SnapbackResult<PushStorageAuthority>;
}
```

`PushStorageAuthorityKind::System` is selected **iff** `principal` is `Some` and its
`class == ResolvedPrincipalClass::InternalService` — and `InternalService` is reachable
only by resolving the durable internal-service principal row. The shape is already
precedented: `AssetCallbacksServicePrincipal` at
`crates/snapback-sync/src/auth/invocation.rs:1203` is described in-comment as having
"durable principal/grant authority but deliberately no credential/token carrier" and
"never inferred from ids or names" — this generalizes that to every System path.

`admitted_push_storage_authority` (`crates/snapback-engine/src/push.rs:31`) then maps
`PreparedAuthority` → `ResolvedPrincipal` rather than → a free choice of variant.

**Honest sizing.** This is the largest sub-item and the one most likely to need an author
ruling. If any production lane reaches `ResolvedAppAuthority::System` *without* a durable
internal-service credential — dev mode, cron, internal asset callbacks are the candidates
— then closing (iii) properly means giving those lanes a durable service-principal row.
If that requires a new table, it is a `schemas/` change, and **zero `schemas/` drift is a
required invariant**, so it needs its own decision before this plan is committed to. See
Risk 1.

**(iv) Pending effects — `crates/snapback-kernel/src/storage/pending_effects.rs:210–268`**

- `admit_pending_effect_decision(id, approver_principal_id: &str, approve,
  requires_step_up: bool, step_up, now_ms)`:
  - `approver_principal_id: &str` → `&ResolvedPrincipal`;
  - **`requires_step_up: bool` deleted.** Today a caller asserting `false` is a complete
    bypass of step-up on a human-approval gate. After the change the parameter does not
    exist: the kernel reads the effect row's declared policy inside the transaction. This
    is the single highest-value item in the whole plan and the cheapest to land.
- `admit_pending_effect_creation(CreatePendingEffect)`: `authority: PendingEffectAuthority`
  and `approver_principal_id: Option<String>` become `ResolvedPrincipal`-derived.
- The four `*Command` types (`Create/Decide/Settle/RefusePendingEffectCommand`) lose their
  public constructors; they are produced by `ServingDatabase` inherent methods, which live
  in the kernel and therefore satisfy the inherent-impl rule.

#### 1c. Non-duplicability

Remove `#[derive(Clone)]` from:

| Type | Location |
| --- | --- |
| `KernelCommitAuthority` | `crates/snapback-kernel/src/storage.rs:535` |
| `AuthorizationCommitCarrierFactory` | `crates/snapback-kernel/src/storage.rs:722` |
| `ServiceAuthorityTerminalFactory` | `crates/snapback-kernel/src/auth/service_fence.rs:36` |
| `ServiceAuthorityCommitInterlock` | `crates/snapback-kernel/src/auth/service_fence.rs:62` |
| `PushStorageAuthority` | `crates/snapback-kernel/src/push.rs:29` |
| `ProtectedRecordErasureRequestV1` | `crates/snapback-kernel/src/proof_checkpoint.rs:757` |

Remove `Default` from `RecordingServiceAuthorityCommitInterlock`
(`service_fence.rs:127`) and from `AuthorizationReservationCancellation`
(`storage.rs:778`) unless duplicability there is argued explicitly. None of these derives
`Deserialize` today; §5 asserts none gains one.

#### 1d. Re-export hygiene — necessary, not sufficient

Delete `storage` from `crates/snapback-auth/src/lib.rs:9`'s `pub use`; narrow to the
specific items auth needs. Narrow `crates/snapback-engine/src/lib.rs:12–16`'s `storage`
the same way. State plainly in the commit message: **this changes nothing about
workspace-internal reachability** (Corollary A). It matters for the eventual published
surface (Attacker B) and it makes the gate's job tractable. It is not the fix.

---

### Defect 2 — public arbitrary-closure factories

Both sub-defects fall to **one rule**, which is why I prefer it to any allowlist:

> **No `pub fn`, public associated fn, or public struct field in `snapback-kernel` may
> have a type mentioning `dyn Fn`, `dyn FnMut`, `dyn FnOnce`, or an `impl Fn*` bound.**

A closure parameter on a kernel API *is* a self-implementable capability trait wearing a
different hat. That is exactly the equivalence LLP 0283 §F-1(2) identifies, and the rule
above makes the whole class unrepresentable rather than enumerating the current
instances.

#### 2a. `AuthorizationCommitCarrierFactory::{reservation, prepared}` — `storage.rs:745, 765`

**Verified consumer chain.** `crates/snapback-engine/src/local/engine.rs:24355` hands the
factory to `LocalEphemeralBackend::install_authorization_commit_carriers`
(`crates/snapback-sync/src/ephemeral.rs:4417`), which stores it in
`commit_carriers: Arc<RwLock<Option<AuthorizationCommitCarrierFactory>>>`
(`ephemeral.rs:4074`) and mints from it in `reserve_authorization_commit`
(`ephemeral.rs:4603–4686`) and `opaque_prepared_authorization_commit`
(`ephemeral.rs:4314–4337`). Second install site:
`crates/snapback-engine/src/local/auth_room_kick_acceptance.rs:1691`.

This is **structurally identical to defect 2b**: a `snapback-sync`-owned concrete value —
`RoomAuthorizationCommitReservation { backend, ticket: RoomDependencyTicket,
reserved_selector: RoomDependencySelector, collections, issuer_expectation,
collection_generation, rollback_on_drop }` (`ephemeral.rs:4664`) — is smuggled across the
crate boundary inside three boxed closures, because the kernel's API has no way to name
it. The closures are pure transport. Recognizing that both defect-2 sub-cases are the
same laundering pattern is what makes one rule sufficient for both.

Closure, in two parts:

1. `AuthorizationCommitCarrierFactory`, `AuthorizationCommitReservation::install`,
   `ManagedAuthorizationReservationScope`, and the `MANAGED_AUTHORIZATION_RESERVATION`
   thread-local (`storage.rs:722–812`) all become `pub(crate)`. The interlock path itself
   is *already* kernel-internal (`prepare_authorization_commit_interlock` /
   `commit_with_authorization_interlock`, `storage.rs:~830`).
2. Move the **room-dependency ticket machinery** — `RoomAuthorityRegistry`,
   `RoomDependencyTicket`, `RoomDependencySelector`, `prepare_unbound`, and the
   `finish_room_authorization_commit` settlement (`ephemeral.rs:4074, 4655, 4689`) — down
   into `crates/snapback-kernel/src/storage/room_authority.rs`, and give
   `LocalDatabase` a concrete port:

```rust
// crates/snapback-kernel/src/storage/room_authority.rs
pub struct RoomAuthorityRegistry { /* private */ }         // process-local, kernel-owned
pub struct ProtectedRoomSuspensionPlan { /* private: selector, generation, issuer expectation */ }

impl LocalDatabase {
    pub fn install_room_authority(&mut self, registry: &RoomAuthorityRegistry) -> SnapbackResult<()>;
}
impl RoomAuthorityRegistry {
    pub fn plan(&self, preflight: AuthorizationCommitPreflight) -> SnapbackResult<ProtectedRoomSuspensionPlan>;
}
```

The kernel then premarks and settles against the plan itself, inside
`commit_with_authorization_interlock`. No `impl Fn` survives, and there is nothing left
for a caller to substitute: `ProtectedRoomSuspensionPlan` has private fields and is minted
only by a registry the kernel installs.

**Honest sizing.** This is ~400–600 lines moving from `snapback-sync` (rank 3) to
`snapback-kernel` (rank 1) — larger than the service-fence move, and a bigger LLP 0225
ownership violation, because room state feels like realtime, not storage. The
counter-argument that I think carries: *the room-dependency ticket exists solely to make a
SQLite commit and a room-suspension premark atomic with respect to each other. That is a
commit interlock. Interlocks belong with the transaction they interlock.* The
`snapback-sync` side keeps everything that is actually realtime — collections, outboxes,
delivery, the invalidation issuer — and calls down for the ticket. If the author rejects
this, the same fallback as 2b applies with the same weakening, and I would say so rather
than ship a closure with a nicer name.

#### 2b. `service_authority_commit_interlock` — `crates/snapback-kernel/src/auth/service_fence.rs:98`

Today: `KernelCommitAuthority::service_authority_commit_interlock(prepare: impl Fn(&[String],
ServiceAuthorityDisposition) -> SnapbackResult<PreparedServiceAuthorityTerminal>)`, installed by
`LocalDatabase::install_service_authority_commit_interlock` (`storage.rs:2294`). A caller
can pass `|_, _| Ok(factory.prepared(|| Ok(()), || {}, || {}))` — the exact shape the
kernel's own `kernel_test_commit_interlock` (`service_fence.rs:118`) uses — and every
service-authority revocation then reports success without fencing anything.

The only production supplier is `ServiceAuthorityFenceRegistry::kernel_commit_interlock`
(`crates/snapback-auth/src/auth/service_fence.rs:1116`).

**Closure: move the fence registry down into `snapback-kernel`.** Target file
`crates/snapback-kernel/src/auth/service_fence.rs` already exists and already owns the
terminal types. Then:

```rust
impl LocalDatabase {
    pub fn install_service_authority_fences(
        &mut self,
        registry: &ServiceAuthorityFenceRegistry,   // concrete kernel type
    ) -> SnapbackResult<()>;
}
```

No callback, no factory. `PreparedServiceAuthorityTerminal`'s three
`Box<dyn Fn…>` fields (`service_fence.rs:11–13`) become plain data
(`ticket: u64`, `domains: Vec<(String, Arc<ServiceAuthorityDomain>)>`), which is what
`PremarkedServiceAuthorityTerminal` in the auth crate already holds
(`snapback-auth/.../service_fence.rs:~1140`) — the closures exist purely to smuggle that
struct across the crate boundary.

**What moves, and what it costs:**

- ~700 lines: `ServiceAuthorityFenceRegistryState`, `ServiceAuthorityFenceRegistry`,
  `ServiceAuthorityDomain`, `install_terminal_intent`, `prepare_terminal`,
  `PremarkedServiceAuthorityTerminal` (`snapback-auth/src/auth/service_fence.rs:565–1140`).
- ~1,400 lines stay in `snapback-auth`: `acquire_terminal_gate`, deadline publication, act
  resolution, `AuthProvider` integration — all policy, all expressible against the
  registry's public API.
- **`tokio::sync::Notify`** (`service_fence.rs:24, 577`) — `snapback-kernel` has no tokio
  dependency and rank 1 being async-free is a property worth defending. Replace `Notify`
  with `std::sync::Condvar` plus the existing `exec_guard` deferral. If the author prefers
  tokio, add `tokio` to `externalConfinement` with the full member list rather than leaving
  it ungoverned — but I recommend Condvar.
- **`Option<Arc<AuthProvider>>`** (`service_fence.rs:80, 237`) is used **purely as a
  clock**. Delete `with_provider_clock` and pass `now_ms: u64` at each call — which is
  already how `prepare_terminal`'s callers work. That removes the last upward reference.

**This violates the LLP 0225 ownership map** ("finite service authority fence" is
auth-substrate) and needs an explicit amendment with this rationale: *the fence mechanism
is a commit interlock — storage machinery — and belongs to the kernel; the policy that
decides which tokens to fence stays in auth-substrate.* Land the amendment in the same
commit as the move.

**Fallback if the author refuses the move.** `install_service_authority_fences` takes a
kernel-defined concrete plan value; the auth crate premarks *before* the kernel call and
settles *after*, using a kernel-returned `CommitOutcome` witness. This still removes every
closure, but it widens the window between premark and commit, which is the exact window
LLP 0053 §ephemeral-room-authority-invalidation exists to close. I would want that
tradeoff decided explicitly rather than chosen by default.

#### 2c. Kill the `test-support`-gated privilege seams (defect 3's failure mode, applied to defect 1 and 2)

Every one of these is compiled into dependents whenever any crate turns the feature on:

| Seam | Location | What it grants |
| --- | --- | --- |
| `AuthorizationCommitCarrierFactory::for_test` | `storage.rs:747` | opens a `LocalDatabase::memory()`, claims authority, returns a factory |
| `AuthorizationCommitReservation::bind_for_test` | `storage.rs:645` | binds the real opaque reservation |
| `PreparedAuthorizationCommit::committed_for_test` / `ambiguous_for_test` | `storage.rs:703, 711` | settles the real carrier |
| `LocalDatabase::join_kernel_commit_authority_for_test` | `storage.rs:2178` | joins a second handle to a serving authority graph |
| `LocalSnapback::open_commit_graph_sibling_for_test` | `crates/snapback-engine/src/local/engine.rs:6129` | **the sharpest one:** opens a second writable `LocalDatabase`, joins it to the serving authority graph, and clones the authority (`:6141`) |
| `LocalSnapback::open_with_asset_store_backend_for_test` | `engine.rs:6118` | lower severity, but same feature-gated pattern; audit with the rest |
| `RecordingServiceAuthorityCommitInterlock` (`Clone + Default`) | `service_fence.rs:126` | a no-op interlock, constructible with `Default::default()` |
| `ServiceAuthorityFenceRegistry::commit_terminal_for_test` | `snapback-auth/.../service_fence.rs:1057` | settles a real terminal |

**Rule: every `test-support`-gated privilege seam becomes `#[cfg(test)]` only** —
unreachable from any other crate at any feature setting — with the cross-crate tests that
needed them relocated per §3.

Mechanically checkable: *no `#[cfg(feature = "test-support")]` item in `snapback-kernel`
may construct, clone, or return any type on the privilege list.*

---

### Defect 3 — the caller-selectable raw-SQLite feature

`crates/snapback-services/src/lib.rs:36–40` (`pub mod test_support { pub use rusqlite; }`)
gated on `remainder-tests` (`crates/snapback-services/Cargo.toml:18`).

**Corrected inventory** (the brief undercounts this; I enumerated it):
**33 import/use sites across 18 files in 4 consumer crates**, not 2.

| Consumer | Dev-dependency line | Sites | Where |
| --- | --- | --- | --- |
| `snapback` | `crates/snapback/Cargo.toml:99` | 9 | `crates/snapback/tests/*.rs` (`instance_fork_disk_pressure_v1`, `instance_fork_bench_v1`, `replication_sustained_v0`, …) |
| `snapback-server` | `crates/snapback-server/Cargo.toml:63` | 4 | `src/auth/runtime.rs:703`, `src/auth/recovery.rs:498`, `src/server/tests.rs:19`, `src/auth/backup_confined_tests.rs:9` |
| `snapback-engine` | `crates/snapback-engine/Cargo.toml:50` | 3 | `src/host_ops.rs:2401`, `src/push/authority_tests.rs:11`, `src/local/tests/engine.rs:2` |
| `snapback-cli` | `crates/snapback-cli/Cargo.toml:37` | 2 files / 8 sites | `src/store_state.rs:1123`, `src/cli/tests.rs` (×7) |

Two consequences the brief's smaller inventory hides:

- **`snapback-server` is also a launderer**, and it is not in `externalConfinement`
  either. Any plan that fixes only engine and cli leaves the hole open.
- **9 of the 33 sites are already in `crates/snapback/tests/`** — real integration tests,
  already structurally in the right place. They do not need to move at all; they need
  `snapback` to carry its own `rusqlite` dev-dependency and to be added to
  `externalConfinement.rusqlite.allowedMembers`. That is a *visible* edge in
  `cargo metadata`, which is the whole point.

**Name what this actually is first.** `cargo metadata --no-deps` reports dev-dependencies
in `member.dependencies`, and `scripts/check-workspace-graph.mjs:945` collapses all
dependency kinds into one set before the `externalConfinement` check. So a *direct*
`rusqlite` dev-dependency on `snapback-engine` **would already fail the existing gate**.
`remainder-tests` exists precisely because of that: it is a **confinement-laundering
device**, obtaining rusqlite for the engine and CLI through a crate that is allowed to
have it. This matters because it rules out the obvious "fix": adding rusqlite to the
engine's dev-deps is the same violation with the fig leaf removed.

#### 3a. Remove the *need* to name `rusqlite` above the kernel (preferred)

The known consumers and what each is actually reaching for:

- **`crates/snapback-engine/src/push/authority_tests.rs:11, 53`** — imports
  `snapback_services::test_support::rusqlite` solely to spell `&rusqlite::Transaction<'_>`
  in a helper that calls `snapback_kernel::push::test_support::authorize_send_in`. Fix:
  change the kernel test-support entry point to hand out a kernel-owned scoped guard:

  ```rust
  // crates/snapback-kernel/src/push.rs, behind a kernel-owned harness cfg
  pub struct PushAuthorizationProbe<'a> { tx: rusqlite::Transaction<'a> }  // field private
  impl<'a> PushAuthorizationProbe<'a> {
      pub fn authorize_send(&self, /* … */) -> SnapbackResult<()>;
  }
  impl LocalDatabase {
      pub fn push_authorization_probe(&mut self) -> SnapbackResult<PushAuthorizationProbe<'_>>;
  }
  ```
  `Drop` rolls back. The caller never names `rusqlite`. Use a **returned guard, not a
  closure**, so this does not need an exemption from §2's no-closure rule.

- **`crates/snapback-cli/src/cli/tests.rs` (×7) and `crates/snapback-cli/src/store_state.rs:1123`**
  open `rusqlite::Connection` directly against telemetry/canonical database *files* to
  assert row state. These are the least defensible sites: they are unit tests inside a
  rank-6 crate reaching past every abstraction to raw SQL. They go to §2.3c, not to a probe.
- **`crates/snapback-engine/src/host_ops.rs:2401`,
  `crates/snapback-engine/src/local/tests/engine.rs:2`,
  `crates/snapback-server/src/auth/runtime.rs:703`,
  `crates/snapback-server/src/auth/recovery.rs:498`,
  `crates/snapback-server/src/server/tests.rs:19`,
  `crates/snapback-server/src/auth/backup_confined_tests.rs:9`** — for each, identify the
  one kernel or services operation the test is reaching for and publish a typed,
  harness-gated probe for it, or send it to §2.3c.

#### 3b. The 9 sites already in the right place

`crates/snapback/tests/*.rs` are integration tests. Give `snapback` its own
`rusqlite` **dev-dependency** and add `"snapback"` to
`externalConfinement.rusqlite.allowedMembers` (plus the mirrored literal at
`scripts/check-workspace-graph.mjs:37`). No code moves. The dependency becomes visible in
`cargo metadata` instead of arriving through a feature flag on an unrelated crate — which
is the entire security delta.

#### 3c. For the residue: a real harness crate

```
crates/snapback-harness/          # new, publish = false
  Cargo.toml     [dev-dependencies] rusqlite, tempfile
                 [dependencies]     snapback-engine, snapback-kernel, snapback-server, snapback-services
  tests/*.rs     the relocated raw-SQL assertions from cli/, engine/, server/
```

Amendments required (both files, because the gate compares them against each other):

- `crates/allowed-dependencies.v1.json`: add
  `{ "name": "snapback-harness", "owner": "proof-harness", "rank": 7,
  "allowedWorkspaceDependencies": ["snapback-auth","snapback-engine","snapback-kernel","snapback-server","snapback-services","snapback-types"] }`,
  and add `"snapback"` and `"snapback-harness"` to
  `externalConfinement.rusqlite.allowedMembers`.
- `scripts/check-workspace-graph.mjs`: the same rows in the duplicated `EXPECTED_CRATES`
  (line 17) and `EXPECTED_CONFINEMENT` (line 33) literals.

*Why a new crate rather than folding into `snapback-conformance` (rank 7, owner
`proof-harness`)?* LLP 0283 §F-2 records that conformance "is named in metadata but is
absent from actual dependencies" — its wiring is already suspect. I would rather create a
crate whose sole purpose is raw-SQL-level verification, with a visible rusqlite edge, than
quietly widen a crate whose integrity is currently in question.

#### 3d. Then delete the laundering device

- Delete `crates/snapback-services/src/lib.rs:36–40` (`pub mod test_support`).
- Delete the `remainder-tests` feature (`crates/snapback-services/Cargo.toml:18`).
- Delete all four dev-dependency lines: `crates/snapback/Cargo.toml:99`,
  `crates/snapback-server/Cargo.toml:63`, `crates/snapback-engine/Cargo.toml:50`,
  `crates/snapback-cli/Cargo.toml:37`.

Note that `remainder-tests` also pulls `snapback-kernel/test-support`
(`snapback-services/Cargo.toml:18`), so deleting it simultaneously removes four crates'
ambient access to the §2.2c privilege seams. That coupling is why defect 3 is not
cosmetic: it is the delivery vehicle for defects 1 and 2's test-gated backdoors.

**General rule for the gate:** a confined external crate may be a dependency (of any kind)
of exactly the members in `allowedMembers`, and **no workspace crate may re-export a
confined external crate or any of its types under any feature**.

---

## 3. Test-preservation plan

**Non-negotiable: no test is deleted.** Every relocation is a move plus a compile fix. If
a test cannot be expressed after the change, that is a signal the closure removed a
capability something legitimately needs — escalate it, do not drop it.

### The ~30 in-kernel tests: cost zero

The claim sites in `proof_checkpoint.rs:3569, 3652, 4777, 4801, 5043, 5095, 5222, 5310`,
`storage/tests.rs:15, 18, 24`, `storage/auth.rs:3638, 4085, 4408, 4454`,
`storage/auth_mode.rs:3087, 3269`, `storage/auth_agent_credentials.rs:3247`,
`storage/pending_effects.rs:823`, and `storage.rs:750` are all `#[cfg(test)]` **inside**
`snapback-kernel`. They keep full access to `pub(crate) claim_commit_authority` and
`pub(crate) KernelCommitAuthority`. Cost: a rename. **This is the second reason the design
is cheap** — 30 of the ~32 claim sites are free.

Tests that assert on the *old* admission signatures (arbitrary strings) must be rewritten
to seed the durable rows the kernel now reads and then assert the receipt matches. That is
a strictly better test: it verifies the derivation instead of the passthrough.

### The 2 cross-crate claim sites

`crates/snapback-engine/src/push/authority_tests.rs:64, 292` — replace
`LocalDatabase::memory()? + claim_kernel_commit_authority()` with
`ServingDatabase::memory()?`. Public, and harmless by construction after §2.1b. The
`rusqlite::Transaction` usage becomes the guard-based probe of §2.3a.

### The `test-support` seams being demoted to `#[cfg(test)]`

For each, the test moves to whichever side owns the invariant:

| Seam | Where its tests go | Rationale |
| --- | --- | --- |
| `bind_for_test`, `committed_for_test`, `ambiguous_for_test` | **into `snapback-kernel`**, `#[cfg(test)]` | They test kernel settlement ordering. Testing kernel semantics from outside the kernel bought nothing and cost a public seam. |
| `AuthorizationCommitCarrierFactory::for_test` | dies with the factory (§2.2a) | Its consumers become `ServingDatabase::memory()` plus kernel-internal plan construction. |
| `RecordingServiceAuthorityCommitInterlock` | **into `snapback-kernel`**, `#[cfg(test)]`, after the registry move (§2.2b) | Auth-side tests that used it test *policy*; they assert against the kernel registry's non-privileged inspection reads (`pending_tickets()`, `settled()`, `ambiguous()`). |
| `ServiceAuthorityFenceRegistry::commit_terminal_for_test` | stays in `snapback-auth` `#[cfg(test)]`, calling the kernel registry | Same reasoning. |
| `join_kernel_commit_authority_for_test` (`storage.rs:2178`) | **Verified:** its sole caller is `LocalSnapback::open_commit_graph_sibling_for_test` (`engine.rs:6129–6142`), which is `#[cfg(feature = "test-support")] #[doc(hidden)]` — *not* `#[cfg(test)]` — and which also **clones the authority** (`engine.rs:6141`). So today, any crate enabling `snapback-engine/test-support` gets a public API that opens a second writable handle onto a serving store's authority graph. This is the sharpest single instance of the whole defect class. It becomes `ServingDatabase::attach_secondary_handle(&self, db: LocalDatabase) -> SnapbackResult<SecondaryHandle>` with `#[cfg(test)]` in the kernel, and `open_commit_graph_sibling_for_test` becomes `#[cfg(test)]` in the engine. Both lose the clone: `SecondaryHandle` borrows. |

### The raw-SQL tests

Preferred: typed probes (§2.3a) leave them in place with an import change. Residue moves
to `crates/snapback-harness/tests/`, which requires the asserted state to be reachable
through public APIs. If it is not, surface that as a finding rather than papering over it
with a rusqlite handle — that is the same instinct that produced `remainder-tests`.

### Dev-dependency shape replacing `remainder-tests`

| Crate | Before | After |
| --- | --- | --- |
| `snapback` | `snapback-services = { features = ["remainder-tests"] }` (`Cargo.toml:99`) | direct `rusqlite` **dev**-dependency; `"snapback"` added to `allowedMembers` (its 9 sites are already integration tests) |
| `snapback-server` | `snapback-services = { features = ["remainder-tests"] }` (`Cargo.toml:63`) | *(removed)*; its 4 sites go to probes or `snapback-harness` |
| `snapback-engine` | `snapback-services = { features = ["remainder-tests"] }` (`Cargo.toml:50`) | *(removed)*; `snapback-kernel = { features = ["test-support"] }` retained, but `test-support` now grants only non-privileged fixtures |
| `snapback-cli` | `snapback-services = { features = ["remainder-tests"] }` (`Cargo.toml:37`) | *(removed)*; its 8 sites go to `snapback-harness` |
| `snapback-harness` (new) | — | `rusqlite` as a direct dev-dependency, with `"snapback-harness"` added to `externalConfinement.rusqlite.allowedMembers` |

The point of the shape change: rusqlite reachability becomes a **visible edge in
`cargo metadata`** in exactly one new place, instead of an invisible one created by a
feature flag on an unrelated crate.

---

## 4. Migration steps

Each step is one commit that leaves `cargo check --all-targets --workspace` green.

1. **Split binding from authority.** Add `DatabaseBinding` and `LocalDatabase::binding()`
   in `crates/snapback-kernel/src/storage.rs`. Convert every internal
   `is_for(&Arc<()>)` / `identity()` to use it. `KernelCommitAuthority` keeps `Clone` for
   now. Pure refactor, no behavior change.
2. **Reroute non-privileged consumers to `DatabaseBinding`:** `ReadLane`
   (`engine.rs:29837, 25555`), `execute_query_invocation` (`engine.rs:34676, 34693,
   34923`), `read_ledger_projection_for_prepared` (`engine/push.rs:49`),
   `auth_room_kick_acceptance.rs:1693`.
   **Checkpoint — stop and re-plan if this fails:** count mentions of
   `KernelCommitAuthority` outside `crates/snapback-kernel`. It must drop from ~20 to ≤ 6.
   If it does not, the binding/authority decomposition is wrong and the rest of this plan
   is built on sand.
3. **Introduce `ServingDatabase`** (`crates/snapback-kernel/src/storage/commit_graph.rs`)
   with `Deref`/`DerefMut`. Change `LocalSnapback.db` to `ServingDatabase`, replace
   `from_database`'s claim (`engine.rs:24202`) with `ServingDatabase::adopt`, delete the
   `kernel_commit_authority` field. Expect near-mechanical, because of `Deref`.
4. **Make the root private.** `claim_kernel_commit_authority` → `pub(crate)`;
   `KernelCommitAuthority` → `pub(crate)`; drop `Clone` per §2.1c; delete
   `snapback-auth/src/lib.rs:9`'s `storage` and narrow `snapback-engine/src/lib.rs:12`.
   The compiler now enumerates every remaining leak. **Fix each by adding a
   `ServingDatabase` method, never by re-widening visibility.**
5. **Introduce `ResolvedPrincipal`** and its two durable resolvers, additively. No removals.
6. **Convert the admissions, one commit each**, in this order (value-descending):
   pending-effect decision (closes the step-up bypass) → pending-effect
   creation/settlement/refusal → protected-record erasure → push authority. For each:
   delete derivable parameters, type the remaining facts as enums, and review the
   before/after transactional SQL statement order and audit query shapes explicitly.
   Verify `schemas/` drift is zero after each.
7. **Move the service-fence registry into the kernel** (§2.2b): `Notify` → `Condvar`,
   delete `with_provider_clock`. Land the LLP 0225 amendment in the same commit.
8. **Move the room-authority ticket machinery into the kernel** (§2.2a):
   `RoomAuthorityRegistry`, `RoomDependencyTicket`, `RoomDependencySelector`,
   `prepare_unbound`, `finish_room_authorization_commit` from
   `crates/snapback-sync/src/ephemeral.rs` to
   `crates/snapback-kernel/src/storage/room_authority.rs`. Same LLP 0225 amendment
   pattern. **This is the largest single step; consider landing it as its own reviewed
   change.**
9. **Delete the closure constructors** — `AuthorizationCommitCarrierFactory`,
   `service_authority_commit_interlock`, `ServiceAuthorityTerminalFactory::prepared` —
   replacing them with the concrete plan values of §2.2a/§2.2b. After this step,
   §5 property 9 (no `Fn` in kernel public API) should pass for the first time.
10. **Demote every `test-support` privilege seam to `#[cfg(test)]`** (§2.2c), relocating
    tests per §3. Includes `open_commit_graph_sibling_for_test`
    (`engine.rs:6129`), which is the sharpest instance.
11. **Typed probes** replacing raw-SQL test reach (§2.3a), starting with
    `push/authority_tests.rs` and the four `snapback-server` sites.
12. **Give `snapback` a direct `rusqlite` dev-dependency** (§2.3b) and amend both
    confinement artifacts. Its 9 integration-test sites change only their import path.
13. **Create `crates/snapback-harness`**, move the `snapback-cli` (8) and residual
    `snapback-engine`/`snapback-server` sites, amend
    `crates/allowed-dependencies.v1.json` and the duplicated literals in
    `scripts/check-workspace-graph.mjs`.
14. **Delete `snapback-services::test_support`, the `remainder-tests` feature, and all
    four dev-dependency lines.**
15. **Verify:** zero `schemas/` drift; `node scripts/check-workspace-graph.mjs`; the
    rewritten F-2 gates; `cargo test --workspace`.

**Gating note for publication.** Steps 1–4 close the *reachability* half; steps 5–6 close
the *forgery* half. **1–4 alone are the fourth "moved it again" attempt** and must not be
reported as closing F-1. Publication unblocks at the end of step 6 at the earliest, with
7–15 following.

**Rough shape of the work.** Steps 1–4 are largely mechanical and I would expect them in
one working session; step 6 is four reviewed commits with real semantic content; steps 7–9
are two crate-boundary moves of ~700 and ~500 lines each, and are the part I would most
want scheduled as their own reviewed changes rather than bundled; steps 10–14 are wide but
shallow (33 import sites, 4 manifests, 2 confinement artifacts).

---

## 5. Mechanical properties a gate can assert

All of these are computable from `cargo rustdoc --output-format json` per member,
**crossed with the feature powerset**, plus `cargo metadata --no-deps`. Per LLP 0283 §F-2,
the gate must **not** regex over source text: item identity comes from the rustdoc index
and `crate_id`, and every negative fixture must assert the diagnostic **span** points at
the intended expression.

### Defect 1

1. `snapback_kernel`'s public item set contains no item named `KernelCommitAuthority`, and
   no `pub fn` whose name begins `claim_` returns it.
2. No public item in **any** member has a signature — parameter, return, field, associated
   type, or generic bound — mentioning `KernelCommitAuthority`.
3. **The zero-string admission property.** Enumerate the intended admission entry points
   (`ServingDatabase::erase_protected_record`, the four pending-effect methods,
   `LocalDatabase::push_authority_for`). Assert the set is **equal** to the set of
   `snapback_kernel` public fns whose name matches `admit_|erase_|_authority_for`, and
   that none of them takes a parameter of type `String`, `&str`, `Option<String>`, or
   `Option<&str>`. Equality, not subset, so a new admission cannot be added silently.
4. The set of `pub fn` in `snapback_kernel` returning `ResolvedPrincipal` equals exactly
   `{resolve_principal_from_session, resolve_principal_from_credential}`;
   `ResolvedPrincipal` has no public fields and no public constructor.
5. **Derive audit.** For the privilege list — `KernelCommitAuthority`, `ServingDatabase`,
   `PushStorageAuthority`, `ResolvedPrincipal`, `ProtectedRecordErasureRequestV1`,
   `AuthorizationCommitReservation`, `PreparedAuthorizationCommit`,
   `PreparedServiceAuthorityTerminal`, `ServiceAuthorityCommitInterlock`,
   `Create/Decide/Settle/RefusePendingEffectCommand` — the rustdoc `impls` list contains
   none of `Clone`, `Copy`, `Default`, `Deserialize`, `From`, `FromStr`, `Arbitrary`.
6. **The list is self-maintaining:** every `snapback_kernel` type whose name matches
   `Authority|Admission|Command|Terminal|Reservation|Prepared|Principal` must be either on
   the privilege list or on a reviewed exemption list carrying a reason string. This is
   what stops the gate from rotting the way F-2's did.
7. `snapback-auth`'s public item set contains no re-export whose resolved path is
   `snapback_kernel::storage` as a whole (compare resolved `crate_id` + `path` per public
   re-export, not the `use` text).
8. **`Deref` containment (see Risk 3):** `LocalDatabase`'s public inherent methods return
   no type on the privilege list. Privilege lives only on `ServingDatabase`.

### Defect 2

9. No `pub fn`, public associated fn, or public struct field in `snapback_kernel` has a
   type mentioning `dyn Fn`, `dyn FnMut`, `dyn FnOnce`, or an `impl Fn*` bound. The
   allowlist must be **empty** for the `storage`, `auth::service_fence`, `push`,
   `proof_checkpoint`, and `storage::pending_effects` modules.
10. `AuthorizationCommitCarrierFactory` and `ServiceAuthorityTerminalFactory` do not appear
    in `snapback_kernel`'s public item set.
11. **Feature-powerset invariance.** Across every feature combination of `snapback-kernel`
    (`{}`, `{test-support}`, and any successor), diff the public item set; assert the diff
    contains no type on the privilege list and no fn returning or constructing one. This is
    the assertion that would have caught §2.2c.
12. `ServiceAuthorityFenceRegistry` and `RoomAuthorityRegistry` both resolve to
    `crate_id == snapback_kernel`, and the parameter types of
    `install_service_authority_fences` and `install_room_authority` resolve to those same
    items. Equivalently and more robustly: **no type reachable from a `snapback-kernel`
    public fn signature may have `crate_id != snapback_kernel && crate_id != snapback_types`.**
    That single property forbids the kernel from ever again accepting a higher-ranked
    crate's behavior, by closure or otherwise.
12b. `LocalEphemeralBackend` in `snapback-sync` has no public method taking or returning
    a type named `*CarrierFactory`, and `crates/snapback-sync/src/ephemeral.rs` declares no
    field of type `Arc<RwLock<Option<AuthorizationCommitCarrierFactory>>>` (checked via the
    rustdoc field type, not text).
13. **Compiled negative fixtures with span assertions.** A scratch crate depending on
    `snapback-kernel` attempts, in three separate files:
    `KernelCommitAuthority { .. }`; `db.claim_kernel_commit_authority()`;
    `factory.prepared(|| Ok(()), || {}, || {})`. Each must fail to compile, and the gate
    must read `cargo build --message-format=json` and assert
    `spans[].file_name` + `byte_start` point at the attempted expression. (F-2 found an
    unrelated compiler error containing the expected regex satisfied the old fixtures.)

### Defect 3

14. For each `externalConfinement` rule and **each dependency `kind`** reported by
    `cargo metadata --no-deps` (`null`/normal, `dev`, `build`), the set of members
    depending on the confined crate is a subset of `allowedMembers`. Keep the kinds
    collapsed for the verdict but **report the kind in the failure message**, so
    laundering is visible in the output.
15. No member outside `allowedMembers` has a public path resolving to an item whose
    `crate_id` is a confined crate — computed over that member's full feature powerset.
16. **No feature may add a confined re-export.** For each feature `f` of each member, diff
    the public item set with and without `f`; assert the added items include nothing
    resolving to a confined crate. This is the general form of the `remainder-tests`
    defect, and it holds for features not yet written.
17. `snapback-services` declares no feature named `remainder-tests` and exposes no module
    named `test_support`.
18. `cargo tree -e features --workspace` shows no path by which a default build of
    `snapback` enables a feature that adds a confined re-export.

---

## 6. Risks and what I am least sure about

1. **`admit_system_push` (§2.1b.iii) is the item most likely not to close cleanly.** If any
   production lane — dev mode, cron, internal asset callbacks — reaches
   `ResolvedAppAuthority::System` without a durable internal-service credential row, then
   closing it means creating those rows, which touches auth semantics and possibly
   `schemas/`. **Zero `schemas/` drift is a required invariant**, so a new table here needs
   its own decision. *Investigate this before committing to the plan* — it is the single
   fact that could change the shape of §2.1b.
2. **Two crate-boundary moves violate LLP 0225** — the service fence (§2.2b, from
   `snapback-auth` rank 2) and the room-authority ticket machinery (§2.2a, from
   `snapback-sync` rank 3). The second is the harder sell: room state reads as realtime,
   not storage. I believe the mechanism-down/policy-stays split is right in both cases
   (*an interlock belongs with the transaction it interlocks*), but they are ownership-map
   amendments the author may reasonably refuse. The fallback
   (premark-outside/settle-outside) is weaker because it widens the exact window LLP 0053
   exists to close. That tradeoff should be decided explicitly, not by default. **If both
   moves are refused, defect 2 cannot be fully closed** — the honest report is then "closure
   factories replaced by a narrower non-general port, capability reduced but not
   eliminated," and F-1 item 2 stays open.
3. **`Deref`/`DerefMut` on `ServingDatabase` is doing a lot of work** to keep step 3 cheap,
   and it has a real cost: `&mut *serving` yields `&mut LocalDatabase`, so any *future*
   privileged inherent method added to `LocalDatabase` becomes reachable through it.
   Property 8 in §5 is the mitigation and is **not optional** — without it, `Deref`
   quietly reopens the hole, and this design would then have the same failure signature as
   the previous three.
4. **"No `&str` in admissions" is a proxy, not a proof.** A caller-asserted fact can still
   be smuggled as a typed enum the kernel does not cross-check. The gate catches the shape;
   only review catches the semantics. Pair it with a required table in the LLP listing, per
   admission parameter, *where in the kernel that parameter is verified*.
5. **Feature-powerset gating has a cost bound problem.** `snapback-kernel` × 2 features is
   trivial; the workspace-wide powerset is not. Bound it: powerset per member up to 2^n with
   n ≤ 4; beyond that the member must declare a reviewed feature-interaction exemption.
6. **The room-authority move (§2.2a) is sized from reading, not from attempting it.** I
   traced the consumer chain (`engine.rs:24355` → `ephemeral.rs:4417` → `4074` → `4603` →
   `4314`) and read `RoomAuthorizationCommitReservation`'s fields, so the *shape* is
   confirmed. What I have not confirmed is how much of `RoomAuthorityRegistry`'s
   implementation entangles with `LocalEphemeralBackend`'s other shared state (`collections`,
   `authorization_issuer`, `expiry_index`). If `prepare_unbound` reaches broadly into that
   struct, the move is larger than 600 lines and step 8 should be re-planned before it is
   started, not during.
7. **Nothing here was compiled.** `cargo check` was never run — the sandbox lost disk
   mid-session and I did not attempt a build afterward. The main unverified claim is that
   **the `Deref`/`DerefMut` approach survives the borrow checker** at every site where the
   engine currently co-uses `self.db` and `self.kernel_commit_authority` (e.g.
   `engine.rs:4920`, `:4954`, `:10928`, `:17803`, `:18635`): those become two sequential
   borrows of the same value and should be fine if the admit methods take `&self`, but a
   site holding `&mut self.db` across an admit would need a small reorder. Step 2's
   checkpoint and step 3's compile are the designed early failures. (The other items I
   flagged as unverified in an earlier draft — the `rusqlite` import inventory and
   `join_kernel_commit_authority_for_test`'s cfg status — I subsequently confirmed; both
   turned out worse than the brief described, and both are corrected above.)
8. **`ReadLane` is `Clone` and carries the authority today** (`engine.rs:25555, 29837`).
   After step 2 it carries only a binding. If some read path depends on the read lane being
   able to mint a System push authority, that path is an escalation *today* and will
   surface as a compile error in step 2. Treat it as a finding, not as a reason to
   re-widen.
9. **This design deliberately leaves `ServingDatabase::adopt` public.** That is a
   considered choice (Corollary B(ii)), not an oversight, and it is the part a reviewer is
   most likely to challenge. The defense is: a caller who opened the file already has full
   write access, and after §2.1b the authority confers no fact-assertion power. If §2.1b
   cannot be completed for some admission, that admission must instead go the
   `pub(crate)` route (Corollary B(i)) — moving its caller into the kernel — rather than
   shipping with a public root and unverified facts.
