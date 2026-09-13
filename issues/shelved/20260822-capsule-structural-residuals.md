# Bounded commit capsule structural residuals

Status: Open — latent, fix-forward; no current production route exercises these paths
Created: 2026-08-22
Related: issues/shelved/20260822-bounded-commit-capsule-spec.md,
issues/shelved/20260822-authority-publication-binding-design.md,
issues/shelved/20260822-authority-publication-binding-implementation-plan.md, LLP 0225

## Scope

Round three established that the capsule was not a structural origin or commit seal. The
independent **construction-origin** Critical was closed on 2026-08-23 by the early slice assigned
to `issues/shelved/20260822-authority-publication-binding-implementation-plan.md`. That closure is scoped
to construction: two independent reviews agreed the mint-time seal is real and its `{B,A,A}`
constructor test is a genuine proof, and one of them found that the same pairing is still
reachable *after* a valid construction (see the post-construction aliasing residual below). This
ticket stays open for that plus the three High residuals below. No production route is known to exercise them, but they remain
safe-Rust counterexamples to broader commit-seal claims. Do not cite the construction splice test
as evidence for adapter sealing, captured-authority exclusion, or semantic intent identity.

## Residuals and shortest violating paths

### High — post-construction aliasing can recreate `{B,A,A}` (found in review of the closure itself)

`AppState` exposes its `Arc<Mutex<LocalSnapback>>` publicly
(`crates/snapback-server/src/admin.rs:2636`), and the private runtime binding clones that same
handle (`:2899`). Privacy stops the binding's fields being replaced; it does not freeze the
`LocalSnapback` *inside* the shared mutex.

Shortest path, after a perfectly valid construction:

```rust
let state = AppState::try_new(shared_a, read_a, ephemeral_a, context)?;
with_snapback(&state.snapback, |slot| *slot = local_b).await;   // server.rs:177
```

The runtime binding now holds `{state B, admission A, authority A}` because its state handle
aliases the mutated mutex while its other fields remain A. `CommitCapsuleDestination::bind` still
accepts prepared authority A, reserves A, and locks/stages B.

**It does not currently commit B**: the kernel's pending transaction rejects commit authority A
(`crates/snapback-kernel/src/storage/watches.rs:322`). So the last line of defence holds and this
is latent — but the splice is expressible in safe Rust and reaches that final defence, which is
further than the construction seal was claimed to allow.

The construction test cannot catch this: it only supplies mismatched inputs to
`try_new_for_server_startup` and never mutates the shared referent after a matched construction.

### Low — the graph-identity mint is not pinned against a durable-key intern

The two constructor fixtures pin the origin *comparison*, not the origin *mint*. If
`app_state_graph_identity` were changed to intern by `(database_path, incarnation)` rather than a
fresh `Arc::new(())` per process graph, both fixtures stay green (their path and incarnation
differ), while two `LocalSnapback::open` calls on the same file would share an identity and the
constructor would accept `{B,A,A}`. Not a live splice in this commit; the current mint is a fresh
`Arc::new(())` at one site.

### Resolved 2026-08-23 — Critical AppState independent-construction splice

Files: `crates/snapback-engine/src/local/engine.rs`,
`crates/snapback-server/src/admin.rs`, and
`crates/snapback-server/src/server/commit_capsule.rs`.

Historical shortest path: claim `EngineAppStateBindings` from database A; call
`AppState::try_new_for_server_startup` with `SharedSnapback` B and those preclaimed bindings A. The
inner constructor locks B but takes admission and commit authority from A, then creates
`CommitCapsuleBinding { state: B, admission: A, authority: A }` without comparing origins. Bind a
prepared authority from A: the admission comparison succeeds, so the cross-origin destination is
accepted. Replacing fields after construction is not required.

Closure: `LocalSnapback` now mints an opaque AppState graph identity with its one-shot engine
bindings. While holding the exact supplied `SharedSnapback` B, AppState construction consumes the
bindings only through `into_parts_for_app_state(&B)`, which compares that identity before it can
mint the private `CommitCapsuleRuntimeBinding`. That binding retains the exact SharedSnapback,
admission controller, graph identity, and commit authority; the destination no longer assembles
those parts independently. Watch staging also derives its authority view from the capsule's
reservation instead of a separately cloned authority.

Evidence: `bounded_commit_capsule_rejects_preclaimed_graph_a_with_shared_snapback_b` exercises two
complementary actual `{state B, admission A, authority A}` inputs. One copies a closed database
image so distinct process graphs A and B have identical durable incarnation text; the other uses
distinct in-memory graphs with the same absent database-path identity. Both prove refusal leaves B
unclaimed, so neither copied-ID nor path equality can substitute for graph origin. Mutation
confirmation changed only the origin guard to
`if false && !Arc::ptr_eq(...)`; AppState then constructed the splice and the test failed at its
explicit refusal assertion. Restoring the guard made the test pass.

### High — PendingCommit can mint or redirect committed outcomes

File: `crates/snapback-server/src/server/commit_capsule.rs:148-173,618-678`.

Shortest path: implement the open `pub(crate) PendingCommit` trait for a type whose `commit`
ignores the supplied authority and returns `Ok(value)`. `FinalCommitCut::commit` converts that
result to `CommitAttemptState::Committed` even though no database write occurred. A second valid
implementation can hold database B's pending value and authority, ignore the authority A supplied
by a final cut holding A's admission guard, and commit B instead.

Disposition: High, latent. Seal the adapter behind concrete database- and operation-bound kernel
types; do not treat the current trait contract as compiler-enforced proof.

### High — captured authority bypasses reservation and FinalCommitCut

Files: `crates/snapback-server/src/admin.rs:2621`,
`crates/snapback-engine/src/local/engine.rs:3314-3334,24483-24514`, and
`crates/snapback-kernel/src/storage/watches.rs:307-337`.

Shortest path: obtain a cloneable `CommitCapsuleAuthority` through
`CommitCapsuleRuntimeBinding::authority()` or
`EngineAppStateBindings::into_parts_for_app_state()`. In a closure that
already has mutable Local access, capture that authority, call public `stage_watch_management`,
then call public `WatchManagementPending::commit(&captured_authority)` directly. The durable
transaction commits without an `AuthorizedEffectReservation` and without `FinalCommitCut`.
Narrowing the capsule closure's parameter list does not constrain closure captures or other Local
closures.

Disposition: High, latent. Remove raw authority/stage/commit composition from capture-reachable
surfaces as part of the sealed construction and concrete commit-path work.

### High — same-ID semantic intent replay

File: `crates/snapback-kernel/src/storage.rs:895-909`.

Shortest path: obtain a kernel-minted exact-row witness for decoy intent A, construct target intent
B with the same caller-chosen operation identifier but different semantic fields, optionally map
the witness value to B's response shape, and call `into_value_for(authority, &B)`. The method checks
only database identity and operation-ID equality, so it accepts the decoy witness. The identifier
newtypes are caller-constructible and have no uniqueness ledger.

Disposition: High, latent. Bind reconciliation evidence to the intent instance or a canonical
intended-row fingerprint backed by a uniqueness rule; unequal-ID tests are not evidence for this
property.
