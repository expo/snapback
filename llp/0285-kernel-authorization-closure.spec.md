# LLP 0285: Closing the kernel authorization model — the derived-authority design

**Type:** Spec
**Status:** Draft
**Systems:** Security/authorization, Rust core, Storage, Auth, Live/realtime,
Verification, Packaging
**Author:** Claude (Opus 5), synthesizing two independent blind designs —
Claude (Opus 5) and codex `gpt-5.6-sol` — commissioned by Charlie Cheever
(author rulings 2026-08-19, recorded in §2)
**Date:** 2026-08-19
**Revised:** 2026-08-19
**Related:** LLP 0283 (F-1), LLP 0284, LLP 0225, LLP 0276, LLP 0214, LLP 0264,
LLP 0059, LLP 0053, LLP 0143, LLP 0189, LLP 0232, LLP 0041

## Summary

LLP 0283 F-1 records three privilege escalations that survived **three** rounds
of fixes after the LLP 0276 carve. This spec is the fourth attempt's design, and
it is deliberately shaped by why the first three failed.

**The diagnosis both independent designers reached, separately:** every previous
attempt narrowed *where* a capability could be obtained without removing the
*ability* to obtain it. That was not a series of oversights — it was forced by a
structural fact neither attempt confronted:

> Rust has no friend crates, and every workspace crate of rank ≥ 1 has a
> **direct** `snapback-kernel` dependency edge
> (`crates/allowed-dependencies.v1.json`). Therefore **any `pub` item in the
> kernel is reachable by eleven crates regardless of what any façade
> re-exports.** Façade curation is hygiene; it is not a security mechanism
> inside this workspace.

Removing `snapback-auth/src/lib.rs:9`'s wholesale `pub use ... storage` is
correct and still required, but on its own it closes nothing. Any design whose
core is re-export narrowing, or that replaces the claimable root with *another*
cross-crate in-memory token, is a restatement of the failed attempts however
opaque its carriers are.

**The principle that replaces it:** *the kernel derives, never accepts.* A
capability is closed when exercising it confers no authority the caller did not
already have, because every security-relevant fact is re-derived by the kernel
from durable state inside the same transaction.

## 1. What "closed" means here

After this change, each capability must satisfy exactly one of two conditions:

- **(i) Unnameable.** It is `pub(crate)` in the kernel and its former
  cross-crate users have moved inside the kernel.
- **(ii) Powerless.** It is `pub`, but confers no unverified fact-assertion,
  because the kernel re-derives every security-relevant fact from durable rows.
  The "authority" degenerates into a routing/binding token and its reachability
  stops mattering.

A capability that is neither (i) nor (ii) is not closed, no matter how opaque
its type. This is the acceptance test for every item below.

**Non-threat, stated so nothing is designed around it.** A process that already
holds the SQLite file has full write access; the kernel cannot defend against
that and must not pretend to. Obtaining a commit authority for a database *you
opened yourself* is therefore not an escalation, and a design that makes that
harmless is a complete design. The take-once lease registry is ordering and
DoS-prevention, **not** authorization; no safety argument here may rest on it.

## 2. Author rulings incorporated (2026-08-19)

1. **Both ownership moves are approved**, amending LLP 0225: the
   service-authority fence (~700 lines, from `snapback-auth`, rank 2) and the
   authorization-commit / room-authority state machine (~500 lines, from
   `snapback-sync`, rank 3) move down into `snapback-kernel`. Both independent
   designs concluded defects 1 and 2 cannot be fully closed while the real
   verifiers and fence implementations live *above* the kernel. LLP 0225 must be
   amended in the same commit as the move, and
   `crates/allowed-dependencies.v1.json` plus the duplicated `EXPECTED_CRATES` /
   `EXPECTED_CONFINEMENT` literals in `scripts/check-workspace-graph.mjs` updated
   together.
   *Rationale recorded for the map:* the kernel owns the **mechanism** — an
   interlock belongs with the transaction it interlocks — while `snapback-auth`
   and `snapback-sync` retain the **policy**.
2. **F-1 is its own program.** LLP 0283's other follow-ups (F-2's gates, F-4)
   land first; this spec is implemented as a separate reviewed program.
   Publication stays blocked until it completes (LLP 0041 immutability).
3. **F-4's refusal-precedence ruling** was "fix the ordering," landed separately.

## 3. Threat model

- **Attacker A — a direct dependent crate in this workspace (live today).** Any
  of the eleven crates with a kernel edge, or any crate later added under
  `crates/*`. Can name and call any `pub` kernel item, enable any Cargo feature
  of any crate it depends on (features are additive and caller-selected),
  construct any all-public-field type, implement any non-sealed public trait, and
  clone any `Clone` value. **Cannot** name a `pub(crate)` item, construct a
  struct with even one private field and no public constructor, or write an
  inherent `impl` for a foreign type. All three defects are exploitable by A today.
- **Attacker B — a future third-party crate on published packages.** Does not
  currently exist: all thirteen members set `publish = false` and the npm runtime
  packages carry a sealed binary. B is a forward-looking constraint that justifies
  façade hygiene — **but designing for B is exactly what produced three rounds of
  re-export narrowing while A stayed fully armed.** B must not drive this design.
- **Attacker C — a future module inside an already-trusted crate.** The one that
  actually matters, because most of Snapback lives above the kernel. The property
  worth buying: a well-intentioned `snapback-engine` or `snapback-services` module
  **cannot cause the kernel to durably record an authority fact the kernel did not
  verify** — a forged approver, a fabricated credential digest, a self-declared
  `System` push. No visibility change addresses C; only "the kernel derives" does.

## 4. Orchestrator-verified findings

These were checked against `ede899a20` directly, and two make the defect worse
than LLP 0283 F-1 describes.

1. **There is exactly ONE production caller of
   `claim_kernel_commit_authority` outside `snapback-kernel`** —
   `crates/snapback-engine/src/local/engine.rs:24202`. Every other caller is an
   in-kernel test, plus `crates/snapback-engine/src/push/authority_tests.rs`.
   The entire cross-crate surface exists to serve one call site. This is the
   lever that makes closure far cheaper than it looks.
2. **`ResolvedAppAuthority` is a `pub` enum with `pub` variants**
   (`crates/snapback-sync/src/auth/invocation.rs:297`), so
   `ResolvedAppAuthority::System` is freely constructible by any crate — the
   exact "public enum" anti-pattern named in LLP 0283's Method lesson 1.
3. **A load-bearing comment states a false invariant.**
   `crates/snapback-engine/src/push.rs:27` reads: "The kernel fact is
   intentionally not re-exported through the public façade, so callers cannot
   assert `System` themselves." Both halves are false:
   `admit_system_push()` is `pub` on the root, and per finding 2 the enum
   variant is constructible anyway. **This comment is the failed Corollary-A
   reasoning written down as if it were an invariant** — it must be deleted with
   the code it describes, and LLP 0284's gate suite must be able to falsify
   claims of its kind.
4. **Defect 3 is wider than F-1 states:** four launderer crates and ~33 sites
   across 18 files (`snapback` and `snapback-server` are also consumers), not
   two. `remainder-tests` also pulls `snapback-kernel/test-support`, making it
   the delivery vehicle for defects 1 and 2's test-only backdoors.
5. **`LocalSnapback::open_commit_graph_sibling_for_test`**
   (`crates/snapback-engine/src/local/engine.rs:6129`) is a feature-selectable
   public API that **clones the authority onto a second writable handle of a
   serving store**. It is the sharpest single instance and is easy to miss.

## 5. Per-defect closure design

### 5.1 Defect 1 — the publicly claimable authority root

**Structural half (cheap, and insufficient on its own).**
`KernelCommitAuthority` (`crates/snapback-kernel/src/storage.rs:536`) conflates
three unrelated jobs:

| Job | Privileged? | Sites |
| --- | --- | --- |
| **Binding** — "this carrier belongs to database X" (`identity: Arc<()>`) | No | ~15 |
| **Exclusivity** — take-once per file identity (`_lease`) | No (ordering/DoS) | 1 |
| **Fact assertion** — `admit_system_push`, `admit_protected_record_erasure` (12 args), `admit_pending_effect_decision` | **Yes, and unverified** | ~5 |

The binding job is why the value had to be `Clone` and threaded to twenty call
sites; the fact-assertion job is the actual privilege. **Split them:** introduce
a non-privileged `DatabaseBinding` (private field, no public constructor,
`Clone` — duplicating a binding grants nothing), reroute the ~15 binding
consumers to it, and the privileged remnant shrinks enough to become
`pub(crate)`.

Serve the single production caller with a kernel-owned `ServingDatabase { db,
authority }` exposing `Deref`/`DerefMut` to `LocalDatabase`, so the thousands of
`self.db.*` sites compile unchanged; `LocalSnapback.db` becomes `ServingDatabase`
and the `kernel_commit_authority` field is deleted. Drop `Clone` from the
privileged root and hold the lease by value, so `!Clone` actually bites.

**Load-bearing half (what all three previous attempts skipped).** Admissions
must stop *accepting* facts:

- `admit_protected_record_erasure`'s 12 arguments reduce to 3; incarnation,
  generation, and credential class/digest are re-read from durable rows inside
  the same transaction. `mode` / `audit_class` / `profile` become enums
  cross-checked against the store.
- Introduce `ResolvedPrincipal` — private fields, no public constructor,
  obtainable **only** from kernel-internal durable resolvers. This is the
  reviewers' "durable proof" made concrete as a type property LLP 0284's gates
  can check.
- **Delete `admit_pending_effect_decision`'s `requires_step_up: bool`.** Today a
  caller asserting `false` bypasses a human-approval gate entirely. Highest-value,
  cheapest item in this spec — do it first.
- Replace `admit_system_push` with `push_authority_for(Option<&ResolvedPrincipal>)`,
  where `System` is **computed** from `ResolvedPrincipalClass::InternalService`
  and never declared. Per finding 2, wrapping the current caller-selected
  `ResolvedAppAuthority::System` in a new opaque type would merely move the
  escalation. There is no generic `System` constructor: each system producer
  either claims an exact existing durable work item (a cron invocation presents a
  durable job identifier; a pending-effect runner claims the exact row and lease
  generation) or invokes a closed kernel operation that derives all work from
  durable state (startup reconciliation becomes
  `reconcile_orphaned_stream_attempts`, not a system mint). **Any
  `ResolvedAppAuthority::System` call site that cannot be tied to durable work or
  replaced by an exact operation remains an unresolved authorization defect and
  must be reported as one, not papered over.**

**Hygiene, required but not sufficient:** delete the wholesale `pub use ...
storage` from `snapback-auth/src/lib.rs:9` and narrow the equivalent in
`snapback-engine`; remove `Clone`/`Default`/`Deserialize` from every
privilege-bearing root and carrier.

### 5.2 Defect 2 — public arbitrary-closure factories

**One rule kills the class: no `dyn Fn` / `impl Fn*` in any `snapback-kernel`
public signature.** A closure parameter is a self-implementable capability trait
wearing a hat; it is behaviorally identical to the traits that were retired.

Both sub-cases are the same laundering pattern — a higher-crate concrete value
smuggled through boxed closures because the kernel cannot name it. The fix is to
move the **mechanism** down and keep the **policy** up (author-approved, §2.1):

- **Service-authority fence:** move the concrete fence core from `snapback-auth`
  into `snapback-kernel` (`Notify` → `Condvar` to keep rank 1 async-free;
  `AuthProvider` was only being used as a clock). Kernel-owned
  `ServiceAuthorityDomain` and `PreparedServiceAuthorityTerminal` become
  `pub(crate)`. Delete `ServiceAuthorityTerminalFactory`,
  `ServiceAuthorityCommitInterlock`, and the two root accessors.
  **This is a move behind concrete types, not an opportunistic rewrite:** LLP
  0059's lock ordering, premark-before-write, retained-work draining, rollback,
  and ambiguity handling must be preserved exactly.
- **Authorization-commit / room authority:** move `RoomAuthorityRegistry`,
  `RoomDependencyTicket`, `RoomDependencySelector`, `prepare_unbound`, and
  `finish_room_authorization_commit` from `crates/snapback-sync/src/ephemeral.rs`
  into `crates/snapback-kernel/src/storage/room_authority.rs`.
  `LocalEphemeralBackend` instead receives an `AuthorizationCommitParticipant` at
  construction — a finite API for registering real rooms, reserving exact
  impacts, and observing committed outcomes, which accepts no closure and cannot
  construct an alternative terminal result. `PreparedAuthorizationCommit` becomes
  `pub(crate)`. Delete `AuthorizationCommitCarrierFactory`,
  `AuthorizationReservationCancellation::default()`, and
  `install_authorization_commit_carriers`.

### 5.3 Defect 3 — the caller-selectable raw-SQLite feature

`remainder-tests` is a **confinement-laundering device**: the workspace-graph
gate already collapses dependency kinds, so a direct `rusqlite` dev-dependency
would fail the gate — which is precisely why the feature exists. Close it in
three tiers:

1. **Typed guard probes** remove the need for tests to name `rusqlite` at all —
   start with `push/authority_tests.rs` and the `snapback-server` sites.
2. **`snapback`'s ~9 sites are already integration tests**: give that crate a
   visible, ordinary `rusqlite` dev-dependency and amend both confinement
   artifacts. Only import paths change.
3. **Residue moves to a new `crates/snapback-harness`** with its own
   dev-dependency, taking the `snapback-cli` and residual
   `snapback-engine`/`snapback-server` sites.

Then delete `snapback-services::test_support`, the `remainder-tests` feature, and
all four dev-dependency activations. Every `test-support` privilege seam demotes
to `#[cfg(test)]`, **including `open_commit_graph_sibling_for_test`** (§4.5).

## 6. Migration order, and the trap in it

Each step must leave `cargo check --all-targets --workspace` green.

1. Freeze behavioral evidence: authority/fence test inventory, protected-erasure
   receipt fixtures, push and pending-effect SQL traces, and a hash of `schemas/`.
2. Split `DatabaseBinding` out of `KernelCommitAuthority`; reroute the ~15
   non-privileged consumers.
   **Checkpoint — stop and re-plan if this fails:** mentions of
   `KernelCommitAuthority` outside `snapback-kernel` must drop from ~20 to ≤ 6.
   If they do not, the decomposition is wrong and the rest of this plan is built
   on sand.
3. Introduce `ServingDatabase`; replace the `engine.rs:24202` claim with
   `ServingDatabase::adopt`.
4. Make the root `pub(crate)`, drop `Clone`, delete the façade re-exports. The
   compiler now enumerates every remaining leak. **Fix each by adding a
   `ServingDatabase` method, never by re-widening visibility.**
5. Introduce `ResolvedPrincipal` and its durable resolvers, additively.
6. Convert the admissions, **one commit each**, value-descending: pending-effect
   decision (closes the step-up bypass) → pending-effect
   creation/settlement/refusal → protected-record erasure → push authority. For
   each: delete derivable parameters, type the remainder as enums, and review the
   before/after transactional SQL statement order and audit query shapes
   explicitly. Verify zero `schemas/` drift after each.
7. Move the service fence into the kernel; land the LLP 0225 amendment with it.
8. Move the room-authority machinery into the kernel. **Largest single step —
   land it as its own reviewed change.**
9. Delete the closure constructors. LLP 0284's "no `Fn` in kernel public API"
   property should pass here for the first time.
10. Demote every `test-support` privilege seam to `#[cfg(test)]`.
11–14. Typed probes → `snapback` dev-dependency → `crates/snapback-harness` →
    delete `remainder-tests` and `test_support`.
15. Verify: zero `schemas/` drift, `check-workspace-graph`, the LLP 0284 gates,
    `cargo test --workspace`, `./ref-check --verbose`.

> **The trap, stated so no one falls into it a fourth time.** Steps 2–4 close the
> *reachability* half. Steps 5–6 close the *forgery* half. **Steps 2–4 alone are
> the fourth "moved it again" attempt and must not be reported as closing F-1.**
> Publication unblocks at the end of step 6 at the earliest, with 7–15 following.

No step may add a JOIN or change an existing canonical read shape. Authorization
checks occur before the transaction; transaction bodies and SQL ordering are
preserved. Zero `schemas/` drift is a required invariant throughout — it already
caught one wire-contract regression during the carve (LLP 0283, Method lesson 5).

## 7. Verification

The mechanical properties a gate must assert are specified in **LLP 0284**, which
is independently authored and governs the gate suite. This spec does not restate
them. Two constraints propagate here:

- **rustdoc JSON is unavailable** on the pinned `rustc 1.97.0` toolchain, so
  properties are checked by syn-parsed Rust + `cargo metadata` +
  `rustc --message-format=json` span assertions. Do not take a nightly override.
- **"No `&str` in admissions" is a proxy, not a proof.** A caller-asserted fact
  can still be smuggled as a typed enum the kernel does not cross-check. The gate
  catches the shape; only review catches the semantics. This spec therefore
  requires a table, maintained as the admissions convert, naming **per admission
  parameter, where in the kernel that parameter is verified.** An admission
  parameter with no named verification site is not closed.

## 8. Open risks

1. **`admit_system_push` is the item most likely not to close cleanly.** If any
   production lane (dev mode, cron, internal asset callbacks) reaches `System`
   without a durable internal-service credential row, closing it means creating
   those rows — which touches auth semantics and possibly `schemas/`, whose drift
   must stay zero. **Investigate before committing to step 6's shape.**
2. **Durable administrator trust-anchor migration.** Existing file-backed
   instances may hold an environment-only token rather than a canonical token
   file. Full closure of protected erasure needs an owner-only digest anchor. If
   that cannot be provisioned compatibly, **protected erasure must fail closed**
   for such instances until an administrator provisions the anchor. Accepting a
   caller-provided digest at open is not an acceptable fallback.
3. **`Deref` on `ServingDatabase` is load-bearing and double-edged.** It keeps
   step 3 cheap, but `&mut *serving` yields `&mut LocalDatabase`, so any *future*
   privileged inherent method on `LocalDatabase` becomes reachable through it.
   The corresponding LLP 0284 property is **not optional**; without it, `Deref`
   quietly reopens the hole and this design acquires the same failure signature as
   the previous three.
4. **The room-authority move is sized from reading, not from attempting it.** The
   shape is confirmed; what is not is how far `prepare_unbound` reaches into
   `LocalEphemeralBackend`'s shared state (`collections`, `authorization_issuer`,
   `expiry_index`). If it reaches broadly, step 8 must be re-planned before it is
   started, not during.
5. **`ReadLane` is `Clone` and carries the authority today.** After step 2 it
   carries only a binding. If a read path depends on the read lane minting a
   System push authority, that path is an escalation *today* and will surface as a
   compile error. Treat it as a finding, not as a reason to re-widen.
6. **`ServingDatabase::adopt` stays public**, by condition (ii) not oversight —
   the caller who opened the file already has write access, and after §5.1's
   load-bearing half the authority confers no fact-assertion power. This is the
   part a reviewer should challenge hardest. If §5.1's load-bearing half cannot be
   completed for some admission, that admission must instead take the
   `pub(crate)` route (condition (i)) — moving its caller into the kernel — rather
   than shipping a public root with unverified facts.
7. **Nothing in either source design was compiled.** The main unverified claim is
   that `Deref`/`DerefMut` survives the borrow checker where the engine co-uses
   `self.db` and `self.kernel_commit_authority`. Step 2's checkpoint and step 3's
   compile are the designed early failures.

## 9. Provenance

Two independent designs were commissioned blind, from different model families,
and neither saw the other:

- `llp/reviews/0285-authorization-closure-design.claude.md` (Claude Opus 5) —
  source of the binding/authority split, `ServingDatabase`, the staged
  compile-checkable migration, and the "steps 2–4 alone are not closure" trap.
- `llp/reviews/0285-authorization-closure-design.gpt-5.md` (codex
  `gpt-5.6-sol`) — source of the delete-the-root-outright end state,
  `VerifiedInvocationContext` with evidence-specific issuance, the exact-durable-
  work rule for system producers, and the trust-anchor risk.

They converged independently on the diagnosis in the Summary and on the
conclusion that the LLP 0225 ownership moves are unavoidable. Where they diverged
— make the root `pub(crate)` versus delete it outright — this spec takes the
codex end state and the Claude path to it, because the split is what makes
deletion affordable.
