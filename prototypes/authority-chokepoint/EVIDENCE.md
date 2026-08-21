# LLP 0293 authority-chokepoint compiler evidence

This is evidence from a throwaway structural prototype, not an implementation
or a semantic-correctness claim. The positive configuration was compiled with
the three intentionally failing features disabled.

The checked-out commit was `157118d4e`. It did not contain the canonical
`llp/0293-authority-transition-chokepoint.spec.md`; the complete Review text
available at `/Users/ccheever/lanes/out/choke-synth2.final.md` had the title,
sections, and nine questions quoted by the task. That text was read in full,
followed by checked-in LLPs 0292, 0291, and 0283.

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
3. **ANSWERED NO — movement through the current paths.** One-owner async and
   detached movement compiles without `Clone`, but the current HTTP extension
   path requires `Clone` (`E0277`). The carrier/topology must change to a
   move-once extraction or another single-owner handoff; `PreparedOperation`
   must not be made cloneable.
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

Section 10 still blocks implementation: question 3 is resolved **NO** and
requires a design change, while question 7 remains **STILL OPEN**. Of the nine,
only question 7 is unresolved by this prototype; question 3 is resolved but
blocking.

## Git persistence result

The requested scratch ref and local commit could not be created because this
environment may read but not write the shared Git directory. No push was
attempted. The prototype is deliberately left unstaged in the worktree.

```text
$ git switch -c scratch/authority-chokepoint-compile-prototype
fatal: cannot lock ref 'refs/heads/scratch/authority-chokepoint-compile-prototype': unable to create directory for /Users/ccheever/projects/snapback/.git/refs/heads/scratch/authority-chokepoint-compile-prototype

$ git add -- <prototype paths>
fatal: Unable to create '/Users/ccheever/projects/snapback/.git/worktrees/f1b/index.lock': Operation not permitted
```
