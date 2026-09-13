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
(`issues/shelved/20260825-a-second-database-handle-publishes-without-the-interlock.md`) but with the design
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

## Addendum 2026-08-26: the documented residual names the wrong case

The process-bound identity primitive now carries module docs describing its platform boundary. An
independent reading review found that description **inaccurate in both directions**, and the real
residual is narrower but more dangerous:

**What the docs claim:** raw `clone()`/`clone3` without `pthread_atfork` handlers, followed by creator
exit and PID reuse, can make an inherited identity compare equal.

**What is actually true:** PID reuse after creator exit **cannot** produce equality — the private
lineage generation still differs. That case is closed.

**What actually fails open:** `clone(CLONE_NEWPID)` from a process whose `getpid()` is already `1` —
i.e. **container init**. The child's `getpid()` is also `1`, the registration state is still
`REGISTERED`, and the generation is still `1`, so both the PID check and the generation check pass and
an inherited identity compares **equal**.

That is a real fail-open in exactly the environment this system is most likely to be deployed in, and
it is invisible to a reviewer executing on macOS, where `CLONE_NEWPID` does not exist. It was found by
reading, not by running — the mirror image of the `Once`-inherited-RUNNING hang, which was invisible to
reading and found only by execution.

**Two further review notes on the same primitive**, both minor:

- While registration is in the `REGISTERING` state, a *legitimate* same-process comparison is refused.
  It is fail-closed, one-shot, and the alternative (waiting) is the child hang the round-2 fix removed —
  so it is not a blocker. If the bar is literally *no* intermittent refusal of a legitimate caller, the
  fix is to allow a PID+generation compare while `REGISTERING`, or to wait only when `getpid()` matches
  a stored registrar pid.
- The docs offer `exec()` as the only recovery for a child forked before the hook installed. LLP 0303
  revision (t) allows "`exec` **or** a fresh `LocalSnapback`". Either document the narrower limitation
  next to the state machine, or restore the second recovery path.

**Action:** correct the module docs to name `CLONE_NEWPID`-from-pid-1 rather than PID reuse, and decide
whether container init is in the threat model. If it is, the generation alone is insufficient there and
the identity needs a fact that a new PID namespace cannot replicate.

## Resolution — 2026-08-26, and the one case that remains open

Landed at `fcbc72633` (7 commits). `crates/snapback-kernel/src/process_bound_identity.rs` replaces the
open-coded `Arc::ptr_eq` identity with equality that reads the **current** process at comparison time
and requires both sides' creator to match it, backed by a private lineage generation advanced by a
`pthread_atfork` child hook so PID reuse cannot resurrect an inherited identity. `DatabaseBinding` is
converted and all `storage.rs` sites with it. **F126 is CLOSED**, historical fail-first 2/2 OPEN.

It took three rounds, and each round closed a defect the previous reviewer could not see:

1. **Round 1** built the primitive. A reading review returned LAND; an executing review found that
   `pthread_atfork` was registered inside a lazy `Once`, so a fork landing after registration succeeded
   but before the `Once` reached COMPLETE left the child inheriting RUNNING with no thread alive to
   finish it — **the child blocked forever** (`child=HUNG_UNTIL_SIGALRM`). Invisible to reading.
2. **Round 2** replaced `Once` with a non-waiting `AtomicU8` state machine. The reading review returned
   LAND; the executing review found that a legitimate identity and its own clone compared **unequal**
   while registration was transient — LLP 0303 revision (p), a false denial of a legitimate caller.
   The reading reviewer had seen the same thing and judged it non-blocking, and also supplied the fix.
3. **Round 3** let `REGISTERING` perform the same non-waiting PID + generation + allocation comparison
   as `REGISTERED`, so only `UNREGISTERED` and `FAILED` refuse. Both alarm-bounded fork races pass with
   no child blocking; clone, reopen, exec-restart, parent-after-fork and child refusal all pass.

Two corrections to earlier claims are worth preserving. Rust has no `is_always_lock_free()` API, so the
lock-freedom contract the child handler depends on is asserted via `target_has_atomic` instead. And the
module's original platform-boundary documentation was **wrong in both directions** — see the addendum
above.

## Still open: `CLONE_NEWPID` from pid 1

**Container init is in the threat model**, confirmed by the implementing lane. The remaining fail-open
is real:

> `clone(CLONE_NEWPID)` from a process whose `getpid()` is already `1` produces a child whose
> `getpid()` is also `1`, with the registration state still `REGISTERED` and the lineage generation
> still `1` — so both checks pass and an inherited identity compares **equal**.

Closing it requires a **namespace-resistant creator fact** — something a fresh PID namespace cannot
replicate. The lineage generation alone is insufficient there because it is inherited unchanged.

This is strictly narrower than what preceded it: before this work, `Arc::ptr_eq` failed open for
*every* fork, in every environment. It now fails open only for container-init `CLONE_NEWPID`. Landing
the improvement and tracking the remainder is the right trade, but the remainder is a live defect and
should not be described as closed.

**Also outstanding:** LLP 0313 §3 wants `DatabaseBinding` to carry **durable store identity** alongside
the allocation and creator-process identities. Not done.

**Census unchanged: 48 sites remain**, 30 of them authorization/custody guards, recorded at
`issues/shelved/20260826-fork-identity-primitive-census.md`.
