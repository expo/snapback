# Callback-site lock sweep: is there a third inverted edge?

Status: Open
Created: 2026-08-25
Area: concurrency, authorization, SQLite, lock-rank enforcement
Related: `issues/shelved/20260826-lock-rank-permits-the-inversions-it-should-reject.md`, LLP 0059, LLP 0290, LLP 0303

## Question

Is there a third inverted lock edge hidden behind code that the lock-owning
callee does not control: caller-supplied closures, trait dispatch, commit hooks,
finalizers, or iterator adapters?

## Method

I treated a call boundary, rather than a lock acquisition, as the unit of
review. I searched all Rust sources under `crates/` for `Fn`, `FnOnce`,
`FnMut`, `dyn Trait`, generic trait bounds, iterator closure adapters, SQLite
transaction creation, ranked-lock entry, ordinary mutex/RwLock acquisition,
and Local/process guard entry. The raw pass found 426 `Fn*` declarations and
832 lock-like calls. A lexical co-location filter left 53 production functions;
manual tracing through helpers such as `lock_state()`, `StreamFence::lock()`,
and the writer gate added the abstraction-hidden sites.

The table below groups 93 concrete call expressions into 32 extension-point
families. “Sites” is the number of concrete invocation expressions represented
by the row, not the number of callers of the containing function. I followed
each generic/private helper to its present callers. Test-only hooks remain in
the table when they execute under a production-shaped guard, because they
still describe what the callee permits.

I used the same standard as the known membership edge: a cycle is real when
existing public surfaces can be composed around the same lock objects and the
same SQLite file. It need not already occur in a first-party request handler.
“Benign” means the current call set is closed and controlled, the callback runs
after the guard drops, or no waitable guard is actually retained. “Unconfirmed”
means I could not prove either a reverse edge or a closed call set.

The governing constraints are stricter than the implementation: LLP 0059
forbids topology, stream/session, registry, room/notifier, and other process
locks beneath Local/provider/SQLite; LLP 0290 §7.1 says no participant,
registry, room, notifier, or outbox lock may be held while entering Local or
SQLite. LLP 0303’s second-handle ruling makes per-handle safety insufficient.

## Enumeration

| # | Sites | Call site(s) | Held at the call | What the callee can acquire or wait for | Classification |
|---:|---:|---|---|---|---|
| 1 | 11 | `crates/snapback-server/src/server.rs:381`; `crates/snapback-server/src/server/writer_gate.rs:434`, `:568`, `:643`, `:712`, `:732`, `:822`; `crates/snapback-server/src/server/commit_capsule.rs:840`, `:888`; `crates/snapback-engine/src/local/engine.rs:10402`, `:10433` | Managed `LocalSnapback` mutex and `LocalSnapbackWriteScope` (or the direct equivalent); capsule callbacks also retain their prepared authority carriers. | Arbitrary synchronous `LocalSnapback` work, including SQLite and captured ephemeral/process APIs. | **Real, known family.** This is the Local side of edge 1. Several helpers are crate-private with controlled callers, but public `server::with_snapback` at `server.rs:178` makes the boundary caller-chosen. |
| 2 | 7 | `crates/snapback-kernel/src/storage.rs:6574`, `:6591`, `:6592`, `:6949`, `:7531`, `:7546`, `:7547` | An IMMEDIATE SQLite transaction; after `before_commit`, its returned guard also remains live through COMMIT. | `check_live` and `before_commit` can acquire any captured process lock; the public engine surfaces originate at `crates/snapback-engine/src/local/engine.rs:20509` and `:21143`. | **Real, known family.** `before_commit` is edge 2. Present `check_live` callers are bounded lifecycle probes, so those five expressions are benign in the current call set. |
| 3 | 7 | `crates/snapback-kernel/src/storage/auth.rs:1967`, `:1968`, `:1969`, `:2014`, `:2047`, `:2053`, `:2102` | An IMMEDIATE auth SQLite transaction; `:1969` additionally holds the returned commit guard, and the service-terminal form has a prepared process ticket. | Transaction bodies are kernel-chosen today. The commit hooks can acquire rank 50 or any captured process lock. | **Mixed: known edge-2 sink plus benign current bodies.** `:1968` and `:2053` repeat the rank-50-under-SQLite shape; `:1969` is test-observation only. |
| 4 | 5 | `crates/snapback-kernel/src/storage/asset_reads.rs:224`, `:225`; `crates/snapback-kernel/src/storage/asset_attempts.rs:484`, `:485`, `:487` | An IMMEDIATE SQLite transaction; at `asset_attempts.rs:487` SQLite has committed but the caller’s commit guard is still in scope. | Transaction body or commit hook can call captured code; `after_commit` can acquire below the retained guard. | **Mixed.** The `before_commit` expressions are edge-2 siblings. Bodies and the production `after_commit` closure have a closed kernel call set; the nontrivial observer is test-only. |
| 5 | 2 | `crates/snapback-kernel/src/storage/settlement.rs:148`, `:510` | An IMMEDIATE SQLite transaction. | A `BeforeCommit` closure. | **Benign current call set.** Both helpers are private and production supplies only `|| Ok(())`; keep them in any mechanical inventory because their types permit more. |
| 6 | 4 | `crates/snapback-kernel/src/storage/auth_mode.rs:292`; `crates/snapback-kernel/src/storage/membership_reads.rs:14`; `crates/snapback-kernel/src/storage/asset_maintenance.rs:114`; `crates/snapback-kernel/src/storage/auth_invalidation.rs:1064` | An IMMEDIATE SQLite transaction. | Generic transaction-body code. | **Benign current call set.** All four helpers are private and every caller supplies kernel-owned row logic. |
| 7 | 3 | `crates/snapback-kernel/src/storage.rs:8385`, `:8388`; `crates/snapback-kernel/src/storage/connections.rs:577` | An existing or newly opened deferred SQLite read transaction; `connections.rs` also retains a checked-out pooled reader. | The read callback can acquire any captured process lock or enter another database handle. | **Unconfirmed.** `ConnectionPool::with_pinned_read` is public (`connections.rs:569`). WAL read snapshots do not ordinarily block the single writer, but schema/checkpoint and non-WAL behavior need a specific wait-cycle proof before calling this a real edge. |
| 8 | 9 | `crates/snapback-kernel/src/storage/migration_executor.rs:2853`, `:2869`, `:3079`, `:3097`, `:3136`, `:3610`, `:3730`, `:3840`, `:3901` | A migration SQLite transaction. | A `dyn Fn` journal-step implementation. | **Benign current call set.** The trait object looks open locally, but it is privately constructed by the migration executor and only records journal state in the supplied transaction. |
| 9 | 3 | `crates/snapback-kernel/src/fork_promotion.rs:1647`, `:4980`, `:5416` | A branch or canonical SQLite transaction. | Generic replay/execution code. | **Benign current call set.** The entry points are `pub(crate)`, their callers are fixed engine paths, and the promotion context intentionally exposes no general SQL seam. |
| 10 | 2 | `crates/snapback-kernel/src/storage/auth_invalidation.rs:164`, `:182` | File-backed form: the private invalidation connection mutex and an IMMEDIATE SQLite transaction. Memory form: neither. | `InvalidationBootIssuerReservation::with_current_issuance` accepts arbitrary caller code (`auth_invalidation.rs:280`). It can acquire every ranked/process lock. | **Real composition enabler, not a separate counted lock family.** It supplies the SQLite→process-lock half for several rows below. `#[doc(hidden)]` does not make it private. |
| 11 | 2 | `crates/snapback-sync/src/auth/session_projection.rs:693`, `:711` | Rank 20 stream; rank 20 plus rank 30 session on `:711`. | Any public synchronous API, including rank 10 topology or SQLite. `AuthorizationCoordinator::premark_stream_reset_if_drained` takes topology at `coordinator.rs:1100` and then stream at `session_projection.rs:2456`. | **Real, new edge 3 (high confidence).** A `FencedPublication` callback can call that public coordinator method: rank 20→10 is immediately inverted, then the nested topology→stream path self-deadlocks in release. The comments at `session_projection.rs:466` prohibit this behavior but the type does not. |
| 12 | 1 | `crates/snapback-sync/src/auth/coordinator.rs:279` (delegation after state extraction; state mutex acquisition is `:265`) | The one-shot `CommittedAuthOutcome` state mutex has already dropped because `.take()` produced owned state. | Ultimately the `FencedPublication` callback above. | **Benign near miss.** It inherits row 11’s risk but does not add the outcome-state mutex to it. |
| 13 | 1 | `crates/snapback-server/src/server.rs:8806` | Ranks 20/30 through `FencedPublication`, then rank 40 connection registry. | The private `act` closure could acquire SQLite or a lower rank. | **Benign current call set.** `PreparedConnectionAct::try_act` is private and all callers perform bounded writer/outbox acknowledgements in the documented order. It should still require an allow annotation. |
| 14 | 3 | `crates/snapback-server/src/server.rs:7467`, `:7573`, `:7635` | Rank 40 connection registry. | `FnMut` invalidation hooks; current implementations install a notifier terminal marker. | **Benign current call set.** The three inner methods are private and their only non-test hooks are fixed terminal installers; no SQLite/provider call was found. |
| 15 | 1 | `crates/snapback-engine/src/local/engine.rs:32472` | Rank 50 admission/controller-state mutex from `admission.rs:1113`–`:1118`. | A generic operation on `ServingDatabase`, hence SQLite. | **Benign only by closed call set; structurally forbidden by the amended rule.** The helper is private and its callers are retry-registry operations, but it demonstrates why rank 50 cannot remain generally permitted over database code. |
| 16 | 3 | `crates/snapback-auth/src/auth/admission.rs:1264`, `:1284`, `:1332` | A fail-closed `ModeTransitionGuard`; no controller mutex is retained across these calls. `:1332` also owns a projection admission lease, not its rank-50 effect mutex. | Durable commit and projection code. | **Benign as lock order.** These are process-state sequencing boundaries, but they retain no synchronous mutex or waiter-owning guard at the call. |
| 17 | 2 | `crates/snapback-auth/src/auth/service_fence.rs:393`, `:434` | `:434` holds the service-authority fence mutex and a domain-work permit; `:393` is re-entry beneath an already active publication witness. | Arbitrary public `publish` code, including SQLite. A SQLite commit hook can call the same `try_publish`. | **Real, new public-composition edge (medium confidence).** The handle is public and production-obtainable. This is service fence↔SQLite. |
| 18 | 1 | `crates/snapback-auth/src/auth/service_fence.rs:250` | A retained service-authority permit and thread-local active witness; no mutex. Terminal premark drains the permit counter. | Arbitrary synchronous work, including SQLite or a terminal operation. | **Unconfirmed.** It is a waitable process permit, but I did not prove a path that waits for its drain while retaining the same SQLite writer. |
| 19 | 1 | `crates/snapback-types/src/auth/rehearsal.rs:484` | Rehearsal live-authority `RwLock` read guard. | Arbitrary public `publish` code, including SQLite; a SQLite hook can re-enter the same authority. | **Real, new public-composition edge (medium confidence).** This is rehearsal-authority lock↔SQLite. |
| 20 | 1 | `crates/snapback-auth/src/auth/mailbox.rs:233` | Capture-mailbox state mutex. | Arbitrary public projection code, including SQLite; a SQLite hook can call `with_published` on the same mailbox. | **Real, new public-composition edge (medium confidence).** This is mailbox↔SQLite. The API comment at `mailbox.rs:216` states a narrower rule but the type does not enforce it. |
| 21 | 5 | `crates/snapback-kernel/src/auth/keyring.rs:185`, `:199`, `:216`, `:221`, `:430` | Auth-keyring backend mutex. | Public `operation`/`is_referenced` closures can enter SQLite; a SQLite hook can re-enter the same store. | **Real, new public-composition edge (medium confidence).** This is keyring↔SQLite. The production prune callback is itself a storage reference check, so the forward direction is not merely fanciful. |
| 22 | 1 | `crates/snapback-kernel/src/auth/keyring.rs:664` (reached while the backend lock from `:150`, `:179`, `:232`, or `:264` is held) | Auth-keyring backend mutex. | Caller-chosen `dyn RandomSource::fill`; a custom implementation can take SQLite or any lower process lock. | **Unconfirmed.** The provider publicly accepts a `RandomSource`, but in-tree production uses the lock-free OS implementation. This deserves a trait-dispatch allow annotation even if the custom-implementation threat model is rejected. |
| 23 | 2 | `crates/snapback-sync/src/ephemeral.rs:415`, `:422` | Delivery-notifier mutex. | `act_if_current` is public and can enter SQLite or any lower lock; a SQLite callback can re-enter the same notifier. `act_with_registration` is private with fixed callers. | **Mixed: one real new public-composition edge, one benign helper.** The new family is notifier↔SQLite (medium confidence). |
| 24 | 2 | `crates/snapback-sync/src/ephemeral.rs:1226`, `:6327` | Subscriber outbox mutex; `:1226` may also hold a publication-handoff permit. | A public caller-supplied offer closure, including SQLite or a blocking writer. | **Real, known edge-1 family.** `try_offer_projection_bound` is a second public callback site for the same outbox inversion, not a separate lock family. |
| 25 | 3 | `crates/snapback-sync/src/ephemeral.rs:2591`, `:2596`, `:2601` | The caller’s outbox mutex (the methods mutate `OutboundQueue` while the store guard is live). | `unwrap_or_else` invokes durable/ephemeral authority classifiers. | **Benign current call set.** The queue helpers are private and production supplies fixed, projection-only classifiers. They are exactly the iterator-adapter shape a mechanical check must see. |
| 26 | 4 | `crates/snapback-sync/src/ephemeral.rs:6810`, `:6831`, `:7331`, `:7340` | Room mutex at the first three; routing-map mutex at both observation branches, with the room mutex additionally at `:7331`. | Room mutation or observation callbacks. | **Benign current call set.** All helpers are private; the observation closure is an inert test hook and production room callbacks stay within room state. |
| 27 | 1 | `crates/snapback-kernel/src/data_patch.rs:413` | Public `DataPatchTokenStore` registry mutex. | The public `apply` closure can enter SQLite. Production does so at `crates/snapback-server/src/server.rs:26755`–`:26757`; a public SQLite `before_commit` hook can call `commit` on the same token store. | **Real, new public-composition edge (high confidence).** This is data-patch token registry↔SQLite, and one direction is already a production call. |
| 28 | 1 | `crates/snapback-sync/src/stream_attempt.rs:510` | Stream-attempt persistence-MAC-key mutex. | A closure over secret key material. | **Benign current call set.** The helper is private and its two callers only derive a verifier or authenticate a batch (`stream_attempt.rs:522`, `:540`). |
| 29 | 1 | `crates/snapback-engine/src/local/engine.rs:2711` | Connection-activity mutex. | Private `act` code; current callers enter ephemeral outbox operations. | **Benign current call set.** The helper is private, its closures do not enter SQLite, and documented order is activity→ephemeral. |
| 30 | 2 | `crates/snapback-engine/src/local/runtime_cost.rs:614`, `:632` (used under the observation-state mutex at `:732`–`:738`) | Runtime-cost observation mutex for the snapshot path; ordinary `&mut` ownership elsewhere. | Predicate/projection closures. | **Benign current call set.** All callbacks are fixed `Clone`/field predicates and private. |
| 31 | 1 | `crates/snapback-kernel/src/proof_checkpoint.rs:3171` | No SQLite transaction: the initialization transaction commits at `:3136` before `destroy` is called. | Filesystem destroy callback. | **Benign near miss.** The large function lexically contains both transaction and callback, but their lifetimes do not overlap. |
| 32 | 1 | `crates/snapback-services/src/assets_store.rs:110` | An open temporary file, but no ranked/process mutex or SQLite transaction. | File-writing closure. | **Benign / out of lock scope.** Retained to record why a source-level co-location detector must understand guard kinds, not just any resource lifetime. |

## Verdict

**Yes. There is a third real inverted edge.** The clearest one is
`FencedPublication`: public caller code runs under rank 20/30 and can call the
public rank-10→rank-20 stream-reset path. That is a direct ranked inversion and
a same-thread release-build deadlock composition.

Using the same public-composability rule by which the existing membership edge
is real, I found **seven new inverted lock families**:

1. stream/session ↔ topology (`FencedPublication`);
2. data-patch token registry ↔ SQLite;
3. keyring ↔ SQLite;
4. capture mailbox ↔ SQLite;
5. rehearsal live-authority lock ↔ SQLite;
6. service-authority fence ↔ SQLite; and
7. delivery notifier ↔ SQLite.

Together with the two known families, that is **nine real families** across
the 93 call expressions examined. Two of the seven new findings are high
confidence without depending on an obscure carrier (`FencedPublication` and
the production data-patch call). The other five are real under the prompt’s
public-composition standard, but I have deliberately labeled them medium
confidence because I did not compile a cross-crate state-construction witness
for each carrier.

I did not run a disposable executable witness. The static compositions above
are enough to establish the strongest two findings, and this checkout’s Ibex
runtime submodule is not initialized; repository policy requires bootstrapping
it before any cargo build or test. Breadth was more valuable than paying that
setup cost for five similar witnesses.

## Checker opinion

The checker can catch this class mechanically, but not by trying to infer what
the callback will do. It should flag the **boundary**: a ranked guard, SQLite
transaction, managed Local scope, or named process guard is live at a call
whose target is caller-controlled.

A useful first implementation is a Rust-aware lint over HIR/MIR:

- identify locals whose types are `RankedMutexGuard`, `MutexGuard`,
  `RwLock*Guard`, `rusqlite::Transaction`, `LocalSnapbackWriteScope`, and a
  short registered set of waitable process permits;
- track explicit `drop`, moves, returns, and branch lifetimes;
- while one is live, flag a call operand originating from an `Fn*` parameter,
  a `dyn Trait` method, a generic trait dispatch, or an iterator adapter fed by
  such a closure;
- also flag forwarding into a public method that accepts an `Fn*` while the
  guard remains live; and
- require a call-site annotation such as
  `#[allow(caller_code_while_locked, reason = "bounded projection-only handoff; no SQLite or lower rank")]`.

The allow should be local to the invocation, not the whole function, and the
reason should name both the held guard and the permitted callee effects. A
small source-level `syn` lint can cover direct `Fn*` calls, `.map`/
`.and_then`/`.unwrap_or_else`, and known guard constructors quickly. MIR is
needed for the writer-gate and helper-returned-guard cases, and no static lint
can prove that an arbitrary trait implementation is lock-free. That is not a
reason to skip the check: the correct result for trait dispatch is “annotation
required,” not “callee proved safe.”

The existing runtime rank stack remains valuable. It would catch the actual
rank-20→10 entry in row 11 in a debug build. It cannot reject the callback
boundary before the callback runs, cannot see arbitrary unranked process
mutexes, and does not model a SQLite transaction opened through a second
handle. The static boundary lint and runtime rank stack are complementary.

## Rank 50 under SQLite

**The permission must change, not the amended no-reverse-edge rule.**
`crates/snapback-types/src/exec_guard.rs:382`–`:390` explicitly exempts rank 50
by rejecting only ranks at or below 40 while Local is active. That exception is
what allows membership commit to take SQLite and then retain the admission
controller mutex through COMMIT. It contradicts LLP 0059 and LLP 0290’s
unconditional no-process-lock-under-Local/SQLite rule.

The checker should reject every ranked mutex, including rank 50, while a Local
or SQLite write scope is active. It also needs an explicit SQLite-transaction
depth sentinel at the kernel transaction constructors; `LOCAL_APP_WRITE_DEPTH`
alone misses second `LocalDatabase` handles. Any operation that currently
needs admission continuity across COMMIT must be redesigned as a lock-free
epoch/permit proof or split-phase validation before this stricter assertion is
enabled. Keeping the exception would preserve the exact reverse edge the
amended rule is intended to forbid.

## The single thing I am least sure of

I am least sure of the **exact count seven**, not of the “yes” verdict. The
keyring, mailbox, rehearsal, service-fence, and notifier cycles rely on
constructing valid live public carriers before composing them with the public
SQLite hooks. I traced their production creation and use sites, but did not
compile five separate adversarial witnesses. If this programme adopts a
stricter definition that requires a first-party production request path for
both directions, those five should be relabeled unconfirmed. The
`FencedPublication` and data-patch findings remain, so a third edge still
exists either way.
