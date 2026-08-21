# LLP 0285: Closing the kernel authorization model — the derived-authority design

**Type:** Spec
**Status:** Superseded in part
**Systems:** Security/authorization, Rust core, Storage, Auth, Live/realtime,
Verification, Packaging
**Author:** Claude (Opus 5), synthesizing two independent blind designs —
Claude (Opus 5) and codex `gpt-5.6-sol` — commissioned by Charlie Cheever
(author rulings 2026-08-19, recorded in §2)
**Date:** 2026-08-19
**Revised:** 2026-08-19 (F-1 test-confinement implementation note: tiers 2–3
add visible `rusqlite` dev-dependencies to `snapback` and the new rank-7
`snapback-harness`; exact telemetry probes read unbounded physical rows when
their predecessor assertions did; no separate caller-selectable
`snapback-services/test-support` feature is introduced.)
**Revised:** 2026-08-19 (c — second independent review fact-checked every
citation; §5.4 reclassified from Attacker A to Attacker C and three factual
errors in it corrected; counts and line citations corrected. (b — revised after an independent blind review of
revision (a) returned NEEDS REVISION with four BLOCKERs, three of which the
orchestrator re-verified against the tree; adds defect 4, corrects the step-2
checkpoint, and resolves a self-contradiction in revision (a))
**Related:** LLP 0283 (F-1), LLP 0284, LLP 0225, LLP 0276, LLP 0214, LLP 0264,
LLP 0059, LLP 0053, LLP 0143, LLP 0189, LLP 0232, LLP 0041

> **Status note (2026-08-20).** §2 author rulings 5-7 changed this spec's direction. The
> diagnosis, the threat model (§1, §3), the defect analysis (§4, §5) and the risks (§8) still
> stand and are still the best statement of the problem. **§6's fifteen-step migration is no
> longer the plan for the forgery half** — ruling 5 directs deleting and rebuilding the
> authority-creation surface rather than migrating it, on the basis that no current users
> depend on stability (`CLAUDE.md:160`). Read §6 steps 5-15 as historical intent. LLP 0291
> enumerates the real surface; a superseding design is in progress.

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

4. **Stop patching forgery paths; design the chokepoint (author ruling 2026-08-20).**
   After four independent review rounds each found a *different* authority-forgery route
   rather than a variant of the previous one, the surface was enumerated as
   **LLP 0291**: 30 no-feature forgery families, 16 more behind additive features, **no
   existing chokepoint**, and authority creation split across roughly eleven independent
   mechanisms. That materially exceeds what §6 step 6 anticipated — converting four
   admissions — so §6 step 6 as written **understates the work** and should be read together
   with LLP 0291.
   The ruling: stop converting admissions one at a time, and design a single
   chokepoint through which every authority-increasing durable write must pass. Two
   independent blind designs were commissioned from different model families, matching the
   provenance discipline this spec itself used.
   Consequences: the partial `ResolvedPrincipal` work on `lane/f1-forge` is held pending that
   design — LLP 0291 records that as specified it would *add* to the surface rather than
   replace it — and publication stays blocked, as it was.

5. **Go directly to the end state; break compatibility (author ruling 2026-08-20).**
   Asked whether there is "a faster, straighter path to the best place to end up" if we are
   willing to break backwards compatibility, jettison code, and leave parts of what we have
   written behind, the author ruled **yes — take it.**

   The licensing fact is `CLAUDE.md:160`: *"No current users depend on stability; expected
   users are agents who read the docs."* 14 of 16 crates are `publish = false`, and LLP 0283
   records that npm publication was deliberately not performed after the rearchitecture. Much
   of the planning in this spec — staged migration, derivation from existing state, census
   before change — buys compatibility for an installed base that does not exist, and pays for
   it in machinery and in eleven review rounds of the *"moved it one API earlier"* failure.

   Direction, binding on the remaining F-1 work: prefer **deleting and rebuilding** the
   authority-creation surface over migrating ~46 families one at a time. Prefer the simplest
   correct end state over the most compatible path to it. Where a step in §6 exists only to
   preserve something not worth preserving, drop it.

   Two constraints survive this ruling and are NOT relaxed: anything **already published** to
   npm is immutable forever (LLP 0041), and **durable local databases** — demos, dev
   instances, fixtures, goldens — are real, though mostly regenerable. Everything genuinely
   broken must be enumerated rather than waved at.

   **This spec's §6 step list is therefore no longer authoritative** for the forgery half. A
   superseding design is being produced; until it lands, §6 steps 5–15 should be read as
   historical intent, not as the plan.

6. **Q1 — `config.verify` becomes an exact but powerless probe lane (author ruling
   2026-08-20).** Option Q1-C. `Anonymous` and `System` already produce the same empty
   handler-auth projection, so the privilege is removed without changing what probes observe,
   and LLP 0036 treats probes as ordinary actions with an implicit secret grant rather than
   internal services. Under ruling 5 the compatibility caveat — that no census can prove some
   deployed app relies on a `System`-only downstream effect — no longer binds. Zero `schemas/`
   drift.

7. **Q2 — the administrator trust anchor is required outright (author ruling 2026-08-20).**
   Option Q2-A, chosen over Q2-B specifically because of ruling 5. Q2-B's automatic derivation
   from an existing canonical token file exists to avoid breaking installed instances, and
   pays for it with exact-mismatch, backup, restore, fork and rotation rules. With no
   installed base to protect, requiring explicit provisioning is both simpler and stronger:
   protected erasure fails closed with a stable diagnostic until an administrator provisions
   the owner-only anchor from the raw token under the instance lock. No grace period, and no
   digest-at-open fallback — the latter is substantively what §8 risk 2 already forbids.
   Zero `schemas/` drift.

8. **LLP 0290 accepted; step 8 unblocked (author ruling 2026-08-20).** The
   `AuthorizationCommitParticipant` specification went through the LLP 0005 loop — an
   independent grok-4.6 review of revision (a) returned NEEDS REVISION with four load-bearing
   gaps, revision (b) closed them, and the same reviewer returned READY. §8 risk 4's two named
   failure modes are closed **at the specification level**, and the author accepted it, so
   **§6 step 8 is UNBLOCKED**.

   Acceptance does not assert the design compiles. Compilation and borrow-shape validation,
   complete producer/caller coverage, exact outcome-lookup uniqueness, and the kernel-opaque
   receipt question remain open, and §8 risk 7's "nothing was ever compiled" debt is inherited
   by the implementation.

   One defect the review caught is worth recording here, because it is risk 4's exact failure
   mode: revision (a)'s `bind` took a **caller-supplied** `ready_registry`, so a kernel helper
   could have passed the reservation's own `Arc` and collapsed the A-beside-B check entirely.
   Bind is the real check, and it must read kernel-owned state.

   Step 8 may run in parallel with the LLP 0292 chokepoint work: 0292 rebuilds authority
   *creation* and preserves LLP 0059's room/outbox/rollback/ambiguity algorithms, while step 8
   moves the room-authority *mechanism* into the kernel.


9. **Go to the best final state; do not weigh short-term breakage (standing author ruling
   2026-08-20).** Asked to settle two narrower questions, the author ruled generally:

   > "Just do whatever the most correct and elegant and best final state thing is. Don't worry
   > about backwards compatibility or breaking things in the short term. Just go straight to
   > the best possible product."

   This generalizes ruling 5 from the authority rebuild to the whole program. Where a design
   choice trades correctness or elegance for compatibility, migration convenience, or avoiding
   short-term breakage, **take the correct one**. The licensing facts are unchanged:
   `CLAUDE.md:160` records that no current users depend on stability, and 14 of 16 crates are
   `publish = false`.

   The two constraints that still bind are unchanged and are NOT relaxed by this: anything
   **already published** to npm is immutable forever (LLP 0041), and **durable local
   databases** are real though mostly regenerable. Breakage must still be enumerated, not
   waved at.

   Two questions resolved under it immediately:

   **(a) `ServingDatabase` loses `Deref` entirely.** Read-only `Deref` was the weaker option
   and survives only under a standing proof obligation — *every* authority-bearing shared
   method must be private or powerless, forever, including methods not yet written. This
   program has already paid for that twice: `checkpoints_read()` erasing protected records and
   `versions_read()` pruning history, both reachable from a shared borrow, and then two
   `*_for_test` methods that DROP tables. Each was found by review, not by a gate, because the
   gate can only check it by enumerating a 111-row census that goes stale the moment someone
   adds a method.

   Removing `Deref` converts that standing obligation into a structural impossibility, and
   turns the LLP 0284 property from "audit every `&self` method forever" into "there is no
   blanket dereference." `Deref` existed to let thousands of `self.db.*` sites compile
   unchanged during a migration — and under ruling 5 there is no migration to ease, because
   the surface is being rebuilt. It has no remaining justification. Every access becomes an
   explicit `ServingDatabase` method that derives what it needs.

   **(b) The D-4 claim-relevant gate set is DERIVED, never copied.** LLP 0283 F-3 already says
   to derive it rather than copy the historical release list, and the correct final state is a
   set computed from what the closure actually claims — so a gate becomes claim-relevant by
   construction rather than by having appeared on a previous list. A copied list is stale on
   arrival, which is the same failure as LLP 0289's frozen `scripts/` census (measured 1,663,
   then 1,695, then 1,696 within one day) and the drift-gate count that was wrong twice.

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
   (`crates/snapback-engine/src/local/engine.rs:6132`) is a feature-selectable
   public API that **clones the authority onto a second writable handle of a
   serving store**. It is the sharpest single instance and is easy to miss.

## 5. Per-defect closure design

### 5.1 Defect 1 — the publicly claimable authority root

**Structural half (cheap, and insufficient on its own).**
`KernelCommitAuthority` (`crates/snapback-kernel/src/storage.rs:538`) conflates
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

**Also required, and dropped in error from revision (a).** The synthesis
compressed the codex design and lost a load-bearing requirement, which the blind
review caught. `InvocationGate::prepare_admitted_authority`
(`crates/snapback-sync/src/auth/invocation.rs:1940`) is **public** and accepts a
caller-supplied `ResolvedAppAuthority` plus an `AdmissionLease`, validating only
the lease's counters and mode. A caller can mint its own controller and lease via
`AdmissionController::new` / `admit`
(`crates/snapback-auth/src/auth/admission.rs:227`, `:366`) and hand in `System`.
Two engine staging APIs then produce `System` authority for the victim instance
and do **not** require `self.admission.owns_lease`:
`stage_action_invocation_with_admission`
(`crates/snapback-engine/src/local/engine.rs:20912`) and
`stage_job_action_invocation_with_admission` (`:20935`). The legitimate server
cron/job paths hold real claim carriers but discard them when calling these
generic methods (`crates/snapback-server/src/server.rs:3176`, `:3384`).
**Delete the public `prepare_admitted_authority` and both generic staging APIs,
replacing them with exact durable cron/job claim operations.** The private
`execute_cron_claims` path (`:25631`) is already tieable to durable work — its
`AdmittedCronClaim` has private fields and is created only after scheduler state
is persisted — and is the model to follow.

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
  **Sizing corrected in revision (b): ~1068 production lines, not ~700.** The
  auth-owned `ServiceAuthorityPublication`
  (`crates/snapback-auth/src/auth/service_fence.rs:72`) and
  `ServiceAuthorityExternalEffectPermit` (`:83`) both hold
  `Arc<ServiceAuthorityDomain>`, so once the domain is kernel-`pub(crate)`
  `snapback-auth` cannot name it — the domain-dependent publication and permit
  carriers must move or be redesigned with it. The coupled region spans roughly
  lines 60–1127 before tests.
  **Widening the registry instead is NOT a shortcut and must be refused:** the
  registry is today `pub`, `Clone`, and `Default` (`:574`), and `register`
  (`:738`) accepts a caller-created `ServiceAuthorityWitness` whose fields are
  all public (`crates/snapback-types/src/auth/service_authority_contract.rs:18`).
  Keeping caller-owned registry installation merely replaces closure laundering
  with a caller-selected concrete registry. The registry must be
  **database-owned and non-substitutable**.
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

**F-1 implementation note (2026-08-19).** Tiers 2–3 widen the LLP 0276
matrix deliberately: `snapback` and the new rank-7 `snapback-harness` may name
`rusqlite` as dev-dependencies, so the workspace-graph gate sees the physical
test authority and ordinary downstream dependency graphs do not inherit it.
LLP 0276's crate table and external-confinement rule are amended in the same
round. After this round `crates/snapback-engine/src/push/authority_tests.rs`
is the **sole** remaining `snapback_services::test_support` consumer, and
`crates/snapback-engine/Cargo.toml`'s `remainder-tests` activation is the sole
remaining feature activation — that exact census is what the final deletion
step in tiers 4+ must burn down. Typed telemetry replacements preserve their raw-SQL predecessor's
projection: exact-count and physical-row assertions use an insertion-ordered,
unbounded `telemetry_events` probe (so wrong-generation, retention-hidden, and
row-501 duplicates remain visible); the few predecessor queries that used
`telemetry_events_visible` use a separate unbounded visible-view probe.

The intermediate state intentionally adds **no** separate caller-selectable
`snapback-services/test-support` feature. All services seams needed by these
tests remain behind the already conspicuous `remainder-tests` feature until
steps 10–14 delete both that feature and `snapback-services::test_support`.
This avoids creating a smaller second door to mutators such as
`replace_store_for_test` and `fail_next_config_update_for_test`; it does not
claim that the surviving `remainder-tests` door is confinement.

Then delete `snapback-services::test_support`, the `remainder-tests` feature, and
all four dev-dependency activations. Every `test-support` privilege seam demotes
to `#[cfg(test)]`, **including `open_commit_graph_sibling_for_test`** (§4.5).

### 5.4 Defect 4 — forgeable privileged membership writes (NEW; not in LLP 0283)

Found by the blind review of revision (a) and re-verified by the orchestrator.
It is the same anti-pattern as the other three and is **live today**:

```rust
// works today from any crate that depends on snapback-kernel
let mut db = LocalDatabase::memory()?;             // pub (storage.rs:1805/:1844)
let writer = MembershipWriter::Admin;              // pub UNIT variant
let plan = db.membership_plans()                   // pub, &mut self (storage.rs:1741)
    .plan_privileged_membership_insert(&writer, table, values)?;
db.membership_plans().commit_membership_plan(&writer, plan)?;
```

- `MembershipWriter` is a `pub` enum with `pub` variants
  (`crates/snapback-kernel/src/storage.rs:13520`). Privileged insert requires
  `Seed | Import | Admin` (`storage/membership_plans.rs:388`); `System` does
  **not** qualify.
- The plan-time authority check is only
  `writer.is_privileged_noninvocation()` — the **caller-selected enum**, which
  is LLP 0283 Method lesson 1's "public enum as authority."
- Commit-time guards do run inside the transaction
  (`revalidate_sanctioned_membership_write`, `storage.rs:14620`), but they
  re-check **resource existence and protected-role eligibility only**. They do
  **not** re-derive the writer class. Provenance is then recorded straight from
  the caller's own enum (`Admin` → `"hostOps:dataEdit"`, `storage.rs:13688`).

**Classification (corrected after review).** An earlier draft of this section
claimed reachability "from a shared borrow" and named `MembershipWriter::Admin { .. }`.
Both were wrong: planning needs `&self` but committing needs `&mut self` via
`membership_plans()`, and `Admin` is a unit variant. More importantly, because
`LocalDatabase::memory()` and `open()` are themselves `pub`, an attacker never
needed to borrow anyone's handle — which per §1's stated non-threat means this
is **not** an Attacker-A "obtain write access" defect.

It is an **Attacker C** defect, the class §3 calls the one that actually
matters: a module inside an already-trusted crate can cause the kernel to
**durably record an authority fact the kernel never verified** — a membership
row stamped with `hostOps:dataEdit` provenance and a caller-chosen
principal/role/resource. The receipt lies about who authorized it.

**Closure.** Derive the writer class from a `ResolvedPrincipal` (§5.1) inside
the kernel, make the privileged variants non-constructible outside it, and
re-derive the writer class in the commit-time revalidation rather than trusting
the passed enum. Note that removing `DerefMut` (§8 risk 6) independently closes
the route through a *serving* database, which is the case that matters most;
the standalone-handle case is closed only by making the variants
unconstructible. This defect must be added to LLP 0283 F-1's list and covered
by LLP 0284's gates.

## 6. Migration order, and the trap in it

Each step must leave `cargo check --all-targets --workspace` green.

1. Freeze behavioral evidence: authority/fence test inventory, protected-erasure
   receipt fixtures, push and pending-effect SQL traces, and a hash of `schemas/`.
2. Split `DatabaseBinding` out of `KernelCommitAuthority`; reroute the ~15
   non-privileged consumers.
   **Checkpoint (corrected in revision (b)).** Revision (a) said mentions of
   `KernelCommitAuthority` outside `snapback-kernel` must drop "from ~20 to ≤ 6."
   **The real count at `ede899a20` is 7, not ~20** — both source designs
   overcounted and the synthesis propagated it. A `≤ 6` threshold is therefore
   nearly vacuous: changing any single mention passes it while every binding
   consumer stays untouched. Replace the scalar with an **exact residual-site
   allowlist**. The 7 sites are:
   `snapback-auth/src/auth/service_fence.rs:1118`;
   `snapback-engine/src/push.rs:33` and `:49`;
   `snapback-engine/src/local/engine.rs:3195`, `:24221`, `:29838`, `:34676`.
   The checkpoint passes only when each named site is either gone or
   demonstrably carrying `DatabaseBinding`, and when the **semantic census** of
   the 33 lowercase `kernel_commit_authority` identifier occurrences outside
   the kernel has been walked individually (30 in `engine.rs`, 2 in
   `push/authority_tests.rs`, 1 in `auth_room_kick_acceptance.rs:1693`; zero in
   `snapback-auth`, `-server`, `-sync`, and `snapback`). Count thresholds are not evidence.
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

**Transactional rule (corrected in revision (b)).** Revision (a) contradicted
itself: §1 required facts to be re-derived "inside the same transaction" while
§6 required authorization to run *before* the transaction with SQL ordering
unchanged. Those are incompatible, and the pre-transaction reading is unsafe —
today erasure admission stuffs caller strings into `from_admitted_facts` at
`crates/snapback-kernel/src/proof_checkpoint.rs:786` while `BEGIN IMMEDIATE`
occurs later at `:2937`, so a credential can be **revoked between verification
and commit** and the erasure still commits on the stale fact.

The contradiction resolves in favor of atomicity: **admission facts are
revalidated inside the committing transaction**, and the resulting read-shape
and statement-order changes to the *admission* path are explicitly permitted
and reviewed, not forbidden. An equivalent versioned compare-and-commit
protocol (verify outside, re-check the durable generation/revocation counter
inside the transaction, abort on mismatch) is acceptable and may be cheaper —
but *some* in-transaction check is mandatory. The unchanged-SQL constraint
continues to bind every **non-admission** path: no step may add a JOIN or
change an existing canonical read shape elsewhere. Zero `schemas/` drift is a required invariant throughout — it already
caught one wire-contract regression during the carve (LLP 0283, Method lesson 5).

## 7. Verification

The mechanical properties a gate must assert are specified in **LLP 0284**, which
is independently authored and governs the gate suite. This spec does not restate
them. **LLP 0284 lands on its own branch (`lane/0283-b-gates`) with the gate
rewrite; this spec's §7 is unsatisfiable until that lands, and F-1
implementation must not begin before it does** — the whole point of F-2 is that
the implementer must not also author the check.

Revision (b) adds one requirement to LLP 0284's scope: the preserved source
design's "Deref containment" property checked public `LocalDatabase` **return
types** only, which would miss §5.4's `MembershipWriter` **parameter**-based
forgery. The gate must inspect privileged parameters and effects, and adoptable
`LocalDatabase` returns, not just return types. Two constraints propagate here:

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
4. **The room-authority move — revision (a) aimed this risk at the wrong
   entanglement.** The review established that `prepare_unbound` does **not**
   reach `collections`, `authorization_issuer`, or `expiry_index`; it only
   delegates into registry state
   (`crates/snapback-sync/src/ephemeral.rs:3586`). The real coupling is in
   `reserve_authorization_commit` (`:4603`), the binding checks (`:4213`), and
   publication/resync (`:4690`); `expiry_index` is not on this path at all.
   The blocking constraint is different and harder: the same registry implements
   `drain_outbox` using sync-private `SharedOutbox`, `ConnectionEffectFence`, and
   `AdmittedRealtimeEnvelope` (`:3790`), which **cannot** move into rank-1
   `snapback-kernel`, and `snapback-sync` cannot add inherent methods to a
   kernel-owned foreign type. So step 8 requires a sync-owned outbox rewrite
   alongside the move. The core is ~713 lines (`:3250`–`:3962`) plus
   reservation/finalization integration.
   **Before step 8 starts, `AuthorizationCommitParticipant` must be specified
   concretely:** its fields, constructor custody, database binding, and exact
   prepare/bind/finalize methods. Without a database binding, a participant from
   database A can be installed beside database B and suspend the wrong rooms;
   without exact methods, callbacks reappear to bridge settlement and defect 2
   returns.
5. **`ReadLane` is `Clone` and carries the authority today.** After step 2 it
   carries only a binding. If a read path depends on the read lane minting a
   System push authority, that path is an escalation *today* and will surface as a
   compile error. Treat it as a finding, not as a reason to re-widen.
6. **`ServingDatabase::adopt` and `DerefMut` — revision (a) was WRONG here, and
   the review was right.** Revision (a) argued `adopt` could stay public because
   "the caller who opened the file already has write access." That defence fails:
   `LocalDatabase::detached_read_snapshot(&self) -> SnapbackResult<Self>`
   (`crates/snapback-kernel/src/storage.rs:2108`) mints an **owned** database
   from a **shared** borrow, with a fresh identity and
   `commit_authority_claimed: false`. Through `Deref`, a caller holding only
   `&ServingDatabase` can therefore manufacture an adoptable database **without
   ever opening a file**, retain it across a revocation, and later adopt it to
   derive privileged facts from stale copied rows — a second authority graph
   created from a read borrow.
   **Required:** `adopt` must not accept a detached snapshot (give the snapshot a
   distinct non-adoptable read-only type); **`DerefMut` is removed**; and every
   privileged inherent method reachable through `Deref` — starting with
   `membership_plans_read` (§5.4) — moves behind explicit `ServingDatabase`
   methods that re-derive authority. Note this is not a hypothetical "future
   privileged method": §5.4 is one that exists today and needs only `&self`.
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
