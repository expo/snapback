# LLP 0283 F-1 design — closed kernel authorization

**Placement:** extend [LLP 0283 F-1](/Users/ccheever/projects/snapback/llp/0283-post-rearchitecture-followups.plan.md), rather than create another LLP covering the same decision.

**Decision:** delete the universal kernel authority root. Kernel mutations will either verify authority inside the operation or consume an exact, kernel-issued, one-shot permit derived from durable or cryptographically verifiable evidence. The kernel will own concrete commit-interlock state; no higher crate may install behavior through a callback. Raw SQLite test access will move to the unpublished conformance harness.

This is not a visibility-only patch. Fully closing F-1 requires a medium-to-large ownership correction across `snapback-kernel`, `snapback-auth`, `snapback-sync`, `snapback-engine`, `snapback-server`, and `snapback-conformance`.

## 1. Threat model

The attacker is safe Rust code in either:

- A direct dependent crate inside this workspace.
- A future third-party crate depending on any published Snapback package.
- A caller that enables any public Cargo feature.
- A caller that invokes public APIs in adversarial order, supplies arbitrary strings, enums, closures, and serialized values, and clones any publicly cloneable value.
- A caller that can construct or open a `LocalDatabase` through supported public APIs.

The attacker must not be able to:

- Assert `System`, `AdminBypass`, user, service, or protected-erasure authority merely by selecting an enum variant or string.
- Obtain a general-purpose root from which operation authority can be minted.
- Substitute commit-interlock behavior.
- Cause a privileged transaction to report a successful fence settlement without the real fence having settled.
- Turn a Snapback library feature into writable access to canonical or service-owned SQLite stores.

The attacker may:

- Present a real user/session/service/admin credential. The resulting authority is limited to what that credential currently authorizes.
- Trigger a legitimate, exact durable maintenance operation whose preconditions already hold. A caller invoking reconciliation is not an escalation if the kernel derives the entire operation from durable state.
- Create a new database and become its initial owner through the documented creation flow.

Out of scope are memory corruption, `unsafe` fabrication, patching Snapback, stealing credentials, or independently opening the database or owner-only sidecars with another SQLite/filesystem library. The package boundary cannot defend against arbitrary same-user filesystem access. Defect 3 is about Snapback itself exporting raw SQLite access, not about preventing a malicious program from adding its own `rusqlite` dependency.

Denial of service is secondary. Some concrete participant handles may allow a caller to create harmless reservations or registrations, but they must never authorize a commit or report false success.

## 2. Per-defect closure design

### 2.1 Defect 1: remove the publicly claimable authority root

#### Delete the root; do not replace it

Delete these APIs and concepts:

- `KernelCommitAuthority` from [storage.rs](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:538).
- `LocalDatabase::claim_kernel_commit_authority()` from [storage.rs](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage.rs:2158).
- The take-once authority registry. It proves ordering, not authorization.
- The `kernel_commit_authority` fields in `LocalSnapback` and `ReadLane`.
- `PushStorageAuthority` and `admit_system_push`, `admit_user_push`, and `admit_other_push`.
- The public protected-erasure authority/request carrier minted from arbitrary audit strings.
- Root-based pending-effect `admit_*` methods.

There will be no replacement `EngineKernelAuthority`, `CommitAuthorityFactory`, sealed public trait, or other code-identity token. Rust cannot grant friend access to `snapback-engine`; any constructor callable from that crate is callable from another dependent.

`LocalDatabase` instead owns a private authorization state:

```rust
// crates/snapback-kernel/src/authorization.rs
pub(crate) struct KernelAuthorizationState { /* private */ }

// crates/snapback-kernel/src/storage.rs
pub struct LocalDatabase {
    authorization: KernelAuthorizationState,
    // ...
}
```

No accessor returns `KernelAuthorizationState` or a universal minting capability.

#### Introduce verified invocation context

Add this public opaque value in `crates/snapback-kernel/src/authorization.rs`:

```rust
pub struct VerifiedInvocationContext {
    // private database identity, durable generation, authority classification,
    // source, expiry/revocation facts, and request binding
}
```

It has:

- Private fields.
- No `Default`, `Serialize`, or `Deserialize`.
- No public unchecked/test constructor.
- Read-only, redacted audit accessors only.
- `Clone` only if required by `PreparedAuthority`; cloning is explicitly safe because it is a revalidated context, not commit authority. Every mutable operation still requires a fresh, non-cloneable permit or performs verification internally.

Its issuance paths are evidence-specific:

- User/session/scoped credentials: the kernel checks the existing durable session, membership, grant, generation, expiry, and authorization-stream state.
- Dev authority: the kernel reads the database’s current durable `AuthMode::Dev` state. It does not accept `AuthMode` as a caller assertion.
- Provider authority that cannot be checked solely from local rows: `snapback-auth` returns a non-cloneable, request-bound cryptographic verification receipt from its concrete provider verifier. The kernel verifies it against the provider key/digest bound to the active durable generation. There is no public signing-key accessor or callback issuer.
- System work: there is no generic `System` constructor. Each system producer either claims an exact existing durable work item or invokes a closed kernel operation that derives all work from durable state.

Examples of the system rule:

- A cron invocation presents a durable cron/job identifier; the kernel verifies and leases the exact due job, binding function, generation, and operation.
- An asset or pending-effect runner claims the exact existing row and lease generation.
- Startup reconciliation becomes an exact method such as `reconcile_orphaned_stream_attempts`, not a system-authority mint.
- If a current `ResolvedAppAuthority::System` call site cannot be tied to durable work or replaced by an exact operation, that call site remains an unresolved authorization defect.

In [snapback-sync/src/auth/invocation.rs](/Users/ccheever/projects/snapback/crates/snapback-sync/src/auth/invocation.rs:1940):

- Remove public `InvocationGate::prepare_admitted_authority(...)`.
- Add `InvocationGate::prepare_verified(VerifiedInvocationContext, ...)`.
- `ResolvedAppAuthority` remains, if needed, as an audit/view enum. It is never accepted as proof.
- `AdmissionLease` is not sufficient evidence on its own.

This is essential: wrapping the present caller-selected `ResolvedAppAuthority::System` in a new opaque type would merely move the escalation.

#### Use exact operation permits only where staging requires them

Add one public cross-crate permit where the push pipeline genuinely requires split preparation and commit:

```rust
// crates/snapback-kernel/src/push.rs
pub struct PushCommitPermit { /* private */ }
```

`PushCommitPermit` is:

- Issued only after the kernel checks a `VerifiedInvocationContext` against the exact push request and current durable authorization state.
- Bound to database identity, request digest, producer/user identity, generation, and authorization-stream incarnation.
- Consumed by the terminal push operation.
- Not `Clone`, `Default`, `Serialize`, `Deserialize`, or publicly constructible.
- Unable to represent a caller-selected system/user/other classification; that classification is derived by the kernel.

Delete `PushStorageAuthority`.

Pending effects do not need a public authority carrier. In [pending_effects.rs](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/storage/pending_effects.rs:210), replace the public root-minted commands with `LocalDatabase` methods that accept a verified context plus an ordinary request DTO and then verify and mutate in one kernel call:

- `create_pending_effect`
- `decide_pending_effect`
- `settle_pending_effect`
- `refuse_pending_effect`

Their internal prepared commands are `pub(crate)` and non-cloneable. The kernel binds effect ID, dedupe key, runner lease, generation, and terminal decision itself.

For protected erasure:

- Keep `ProtectedRecordErasureWireRequestV1` public and deserializable because it is only a request.
- Make `ProtectedRecordErasureRequestV1` private to `snapback-kernel`, or delete it in favor of a private admitted form.
- Remove `ProtectedRecordErasureAuthorityV1`.
- Replace `admit_protected_record_erasure(...)` with one kernel operation that receives the wire request, verified invocation context, and raw presented administrator credential. It verifies and executes without exporting an admitted request.

The kernel derives every receipt field currently supplied as an arbitrary string: mode, principal, audit class, profile, transition generation, credential class/digest, and authorization-stream incarnation.

#### Move administrator credential verification to a kernel-owned concrete verifier

Add `crates/snapback-kernel/src/auth/admin_credentials.rs` containing a private `KernelAdminCredentialRegistry`.

Move the credential comparison and console credential state machine currently in [snapback-server/src/admin.rs](/Users/ccheever/projects/snapback/crates/snapback-server/src/admin.rs:513) into this module. `snapback-server` retains header extraction, routing, and HTTP diagnostics.

Properties:

- `LocalDatabase` owns the registry; there is no public installer accepting credential digests.
- Protected erasure passes the raw presented credential to the kernel. Caller-supplied digest/class strings disappear.
- File databases derive their trust anchor from canonical owner-only database sibling files. Explicit environment tokens must be persisted as an owner-only digest anchor during database creation/serve provisioning; later opens may verify but not replace it through a library API.
- Memory databases generate their owner credential and verifier together during creation. The creator may own the new database, but cannot attach a new verifier to an existing database.
- Receipts continue to store only credential class and SHA-256 digest, never the raw bearer.

This sidecar trust anchor does not alter `schemas/`. It is necessary: accepting a caller-provided “expected digest” at each open would only move the current arbitrary-string escalation.

#### Remove whole-module re-exports

Replace wholesale public `storage` re-exports with crate-private imports or explicit DTO exports in:

- `crates/snapback-auth/src/lib.rs`
- `crates/snapback-activation/src/lib.rs`
- `crates/snapback-engine/src/lib.rs`
- `crates/snapback-server/src/lib.rs`

For internal path compatibility, these crates may use:

```rust
pub(crate) use snapback_kernel::storage;
```

The curated `snapback::storage` facade may remain, but only with an explicit allowlist of non-authority DTO/read types. Tests currently importing storage through `snapback-auth` must import the canonical owning package or use the product facade.

#### Why this closes rather than moves the defect

A direct dependent can call the verifier APIs, but arbitrary input does not produce authority:

- A fake session has no matching durable row.
- A caller-selected `System` value is not an accepted input.
- A fake work ID has no exact claimable durable work.
- A fake admin digest is never accepted; the raw credential is compared by the kernel.
- A `VerifiedInvocationContext` cannot be fabricated or deserialized.
- A commit permit cannot be cloned or changed to another operation.

The public operation is therefore a verifier, not a mint.

### 2.2 Defect 2: replace callback factories with concrete kernel state

#### Authorization commit interlock

Create `crates/snapback-kernel/src/storage/authorization_commit.rs`.

Move the concrete reservation and settlement state below the crate boundary:

- `AuthorizationCommitDomain` — `pub(crate)`, created with `LocalDatabase`.
- `AuthorizationCommitParticipant` — `pub`, private constructor, cloneable only because it cannot authorize a commit.
- `AuthorizationCommitReservation` — public only if `snapback-sync` must carry it, private fields, non-cloneable.
- `PreparedAuthorizationCommit` — `pub(crate)`; only kernel transaction code can prepare or settle it.

Delete:

- `AuthorizationCommitCarrierFactory`
- `AuthorizationReservationCancellation::default()`
- Public callback constructors for reservation/prepared carriers.
- `LocalEphemeralBackend::install_authorization_commit_carriers(...)`.

`LocalEphemeralBackend` in `crates/snapback-sync/src/ephemeral.rs` instead receives an `AuthorizationCommitParticipant` at construction. The participant refers to the real database-owned domain and offers a finite API for registering actual rooms, reserving exact impacts, and observing committed outcomes. It accepts no closure and cannot construct an alternative terminal result.

The existing room reservation state machine should move substantially unchanged from `snapback-sync` into the kernel module. Sync continues to own delivery and room-facing behavior; the kernel owns the part that decides whether a canonical transaction may prepare, commit, roll back, or become ambiguous.

#### Service-authority fence

Replace [kernel auth/service_fence.rs](/Users/ccheever/projects/snapback/crates/snapback-kernel/src/auth/service_fence.rs:1) with the concrete fence core currently implemented in [snapback-auth](/Users/ccheever/projects/snapback/crates/snapback-auth/src/auth/service_fence.rs:1).

Kernel-owned types:

- `ServiceAuthorityDomain` — `pub(crate)`.
- `PreparedServiceAuthorityTerminal` — `pub(crate)`, concrete state only.
- `ServiceAuthorityPublication` — public opaque verified handle if higher layers require it; non-cloneable unless an individual API proves sharing safe.
- `ServiceAuthorityExternalEffectPermit` — public opaque, non-cloneable, one-shot.

Delete:

- `ServiceAuthorityTerminalFactory`
- `ServiceAuthorityCommitInterlock`
- `KernelCommitAuthority::service_authority_terminal_factory`
- `KernelCommitAuthority::service_authority_commit_interlock`
- `LocalDatabase::install_service_authority_commit_interlock`
- `RecordingServiceAuthorityCommitInterlock` from feature builds

`LocalDatabase` always owns the real service fence. Durable service-token resolution registers the exact verified witness in that domain. A terminal auth transaction asks the domain to prepare the exact token IDs and disposition, then the kernel transaction code settles the returned private terminal state.

The provider clock must not remain an injected production callback. The kernel owns production wall/monotonic sampling and durable-floor clamping. Deterministic clocks remain available only under `#[cfg(test)]` inside kernel unit tests.

This preserves the LLP 0059 state machine while moving its ownership. It is not a redesign of its concurrency semantics.

#### Ownership and dependency amendment

This changes the detailed ownership assigned by [LLP 0225](/Users/ccheever/projects/snapback/llp/0225-core-modularization.decision.md) and [LLP 0276](/Users/ccheever/projects/snapback/llp/0276-ideal-codebase-architecture.rfc.md):

- `snapback-auth` still owns provider configuration, authentication policy, and public auth composition.
- `snapback-sync` still owns realtime delivery and room behavior.
- `snapback-kernel` newly owns authorization evidence verification needed for a commit and both canonical commit-interlock state machines.

No upward dependency is added. Kernel remains dependent only on `snapback-types`; code moves downward rather than creating `kernel -> auth` or `kernel -> sync` edges.

#### Why this closes rather than moves the defect

No public function accepts `Fn`, `FnMut`, `FnOnce`, `Box<dyn Fn...>`, or a trait implementation to determine privileged settlement.

A caller may hold an observer/participant connected to the real domain, but cannot:

- Construct another domain for an existing database.
- Install it into `LocalDatabase`.
- Supply commit/rollback/ambiguous behavior.
- Produce a prepared terminal that reports success.
- Change database identity on a reservation.

There is exactly one concrete settlement implementation, owned and invoked by the kernel.

### 2.3 Defect 3: remove feature-selected raw SQLite access

Delete:

- `snapback-services/remainder-tests` from `crates/snapback-services/Cargo.toml`.
- `snapback_services::test_support` and its `pub use rusqlite` from `crates/snapback-services/src/lib.rs`.
- `remainder-tests` activation from `snapback-engine` and `snapback-cli`.
- Any authority test helpers exposed through `snapback-kernel/test-support`; authority helpers become `#[cfg(test)]` unit-test code only.

Use the existing unpublished `snapback-conformance` crate as the raw-storage test harness:

```toml
# crates/snapback-conformance/Cargo.toml
[dev-dependencies]
rusqlite = "..."
snapback-cli = { path = "../snapback-cli" }
snapback-engine = { path = "../snapback-engine" }
snapback-server = { path = "../snapback-server" }
```

Only integration-test targets under `crates/snapback-conformance/tests/` import `rusqlite` directly. Nothing re-exports it.

Amend `crates/allowed-dependencies.v1.json` and `scripts/check-workspace-graph.mjs` to distinguish dependency kinds:

- Production `rusqlite`: `snapback-kernel` and `snapback-services` only.
- Dev-only `rusqlite`: `snapback-conformance` only.
- Dev-only workspace edges from conformance to CLI/services are allowed.
- A production dependency cannot satisfy a dev-only allowance.

This is preferable to adding `snapback-conformance` to the existing undifferentiated `allowedMembers`, which would silently permit `rusqlite` in its library target.

## 3. Test-preservation plan

No authority or fence test is deleted merely because its old construction API disappears.

| Current tests | Destination |
|---|---|
| Kernel claim/root tests in `proof_checkpoint.rs`, `storage/auth.rs`, `storage/auth_mode.rs`, `storage/tests.rs`, and `storage/pending_effects.rs` | Remain kernel `#[cfg(test)]` unit tests. Replace root construction with private verifier fixtures and private concrete domains. |
| Kernel authorization reservation tests | `crates/snapback-kernel/src/storage/authorization_commit/tests.rs` |
| Auth service-fence state-machine tests | Move with the concrete implementation to `crates/snapback-kernel/src/auth/service_fence/tests.rs` |
| Auth provider/policy adapter tests | Remain in `snapback-auth`; use real verification entry points, not a terminal factory |
| Sync room reservation tests | Concrete prepare/settle cases move to kernel; room delivery and kick behavior remain in `snapback-sync` |
| `snapback-engine/src/push/authority_tests.rs` | Storage authorization cases move to `snapback-kernel/src/push/tests.rs`; public end-to-end push behavior moves to `snapback-conformance/tests/push_authority.rs` |
| Raw-SQL tests in `host_ops.rs` and `local/tests/engine.rs` | `snapback-conformance/tests/engine_storage_faults.rs` and `telemetry_state.rs` |
| Raw-SQL CLI tests in `cli/tests.rs` and `store_state.rs` | `snapback-conformance/tests/cli_store_state.rs` |
| External attack-surface tests | `crates/snapback-conformance/tests/authorization_behavior.rs` plus a compile-fail fixture driven by the boundary gate |

Shared SQL fixture code lives in:

```text
crates/snapback-conformance/tests/support/sqlite.rs
```

It is an integration-test module, not a library export.

Tests that currently combine private engine logic with raw corruption are split:

- The private state-machine unit test remains with its owner and uses no raw SQL.
- The raw corruption/setup and resulting public behavior become a conformance integration test.
- Kernel transaction ambiguity or malformed canonical-row cases remain kernel unit tests, where `rusqlite` is already an implementation dependency.

The migration must maintain a test ledger mapping every moved test name to its replacement. “Covered indirectly” is not sufficient.

## 4. Migration steps

1. **Freeze behavioral evidence.** Record the existing authority/fence test inventory, protected-erasure receipt fixtures, push SQL trace, pending-effect SQL trace, and a hash of `schemas/`.

2. **Amend ownership documents and dependency policy.** Update LLP 0225/0276 for kernel-owned verification/interlocks and define dev-only dependency edges in `allowed-dependencies.v1.json`. Run `node scripts/check-workspace-graph.mjs`.

3. **Introduce concrete kernel domains.** Add `authorization.rs`, `storage/authorization_commit.rs`, and the concrete `auth/service_fence.rs`. Keep temporary internal adapters so kernel/auth/sync compile while tests move.

4. **Move fence tests and implementation.** Port the existing LLP 0059 service-fence state machine substantially unchanged. Add concrete authorization-room state and migrate its tests. Check `snapback-kernel`, `snapback-auth`, and `snapback-sync`.

5. **Introduce verified invocation evidence.** Add durable credential resolution and request-bound provider proof verification. Add exact system-work claim paths. Change `PreparedAuthority` to originate only from `VerifiedInvocationContext`.

6. **Migrate every `prepare_admitted_authority` producer.** Classify each current call as user/session, dev, exact durable system work, or an exact closed maintenance operation. No call may translate `ResolvedAppAuthority::System` into proof.

7. **Migrate push.** Replace `PushStorageAuthority` with the exact one-shot `PushCommitPermit`. Preserve LLP 0143 producer-membership and deferred-grant revalidation.

8. **Migrate pending effects.** Move admission into kernel database methods and make prepared commands internal. Preserve the current SQL statement sequence.

9. **Migrate protected erasure.** Move credential verification to the kernel-owned registry and fuse verification, fence preparation, canonical transaction, settlement, and receipt production. Preserve the existing tombstone/checkpoint SQL body and audit-query shape byte-for-byte where practical.

10. **Delete the old surface.** Remove the root, claim registry, all root `admit_*` methods, callback factories, installers, carrier derives, public test constructors, and whole-module storage re-exports. This is the point after which no compatibility shim may remain.

11. **Move raw-SQL tests.** Add conformance dev dependencies, move the listed tests, delete `remainder-tests`, and remove engine/CLI feature activation.

12. **Run affected verification.** At minimum: workspace graph, public-surface gate, kernel/auth/sync/engine/server/CLI tests, conformance tests, `cargo check --workspace --all-targets`, `./ref-check --verbose`, guide/inventory checks affected by moved files, and exact zero-diff verification for `schemas/`.

No step may add a JOIN or change the existing canonical read shape. Authorization checks occur before the current transaction; transaction bodies and SQL ordering remain unchanged.

## 5. Mechanical properties a gate can assert

### Defect 1

- Rustdoc/public-API output contains no `KernelCommitAuthority`.
- No public method named `claim_kernel_commit_authority`.
- No public `admit_*` or `mint_*` method on a universal authority type.
- `PushStorageAuthority`, `ProtectedRecordErasureAuthorityV1`, and the privileged public erasure request are absent.
- No public mutation/admission API accepts `ResolvedAppAuthority`, arbitrary authority-class strings, or `AdmissionLease` as sufficient proof.
- No public constructor or deserializer exists for `VerifiedInvocationContext`, `PushCommitPermit`, or internal pending-effect/erasure admission types.
- Every operation permit is non-`Clone`, non-`Default`, non-`Serialize`, and non-`Deserialize`.
- Any cloneable verified context is accepted only by APIs that revalidate current state and issue/consume an exact non-cloneable permit.
- No whole `snapback_kernel::storage` module re-export exists outside the kernel; the facade’s explicit allowlist is the only exception.
- An adversarial external fixture fails to compile when attempting the three present attacks.
- The system-authority census has no generic system-mint path; every production system producer maps to an enumerated durable claim or exact closed operation.

### Defect 2

- Public API output contains no `AuthorizationCommitCarrierFactory`, `ServiceAuthorityTerminalFactory`, or `ServiceAuthorityCommitInterlock`.
- No public authority/interlock function accepts a closure, callback trait object, or caller implementation.
- No public `install_*commit_interlock` or `install_authorization_commit_carriers` method exists.
- Prepared terminal types and their constructors are crate-private.
- `LocalDatabase` constructs both concrete domains internally.
- All-feature builds expose no recording/no-op/success terminal and no public authority test constructor.
- A compile fixture cannot create a terminal, install an alternate domain, or manufacture commit success.
- Database-identity mismatch tests remain and fail closed.

### Defect 3

- `cargo metadata --all-features` contains no `remainder-tests` feature.
- No public item in any crate mentions `snapback_services::test_support` or re-exports `rusqlite`.
- Production/build dependency edges for `rusqlite` are limited to `snapback-kernel` and `snapback-services`.
- The only additional `rusqlite` edge is a dev dependency of unpublished `snapback-conformance`.
- `snapback-engine` and `snapback-cli` do not enable a services test feature.
- An external fixture importing `snapback_services::test_support::rusqlite` fails to compile under every feature combination.
- `git diff --exit-code -- schemas` succeeds, and the pre/post schema-tree digest is identical.

## 6. Risks and what is least certain

The largest risk is the breadth of the current caller-projected invocation model. `prepare_admitted_authority` and `ResolvedAppAuthority::System` appear across sync coordination, engine-local runners, runtime host glue, and server paths. Every producer needs classification; any leftover generic system constructor invalidates the closure.

The service fence is a large, concurrency-sensitive state machine. Moving it below the boundary must preserve LLP 0059’s lock ordering, premark-before-write behavior, retained-work draining, rollback, and ambiguity handling. This should be a move behind concrete types, not an opportunistic rewrite.

The least certain detail is durable administrator trust-anchor migration. Existing file-backed instances may use an environment-only token rather than a canonical token file. Full closure requires provisioning an owner-only digest anchor without accepting an unauthenticated replacement. If that cannot be done compatibly, protected erasure must fail closed for such instances until the current administrator explicitly provisions the anchor. Accepting a caller-provided digest at every open is not an acceptable compatibility fallback.

Zero schema drift means one-shot proofs cannot depend on new nonce tables. They must be process-local and bound to existing durable generations, leases, and rows. Crash recovery must continue from existing durable state and receipts, never require recovery of an in-memory permit.

I do not believe defects 1 and 2 can be fully closed while the real verifiers and fence implementations remain above `snapback-kernel` and `LocalDatabase` continues to accept callbacks. The minimum complete fix is therefore the ownership move described above—roughly five production crates, several dozen authority call sites, the concrete fence core, and the associated test migration—not another narrow surface patch.