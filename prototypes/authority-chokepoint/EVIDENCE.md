# LLP 0293 authority-chokepoint compiler evidence

This is evidence from two throwaway structural prototypes, not an
implementation or a semantic-correctness claim. Positive configurations were
compiled with their intentionally failing features disabled.

The initial checked-out commit was `157118d4e`. It did not contain the canonical
`llp/0293-authority-transition-chokepoint.spec.md`; the complete Review text
available at `/Users/ccheever/lanes/out/choke-synth2.final.md` had the title,
sections, and nine questions quoted by the task. That text was read in full,
followed by checked-in LLPs 0292, 0291, and 0283. The canonical LLP 0293 file is
now included with the §10.3 resolution.

## Positive compiler and runtime evidence

```text
$ cargo check --all-targets --workspace
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.58s

$ cargo test -p snapback-kernel authority_transition_prototype -- --nocapture
running 5 tests
test authority_transition_prototype::tests::cron_uses_a_durable_due_claim_row ... ok
test authority_transition_prototype::tests::durable_delivery_receipt_crosses_without_a_public_claim ... ok
test authority_transition_prototype::tests::generated_secret_reconciles_without_evidence_or_plan ... ok
test authority_transition_prototype::tests::nested_layout_and_move_only_send_shape_compile ... ok
test authority_transition_prototype::tests::transaction_authorizer_epoch_nonce_dynamic_schema_and_statements_coexist ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 793 filtered out
```

The transaction test uses the real `rusqlite::Connection`,
`rusqlite::Transaction`, permanent `Connection::authorizer` hook, prepared
statements, dynamic protected-table registry, epoch/nonce state, and protected
SQL. It also proves that direct writes to both a static protected table and the
dynamically registered membership table are denied after the permit closes.

## Focused §10.3 compiler and runtime evidence

The focused crate at `http-handoff/` uses Axum 0.8.9 and `http` 1.5.0, matching
the server's current HTTP stack. It models the real
`enforce_registered_route_policy_inner` topology: asynchronous middleware
prepares a move-only operation, inserts a private take-once slot into
`Request<Body>`, calls Axum `Next::run`, and a custom extractor atomically takes
the operation before moving it through a detached `Send + 'static` task.

```text
$ cargo check --manifest-path prototypes/authority-chokepoint/http-handoff/Cargo.toml --all-targets --offline
    Checking authority-http-handoff-prototype v0.0.0 (.../prototypes/authority-chokepoint/http-handoff)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.12s

$ cargo test --manifest-path prototypes/authority-chokepoint/http-handoff/Cargo.toml --offline
running 5 tests
test tests::explicit_second_take_fails_closed ... ok
test tests::concurrent_takers_cannot_duplicate_the_operation ... ok
test tests::typed_registry_remove_is_also_single_owner ... ok
test tests::direct_handler_call_path_is_single_owner ... ok
test tests::move_once_slot_crosses_real_axum_next_and_detached_task ... ok

test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

The direct extension remains correctly rejected; the suggested compiler help
to derive `Clone` is deliberately not followed:

```text
$ cargo check --manifest-path prototypes/authority-chokepoint/http-handoff/Cargo.toml --offline --features negative-direct-extension
error[E0277]: the trait bound `PreparedOperation<QueryKind>: Clone` is not satisfied
   --> src/lib.rs:180:23
    |
180 |     extensions.insert(operation);
    |                ------ ^^^^^^^^^ the trait `Clone` is not implemented for `PreparedOperation<QueryKind>`
    |                |
    |                required by a bound introduced by this call
    |
note: required by a bound in `Extensions::insert`
   --> .../http-1.5.0/src/extensions.rs:62:22
    |
 62 |     pub fn insert<T: Clone + Send + Sync + 'static>(&mut self, val: T) -> Option<T> {
    |                      ^^^^^ required by this bound in `Extensions::insert`
```

Axum's current `Next` provides no separate per-request side channel:

```text
$ cargo check --manifest-path prototypes/authority-chokepoint/http-handoff/Cargo.toml --offline --features negative-next-side-channel
error[E0061]: this method takes 1 argument but 2 arguments were supplied
   --> src/lib.rs:189:10
    |
189 |     next.run(request, operation).await
    |          ^^^          --------- unexpected argument #2 of type `PreparedOperation<QueryKind>`
    |
note: method defined here
   --> .../axum-0.8.9/src/middleware/from_fn.rs:344:18
    |
344 |     pub async fn run(mut self, req: Request) -> Response {
    |                  ^^^
```

Wrapping the request body to make it the owner is incompatible with the same
`Next` boundary:

```text
$ cargo check --manifest-path prototypes/authority-chokepoint/http-handoff/Cargo.toml --offline --features negative-request-body-owner
error[E0308]: mismatched types
   --> src/lib.rs:203:14
    |
203 |     next.run(request).await
    |          --- ^^^^^^^ expected `Request<Body>`, found `Request<RequestOwner<Body, ...>>`
    |          |
    |          arguments to this method are incorrect
    |
    = note: expected struct `axum::http::Request<Body>`
               found struct `axum::http::Request<RequestOwner<Body, PreparedOperation<QueryKind>>>`
```

The compiled alternatives establish two additional facts. A typed registry
using atomic `HashMap::remove` compiles and remains single-owner, but adds a
process-lived claim registry and cancellation/expiry/binding obligations. A
direct async function that prepares and calls the exact handler also compiles
and is linear, but it does not cross the real centralized middleware-to-router
`Next` boundary.

## Intentional compiler failures

### Naive owner reborrow

```text
$ cargo check -p snapback-kernel --lib --features authority-prototype-negative-borrow
error[E0499]: cannot borrow `*store` as mutable more than once at a time
   --> crates/snapback-kernel/src/authority_transition_prototype.rs:746:5
    |
745 |     let transaction = store.connection.transaction()?;
    |                       ---------------- first mutable borrow occurs here
746 |     store.refresh_dynamic_membership_through_owner(&transaction)?;
    |     ^^^^^ second mutable borrow occurs here        ------------ first borrow later used here
```

The successful arrangement splits the connection from a cloneable,
connection-local `Arc<Mutex<PermitState>>`. The authorizer closure and the
transaction owner share that cell; no method reborrows the whole store while
the transaction exists.

### Current HTTP request carrier

```text
$ cargo check -p snapback-kernel --lib --features authority-prototype-negative-http-extension
error[E0277]: the trait bound `PreparedOperation<QueryKind>: Clone` is not satisfied
   --> crates/snapback-kernel/src/authority_transition_prototype.rs:753:23
    |
753 |     extensions.insert(operation);
    |                ------ ^^^^^^^^^ the trait `Clone` is not implemented for `PreparedOperation<QueryKind>`
    |                |
    |                required by a bound introduced by this call
    |
note: required by a bound in `Extensions::insert`
   --> .../http-1.5.0/src/extensions.rs:62:22
    |
 62 |     pub fn insert<T: Clone + Send + Sync + 'static>(&mut self, val: T) -> Option<T> {
    |                      ^^^^^ required by this bound in `Extensions::insert`
```

The same move-only type does compile in a `Send` async future and in a detached
thread when it has one owner. The existing clone-requiring HTTP extension
carrier does not.

### Rejected sibling visibility

```text
$ cargo check -p snapback-kernel --lib --features authority-prototype-negative-sibling-visibility
error[E0742]: visibilities can only be restricted to ancestor modules
   --> crates/snapback-kernel/src/authority_transition_prototype.rs:761:16
    |
761 |         pub(in super::authority_transition) fn write() {}
    |                ^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

The selected nested `authority_transition::writer` shape compiles with
`pub(super)`. The authority child also hosts an inherent implementation for a
receiver defined in its parent module and accesses the parent's private state.

## Workspace DAG evidence

`crates/allowed-dependencies.v1.json` assigns `snapback-kernel` rank 1 with
only `snapback-types` as an allowed workspace dependency; `snapback-auth` is
rank 2 and already depends downward on the kernel. The kernel already owns the
actual Argon2 password hash/verify functions in
`storage/auth_identity.rs`; the auth crate invokes them from its async blocking
pool. This prototype added no dependency.

The exported artifact/metadata validator from
`scripts/check-workspace-graph.mjs`, run over the checked-in matrix plus fresh
`cargo metadata --no-deps`, passed:

```text
[prototype-dag] PASS: 14 members; 14 matrix rows
```

The full script currently stops earlier on an unrelated tracked file that is
present at `HEAD`:

```text
$ node scripts/check-workspace-graph.mjs
SNAPBACK_WORKSPACE_GRAPH_VIOLATION: unmatched Rust file outside a member source home: crates/snapback-server/generated/embedded_guide_api.rs
```

## Answers

1. **ANSWERED YES — borrow coexistence.** The field-split connection-local
   permit cell compiles and its real SQLite behavior passes. Calling back
   through the whole `&mut store` does not compile (`E0499`).
2. **ANSWERED YES — authorizer mutability.** Mutating captured authorizer state
   while the transaction exists compiles and passes. Reinstalling the hook is
   unnecessary; the connection-local cell is the viable atomic arrangement.
3. **ANSWERED YES — movement through the current paths after a carrier-only
   change.** Direct insertion remains rejected (`E0277`). A private cloneable
   `Arc<Mutex<Option<PreparedOperation<Kind>>>>` slot crosses real Axum
   middleware and `Next`; a custom extractor atomically takes and returns the
   still-non-`Clone` operation by value. The handler then moves it through a
   detached `Send + 'static` task. Sequential and concurrent second takes both
   fail closed with `AlreadyTaken`.
4. **ANSWERED YES — crate DAG.** Kernel-owned password/provider computation is
   downward-compatible with the checked-in matrix, and the graph script's
   artifact/metadata validator passes. The full graph command has the unrelated
   pre-existing inventory failure quoted above.
5. **ANSWERED YES — delivery handoff, structural choice.** A cryptographically
   authenticated durable receipt compiles and passes; raw presented material
   crosses into the kernel and no public authority claim does. This selects
   the durable-receipt alternative, not a lease.
6. **ANSWERED YES — cron, structural choice.** It requires the new durable
   due/claim row in this prototype; due-state reload and generation CAS compile
   and pass as a closed kernel operation.
7. **STILL OPEN — administrator anchor.** KDF/MAC, sidecar, rotation, and staged
   physical-restore recovery were not prototyped.
8. **ANSWERED YES — commit uncertainty, structural only.** The return path can
   retain only a raw generated secret and powerless operation id, reload a
   durable receipt after commit, and return the secret without retaining
   evidence or an authority-bearing plan. Fault-injected ambiguous-commit
   semantics remain implementation verification, outside this compiler proof.
9. **ANSWERED YES — inherent-impl hosting.** The selected nested-module
   `pub(super)` layout compiles. The sibling spelling fails exactly with
   `E0742`; no visibility was widened.

Of the nine §10 questions, only question 7 remains unresolved. Question 3 is
now resolved **YES** without adding `Clone` to `PreparedOperation<Kind>` and no
longer blocks the design. LLP 0293 remains non-implementation-authoritative
because the administrator-anchor protocol is still open.

## Git persistence result

The shared branch-ref directory is read-only in this environment, so the
requested named scratch branch could not be created. The worktree index and
object store did permit a local detached commit, and the worktree `HEAD` and
reflog retain it. The exact commit hash is reported in the handoff. No push was
attempted.

```text
$ git branch scratch-llp-0293-move-once-http HEAD
fatal: cannot lock ref 'refs/heads/scratch-llp-0293-move-once-http': Unable to create '/Users/ccheever/projects/snapback/.git/refs/heads/scratch-llp-0293-move-once-http.lock': Operation not permitted
```
