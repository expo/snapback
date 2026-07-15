# LLP 0056: Scoped roles and memberships

**Type:** RFC
**Status:** Review
**Systems:** Auth, Sync, Storage, API, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-13
**Revised:** 2026-07-13 (refined through ten dual-family review rounds; see
§Status. The write surface is the part the loop reshaped most, and it is now
settled: a **declaration-level transition matrix** (`op` × caller class ×
self/other × `from`→`to`), closed by default, replaced the caller-supplied
`require` lists that could not express leave / accept-invite / decline without a
hand-written target-principal check; the caller classes are disjoint and
totally ordered, an authority with **no effective principal** (`system`,
`adminBypass`, anonymous) matches none of them, and `insert` and `patch` are
**field-bound** so neither can seat or extend an expiry the app meant to control.
`lastHolder` is pinned to **capture its holder-set read**, so two concurrent
removals of the final two holders cannot both commit; the same linearization now
covers **referential integrity**, so an insert cannot race a teardown onto a
deleted resource. A **deletion witness** (symmetric to the creation witness that
gates bootstrap) resolves the `lastHolder`-vs-resource-deletion deadlock. The
expiry sweep is host-bound and **remove-only** — a downgrade effect cannot prove
non-escalation without a declared role order. Invalidation is mapped onto
Accepted LLP 0053 exactly: a membership declaration **is** `permissionBacking`,
every committed write is **event 1**, the coarse v1 blast radius is owned rather
than hidden, `incidental` has a **floor** that no authorization column may enter,
and role denials ride the **existing** trusted code rather than minting a second
one. `provenance: "full"` (an append-only transition log) is what LLP 0055's
`authorityCreating` marker requires.)
**Related:** LLP 0000, LLP 0004, LLP 0008, LLP 0011, LLP 0013, LLP 0024, LLP 0037, LLP 0039, LLP 0053, LLP 0055

## Summary

Every application that grows past a prototype grows an authorization model,
and almost none of them need what "RBAC" classically means. What they need is
**role-per-resource**: host *of this event*, admin *of this channel*, editor
*of this document*. This RFC proposes a blessed primitive for exactly that — a
**membership**: a row asserting `(principal, resource, role)` — plus the rule
helpers, typed denials, and invalidation wiring that make it correct by
default.

It answers [LLP 0011](./0011-auth-and-permissions.rfc.md)'s open question
"are roles a core primitive or app-level data by default?" with a deliberate
middle: **roles are app data, in a system-recognized shape.** Membership
tables are ordinary app tables — queryable, joinable, syncable, exportable —
but declaring one tells the system enough to compile role checks into
analyzable expressions, to explain denials, and to wire the table into
[LLP 0053](./0053-authorization-invalidation.rfc.md)'s invalidation machinery
without the app author knowing that machinery exists.

That last point is the reason to build this into Snapback rather than leave it
to app code or an external policy engine: **revocation correctness.** Kick a
co-host and their live subscriptions actually clear. A bolted-on authorization
library cannot deliver that, because it does not own the sync layer.

Classic global RBAC (app-wide `admin`) is the degenerate case — a membership
scoped to the app itself — and comes along for free. Roles are **not** session
claims: `ctx.auth.roles` stays exactly what
[LLP 0039](./0039-auth-vertical-slice.rfc.md) pins (`[]` for real sessions,
populated only by dev impersonation). Baking roles into a session credential
creates the staleness problem LLP 0053 exists to prevent; memberships are
checked as live data instead.

## Motivation

- **Universality.** Messaging needs per-conversation membership; the card game
  needs per-game seats; team chat needs channel roles; the finance app needs
  viewer-vs-owner; an events app needs host/co-host/guest. LLP 0011's own
  motivating apps all reduce to memberships. Global-only RBAC would leave all
  of them hand-rolling the real thing.
- **Hand-rolled versions get invalidation wrong.** An app-defined `members`
  table works for reads the day it is written and silently fails the day a
  removal must claw back a live subscription, a retained offline result, or a
  protected room. LLP 0053 specified the machinery (Accepted; its landing
  items are LLP 0039's items 6 and 8); this RFC makes the common case use it
  by construction once it lands.
- **Explainability.** LLP 0011 requires denials to be diagnosable ("lacks
  membership" is one of its enumerated causes). A recognized primitive lets
  the doctor say *which* membership and *which* role is missing, instead of
  "a filter returned no rows."
- **Agents.** [LLP 0055](./0055-agent-principals-and-scoped-grants.rfc.md)'s
  principals hold memberships like any user, and delegated agents inherit the
  effective user's memberships intersected with their grant scopes. One
  membership model serves both.

## Goals

- A schema-declared membership shape usable by any app table, with a closed
  per-declaration role vocabulary enforced centrally for every writer.
- A **structurally axis-safe, scope-bound write contract** — not a convention:
  immutable principal/resource axes, generated write methods, an enforcement
  seam below every writer class. (LLP 0011's full two-sided contract lands with
  the declarative rules; v1 does not claim it — §Writes.)
- Declaration-bound rule helpers — declarative and imperative — that lower to
  analyzable, matcher-visible membership reads under LLP 0011's rule model and
  LLP 0053's protected-query input profile, **including on empty and denied
  lookups**.
- Function-level checks with host-produced trusted denials through LLP 0053's
  existing denial contract, decomposed to respect its one-class-per-operation
  rule.
- Correct LLP 0053 participation — including the coarse v1 cost, stated, and
  the profile amendment named.
- Global roles as a degenerate scope, not a second mechanism.

## Non-Goals

- Zanzibar-style relation graphs, rewrite rules, or permission inheritance.
  v1 memberships are flat facts.
- Role hierarchies in v1 — apps spell `hasRole(event, "host", "cohost")`
  explicitly; ranking is an open question (leaning: compile-time sugar).
- An organizations/teams *product* model. Memberships are the substrate a team
  model would build on, not the model itself.
- Custom permission matrices — roles gate rules and functions; what a role
  *means* stays in the app's rules, where it is analyzable.
- Session-claim roles. Explicitly rejected, per Summary.
- A new trusted denial code. Role denials ride the existing
  `SNAPBACK_AUTH_PERMISSION_DENIED`; 0053's producer enumeration is closed and
  this RFC does not amend it. (The protected-query **input profile** does need
  a dated amendment — a different, named obligation.)
- **Cross-declaration authority in the transition matrix.** `by` names roles in
  **this** declaration (or `"self"`/`"none"`), so "an app-global `moderator` may
  kick from any channel" is **not** expressible through the v1 write path: a
  moderator holds no channel membership and resolves to `"none"`. Apps needing it
  today route the operation through an operator-plane surface or wait for the
  declarative write rules. A qualified spelling (`by: ["appRoles:admin"]`) is the
  natural extension and is named as an open question — stated here so an adopting
  app meets this cliff in the document rather than at authoring time.
- **HostPlan membership writes in v1.** The shipped mutation IR's `Get` is a
  point read by id and its `Guard` carries an app-supplied code; the codegen's
  own taxonomy already classifies "membership guards over non-id keys" as
  outgrown-IR. So HostPlan cannot authorize a membership write — and therefore
  **every generic HostPlan write form targeting a declared membership table is
  refused, typed** (§Writes). Role-managed membership writes are Ibex-mutation
  work; the declaration-bound HostPlan membership step is named follow-on
  surface.
- **`ctx.permissions` in actions.** No transactional read set, so no capture.
  Refused, typed.
- **Retained/offline role-gated reads in v1.** LLP 0008's eligibility subset
  is analyzable single-table filters; a membership semi-join is outside it, so
  role-gated queries are **online/live only** until the 0008 semi-join
  amendment lands. `live_replace` delivery is not retention eligibility — an
  earlier draft conflated them.

## Design

### Declaring a membership table

```ts
defineTable("event_members", {
  eventId: v.id("events"),      // required, non-null
  userId: v.principal(),        // required, non-null — the auth-principal space
  role: v.string(),             // required, non-null
}).membership({
  principal: "userId",
  resource: "eventId",
  role: "role",
  roles: ["host", "cohost", "guest"],
  // pendingRoles: ["invited"],   // disjoint from roles; excluded from memberOf
  // incidental: ["joinedAt"],    // attested non-authorization columns
  // provenance: true,            // host-filled creation attribution
})
```

(Authoring syntax is illustrative; [LLP 0004](./0004-application-data-api.rfc.md)
owns the generated spelling and [LLP 0037](./0037-schema-source-of-truth.decision.md)'s
source-of-truth rules apply. `v.principal()` is **nominal typing over the
principal-id string space** — validated by shape, not by a foreign-key
existence check: memberships may outlive a principal's deactivation, and
LLP 0055 recovery preserves the principal so a recovered agent's memberships
resolve again. Roster hygiene for *ended* principals and *deleted resources*
is a named open question.)

**Key columns are required and non-null.** The declared `principal`,
`resource`, and `role` fields must be non-optional in the schema, and every
write path and the activation scan reject null or missing values. This is not
hygiene — SQLite and Postgres unique indexes admit multiple NULL-bearing rows,
so a nullable axis would silently defeat the uniqueness invariant the whole
primitive rests on. The **app-singleton** resource (§Global roles) is a system
constant, never a null resource column.

A table carries **at most one** `membership` declaration. Declaring
`.membership()` alongside a hand-written `permissionBacking`/`permissionFields`
is a typed manifest error — the derivation owns the table. Each declaration
gets a **stable id** (used by helpers, doctor traces, audit, room bindings, and
any future durable reference such as LLP 0055's prospective membership-resource
grant scopes): the id defaults from the table name and may be pinned explicitly
with `id:`; a table rename without a pinned id is a manifest diagnostic, since
a silently rotating id breaks audit and reference continuity. Ids are **unique across the manifest** (a collision is a load error), and once an
id has been **durably referenced** — it appears in a provenance or transition-log
row, an LLP 0013 room binding, or (prospectively) an LLP 0055 resource-scope
grant — re-binding it to a different table is a manifest error, because audit rows and any
future LLP 0055 resource-scope grants reference it durably. (An id that was
declared but never written may be re-bound freely; the guarantee is about
*durably referenced* ids, not about every string ever typed.) Role strings
compare by **exact decoded value** (no case folding, no Unicode normalization —
two writers must never disagree about whether `"Host"` is declared); control
characters are rejected and confusable near-duplicates are linted. `roles` and
`pendingRoles` must be **disjoint**, and their **union is the closed write
vocabulary**. **`"self"` and `"none"` are reserved identifiers** — they are the
caller *classes* the transition matrix names (§Writes), so declaring a role by
either name is a manifest error rather than an ambiguity the host would have to
guess at. The colon (`:`) is **reserved in role identifiers** for the same reason,
before it is needed: the natural future spelling for cross-declaration authority is
a qualified `by: ["appRoles:admin"]` (§Non-Goals), and a role *literally named*
`"appRoles:admin"` would then be ambiguous with it — reserving the separator now
costs nothing and keeps the closed-vocabulary guarantee intact when the extension
lands. Role literals generate as TypeScript unions; unknown literals,
duplicate helper arguments, empty vocabularies, and dynamic role expressions in
rules are rejected at generation/manifest load.

Consequences, **enforced centrally for every writer** — Ibex handlers, HostPlan
mutations, seed, admin edits, import, future adapters (the "one write path"
posture LLP 0053's commit hook relies on):

- **Closed roles.** A write outside the vocabulary is rejected, typed.
  Vocabulary changes are schema changes; **shrinking while rows still carry a
  removed role refuses activation** with a typed diagnostic naming the
  nonconforming rows (the 0039 collision-check pattern).
- **Uniqueness.** One row per `(principal, resource)`, backed by a generated
  **true unique** composite index (named new surface — today's `IndexManifest`
  has no uniqueness flag). Exactly-one-wins on concurrent same-pair inserts is
  delivered by that index at serialized commit under LLP 0004's ratified
  concurrency model.
- **Principal and resource are immutable after insert.** A membership is
  created for one principal on one resource; only its role changes (or the row
  is deleted). "Moving" a membership is an authorized delete plus an authorized
  insert. This is what makes the v1 write contract **axis-safe**: there is no
  cross-resource update whose pre- and post-states could be checked against
  different policies. (Axis-safe is *not* the same as LLP 0011's full two-sided
  contract — see §Writes, which states exactly what v1 delivers and what waits
  for the declarative rules.)
- **Activation over existing data is fail-closed:** vocabulary, uniqueness,
  nullability, column types, **and membership→resource referential integrity**
  (no membership may reference a resource row that does not exist) are validated;
  violations refuse activation. **Import validates the same predicate** — the
  resource-delete refusal (below) keeps live data clean, and activation/import
  keep *incoming* data clean, so orphaned authority cannot enter through a side
  door.
- **Still an ordinary table** for reads: it joins, exports, and appears in
  generated client types. Its own visibility is fail-closed by default on the
  **enumerated enforceable surfaces** — an undeclared-rules membership table is
  refused as the primary table of a syncable-live subscription (LLP 0008's
  subset), a retained read, or a generated direct table read. (Helper-mediated
  evaluation is unaffected: the evaluator is non-recursive by design. An
  app-authored handler can still read the table and return rows — v1 cannot
  inspect handler outputs, so that residual is the app's trust domain until
  declarative read rules land, and the validation row binds exactly the
  surfaces named here.) The declaration offers a blessed **"members see the
  member list"** preset — excluding `pendingRoles` — as the explicit opt-in.

### Writes: a declared transition policy, closed by default

Three review rounds hit this section, each finding a hole the previous fix
opened — a *blessed idiom* is not enforcement (round 3); a `ctx.db`-only
refusal leaves HostPlan open and makes the `system` sweeper unspellable
(round 4/5); and a caller-supplied `{ require: [...] }` list cannot express
**leave**, **accept invite**, or **decline** without a hand-written
target-principal check, which is the very convention the structural API exists
to replace (round 6). The root cause was designing the write surface
incrementally. It is settled here in one shape.

**The authorization policy is declared, not passed at the call site.** The
declaration carries a closed **transition matrix**; the generated methods take
no `require` argument; and **any write that matches no declared transition is
refused, typed**. Closed by default, like every other vocabulary in this RFC.

```ts
.membership({
  principal: "userId", resource: "eventId", role: "role",
  roles: ["host", "cohost", "guest"],
  pendingRoles: ["invited"],
  bootstrapRole: "host",                    // seated by the creation witness
  lastHolder: { protect: "host" },          // the host row-set never empties
  expiry: { field: "expiresAt", onExpiry: "remove" },   // optional; remove-only in v1
  provenance: "full",                       // creation | full (see §Agents)
  transitions: [
    { op: "insert",  by: ["host","cohost"], target: "other", to: ["invited"] },
    { op: "setRole", by: ["self"],  target: "self",  from: ["invited"], to: ["guest"] }, // accept
    { op: "remove",  by: ["self"],  target: "self",  from: ["invited","guest","cohost"] }, // decline / leave
    { op: "setRole", by: ["host"],  target: "other", from: ["guest"],   to: ["cohost"] },
    { op: "remove",  by: ["host"],  target: "other", from: ["guest","cohost"] },           // kick
    { op: "patch",   by: ["host"],  target: "other", fields: ["expiresAt"] },              // extend
    { op: "patch",   by: ["self"],  target: "self",  fields: ["notifyPrefs"] },            // own prefs
  ],
})
```

Every transition is evaluated **by the host**, in the write transaction,
against facts the host derives rather than the caller supplies:

- **`by`** — the authorization class of the caller. The classes are **disjoint
  and totally ordered**, and the host assigns **exactly one** (an earlier draft
  left them colliding — a `"self"` caller who is also a `host` matched two
  entries with no precedence rule):
  1. **`"self"`** — the effective principal **is** the target row's principal.
     This class wins whenever it holds, so "an invitee may accept **their own**
     invitation" is expressible and "an invitee may act on **another** invitee's
     row" is not.
  2. **a declared role** (e.g. `"host"`) — the caller's own role over the
     **target row's resource**, read in the same transaction. Applies only when
     the caller is *not* the target.
  3. **`"none"`** — an **authenticated effective principal** who holds no
     membership **for that resource** in this declaration (the open-join case:
     `{ op: "insert", by: ["none"], target: "self", to: ["guest"] }` lets a
     non-member seat themselves).

  **An authority with no effective principal matches _no_ class at all** — not
  even `"none"`. Anonymous, `system`, and `adminBypass` (which LLP 0039 projects
  as anonymous) carry no user, so there is no principal to be "self", to hold a
  role, or to be a member-less member. They therefore match nothing and are
  **refused, typed**. This is what makes the `adminBypass` row of the writer
  matrix true rather than merely asserted: a `by: ["none"]` open-join transition
  must not become a back door through which a userless authority writes
  memberships.

  **For `insert` there is no target row yet**, so the host derives the same facts
  from the insert itself: the **resource** is the one being inserted into (from
  the argument), the caller's class is computed over *that* resource, and
  `target` is **`"self"`** iff the principal being inserted **is** the effective
  principal, else `"other"`. That makes self-join (`by: "none"`, `target: "self"`)
  and invite (`by: "host"`, `target: "other"`) distinct, unambiguous transitions
  rather than two readings of one rule.
  A caller who is both the target *and* a `host` is class `"self"`: to let a
  host remove **themselves**, the app declares a `"self"` remove transition
  (and `lastHolder` still refuses stranding the resource). Declaring a
  transition whose `by` class cannot be reached is a manifest diagnostic.
- **`target`** — `self` or `other`, decided by the host comparing the effective
  principal to the **target row's principal**. The target principal is part of
  the transaction witness (an earlier draft omitted it, which is precisely why
  self-transitions were unspellable).
- **`from` / `to`** — the old role (from the captured target row) and the new
  role (from the argument). So "a guest cannot promote themselves" is not a
  claim about handler discipline: no declared transition has
  `by: ["guest"], target: "self", to: ["host"]`, so the host refuses it.

The generated methods are therefore thin and unforgeable:

```ts
await eventMembers.insert({ eventId, userId, role: "invited" })  // policy decides
await eventMembers.setRole(memberId, "guest")                    // accept, if declared
await eventMembers.remove(memberId)                              // leave / kick, if declared
await eventMembers.patch(memberId, { expiresAt: t })             // non-authorization columns
```

**Non-authorization columns need a write path too, and an earlier draft left
them unwritable** — with raw writes refused and only insert/setRole/remove
generated, an app could not even *renew* an expiring membership. So `patch()`
writes the declaration's **non-axis, non-role** columns (`expiresAt`,
`joinedAt`, app columns). It is governed by its own declared `op: "patch"`
transitions, so renewal is ordinary policy ("a host may extend a guest's
`expiresAt`"; "a member may edit their own notification preference" via
`by: ["self"]`). Its invalidation follows §Invalidation exactly: a `patch`
touching only **attested-`incidental`** columns fires no authorization event; a
`patch` touching any other column (`expiresAt`, say) **is** event 1, which is
why the `incidental` floor exists.

`insert` binds the resource being inserted into; `setRole` and `remove` re-read
the **target row** and bind *its* resource and *its* principal. Check-A/write-B
is unspellable, and so is an unguarded write — there is no unguarded form.

**Every insert also reads the resource row, and captures it.** Validating
referential integrity only at activation and import would leave the live path
open, and — worse — race-defeasible in exactly the way `lastHolder` was: an
open-join `insert` captures only the empty `(principal, resource)` membership
range, which a concurrent **teardown** does not touch, so both would commit and an
orphan membership would land on a *deleted* resource, minting authority over an
object that no longer exists. So the host **reads the referenced resource row in
the same transaction and captures it as a snapshot-bound dependency**. An insert
naming a nonexistent resource is refused, typed; and an insert racing that
resource's deletion fails commit-time read-set validation, because the teardown
changed the row it captured. Insert-vs-delete linearizes at commit, exactly like
`lastHolder`. **This applies to every writer that can insert** — the generated
methods, seed, admin edits, and `--as-membership` — not only to activation and
import.

**`lastHolder: { protect: <role> }`** refuses any transition that would remove
or demote the final holder of that role, whoever attempts it — **including the
expiry sweep, seed, import, and admin writers**. It is a table invariant, not a
caller policy.

**The invariant counts _eligible_ holders, not rows — and it needs three legs.**
Two earlier drafts got this wrong in sequence, and the second failure is the more
instructive one.

The first claimed the protected row set "never becomes empty" while only refusing
*transitions that would empty it*. That is vacuous if the set was never populated.

The second added an establishment leg but still counted **rows**, and a two-step
schedule defeats it: agents A and B both hold `host`; **deactivate A** — allowed,
since A is not the *sole* holder; then **B leaves** — also allowed, since the
holder-set check still sees **A's row**. The resource is left held by a
permanently deactivated principal that can never act, and `lastHolder` itself
forbids clearing that row. Permanently stranded, by a sequence every step of which
was individually legal. (A dead principal could also be seated as `host` outright,
since `v.principal()` validates *shape*, not existence or activity.)

So the unit is the **eligible holder**: a holder whose principal is not
permanently deactivated (LLP 0055 `deactivated_at`). The mechanism:

1. **Establishment.** A declaration with `lastHolder: { protect: R }` must set
   `bootstrapRole: R` (a mismatch is a manifest error — seating an `owner` while
   protecting `host` establishes nothing), and **creating a resource row is refused
   unless the same transaction seats its bootstrap holder**. The witness must be
   *spent*, not merely available. The bootstrap holder is the resolved effective
   principal, which is necessarily eligible (a deactivated principal cannot
   invoke).
2. **Preservation.** No writer — including the sweep, seed, import, and admin —
   may leave the **eligible** holder set empty. And **an ineligible principal may
   never be inserted into, or promoted into, the protected role**: you cannot seat
   a deactivated agent as `host`, so the set cannot be "kept full" with corpses.
3. **Validation.** Activation and import **refuse** when any live resource of a
   protected declaration lacks an **eligible** holder of `R`.

`lastHolder` is **not available on `scope: "app"` declarations**: the singleton has
no creation event to anchor establishment on, so the guarantee would have no first
leg. ("The app must always have an admin" is a different, app-level concern.)

**What it guarantees, stated exactly:** for every live resource of the declaration,
**at least one holder of the protected role exists whose principal can still act**.
LLP 0055's deactivation refusal is the same predicate from the other side: it
refuses deactivation that would leave any protected resource with **no eligible
holder** — not merely when the agent is the *sole* row.

The residual that remains is genuinely recoverable, and genuinely hygiene: a
principal that is *live* but idle or unreachable still counts as eligible, and no
row-level invariant can detect that. That is the principal-side roster-hygiene
open question.
**Its linearization is pinned, because the natural reading is race-defeasible.**
`lastHolder` is decided by an **aggregate** — the set of remaining holders of the
protected role — not a point read, and LLP 0004's ratified concurrency model runs
handlers concurrently with only the commit serialized. Two concurrent `remove()`s
of the final *two* hosts would each see the other present in their snapshot, both
pass, and the resource would strand with zero hosts — precisely the outcome the
invariant exists to refuse. So the rule is: **the holder-set read contributes a
snapshot-bound range dependency over the declaration's `(resource, role)` index,
validated at commit exactly like the membership lookup.** The first removal
commits and changes that range; the second fails commit-time read-set validation
and is refused, typed. Exactly one succeeds. This is the same machinery the
uniqueness invariant and the stale-role check already ride — no new mechanism, and
no invariant that holds only under serial execution.

**The writer-class matrix.** A `ctx.db`-only gate would be a hole: HostPlan's
generic write forms (`Insert`, `Patch`, `Delete`, `DeleteWhere`, `InsertEach`)
reach generic table writes today. Enforcement therefore sits at **one central
seam below both buffered Ibex writes and HostPlan execution**:

| Writer | Membership-table write in v1 |
|---|---|
| Ibex handler, user authority | **Only** the generated methods; the host evaluates the declared transition matrix. Raw `ctx.db` insert/update/delete fails typed (`SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED`). |
| Ibex handler, **`system` authority** | **Only** the generated `sweepExpired()` (below). There is no general system role-management API — an earlier draft's `systemSetRole` would have let a buggy cron promote anyone to `host`. |
| Ibex handler, **`adminBypass`** (direct runner) | **Fail-closed.** The direct runner projects *anonymous* auth (LLP 0039), so it carries no user: no transition can match, and it is not `system`, so the sweep is refused. Stated because "admin" below means *data edits*, not this invocation path. |
| **HostPlan** (any generic form) | **Refused, typed** — including nested action→mutation and dry-run paths. The declaration-bound HostPlan membership step is follow-on surface (§Non-Goals). |
| seed / import / admin data edits / `--as-membership` | Privileged **non-invocation** writers: allowed with their **tagged** provenance. Vocabulary, uniqueness, nullability, immutability, **referential integrity**, **and `lastHolder`** still apply; only the *transition matrix* does not (they carry their own authority). |

**Bootstrap is bound to creation, not to emptiness.** "No membership row exists
yet" is *not* a safe condition — it is also true of an imported orphan, a
resource whose last member left, and any resource an attacker can empty. The
host mints the bootstrap capability **only** when *this* mutation inserted
*that* resource row (absent→inserted in this transaction); it seats the
**server-derived effective principal** in the declared `bootstrapRole`; and it
is **single-use**.

An earlier draft defended bootstrap-revival by asserting that **resource ids are
never reused** — an invariant no document in this corpus owns and the storage
layer does not promise, so the defense rested on nothing. It is also no longer
needed. The revival hazard was a *re-created* resource inheriting a **stale
roster**, and stale rosters can no longer exist: a resource cannot be deleted
while memberships remain (teardown clears them in the same transaction), and
activation and import both validate referential integrity. With no orphan
memberships anywhere in the system, a resource id — reused or not — has nothing
stale to inherit. The argument is now self-contained rather than borrowed. **Memberships whose resource row is deleted remain live authority, and that is a
correctness matter rather than cosmetics:** a rule that gates on the membership
alone (without joining the resource) would still admit the holder. So **deleting
a resource row does not silently orphan its memberships**: the declaration binds
the membership's `resource` column to its resource table, and the host **refuses
the resource delete while memberships remain**, typed — **and that emptiness read
is captured**, exactly like `lastHolder`'s holder-set read and the insert's
resource read. It is the same race-defeasible shape a third time: an open-join
insert committing against a plain (non-teardown) delete would otherwise leave an
orphan, because the delete's emptiness check read a range the insert then filled.
Captured as a snapshot-bound empty-range dependency, the second of the two fails
commit-time validation. All three aggregates in this design — holder set, resource
existence, roster emptiness — are captured, and none is left to a snapshot read.

**That refusal needs a teardown path, or it deadlocks against `lastHolder`** — an
earlier draft said "clear the roster first," which is impossible when the roster's
final `host` is exactly the row `lastHolder` protects. The two invariants would
have made a protected resource permanently undeletable. The symmetric answer to
bootstrap: a **deletion witness**. The host mints it only when *this* mutation
deletes *that* resource row, and it authorizes the generated
`eventMembers.clearForResource(eventId)` — which removes the whole roster in the
same transaction, **waiving `lastHolder`** (the invariant exists to stop a *live*
resource being stranded without a host; a resource that ceases to exist strands
nothing). It is single-use **per (declaration, resource)** — a resource carrying two
membership declarations yields one witness for each, so neither can be spent on
the other — and unreachable outside the deleting transaction. So: **creation
witness → bootstrap; deletion witness → teardown** (each likewise scoped per
declaration), and neither is spellable without the host having actually seen the
resource row appear or disappear.

**Time-bounded memberships: a narrow, host-bound sweep.** LLP 0053's protected
profile refuses clock inputs, so a rule may never compare `expiresAt` to "now";
an expiring membership must be **materialized** as a write. The declaration
opts in with `expiry: { field, onExpiry }`, and the **only** system-authority
write is the generated **`sweepExpired()`**, which the host bounds completely:
it may act **only** on rows of **this declaration** whose **declared expiry
field** is in the past on the **authoritative (rollback-checked) clock**, and it
may only perform the **declared `onExpiry` effect**, which in v1 is **`remove`
and nothing else** — never an arbitrary role change, never a promotion, and never
a row that has not actually expired. Downgrade-on-expiry was in an earlier draft
and is withdrawn: with no declared ordering over the vocabulary, the host cannot
*prove* that `downgradeTo: X` is a reduction rather than an escalation, and an
expiry path that can silently promote is exactly the shape this primitive exists
to prevent. Removal is unambiguously non-escalating. Re-admitting a downgrade
effect requires a declared `roleOrder` the host can check against — a named open
question, not a v1 surface. **The effect is idempotent by construction:** a
removed row cannot be re-swept. Re-running the sweep with nothing newly expired
writes nothing and fires no authorization event. It honors `lastHolder` (above), and the precedence is pinned — with its honest
consequence. When a protected final holder is among the expired set, the sweep
**skips that row, leaves it live, and raises a typed diagnostic**: protection wins
over expiry, because the alternative is emptying the protected role. Skipping is
idempotent (the row stays expired-but-protected; the sweep neither loops nor
rewrites it). **The consequence, said plainly rather than discovered: `expiry`
does not bound the protected role.** A membership in a `lastHolder`-protected role
can sit expired-but-authorized indefinitely until the app seats a replacement — so
an app that needs a hard time bound on *every* holder must not protect the role it
expires, and the diagnostic exists precisely because only the app can resolve the
conflict.
The resulting write is an ordinary event-1 authorization event that the matcher
and room machinery see exactly like a user-authored kick.

Reachability, stated because the shipped runtime constrains it: **cron entries
must be `Action` kind**, and `ctx.permissions` does not exist in actions
(§Non-Goals). The blessed shape is therefore an app-declared **cron action that
calls `ctx.runMutation` into the generated sweep mutation**, which runs under
the inherited `system` authority (LLP 0039's inheritance rule) and must not be
declared `authenticated` (system carries no user). 0053 builds no deadline
scheduler, so the gap between `expiresAt` and the sweep is the app's cadence
choice — stated the way 0053 states its lease window. **Cadence is the app's
choice; _absence_ is a bug, and the manifest says so:** a declaration that opts
into `expiry` while no cron entry reaches its generated sweep is a typed
diagnostic. Otherwise an app declares time-bounded memberships and silently gets
memberships that never expire — precisely the class of authoring failure this
corpus lints elsewhere (`SNAPBACK_CRON_ACTION_KIND_MISMATCH`).

**What v1 delivers, named precisely.** The transition matrix gives **declared,
host-enforced role-transition policy** over `(op, caller role, self/other,
old role, new role)`, plus the axis-immutability and `lastHolder` invariants.
It is **not** LLP 0011's full **two-sided** contract — arbitrary declarative
predicates over the pre-state and merged post-state, including non-membership
columns — and this RFC does not lift LLP 0039's ratified
`writeAuthorization: "handler"` narrowing. Richer predicates are the
declarative-rules follow-on; their semantics are pinned now so the matrix and
the eventual rules agree, and whether declared membership tables then *require*
the declarative rules (fail-closed) is an open question.

### What exists, what this adds

As shipped today: the filter IR is single-table (`QueryPlan` has one `table`;
`ValueExpr` has no relationship/EXISTS form and one auth variable,
`auth.userId`); `TableManifest` carries no membership metadata and
`IndexManifest` no uniqueness flag; `FieldManifest` has an `optional` flag
(hence the non-null pin above); there is no `ctx.permissions` host operation;
declarative write-side row rules are deferred by a ratified 0039 narrowing; the
HostPlan `Get` is id-only; and LLP 0008 pins the v1 syncable-live subset to
analyzable single-table filters, with richer queries riding the whole-handler
re-query/`replace` fallback.

New surface this RFC adds:

- a **declaration-bound membership predicate node** in the structured filter IR
  — the first deliberate step past single-table filters. Under Accepted 0053's
  default-deny input profile, a new expression kind is denied for protected
  queries until the profile classifies it; the dated amendment is a named
  companion obligation. Its **design semantics** are pinned here (composition,
  declaration identity, row-field vs. argument resource references, role lists,
  pending-role exclusion, effective-principal resolution, null/fail-closed
  behavior); its **normative serialized AST, SQL lowering, and matcher
  convergence proof** are implementing-spec obligations (§Protocol obligations);
- **matcher participation** with the pinned dependency capture below;
- the **schema surface**: `.membership()` metadata with stable ids, the
  generated **unique index**, and `v.principal()`;
- the **generated write methods** (above) and the raw-write refusal;
- the **`ctx.permissions` membership read** host operation (below);
- the **HostPlan membership step** — follow-on, not v1.

**Implementation status.** *M1 landed 2026-07-14 via ENG-24907* — the **schema
surface**: the `.membership()` metadata on `TableManifest` (declaration model,
stable id with manifest-global uniqueness, closed exact-decoded vocabulary with
the reserved-name / `:` / control-character / confusable / disjointness traps,
the `lastHolder`/`expiry`/`incidental`-floor/transition-shape declaration
validation), `v.principal()` as a `FieldType`, an `unique` flag on
`IndexManifest` driving the generated true-unique `(principal, resource)` index,
and the **fail-closed activation scan** over existing data (vocabulary,
nullability, uniqueness, referential integrity, and the `lastHolder` holder
presence). M1 deliberately does **not** land: the transition-matrix execution,
generated write methods, and raw-write refusal (M2); the rule helpers and
`ctx.permissions` read (M3); the matcher/predicate-IR and invalidation wiring
(M4/M5); and the provenance columns/log (M5). Two M1 boundaries rest on later
milestones and are enforced conservatively rather than guessed: the `lastHolder`
activation check counts holder *rows* (the *eligible*-holder refinement that
excludes LLP 0055-deactivated principals lands with the LLP 0055 principal
machinery), and referential integrity keys on a `resourceTable` binding the
declaration records directly until codegen fills it from `v.id(...)` under the
LLP 0004 authoring follow-on.

*M3 landed 2026-07-14 via ENG-24909* — the **rule helpers, the membership
predicate IR, and `ctx.permissions`**: the declaration-bound membership
predicate node in the structured filter IR (`ValueExpr::MembershipExists` +
`QueryPlan.membershipFilters` carrying `MembershipPredicate` /
`MembershipResourceRef`, the first step past single-table filters), its
correlated-`EXISTS` SQL lowering (non-recursive — the query executor applies no
row-visibility rules), and — the load-bearing part — its capture as **ordinary**
snapshot-bound `Query` dependencies over the membership table (never the dead
`CapturedReadKind::Permission` kind that both the matcher and commit-time
read-set validation ignore), including the pinned **empty-result** form (a
membership insert wakes a previously-empty subscription) and the conservative
table-level dependency for row-field resource refs. `memberOf` excludes
`pendingRoles`; `hasRole` names roles explicitly. `ctx.permissions.<decl>.
requireRole(...)` is decomposed into the membership read (`DatabaseCaptured` on
both outcomes, captured into the read set) plus — on a failed check — the
**existing** `TerminalAuthorization` deny (the existing
`SNAPBACK_AUTH_PERMISSION_DENIED`, no new trusted code), with the trusted brand
recorded out-of-band on the host context so a handler cannot un-deny by catching
and a forged throw stays untyped. The client denial payload is the invariant
`{ kind: "role" }` (no existence oracle); there is no application-returning
`get()`; and `ctx.permissions` is a typed refusal in actions. The authoritative-
only `MembershipExists` is refused by both the pure `ValueExpr` evaluator and the
derived optimistic overlay, so a role check stays server-decided.

M3 deliberately does **not** land: the matcher/room invalidation wiring beyond
the conservative capture (M4/M5); the incremental membership semi-join lane and
retained/offline role-gated reads (the named LLP 0008 follow-on); and the
generated per-declaration authoring spelling for the helpers and
`ctx.permissions.<decl>` (LLP 0004 codegen — the shipped binding is the
host-backed lowering it targets). The stricter *resource-type* load check
(row field / argument **of the declared resource type**, rejecting a different
resource type) is enforced conservatively (declaration existence, field
existence on the queried table, and vocabulary membership) until codegen fills
the field-reference types alongside `resourceTable`, matching M1's posture; the
runtime fail-closes on an unresolved declaration or a bad row field either way.
*M2 landed 2026-07-14 via ENG-24908* — the **write path**, enforced at the host
below every writer: the **writer-class seam** (one gate below both buffered Ibex
writes and HostPlan — a raw `ctx.db` membership write, every generic HostPlan form
including dry-run and nested action→mutation, and a resource delete that would
orphan memberships are refused typed; the `system` sweep is the only
system-authority write; `adminBypass`/anonymous match no class); the **declared
transition matrix**, closed by default, with the host deriving caller class /
self-other / from / to from the target row read in the write transaction, and
`insert`/`patch` **field-bound**; **`lastHolder` counting eligible holders**
(reusing G1's `deactivated_at` predicate) across all three legs, with the
holder-set, resource-existence, and roster-emptiness aggregates **captured** so
concurrent finals yield exactly one commit and one typed commit-time refusal; the
**creation/teardown witnesses** (bootstrap seats the server-derived effective
principal on the resource row it actually created; teardown waives `lastHolder`
and clears the roster with the resource); and the host-bound **`sweepExpired()`**
(remove-only, rollback-checked clock, `lastHolder` wins over expiry with a typed
diagnostic). The activation scan's `lastHolder` leg is upgraded from row-counting
to the **eligible**-holder predicate now that G1 has landed. M2 deliberately does
**not** land: the generated JS methods and their `ctx.membership.<decl>.*` host-op
dispatch, the cron→sweep wiring, and `--as-membership` (the LLP 0004 codegen/bridge
follow-on — the host methods are the enforcement seam the bridge will call); the
rule helpers and `ctx.permissions` read (M3); the matcher/predicate-IR and
invalidation wiring (M4/M5); and the provenance columns/log (M5). One residual is
named rather than guessed: a membership removal racing a **concurrent
deactivation** of the relied-upon survivor is not linearized by the captured
membership-row dependency (deactivation touches `_auth_users`, not the survivor's
row); the sequential two-step schedule and concurrent membership-row removals are
both closed, and G1's deactivation-would-strand refusal closes the reverse side.

**Delivery lanes, honestly.** A helper-gated query rides the **conservative
re-query/`live_replace` lane** — which exists today and is exactly the lane
0053's witnessed obligations protect. "Analyzable by construction" buys, in v1:
the matcher wakes the query on membership writes, the doctor explains the
check, and the write path enforces the vocabulary — **not** incremental
membership deltas and **not** retained eligibility (§Non-Goals). The membership
**semi-join incremental lane** — and, with it, retained/offline role-gated
reads — is the named follow-on requiring the LLP 0008/0004 amendments.

**The captured-dependency contract is pinned — for every outcome — because the
obvious representations are wrong.** Two shipped facts drive it: the matcher
gives captured dependencies precedence and can prove a change disjoint from
them **without consulting the static read summary**; and
`CapturedReadKind::Permission` is legacy epoch-scope machinery that both the
matcher and commit-time read-set validation **ignore**. Therefore:

- a **successful** membership lookup records ordinary snapshot-bound row/query
  dependencies through the unique `(principal, resource)` index — the kinds
  both paths already honor, never the `Permission` kind;
- an **empty** lookup records the corresponding **empty-result query dependency
  on the same index range**, so a membership *insert* or role upgrade wakes a
  subscription that previously matched nothing. This is load-bearing precisely
  because of the captured-Query short-circuit: without it, the matcher would
  prove a membership insert "disjoint" and a newly-added member would stay
  permanently invisible;
- when `resourceRef` is a **row field** (the per-row semi-join), v1 records a
  **conservative table-level dependency** — any membership write wakes the
  query — until the semi-join lane proves finer capture. Coarse wake is a
  re-query cost, never a correctness loss; the reverse choice would be.

### Rule helpers

Helpers are **generated per declaration and bound to it** — there is no global
`memberOf`/`hasRole` resolver, because two membership tables can target the same
resource type and ambiguity here is an authorization bug factory:

- `eventMembers.memberOf(resourceRef)` — a membership row in a **non-pending**
  role (`pendingRoles` are excluded: an invited-but-not-accepted principal is
  not a member);
- `eventMembers.hasRole(resourceRef, role, ...)` — one of the named roles
  (pending roles are nameable explicitly).

The declared `resource` column is a **reference to exactly one resource table**
(`v.id("events")` above) or the **app singleton** (`scope: "app"`); the
declaration records which, and mixing the two in one declaration is a manifest
error. `resourceRef` in a helper may be a **row field of the table under query**
whose type is that same resource reference, or a **query argument** of that type
(both analyzable at subscribe time); anything else — a computed expression, a
different resource type, a join through a third table — is outside the v1 grammar
and is a load-time error.
Auth variables resolve at subscribe time and fail closed when unauthenticated —
internally a null principal matches no rows; at the surface an unauthenticated
client subscribing to an auth-dependent query receives LLP 0011's typed
rejection. Two declarations over one resource type compose by ordinary
rule-level OR, and doctor traces name which declaration satisfied the check.

The imperative twin is declaration-bound and **decomposed into two primitive
host operations so 0053's one-class-per-operation rule holds exactly**:

```ts
await ctx.permissions.eventMembers.requireRole(eventId, "host", "cohost")
```

- **one new host operation** — the membership read backing `requireRole`'s
  internal lookup — classified **`DatabaseCaptured`** on **both** outcomes:
  present or absent, it contributes its snapshot-bound dependency (including
  the empty-result form) to the read summary and to commit-time read-set
  validation. It is an **internal primitive with no application-returning
  form** in v1: a public `ctx.permissions.<decl>.get()` would hand handlers a
  membership fact obtained through the evaluator's deliberate
  visibility-bypass, re-opening as an API exactly the existence oracle the
  denial payload closes. Apps that want to *show* a caller their own role read
  the membership table through an ordinary, visibility-governed query;
- on false, `requireRole` invokes the **existing `TerminalAuthorization` deny
  operation** (`ctx.permissions.deny()`), producing the **existing** trusted
  `SNAPBACK_AUTH_PERMISSION_DENIED` — no new trusted code, no
  producer-enumeration change, no application value returned. `requireRole` is
  generated sugar over that composition, not a third host operation.
- **The client-visible denial payload is invariant across denial causes:**
  `{ kind: "role" }` — nothing more. An earlier draft returned
  `callerState: "absent" | "wrong-role"`, which is a **membership-existence
  oracle**: because the trusted evaluator deliberately bypasses the table's own
  row-visibility rules, that distinction would tell a prober "a hidden
  membership row exists here with some other role" even where the app's
  member-list policy hides exactly that fact — a private permission fact under
  0053's never-echo rule. The caller's own state, the required roles, the
  declaration id, the resource, and the rule trace live on the **gated
  doctor/audit surface**. Apps that want to disclose a caller's own membership
  state do so through an ordinary app-visible read governed by the table's
  visibility policy.
- Against an unauthenticated caller: `authenticated` functions fail 0039's
  `AUTH_REQUIRED` before the handler runs; under `optional-user` with a null
  principal the composition denies with the same invariant payload.
- **`ctx.permissions` does not exist in actions** (§Non-Goals), typed refusal.

**Stale checks, and what the denial must carry.** A role revoked between a
successful check and commit **fails commit-time read-set validation** — the
captured membership read is in the mutation's read set, so the commit is
invalidated rather than racing (LLP 0004 §Write Semantics). The reverse
direction is *not* symmetric, and an earlier draft claimed it was: a **denied**
invocation commits nothing, and the shipped runtime discards captured reads on
handler failure, so commit-time validation cannot be the mechanism that catches
a denial superseded by a concurrent grant.

The **semantic minimum is pinned here**, because Accepted LLP 0053 requires a
trusted denial to carry a coherent authorization/data witness and forbids
discharging an obligation floor newer than that witness — this RFC inherits
both and cannot leave them open:

- terminalization **preserves the membership lookup's snapshot-bound
  dependency** — ordinary handler-error capture disposal must not erase or
  misbrand the authorization read;
- the produced `SNAPBACK_AUTH_PERMISSION_DENIED` carries a **coherent
  authorization/data witness** naming at least the causing data version;
- during obligation resolution, a denial **cannot discharge a floor newer than
  its own witness** — a stale deny is a fail-closed, retryable refusal (never
  fail-open, never a false proof).

What is deferred (§Protocol obligations) is the *mechanism*: the exact
linearization point at which the deny operation validates its captured reads
before branding, and what a linearization-*failed* deny does to the
registration. The ordinary denied-at-subscribe outcome is **not** open — it is
pinned below.

**Denied-at-subscribe is not empty-at-subscribe.** The empty-result capture wakes
a *live subscription that matched nothing*; a subscription **denied** at
establishment by `requireRole` is terminated (trusted denial → `delete`, and
0053's terminal retirement means it is gone), so a later grant has nothing to
wake and the client must resubscribe. Both are fail-closed, but they differ, and
authors should know which they are choosing: **prefer the declarative helper as a
filter when hidden-to-visible transitions matter**; use `requireRole` as a gate
when the query should not exist at all without the role.

**Trusted policy evaluation is non-recursive by construction.** The evaluator
reads membership facts through the storage layer to produce a boolean or a
trusted denial; the table's own visibility rules govern what *rows* clients can
read and sync, never whether the evaluator may consult the facts. A locked-down
member list cannot break role evaluation for guests.

### Invalidation: the LLP 0053 mapping

- **Result dependence (the matcher path).** A helper-gated query carries the
  membership table in its captured dependencies (including empty results), so
  the matcher observes membership writes, re-queries, and any resulting shrink
  is protected by 0053's **witnessed delivery obligation**. The primitive's job
  is making sure the check *is* a captured read the matcher can see — never a
  role cached in a variable, a session claim, or a denormalized flag.
- **Authorization dependence (the version path).** A `membership` declaration
  **is** `permissionBacking: true` in 0053's sense. `permissionFields` defaults
  to **every column**, and narrowing via `incidental` has a **hard floor**: the
  declared `principal`, `resource`, and `role` columns — and the generated
  `provenance` columns — **can never be attested incidental**; naming one is a
  typed manifest error. This closes a real hole: in an app whose role checks are
  all imperative (so no declarative rule references the role column and the
  existing analyzable manifest error never fires), a one-line
  `incidental: ["role"]` would have made every role *change* a
  "known update provably within `incidental`," suppressed under 0053's narrowing
  rule — no authorization-version advance, no room-authority barrier for a
  downgrade-driven kick, no retained gating — for exactly the transitions the
  primitive exists to protect. Unlike a hand-written `permissionBacking` table,
  the declaration *names* its authorization column, so the system can refuse the
  false attestation structurally, which is this corpus's posture. Beyond the
  floor, `incidental` remains the app's explicit attestation for genuinely
  inert columns (with a companion-table recommendation for anything doubtful).
  Under 0053's closed event universe, **every committed write to the table is
  authorization event 1**: inserts and deletes always advance the global
  authorization version and project quarantine/reauthorization obligations; a
  known update provably within `incidental` fires nothing. This holds through
  0053's one-commit-hook rule for **every** writer, with no bulk-path special
  case (reset/import carry event-3/declared-restore incarnation semantics;
  schema activation is event 2 — inherited, not restated).
- **Rooms.** Because membership writes are event 1, a kick — by delete **or by
  role downgrade** — on a resource backing a protected ephemeral room
  ([LLP 0013](./0013-ephemeral-realtime-state.rfc.md)) advances the version and
  projects room-authority suspension and fresh membership-snapshot
  reauthorization, exactly 0053's card-game fixture. The declaration gives the
  room authority the concrete table and stable id its predicate binds to.
- **Retained results** are **not** produced by role-gated queries in v1
  (§Non-Goals). When the 0008 semi-join amendment makes them eligible, they
  inherit 0053's retained-authorization contract unchanged (coarse-event
  quarantine for connected clients; lease-bounded gating at boot/reconnect for
  offline ones), and this RFC's `[retained]` rows activate with it.

**The v1 cost, owned.** v1 has exactly one **global** authorization version.
Making memberships the blessed primitive makes membership churn — joins, leaves,
invite-accepts, role changes: routine lobby traffic — a stream of event-1 writes,
each coarsely quarantining every auth-scoped subscription of every connected
client until resnapshot. That is 0053's deliberate v1 trade (quarantine is
recoverable and fail-closed; `delete` needs proof), it is why 0053 requires
blast-radius measurement in acceptance — measured **per declaration as well as
globally**, so narrowing proposals have real evidence — and apps adopting
memberships adopt that cost knowingly until narrowing lands.

**Declared memberships are a candidate on-ramp for 0053's graduation — a closed
source, not a sufficiency proof.** 0053's first open question asks for "a
structural derivation over transactional old/new rows or an equivalently closed
source" before subject-scoped narrowing can ship. A declared membership table
supplies the **row-attribution half** mechanically: principal and resource are
declared, immutable columns; inserts and deletes name them directly; and
one-row-per-pair makes every update a point write whose pre-image is readable in
the same transaction. It does **not** supply **usage-side closure** — knowing
*which row changed* is not knowing *whose authority depends on it*, since a
function-level check may authorize principal Q from an aggregate ("is there any
host?"). Subject narrowing therefore additionally requires that every
authorization dependence on the declaration be generated (the bound helpers),
effective-principal-local, and resource-local; raw membership reads in protected
queries keep the global path. 0053 owns the graduation and its proof standard
(successful shadow observations are not proof), and shadow validation should
include cross-principal counterexamples of exactly the aggregate shape. The
cheaper intermediate — **declaration-scoped** narrowing (quarantine only queries
whose dependence includes the changed declaration), needing no subject
attribution at all — is the natural first target, and the per-declaration
measurement above is its evidence base.

### Global roles

```ts
defineTable("app_roles", { userId: v.principal(), role: v.string() })
  .membership({ principal: "userId", role: "role",
                roles: ["admin", "moderator"], scope: "app" })
```

`appRoles.hasGlobalRole("admin")` sugars over it (declaration-bound like every
helper; the singleton resource is a **system constant**, spelled consistently
across helpers, denials, audit, and the unique index — never a null column).
This is deliberately *data*, distinct from LLP 0039's operator-plane
authorities: an app-level `admin` governs what app rules say it governs; it
never satisfies `AdminRead`/`AdminWrite`/`AdminSecretRead`/
`ImpersonationCapability`, which remain instance-operator authorities outside
the app's principal space. ([LLP 0055](./0055-agent-principals-and-scoped-grants.rfc.md)
§Plane boundary is the same wall from the other side.)

Honest consequence of uniqueness: with the app singleton as the resource, **a
principal holds at most one global role per declaration**. Exclusive
vocabularies fit naturally; apps needing stackable global roles declare a
second table, and the multi-role open question is expected to force its answer
**here first**.

### What stays out of the session

`ctx.auth.roles` remains dev-impersonation-only; there is no role claim minted
at login to go stale. `--as-role` is [LLP 0024](./0024-agent-operating-surface.spec.md)-specified
and **unbuilt today**. Its semantics against this RFC:

- an impersonated bare role satisfies an **app-global** declaration only when
  **exactly one** app-global declaration declares that role string; with two
  such declarations both declaring `"admin"`, bare `--as-role admin` is
  **refused at test setup** (deterministic, never satisfies-both). The
  declaration-qualified spelling (`--as-role appRoles:admin`) is named for the
  0024 amendment;
- **scoped declarations are never satisfiable by impersonated roles.** The
  named `--as-membership <declaration>:<resource>:<role>` facility is **sugar
  that seeds a real membership row** under dev authority — not an impersonation
  input — so this pin holds unconditionally;
- **test-fidelity note:** impersonated global roles exercise the session-roles
  path, not the membership-table read, so at least one global-role acceptance
  case must run against a real seeded row, and doctor labels the impersonated
  path explicitly ("satisfied via impersonated session roles, not a membership
  row").

**Optimistic/offline parity** (LLP 0011's replay-parity rule): a helper-gated
mutation evaluated optimistically would need the relevant membership rows in
the local store — and **in v1 no blessed path puts them there** (role-gated
queries are not retained-eligible, and the member-list preset is itself
membership-gated, hence outside LLP 0008's single-table subset). So in v1 the
role check is effectively **server-decides**, with the divergence window
accepted, unless the app separately syncs those rows under its own rules. The
kit parity contract and its validation land with the 0004/0008 companion work.

### Agents

Under LLP 0055: an autonomous agent principal holds memberships under its own
`userId` like any user. A delegated agent evaluates role checks against the
*effective* user's memberships, with grant scopes intersecting what it can
invoke, never widening what memberships allow.

Kind-gating follows 0055's variable semantics, and both naive spellings fail in
opposite directions: `auth.kind == "human"` alone is satisfied by a
**delegated** agent acting for a human (the effective principal *is* the
human); `auth.isDelegated == false` alone is satisfied by an **autonomous**
agent. "The person themself" requires both conjuncts (0055 ships the
`isDirectHuman` helper for the handler twin):

```
eventMembers.hasRole(event, "host")
  && auth.kind == "human" && auth.isDelegated == false   // the person themself

eventMembers.hasRole(event, "host") && auth.kind == "human"
  // human authority; delegated agents acting for that human OK
```

**Delegated membership writes create durable authority — and LLP 0055 now gates
them.** A delegated agent whose grant covers a role-management mutation can,
under the effective user's authority, seat a membership for any principal —
including its own actor — and that row **survives grant revocation**, leaving
the agent autonomously privileged. LLP 0055 therefore marks such functions
**`authorityCreating`**: excluded from tier wildcards, requiring an explicit
consented scope, flagged in the consent display, **and requiring the target
membership table to declare `provenance: "full"`** — so every seat, downgrade,
and kick the delegate performs stays attributable after the fact. That
composition is the answer to the question both documents were carrying.

**Bootstrap-only writes do not trigger the marker**, and the reason is
structural rather than a convenience carve-out: the bootstrap capability seats
**only the server-derived effective principal**, **only** under a
same-transaction creation witness, **only** in the declaration's
`bootstrapRole`, and only once (§Writes). It cannot name a principal argument,
so the self-seating escalation the marker exists to gate is unspellable through
it — a delegated agent creating an event on the user's behalf seats *the user*,
never itself. Without this carve-out every "create an event / document / game"
mutation would become non-wildcard-grantable, which is consent fatigue for the
most common delegated operation and buys no safety. A function that performs a
bootstrap write **and** any other membership write is marked, as usual.

**`provenance` has two levels, and `authorityCreating` requires the stronger
one.** Creation-only attribution was insufficient: a delegated agent's
*downgrade* or *delete* of a membership (an authorized kick) left no durable
trace once the row was gone, yet LLP 0055 leans on this table for exactly the
attribution its `authorityCreating` gate promises.

- **`provenance: "creation"`** adds host-filled, immutable columns —
  `grantedByActor`, `grantedByEffective`, `grantedByGrant` — written on insert.
- **`provenance: "full"`** additionally maintains a host-managed, **append-only
  transition log** for the declaration: one row per authorization-relevant
  write (`op`, `principal`, `resource`, `from`, `to`, `actor`, `effective`,
  `grant`, `commitVersion`, `writerClass`). It is system-managed app-adjacent
  data — the app declares nothing beyond the level — and it is what makes a
  kick, a downgrade, and a self-seat all attributable after the row is gone.
  **LLP 0055's `authorityCreating` marker requires `provenance: "full"`** on
  every membership table the marked function writes.

Fill rules per writer class: from the resolved authority for invocation-gate
writers under user authority (direct session: actor = effective, grant null;
delegated agent: actor = agent, effective = user, grant = the grant); the tag
`system` for the expiry sweep (a userless execution has no principals to
record); and the tags `seed`, `import`, or `hostOps:<verb>` for the privileged
non-invocation writers. `grantedByGrant` is a **historical tag, not a
resolvable reference** — grants are excluded from logical export and terminally
revoked by 0055 recovery, so nothing may join against it. **Import preserves**
exported provenance values (the columns are immutable and continuity is the
point). Adding a `provenance` declaration to an **already-populated** table
backfills the pre-declaration rows with the tag `preexisting` rather than
refusing activation — otherwise a brownfield app could never adopt delegated
role management, since 0055 requires the declaration before any writing
function can be consented.

A general, cross-table audit substrate remains LLP 0019 F8's follow-on; what is
pinned here is the per-declaration log, which is bounded, declared, and exactly
as wide as the authority this primitive creates.

## Protocol obligations deferred to implementation

**This is an RFC, not a protocol spec** — the same call LLP 0039 §Protocol
obligations records (ratified by Charlie, 2026-07-12) for the parent umbrella,
and the same methodological split appeared here. Design intent is pinned above;
protocol rigor lands in the implementing LLP/spec. Recorded so they cannot be
lost:

1. **The membership predicate IR.** A normative Rust-first AST and serialized
   schema: logical composition, declaration identity, row-field vs. argument
   resource references, role lists and pending-role exclusion,
   effective-principal resolution, null semantics, bounds; SQL/SQLite lowering;
   conservative matcher evaluation for both primary-table and membership-table
   changes; schema-drift and matcher-vs-full-query convergence tests (a
   reference oracle evaluating every rule by a full semi-join and comparing
   against matcher skip/re-query decisions).
2. **Denial linearization *mechanics*.** The witness contract, the
   capture-survival rule, and the ordinary terminated-at-subscribe outcome are
   **pinned** (§Rule helpers) and are not open. Deferred: the exact
   commit-ordered point at which the deny operation validates its captured
   reads before branding, and what a *linearization-failed* deny does to the
   registration.
3. **The membership transition ledger** (with LLP 0019 F8): schema, retention,
   redaction, and commit linkage for every authorization-relevant insert, role
   transition, and delete.
4. **Generated write-method mechanics:** the transaction-local authorization
   witness binding caller/effective principal, declaration, resource, target
   row, operation, and old/new role; witness non-reuse; and the bootstrap
   exception's exactly-once property.
5. **Blast-radius instrumentation:** the per-declaration counters, their
   reporting surface, and whether a numeric bar gates blessing memberships for
   the reference apps before narrowing lands.

## Validation Requirements

**[base]** runs under dev impersonation or finite sessions (after 0039 item 5);
**[live]** requires auth-scoped live surfaces (item 6); **[+0055]** additionally
requires LLP 0055; **[retained]** rows are **deferred with the LLP 0008
semi-join amendment** and are not v1 acceptance.

- [base] **Writer-class matrix** (the enforcement seam sits below every writer,
  not on `ctx.db`): raw `ctx.db` insert/update/delete on a declared membership
  table fails typed; **every generic HostPlan write form** (`Insert`, `Patch`,
  `Delete`, `DeleteWhere`, `InsertEach`) targeting one fails typed — including
  through nested action→mutation and dry-run paths; the generated `system` sweep
  form succeeds **only** under resolved `system` authority and is unreachable
  from user authority; seed, import, and admin writers succeed and carry their
  tags. Vocabulary is enforced for **every** class that can write: unknown roles
  fail typed; exact-decoded matching (a `"Host"` write against a `"host"`
  vocabulary fails); `roles`/`pendingRoles` overlap is a manifest error;
  activation over nonconforming rows is refused; vocabulary shrink with extant
  rows refuses activation; `.membership()` plus hand-declared `permissionBacking`
  is a manifest error.
- [base] **Non-null axes:** a declaration with an optional principal, resource,
  or role field is a manifest error; null/missing axis values are refused on
  every write path and at activation; the app-singleton resource is a constant,
  not a null (a NULL-bearing row cannot defeat the unique index).
- [base] **`incidental` floor:** naming `principal`, `resource`, `role`, or a
  `provenance` column in `incidental` is a typed manifest error — asserted for
  an imperative-only app, where no declarative rule references the role column.
- [base] Uniqueness and immutability: concurrent same-pair inserts yield one row
  and one typed conflict; an update changing principal or resource fails typed.
- [base] **Declared transition policy (closed by default):** a write matching no
  declared transition is refused typed; the named policy under test is stated in
  the fixture. The matrix is proven on the transitions every motivating app
  needs: **leave** and **decline** (`by: self`, `target: self`), **accept invite**
  (`self`, `invited → guest`), **invite** (`host/cohost → other`), **promote**,
  and **kick** — and on their negatives: an invitee cannot act on **another**
  invitee's row (`target: self` binds it), a guest cannot promote themselves (no
  such transition exists), and check-A/write-B is unspellable (the host binds the
  target row's own resource and principal). `lastHolder: { protect }` refuses the
  demotion **and** removal of the final holder **for every writer class,
  including the expiry sweep, seed, import, and admin** — protection wins over
  expiry, and an expiring final holder raises the typed diagnostic instead of
  stranding the resource. A role revoked between check and commit fails
  commit-time read-set validation.
- [base] **The sweep is host-bound, not a system bypass:** `sweepExpired()` acts
  only on rows of its declaration whose declared expiry field is past on the
  rollback-checked clock, and performs only `remove` (the sole v1 `onExpiry`
  effect) — a not-yet-expired row, any role change at all, and a
  cross-declaration row are each refused; a declaration attempting
  `onExpiry: "downgradeTo: …"` is a manifest error (no declared ordering means no
  provable non-escalation); there is **no** general system-authority
  role-management API (a `systemSetRole` does not exist).
- [base] **A userless authority matches no transition class:** `system`,
  `adminBypass` (anonymous projection), and anonymous callers are refused by the
  generated write methods — **including against a `by: ["none"]` open-join
  transition**, which requires an *authenticated* effective principal. The
  open-join back door is closed by construction, not by convention.
- [base] **`patch` is field-bound, not just op-bound:** a `patch` touching a
  column outside the matched transition's `fields` list is refused typed — in
  particular, a member with a `by: ["self"]` preferences patch **cannot extend
  their own `expiresAt`** (the self-renewal hole), while a host's
  `fields: ["expiresAt"]` transition can extend a guest's. An `incidental`-only
  patch fires no authorization event; a patch touching any other column is
  event 1.
- [base] **Reserved identifiers:** declaring a role named `"self"` or `"none"` is
  a manifest error (they are caller classes, not roles).
- [base] **`lastHolder` counts _eligible_ holders — the adversarial schedule that
  defeated a row-counting version:** agents A and B both hold the protected role;
  **deactivate A** (allowed — not the sole row); then B **leaves / is demoted /
  expires / is deactivated** → **refused**, because A is ineligible and B is the
  last *eligible* holder. The resource can never be left held only by a
  permanently deactivated principal. Also refused: **inserting or promoting an
  ineligible (deactivated) principal into the protected role** — the set cannot be
  kept full with corpses. Concurrent variants of the same schedule yield exactly
  one commit and one typed refusal.
- [base] **`lastHolder` is _established_, not merely preserved** — the leg an earlier
  draft was missing: a declaration with `lastHolder.protect: R` and
  `bootstrapRole != R` is a manifest error; **creating a resource of a protected
  declaration without seating its bootstrap holder in the same transaction is
  refused**; activation and import are **refused** when any live resource lacks a
  holder of `R`; and `lastHolder` on a `scope: "app"` declaration is a manifest
  error. Together these make the guarantee non-vacuous: an empty **eligible** set is
  unreachable, so the refusal has something to protect.
- [base] **`lastHolder` is a row-set invariant, and the document's claim matches
  the mechanism:** for every live resource at least one protected holder exists; an expired protected
  final holder stays **authorized** with the typed diagnostic raised, so `expiry` is
  proven *not* to bound a protected role; and the *permanent* version of the
  stranding gap is closed at the source — **LLP 0055 refuses to deactivate an agent
  that is the sole holder of a protected role** (asserted from this side too, since
  this document owns the invariant that would otherwise make the state unfixable).
- [base] **`lastHolder` holds under concurrency — the race the invariant exists to
  refuse:** two concurrent `remove()`s (and a concurrent remove + demote) of the
  final **two** holders of a protected role yield **exactly one commit and one
  typed commit-time refusal**, never a resource stranded with zero holders. A
  snapshot-read implementation that checks the holder set without capturing it
  would pass every *serial* row and fail this one — which is the point.
- [base] **Referential integrity holds on the live path, under concurrency:** an
  insert naming a nonexistent resource is refused typed **for every writer**
  (generated method, seed, admin edit, `--as-membership`); and a concurrent
  open-join **insert racing a teardown + resource delete** yields exactly one
  winner — never an orphan membership on a deleted resource.
- [base] **`insert` is field-bound like `patch`:** an insert carrying a non-axis
  column the matched transition does not name in `fields` is refused — in
  particular an open-join insert **cannot** seat its own far-future `expiresAt`.
- [base] **Teardown resolves the `lastHolder`/deletion deadlock:** deleting a
  resource row while memberships remain is refused typed; `clearForResource()`
  under the same-transaction **deletion witness** removes the whole roster
  **including the protected final `host`** and the delete then succeeds; the
  witness is unobtainable in a mutation that does not delete that resource, so a
  roster cannot be cleared out from under a live resource; and `lastHolder` still
  refuses the final-holder removal on **every** non-teardown path.
- [base] **Bootstrap is creation-bound, not emptiness-bound:** a mutation that
  did **not** create the resource cannot obtain the witness — asserted against
  an existing resource with **zero** memberships, a resource whose last member
  was just removed, and an **imported orphan** resource; the witness seats only
  the server-derived effective principal in the declared `bootstrapRole` (a
  caller-supplied principal or role is refused); it is single-use; and
  concurrent bootstrap attempts by different principals on one creation yield
  exactly one seat.
- [base] Decomposed permissions ops: the membership read is captured as ordinary
  snapshot-bound dependencies on **both** outcomes (asserted against the real
  commit-validation path, never a `Permission`-kind capture); **no
  application-returning membership read exists** — codegen emits no such method,
  so an attempt to surface absent/pending/wrong-role through the
  visibility-bypassing primitive does not compile; the acceptance sweep asserts
  the generated surface contains no membership-read export; the denial payload is **invariant** across absent/pending/wrong-role
  (byte-identical status and body across hidden-resource and non-public-policy
  probes; the evaluator performs the same index probe on every outcome, so the
  payload is not an oracle — **exact timing indistinguishability is a
  best-effort property, not a claimed guarantee**, and the residual is named
  here rather than asserted as a testable one); doctor carries the full trace; a forged role-denial throw stays untyped; unauthenticated
  behavior splits as pinned; `ctx.permissions` is refused in actions.
- [base] **Denial witness:** terminalization preserves the membership lookup's
  snapshot-bound dependency (ordinary handler-error capture disposal cannot
  erase or misbrand it); the trusted denial names at least the causing data
  version; and a stale deny cannot discharge an obligation floor newer than its
  witness (concurrent grant/revoke race, both directions).
- [base] Two declarations over one resource type: each bound helper consults only
  its declaration; rule-level OR composes; doctor names the satisfying
  declaration.
- [base] Default visibility on the enumerated surfaces: an undeclared-rules
  membership table is refused as a syncable-live primary table, a retained read,
  and a generated direct read; the preset opts in exactly the resource's members
  and **excludes pending roles**; `memberOf` excludes pending roles.
- [base] Impersonation seam: bare `--as-role` satisfies a global role only with
  exactly one declaring app-global declaration (two-declaration fixture:
  refused); qualified spellings resolve; scoped declarations are never satisfied
  by impersonation; `--as-membership` seeds a real row; one global-role case runs
  against a seeded row; doctor labels the impersonated path; an impersonated role
  is unreachable from a real session.
- [base] Global role gates an app surface; the same principal never satisfies an
  operator-plane authority with it; one-global-role-per-declaration holds.
- [base][+0055] Composition: a delegated agent sees role-gated data iff the
  effective user's membership allows it **and** the grant scope covers the call;
  the "person themself" conjunction accepts the direct human and rejects **both**
  agent shapes; an autonomous agent's own memberships behave exactly as a
  human's; a recovered agent's memberships resolve against the same principal id.
- [base][+0055] **`authorityCreating` composition:** a membership-writing function
  is unreachable through a delegated tier wildcard; with explicit consent, a
  delegated agent seats its own actor as `host`; the grant is revoked; the row
  **persists** with `grantedBy*` attribution; the agent's later autonomous access
  is explained by that row; and the target table without `provenance` refuses the
  `authorityCreating` marking.
- [base] **Provenance:** fill per writer class (invocation gate under user
  authority, delegated agent, `system` sweep, seed, import, hostOps); import
  **preserves** exported values; `grantedByGrant` is never joined; declaring
  `provenance` on an **already-populated** table backfills `preexisting` rather
  than refusing activation. Under `provenance: "full"`, the append-only
  transition log records **every** authorization-relevant write — including a
  **delete and a downgrade**, so an authorized kick remains attributable after
  the row is gone (creation-only attribution could not do this, which is why
  LLP 0055's `authorityCreating` requires `"full"`).
- [live] `hasRole`-gated query: two clients with different roles receive different
  results; the unauthenticated client is rejected fail-closed.
- [live] **Matcher path proven independently of the coarse event**, both
  directions: (a) visible-to-hidden — a delete/downgrade wakes the subscription
  through the delivery-obligation path with its causing data version witnessed;
  (b) **hidden-to-visible — an insert or role upgrade wakes a subscription that
  previously matched nothing** (the empty-result dependency), asserted with the
  coarse event's effect factored out (obligation-type inspection or
  declaration-scoped narrowing) so a broken capture cannot hide behind the global
  resnapshot; (c) a `requireRole`-gated query whose handler performs no other
  membership read wakes on the change; (d) **denied-at-subscribe is terminated,
  not parked** — a later grant does not revive it, and the declarative-filter
  shape is the one that does.
- [live] **Ordinary membership write is event 1:** a single insert/delete/
  role-change advances the global authorization version and projects the
  quarantine obligation; an attested-`incidental` update advances **no version
  and no coarse obligation** (a conservative matcher re-query is permitted — the
  claim is about the version path, not the result path); an auxiliary
  authorization column left out of `incidental` (e.g. `expiresAt`) advances the
  version and suspends an affected room; the expiry **sweeper** — running under
  `system` authority through the generated sweep form — materializes a timeout
  as an ordinary event-1 delete that wakes subscriptions and suspends rooms
  exactly like a user-authored kick.
- [live] Room binding: a kick **by delete and by downgrade** on a declared
  membership backing a protected room suspends delivery and reauthorizes from a
  fresh membership snapshot (0053's card-game fixture, driven through the
  declaration and its stable id).
- [live] Blast-radius measurement reports version advances and
  quarantine/resnapshot counts **per declaration and globally**.
- [retained — deferred with the 0008 semi-join amendment] A retained role-gated
  result is quarantined by the coarse event and released or deleted per
  disposition; offline revocation is bounded by the lease.

## Open Questions

- Role ranking: runtime hierarchy, or **compile-time sugar**
  (`hasRoleAtLeast(event, "cohost")` expanding to the explicit list in the
  compiled manifest)? (Leaning: the sugar.)
- Resource nesting: always an explicit second rule in v1 (leaning), or is there a
  case for parent-gates-child?
- Pending states: `pendingRoles` now carries the leaning (in the vocabulary,
  excluded from `memberOf` and the preset) — does a real events app confirm it?
- Multi-role: does one-row-per-pair hold, or does a real app force `multiRole`
  (uniqueness on the triple)? Expected to bite first at `scope: "app"`.
- **Declaration-scoped narrowing** (0053's): should it land with the semi-join
  lane as the first graduation target, given it needs no subject attribution and
  the per-declaration measurement is already in acceptance? (Leaning: yes.)
- Roster hygiene: membership rows whose **principal** is deactivated/deleted, or
  whose **resource** row is deleted — who owns the sweep or the convention?
- When declarative two-sided write rules land, do declared membership tables
  *require* them (fail-closed), or do the generated methods remain valid
  alongside?
- Should a principal-parameterized membership read ever exist for roster/admin
  flows, or does the ordinary visibility-governed table read cover them (the v1
  answer, since a bypassing public read is an existence oracle)?
- Is `lastHolder: "protect"` the right shape for the "don't strand a resource
  without a host" invariant, or should richer transition policy wait entirely
  for the declarative rules?
- May a protected room bind its predicate to **two** declarations (the OR shape
  blessed for queries)?
- Does a future teams/orgs model reuse this table shape, or need its own?
- When this RFC is accepted, does the LLP 0011 roles answer get ratified in the
  same change?

## Companion obligations

- **Dated LLP 0053 amendment** — the protected-query input profile classifies
  this RFC's new inputs: the **membership predicate node** as an admitted
  declarative expression kind (snapshot-bound, participating in the complete
  read/capture summary, with the pinned empty-result capture), and the **one new
  `ctx.permissions` membership read** as `DatabaseCaptured` (both outcomes) —
  denial being delivered by the already-classified `TerminalAuthorization` deny
  operation, so each primitive carries exactly one class. Without this amendment,
  0053's default-deny profile refuses every helper-gated protected query. The
  event universe, trusted-code enumeration, and `permissionBacking` machinery
  need **no** amendment. (LLP 0055's sealed-projection/auth-variable amendment is
  the sibling change to the same profile.) *Landed 2026-07-14 via ENG-24906 —
  LLP 0053 §Agent-auth protected-query inputs.*
- **Dated LLP 0011 addendum** — the roles open question answered ("app data in a
  system-recognized shape"); the membership-denial cause wired to the gated
  details.
- **LLP 0004 alignment** — generated spelling for `.membership()` (with
  `pendingRoles`, `incidental` and its floor, `provenance`, the `id:` pin),
  `v.principal()`, the declaration-bound helpers and `ctx.permissions.<decl>.*`,
  the **generated write methods and raw-write refusal**, the bootstrap helper,
  role-literal unions and load-time rejections, and the optimistic-parity kit
  contract.
- **LLP 0008 amendment (follow-on)** — the syncable-subset extension for the
  membership semi-join, the finer row-field capture, **and retained eligibility
  for role-gated queries** (which v1 does not claim).
- **LLP 0024 amendment** — the `--as-role` exactly-one-declaration rule, the
  declaration-qualified spelling, and `--as-membership` as row-seeding sugar.
- **LLP 0013 note** — room membership predicates bind to declarations by stable
  id; downgrade is a kick.
- **LLP 0012 registrations** — the vocabulary/uniqueness/immutability/nullability/
  activation/raw-write diagnostics, the role-denial details schema (invariant
  public payload; full doctor variant), and the unique-index manifest capability.
- **LLP 0055 composition** — the `authorityCreating` marker (0055 defines;
  this RFC's `provenance` is its precondition).

## Status

**Review** — moved from `Draft` by the author (Charlie, 2026-07-13), who is the only party LLP 0005 permits to make that call. Refined through **thirteen dual-family review rounds** (fresh Claude
Fable 5 Max and GPT gpt-5.6-sol ultra reviewers each round, none with memory of
prior rounds); all twenty-two reviews are recorded verbatim with provenance in
`llp/reviews/0056-scoped-roles-and-memberships.{fable,codex}.md`.

**Author ruling, 2026-07-13 (Charlie): altitude ratified.** This is an RFC, not a
protocol spec — design intent is pinned here, and protocol rigor (the normative
predicate AST and its SQL lowering, denial linearization mechanics, the
transition-ledger schema) lands at implementation time
(§Protocol obligations deferred to implementation), the same call ratified for
the parent umbrella in [LLP 0039](./0039-auth-vertical-slice.rfc.md).

The loop earned its keep. It caught: the original claim that ordinary membership
writes need no new mechanism (they are LLP 0053 **event 1**, and the coarse blast
radius is now owned rather than hidden); a `SNAPBACK_AUTH_ROLE_DENIED` code that
would have sat outside 0053's *closed* trusted-denial enumeration and wedged live
queries in quarantine; the `CapturedReadKind::Permission` trap — verified dead in
both the matcher and commit-time validation — which would have made two pinned
behaviors silently false; an `incidental` attestation that could suppress event 1
for **role changes**, killing downgrade-driven room kicks; a `callerState` payload
that was a membership-existence oracle; and — found independently by both
families — a `lastHolder` invariant that is **race-defeasible**, since two
concurrent removals of the final two hosts each see the other and both pass.

**One product boundary remains open** and is the natural thing to settle at
implementation time: how much authorization expressiveness belongs in v1. The
declared transition matrix (§Writes) now covers seat/promote/kick, the
self-transitions every app needs (leave, accept-invite, decline), `patch` for
non-authorization columns, and the `lastHolder` invariant. It deliberately does
**not** cover **cross-declaration authority** — an app-global `moderator` kicking
from any channel is currently unspellable — which is named in §Non-Goals with a
proposed spelling (`by: ["appRoles:admin"]`) rather than left to be discovered at
authoring time.

The current revision incorporates the round-12 findings; those changes are **newer
than the last review**. Builds on LLP 0011's rule model and LLP 0053 (Accepted);
composes with LLP 0055 but neither depends on the other landing first. Where this
document restates a contract LLP 0011, 0039, or 0053 pins, those documents win.
