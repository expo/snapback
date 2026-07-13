# LLP 0053: Authorization invalidation

**Type:** RFC
**Status:** Draft
**Systems:** Sync, Auth, Storage, API, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-12
**Revised:** 2026-07-12 (attempt six, after three rounds of the dual-model loop —
six designs, five rejected, **every defect found by independent review and none by
the author**. See §Motivation for the full failure history and §Changelog for what
each round changed; artifacts in
`reviews/0053-authorization-invalidation.{fable,codex}.md`. Split out of
[LLP 0039](./0039-auth-vertical-slice.rfc.md) §Permission dependencies on
2026-07-12.)
**Related:** LLP 0004, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0016, LLP 0020, LLP 0026, LLP 0032, LLP 0039, LLP 0043, LLP 0051

## Summary

When a user's permissions change, every client that could see the affected rows
must stop seeing them — promptly, and without the system quietly deciding a
change was irrelevant when it was not.

The central claim of this RFC is a **reframe**, and it is what four attempts at
this mechanism took to find:

> **Live correctness does not need an authorization taxonomy.** The matcher
> already wakes a subscription on any change to any table it reads, and the
> re-query re-applies whatever authorization the query expresses. A
> membership-gated query joins its ACL, so an ACL write wakes it. A "mine or
> public" query re-evaluates the row. A re-parented document touches a table the
> query reads. **Authorization epochs are not for this.**
>
> Epochs exist for exactly what the matcher *cannot* observe: **staleness across
> a disconnection**, **destruction of retained/offline data**, and
> **authorization events that involve no write the matcher sees** (a policy
> reload, an import, a reset). Note what is *not* on that list: a grant expiring
> on the clock. Nothing here observes that for a connected client, and
> §The authorization-event universe names it as a residual rather than pretending
> otherwise.

The reframe alone is not enough, and two further attempts were needed to see why.
**Computing the right answer is not the same as the client being unable to see the
wrong one.** So this document also pins **how the answer is delivered** — and
specifically that for an auth-scoped subscription, **a removal is a security event
and must be durably delivered, whatever caused it** (a lost removal leaves
forbidden data on a *connected* client's screen forever) — **what a client
resuming from any non-live state must do** (always resnapshot; the epoch cannot
witness a matcher-mediated visibility change, so it must not be asked to), and
**what bounds a client we cannot reach at all** (a lease — which bounds an honest
client and a hostile one not at all).

This RFC owns:

- **two orthogonal declarations** — result dependence and authorization
  dependence — replacing the exclusive classification that could never be made
  exhaustive;
- a **closed, enumerated authorization-event universe**, with a conservative
  fallback (anything unenumerable or opaque makes a query online-only, LLP
  0008's sanctioned escape hatch) rather than a taxonomy that must cover every
  app shape;
- a durable **authorization epoch**, advanced in the same transaction as its
  cause through **one commit hook used by every writer**, and paired with the
  authorization-stream incarnation LLP 0039 owns;
- **persistent, level-triggered invalidation obligations** — not queue messages,
  which the shipped queue can destroy or drop;
- **per-query client fences**, so a callback in flight cannot repopulate what an
  invalidation just destroyed;
- a **mandatory resnapshot on reconnect** for every auth-scoped subscription;
- an **`authorizedUntil` lease** — the only mechanism that can bound a client the
  server cannot reach.

[LLP 0039](./0039-auth-vertical-slice.rfc.md) is the umbrella (authority,
sessions, transport, and the client coordinator that *executes* what this
document defines). [LLP 0011](./0011-auth-and-permissions.rfc.md) is the parent
design; where it pins a contract, it wins. This RFC also closes
[LLP 0020](./0020-core-authoring-surface.plan.md) §Remaining Phase 4
("dependency vocabulary and auth epochs"), the corpus's long-standing owner-less
thread.

## Motivation

Authorization invalidation has two failure modes that pull against each other.
[LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) states the bar: *"false
positives are acceptable early; false negatives are correctness bugs."* A
revoked user who keeps receiving rows is not a performance problem. But
coarsening every write into a global resync — the obvious way to guarantee no
false negatives — destroys the incremental matcher and delta machinery the
corpus already built, and turns ordinary app use into a resync storm.

**Six attempts, and what each one taught.** This history *is* the argument for the
design below — it is the evidence for which mechanisms are load-bearing and which
are seductive dead ends — so it is recorded rather than buried:

1. **Coarse-on-any-auth-read.** Every write to any table an auth-scoped query
   read advanced a global epoch. Every ordinary todo write globally resynced and
   cleared every client. *Rejected: the storm.*
2. **Two-class load-time lint** (row-scoped, or permission-backing). Could not
   classify the card game at all: a membership-gated table is neither
   user-disjoint nor an ACL. *Rejected: not exhaustive.*
3. **Four-class model** (row-scoped / permission-backing / membership-gated /
   authority-independent). Two independent reviewers produced **three** shapes it
   cannot express: a table that is simultaneously the ACL *and* a shared roster
   (the classes conflate result-delivery topology with authorization impact —
   orthogonal axes); hierarchical visibility, where re-parenting
   `documents.folderId` changes authority **without writing the ACL**; and
   row-authorized sharing ("my docs OR public docs"), authorized by fields on the
   row with no backing table at all. It also missed writeless authorization
   changes entirely — a hot function reload narrowing a filter, a grant expiring
   on the clock. *Rejected: **classification is the wrong primitive**. Three
   unclassifiable shapes from two reviewers is not a gap to patch; it is evidence
   the enumeration will never close.*
4. **The reframe.** Stop trying to classify *how* authorization is expressed;
   let the matcher do what it already does correctly, and enumerate only the
   **events** that escape it. Both reviewer families kept this — for the first
   time, neither produced a shape the model could not express. But it was
   incomplete: it fixed *computation* and left *delivery* alone, and its epoch
   could not witness the very matcher-mediated changes it had just delegated to
   the matcher — so a **disconnected** client would compare an epoch that never
   moved and conclude its retained rows were still authorized. *Rejected as
   incomplete, not as wrong.*
5. **Completing the reframe.** Deliver over persistent obligations; make a
   reconnecting client **always resnapshot**; bound the unreachable client with a
   **lease**. Right in outline — but it bolted obligations onto the *enumerated
   events* and left the matcher path, which is where most authorization removals
   actually travel, riding the same lossy outbox. A `public → private` flip could
   therefore be **lost permanently while the client stayed connected**: no epoch,
   no obligation, no reconnect, no lease. *Rejected: the principle was stated and
   then not applied where it mattered most.*
6. **This document.** Apply the principle everywhere it holds: **negative deltas
   are obligations, positive deltas are best-effort** — for an auth-scoped
   subscription, the *shrinking of the result set is the security event*, whatever
   caused it. And stop overclaiming the lease: it bounds an honest offline client,
   and defends against a hostile one not at all.

The reframe is what attempt 4 bought: the shapes that broke every classifier —
mixed ACL/result tables, hierarchies, row-authorized sharing — require **no
special handling at all**, because each one's authorization is expressed *inside
a query over tables the subscription reads*, and the matcher already re-queries on
any change to those tables. What attempt 5 adds is the honest accounting of what
the matcher **cannot** do: reach a client that is not there.

## Design

### The one constraint everything follows from

**A client cannot validate its own authorization.** Whether it may see a row is a
function of data it does not have and must not have — the ACL rows, the
membership table, the folder hierarchy. So a client has exactly two ways to know
it is still allowed to hold what it holds:

1. **ask** — which requires being online; or
2. **trust a time-bounded assertion** — "authorized until T."

There is no third option. No cleverer cache, no better classification. This is
why the earlier attempts kept collapsing: each tried to preserve *both* full
offline capability *and* prompt revocation by being smart about which writes
mattered, and that is a trade with no dodge. It is the same wall certificate
revocation hit — CRLs (push a blocklist; goes stale), then OCSP (ask every time;
kills offline), then stapling (a short-lived signed assertion), then simply
short-lived certificates. **The industry stopped revoking and started expiring.**
So does this document.

### Three mechanisms, each doing only what it can

| The client is… | Mechanism | What it guarantees |
|---|---|---|
| **Connected** | The **matcher** wakes the subscription (the changed table is in its read set) and the re-query re-applies the query's authorization. **Any delivery that removes rows is obligation-backed** (below) | Correct by construction *and* durably delivered |
| **Reconnecting, or resuming from any non-live state** | **Mandatory resnapshot** of every auth-scoped subscription — unconditionally, without consulting the epoch | Correct: the server re-evaluates under current authority |
| **Offline, reading retained data** | **An `authorizedUntil` lease** — for an *honest* client. Against an adversarial one, nothing here helps (below) | *Bounded* for honest clients; **not** a defense against a hostile client |
| Authorization changed with **no write the matcher observes** — policy reload, import, reset | **Enumerated events** (below) advance the epoch | The matcher has no wake for these |

### Negative deltas are obligations; positive deltas are best-effort

This is the rule attempt five was missing, and its absence was a permanent false
negative: a `public → private` flip is an *ordinary write*, so it rides the
matcher, raises no epoch, and creates no obligation — yet its delivery goes over
the **same destructive-drain outbox that can lose a message**. The client stays
connected (so no reconnect resnapshot) and is online (so no lease applies).
**Nothing in the system would ever have corrected it.** The forbidden row stays
on screen forever.

The principle was already stated and then not applied where it mattered most:

> **Losing data is staleness. Losing a *removal* is a security failure.**
> Positive information self-heals — the next snapshot re-adds it. Negative
> information does not.

So, for an **auth-scoped subscription**, the *shrinking of the result set is the
security event*, and it does not matter **why** a row left — an ACL write, a
re-parented folder, a visibility flip, or an ordinary delete:

- A live delivery that **removes** any row the client is known to hold is
  **obligation-backed**: durable, level-triggered, and discharged only when the
  client **acknowledges** a snapshot computed at or after the causing commit
  version.
- **A re-query that ERRORS or DENIES is also a negative delta.** LLP 0011's
  *first* authorization layer is "function-level checks inside queries," and the
  natural authoring shape is a handler that throws when a membership lookup comes
  back null. A kick then wakes the subscription, the re-query **throws**, and the
  shipped path (`fail_subscription_fanout`) would emit a plain recovery resync —
  mapped to `retain`, i.e. *"keep showing current rows meanwhile."* The resnapshot
  throws too (still denied), so **"meanwhile" never ends**: forbidden rows persist
  on a connected client behind a failing resubscribe loop, with no epoch, no
  reconnect, and no lease. That is fail-open, and it is why denial is a third
  delivery class: an error or denial outcome on an auth-scoped subscription is
  obligation-backed with disposition **≥ `quarantine`**, never `retain`.
- A delivery that only **adds or updates** rows stays best-effort. Losing one is
  staleness, and the next successful delivery repairs it.

**"Auth-scoped" is defined fail-closed**, because the whole rule hangs on it:
**every subscription is auth-scoped unless its function is explicitly declared
`authorityIndependent`.** Undeclared means auth-scoped. A "declares auth
dependence" reading would hand best-effort removals to precisely the opaque,
online-only queries the conservative matcher is supposed to be protecting — which
is attempt five's defect wearing a different hat.

This closes the gap between the reframe and the outbox: the matcher may decide
*what* the client should no longer see, but it may not be trusted to *tell* the
client over a lossy channel. Obligations are how the removal gets there.

**Why reconnect must not trust the epoch — the hole attempt four had.** The
reframe says a matcher-mediated visibility change (someone re-parents a document
out of your folder) needs no epoch, because the matcher re-queries and delivers a
smaller result. That is true for a *connected* client — and it is exactly wrong
for a *disconnected* one, whose **only** staleness witness is the epoch. The
epoch did not move, so on reconnect the client would compare `(incarnation,
epoch)`, see a match, and conclude its retained rows are still authorized when
they are not.

The fix is not to make the epoch witness more. It is to **stop asking the epoch a
question it cannot answer**: an auth-scoped subscription **always resnapshots on
reconnect**. The epoch's job shrinks to what it can actually do — force
revalidation for the writeless events below, and gate retained reads — and
correctness for the offline case moves to the lease, where it belongs.

**"Reconnect" means every resumption from a non-live state, and it must cover
every materialized copy.** A socket reconnect is only the obvious one. The rule
applies to: process restart, page reload, tab close-and-reopen, a *second* tab
attaching to the same store, a service worker resuming, and any resume-from-
retained path. Each is a copy of the data that could otherwise be rendered
without revalidation. They are covered because the shared client
`AuthCoordinator` (LLP 0039) owns the store and its fences, and **no materialized
copy may render an auth-scoped result without either a live subscription or an
unexpired lease.** A tab that attaches to a store it did not populate inherits its
fences; it does not get a fresh, unfenced view.

**The epoch was never a coherence protocol.** Attempts one through four all
failed by treating it as one.

**Safe by default.** The matcher is conservative — when it cannot prove a change
irrelevant, it re-queries (LLP 0008). The one precision opt-in is the
disjointness skip, and it is opt-in precisely because it is the only way to
*lose* a wake:

- A query may declare `authScopeField` to claim its rows are user-disjoint, and
  the matcher will then skip other-users' changes. **This is the only
  declaration in the system that can cause a false negative**, so it is
  opt-in, it is checked (below), and it is never inferred.
- Honest note on what ships: the matcher honors `authScopeField` **only when it
  is literally `"userId"`**, and only as a *fallback* — captured read
  dependencies are consulted first and their verdict wins. Generalizing the
  field is this document's deliverable; the fallback-vs-captured precedence is
  pinned as an invariant: **class metadata may never override a captured
  dependency's verdict.**
- Because a lying `authScopeField` is the one unnetted false-negative channel, it
  carries an LLP 0008 L4-style convergence assertion (matcher verdict vs. full
  re-query) in test and dev profiles, and a query that declares it is
  **retainable only if the assertion is enabled in its acceptance suite**.

### Two orthogonal declarations

The attempt-3 error was one exclusive class per `(function, table)` pair, mixing
two independent questions. They are now separate, and **a table may be both**:

**1. Result dependence** — how a table's changes reach a subscription's result.
Declared by the read summary the system already computes, plus at most one
optional refinement:

- default: **conservative** — any change to a read table wakes the subscription;
- optional: `authScopeField` — the disjointness skip above.

**2. Authorization dependence** — whether a table's changes can alter *who may
see what*, independent of any result:

- default: **none**;
- `permissionBacking: true` — this table grants or revokes authority (membership,
  roles, grants). Optionally `permissionFields: ['role', 'expiresAt']`, so an
  avatar change to a `users` row that also carries `role` does not fire an
  authorization event. (`ChangedRow.changed_fields` already exists and the
  matcher already consumes it, so this is cheap and it defuses the common
  mixed-table shape.)

`gameMembers` is now simply *both*: it is in the roster query's read set (result
dependence) **and** `permissionBacking` (authorization dependence). No conflict,
no precedence rule, nothing to be exhaustive about.

### The authorization-event universe (closed)

An **authorization event** advances the authorization version. The universe is
**enumerated, not derived** — this is the substantive replacement for the
taxonomy, and its closure is what makes the safety claim checkable:

1. A committed write to a `permissionBacking` table (restricted to
   `permissionFields` when declared).
2. **Activation** of new schema, functions, or authorization metadata — a hot
   reload can narrow an auth filter and strand already-published rows with no
   data write at all. Auth-relevant metadata stages and validates as one bundle,
   then atomically activates *and* fires an authorization event.
3. `app.reset`, logical import, and declared physical restore.
4. Explicit out-of-band **permission** revocation — an admin/host-ops verb that
   strips a user's access (e.g. "remove this user from every group").

**Not on this list, and deliberately so: session revocation.** Logout, session
expiry, and admin *session* revocation are **authority transitions**, not
authorization events — they change *who the caller is* (authenticated → anonymous),
not *what a given user may see*. They are LLP 0039's, they run through its
`AuthCoordinator`, and they **delete** the client's retained data outright, because
a client with no authority may hold nothing. (An earlier draft said 0039's session
revocation "calls into" event 4, which would have routed a session loss through
this document's *coarse-event → quarantine* path and contradicted 0039's delete.
Two different things that sound alike: one ends an identity, the other narrows a
permission.)

**What is deliberately excluded, and how it stays safe:**

- **Clock-dependent authorization is forbidden in retainable and
  auth-resyncable queries.** `RuntimeNow` is expressible in filters today while
  the matcher has no clock or deadline wake, so an `expiresAt > now` membership
  would expire with zero writes and a live client would keep access
  indefinitely. Rather than build a deadline scheduler in v1, a query whose
  authorization depends on the clock is **online-only**:
  non-retainable, non-auth-resyncable, refused at manifest load with
  `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`. Apps expressing time-limited
  grants materialize expiry as a *write* (a sweep flipping `active`), which is
  event 1.
- **Opaque authorization dependence is online-only.** An Ibex handler that reads
  `ctx.auth` in JavaScript and filters in code declares nothing the lint can see
  (`ctx.auth` is a materialized input, not a host call, so it is invisible to
  capture). Such a function is not classified and **cannot be retainable** —
  which is LLP 0008's already-sanctioned escape hatch, and it is pinned here as a
  load-bearing invariant:

  > **Retainable ⇒ declared authorization dependence ⇒ enumerated events.**

  **This invariant is machine-enforced, not an honor system.** Attempt four
  asserted it and left it to authors, which made the whole online-only
  confinement — and therefore the whole safety argument — defeasible by a single
  omission. Retainability is instead a **manifest-load property**: a function is
  retainable **only if** its authorization dependence is fully expressed in
  declarable form (auth-variable filters, `authScopeField`, declared
  `permissionDependencies`, or an explicit `authorityIndependent`) *and* its read
  summary is complete. Anything else — an Ibex handler that reads `ctx.auth` in
  JavaScript, an empty read summary (which the matcher treats as "all tables"), a
  clock-dependent predicate — is **not retainable**, and marking it retainable is
  a load error (`SNAPBACK_AUTH_UNDECLARABLE_RETENTION`), not a warning. Opting
  into retention is opting into declaration.

  **What this enforcement does and does not prove.** It proves a declaration is
  **present**; it cannot prove the declaration is **true**. An author who declares
  `authorityIndependent` on a table that is not, or an `authScopeField` that is not
  user-disjoint, passes the load check and gets a false negative. That residual is
  real and is not papered over:

  - the **disjointness** claim (the only declaration that can *lose* a matcher
    wake) is truth-checked by the LLP 0008 L4-style convergence assertion —
    matcher verdict vs. full re-query — required in test and dev profiles for any
    query that declares it and is retainable;
  - the remaining declarations are **trusted assertions**, mitigated by the
    reference oracle (§Acceptance) and the doctor, not by proof;
  - so the honest formulation is: **declaration is enforced; truth is tested.**

  The honest perimeter, stated rather than overclaimed: this document does **not**
  claim unclassified auth dependence is impossible. It claims that anything
  unclassified is **structurally confined to the online path**, where the
  conservative matcher is the safety net — and that the confinement is enforced at
  load, not assumed.

**The event universe is closed for RETAINED data, and not for connected views.
Stated exactly, because the earlier version of this argument was a non sequitur.**

An unenumerated event source affects a query either (a) through data the query
reads — the matcher wakes it, mechanism 1, correct; or (b) through something the
query does **not** read. The earlier draft concluded (b) was safe because
undeclarable ⇒ non-retainable ⇒ online-only ⇒ "mechanism 1 again." **That last
step is false.** Mechanism 1 wakes on changes to data the query *reads*; a source
that acts through something it does not read never wakes the matcher, online or
not. Being online-only confines the *retained/offline* damage — which is real and
valuable — but it does **not** summon the matcher for a connected view.

So the honest scope of the closure claim: **an unenumerated event source cannot
corrupt retained data, and can leave a connected view stale.** The clock is the
concrete instance, and it is a **named residual, not a solved problem**: a
JavaScript `Date.now()`-mediated authorization predicate is undetectable at load
(`ctx.auth` is a materialized input, not a host call, and a JS clock read leaves
no trace), so it cannot be refused; and a connected client holding rows whose
grant expired keeps them **indefinitely** — no write, no wake, no reconnect. The
`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY` refusal catches only the *declarable*
form (`RuntimeNow` in an IR predicate). The remedy for the undeclarable form is
authoring guidance — **materialize expiry as a write** — plus a doctor
diagnostic, and it is guidance, not a guarantee. Apps that need
time-limited grants must sweep them into `active` flags; this document cannot
enforce that, and says so rather than pretending the closure argument covers it.

(The Summary's earlier phrasing listed "a grant expiring on the clock" among the
things epochs exist *for*; it is not, and that has been corrected.)

### The authorization version

A single durable `AuthorizationVersion { incarnation, epoch }`:

- **Advanced in the same transaction as its cause**, through **one commit hook
  used by every writer** — HostPlan, Ibex, seed, admin edits, import, reset. The
  shipped epoch map is process memory advanced *after* the commit, and seed uses
  a third transaction that does no epoch processing at all, so centralizing the
  hook is a prerequisite, not a detail.
- **The incarnation is [LLP 0039](./0039-auth-vertical-slice.rfc.md)'s, and this
  document consumes it.** It is an *authority-stream* anchor — regenerated on
  reset, logical import, and *declared* physical restore, and **persisted across
  ordinary restarts** — which are 0039's events, not this document's, and 0039
  already needs it for `app.reset` fencing and its restore procedure. (Keeping it
  here would have made 0039's landing items 3–5 secretly depend on this document,
  destroying the point of the split.) This document pairs it with its epoch as
  `(incarnation, epoch)` and requires only that a **missing incarnation forces
  resnapshot**.
- Comparisons — resume and retained reads — match `(incarnation, epoch)`; a
  **missing incarnation forces resnapshot**. (The shipped resume compares bare
  `u64`s with `!=`, so the naive `0 → 1 → reset → 0` sequence is already caught;
  the real ABA needs re-advancement to a previously recorded value —
  `0 → 1 → reset → 0 → 1` — which the incarnation closes.)
- **v1 has exactly one epoch: the global one.** Subject-scoped epochs are
  computed in shadow mode only (below). This deliberately moots the scope-key
  collision design, the coalescing design, and the old/new subject derivation —
  the last of which is not even implementable today, since `ChangedRow` carries a
  single row image, not an old/new pair.

### Invalidation is an obligation, not a message

The shipped outbox cannot carry a security consequence: `drain()` destructively
pops every message, HTTP drain is destructive, and once a connection is
`overflowed`, subsequent pushes early-return as no-ops until the next drain — so
a `delete` that *arrives while overflowed* is dropped outright, and a lost HTTP
response carrying the sole `delete` loses it **permanently**.

So invalidation is **level-triggered, persistent server state**, not an event in
a queue:

```
ResyncObligation {
  scope: subscription | connection | client,
  max_disposition: retain | quarantine | delete,   // monotone, only ever raised
  witness: (incarnation, epoch),                    // what authorization demanded it
}
```

**State machine, specified where the shipped queue failed:**

- **Identity.** One obligation per `(client, scope)`, keyed durably — not one per
  event. Repeated events **merge** into it (raising `max_disposition`), so a
  storm of membership writes produces one obligation, not a queue of them.
- **Durability — per scope, because one rule cannot cover all three.** The earlier
  blanket claim ("stored in the same transaction as the event that raised it") is
  *impossible* for the matcher path, whose removals are discovered **post-commit**
  in the fan-out. Instead:
  - **enumerated-event obligations** are written transactionally with their cause;
  - **matcher-path delivery obligations** are raised post-commit, and their crash
    window is closed by a *different* mechanism, which is now stated rather than
    assumed: a crash kills the connections, and every reconnect forces a mandatory
    resnapshot;
  - **client-scoped obligations against retained data** are genuinely durable —
    they must survive restart, because the data does.

  Subscription- and connection-scoped obligations die with their scope at restart
  anyway, so durably storing them buys nothing and would put a durable write on the
  fan-out hot path for no benefit.
- **Discharge — the only way out, and it is versioned by DATA, not by epoch.** A
  successful **superseding snapshot**, delivered *and acknowledged*, computed at a
  **commit version ≥ the version that caused the removal**. Not by having been
  sent; not by a drain; not by a timeout. An unacknowledged obligation persists and
  re-fires on the next wakeup.

  > **This is the correction that makes obligations mean anything.** An earlier
  > draft witnessed discharge with `(incarnation, epoch)` — which, by this
  > document's own design, **never moves for a matcher-path removal**. So a
  > snapshot computed *before* the removal (a racing resubscribe at version 99,
  > for a removal committed at 100) would "satisfy" the unchanged pair, discharge
  > the obligation, and leave the forbidden row permanently on a connected client:
  > the exact failure obligations were introduced to prevent, reproduced one level
  > up. The witness must be the **commit version**, because that is the only thing
  > that actually moves when a row leaves a result set.
- **Escalation.** `max_disposition` only ever **rises**. This fixes both orderings
  the shipped queue breaks: a `delete` arriving **while the connection is already
  overflowed** raises the parked obligation instead of being dropped (the shipped
  `overflowed` flag makes later pushes no-ops), and a resync emitted as a
  *substitute* for another — the fan-out failure path — inherits the disposition
  of what it replaced.
- **Wakeups are not the obligation.** Outbox frames become hints that an
  obligation exists. Losing one costs a round trip; it cannot cost the
  consequence. This is the level-triggered/edge-triggered distinction, and it is
  the reason the shipped destructive drain (`pop_front` before the send is
  confirmed) is not a safe substrate for a security signal.
- **GC.** An obligation dies with its subscription/connection scope, or on
  discharge. A client that never returns leaves an obligation until its lease
  expires and its retained data is unreadable anyway — at which point the
  obligation is moot and collected.
- This **supersedes LLP 0032 P4's** decision that destructive drain needs no
  acknowledgement because a later snapshot recovers it. That reasoning holds for
  *data* — positive information self-heals. It does not hold for a *revocation*:
  negative information does not self-heal on the delta path, and on the replace
  path it self-heals only if a next delivery ever arrives.

### Dispositions, with producers and meanings

| Disposition | Producer | Client obligation |
|---|---|---|
| `retain` | ordinary recovery resync (`outbox_overflow`, fan-out retry) | resnapshot; keep showing current rows meanwhile |
| `quarantine` | **every coarse authorization event** — live views *and* retained slices | hide from render immediately and **block reads**; keep bytes; **release on a superseding snapshot that proves continued access**, or escalate to `delete` if it proves the access is gone |
| `delete` | **proof**: a resnapshot showing the rows are no longer authorized; a subject-matched event (once shadow mode graduates); `reset`; declared restore; lease expiry with no successful revalidation | destroy in-memory rows, optimistic overlays, and durable retained bytes |

**Coarse events quarantine; only proof deletes.** This is a correction to attempt
four, which mapped every coarse event to an unconditional `delete` on retained
slices — meaning routine membership churn (joins, leaves, kicks: ordinary lobby
traffic in the proving demo) would destroy **every client's retained data**, and
adopting auth would make offline capability permanently useless rather than
merely deferred. Quarantine is equally fail-closed — the client cannot read
quarantined bytes — but it is *recoverable*: the resnapshot that follows either
releases the data (you still have access; the coarse event was a false positive,
which is exactly what a coarse event mostly is) or escalates to `delete` (you
don't). Cost is a hidden view and a re-query, not a destroyed cache.

This also resolves the divergence from the parent honestly: **LLP 0011's ratified
rule clears "*for sensitive retained slices*"** — not everything, and not on
suspicion. Quarantine-then-prove is the faithful reading.

### The lease: the only mechanism for the unreachable client

A revoked credential cannot reach an offline device. No obligation, no epoch, no
disposition helps — the device is not listening. So retained auth-scoped data
carries an **`authorizedUntil` lease**, and reading it past that instant is
**refused** until a successful revalidation renews it.

This is a **required v1 mechanism, not an open question** — attempt four deferred
it, which left the offline exposure window *unbounded*, i.e. the one case that
cannot be fixed later without a compatibility event was the one left open. The
default is deliberately conservative (**24 hours**), it is reported in the
capability/runtime-state facts so an app can see it, and an app may shorten it.
Lengthening it past a pinned ceiling requires an explicit, documented opt-in,
because the lease *is* the security boundary for every offline device.

**What the lease actually defends against — stated precisely, because an earlier
draft overclaimed it.** The lease is enforced by the client, against the client's
own clock. So:

- It **does** bound an *honest* client that has simply lost connectivity — a
  closed laptop, a phone in a tunnel, a browser tab left open. That is the
  overwhelmingly common case, and the lease is the only thing that bounds it.
- It **does not** defend against an **adversarial** client, for two independent
  reasons: a hostile client can lie about its clock, and — more fundamentally —
  **it already has the bytes on disk.** A client that wants to read its own
  retained cache does not need our permission to do so.

So the lease is a **bound on the blast radius of a legitimate revocation, not an
anti-tamper mechanism**, and this document does not pretend otherwise. Against a
hostile client holding retained data, the only real defense is encryption at rest
under a server-held key — which is [LLP 0043](./0043-offline-replay-retention.rfc.md)'s
open question, and which this document explicitly does **not** solve. An app whose
threat model includes a hostile client **must not enable retained reads** until
that question is answered; the capability facts report retention so the app can
make that choice knowingly.

The **server-side half is enforceable and is enforced**: a client presenting an
expired lease is refused revalidation-free service and must resnapshot under
current authority. That is the half that does not depend on trusting the client.

Stated plainly, because it is the price of local-first auth and every design that
pretends otherwise is lying: **an honest offline device may read data it is no
longer authorized to see, for up to the lease.** That window is the product
decision. The mechanisms above make it the *only* window for an honest client —
and they make no promise at all about a dishonest one.

The boolean `clear_retained` remains a compatibility projection
(`>= quarantine`). Rollout is pinned: an old client that ignores dispositions is
**not permitted to enable session-mode retained reads** — the minimum client
capability is part of the handshake LLP 0039 defines.

### Client fences

A disposition is worthless if a callback in flight repopulates what it just
destroyed — and the shipped client would: retained writes are fire-and-forget,
`writeServerRows` begins its retained write before checking disposal, and
`putRetainedQuery` overwrites unconditionally.

So each retained query carries a durable **authorization fence** — the
`(incarnation, epoch)` it was authorized under — persisted atomically with the
quarantine/delete. Every snapshot application, subscription callback, optimistic
reconciliation, and durable store write **carries its expected fence and fails
closed if stale**. The clear barrier is a serialized async coordinator step (LLP
0039's `AuthCoordinator`): hide live rows → remove overlays and queues → commit
the durable transition → *then* permit resubscription. `void resubscribe(...)`
racing an unawaited clear is exactly the bug this forbids.

### Retained and offline authorization

- The **query-scoped quarantine/delete primitive** is this document's client
  deliverable; LLP 0043's shipped M1/M2 specifies stored epochs and
  whole-context wiping, not a per-query primitive, so 0043 adopts this one.
- **Retained/offline reads stay disabled under session mode** until the
  primitive, the stored `(incarnation, epoch)`, and the fences land.
- **Retainable ⇒ `userId`-only authority dependence.** Retained rows are scoped
  by `userId`, but `ctx.auth` also exposes `sessionId` and `provider`, so a
  result whose visibility depended on those could survive into a non-equivalent
  authority. Retainable functions must declare `userId`-only dependence.
- **Unobserved offline revocation is physics.** A revoked credential cannot erase
  an offline device's copy until it reconnects. Bounding that exposure needs an
  `authorizedUntil` lease, and the decision must be made **before** retained
  reads re-enable — defaults are cheap while nobody depends on them.
- The offline/boot path has no `resync_required` message to carry a disposition,
  so it is pinned directly: a stored-`(incarnation, epoch)` mismatch discovered at
  boot or reconnect is **quarantine-before-read**, then resnapshot-and-release.

### Shadow-mode targeting (the graduation path)

v1 ships **only** the global epoch. Subject-scoped targeting — the thing that
would let a membership change invalidate one user instead of all — is
**computed but not used**:

- derive subjects mechanically where possible, compare against declared subjects,
  and record per-`(mutation, backing table)` counters, doctor-visible;
- promote a pair to *narrowing* only when it has N clean observations against a
  reference oracle (a full re-query plus full authorization re-evaluation);
- promote to *suppressing* the coarse event only when subject completeness is
  **proved**, which is the central open question below.

Shadow mode is also how the old/new-row derivation problem gets solved before it
is depended on: the `_snapback_changes` journal stores full `row_json`, so prior
values are readable in-transaction — but journal pruning can remove them, so
derivation must degrade to coarse, which v1 already pays. Nothing regresses if
the derivation is imperfect, because nothing depends on it yet.

### Worked classifications

Carried **in the document**, because attempt 2 and attempt 3 both died on shapes
that prose said were fine. Every row is the *whole* declaration for that query:

| App shape | Query reads | Result dependence | Authorization dependence | Behavior on an ordinary write | Behavior on an authorization event |
|---|---|---|---|---|---|
| **todo** (`listTodos`) | `todos` | `authScopeField: userId` (disjointness opt-in; L4 assertion on) | none | other users' todos skipped; own todos → `live_replace` (Ibex/ordered) | n/a — no ACL |
| **todo-v2** | `todos` | `authUserId()` equality predicate | none | as above | n/a |
| **mine-OR-public** | `docs` | **conservative** (no `authScopeField` — rows are *not* user-disjoint) | none | any doc write wakes; re-query re-applies `owner = me OR public` | n/a — a `public → private` flip is an ordinary write whose replace removes the rows |
| **card game** (`board`) | `moves`, `gameMembers` | conservative | `gameMembers: permissionBacking` | a move wakes and re-queries; **no epoch, no clear** | a kick advances the global epoch → quarantine + resnapshot; the kicked player's re-query returns nothing |
| **roster** (ACL *is* the result) | `gameMembers` | conservative | `gameMembers: permissionBacking` | — (every write here is an authorization event) | same table, both roles, no conflict |
| **hierarchy** (`docs`/`folders`/`orgMembers`) | all three (the query joins them) | conservative | `orgMembers: permissionBacking` | **re-parenting a doc wakes the subscription** — `docs` is in the read set; the re-query re-applies the join. This is the shape attempt 3 missed entirely | an org membership change advances the epoch |
| **mixed table** (`users.role` beside `users.displayName`) | `users` | conservative | `permissionBacking` + `permissionFields: ['role']` | an avatar change is an ordinary write — **no** authorization event | a role change is |

The hierarchy row is the proof of the reframe: the shape that had no expressible
class needs **no declaration beyond its read set**, because the matcher and the
re-query already do the work.

## Non-goals

- Universal incremental permission re-evaluation with precise live `remove`
  deltas — LLP 0011's ratified v1 answer is server-directed resubscribe.
- Subject-scoped *narrowing or suppression* in v1 (shadow mode only).
- A clock/deadline scheduler for time-limited grants (forbidden in retainable
  queries instead; materialize expiry as a write).
- Non-user subjects (groups, orgs, roles) as epoch scopes — such writes stay
  coarse, permanently, until the scope algebra exists. Named as a limitation, not
  solved.
- Declarative write-side row-level rules (LLP 0011's later surface).
- Encryption at rest for retained data (LLP 0043).
- The authority/session/transport core and the client coordinator itself
  (LLP 0039).

## Acceptance

**No regression.** An ordinary write by one user advances **no** authorization
version, fires **no** obligation, and clears **no** other client's rows — in
todo, todo-v2, mine-OR-public, the hierarchy, and the card game. Other-user
writes are skipped only where a disjointness opt-in was declared; everywhere else
the matcher wakes and the re-query is the authorization check. Steady-state
authorization-resync amplification under sustained ordinary writes is **zero**.
(Stated precisely: the demos' queries are Ibex and/or ordered, so they deliver by
`live_replace`, not DK-3 deltas; the pin is *no epoch, no obligation, no
resnapshot beyond what ships*. A genuinely unordered HostPlan fixture carries the
delta-path assertion.)

**The shapes that killed the earlier attempts.** Each is exercised end to end:
re-parenting a document across folders removes it from the losing org's
subscribers and adds it to the winner's; a `public → private` flip removes the
row from other users' views; a roster table that is both ACL and result behaves
correctly in both roles; an avatar write to a mixed `users` table fires no
authorization event while a role write does.

**Writeless authorization events.** Hot-reloading a narrower auth filter fires an
authorization event and strands no previously published rows. Import, reset, and
declared restore each rotate the incarnation and force resnapshot. A query whose
authorization depends on the clock is refused at manifest load
(`SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`).

**Obligation durability — the tests the shipped queue would fail.** A lost HTTP
drain response carrying the sole `delete` still results in the rows being
destroyed (the obligation survives and re-fires). A mid-batch WebSocket send
failure does the same. A `delete` arriving **while the connection is already
overflowed** raises the parked obligation rather than being dropped. A resync
emitted as a substitute for a failed authorization resync inherits its
disposition. An obligation is discharged only by a superseding snapshot under a
satisfying `(incarnation, epoch)`, never merely by having been sent.

**Fences.** A callback that began before an invalidation cannot repopulate the
query after deletion (fails closed on a stale fence). A restart during a failed
resubscribe leaves no formerly authorized rows readable. Resubscription cannot
begin before the durable clear commits.

**Version durability.** A crash between the causing write and any post-commit
work cannot lose the authorization event (same transaction, one hook — proven
across HostPlan, Ibex, seed, admin edit, import, reset, and rollback). An
**ordinary restart preserves the incarnation** and does **not** force retained
subscriptions to resnapshot; reset/import/declared-restore do. The full ABA cycle
(`0 → 1 → reset → 0 → 1`) is caught.

**Blast radius, measured not asserted.** Under the card game's membership-churn
workload (joins/leaves/kicks as routine lobby traffic), the disruption to
*unrelated* subscriptions is measured and bounded, and the result is recorded —
`quarantine` hides and resnapshots; it does not destroy live views. If the
measured cost is unacceptable, that is a finding about the shadow-mode
graduation's priority, not something to discover in production.

**Oracle.** A reference "full re-query plus full authorization re-evaluation"
oracle is property-tested against randomized writes, deployments, expiry,
overflow, disconnect, response loss, restart, and stale-callback interleavings.

## Open Questions

1. **What proof lets a subject declaration narrow — and later suppress — the
   coarse event?** The central question, and the one the shadow mode exists to
   answer. Candidates: N clean observations against the oracle per
   `(mutation, backing table)`; or mechanical derivation from `permissionFields`
   over old/new rows as the *only* sanctioned form.
2. **Is the enumerated event universe actually closed?** It is the safety claim's
   load-bearing assumption, and the previous three attempts all died of
   incompleteness. What is the argument — or the test — that no fifth event
   source exists? (Candidate answer: the online-only fallback means an unenumerated
   source can only cost retainability, never correctness. That argument needs
   scrutiny, not assertion.)
3. **Non-user subjects.** Group/org/role grants have no expressible subject, so
   those writes are coarse forever. Is that an accepted permanent cost, or does
   the scope algebra need to exist before graduation?
4. **Is the 24-hour lease default right?** It is now a pinned mechanism with a
   default rather than an open question — but the *number* is a product decision,
   and it is the exposure window for every offline device. A shorter default costs
   offline usability; a longer one costs security. Someone must own the number.
5. **Does the Cloudflare coordinator support the same atomic authorization-version
   and persistent-obligation contracts?** It rebuilds subscriptions on deploy and
   has no auth machinery today.
6. Is the classification obligation scoped to subscribable/retainable queries
   only, or to every function including mutations? (v1 says the former —
   classification has operative meaning only for subscriptions.)

## Status

**Draft — FROZEN, by the author's instruction, 2026-07-12.** Not because it is
finished, but because further unreviewed iteration by its author has negative
expected value. Read this section before implementing anything here.

**What the loop established.** Six designs; five rejected. **Every single defect
was found by an independent reviewer, and not one by the author.** That record is
the most reliable fact in this document, and it is why the freeze exists.

**What is settled.** The round-4 review put it plainly: *"The architecture —
matcher-carried live correctness, two orthogonal declarations, an enumerated event
universe with machine-enforced online-only confinement, obligations for negative
deltas, mandatory resnapshot, quarantine-then-prove, and an honestly-scoped lease
— is sound, and nothing I found requires reopening it; after five failed designs,
that is the headline."* No reviewer has produced an app shape this model cannot
express since the reframe landed.

**What is NOT reviewed — read this before building.** The final round found two
material defects, and the fixes now in the text are **transcriptions of that
reviewer's own prescribed resolutions**. They have **not themselves been
reviewed**, and this document's history says that is exactly when it is wrong:

1. **Obligation discharge and the client fence were epoch-witnessed** — and the
   epoch never moves for a matcher-path removal, so both were satisfiable by stale
   state on precisely the class obligations exist to protect. Now witnessed by
   **commit version**. *Unreviewed.*
2. **A denied re-query was routed to `retain`** ("keep showing current rows
   meanwhile") — and since the resnapshot is also denied, "meanwhile" never ended:
   forbidden rows persisted on a connected client forever. Denial is now a
   negative delta, obligation-backed, disposition ≥ `quarantine`. *Unreviewed.*

Also unreviewed: per-scope obligation durability, the fail-closed definition of
"auth-scoped", and the corrected closure argument.

**Known residual, not a defect to be fixed later — a property.** A connected
client whose authorization depends on a JavaScript clock read keeps its rows past
expiry, indefinitely. That form is undetectable at load, so it cannot be refused;
the remedy is authoring guidance (materialize expiry as a write) plus a doctor
diagnostic. This document does not pretend the closure argument covers it.

**The next action on this document is a review of these fixes — not a new design.**
Whoever picks it up: the architecture is not the risk. The enforcement primitives
are, and they have failed review twice in a row at exactly this layer.

## Changelog

- **2026-07-12 (round 4 → FROZEN).** Final round: architecture confirmed sound
  and not reopened; two material enforcement defects found and their prescribed
  fixes transcribed (see §Status — they are **unreviewed**). (a) Obligation
  discharge and the client fence were witnessed by `(incarnation, epoch)`, which
  **never moves for a matcher-path removal** — so a snapshot computed *before* the
  removal could discharge the obligation and leave the forbidden row permanent on a
  connected client: attempt five's failure, reproduced one level up. Now witnessed
  by **commit version**. (b) A re-query that *denies* (LLP 0011's function-level
  check — a handler that throws when a membership lookup returns null) produced an
  error, not a smaller result, and routed to `retain` = "keep showing current rows
  meanwhile" — with the resnapshot also denied, forever. Denial is now a third
  negative-delta class, obligation-backed, never `retain`. Also: obligation
  durability split **per scope** (the blanket "same transaction as its cause" is
  impossible for post-commit matcher-path removals; the crash window is closed by
  connection-death ⇒ reconnect ⇒ mandatory resnapshot instead); **"auth-scoped"
  defined fail-closed** (every subscription is auth-scoped unless explicitly
  `authorityIndependent`); and the **closure argument's non sequitur** corrected —
  online-only confines *retained* damage but does **not** summon the matcher for a
  connected view, so the clock hazard is a named residual, not a solved problem.
- **2026-07-12 (round 3 → attempt six).** Closed the permanent false negative the
  round-3 review found: a `public → private` flip is an *ordinary* write, so it
  rode the matcher, raised no epoch, created no obligation, and was delivered over
  the **destructive-drain outbox** — meaning a lost message left forbidden data on
  a **connected** client's screen forever, with nothing in the system able to
  correct it. Attempt five had stated "negative information does not self-heal"
  and then applied it only to the epoch path, while handing the *largest* class of
  authorization removals to a lossy channel. Fixed by the general rule:
  **negative deltas are obligations; positive deltas are best-effort** — for an
  auth-scoped subscription, any delivery that *removes* a row the client holds is
  durable and discharged only on acknowledgement, regardless of what caused the
  removal. Also: the **lease's threat model corrected** — it bounds an *honest*
  offline client, and does **not** defend against a hostile one (which can lie
  about its clock and, more to the point, already holds the bytes); encryption at
  rest under a server-held key is the only real answer there and is explicitly
  LLP 0043's unsolved question, so an app with a hostile-client threat model must
  not enable retained reads. **Retainability enforcement stated honestly**
  (declaration is *enforced*; truth is *tested* — the disjointness claim by the
  L4 convergence assertion, the rest by the oracle and doctor). **"Reconnect"
  generalized** to every resumption from a non-live state and every materialized
  copy (process restart, reload, second tab, service worker).
- **2026-07-12 (round 2 → attempt five).** The reframe survived both reviews;
  this revision completes it rather than replacing it. **Closed the witness
  hole** (the sharpest round-2 finding): matcher-mediated visibility changes leave
  no epoch trace, so a *disconnected* client's epoch comparison would wrongly
  conclude its retained data was still authorized — fixed not by making the epoch
  witness more, but by **never asking it**: every auth-scoped subscription now
  **resnapshots unconditionally on reconnect**. **Made the lease a required v1
  mechanism** with a conservative default (24 h) instead of an open question —
  it is the only thing that can bound a client the server cannot reach, and
  leaving it open left the offline exposure window unbounded. **Fixed the retained
  blast radius**: coarse events now **quarantine** (fail-closed but recoverable —
  hide, block reads, keep bytes, release on a superseding snapshot that proves
  continued access) and **delete only on proof**, so routine membership churn no
  longer destroys every client's retained data. **Made "retainable ⇒ declared" a
  machine-enforced manifest-load property** (`SNAPBACK_AUTH_UNDECLARABLE_RETENTION`)
  rather than an honor system — the closure argument depends on it, so it cannot
  be defeasible by omission. **Argued the closure claim** instead of asserting it
  (an unenumerated event can only cost retainability, never correctness — and only
  because retainability is enforced). **Specified the obligation state machine**
  where the shipped queue fails: identity and merge, same-transaction durability,
  discharge only by an acknowledged superseding snapshot, monotone escalation
  (including the overflow-then-delete ordering the sticky `overflowed` flag would
  drop), wakeups-are-not-the-obligation, and GC.
- **2026-07-12 (round 1 → attempt four).** Abandoned the four-class taxonomy.
  Both families found it non-exhaustive; between them they produced three real
  shapes it could not express (a table that is both ACL and result; hierarchical
  re-parenting that changes authority without an ACL write; row-authorized
  sharing with no backing table), plus writeless authorization changes (hot policy
  reload, clock expiry) the model missed entirely. Replaced with: the
  matcher-does-live-correctness reframe; two orthogonal declarations (result
  dependence, authorization dependence) that a table may hold both of; a closed,
  enumerated authorization-event universe with an online-only conservative
  fallback; persistent level-triggered obligations replacing loseable queue
  messages; per-query client fences; one transactional commit hook across all
  writers; incarnation persisted across ordinary restarts (matching LLP 0039);
  clock-dependent visibility forbidden rather than half-solved; the LLP 0011
  live-vs-retained clearing divergence resolved in 0011's favor (`quarantine`
  for live views, `delete` for retained slices — which also gives `quarantine` a
  real producer); field-granular `permissionFields`; subject targeting demoted
  entirely to shadow mode (mooting the unimplementable old/new derivation, the
  scope-key collision design, and the coalescing design); and worked
  classifications carried in the document. Corrected: the matcher rationale
  (captured dependencies take precedence over the static `authScopeField`
  fallback, which is `userId`-only today), and the ABA example.
- **2026-07-12 (initial).** Split out of LLP 0039 §Permission dependencies on
  Charlie's authorization, carrying the four-class model that LLP 0039's round-6
  revision had proposed but never had reviewed.
