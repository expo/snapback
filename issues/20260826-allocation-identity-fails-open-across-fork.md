# Allocation identity fails open across POSIX fork, and the fix is specified but unapplied

- Status: open
- Created: 2026-08-26
- Area: `EngineAppStateGraphIdentity`, `DatabaseBinding`, every row using allocation identity
- Found by: the adversarial review of the `rehearse` lane (F126/F202), as its third finding

## The defect

`DatabaseBinding` is an `Arc<()>` and equality is `Arc::ptr_eq`
(`crates/snapback-kernel/src/storage.rs:823`, `:846`). After `fork()`, the child inherits the same
virtual addresses and reference-count state, so a carrier copied into the child **still compares
equal**. Allocation identity fails *open* across a fork.

Concretely, for the two rows that surfaced it:

- **F126** — the inherited claim, admission, live registry and `RehearsalAuthorityBinding` all retain
  matching pointer identity, so `prepare_deferred` accepts them in the child. The "exact process and
  database graph" the row claims to bind is not distinguished.
- **F202** — an inherited authorizer, carrier and database also compare equal.

This is not specific to those rows. **Fifteen files under `crates/` compare identity with
`Arc::ptr_eq`**, and the pattern is the recommended primitive throughout this programme — it is what
C005, C009, F143, F244 and the asset carriers all rest on.

## The fix already exists on paper

`llp/0312-origin-bound-asset-carriers.rfc.md:481` states it plainly:

> **POSIX fork:** pointer identity alone is insufficient. The child inherits the same virtual
> addresses and reference-count state, so `Arc::ptr_eq` can falsely accept an identity minted by the
> parent. Both `EngineAppStateGraphIdentity` and the database-origin comparison used by F145 must
> include a private creator-process identity and compare it with the **current** process, not merely
> compare the two stored PIDs. After a fork, every inherited graph is fail-closed in the child. The
> child must `exec` or construct a fresh `LocalSnapback`; there is no rebind operation for inherited
> carriers.

It is careful about the obvious wrong version: *"A PID alone is not identity and PID reuse is not
relied upon."* Within a live process allocation identity remains the discriminator; across a fork the
current-process check detects inheritance; across restart non-serialization and a fresh allocation
apply. It even suggests the diagnostic (`SNAPBACK_ENGINE_GRAPH_FORKED`).

**That RFC landed today and describes the fix for F145/F272 only. Nothing applies it to the shared
primitive.** So the specification and the implementation disagree across the whole programme.

## Why this is worth its own lane

Every other finding in this programme has been one row's producer or one row's consumer. This is a
property of the *identity primitive itself*, so a single change hardens every row that uses it —
including rows already landed and measured closed. It is the same shape as the interlock question
(`issues/20260825-a-second-database-handle-publishes-without-the-interlock.md`) but with the design
work already done.

## What is genuinely uncertain, and should be settled first

**Is fork in the threat model at all?** A process that can `fork()` already has the parent's entire
address space, including any secret the parent holds. If the attacker is assumed to have that, no
in-process identity scheme helps and the honest answer is to document the boundary rather than add a
check. LLP 0312 evidently concluded fork *is* in scope — it specifies fail-closed inheritance — but
that reasoning is stated for the asset carriers, not as a programme-wide ruling.

**Settle that before implementing.** If fork is in scope, apply the creator-process identity to
`EngineAppStateGraphIdentity` and `DatabaseBinding` and let every dependent row inherit the fix. If it
is out of scope, say so once, in LLP 0303, and stop reviewers raising it per row — it has now been
raised against at least four separate lanes, each spending review budget rediscovering it.

## Next

1. Rule on fork's place in the threat model, in LLP 0303 rather than per row.
2. If in scope, implement the creator-process identity on the shared primitive, with the diagnostic
   LLP 0312 suggests, and re-verify the rows that rest on it.
3. Either way, record the outcome where reviewers will find it before raising it again.

Related: `llp/0312-origin-bound-asset-carriers.rfc.md`, `llp/0303-subject-authority-correlation-policy.decision.md`.
