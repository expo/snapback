# Bounded commit capsule structural residuals

Status: Open — latent, fix-forward; no current production route exercises these paths
Created: 2026-08-22
Related: issues/20260822-bounded-commit-capsule-spec.md,
issues/20260822-authority-publication-binding-design.md,
issues/20260822-authority-publication-binding-implementation-plan.md, LLP 0225

## Scope

Round three established that the capsule was not a structural origin or commit seal. The
independent construction-origin Critical was closed on 2026-08-23 by the early slice assigned to
`issues/20260822-authority-publication-binding-implementation-plan.md`. This ticket stays open for
the three High residuals below. No production route is known to exercise them, but they remain
safe-Rust counterexamples to broader commit-seal claims. Do not cite the construction splice test
as evidence for adapter sealing, captured-authority exclusion, or semantic intent identity.

## Residuals and shortest violating paths

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
