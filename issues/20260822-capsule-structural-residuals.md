# Bounded commit capsule structural residuals

Status: Open — latent, fix-forward; no current production route exercises these paths
Created: 2026-08-22
Related: issues/20260822-bounded-commit-capsule-spec.md,
issues/20260822-authority-publication-binding-design.md,
issues/20260822-authority-publication-binding-implementation-plan.md, LLP 0225

## Scope

Round three established that the capsule is not a structural origin or commit seal. The current
production watch-management route follows the intended capsule path, and no production route is
known to exercise any path below. These are nevertheless safe-Rust counterexamples to the broader
claims previously made for the types. Keep them open and fix-forward; do not cite the current
same-origin tests as non-substitutability evidence.

The construction-origin remedy belongs to the independent early slice assigned to
`issues/20260822-authority-publication-binding-implementation-plan.md`, which seals the destination
at construction rather than trying to correlate independently supplied components downstream.
That plan file is not present at revision `72a8f5b01`; this ticket records the residual without
claiming the separate change has landed.

## Residuals and shortest violating paths

### Critical — AppState independent-construction splice

Files: `crates/snapback-server/src/admin.rs:2843-2868,2893-2929` and
`crates/snapback-server/src/server/commit_capsule.rs:79-104`.

Shortest path: claim `EngineAppStateBindings` from database A; call
`AppState::try_new_for_server_startup` with `SharedSnapback` B and those preclaimed bindings A. The
inner constructor locks B but takes admission and commit authority from A, then creates
`CommitCapsuleBinding { state: B, admission: A, authority: A }` without comparing origins. Bind a
prepared authority from A: the admission comparison succeeds, so the cross-origin destination is
accepted. Replacing fields after construction is not required.

Disposition: Critical, latent. Fix with the implementation plan's independent early slice, where
the destination is sealed at construction and cannot accept the graph and claim independently.

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
`CommitCapsuleBinding::authority()` or `EngineAppStateBindings::into_parts()`. In a closure that
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
