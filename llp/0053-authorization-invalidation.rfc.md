# LLP 0053: Authorization invalidation

**Type:** RFC
**Status:** Accepted
**Systems:** Sync, Realtime, Auth, Storage, API, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-12
**Revised:** 2026-08-15 (`ctx.db.elevated` read host ops remain
`DatabaseCaptured`; authority selection changes visibility composition, not
snapshot/input closure). 2026-08-03 (`single_table_v1@1` boundary: its exact
authority-independent retention class is not an `AuthorizedLease` consumer
and sets no anonymous-lease precedent; proof/witness/fence/barrier/destructive
rules remain mandatory.) 2026-08-03 (terminology pin: the cited "cold-process retained
boot" is the fresh-wrappers-over-retained-state-in-one-process proof
class; see §Changelog. No contract change.) 2026-08-03 (Accepted LLP 0166 boundary: store-policy layer
composes over this RFC's state — payload compaction preserves §GC
survivals, wipe maps to owner transitions with LLP 0059 participation,
unparseable reset rotates the store identity; demand never overrides a
transition owned here.) 2026-08-03 (Accepted LLP 0157 boundary: a composed materialization
uses its `qmk1` as this RFC's opaque `query_key` producer, while this RFC keeps
instance allocation, authorization witnesses, dispositions, and barriers);
2026-08-01 (dev-mode scope clarified, per Charlie Cheever's
adjudication of LLP 0145 OQ23 — provisional, recorded as revisitable. §"Auth-scoped"
is defined fail-closed" classified functions without qualifying which modes
*deliver* obligations, which read as requiring obligation backing in dev mode
and contradicted the shipped server, where admission is gated on
`AuthMode::Sessions`. The code was right: dev mode's identity is
caller-asserted, so there is no authority to revoke and the obligation is
vacuous rather than unenforced — consistent with this document's own
description of `clear_retained` as a projection for dev/authority-independent
paths. The function classification is unchanged; only the delivery scope is
stated. Surfaced by the LLP 0145 super-refine loop, round 4.)
**Revised:** 2026-08-01 (0137 a4-f5 witness-gated action pass-through: a
nested mutation's trusted `SNAPBACK_AUTH_PERMISSION_DENIED` now survives
the ACTION boundary via a host-recorded denial witness
(`denial_witness` + `restore_denial_witness`, crates/snapback/src/runtime.rs) — when the
failing action's claimed envelope code matches a denial the host itself
produced during that invocation, the surfaced diagnostic is the recorded
trusted error with its uniform bytes. The forged-code rule is unchanged: a
handler-forged `{code: ...}` has no witness and still folds to
`SNAPBACK_HANDLER_FAILED`; the envelope decoder allowlist gains no auth
code, and the trusted-producer enumeration is unchanged — this surfaces an
EXISTING trusted denial across one hop rather than minting a new producer.
Non-terminalizing by design: the denied nested mutation committed nothing,
so an action that catches and recovers still succeeds. Local/Ibex leg
only; the workerd/DO coordinator leg is an open parity ticket. No contract
change; Status stays Accepted.) 2026-07-31 (LLP 0044 companion classification: asset
read-authorization inputs admitted — the asset-readable predicate node in
the 0056 idiom with pinned empty-result capture over the reverse-edge
index; intent activation is event 2 and operator revocation event 4; the
finalization witness stays LLP 0007's; asset system tables confirmed
needing no `permissionBacking` classification. No contract change; Status
stays Accepted.) 2026-07-26 (JavaScript protected-input attribution follows each
exported handler's conservative locally reachable call graph, including
aliases, object methods, callbacks, and nested closures, without poisoning a
protected query for mutable input reachable only from an unrelated sibling
export); 2026-07-23 (LLP 0086 CC-3.1 acceptance evidence and target
coverage: added the dated §Acceptance evidence and target coverage note under
§Status linking the local-target implementation and acceptance receipts —
`crates/snapback/src/auth/{invalidation,lease}.rs`, `crates/snapback/src/storage/{auth_invalidation,authorized_lease,authorization}.rs`,
`crates/snapback/src/local/{authorization_acceptance,auth_room_kick_acceptance}.rs`,
`tests/acceptance/auth-invalidation-v1-*`, and the card-game
`authority-scope.mjs` proof — and stating per-target coverage honestly: local
(Ibex) yes at the negotiated item-6/item-8 scope; Cloudflare no (open question 3
stands as a recorded capability gap); the InstantDB competitive probe is blocked
on credentials, so the LLP 0074 differentiator claim stays publication-gated.
No contract change; Status stays Accepted.) 2026-07-14 (ENG-24906 agent-auth input admission: the new dated
§Agent-auth protected-query inputs classifies the protected-query inputs
LLP 0055 and LLP 0056 introduce — from 0056 the membership predicate node and
the `ctx.permissions` membership read; from 0055 the sealed `ctx.auth`
service-principal and direct projections, the `kind` key, the anonymous
no-`kind` answer, the three auth-variable IR expression kinds, and the
grant-scoped `delete` disposition — so the default-deny profile admits them
instead of refusing every helper-gated live query and every delegated
invocation. The authorization-event universe, the trusted-denial producer
enumeration, and the `permissionBacking` machinery are explicitly left
unchanged; Status stays Accepted. See §Agent-auth protected-query inputs and
the dated changelog entry.) 2026-07-14 (ENG-24992 verification-locus clarification: the lease
MAC and `key_id` are authenticated only by the server's keyring — where the
unknown-key fail-closed rule lives — while client custody validation promises
exactly structural/binding/clamp/expiry/rollback checks plus unkeyed-hash
corruption detection; client-side cryptographic MAC verification was never
implementable without verifier-key distribution and is explicitly disclaimed.
See §The lease and the dated changelog entry.) 2026-07-13 (ENG-24592 focused exact confirmation completed READY
by Codex round 7 and Fable round 8 on the operative corpus ending in this
document's SHA-256
`eb1c624c5a06facaaa32d51e0e5e6793d1ae68e532a36b64a8fb51f3391e1568`;
the author-authorized Draft → Review → Accepted transition is complete. The
accepted enforcement contract includes commit-ordered room barriers,
data-head-linearized lease issuance, the item-5/item-6 activation matrix,
bounded fail-closed retry episodes, and the never-reused `ClientQuery`
identity/terminal-retirement correction. See §Motivation for the full failure
history and §Changelog; artifacts in
`reviews/0053-authorization-invalidation.{fable,codex}.md`. Split out of
[LLP 0039](./0039-auth-vertical-slice.rfc.md) §Permission dependencies on
2026-07-12.)
**Related:** LLP 0000, LLP 0004, LLP 0008, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0016, LLP 0020, LLP 0026, LLP 0032, LLP 0039, LLP 0043, LLP 0044, LLP 0051, LLP 0055, LLP 0056, LLP 0074, LLP 0086, LLP 0157

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
> reload, an import, a reset). A grant expiring on the clock is *not* made into
> an epoch event: v1 instead gives every protected query a machine-enforced,
> default-deny input profile. Any mutable input that cannot produce a matcher
> wake or an enumerated activation event is refused, as §The
> authorization-event universe pins.

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
  fallback (anything unenumerable, ambient, or mutable is denied for a protected
  query; opaque undeclared functions cannot retain) rather than a taxonomy that
  must cover every app shape;
- a durable **authorization epoch**, advanced in the same transaction as its
  cause through **one commit hook used by every writer**, and paired with the
  authorization-stream incarnation LLP 0039 owns;
- **persistent, level-triggered invalidation obligations** with a composite
  authorization-and-data witness — not queue messages, which the shipped queue
  can destroy or drop;
- **per-query client fences and durable tombstones**, so a callback in flight
  cannot repopulate what an invalidation just destroyed;
- a **default-deny protected-query input profile**, so clock, id, module-state,
  ambient, and future mutable inputs cannot strand a connected result;
- projection of authorization changes into **ephemeral room authorities**, so
  a membership kick suspends room delivery and reauthorizes from a fresh
  durable snapshot instead of protecting only durable rows;
- a **mandatory resnapshot on reconnect** for every auth-scoped subscription;
- an exact, server-issued **`AuthorizedLease`** with rollback-checked time,
  atomic snapshot binding, and a 24-hour default and hard maximum — the only
  mechanism that can bound a client the server cannot reach.

[LLP 0039](./0039-auth-vertical-slice.rfc.md) is the umbrella (authority,
sessions, transport, and the client coordinator that *executes* what this
document defines). [LLP 0011](./0011-auth-and-permissions.rfc.md) is the parent
design. **On acceptance, this RFC is the controlling narrow refinement of LLP
0008 §Authorization-Aware Sync / §Realtime Delivery and LLP 0011 §Local-First
and Realtime Implications for authorization-invalidation mechanics.** Their
server-authoritative authorization, fail-closed stale-result handling,
user-switch wipe, and fresh-authorized-snapshot fundamentals remain ratified;
the superseded clauses are only the claims that every permission-affecting
write advances an epoch, every invalidation is a generic `resync_required`, and
every reconnect may trust epoch equality. The dated companion amendments and
the root ratification ledger record that precedence now, while item 6 remains
blocked until this RFC is Accepted. This RFC also closes
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
negative: under that attempt a `public → private` flip was an *ordinary write*,
so it rode the matcher, raised no epoch, and created no obligation — yet its
delivery went over the **same destructive-drain outbox that can lose a message**. The client stays
connected (so no reconnect resnapshot) and is online (so no lease applies).
**Nothing in the system would ever have corrected it.** The forbidden row stays
on screen forever.

The principle was already stated and then not applied where it mattered most:

> **Losing data is staleness. Losing a *removal* is a security failure.**
> Positive information self-heals — the next snapshot re-adds it. Negative
> information does not.

Two obligation sources must not be conflated:

- a **delivery obligation** is per live scope, is raised whenever a result may
  have shrunk, carries the causing data version, and advances no authorization
  epoch; and
- an **authorization-event obligation** is the projection of an enumerated
  event and carries the authorization version. Ordinary coarse permission,
  activation, and out-of-band revocation events start at `quarantine`;
  reset/import/declared-restore boundaries start at `delete`.

They use the same merge, acknowledgement, and fencing protocol below. The
distinction matters because an ordinary write can create the first while
correctly creating none of the second.

So, for an **auth-scoped subscription**, the *shrinking of the result set is the
security event*, and it does not matter **why** a row left — an ACL write, a
re-parented folder, a visibility flip, or an ordinary delete:

- A live delivery that **removes** any row the client is known to hold is
  **delivery-obligation-backed**: persistent until discharge within its scope,
  level-triggered, and discharged only when the client **acknowledges** a
  snapshot computed at or after the causing commit version.
- The shipped HostPlan delta path identifies `remove` exactly. General Ibex
  `live_replace` does not retain the last delivered *logical output* — captured
  database rows are not equivalent to projected, aggregated, or synthesized
  output — so v1 takes the conservative predicate: **every auth-scoped
  `live_replace` is delivery-obligation-backed as potentially shrinking**.
  `authorityIndependent` replaces and delta deliveries proved to contain only
  adds/updates remain best-effort. Retaining logical output membership may later
  narrow this without changing the protocol.
- **A re-query that ERRORS or DENIES is also a negative delta.** LLP 0011's
  *first* authorization layer is "function-level checks inside queries," and the
  natural authoring shape is a handler that throws when a membership lookup comes
  back null. A kick then wakes the subscription, the re-query **throws**, and the
  shipped path (`fail_subscription_fanout`) would emit a plain recovery resync —
  mapped to `retain`, i.e. *"keep showing current rows meanwhile."* The resnapshot
  throws too (still denied), so **"meanwhile" never ends**: forbidden rows persist
  on a connected client behind a failing resubscribe loop, with no epoch, no
  reconnect, and no lease. That is fail-open, and it is why denial is a third
  delivery class. A typed `SNAPBACK_AUTH_PERMISSION_DENIED` is proof for the affected
  query and produces `delete`. Any other error immediately produces
  `quarantine`, then permits at most **two automatic retries after the initial
  failure** in the server-owned retry episode, all within 15 seconds of the first
  failure. Re-fire, a newer obligation revision, reconnect, or restart does not
  reset that episode. If both retries fail, the query remains quarantined until
  an explicit authority-checked manual retry; it never falls back to `retain`.
- A delivery **proved** to only add or update rows stays best-effort. Losing one
  is staleness, and the next successful delivery repairs it.

**"Auth-scoped" is defined fail-closed**, because the whole rule hangs on it:
**every subscription is auth-scoped unless its function is explicitly declared
`authorityIndependent`.** Undeclared means auth-scoped. A "declares auth
dependence" reading would hand best-effort removals to precisely the opaque,
online-only queries the conservative matcher is supposed to be protecting — which
is attempt five's defect wearing a different hat.

**Scope: sessions mode.** The definition above classifies *functions*, and it
classifies them the same way in every mode. What is mode-dependent is whether
obligations are *delivered*: the server admits and delivers them only in
sessions mode, and this section does not require otherwise. Dev mode has no
authority to revoke — the client asserts its own identity, so a caller who
names one user can name another — which makes an invalidation obligation
semantically vacuous there rather than merely unenforced. This is consistent
with the treatment of `clear_retained` below as "a versioned compatibility
projection for dev/authority-independent paths, never a session-mode security
carrier." A dev-mode client therefore claims no auth profile, negotiates no
invalidation carrier, and receives no obligation frames; it is not thereby
non-conforming. See LLP 0096 §3.2 for the negotiation half.

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

**Safe by default means a full re-query or an equivalence-proved delta, not
"the static read table always wakes."** The shipped matcher consults captured
`Row`, `MissingRow`, and `Query` dependencies first; their proved-disjoint
verdict may skip a write. A HostPlan predicate can likewise prove a skip, and an
eligible unordered HostPlan query can apply a DK-3 delta without re-querying.
Only when capture cannot decide does Ibex fall back to the static read summary
and its currently `userId`-only `authScopeField` refinement.

Every one of those skip paths is load-bearing. Captured dependencies must be
complete before a snapshot is published; missing, empty, unknown, or
unanalyzable facts fall back to re-query/replace. Test and dev profiles run an
LLP 0008 L4-style convergence assertion for **every authorization-sensitive
skip or delta proof** — captured predicate, point read, HostPlan delta, and
`authScopeField` — against a full re-query. Class metadata may never override a
captured dependency's affected verdict. `authScopeField` remains an explicit,
never-inferred disjointness claim and a retainable query that uses it must carry
the convergence fixture, but it is not the matcher's only skip proof.

### Two orthogonal declarations

The attempt-3 error was one exclusive class per `(function, table)` pair, mixing
two independent questions. They are now separate, and **a table may be both**:

**1. Result dependence** — how a table's changes reach a subscription's result.
Declared by the read summary the system already computes, plus at most one
optional refinement:

- default: **conservative** — captured dependencies and analyzable predicates
  may prove a change disjoint; otherwise a change to a read table wakes the
  subscription;
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

`permissionFields` narrows **known updates only**. Inserts and deletes on a
`permissionBacking` table always fire. An update whose `changed_fields` is
absent, empty, reconstructed from the journal, or otherwise unknown also fires;
empty means "may include every field," not "changed nothing." Only a known,
non-empty field set proved disjoint from `permissionFields` suppresses the event.

The fail-closed subscription opt-out is a separate function-level manifest field,
`authorityIndependent: true`. It is an explicit trusted assertion that the
function's result is invariant under every caller-authority dimension; omission
means auth-scoped. It is mutually exclusive with declared authorization inputs
or permission dependencies and is never inferred from an anonymous invocation.

`gameMembers` is now simply *both*: it is in the roster query's read set (result
dependence) **and** `permissionBacking` (authorization dependence). No conflict,
no precedence rule, nothing to be exhaustive about.

### The authorization-event universe (closed)

An **authorization event** advances the authorization version. The universe is
**enumerated, not derived** — this is the substantive replacement for the
taxonomy, and its closure is what makes the safety claim checkable:

1. A committed write to a `permissionBacking` table (restricted only for a
   known update proved disjoint from `permissionFields`, under the rule above).
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

**Protected-query admission closes the non-database-input perimeter.** The
previous revision correctly observed that online-only confinement does not wake
a connected query, then incorrectly left other mutable inputs as an open
perimeter. V1 instead defines a **protected query** as every auth-scoped live
subscription and every retainable query, including an `authorityIndependent`
retainable query. Establishing it and every matcher/error/explicit rerun use the
same machine-enforced profile on **dev, test, demo, and prod**:

1. **Allowed inputs are closed.** A protected result may depend only on:
   canonical immutable query arguments; the exact sealed `ctx.auth` projection
   below; database reads whose complete capture/read summary contributes to the
   snapshot's data witness; and activation-pinned bundle/manifest facts whose
   change is event 2. Changing arguments creates a new query instance. Changing
   authority is LLP 0039's fenced authority transition. Neither mutates a live
   invocation behind the matcher.
2. **Declarative IR is walked recursively, default-deny.** `RuntimeNow` and
   `RuntimeId` are refused wherever they occur — filter, value, binding,
   projection, return expression, or any current/future nested expression — not
   only when a shallow visitor labels a predicate "authorization relevant."
   `RuntimeNow` reports `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`;
   `RuntimeId` and any other mutable expression report
   `SNAPBACK_AUTH_MUTABLE_INPUT_DENIED` with a typed `inputKind`. A newly added
   expression kind is denied for protected queries until this profile classifies
   it.
   For JavaScript handler bundles, “wherever they occur” means the protected
   export's conservative locally reachable call graph, including direct helper
   calls, aliases and destructuring, local object methods and dynamic selection
   on a known helper object, callbacks, `this` sibling calls, IIFEs, and nested
   closures. An input reachable only from an unrelated sibling export is not an
   input to the protected query. Ambiguous edges within a known reachable helper
   object remain fail-closed by following every possible local target.
3. **`ctx.auth` is a sealed mode-specific value, not ambient application
   state.** The shared invocation gate creates a fresh, null-prototype,
   data-property-only, recursively frozen record on every invocation. Sessions
   project exactly anonymous
   `{userId:null, sessionId:null, isAuthenticated:false}` or authenticated
   `{userId, sessionId, isAuthenticated:true, provider, roles:[]}`. Dev
   impersonation projects exactly `{userId, sessionId:null,
   isAuthenticated:true, roles:[...]}` with a copied/frozen roles array.
   `adminBypass` and `system` receive the anonymous handler projection; audit
   authority remains outside `ctx.auth`. Extra keys, accessors, proxies, mutable
   backing objects, caller wire objects, and profile-dependent fallthrough are
   impossible. The current authority is sealed before module evaluation and is
   identical for initial run and rerun.
4. **Every runtime host operation has one admission class.** The exhaustive v1
   registry is:

   | Host-op class | Protected-query rule |
   |---|---|
   | `DatabaseCaptured` | allowed only when the returned fact is represented in the complete read/capture set and bound to the snapshot version |
   | `ActivationPinned` | allowed only when the returned immutable fact is bound to the active bundle/manifest hash, whose replacement is event 2 |
   | `TerminalAuthorization` | the host-owned typed denial operation is allowed but returns no application value |
   | `EffectOnlyConstant` | diagnostics/logging only; allowed only with a specified constant return that cannot influence visibility through mutable output |
   | `MutableNonDatabase` | denied |

   `ctx.runtime.now()` and `ctx.runtime.id()` are
   `MutableNonDatabase`; the first reports the clock diagnostic and the second
   reports the general mutable-input diagnostic. Network/action results,
   secrets, non-activation-pinned config/provider state, and every unknown or
   future host op are also denied by default. Load-time analysis rejects a
   statically visible call; the host gate rejects a dynamically reached call.
   Both gates run on initial execution and every rerun, so a data-dependent
   branch cannot hide the call at load or first execution.

   LLP 0231 D7's `ctx.db.elevated.{get,getMany,uniqueMany,query}` operations
   are `DatabaseCaptured`, exactly like their caller-scoped counterparts.
   Elevation changes which Class-R table predicate storage composes; it does
   not change the returned fact's snapshot binding, complete read capture,
   empty-result capture, or matcher/OCC dependency. The protected-query
   allowlist names these operations explicitly; no prefix or unknown future
   host operation is admitted by resemblance.
5. **Ambient engine inputs are absent or denied.** `Date.now()` and zero-argument
   `new Date()` retain their shipped codegen/runtime denial. The protected realm
   additionally exposes no mutable clock, randomness/id source, timer,
   locale/time-zone/environment lookup, network, process state, or future
   ambient capability unless it is explicitly admitted into the registry above.
   `Math.random`, random UUID/bytes, `performance.now`, and equivalent aliases
   are named negative fixtures; aliases and computed property access are tested,
   not accepted as a static-scanner limitation.
6. **Module state is fresh or reset-equivalent.** Each protected invocation uses
   a fresh realm/module graph, or a reset proven to recreate **all** module
   lexical state, imported singleton state, globals, intrinsics, pending jobs,
   and host namespaces to the post-load baseline. The shipped DK-4 sweep does
   not reset module lexical closures and therefore does **not** qualify; protected
   queries take the fresh-VM path until a reset-equivalence proof exists. A
   module counter, cached random/id, or mutation left by another invocation can
   never decide a protected result.

The profile is a capability allowlist, not a scanner heuristic. A statically
unknown construct fails load when the compiler cannot prove it stays inside the
profile; a dynamically reached unknown fails the host invocation before a row
can publish. Apps expressing time-limited grants or provider/config decisions
materialize them as database writes (event 1) or activation-pinned metadata
(event 2). V1 builds no deadline scheduler.

The retainability invariant remains separately load-bearing:

> **Retainable ⇒ declared authorization dependence ⇒ enumerated events.**

A function is retainable only if its authorization dependence is fully
expressed in declarable form (auth-variable filters, `authScopeField`,
permission-backing tables reached through its complete read summary, or
`authorityIndependent`) and its read summary is complete. Opaque JavaScript use
of `ctx.auth`, an empty/unknown read summary, or any protected-profile denial
makes retention a load error (`SNAPBACK_AUTH_UNDECLARABLE_RETENTION`), not a
warning. Declaration presence is enforced; declaration truth is still tested:
the disjointness claim runs the LLP 0008 L4 convergence assertion in test/dev,
and other trusted assertions run the reference oracle and doctor.

The resulting closure claim is now exact for supported protected queries, live
and retained: every mutable input either produces a database matcher wake,
produces enumerated activation, crosses LLP 0039's authority fence, or is
refused. There is no residual category of admitted ambient/future input and no
open question asking implementers to discover one after the fact.

### Agent-auth protected-query inputs (amended 2026-07-14, ENG-24906)

This dated amendment admits the new protected-query inputs that
[LLP 0055](./0055-agent-principals-and-scoped-grants.rfc.md) (agent principals
and scoped grants) and [LLP 0056](./0056-scoped-roles-and-memberships.rfc.md)
(scoped roles and memberships) introduce. It is required because the profile
above is default-deny by construction: "**A newly added expression kind is
denied for protected queries until this profile classifies it**" (§2) and
"every unknown or future host op [is] also denied by default" (§4). Both RFCs
add exactly those things, so absent this classification 0053 would refuse every
helper-gated live query 0056 defines and every delegated/service-principal
invocation 0055 defines. **Every input classified below lands inside an existing
admitted category** — a `DatabaseCaptured` host op, a snapshot-bound
capture-summary expression, or the sealed `ctx.auth` authority — so none is a
new residual category and none is an ambient/future input in the sense the
closure claim forbids; this amendment *is* the "this profile classifies it"
step §2 promised.

**From LLP 0056 (scoped roles and memberships):**

1. **The membership predicate node is an admitted declarative IR expression
   kind.** The declaration-bound membership predicate node LLP 0056 adds to the
   structured filter IR — the first step past single-table filters — is
   **admitted** under §2 rather than denied as a new expression kind. It is
   **snapshot-bound** and **participates in the complete read/capture summary**
   that contributes to the snapshot's data witness: a **successful** membership
   lookup records ordinary snapshot-bound row/query dependencies through the
   unique `(principal, resource)` index (never the legacy `Permission` kind),
   and — load-bearing — an **empty** lookup records the corresponding
   **empty-result query dependency over the same index range**, so a membership
   insert or role upgrade wakes a subscription that previously matched nothing.
   This **pinned empty-result capture** is why the captured-`Query`
   short-circuit cannot prove a membership insert "disjoint" and strand a
   newly-added member. The node admits no clock, id, or other
   `MutableNonDatabase` input; its value is represented in the read/capture set
   and bound to the snapshot version, exactly the `DatabaseCaptured` discipline
   (LLP 0056 §What exists, what this adds; §Invalidation: the LLP 0053 mapping).

2. **The `ctx.permissions` membership read is one new host operation, class
   `DatabaseCaptured` on both outcomes.** The internal membership-read primitive
   backing `requireRole` joins the §4 registry with a single admission class,
   `DatabaseCaptured`, on **both** outcomes: whether the membership row is
   **present or absent** it contributes its snapshot-bound dependency (including
   the empty-result form) to the read summary and to commit-time read-set
   validation. Denial is **not** a second class on this operation: on a failed
   check the composition invokes the **already-classified `TerminalAuthorization`
   deny operation** (`ctx.permissions.deny()`), which produces the **existing**
   trusted `SNAPBACK_AUTH_PERMISSION_DENIED` and returns no application value. So
   each primitive carries **exactly one** admission class and §4's
   one-class-per-operation rule needs no change. The read has no
   application-returning `.get()` form in v1 (that would re-open, as an API, the
   membership-existence oracle the invariant denial payload closes)
   (LLP 0056 §Rule helpers).

**From LLP 0055 (agent principals and scoped grants):**

3. **The sealed `ctx.auth` enumeration gains the `servicePrincipal` mode and a
   `kind` key.** §3 seals `ctx.auth` as an exact, mode-specific value with extra
   keys impossible; the new authority mode and fields join that enumeration as
   further exact projections. Each remains a fresh, null-prototype,
   data-property-only, recursively frozen record sealed before module evaluation
   and identical for initial run and rerun — the new mode adds no accessor,
   proxy, mutable backing object, or profile-dependent fallthrough:

   - the two **`servicePrincipal`** projections —
     - autonomous agent (actor == effective):
       `{userId: <agentUserId>, sessionId: null, isAuthenticated: true,
       provider: "agent-credential", roles: [], kind: "agent"}`;
     - delegated agent (actor != effective):
       `{userId: <effectiveUserId>, sessionId: null, isAuthenticated: true,
       provider: "agent-credential", roles: [], kind: <effective user's kind>,
       actor: {userId: <agentUserId>, kind: "agent", grantId: <grantId>}}`;
   - the **direct (authorization) projection** the non-widening rule's dual run
     evaluates each host-mediated authorization decision against — an enumerated
     sealed value, exactly
     `{userId: U, isAuthenticated: true, roles: [], kind: <U's kind>}` with
     **no `sessionId` and no `provider`**, because the authorization projection
     excludes authentication-shape fields so the direct baseline cannot be keyed
     on *how* the user authenticated;
   - **`kind` added to the session and dev-impersonation projections** — the
     authenticated session becomes
     `{userId, sessionId, isAuthenticated: true, provider, roles: [],
     kind: <the user's kind>}`, and dev impersonation carries `kind = "human"`
     by default (an impersonated agent kind is the 0024 `--as-agent` option);
   - the **anonymous answer carries no `kind` key at all** — the sealed
     anonymous projection stays
     `{userId: null, sessionId: null, isAuthenticated: false}`, so a rule
     referencing `auth.kind` resolves null and fails closed under LLP 0011's
     missing-auth-variable rule. `adminBypass` and `system` continue to receive
     the anonymous handler projection (LLP 0055 §Resolved authority;
     §Principal kinds).

4. **Three new auth-variable IR expression kinds are admitted analyzable
   inputs.** Today the IR carries only `auth.userId` (`ValueExpr::AuthUserId`).
   LLP 0055 adds `auth.kind`, `auth.actorKind`, and `auth.isDelegated`; under §2
   these are **admitted**, not denied as newly added expression kinds. Each is a
   pure function of the sealed current authority resolved from the `ctx.auth`
   projection at subscribe time, carrying no `MutableNonDatabase` input:
   `auth.kind` is the *effective* principal's kind, `auth.actorKind` the actor's
   kind, and `auth.isDelegated` whether the invocation is delegated. Admitting
   them does **not** relax the non-widening guarantee — that rule is
   host-enforced by the dual run against the direct projection in classification
   3 (a delegated invocation is authorized only where the effective user's direct
   projection would also authorize it, and the result is intersected), and actor
   variables can only ever *narrow* (LLP 0055 §Resolved authority). The
   retainability invariant is unchanged: `auth.kind` is a pure function of the
   immutable `userId` and stays compatible with `Retainable ⇒ userId-only`,
   while `auth.actorKind` and `auth.isDelegated` are not, so a query reading them
   is retention-ineligible — moot in v1, where service principals are
   online-only.

5. **The grant-scoped `delete` disposition is recorded here so the client-wide
   session rule is not misapplied.** §Dispositions and the client-transition
   table pin "**An authority transition under LLP 0039 always uses client-wide
   `delete`**." That sentence is scoped to LLP 0039 **session** transitions,
   where a client that has lost its identity may hold nothing. LLP 0055 defines a
   **grant-scoped** narrowing for **multi-grant agent clients**: an agent client
   may hold several live grants and tokens on one store at once, with the
   **carrier axis** `(tokenId, connectionId)` deliberately separated from the
   **durable authority axis** `(actorUserId, credentialId, credentialGeneration,
   grantId)`. A single grant/credential/token ending therefore projects `delete`
   only onto the state bound to that carrier/grant — token revocation or cap
   eviction ends only the carrier instances bound to that `tokenId`, while
   another live token's connections on the *same* grant are untouched (query
   instances are never reused across carrier instances, so a stale callback from
   an evicted token cannot address a surviving one). It is still a `delete`
   disposition and still an **authority transition, not an authorization event**;
   only the blast radius is grant-scoped rather than client-wide (LLP 0055
   §Ending authority). A future reader at the client-wide sentence must not apply
   it to a grant-scoped agent ending.

**What this amendment deliberately does not touch — the narrowness is the
point.** Each of the following needs **no** amendment, and the classifications
above are written to leave them intact:

- **The authorization-event universe is unchanged.** Pure grant, credential,
  token, invitation, and principal transitions add **no** new enumerated event —
  they are authority transitions (classification 5; LLP 0055 §Ending authority) —
  and manifest activation remains the **existing event 2**. No event is added,
  removed, or reclassified, and steady-state authorization-event amplification
  stays zero.
- **The trusted-denial producer enumeration is unchanged.** 0056's `requireRole`
  denial is produced by the **existing** host-owned `ctx.permissions.deny()` /
  `TerminalAuthorization` operation and the **existing**
  `SNAPBACK_AUTH_PERMISSION_DENIED` code; no new trusted producer or code is
  registered, and the closed enumeration in §Dispositions stands as written.
- **The `permissionBacking` machinery is unchanged.** A membership declaration
  *is* `permissionBacking: true` in the existing sense (LLP 0056 §Invalidation),
  consumed by the same one-commit-hook rule, `permissionFields` narrowing, and
  matcher/read-summary paths, with no new mechanism.

### Asset read-authorization inputs (amended 2026-07-31, LLP 0044)

This dated classification admits
[LLP 0044](./0044-asset-storage-pipeline.rfc.md)'s asset
read-authorization dependencies, required because the protected-query
profile above is default-deny: a newly added expression kind is denied
until this profile classifies it. Result: **no new authorization events
and one admitted expression kind** — every other input lands inside an
existing admitted category, so the closure claim holds.

Asset metadata live state and `private-strict` delivery decisions depend
only on: the asset system row (owner principal, availability, admitted
policy identity) — ordinary snapshot-bound database reads; the
reverse-reference edge set, read through the edge index **with pinned
empty-result capture over the index range**, so the first attachment
wakes a subscription that previously matched nothing — the same
load-bearing pattern as the 0056 membership empty capture above; the
declared asset-sharing predicate over referencing rows, whose variants
add only admitted inputs (`public-read` adds no dependency, `owner`
adds an ordinary row read, `membership` is the already-admitted
membership predicate node); and the sealed `ctx.auth` projection. The
**asset-readable predicate node** — the existential over
sharing-admitting referencing rows that LLP 0044 §Asset read
authorization defines — is admitted as an expression kind under §2 in
the 0056 idiom: snapshot-bound, participating in the complete
read/capture summary including its empty-result ranges, admitting no
clock, id, or other `MutableNonDatabase` input.

Two boundary notes. Intent policy activation is **event 2** — a changed
upload intent stages, validates, and atomically activates with the
bundle, firing an authorization event; LLP 0044's explicit operator
revocation action is **event 4**. Neither is a new event. And LLP 0044's
finalization-time authorization witness is LLP 0007's commit-time
read-set contract, not this document's protected-query machinery; its
obligations stay with 0007/0044, while signed-URL bearer windows retain
exactly the declared weaker profile semantics 0044 states — nothing here
claims strict revocation for them.

This confirms LLP 0044's working assumption (its §Open questions): the
asset system tables need no `permissionBacking` classification for these
decisions, because every decision reads them as ordinary captured
dependencies whose changes are ordinary committed writes already inside
the invalidation perimeter.

### Ephemeral room authority invalidation

Item 6 owns the authorization-invalidation half of ephemeral rooms too. LLP
0013 owns room storage, TTL, coalescing, and snapshot registration; LLP 0039
owns server-resolved connection authority and mode-specific DTOs. This RFC owns
what happens when the durable facts backing a room permission change.

An ephemeral collection with a room permission declares the durable
`permissionBacking` tables/fields its membership projection reads. Unknown
fields, incomplete dependency metadata, or an un-targetable subject target
conservatively every live protected room subscription whose declaration may
depend on the cause. This protocol does **not** advance the room's sequencing
`scopeEpoch`; it advances a separate room-authority generation.

**The room boundary is commit-ordered, not merely a post-commit callback.** A
post-commit `RoomAuthorityResync` alone leaves a real leak window: the database
commit can return, then an off-write-lane publish, outbox drain, or socket send
can act under the old room authority before the callback installs the new
generation. Every writer that may commit events 1–4 therefore performs this
two-phase room transition:

1. **Prepare before commit.** Under the dependency-indexed protected-room
   registry admission gate, install a unique
   `RoomDependencyPending { ticket, selector, expected_authorization }`. In the
   same short critical section, derive the conservative existing affected-room
   set and install a matching
   `RoomAuthorityPending { ticket, expected_authorization }` barrier in each
   affected room authority. Protected-room registration and initial snapshot
   installation use that same admission gate: they either complete and become
   registry-visible before the dependency ticket, in which case enumeration
   includes and quiesces them, or observe the ticket and publish no room
   authority/snapshot until it resolves. There is no enumerate-then-register
   gap. After releasing the registry gate, wait for every already-admitted
   `RoomAuthorityPermit` to quiesce. The durable commit may begin only after all
   targeted barriers report quiescent. If targeting, dependency-ticket or room-
   barrier installation, or quiescence cannot be established, the write does
   not commit.
2. **Commit without a room lock.** The dependency ticket and room barriers are
   level-triggered state; no registry, room, outbox, projection, or sender mutex
   is held across the database commit, and the room fast path never takes the
   global write mutex. The fail-closed cost is temporary suspension, not lock
   inversion.
3. **Finalize by exact ticket.** On rollback, compare-and-remove only that
   operation's registry and room tickets; another overlapping pending ticket
   keeps admission and the affected barrier closed. On commit, finalize the
   dependency ticket and room tickets to
   `RoomAuthorityResync { authorization, min_commit_version,
   room_authority_generation }`, purge or strand old-generation frames, and
   keep affected subscribers and blocked new registrations suspended until
   reauthorization completes at or after `min_commit_version`. A
   commit result that is ambiguous leaves that exact ticket pending and every
   sink closed until reconciliation proves the durable transaction committed or
   definitely rolled back; only committed proof finalizes, and only definite
   rollback compare-removes. Timeout never guesses rollback. A crash after
   commit destroys the process-local room; the next registration
   fresh-authorizes, so the unobserved finalization cannot reopen continuity.

Every ephemeral effect sink participates in the same gate. Protected-room
registration and initial snapshot installation interlock atomically with the
dependency ticket through registry admission. Publish/room mutation,
fanout/enqueue, destructive outbox drain, and the final WebSocket/HTTP send each
acquire a single-use `RoomAuthorityPermit` and compare the captured room-
authority generation with the current non-pending generation **atomically with
that sink's act**. Envelopes carry the generation. Drain drops a stale generation
under the outbox lock; send checks again under the serialized sender gate, so a
frame drained before the barrier but not yet sent cannot escape after the commit.
The registry interlock and prepare-phase permit wait make registration and every
already-entered sink linearize before the durable commit; every later act
observes the pending/new generation and refuses. A check performed before
registration, snapshot publication, enqueue, drain, or send and released before
the act is explicitly non-conforming.

After commit, the room authority completes the existing reauthorization
transition:

1. take a fresh durable permission snapshot at or after the causing commit and
   re-resolve the connection-bound authority;
2. atomically rebuild the subscriber's `authContext`/`visibleKeys` and emit a
   fresh room snapshot if still authorized, or unregister it, delete its
   connection-owned entries, and emit the trusted typed permission denial if
   not; and
3. acknowledge the room obligation and reopen the new generation only after the
   snapshot/removal boundary commits.

The obligation re-fires on the room heartbeat until acknowledged. Process death
needs no durable room tombstone: it destroys the process-local room and every
later subscriber enters through LLP 0013's fresh snapshot/register transaction.
An adapter that preserves rooms across process/hibernation boundaries must
preserve this authority obligation too or report the room capability
unsupported. An auth-changing write therefore cannot leave a kicked player
streaming presence/cursors while the durable board has already quarantined.

This reintroduces LLP 0013's formerly ownerless `AuthChanged` resync and
`AuthRevoked` removal meanings with an owner and a producer. It does not make
custom ephemeral keys safe; LLP 0039's key-level authorization gap remains
fail-closed and separate.

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
  `(incarnation, epoch)`. A missing persisted authorization witness is not proof
  of continuity: retained/offline state is deleted before a fresh snapshot.
- A live resume never treats an equal authorization pair as proof that a cached
  result is still authorized: session-mode auth-scoped scopes resnapshot before
  becoming visible. Retained boot uses `(incarnation, epoch)` only as the
  authorization component of its composite witness; a missing incarnation, an
  incarnation mismatch, or a version-stream mismatch forces `delete`, while an
  equal incarnation with a newer epoch starts `quarantine`. (The shipped resume
  compares bare `u64`s with `!=`, so the naive `0 → 1 → reset → 0` sequence is
  already caught; the real ABA needs re-advancement to a previously recorded
  value — `0 → 1 → reset → 0 → 1` — which the incarnation closes.)
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

So invalidation is **level-triggered state with a composite witness**, not an
event in a queue:

```
IssuerId {
  authorization_incarnation,
  boot_sequence,      // durable monotone reservation; never reused
  boot_nonce,         // 128-bit CSPRNG value
}

AuthenticatedBootIssuer {
  issuer_id: IssuerId,
  key_id,
  mac,                // server protocol-key MAC over issuer_id + target/app
}

ScopeId =
    Subscription {
      issuer_id,
      namespace: { client_store_id, query_key, query_instance_id },
      scope_sequence,
      connection_generation,
      subscription_id,
    }
  | Connection   { issuer_id, connection_generation }
  | ClientQuery  { client_store_id, query_key, query_instance_id }

CompositeWitness {
  authorization: { incarnation, epoch },
  data: Option<{ version_stream, min_commit_version }>,
}

ResyncObligation {
  scope_id: ScopeId,
  revision: u64,                                  // monotone; never reused
  max_disposition: retain | quarantine | delete, // monotone
  witness: CompositeWitness,
  retry_episode_id: Option<OpaqueId>,
}

RetryEpisode {
  episode_id: OpaqueId,
  authority_subject,
  client_store_id,
  query_key,
  witness_floor: CompositeWitness,
  first_attempt_reserved_at_ms,
  first_failure_at_ms: Option<u64>,
  attempts_reserved: u8,                         // includes initial attempt
  deadline_ms: Option<u64>,                       // first failure + 15_000
  manual_retry_id: Option<OpaqueId>,
}
```

`query_key` is the canonical function-plus-arguments retained-store key; the
store-owned `client_store_id` is shared by tabs that share those bytes, and the
store allocates `query_instance_id` as §Client fences pins. Both the
`Subscription.namespace` and `ClientQuery` scope carry that exact instance id.
The server binds the complete namespace into the scope and issues the issuer,
scope sequence, connection generation, and subscription id. Before binding a listener, it transactionally
increments a durable boot counter, generates the nonce, and authenticates the
descriptor with a stable protocol key. Failure to reserve or authenticate the
issuer prevents app-data bind. Connection generations and per-namespace scope
sequences are monotone reservations within that issuer; a reservation is
consumed before the operation that can publish its scope, and crash never makes
it available again. The full live `ScopeId` is therefore never reused across
restart, restore, or churn. A `ClientQuery` scope is likewise never reused: its
store-wide allocator survives payload compaction and allocates a new id after
terminal retirement even when `client_store_id` and `query_key` are unchanged.
These fields are discriminators, not authorization claims: every server
operation still uses LLP 0039's connection-bound authority, and a client accepts
an issuer only through the authenticated bootstrap/connection expectation.

**State machine, specified where the shipped queue failed:**

| Constant | v1 value | Meaning |
|---|---:|---|
| `AUTH_INVALIDATION_REFIRE_MAX_MS` | `5_000` | maximum healthy-session heartbeat/poll interval while an obligation is pending |
| `AUTH_ERROR_RETRY_WINDOW_MS` | `15_000` | non-resettable automatic retry window measured from the first failure |
| `AUTH_ERROR_ATTEMPTS_TOTAL` | `3` | initial attempt plus at most two automatic retries |
| `AUTH_RETRY_EPISODE_MAX_GLOBAL` | `10_000` | hard cap on durable current/exhausted retry episodes for one app |
| `AUTH_RETRY_EPISODE_MAX_PER_AUTH_STORE` | `1_024` | hard cap for one `(authority_subject, client_store_id)` |
| `AUTH_LEASE_DEFAULT_MS` | `86_400_000` | 24-hour default retained-read authorization lease |
| `AUTH_LEASE_HARD_MAX_MS` | `86_400_000` | 24-hour absolute ceiling before session/provider clamps |

- **Identity and revision.** There is at most one current obligation per
  `scope_id`, not one queue entry per event. Each distinct semantic cause
  allocates the next revision; duplicate projection of the same cause is
  idempotent, and retransmitting a revision does not advance it. A live
  `Subscription`/`Connection` revision high-water survives discharge until
  authenticated scope/issuer retirement folds it into a monotone frontier. A
  `ClientQuery` revision high-water survives until that exact instance's
  terminal retirement finalizes. A delayed acknowledgement can therefore never
  clear a later obligation. The issuer/sequence rules make live-scope reuse
  impossible, while the store allocator makes client-query-scope reuse
  impossible, rather than either being merely improbable.
- **Merge and currentness.** Revisions compare only within an identical
  `scope_id`; records from different scopes coexist and are never ordered by
  revision. Within an equal authorization pair and version stream, merge takes
  the greatest `min_commit_version` and `max_disposition`; `data: None` never
  weakens an existing `Some` in that stream. Within one incarnation, the greater
  epoch is current and a delayed lower-epoch record is stale. A different
  incarnation or version stream becomes current only when the authenticated
  bootstrap/connection expectation names it — never because its frame arrived
  last. Moving to that authenticated expectation applies the old record's
  disposition before replacement and requires new proof before release. A
  delayed old-pair/old-stream frame is ignored and cannot increment a client
  generation. An authorization-only change preserves any same-stream data floor.
  A substitute resync inherits the full witness and disposition of what it
  replaces.
- **Scope and durability — one matrix, rather than a contradictory blanket
  rule:**

  | Cause | Durable authority | Live projection | Retained projection / lifecycle |
  |---|---|---|---|
  | matcher removal or potentially shrinking `live_replace` | the causing database commit | post-commit `Subscription` obligation, in memory | connection death destroys the live scope and mandatory fresh subscribe resnapshots |
  | connection overflow or lost delivery | existing subscription obligations plus a `Connection` projection root | in memory, expanded into one child `Subscription` obligation per auth-scoped subscription on the connection | cannot weaken an existing query tombstone |
  | enumerated authorization event | the `AuthorizationVersion` advanced transactionally with the cause — **not O(number of clients) rows in that transaction** | live query obligations project post-commit; protected rooms install and quiesce their pending sink barriers before commit, then finalize the obligation/generation post-commit | each connected client persists a tombstone for the exact `ClientQuery` instance; a reachable client discovers the durable version mismatch at boot/reconnect before read, while a truly offline client has only its lease |
  | reset/import/declared restore | new durable incarnation | connection scopes terminate | incarnation mismatch is `delete`, never quarantine-and-release |
  | lease expiry | lease carried by the retained record | n/a | durable delete tombstone for the exact `ClientQuery` instance; it cannot target a later instance at the same canonical key |

  Thus subscription/connection state is persistent until discharge but
  deliberately not disk-durable. Its crash window closes because process death
  kills continuity and every subsequent live subscribe resnapshots. Client-query
  tombstones are genuinely durable because the retained bytes survive restart.
  A coarse event does not enumerate offline clients in its transaction; the
  durable authorization version is the authoritative cause from which their
  obligations are projected on boot/reconnect.
- **Connection roots have query-sized children.** A `Connection` obligation is
  a server-side projection root, not a client-ACK target. For its current
  revision the server creates or merges a child `Subscription` obligation for
  every current auth-scoped subscription, records the child set, and adds a
  child before admitting a new subscription while the root remains live. A
  query snapshot can discharge only its child. The root clears only after every
  current child is exactly discharged or its subscription continuity ends; if
  the connection dies, the root dies with it and every later subscription
  fresh-snapshots. One arbitrary query ACK can never clear an N-query overflow.
- **Authenticated retirement closes extinct scopes and server boots without
  unbounded history.** Retirement is neither an ACK nor release proof. Two
  authenticated forms exist:

  - `ScopeRetirement { issuer_id, namespace, retire_through_scope_sequence,
    authorization_expectation, mac }` retires a **contiguous** prefix for one
    current-issuer query namespace. The server cannot advance the prefix across
    a live or unresolved scope. Exact active entries above it are bounded by the
    connection/subscription caps.
  - `IssuerRetirement { current_issuer, retire_through_boot_sequence,
    authorization_expectation, mac }` proves every older server boot is extinct.
    A new process may issue it even when the old process crashed before an exact
    retirement, because the boot counter reservation proves the old issuer can
    never return. It cannot release bytes by itself.

  Client-query lifecycle retirement is deliberately separate from those two
  server-authenticated prefix proofs. Payload or tombstone-body compaction is
  **not** retirement: it retains the minimal `QueryAuthorizationState`, exact
  `query_instance_id`, and revision high-waters. Retirement is a serialized,
  terminal, destructive transition for the exact current `ClientQuery` instance:

  1. atomically change `query_lifecycle` from `active` to `retiring`, advance
     both `query_generation` and `queue_generation`, apply the maximum pending
     disposition, destroy the instance's payload, lease and lease-request
     reservation, accepted snapshot, optimistic overlays, and live boundaries,
     and make dependent queue custody discard-only;
  2. keep the crash-recoverable `retiring` marker, exact pending token state,
     and each token's owner-continuity id. A scope already discharged before
     retirement is complete. An already-issued terminal-delete token may be
     ACKed idempotently only after the destructive retirement commit has applied
     its delete. Snapshot/quarantine resolution is never ACKed by retirement;
     its authenticated exact owner continuity must end. Retirement never
     synthesizes an ACK, release proof, or permission proof;
  3. only then remove the per-instance maps, fences, and marker while preserving
     the store-wide allocator high-water. A crash before this transition leaves
     the old state to resume; a crash during it resumes `retiring` and cannot
     render, replay, or expose bytes.

  A later explicit initialization of the same canonical key allocates a new
  `query_instance_id` and must fresh-snapshot before render. Missing or
  mismatched state rejects an incoming frame before map lookup and cannot be
  created by that frame. While `retiring`, every obligation, snapshot, callback,
  render/materialization, and queue frame is rejected; the only accepted inputs
  are idempotent completion of an already-issued terminal-delete ACK and
  authenticated retirement of an exact recorded owner continuity. Thus
  old-instance obligations, proofs, ACKs, callbacks, and leases cannot address
  the recreated instance.

  Before accepting either proof, the serialized coordinator advances the shared
  `query_generation` **and** `queue_generation`, applies the maximum pending
  disposition for the retired scopes, and rejects every callback, render,
  resume, frame, or queue act captured by an old scope/issuer. It then requires a
  fresh snapshot under the authenticated current issuer whose composite witness
  satisfies **every** retired pending witness. `delete` is committed before the
  fresh snapshot installs; quarantine remains hidden until install. Only after
  that transition may it fold exact entries into the durable frontier and
  recompute the aggregate. A crash before the snapshot leaves the frontier
  unchanged; the next boot repeats the same fail-closed sequence. A returning
  tab always receives a new issuer/scope and fresh-snapshots before render.
- **Resolution ticket and acknowledgement.** A successful superseding snapshot
  is evaluated at one coherent point and carries its authorization pair, version
  stream, and snapshot commit version. A typed
  `SNAPBACK_AUTH_PERMISSION_DENIED` instead yields a terminal-delete proof at a
  coherent authorization/data witness; its observed commit version must satisfy
  the obligation floor even though it carries no rows. Reset/import/restore and
  authenticated incarnation/stream mismatch may likewise issue a terminal
  boundary-delete proof. The server binds an opaque acknowledgement token to
  `(scope_id, revision, witness, max_disposition, resolution proof)`. The client
  acknowledges a snapshot only **after** its serialized coordinator atomically
  applies the disposition/snapshot, and acknowledges a terminal proof only after
  the live boundary is destroyed and the durable delete/fence commits. Exact
  wire encoding belongs to this RFC's LLP 0051 D4-registered vocabulary; these
  fields are the semantic minimum.
- **Compare-and-discharge — the only way out.** The server clears only if the
  acknowledgement names the *current* full scope and revision. For a
  `ClientQuery`, that comparison includes `query_instance_id`; a token for a
  retired instance is stale even when store, key, revision, and witness happen
  to match a recreated instance. A snapshot proof must
  use the current authorization incarnation/epoch and version stream and have a
  commit version at least `min_commit_version`. A terminal-delete proof must be
  current, token-bound, authorized for that producer, and evaluated at the same
  floor. Pair/stream changes or a later merged revision make either proof stale.
  Sent, drained, timed-out, and stale acknowledgements do not discharge.
  Duplicate acknowledgement after a successful discharge is idempotent.

  > **This is the correction that makes obligations mean anything.** The
  > authorization epoch deliberately does not move for a matcher-path removal.
  > A version-99 snapshot therefore cannot discharge a removal committed at 100,
  > and an acknowledgement for revision R cannot discharge a second removal
  > merged as R+1 at 105. The authorization pair answers "under which policy?";
  > the data witness answers "after which row change?"; neither substitutes for
  > the other.
- **Error retries are durable server-owned episodes, not timers attached to a
  frame.** Before every obligation-resolution invocation, the server
  transactionally reserves the next attempt in auth-control state. The initial
  invocation is attempt 1; at most attempts 2 and 3 are automatic. On its first
  untyped failure the server records rollback-checked `first_failure_at_ms` and
  fixes `deadline_ms = first_failure_at_ms + 15_000`; if the process dies after
  reservation but before recording an outcome, the reservation is consumed and
  its earlier reservation time becomes the conservative failure origin. A
  reservation crash therefore shortens, never extends, the window.

  The episode key is the authority subject plus canonical client-store/query key
  and the unresolved composite witness floor — **not** scope id or obligation
  revision. A newer revision merges into and raises that floor; duplicate
  re-fire, reconnect, scope replacement, and server restart reattach the same
  durable episode and cannot reset attempts or time. Revision change alone does
  not create an automatic attempt. Query-instance retirement or recreation also
  reattaches the same canonical-key/witness episode and cannot erase or reset an
  unresolved or exhausted budget. Any old-instance resolution must be
  reprojected through the current full scope; its proof or ACK token never
  transfers directly. A satisfying snapshot or trusted typed denial
  closes the episode. After exhaustion/deadline, the query remains quarantined.
  A new episode requires an explicit, authority-checked manual retry carrying a
  fresh idempotency id; ordinary subscribe/reconnect is not manual retry. Server
  clock rollback (under the shared auth clock high-water below) consumes no extra
  invocation and closes automatic retry fail-closed at quarantine rather than
  reopening or extending the window.

  **Retry storage is hard-capped and never safety-evicted.** Global and
  per-`(authority_subject, client_store_id)` counters are maintained in the same
  auth-control transaction as episode insert/replace/delete. Creating a new
  episode at either cap returns
  `SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY`, leaves the query quarantined, and runs
  **no** handler attempt; repeated re-fire/reconnect/restart performs the same
  capacity check and cannot turn refusal into an implicit retry. No unresolved
  or exhausted episode is evicted to admit a different key, because forgetting
  it would reset the three-attempt limit. A satisfying snapshot or trusted
  denial may remove the episode only after its durable resolution proof has
  been transferred to the still-live obligation; an exact idempotent manual
  retry replaces the same key rather than briefly doubling its records.
  Incarnation retirement may delete episodes whose witness can never be current
  again. Missing/malformed counters are rebuilt from the bounded table before
  admission; an already-over-cap database admits no new episode while allowing
  resolution/deletion to reduce it. This consciously trades availability for a
  finite fail-closed store under unique-query churn.
- **Level-triggered re-fire and promptness.** Raise performs an immediate delivery
  wake. Connection open, subscribe/resume, every HTTP drain, and every live
  heartbeat consult current obligations and project them again. Session-mode
  heartbeat and poll cadences are capped at **5 seconds**, so a healthy connected
  client sees an undischarged obligation within five seconds even if the first
  edge or response is lost. An unknown/reaped subscription or drain is a typed
  resnapshot-required boundary, never an empty healthy result. Wakeup frames are
  hints; the obligation record is truth.
- **Capability gate.** The bootstrap/connection handshake advertises a
  must-understand `authInvalidationProtocol: 1`, covering dispositions, composite
  witnesses, authenticated boot issuers and retirement frontiers, tombstones,
  exact query-instance scope identity, revision-bound acknowledgement, durable
  retry episodes, room-authority invalidation, and ACK-after-commit. Item 8 separately advertises
  `authorizedLeaseProtocol: 1` plus the lease facts below; its absence keeps
  retained reads disabled but does not block item-6 live invalidation.
  Every session-mode auth-scoped live subscription — not only retained reads —
  requires it. A missing/older client is refused with
  `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`; an already-connected legacy
  session client is closed and must upgrade. The boolean `clear_retained` is a
  versioned compatibility projection for dev/authority-independent paths, never
  a session-mode security carrier.

  **Session activation matrix (identical in LLP 0039 and LLP 0053):**

  | Landed items | Session-mode admission |
  |---|---|
  | **1–5** | `auth.mode: "sessions"` may activate. Ordinary online request/response and explicitly `authorityIndependent` live surfaces are allowed. Every auth-scoped live surface (durable subscribe/resume or protected ephemeral-room registration) is refused server-side with `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE`; retained/offline reads remain refused. |
  | **+6** | Auth-scoped live surfaces unlock only when server and client negotiate `authInvalidationProtocol: 1`; retained/offline reads remain refused. |
  | **+7** | No admission change. The authority descriptor is an optional additional equality axis and item 7 may land before item 6. |
  | **+8** | Retained/offline reads unlock only when the item-8 lease/store capability is also negotiated. |

- **Obligation/tombstone GC is monotone and bounded by live state, not lifetime churn.** A
  subscription/connection obligation dies on exact discharge or continuity
  loss (whose replacement must resnapshot). A client-query payload and bulky
  tombstone body may compact after exact discharge, or after lease expiry has
  made the bytes unreadable and deletion has committed, but that compaction
  retains the minimal current-instance fence. Only the terminal retirement
  transition above removes per-instance state. Durable safety reduces to: one
  store-wide monotone `query_instance_id` allocator; one minimal state per
  extant query; one retired
  boot-sequence frontier per authorization incarnation; one retired scope-
  sequence frontier per current live query instance/issuer; and exact entries
  only for bounded active/unresolved scopes above those frontiers. Once terminal
  retirement finalizes, its former per-instance state can disappear. No
  historical query-instance set or per-key frontier is retained: an absent key
  rejects frames without allocation, while a recreated key has a different id
  and rejects the old full scope before lookup. Frames at or below a live-scope
  frontier are likewise ignored before lookup. Lease expiry is not tab
  death and does not advance a frontier by itself. Thus one million
  subscribe/unsubscribe or compact/retire/recreate cycles and boot crashes grow
  scalar high-waters plus current/bounded state, not one durable row per
  historical scope or query key. `RetryEpisode` records are not hidden inside
  this frontier argument: their separate hard caps and fail-closed admission are
  the boundedness proof for unique canonical-query churn.
- This **supersedes LLP 0032 P4's** decision that destructive drain needs no
  acknowledgement because a later snapshot recovers it. That reasoning holds for
  *data* — positive information self-heals. It does not hold for a *revocation*:
  negative information does not self-heal on the delta path, and on the replace
  path it self-heals only if a next delivery ever arrives.

### Dispositions, with producers and meanings

| Disposition | Producer | Client obligation |
|---|---|---|
| `retain` | recovery proved not authorization-negative: an `authorityIndependent` subscription, or overflow/fan-out recovery with no pending auth-scoped shrink/error obligation | resnapshot; current rows may remain visible; never substitutes for or weakens a stronger obligation |
| `quarantine` | every ordinary coarse permission/activation/out-of-band revocation event; every known/potential auth-scoped result shrink until its superseding snapshot is atomically applied and acknowledged; every untyped re-query error, including exhausted bounded retries | hide from render immediately and **block reads**; preserve state in suspended form; release only on a satisfying superseding snapshot, or escalate on proof |
| `delete` | **proof**: typed `SNAPBACK_AUTH_PERMISSION_DENIED`; a superseding snapshot proving access is gone; `reset`, import, declared restore, or version-stream/incarnation mismatch; lease expiry without revalidation | destroy affected live/retained data and leave the fence tombstone; authority loss additionally follows LLP 0039's client-wide delete |

`SNAPBACK_AUTH_PERMISSION_DENIED` is a trusted invocation outcome, not an
application-chosen error string. Its only v1 producers are: the declarative
read/RLS permission evaluator; the room-authority reauthorization gate above;
and the shared invocation gate's host-owned terminal
`ctx.permissions.deny()` operation. That operation records an unforgeable host
brand and terminates the invocation even if JavaScript catches a local
exception; subsequent handler rows are discarded. A thrown object, returned
envelope, adapter string, or forged `{code: ...}` is untyped and therefore
quarantines. LLP 0011/LLP 0004 own the app-facing permission-denial API; LLP
0039's shared gate owns trusted production and redaction; this RFC owns only the
`delete` disposition and proof/ACK semantics. The terminal producer must report
the coherent authorization/data witness but never echo private permission facts
to the client.

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

The client transition is disposition-specific; "clear" is not one operation:

| Disposition | Live rows | Retained bytes | Optimistic overlays | Pending mutations |
|---|---|---|---|---|
| `retain` | remain renderable while resnapshot runs | remain readable under their lease | continue | continue |
| `quarantine` | hidden and read-blocked before resnapshot | kept but read-blocked | hidden and suspended; no reconciliation may publish | suspended; release on proof of continued authority, otherwise strand as redacted discard-only records |
| `delete` | destroyed | destroyed; durable tombstone remains | destroyed in the affected scope | destroy affected entries; if independence cannot be proved, the current AuthCoordinator custody queue is the conservative scope |

An authority transition under LLP 0039 always uses client-wide `delete`.
(**Amended 2026-07-14, ENG-24906:** this client-wide rule is scoped to LLP 0039
*session* transitions; LLP 0055 defines a **grant-scoped** `delete` for
multi-grant agent clients, where only the state bound to the ending
grant/carrier is destroyed — see §Agent-auth protected-query inputs,
classification 5.) A
coarse permission event uses query-scoped quarantine and therefore does **not**
destroy queues and overlays on what is usually a false positive. The serialized
barrier is: persist the fence/tombstone and hide or destroy the specified state,
then resnapshot; no callback or replay runs between those steps.

Pending mutations do not borrow a query fence. Item 5's AuthCoordinator custody
owns a separate `QueueAuthorizationState { authority_generation,
queue_generation, pending_by_scope }`. Because v1 has no mechanically proved
mutation-to-query mapping, every auth-scoped query quarantine conservatively adds
a suspension root to the current custody: queue execution/replay pauses, entries
remain redacted and non-executable, and releasing one query does not resume the
queue while any other root remains. Continued-authority proof removes only its
exact root. A `delete` root strands that custody's queue as explicit discard-only
records unless independence is proved. Every enqueue, settlement, replay, and
discard captures `(authority_generation, queue_generation)` and
compare-and-commits it independently of `query_generation`. Item 7's
`authority_instance_id`, once present, is an additional replay/storage equality
axis; its absence is valid here and item 6 does not depend on it.

The dated LLP 0011 amendment ratifies this narrow refinement explicitly:
"clear" means immediate read/render denial; `quarantine` satisfies it while
authority is uncertain, and `delete` follows proof. It preserves 0011's
fail-closed outcome without pretending its earlier generic verb pinned this
state machine.

### The lease: the only mechanism for the unreachable client

A revoked credential cannot reach an offline device. No obligation, no epoch, no
disposition helps — the device is not listening. So every retained auth-scoped
snapshot carries this exact server-issued envelope:

```
AuthorizedLease {
  protocol_version: 1,
  lease_id: OpaqueId,
  lease_request_id: OpaqueId,
  issuer_id: IssuerId,
  client_store_id,
  query_key,
  query_instance_id,
  principal_id,
  session_id_at_issue: Option<OpaqueId>,
  provider_key: Option<String>,
  authorization: { incarnation, epoch },
  data: { version_stream, snapshot_commit_version },
  activation_hash, // exact active bundle + manifest identity
  issued_at_server_ms,
  authorized_until_server_ms,
  session_not_after_ms: Option<u64>,
  provider_not_after_ms: Option<u64>,
  authority_instance_id: Option<OpaqueId>,
  key_id,
  mac,
}
```

The MAC covers every field plus target/app identity. Its domain-separated
verification key survives ordinary server restart; retired verify-only keys stay
available for at least the 24-hour hard maximum, and an unknown key fails closed.
`issuer_id` authenticates issuance provenance but boot retirement applies only
to live ScopeIds: an ordinary restart does not by itself expire an otherwise
valid offline lease, while any transition back to live still fresh-snapshots.
`authority_instance_id` is an **optional additional equality axis** when item 7
is available; its absence is valid and item 6 does not depend on it. The
mandatory authority binding is the server-resolved principal plus authorization
pair. Retainability is already restricted to `userId`-only result dependence, so
session/provider identity is recorded for clamp and audit rather than smuggled
in as a new result axis.

**Verification locus (amended 2026-07-14, ENG-24992).** The MAC's verification
key is a server secret, so cryptographic verification happens only where that
key lives. The **server** authenticates `key_id` and `mac` whenever a lease is
presented for revalidation-free service; the unknown-key fail-closed rule above
is a server-keyring rule, and a single flipped MAC bit is refused there
(`AuthorizedLeaseAuthenticator::verify_for_service`). The **client** cannot and
does not verify the MAC. Client custody validation promises exactly:
structural validation of the closed envelope including canonical base64url MAC
form, binding equality against the current query authority, clamp/duration
arithmetic, expiry and clock-rollback enforcement, and post-commit
corruption/substitution detection through the stored unkeyed lease hash that
pins the exact issued bytes. `key_id` is opaque to the client; an unknown key
is client-undetectable and is refused server-side. A canonically shaped but
forged MAC therefore passes client custody validation **by design** — this
admits nothing, because the honest/hostile analysis below already establishes
that a client reading its own retained bytes needs no forged lease, and any
attempt to use one against the server fails the keyed verifier. An earlier
reading of this section and of LLP 0043's fail-closed list ("invalid-MAC lease
deletes ... before exposure") implied client-side cryptographic MAC
verification; that would require distributing verifier material to clients — a
key-distribution design v1 deliberately does not include — and is explicitly
disclaimed rather than promised.

`query_instance_id` isolates lease effects as strictly as obligation effects.
A lease issued for instance A cannot install into, renew, quarantine, or delete
a later instance B at the same `(client_store_id, query_key)`. A stale A record
is destroyed only in A's identity domain and is otherwise ignored by B. If the
record that claims to be current B contains a missing, malformed, or mismatched
B lease, B still takes the ordinary fail-closed delete-before-read transition.
Terminal query-instance retirement always destroys that instance's lease and
lease-request reservation before its minimal state can be removed.

The constants are not product-owner TODOs: v1 defaults to **24 hours** and has a
**24-hour hard maximum**. An app may configure a shorter duration only. At
issuance:

```
authorized_until_server_ms = min(
  issued_at_server_ms + configured_duration_ms, // configured <= 86_400_000
  issued_at_server_ms + 86_400_000,
  session_not_after_ms if present,
  provider_not_after_ms if the provider assertion has one,
)
```

A missing required session expiry, an already-expired clamp, an overflowing
addition, or a provider claim that cannot be normalized fails issuance closed.
No target/provider may advertise a larger value as a capability. This is a
**required v1 mechanism**: without it the unreachable-client exposure is
unbounded.

**One revalidation, one atomic proof.** The server evaluates the full query,
authorization version, and active bundle/manifest identity at one coherent
database snapshot. Lease issuance then enters the same commit-order gate used by
app-data writers, authorization-version advances, and activation swaps, and in
one short serialized transaction proves all of the following before reserving
the lease:

1. the current version stream is the captured stream and the **current app-data
   head equals `snapshot_commit_version` exactly** (v1 deliberately chooses the
   conservative head check rather than a captured-dependency optimization);
2. the current authorization pair and server-resolved authority/session equal
   the captured pair and authority;
3. the exact active bundle/manifest hash equals `activation_hash`; and
4. no query-, connection-, or authorization-event obligation capable of
   quarantining/deleting this query is pending.

The issuance reservation and those comparisons are one linearization point. A
data/auth/activation writer either commits first and makes the proof stale, or
the lease reservation wins first and the later writer raises its ordinary
obligation against an already-issued lease; no ordering can attach a fresh
expiry to pre-commit rows. A mismatch discards the captured rows and requires a
new full revalidation — issuance never retries against the old snapshot. A
snapshot that is itself resolving an obligation carries no renewed lease: the
client first applies and ACKs that exact obligation, then a later full
revalidation may issue a lease once the pending set is empty. This keeps
"no-pending-obligation" literal rather than letting the lease bypass the state it
is supposed to fence.

The lease binds the accepted snapshot's exact composite witness and activation
hash. The client, under its serialized coordinator, first durably reserves
`lease_request_id` with
`lease_request_started_client_ms` after advancing its clock high-water. The
server binds that request id into the MAC. On response the client derives, without
assuming its wall clock agrees with the server's:

```
lease_duration_ms = authorized_until_server_ms - issued_at_server_ms
client_deadline_ms = lease_request_started_client_ms + lease_duration_ms
```

Starting the client interval before server issuance makes network/server delay
shorten validity, never extend it. The client atomically commits the disposition,
snapshot, composite fence, full lease, lease hash, derived client deadline, and
client clock high-water **before render and before ACK**. A fault can leave the
old lease or the new atomic tuple, never new rows under an old lease. The ACK
token binds the lease hash whenever a lease-bearing snapshot is its resolution
proof.

**Renewal is never ambient.** Heartbeat, delta, reconnect, ACK, successful
mutation, session refresh, or presentation of the old lease does not extend it.
Renewal requires a fresh full authorization revalidation and full snapshot under
the then-current witness, followed by the same atomic server head/auth/
activation/empty-obligation proof and atomic client commit. The server cannot
mint a replacement while any invalidation or stronger disposition is unresolved.
This makes a renewal/data-write/invalidation race choose one linear order rather
than combining a fresh expiry with stale rows.

**Both clocks have durable rollback high-waters.** Item 6 establishes one durable
`auth_clock_high_water_ms` in server auth-control metadata for retry episodes;
item 8 reuses it for leases. Before issuing, renewing,
or accepting a lease for any revalidation-free service, it compares the current
wall clock with that high-water and advances the high-water transactionally. A
backward sample — including after restart — returns
`SNAPBACK_AUTH_CLOCK_ROLLBACK`, issues no lease, performs no automatic retry,
and treats presented leases as expired until time catches up or an explicit
audited clock-recovery operation establishes a later high-water.

Each client store likewise keeps a durable `lease_clock_high_water_ms`. Before
every retained read/render and while installing a lease, the serialized store
first selects the exact current query instance, then compares its wall clock and
advances the high-water in the same transaction. A record or lease naming
another `query_instance_id` is discarded in that old identity domain and cannot
mutate the current instance. Within the exact current instance, a backward
sample, missing/malformed lease or request reservation, timestamp
underflow/overflow, duration above the hard maximum, identity/query/witness
mismatch, or `client_now_ms >= client_deadline_ms` commits that instance's
`ClientQuery` delete tombstone before any read or render. Absolute client/server clock skew
does not affect the bound, and changing the client wall clock cannot extend
already observed validity. This is a guarantee for an honest client; a hostile
client can alter code or bytes, as below.

The bootstrap capability/runtime facts report:

```
authorizedLease: {
  protocolVersion: 1,
  defaultMs: 86400000,
  hardMaxMs: 86400000,
  configuredMs,
  clamps: ["session", "provider"],
  renewal: "full-revalidation",
  timeBasis: "server-absolute+client-request-elapsed",
  clockRollback: "delete-before-read",
}
```

The server-side half is independently enforced: an expired, rollback-tainted,
wrong-principal, wrong-query, wrong-witness, wrong-target, wrong-activation, or
invalid-MAC lease cannot obtain revalidation-free service and must take a fresh
full snapshot.

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

Stated plainly, because it is the price of local-first auth and every design that
pretends otherwise is lying: **an honest offline device may read data it is no
longer authorized to see, for up to the lease.** That window is the product
decision. The mechanisms above make it the *only* window for an honest client —
and they make no promise at all about a dishonest one.

The boolean `clear_retained` remains a versioned compatibility projection
(`>= quarantine`) only where the capability rule above permits compatibility.
Current overflow emits it as `true` unconditionally and the shipped kit ignores
it; implementing this RFC deliberately changes that wire behavior. Session mode
never relies on the boolean: all auth-scoped live and retained use requires
`authInvalidationProtocol: 1`.

### Client fences

A disposition is worthless if a callback in flight repopulates what it just
destroyed. The shipped client now serializes retained writes per surface/query
and `putRetainedQuery` rejects a lower version in the same stream under a Web
Lock. That is useful but insufficient: the CAS has no invalidation generation,
an equal-or-higher delayed write can still win, deletion removes the record it
would compare against, and `writeServerRows` schedules retention before its
disposed/boundary check.

Every auth-scoped live materialization has this state. Live-only queries keep it
in memory; retainable queries persist it independently of their payload so tabs
and workers sharing a store share the same fence:

```
QueryAuthorizationState {
  query_instance_id: OpaqueId, // allocated explicitly; never reused
  query_lifecycle: active | retiring,
  authority_generation: u64, // LLP 0039 AuthCoordinator generation
  query_generation: u64,     // monotone within query_instance_id
  authority_instance_id: Option<OpaqueId>, // item 7, optional extra axis
  expected_boot_issuer: AuthenticatedBootIssuer,
  expected_authorization: { incarnation, epoch, version_stream },
  effective_disposition: retain | quarantine | delete,
  accepted: Option<{
    witness: CompositeWitness,
    authorized_lease_hash: Option<Digest>,
  }>,
  retired_issuer_frontier: { incarnation, boot_sequence },
  retired_scope_frontier: Option<{ issuer_id, scope_sequence }>,
  pending_by_scope: Map<ScopeId, {
    witness: CompositeWitness,
    obligation_revision: u64,
    max_disposition: retain | quarantine | delete,
    owner_continuity: OpaqueId, // cleanup ownership; not scope/revision identity
    resolution: Option<{ proof, acknowledgement_token }>,
  }>,
  scope_state: Map<ScopeId, {
    revision_high_water: u64,
    lifecycle: active | retired,
  }>,
}
```

`query_instance_id` is the next value from one store-wide durable monotone
allocator whenever a retained key initializes, and from a never-reused process
allocator for live-only state. A
missing state is not permission for an ordinary write to create one: only an
explicit subscribe/retention initialization allocates an instance. Re-creating a
terminally retired query gets a new id, so an old tab cannot match generation
zero again.
While an instance remains initialized, its durable id plus issuer/scope frontiers
survive payload and tombstone-body compaction as §GC requires; exact retired
entries fold into those frontiers. Only the terminal `active → retiring →
removed` transition above may remove the minimal state. No old owner can turn a
retiring instance active again. `authority_instance_id` is compared when present
on both authenticated capability surfaces, but absence remains valid until item
7 and never weakens the mandatory generation/witness/issuer checks.

Receiving an obligation is one serialized transition. It first validates the
witness and boot issuer against the authenticated current expectation. Before
frontier or map lookup, every incoming `Subscription` namespace and
`ClientQuery` scope must name the exact current `query_instance_id`; missing,
absent, or mismatched state rejects the frame without allocation or any
disposition/generation change. `retiring` applies the narrower terminal-cleanup
rule above and rejects every other input. It then drops
any issuer/scope at or below a retired frontier before map lookup and looks up the
**full `scope_id`**, compares revision only with that scope's high-water, and
adds/replaces that entry in `pending_by_scope`; different scopes coexist even
when one says R5 and another says R1. Duplicate or stale entries do not increment
`query_generation`. A current new entry increments it, persists the fence, and
sets `effective_disposition` to the maximum across all pending scopes before any
resnapshot starts. Every snapshot application, live-only or retained
subscription callback, optimistic reconciliation, and durable query write
captures `(query_instance_id, authority_generation, query_generation)` and
compare-and-commits only if all remain exact. Queue work uses the separate queue
fence above. Under an equal authorization pair and version stream, accepted
commit versions are nondecreasing **against both payload records and the durable
fence**. Pair/stream mismatch is never made comparable by a numeric version.

A satisfying snapshot or terminal-delete proof transitions against the current
query instance and each exact pending scope it satisfies. One snapshot witness
may be eligible for several tickets, but resolution remains per scope and every
token is retained. A `Subscription` token is ACKed only after **that owning live
boundary** applies the transition; a shared durable-store commit in tab A cannot
ACK tab B's live scope. A `ClientQuery` token is ACKed only after the shared
durable transition. An unsatisfied, unapplied, or stronger scope remains pending,
so effective disposition cannot fall below it. Each transition increments the
generation again. A terminal proof follows the same rule after destruction
rather than snapshot install. Ordinary `delete` and body compaction remove
payload bytes but keep the minimal current-instance fence/high-water, so a
delayed callback cannot recreate the record. Only terminal query-instance
retirement may remove that fence after its destructive transition and pending
continuities complete.
`void resubscribe(...)` racing an unawaited transition is exactly the bug this
forbids.

### Retained and offline authorization

- The **query-scoped quarantine/delete primitive** is this document's client
  deliverable; LLP 0043's shipped M1/M2 specifies stored epochs and
  whole-context wiping, not a per-query primitive, so 0043 adopts this one.
- **Retained/offline reads stay disabled under session mode** until the
  primitive, composite witness, durable tombstone, and capability gate land.
- **Retainable ⇒ `userId`-only authority dependence.** Retained rows are scoped
  by `userId`, but `ctx.auth` also exposes `sessionId` and `provider`, so a
  result whose visibility depended on those could survive into a non-equivalent
  authority. Retainable functions must declare `userId`-only dependence.
- **Unobserved offline revocation is physics.** A revoked credential cannot erase
  an offline device's copy until it reconnects. Bounding that exposure needs an
  `AuthorizedLease`; retained reads do not re-enable until its exact binding,
  atomic commit, rollback high-waters, clamps, and 24-hour hard maximum ship.
- The offline/boot path has no `resync_required` message to carry a disposition,
  so it is pinned directly. An equal incarnation/stream with a newer epoch is
  **quarantine-before-read**, then satisfying resnapshot-and-release. A missing
  witness, pruned/unknown disposition history, incarnation mismatch, or version-
  stream mismatch is **delete-before-read**; a later snapshot installs fresh data
  but never releases bytes that the boundary required destroyed.
- An ordinary process restart preserves the incarnation and does not itself
  quarantine or delete retained data. A conforming client may render it offline
  only under an unexpired lease. Any later transition back to a live subscription
  is still a non-live resume and therefore fresh-snapshots before live render;
  incarnation persistence is not permission to resume live from the pair alone.

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

Shadow mode is also where the old/new-row derivation problem must be solved
before anything depends on it. The shipped `_snapback_changes` journal is **not**
a preimage source: inserts/updates record the postimage and deletes record no
`row_json`. Graduation therefore requires transactional preimage capture or a
journal extension, and pruning/unknown history must degrade to coarse. Nothing
regresses while derivation is imperfect because v1 suppression depends on none
of it.

### Worked classifications

Carried **as required implementation fixtures**, because attempt 2 and attempt 3
both died on shapes that prose said were fine. Of the named shapes below, only
todo and todo-v2 exist in the current demo corpus; the other rows are acceptance
work, not shipped evidence. Every row is the whole declaration for that query:

| App shape | Query reads | Result dependence | Authorization-event dependence | Behavior on an ordinary write | Behavior on an authorization event |
|---|---|---|---|---|---|
| **todo** (`listTodos`) | `todos` | captured `userId` predicate normally decides first; `authScopeField: userId` is the checked fallback | none | captured predicate may skip another user; own ordered Ibex result → obligation-backed `live_replace` | n/a — no ACL |
| **todo-v2** | `todos` | HostPlan `authUserId()` equality predicate | none | the predicate may prove another user disjoint without `authScopeField`; a remove is obligation-backed | n/a |
| **mine-OR-public** | `docs` | concrete Ibex fixture, no `authScopeField`; captured facts may skip only with convergence proof | none | re-query applies `owner = me OR public`; every auth-scoped replace is obligation-backed, including `public → private` | n/a — the flip is an ordinary write, not a coarse event |
| **card game** (`board` + presence room) | `moves`, `gameMembers`; room permission reads `gameMembers` | captured dependencies, conservative fallback | `gameMembers: permissionBacking` for the durable query and room authority | a move follows the proved matcher path; **no epoch or coarse quarantine**, but a potentially shrinking replace still has a delivery obligation | a kick advances the global epoch → durable quarantine/resnapshot **and** room-authority suspension/fresh membership snapshot; denial deletes/unregisters |
| **roster** (ACL *is* the result) | `gameMembers` | conservative | `gameMembers: permissionBacking` | — (every write here is an authorization event) | same table, both roles, no conflict |
| **hierarchy** (`docs`/`folders`/`orgMembers`) | all three (the query joins them) | fixture proves captured dependencies for visible→hidden and hidden→visible | `orgMembers: permissionBacking` | re-parenting re-evaluates the join and the shrinking delivery is obligated | an org membership change advances the epoch |
| **mixed table** (`users.role` beside `users.displayName`) | `users` | conservative | `permissionBacking` + `permissionFields: ['role']` | known avatar-only update fires no event; inserts, deletes, role updates, and unknown fields do | role change and conservative cases advance the epoch |

The hierarchy fixture is the proof of the reframe: the shape that had no
expressible class needs no coarse declaration beyond the permission-backing
table, because captured dependencies plus re-query handle row movement and the
delivery obligation makes the shrinking result reliable.

## Non-goals

- Universal incremental permission re-evaluation with precise live `remove`
  deltas — LLP 0011's ratified v1 answer is server-directed resubscribe.
- Subject-scoped *narrowing or suppression* in v1 (shadow mode only).
- A clock/deadline scheduler or mutable ambient-input wake system (the protected
  profile refuses those inputs instead; materialize change as a write or
  activation).
- Non-user subjects (groups, orgs, roles) as epoch scopes — such writes stay
  coarse, permanently, until the scope algebra exists. Named as a limitation, not
  solved.
- Declarative write-side row-level rules (LLP 0011's later surface).
- Encryption at rest for retained data (LLP 0043).
- Custom ephemeral-key authorization (LLP 0039 keeps that capability
  fail-closed; this RFC owns room membership invalidation only).
- The authority/session/transport core and the client coordinator itself
  (LLP 0039).

## Acceptance

**No coarse regression; delivery obligations remain required.** An ordinary
write advances no authorization version, creates no authorization-event/global
quarantine obligation, and clears no unrelated client's rows. A result-removing
ordinary write does create the affected subscription's delivery obligation; an
auth-scoped `live_replace` conservatively creates one whether or not shrinkage is
observable. Steady-state **authorization-event** resync amplification under
ordinary writes is zero. Delivery acknowledgements are measured separately and
never optimized away by calling them authorization events.

**Matcher proof paths.** Todo proves the captured dependency wins before the
`authScopeField` fallback; todo-v2 proves an analyzable HostPlan predicate can
skip without that field; the unordered HostPlan fixture proves add/update/remove
delta equivalence; and the Ibex fixture proves every auth-scoped `live_replace`
is obligated. Every authorization-sensitive skip and delta path passes the
matcher-versus-full-requery convergence oracle with point reads, missing rows,
unknown fields, and incomplete capture falling back conservatively.

**Fail-closed admission.** A function with no authorization declaration is
auth-scoped and its replace/removal is obligated. Only a function-level
`authorityIndependent: true` fixture opts out. A deliberately false or
contradictory fixture must produce oracle/doctor evidence, but those diagnostics
do not prove every trusted assertion true. Retainable functions with
undeclared/opaque authority dependence fail manifest load. Every protected
profile runs at initial execution and rerun on dev/test/demo/prod. The recursive
IR corpus hides `RuntimeNow` and `RuntimeId` under each expression/binding/
projection shape and proves rejection. Dynamic branches call both host ops on
first run and only on rerun and prove host-gate rejection. Unknown/future host-op
and expression sentinels default-deny. Alias/computed-access fixtures cover
`Date`, `Math.random`, random UUID/bytes, `performance.now`, timers, locale/time
zone, environment, config/provider state, and network. A warm-module counter and
imported singleton attempt to change visibility across invocations; protected
queries always observe fresh/reset-equivalent state while an unprotected DK-4
positive control proves the VM pool really was warm.

Mode fixtures assert the exact sealed `ctx.auth` own-key/descriptors and deep
immutability for anonymous sessions, authenticated sessions, dev impersonation,
admin bypass, and system execution; injected keys/getters/proxies and post-seal
mutation fail, and initial/rerun projections match. `permissionFields`
acceptance covers: insert always fires; delete always fires; known intersecting
update fires; known disjoint update does not; empty/unknown/journal-reconstructed
fields fire. The cases run through HostPlan, Ibex, seed, admin edit, import, and
rollback paths.

**The shapes that killed the earlier attempts.** The required (not
already-shipped) fixtures are exercised end to end:
re-parenting a document across folders removes it from the losing org's
subscribers and adds it to the winner's; a `public → private` flip removes the
row from other users' views; a roster table that is both ACL and result behaves
correctly in both roles; an avatar write to a mixed `users` table fires no
authorization event while role/insert/delete/unknown-field writes do.

**Writeless authorization events.** Hot-reloading a narrower auth filter fires an
authorization event and strands no previously published rows. Import, reset, and
declared restore each rotate the incarnation. Activation-pinned config changes
fire event 2; non-pinned config/provider inputs are rejected by the protected
profile. The expiry fixture materializes its deadline as a write and follows
event 1. An `authorityIndependent` live-only control may use capabilities outside
the protected profile only when it is also non-retainable; it cannot accidentally
weaken the protected fixtures above.

**Ephemeral-room kick trace.** Player A and B subscribe to the durable card-game
board and its protected presence room. A kick deletes A's `gameMembers` row. The
unique dependency ticket is installed atomically with affected-room enumeration,
each room ticket is installed, and every old-generation sink permit is quiescent
**before** the delete may commit; after commit, both the durable query obligation
and finalized `RoomAuthorityResync` name the causing version. A's
old-generation cursor/presence frames are refused at room mutation, enqueue,
drain, and send; its room subscription is suspended, and a fresh durable
membership snapshot denies it. The room unregisters A, removes A-owned entries,
commits the new generation, and only then emits the typed kick. B sees the
removal/fresh snapshot. Dropped resync/ACK re-fires; a server crash clears the
room and forces fresh subscribe/authorization. At no point after the kick commit
may A receive board rows or ephemeral opponent state. An unrelated membership
change may conservatively resync but never leak; custom-key access remains
refused.

Adversarial schedules pause A (a) after preliminary authority lookup but before
room mutation, (b) after frame construction but before enqueue, (c) after
enqueue but before destructive drain, and (d) after drain but before final send,
then race the kick's prepare/commit/finalize phases through each pause. A fifth
schedule races a new protected-room registration and initial snapshot against
dependency-ticket installation: admission either completes first, becomes
registry-visible, and is included/quiesced, or observes pending, publishes no
authority/snapshot, and fresh-authorizes only at or after the committed boundary.
Every act either completes under a permit before the durable commit or observes
pending/new generation and refuses; no validate-then-act schedule crosses the
commit.
Old queued generations are discarded. A rollback compare-clears only its exact
ticket and safely reopens the old generation; two overlapping room-changing
writes prove that one rollback cannot clear the other's barrier. An ambiguous
commit result leaves its ticket pending and every sink closed until durable
reconciliation proves commit or definite rollback; timeout never reopens the old
generation. Dependency-ticket, barrier-install, or quiescence failure aborts the
write. L9 tests simultaneously prove unrelated rooms still register,
publish/drain while the affected room is pending, and no registry or room mutex
is held across the commit.

**Obligation durability — the tests the shipped queue would fail.** A lost HTTP
drain response carrying the sole `delete` still results in the rows being
destroyed (the obligation survives and re-fires). A mid-batch WebSocket send
failure does the same. A `delete` arriving **while the connection is already
overflowed** raises the parked obligation rather than being dropped. A resync
emitted as a substitute for a failed authorization resync inherits its
full composite witness and disposition. Every open, subscribe/resume, drain, and
heartbeat reprojects the current obligation; dropping the first hint or ACK
response still produces another within the five-second connected bound. An
unknown/reaped subscription produces typed resnapshot-required, not `[]`.

Composite interleavings are explicit: a version-99 snapshot cannot discharge a
removal at 100; removals at 100 (R) and 105 (R+1) are not discharged by R's
version-102 ACK; quarantine R followed by delete R+1 cannot be downgraded by R;
an authorization-pair or version-stream change invalidates the old ACK; duplicate
ACK after discharge is idempotent. A fault after client apply but before ACK
leaves the obligation live and the client can idempotently apply/ACK its retry.

Revision domains are tested independently: old connection scope A at R5 and a
new connection scope B at R1 coexist without numeric comparison; two tabs may
each hold an independent R1 and each tab must apply its own live boundary before
ACK (a shared-store write cannot ACK its peer); and an N-query connection-overflow
root survives until all N derived subscription children discharge (or their
continuity ends), never until the first query ACK. A late lower epoch is ignored;
an incarnation/stream change is accepted only from authenticated bootstrap
expectation; a late old-stream obligation cannot replace it; `data: None` cannot
erase a same-stream version floor; and an auth-only change preserves that floor.

Client-query lifecycle identity is tested independently. Query key Q initializes
as instance I1, receives an obligation, and then terminally retires: the
transaction enters `retiring`, advances query and queue generations, destroys
payload/lease/overlays/live boundaries, and makes dependent custody discard-only.
A crash before, during, or after each step resumes either active I1 or
non-renderable `retiring` I1 and never reuses its id. After pending tokens
discharge or their continuities end, finalization removes I1's maps while keeping
the allocator high-water; explicit recreation allocates I2 and fresh-snapshots.
Both cleanup branches are pinned: an already-issued terminal-delete token is
ACKed idempotently only after the destructive retirement commit, while a pending
snapshot/quarantine token is never ACKed by retirement and finalization waits
for its recorded owner continuity to end. A crash before or after delete/ACK and
before or after continuity retirement resumes the same branch without exposing
bytes or inventing proof. Every other delayed I1 obligation, resolution, ACK,
callback, render, and queue operation is rejected before map lookup and cannot
allocate state or mutate I2. Two
tabs sharing I1 both fail their old captures after the generation transition.
One million unique-key and same-key compact/retire/recreate cycles retain only
the allocator scalar plus extant/bounded state, never one row per historical key
or instance.

Extinct-scope retirement is adversarially covered: tabs A and B persist
independent R1 scopes; B dies before applying its live boundary; A applies and
ACKs its R1 snapshot; and an authenticated retirement proof for B first advances
the shared query/queue generations. B's suspended callback, render, resume, and
queue work then fail their old captures. Because A's accepted snapshot is fresh
and satisfies B's witness, the exact retired B entry and suspension root can be
removed without ACK, aggregate quarantine can release, and the queue does not
wedge forever. If that snapshot is absent or stale, neither releases. Returning B
gets new continuity and must fresh-snapshot before rendering.

Boot continuity is tested separately. The server crashes after projecting an
obligation but before exact retirement; the next process reserves a strictly
new authenticated boot issuer even when its boot-local connection/subscription
counters restart at the same numeric values. A forged/replayed issuer or
retirement MAC is rejected. The new issuer cannot release old pending state
until a fresh snapshot satisfies it; after the atomic transition, issuer
retirement advances the old-boot frontier and delayed frames/ACKs from every old
scope are ignored. A second crash before that transition advances no frontier
and the third boot repeats fail-closed. One million scope churn operations mixed
with crashes, delayed frames, query compact/retire/recreate cycles, and numeric counter
reuse leave storage bounded by the scalar issuer/query/scope frontiers plus the
configured maximum active/unresolved scopes — not by historical churn.

**Denial and error.** Typed `SNAPBACK_AUTH_PERMISSION_DENIED` produces a
token-bound terminal-delete proof at a coherent composite witness and immediately
deletes the affected query state. Its ACK is sent only after render and durable
deletion; a fault after apply but before ACK re-delivers the proof and the client
idempotently deletes/ACKs it. The declarative evaluator,
`ctx.permissions.deny()`, and room authority are positive trusted producers; a
forged code/plain throw is a negative producer fixture and quarantines. An
untyped throw immediately quarantines. Server state reserves attempts 1, 2, and
3 before invoke; attempt 4 never runs, and every automatic attempt lies within
15 seconds of the first failure. Duplicate re-fire, a newer revision, reconnect,
restart, query-instance retirement, and same-key recreation retain the same
canonical-key/witness attempt count/deadline. An old-instance resolution or ACK
cannot transfer; resolution must be reprojected through the current full scope.
Crash after reservation
consumes the attempt; server-clock rollback exhausts automatic retry
fail-closed. An explicit authority-checked/idempotent manual retry is the only
way to open another episode. A repeated failing resnapshot never maps to
`retain`. Lost/overflowed denial delivery re-fires, and any substitute resync
inherits `quarantine`/`delete`.

Unique-failing-query churn is a separate bound test. With test-overridden small
limits, distinct canonical argument sets fill the per-authority-store cap and
distinct stores fill the global cap. Each admitted key invokes at most three
times and retains one current/exhausted record; N+1 returns
`SNAPBACK_AUTH_RETRY_EPISODE_CAPACITY` before handler invocation and remains
quarantined across re-fire, reconnect, revision changes, and restart. Crashes on
both sides of episode/counter insertion observe both changes or neither. No
exhausted key is evicted to admit a new one. Transferring a satisfying resolution
proof and removing its episode in one transaction frees exactly one slot; an
already-over-cap store admits only resolution/deletion until it is back within
bounds. Record count never exceeds the two configured hard caps.

**Fences and tombstones.** A callback or retained write begun before invalidation
cannot repopulate after quarantine/delete even at an equal or higher data
version, because its authority/query generation is stale. This is proven across
live-only state, two tabs sharing the Web-Locked store, and payload/tombstone-body
compaction, which retains the current instance's minimal high-water. Terminal
retirement/recreation instead gets a never-reused id and rejects every old frame
before lookup. A newer obligation racing an
older snapshot prevents release; resubscription starts only after the disposition
transition commits, and ACK is observed only after both durable store and render
boundary commit.

The retained boot matrix explicitly covers missing witness, pruned disposition
history, unknown disposition value, unknown version stream, and malformed
frontier. Each commits `delete` and its minimal tombstone **before the first
read/render**, then permits only a fresh snapshot to install new bytes. No case
falls through to `retain` or treats absent history as permission.

**Queue fence.** Two independent query quarantines create two AuthCoordinator-
custody queue suspension roots. Releasing one does not execute or replay work
while the other remains. Every enqueue/settle/replay/discard operation fails its
CAS after the separate `queue_generation` advances, and a delete root strands the
queue as explicit discard-only state unless independence is proved. The item-7
authority descriptor, when available, adds another equality check; this test and
item 6 remain valid without it.

**Protocol rollout.** With only items 1–5, the session mode itself may activate,
but the server refuses every auth-scoped live subscribe/resume and protected
room registration with `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE`; ordinary online
request/response and explicitly `authorityIndependent` live remain available.
Once item 6 is installed, a client with no `authInvalidationProtocol: 1` still
cannot open any session-mode auth-scoped live surface and a legacy connected
client is closed. A capable client proves all three dispositions and
revision-bound ACK, authenticated issuer/frontier validation, durable retry
episodes, and room-authority reauthorization. A client without
`authorizedLeaseProtocol: 1` sees retained reads disabled; a capable item-8
client proves the full AuthorizedLease facts. Item 7 can land before item 6 and
its authority descriptor is negotiated only as an optional additional axis; its
presence unlocks neither live nor retained admission. The compatibility boolean
is never the session-mode proof.

**AuthorizedLease.** Exact-field/MAC binding is tested against changes to app,
principal, store, query key/instance, authorization pair, version stream,
snapshot version, activation hash, issuer, times, and optional authority
descriptor. A valid or malformed lease belonging to
retired instance I1 cannot install into, renew, quarantine, or delete recreated
I2; it is removed only in I1's identity domain. A missing/corrupt/mismatched
lease on the record that claims to be current I2 still deletes I2 before read.
Retirement destroys I1's lease and request reservation at the same terminal
transition. Default and hard maximum both report `86_400_000`; larger
configuration is rejected, and
session/provider earlier expiries clamp the result. A closed client renders only
while its lease/request reservation, derived local deadline, and durable clock
high-water are valid, deletes-before-render at expiry/equality, and cannot revive
bytes by rolling its wall clock backward. Deliberate client/server wall-clock
skew and delayed responses only shorten the request-started client interval.
Server rollback across restart returns `SNAPBACK_AUTH_CLOCK_ROLLBACK` and neither
issues nor honors a lease. Missing/malformed lease deletes before read. Heartbeat,
delta, session refresh, reconnect, and ACK do not renew. Only a fresh full
revalidation/snapshot renews. The ordinary-write race is pinned explicitly:
renewal captures a public row at data head 99, pauses, and a `public → private`
write commits head 100 without advancing the authorization epoch. Renewal must
then fail its atomic head comparison, mint no lease, discard the v99 rows, and
full-revalidate at or after 100. The converse schedule reserves the v99 lease
first; the v100 commit then raises the normal obligation, whose query fence
quarantines the connected result. Auth-pair equality alone never accepts the
v99 proof. Membership removal and a provably unrelated app-data write exercise
the same conservative head mismatch; v1 retries both. Manifest activation and a pending obligation are equivalent losing
comparisons. A snapshot resolving an obligation carries no lease; only a later
full revalidation after discharge can renew. A crash at each boundary observes
either the old tuple or the complete new tuple, never a new expiry on stale
rows. The server refuses expired/wrong-bound/wrong-activation/invalid-MAC
revalidation-free service.

**Version durability.** A crash between the causing write and any post-commit
work cannot lose an enumerated authorization event because the version advances
in the same transaction. A matcher-path crash kills the live scope; the next
subscribe resnapshots rather than trusting an absent obligation. Both are proven
across HostPlan, Ibex, seed, admin edit, activation, import, reset, and rollback.
An **ordinary restart preserves the incarnation** and does not itself quarantine
or delete lease-valid retained bytes; offline read may continue under the lease,
but every later auth-scoped live resumption fresh-snapshots. Reset/import/declared
restore rotate the incarnation and delete before read. The full ABA cycle
(`0 → 1 → reset → 0 → 1`) is caught.

**Blast radius, measured not asserted.** Under the card game's membership-churn
workload (joins/leaves/kicks as routine lobby traffic), the disruption to
*unrelated* subscriptions is bounded to one merged quarantine/resnapshot/ACK per
auth-scoped query per outstanding event revision. The report records hidden-view
time, resnapshot traffic, durable tombstone writes, retained-byte deletion,
suspended pending mutations, and recovery time under adversarial churn. A coarse
event destroys **zero** unrelated retained bytes, overlays, or pending mutations;
quarantine suspends them. If the measured availability cost is unacceptable,
that is a finding about shadow-mode graduation priority, not something to
discover in production.

**Oracle.** A reference "full re-query plus full authorization re-evaluation"
oracle is property-tested against randomized writes, deployments, expiry,
overflow, disconnect, response/ACK loss, restart, stale callbacks, cross-tab
writes, and disposition escalation. Its receipt reports the proof path, composite
witness, scope/revision, and why the disposition was selected.

## Open Questions

1. **What proof lets a subject declaration narrow — and later suppress — the
   coarse event?** The central question, and the one the shadow mode exists to
   answer. N clean oracle observations are diagnostic evidence, not proof;
   suppression needs a structural derivation over transactional old/new rows or
   an equivalently closed source.
2. **Non-user subjects.** Group/org/role grants have no expressible subject, so
   those writes are coarse forever. Is that an accepted permanent cost, or does
   the scope algebra need to exist before graduation?
3. **Does the Cloudflare coordinator support the same atomic authorization-version
   and persistent-obligation contracts?** It rebuilds subscriptions on deploy and
   has no auth machinery today.

## Status

**Accepted — author transition completed 2026-07-13 under ENG-24592.** The issue
explicitly authorized Draft → Review → Accepted if the focused multi-family gate
converged. It did. This status is the author's decision following the recorded
reviews; no reviewer accepted on the author's behalf.

**What the loop established.** Six designs; five rejected. Every material defect
was found by an independent reviewer rather than the authoring session. The
architecture that survived is now settled: matcher-carried live correctness, two
orthogonal declarations, the enumerated event universe, obligations for negative
deltas, mandatory non-live resnapshot, quarantine-then-prove, and the bounded
offline lease. The later failures were enforcement contracts inside that frame,
not evidence for a seventh design.

**What closed the gate.** Codex round 6 and Fable round 7 reviewed the prior exact
six-file corpus and isolated one final bounded inconsistency: `ClientQuery`
lacked the never-reused `query_instance_id` required to reject delayed
old-instance frames without retaining unbounded per-key history. The corrected
corpus carried that identity through scope, revision, tombstone, resolution, ACK,
lease, callback, and store state; separated compaction from crash-recoverable
destructive terminal retirement; preserved canonical retry budgets across
recreation; and added I1→retire→I2, crash, two-tab, old-lease, owner-continuity,
and million-key-churn acceptance.

Codex round 7 and Fable round 8 then independently reviewed the exact operative
corpus ending in LLP 0013 SHA-256
`7447ed8b282e3ddda17663230903a2420c0394842cfcc2c3cb5039ff521630bb`,
LLP 0039 SHA-256
`869c32c1d99c29bad14df40c7a6014e509b4b86c630cdf0f2881e3dfc4ad7824`,
and this document SHA-256
`eb1c624c5a06facaaa32d51e0e5e6793d1ae68e532a36b64a8fb51f3391e1568`.
Both returned **READY** with no blocking correctness, security, coherence, or
implementability finding. Their verbatim reports and provenance are archived in
`reviews/0053-authorization-invalidation.{codex,fable}.md`.

**Effect of acceptance.** This RFC now controls the narrow invalidation mechanism
under the dated LLP 0000/0008/0011/0013 amendments. ENG-24592 no longer blocks
landing items 6 and 8. Their dependency order remains unchanged: item 6 starts
only after item 5; item 8 starts only after items 5, 6, and 7 and unlocks only
with the lease/store capability negotiated. Acceptance settles the contract; it
does not claim the implementation already exists.

**Non-blocking review notes.** Fable recorded two LOW editorial observations:
LLP 0013's conservative “no declaration may suppress” wording can be misread
outside its room-targeting context, and its mirrored conceptual record uses
camelCase while this RFC uses snake_case before LLP 0051 D4 fixes the wire
encoding. Neither changes behavior or blocks implementation; the implementing
spec must use the owning 0053 semantics and the registered wire spelling.

### Acceptance evidence and target coverage (LLP 0086 CC-3) — 2026-07-23

This dated note answers LLP 0086 §CC-3 item 1: where this contract is
implemented and acceptance-tested, per target, with the concrete artifacts
named. It records evidence; it amends no contract text.

**Local (Ibex-hosted) target — implemented and acceptance-tested.** The
"Acceptance settles the contract; it does not claim the implementation already
exists" caveat above is now discharged for the local target at the negotiated
item-6/item-8 scope, as LLP 0008's Revised header (2026-07-14
auth-program implementation reconciliation) records. The evidence:

- **Implementation.** Server side: `crates/snapback/src/auth/invalidation.rs` (obligations,
  issuers, retry episodes; `@ref`s to §Invalidation is an obligation, not a
  message and §Negative deltas), `crates/snapback/src/auth/lease.rs` (AuthorizedLease MAC,
  keyring, verification locus per ENG-24992),
  `crates/snapback/src/storage/auth_invalidation.rs` (durable boot issuers/counters),
  `crates/snapback/src/storage/authorized_lease.rs`, `crates/snapback/src/storage/authorization.rs`
  (authorization version, `permissionFields` classification), and the room
  machinery in `crates/snapback/src/ephemeral.rs`. Client arm: `packages/snapback-contract/`
  (`client-store.mjs`, `authorized-lease.mjs`, `query-authorization.mjs`,
  `auth-coordinator*.mjs`).
- **Committed acceptance receipts.** The canonical map is
  `tests/acceptance/auth-invalidation-v1-evidence.md`, which pairs each
  §Acceptance surface (mine-OR-public `public → private` without an epoch,
  ACL-and-result roster, hierarchy reparent, mixed `permissionFields`,
  matcher/full-requery convergence, lost-ACK escalation, restart, membership
  blast radius, client quarantine/queue behavior, protected-query admission,
  room kick, lease expiry) with a named executable test or receipt. The
  machine-readable receipts are `auth-invalidation-v1-receipt.json`,
  `auth-invalidation-v1-composed-receipt.json`, and
  `auth-invalidation-v1-property-corpus.json`, composed and drift-checked by
  `tests/acceptance/auth-invalidation-v1-report.mjs`, which runs in
  `scripts/verify-local-proof` under an `@ref LLP 0053#acceptance` marker.
- **Focused Rust suites.** `crates/snapback/src/local/authorization_acceptance.rs` (the shapes
  that killed attempts 1–5, plus the randomized convergence oracle),
  `crates/snapback/src/local/auth_room_kick_acceptance.rs` (the §Ephemeral room kick trace;
  clause map in `tests/eng-24604-protected-room-kick.acceptance.md`),
  `crates/snapback/tests/protected_query_profile_v1.rs` and `crates/snapback/tests/retainability_profile_v1.rs`
  (the default-deny profile and retainability matrix), and the unit corpora in
  `auth::lease::tests`, `storage::authorized_lease::tests`,
  `storage::auth_invalidation::tests`, and `storage::authorization::tests`.
- **Card-game proof.** `demos/card-game/tests/acceptance/authority-scope.mjs`
  (also in `verify-local-proof`) exercises end to end the four proofs LLP
  0008's header names: disjoint live delivery of hidden hands, logout blanking
  of the predecessor surface, cold-process retained boot under a live
  AuthorizedLease, and equality-expiry deletion of the exact retained payload
  (plus user-switch physical deletion and stale-callback fencing).
- **What was executed for this note.** On 2026-07-23 the standalone
  server-free contract tests `packages/snapback-contract/authorized-lease.test.mjs`,
  `authorized-retained-store.test.mjs`, and `auth-invalidation.test.mjs` were
  run and passed. The Rust suites, the composed report, and the card-game
  acceptance run were **located and cited from the committed receipts**, not
  re-executed here (they run inside `scripts/verify-local-proof`, which starts
  demo servers on shared fixed ports).
- **Scope honesty.** The proven scope is the negotiated item-6/item-8 surface.
  Per LLP 0008's same header entry, this does not extend to arbitrary
  opaque-query retention or hosted auth.

**Cloudflare target — not covered; recorded capability gap, expected.** Open
question 3 stands: the Cloudflare coordinator
(`cloudflare/src/coordinator.js`) has no authorization-version, obligation,
lease, or `permissionBacking` machinery at all (its only "lease" strings are
cron-claim leases, unrelated to §The lease), and it rebuilds subscriptions on
deploy. The revocation-eviction differentiator claim therefore covers the
**local target only** today. This is a known, deliberately recorded gap — not
an acceptance failure.

**Competitive half (LLP 0086 CC-3.3; updated 2026-07-23 same day).** The
InstantDB eviction probe ran after credentials arrived: Instant was observed
to evict already-synced rows live (~32 ms) on *data-dependent* revocation but
not to re-evaluate live subscriptions on *rule* revocation
(reconnect-only) — see LLP 0082 §Permissions and
`tests/probes/instant-eviction-20260723/`. The differentiator claim was
therefore narrowed, not unblocked as originally stated: what survives is
that this contract is specified, ACK-backed, lease-bounded, and covers
rule-activation invalidation — the shape Instant was observed not to deliver
live. Narrowed claim text lives in LLP 0074; publication remains gated per
LLP 0086 governing constraint 2.

## Changelog

- **2026-08-15 (explicit handler-read authority; still Accepted).** Classified
  LLP 0231 D7's elevated point, batch, and bounded query host operations as
  `DatabaseCaptured`. They bypass only Class-R row visibility and retain the
  same snapshot/capture/input-closure obligations as ordinary reads.
- **2026-08-03 ("cold process" terminology pin; still Accepted).** The
  corpus used "cold process" for two proof classes
  (`issues/closed/20260801-cold-process-claim-vocabulary-collision.md`). The
  "cold-process retained boot" this document's §Acceptance evidence
  cites is the **fresh-wrappers-over-retained-state-in-one-process**
  class — `demos/card-game/tests/acceptance/authority-scope.mjs`
  constructs new wrappers in the same OS process over explicitly shared
  memory-store state — not a genuinely process-isolated restart witness.
  No suite currently proves the process-isolated class; that witness is
  owned by
  `issues/20260801-js-arm-integrated-authenticated-restart-witness.md`.
  Terminology only; no contract or evidence change.
- **2026-07-31 (LLP 0044 companion classification; still Accepted).** Added
  §Asset read-authorization inputs: one admitted expression kind (the
  asset-readable predicate node, snapshot-bound with pinned empty-result
  capture), no new authorization events (intent activation = event 2,
  operator revocation = event 4), the 0007-witness boundary note, and the
  no-`permissionBacking` confirmation for asset system tables. No contract
  change.
- **2026-07-23, later same day (LLP 0086 CC-3.3 probe results; still
  Accepted).** Updated the §Competitive half note: the InstantDB probe ran —
  data-dependent revocation evicts live, rule revocation is reconnect-only —
  and the LLP 0074 claim was narrowed accordingly. No contract change.
- **2026-07-23 (LLP 0086 CC-3.1 acceptance evidence; still Accepted).** Added
  the dated §Acceptance evidence and target coverage note under §Status: named
  the local-target implementation files, committed receipts
  (`tests/acceptance/auth-invalidation-v1-*`), focused Rust suites, and the
  card-game `authority-scope.mjs` proof; recorded the per-target coverage
  statement (local yes at item-6/item-8 scope, Cloudflare no — open question 3
  is a recorded capability gap) and that the InstantDB probe (CC-3.3) is
  blocked on credentials, keeping the LLP 0074 claim publication-gated. No
  contract change; no status transition.
- **2026-07-14 (ENG-24906 agent-auth input admission; still Accepted).** Added
  §Agent-auth protected-query inputs, a dated amendment classifying the new
  protected-query inputs LLP 0055 and LLP 0056 introduce so the default-deny
  profile admits them instead of refusing every helper-gated live query (0056)
  and every delegated/service-principal invocation (0055). From **LLP 0056**: the
  declaration-bound **membership predicate node** as an admitted snapshot-bound
  declarative IR expression kind (participating in the complete read/capture
  summary, including the pinned empty-result capture), and the **`ctx.permissions`
  membership read** as one host op classified `DatabaseCaptured` on both outcomes
  (present and absent) — denial delivered by the already-classified
  `TerminalAuthorization` deny op, so each primitive carries exactly one class and
  the one-class-per-operation rule is unchanged. From **LLP 0055**: the sealed
  `ctx.auth` enumeration extended with the two `servicePrincipal` projections, the
  direct (authorization) projection the non-widening dual run evaluates against,
  `kind` on the session and dev-impersonation projections, and the anonymous
  no-`kind` answer; the three auth-variable IR expression kinds (`auth.kind`,
  `auth.actorKind`, `auth.isDelegated`) admitted alongside the existing
  `auth.userId` (`ValueExpr::AuthUserId`); and the **grant-scoped `delete`
  disposition** recorded so the client-wide sentence — scoped to LLP 0039 session
  transitions — is not misapplied to multi-grant agent clients. The
  **authorization-event universe, the trusted-denial producer enumeration, and the
  `permissionBacking` machinery are explicitly left unchanged.** No architectural
  or wire change; no status transition.
- **2026-07-14 (ENG-24992 verification-locus clarification; still Accepted).**
  Resolved the AuthorizedLease MAC client-verification mismatch by revising the
  contract text rather than shipping client verifier keys (option 2 of the
  ticket): §The lease now states the verification locus explicitly — server
  keyring authenticates `key_id`/`mac` and fails closed on unknown keys;
  client custody validation promises structural/binding/clamp/expiry/rollback
  checks plus unkeyed-hash substitution detection only, and a canonically
  shaped forged MAC passes client custody by design. LLP 0043's fail-closed
  list was amended in the same change. New executable vectors pin both sides:
  a single flipped MAC bit passes `validateAuthorizedLease` but changes the
  custody hash (client delete-before-read on substitution,
  `authorized-retained-store.test.mjs`), is refused by
  `verify_for_service`, and an unknown `key_id` fails closed at the keyring
  (`crates/snapback/src/auth/lease.rs`). No architectural or wire change; no status
  transition.
- **2026-07-13 (focused exact confirmation complete; Accepted).** Codex round 6
  returned NOT READY and Fable round 7 returned READY on the prior exact corpus;
  both preserved the architecture. Closed Codex's one HIGH by carrying the
  store-wide never-reused `query_instance_id` in every `ClientQuery` scope and
  therefore every revision/tombstone/resolution/ACK identity. Separated bulky
  compaction from crash-recoverable destructive terminal retirement, rejected
  missing/retiring/mismatched frames before allocation, preserved canonical retry
  budgets across recreation, isolated old-instance leases, and added
  ABA/crash/two-tab/million-churn acceptance. The final rebase also corrected the
  0039 item-6/item-8 quarantine seam and mirrored 0053's precommit room barrier
  into 0013. Codex round 7 and Fable round 8 then independently returned READY on
  the exact operative corpus, with no blocker. Under ENG-24592's explicit author
  authorization, the Draft → Review → Accepted transition completed.
- **2026-07-13 (independent local-audit correction; still FROZEN).** Closed four
  enforcement gaps without changing the settled architecture: protected-room
  authority now installs a dependency-indexed registry ticket atomically with
  enumeration, interlocks registration/snapshot installation, and quiesces
  exact-ticket room barriers before the causing commit; mutation, enqueue,
  destructive drain, and final send generation-check atomically with each act;
  lease issue/renewal proves the exact
  app-data head, authorization pair, activation identity, and empty pending set
  at one commit-ordered linearization point; retry episodes have transactional
  per-authority-store/global hard caps and fail closed under unique-query churn;
  and the activation matrix now permits sessions after item 5 while refusing
  auth-scoped live until item 6 and retained/offline reads until item 8, with
  item 7 admission-independent. Added adversarial acceptance for every boundary.
  These corrections require focused confirmation; no status transition.
- **2026-07-13 (paired confirmation revision; still FROZEN).** Codex round 5
  and Fable round 6 returned NOT READY on
  `fd0499240ede7a67d71edd86a13bd930de5620e8c1467da7c7160cbccd6a6592`
  while preserving the architecture. Applied their bounded union: explicit
  acceptance-time precedence over the narrow conflicting LLP 0008/0011
  invalidation clauses, with root/companion amendments; a machine-enforced
  protected-query allowlist that recursively denies `RuntimeNow`/`RuntimeId`,
  seals mode-specific `ctx.auth`, classifies host ops default-deny, and requires
  fresh/reset-equivalent module state; exact AuthorizedLease fields, atomic
  witness binding, server/client clock high-waters, session/provider clamps, and
  a 24-hour default/hard max; authenticated durable boot issuers, never-reused
  ScopeIds, crash-safe issuer retirement, and bounded monotone frontiers;
  durable server-owned three-attempt/15-second retry episodes; enumerated event
  projection into ephemeral room reauthorization; trusted typed-denial
  producers; pinned constants; optional-only item-7 descriptor; and the full
  lease/churn/crash/kick/pruned-history acceptance. Pending focused confirmation;
  no status transition.
- **2026-07-13 (ENG-24592 enforcement-gate revision; still FROZEN).** GPT round
  4 and Claude round 5 independently returned NOT READY on the frozen text while
  preserving its architecture. Applied their shared protocol corrections across
  the operative record, tables, client state, acceptance, and 0039 seam: a
  composite `(authorization pair, version stream, minimum commit version)`
  witness; monotone non-reused obligation revision and conditional ACK;
  explicit live-vs-retained scope/durability projection; prompt level-triggered
  re-fire and must-understand client capability; durable client tombstones and
  two-generation CAS; exact denial/error producers and bounded retry; delivery
  obligations distinguished from coarse authorization-event obligations;
  conservative obligation-backing of every auth-scoped `live_replace`;
  disposition-specific live/retained/overlay/queue transitions; conservative
  `permissionFields`; restart semantics; and corrected retained-store, journal,
  fixture, matcher, and clock source facts. Chose the gate's safe branches:
  typed permission denial deletes, untyped errors quarantine immediately with
  two retries, and `ctx.runtime.now()` is runtime-denied for auth-scoped
  subscription/retention. A local adversarial preflight then found and this text
  corrected: independent `pending_by_scope` revision/token domains and
  connection-root children; live-only fences plus non-reused durable high-water;
  terminal-denial proof/ACK; a separate item-5 AuthCoordinator-custody queue
  fence (with item 7 only an optional later equality axis); authenticated
  extinct-scope retirement; and authenticated witness-currentness rules. Pending
  focused confirmation; no status transition.
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

## LLP 0157 acceptance boundary — 2026-08-03

For an admitted LLP 0157 materialization, its 48-byte `qmk1` spelling is the
canonical producer of this RFC's otherwise opaque `query_key`. The enclosing
`client_store_id` and never-reused `query_instance_id` remain distinct scope
and instance axes owned here. LLP 0157's completeness proof binds the exact
current `CompositeWitness`; this RFC continues to own witness production,
minimum commit floors, pending-scope dispositions, terminal retirement, and
the LLP 0059 participant barrier. `sessionGeneration` remains observability,
not materialization equality. This boundary promotes no implementation or
capability fact.

**Dated boundary note (2026-08-03, LLP 0166 acceptance):** Accepted
LLP 0166 owns the store-policy layer (registration demand, release
grace, budget compaction, the multi-context demand broker) over this
RFC's authorization state. Its payload compaction is custody reclamation
only: it preserves the `query_instance_id`, fences, tombstones, and
frontiers exactly as §GC requires, never lowers or releases a
disposition, and is never a substitute for a barrier or disposition.
Its `wipe` scoping maps client-wide transitions to this RFC's
client-wide `delete` with the lease artifact as an LLP 0059 coordinator
participant, and its unparseable-store destructive reset rotates the
store identity (a fresh `client_store_id`), so this RFC's never-reuse
holds by namespace rotation. Registration demand never resurrects,
delays, or downgrades any transition owned here. This boundary promotes
no implementation or capability fact.

**Dated boundary note (2026-08-03, `single_table_v1@1` owner
acceptance):** `rqs-authority-independent-snapshot-v1` is the exact
`rqsEligible` exception registered for `single_table_v1@1`; it is not an
`AuthorizedLease` consumer, mints no lease, and sets no precedent for a
general anonymous lease or retention class. Its custody instead requires the
current LLP 0157 completeness proof, exact authorization witness, current
instance fence, trusted activation/proof-key artifact, and every applicable
barrier and destructive owner transition. The authenticated
`opaque-authorized-snapshot-v1` and `result-transform-snapshot-v1` classes
continue to require their authenticated lease unchanged. This semantic
boundary note promotes no implementation or capability fact.
