# LLP 0056: Scoped roles and memberships

**Type:** RFC
**Status:** Review
**Systems:** Auth, Sync, Storage, API, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-13
**Revised:** 2026-08-17 (companion pointer to LLP 0013's shipped
membership-backed ephemeral lowering and its role-narrowing boundary).
2026-08-15 (bounded atomic initial rosters on generated resource
bootstrap; transition-checked, consent-gated, and still one host command).
2026-08-01 (the receipted trusted-import lane — see the
dated amendment: fixture seats through the `Seed` writer class in the
LLP 0109 versioned seed, reset retiring runtime seats under this
document's event-3/declared-restore taxonomy; commissioned by LLP 0100
§8b, closes the 0137 A3 seed/reset finding).
2026-08-01 (declaration-owned self-projection: the reserved
native live query `_snapback.myMemberships` lists the caller's own seats
with pinned empty-range capture — see the dated amendment; closes the
0137 A2 roster-mirror finding). 2026-07-21 (delivery-lane boundary enforced in code: `live_delta`
candidacy and `compute_live_delta` now fail closed on non-empty
`membership_filters`, closing the LLP 0067 §F2a over-delivery/visibility-freeze
discrepancy; the L4 oracle extends to `NoChange` settles). 2026-07-18 (the generated write surface gains host-resolved
`setSelfRole`/`removeSelf`/`patchSelf`: app code can accept, leave, or patch its
own private roster row without learning its id; the unchanged transition
matrix remains the sole authorizer). 2026-07-17 (strengthened shipped-demo acceptance: separate Alice,
Bob, and Eve live namespaces now drain real durable frames, validate exact
scope/subscription identity, ACK Bob's hidden-to-visible membership
invalidation, prove Alice/Bob announcement fanout, and keep Eve empty).
2026-07-16 (landed the public atomic `bootstrap()` authoring path:
the generated mutation surface now returns a branded fresh resource id while
the host commits the resource and protected initial holder together; an
explicit bootstrap-only function classification preserves the structural
non-authority-creating carve-out while the dynamic host gate refuses every
ordinary membership write). Earlier: 2026-07-16 (reconciled implementation status after the public
authoring slice landed: codegen now exposes nominal `v.principal()` / `v.id()`,
closed `.membership()` declarations, declaration-bound `memberOf` / `hasRole`,
generated read-only permissions and mutation-only membership contexts, nominal
resource-reference serialization, and fail-closed authoring diagnostics; the
runtime activation, transition, raw-write, `lastHolder`, provenance, and
authorization-invalidation guarantees are enforced rather than decorative).
Earlier: 2026-07-15 (G6 prerequisite: landed the mutation-only,
declaration-bound `ctx.membership.<decl>.{insert,setRole,remove,patch}` bridge;
its closed host-owned writer carrier remains separate from raw writes through
direct, nested, replay, and dry-run commit paths). Earlier: 2026-07-14
(round-16 dual-family revision: **reconciled the
eligibility divergence this session's LLP 0055 round-6 edit created** — LLP 0055
now owns the ineligibility predicate (durable recoverability), this document
consumes it rather than restating "not permanently ended", the shipped
G1-treats-absence-as-eligible gap and its A-active/B-nonexistent counterexample
are named a joint LLP 0055/0056/G1 defect obligation, and the validation row no
longer claims lifecycle reads are "captured alongside" (it routes them through
the shared final-state evaluator, `Auth` captures unused); **closed the
`TableManifest` fail-open outer boundary** (a typo'd `membershp` erases the whole
declaration) alongside the inner-struct `deny_unknown_fields`; specified the
**generated reverse `(resource, role, principal)` covering index** the holder
query needs (M1 has only `(principal, resource)`); pinned the **activation
validator phase order** (DDL → seed → validation → generated indexes) so a raw
duplicate cannot preempt the typed diagnostic; corrected the **stale "no
deactivation state exists yet"** claim (G1 deactivation has landed, so the
row-counting scan is an active gap); and pinned a manifest **`Id<table>`
representation** as an explicit M3 prerequisite. Round-16 triage folded into
§Status.) 2026-07-14 (round-15 dual-family revision: **corrected two round-14
overclaims against shipped code** — eligibility drops the hard existence leg and
now matches LLP 0055 and landed G1 (absent-from-catalog is *eligible*; no
invented "principal catalog"; dev impersonation asserts existence by fiat), and
the `lastHolder` lifecycle leg is an **authoritative commit-stage evaluation**
(auth-catalog rows carry no app `_version` and `Auth` captures are ignored by
commit validation), not "the same machinery"; **partitioned referential proof**
so bootstrap uses the creation witness rather than an impossible row-capture;
pinned **`deny_unknown_fields`** on every membership object (a dropped
misspelling broadens auth); **retensed the capability gate** to state plainly
that nothing refuses production activation today and made it first among the
M1-completion obligations, which now also include the `expiry` field-type check
and the rename diagnostic; assigned **denial linearization to M3** with
`requireRole` capability-gated until it lands; removed the **operator-plane
cross-declaration workaround** (it breaches LLP 0055's plane wall) and made the
operation plainly v1-unavailable; pinned **pending-role caller-class**
assignment and the **caller-written** `fields`-coverage scope; named the
HostPlan create/delete cliffs for protected resources; completed the Related
header.) 2026-07-14 (round-14 dual-family revision: the transition grammar
is now a **per-op table** — admissible caller classes, required/optional/
forbidden `from`/`to`/`fields`, fail-closed omission semantics, and
load-time reachability refusals — closing the omitted-`to` self-seat reading;
`lastHolder` eligibility adds **principal existence** and a **captured
lifecycle read** so deactivate-vs-remove races linearize at commit in both
orders; activation is pinned to **one final-state validator** (post-DDL,
post-seed, every deployment path) with `resourceTable` resolution required and
an absent roster validating as empty rather than skipped; `.membership()`
activation is **capability-gated until its enforcement milestones land** (no
fail-open activation); expiry pins an epoch-ms field type and a **directly
cron-bound generated sweep action** (call-graph reachability is not a
diagnostic); the writer seam pins a closed, unforgeable **writer-authority
carrier** taxonomy as an M2 prerequisite; declaration-id durability gains a
**persisted binding registry** obligation; the global-role first-holder path
and the insert resource-capture liveness cost are stated plainly.)
2026-07-13 (refined through thirteen dual-family review rounds; see
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
**Related:** LLP 0000, LLP 0004, LLP 0008, LLP 0011, LLP 0012, LLP 0013, LLP 0019, LLP 0024, LLP 0037, LLP 0039, LLP 0051, LLP 0053, LLP 0055, LLP 0057, LLP 0058, LLP 0059, LLP 0060

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
  moderator holds no channel membership and resolves to `"none"`. This operation
  is simply **unavailable in v1** — and the answer is *not* to route it through
  the operator plane, because LLP 0055's plane boundary is a hard wall and
  §Global roles pins that an app role never satisfies operator authority; handing
  an app moderator operator credentials to do routine moderation would breach
  exactly that wall and bypass the transition policy this RFC exists to make
  structural. An app needing cross-declaration moderation today either models the
  moderator as a real per-resource membership (seated by an app flow) or waits
  for the qualified spelling (`by: ["appRoles:admin"]`, the natural extension,
  named as an open question) or the declarative write rules — stated here so an
  adopting app meets this cliff in the document rather than at authoring time.
- **HostPlan membership writes in v1.** The shipped mutation IR's `Get` is a
  point read by id and its `Guard` carries an app-supplied code; the codegen's
  own taxonomy already classifies "membership guards over non-id keys" as
  outgrown-IR. So HostPlan cannot authorize a membership write — and therefore
  **every generic HostPlan write form targeting a declared membership table is
  refused, typed** (§Writes). Role-managed membership writes are Ibex-mutation
  work; the declaration-bound HostPlan membership step is named follow-on
  surface. **Two consequences follow, named so an app meets them here rather
  than at authoring time:** a HostPlan write cannot *create* a
  `lastHolder`-protected resource (bootstrap requires a same-transaction
  membership seat HostPlan cannot perform), and it cannot *delete* one (teardown
  requires `clearForResource()`, a membership write) — so protected resources
  are Ibex-mutation-only to create and delete in v1, and a HostPlan
  `Insert`/`Delete` on such a resource table is a typed refusal, not a silent
  partial.
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
  // provenance: "creation",      // host-filled attribution: "creation" | "full"
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
*durably referenced* ids, not about every string ever typed.) Detecting a
rebind takes **state**: a manifest-local collision check cannot see a
cross-activation rename, so the refusal rests on a **persisted binding
registry** — declaration id → table, recorded the first time an id is durably
referenced and consulted at every subsequent activation. That registry lands
with the first durable-reference producer (M5's provenance columns and
transition log); **until it exists, no durable consumer may reference a
declaration id**, and continuity rests on explicitly pinned `id:`s — which is
why the rename-without-pinned-id diagnostic is load-bearing now, not later. Role strings
compare by **exact decoded value** (no case folding, no Unicode normalization —
two writers must never disagree about whether `"Host"` is declared); control
characters are rejected, and ASCII-case-confusable near-duplicates (`"Host"`
beside `"host"`) are refused as a typed manifest error
(`SNAPBACK_MEMBERSHIP_CONFUSABLE_ROLES`) — broader Unicode-confusable
detection is a named lint follow-on, not a shipped claim. `roles` and
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
  **true unique** composite index (`IndexManifest.unique`, now landed).
  Exactly-one-wins on concurrent same-pair inserts is
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
  door. Three pins make "fail-closed" checkable rather than aspirational:
  the validator judges the **transaction's final state** — after DDL and after
  any same-activation seed — through **one shared entry point invoked by every
  deployment path** (dev apply, same-mode sessions deployment, staged
  activation, import); a scan that runs before the data it must judge exists
  validates nothing. A `scope: "resource"` declaration must carry a
  **resolvable `resourceTable` binding to an active table** — absent,
  misspelled, or dangling is a typed activation refusal, never a silently
  skipped check. And a membership table with **no physical rows or not yet
  created** validates as an **empty roster**, never as "nothing to check": a
  `lastHolder` declaration over a populated resource table therefore refuses
  activation unless the same activation seats its holders (brownfield adoption
  seeds rosters), instead of activating resources that no eligible holder
  protects. The final-state validator now implements this pin on every
  activation path, including absent-roster and required nominal
  `resourceTable` handling.
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

  **A pending-role holder is a caller class like any declared role, never
  `"none"`.** A principal holding an `invited` (pending) row for the resource
  *holds a membership*, so class 2 assigns their pending role and class 3
  (`"none"`) never matches them; `by` may name pending roles exactly as it names
  full roles (M1 already checks `by` against `roles ∪ pendingRoles`). This is
  the disjointness rule at the one edge it could be misread: "not a member" in
  §Rule helpers governs `memberOf`/the member-list preset (which exclude pending
  roles), not caller-class assignment, where holding *any* row — pending or full
  — takes you out of `"none"`.

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

**The per-op grammar, pinned — closed and fail-closed.** The matrix admits no
semantically undefined manifest: each op admits exactly the fields below,
omission semantics are stated rather than inferred, an **empty array is a
manifest error** (canonical sets are non-empty), and a field an op does not
admit is a typed manifest error rather than dead weight a later milestone must
invent a meaning for. Closed here is literal: every membership declaration
object — `MembershipManifest`, `MembershipTransition`, `MembershipLastHolder`,
`MembershipExpiry` — **rejects unknown fields** (`deny_unknown_fields` in Rust
and `additionalProperties: false` in the generated schema and authoring kit),
because a security grammar that *silently drops* a misspelling is worse than one
that rejects it: a typo'd `frmo` discarded from a `setRole` transition leaves
`from` omitted, which means "any current role" and **broadens** authorization,
and a typo'd `resourceTabel` or `lastHodler` erases a whole guarantee.
**Critically, closing the four inner structs is not enough — the enclosing
`TableManifest` must close too** (or carry an equivalent versioned
must-understand mechanism). That outer closure is now implemented; without it a typo'd
`"membershp": {…}` silently erases the *entire* `.membership()` declaration
before any validation or declaration-derived capability gate can observe it,
leaving an ordinary raw-writable table — the exact fail-open outcome the closed
grammar exists to prevent. The membership structs and `TableManifest` now carry
`deny_unknown_fields`, the generated schemas close the same objects, and
adversarial parse-through-activation tests cover the outer `membershp` as well
as `frmo`/`resourceTabel`/`lastHodler`/unknown expiry fields.

| op | admissible `by` classes | `from` | `to` | `fields` |
|---|---|---|---|---|
| `insert` | declared roles, `"none"` — never `"self"` (no target row exists; self-ness is the `target` axis) | **forbidden** — no old role exists | **required**, non-empty | optional — omitted binds the insert to **axes + role only**, fail-closed; any other inserted column must be named |
| `setRole` | declared roles, `"self"` | optional — omitted means **any current role**, stated not guessed | **required**, non-empty | **forbidden** — `setRole` writes the role column and nothing else |
| `remove` | declared roles, `"self"` | optional — omitted means any current role | **forbidden** | **forbidden** |
| `patch` | declared roles, `"self"` | optional — omitted means any current role | **forbidden** — `patch` never writes the role column | **required**, non-empty — a patch naming no columns writes nothing |

`target` is required on every row. **Unreachable rows are refused at manifest
load**, not left as silent dead policy — the class-assignment rule makes the
refusals decidable: on the target-row ops (`setRole`, `remove`, `patch`) a
**role class combined with `target: "self"`** can never match, because a
caller who is the target is class `"self"` and `"self"` wins; on `insert` a
**role class with `target: "self"`** can never match either, because a caller
inserting *their own* row holds no row over that resource (uniqueness), so
their class is `"none"` — self-join is spelled `by: ["none"], target: "self"`,
exactly as the example declares, and the insert paragraph above is the
normative reading (`by` is computed over the resource; `"self"` never names an
insert class). This is the generalization of the narrower rule already stated
("a transition whose `by` class cannot be reached is a manifest diagnostic").

**Matching is deterministic because transitions authorize rather than
select.** A write is admitted iff at least one declared transition matches
every host-derived fact — op, caller class, target axis, old role ∈ `from`
(or `from` omitted), new role ∈ `to` — **and**, for `insert` and `patch`, that
same matched transition's `fields` covers **every caller-written** non-axis,
non-role column. (Host-filled `provenance` columns — `grantedBy*` — are written
by the host, not the caller, and no transition names them; the coverage rule is
about what the *caller* supplied.) Coverage is judged per single transition,
never unioned across transitions; overlapping transitions are therefore permitted and need
no precedence rule — only class assignment needed one, and it is total.

The generated methods are therefore thin and unforgeable:

```ts
const eventId = await eventMembers.bootstrap(
  { title: "Launch" },
  [{ userId: guestId, role: "guest" }],
) // resource + host seat + transition-checked initial roster
await eventMembers.insert({ eventId, userId, role: "invited" })  // policy decides
await eventMembers.setSelfRole(eventId, "guest")                // accept own invite
await eventMembers.removeSelf(eventId)                           // leave / decline
await eventMembers.patchSelf(eventId, { notifyPrefs })           // own columns
await eventMembers.setRole(memberId, "cohost")                  // other-target promote
await eventMembers.remove(memberId)                              // other-target kick
await eventMembers.patch(memberId, { expiresAt: t })             // other-target renewal
```

The three `*Self` forms are declaration-bound private resolvers. For resource
scope they take the resource id; for app scope they omit it. The host combines
that resource with the effective principal, resolves the unique membership row
without returning its id or an existence oracle about anyone else, and feeds
the result into the exact same `setRole`/`remove`/`patch` planner. A missing own
row is `SNAPBACK_MEMBERSHIP_SELF_NOT_FOUND`; a matching transition is still
required. The id-addressed forms remain for host/admin and application flows
that already possess a row id; this RFC does not add a general private-roster
resolver.

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

**Referential proof is partitioned by whether the resource already exists**, and
mandatory row-capture applies only to the pre-existing case. A membership insert
against a resource row **already committed** captures that row (existence-only
semantics, below). A membership insert against a resource **created earlier in
the same effect batch** — the bootstrap case — has no committed row and no
`_version` to capture (it is a buffered insert), so its referential proof is the
**creation witness plus final-state validation**: the host has seen the resource
row appear in this transaction, and commit-stage validation confirms it is
present at commit. Row-capture and the creation witness are **alternative
proofs of the same fact** (the resource exists and persists through commit), not
layered requirements — an earlier reading that demanded a row capture on *every*
insert would have made bootstrap unspellable, since the witnessed same-
transaction resource row cannot be version-captured. Seed and import order
resource-before-membership within their batch and take the pre-existing path;
read-your-writes within one Ibex mutation takes the creation-witness path.

For the pre-existing case, the capture's **semantics are existence-only** — the
insert needs the resource to exist and keep existing through commit, not any of
its other columns — but v1's representation is the ordinary version-checked row
dependency, and the gap between the two is a **liveness cost, owned**: any concurrent *update* to
the resource row spuriously invalidates the insert at commit, and join-heavy
moments are exactly when hosts also edit the resource (lobby settings, event
details). Correctness is unaffected; the loser retries under LLP 0004's
client contract, and the kit guidance is one sentence: **retry commit-conflict
refusals; the refusal that survives retry is the policy answer** (the
`lastHolder` race loser re-runs into the real typed refusal; the
insert-vs-edit loser simply succeeds). The named refinement is an
**existence-scoped captured-read kind** — the present-row twin of
`MissingRow`'s current-state check — invalidating on delete but never on
update, which keeps the insert-vs-teardown linearization while shedding the
false conflicts; it rides the semi-join/capture follow-on, not v1.

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

So the unit is the **eligible holder**, and **LLP 0055 owns the ineligibility
predicate** — this document consumes it rather than restating a narrower one, so
the two documents that co-own this invariant cannot drift. LLP 0055 §Ending
authority defines it as **durable recoverability**: a holder is ineligible if
its principal is deactivated (LLP 0055 `deactivated_at`) **or** provably unable
to ever re-authenticate (an unowned agent with no live credential family and no
recovery key). The row-level check *can* decide this for the credential/recovery
facts LLP 0055 owns; what it cannot decide — a *live, recoverable* principal
that is merely idle or unreachable — is the roster-hygiene residual (a named
open question), and that residual is the only thing "no row-level invariant can
detect" covers. A future human account-closure state (the LLP 0057–0060 surface
is growing one) joins LLP 0055's predicate the same way, and whichever document
defines such a state owes the symmetric refusal from its side.

**Non-existence is handled by LLP 0055's recoverability leg, not by a separate
existence refusal in this document.** A never-existed principal id is, by
definition, unable to authenticate — it has no credential family — so LLP 0055's
predicate already makes it ineligible; this document does not add a second,
mode-fragile existence check that would contradict dev impersonation (where the
effective principal is a client-asserted string with no catalog row) or the
shipped G1 code. Note the shipped gap this creates and the counterexample it
admits until closed: **landed G1 excludes only deactivated principals and
treats catalog-absence as eligible** (`crates/snapback/src/storage/auth_agents.rs`,
`has_other_eligible_holder`), so a sessions resource held by active A and
nonexistent B currently lets A be deactivated (B counts eligible), stranding the
resource under a B that can never act. Making G1's check the durable-
recoverability predicate LLP 0055 now specifies — not "not deactivated" — is a
**joint LLP 0055 / LLP 0056 / G1 defect obligation**, with the A/B counterexample
in acceptance. There is no universal "principal catalog" this document invents;
the authoritative store is per mode, and the predicate consults only the
recoverability facts LLP 0055 owns. The mechanism:

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
snapshot-bound range dependency over a `(resource, role, principal)` index,
validated at commit exactly like the membership lookup.** M1 generates only the
unique `(principal, resource)` index, which cannot serve a resource-leading
holder query — G1 already runs `WHERE resource = ? AND role = ?` with no
matching prefix index, risking full membership scans under an `IMMEDIATE` writer
transaction — so a **generated reverse covering index `(resource, role,
principal)`** (with a reserved name, migration behavior, and app-scope
treatment) is a named M1-completion obligation; the holder-set range dependency
and G1's holder query both key on it. The first removal
commits and changes that range; the second fails commit-time read-set validation
and is refused, typed. Exactly one succeeds. This rides the same commit-validation
machinery the uniqueness invariant and the stale-role check already use — no new
mechanism for the membership half, and
no invariant that holds only under serial execution.

Eligibility makes the invariant **two-legged**, and the second leg cannot ride
the app's captured-dependency machinery: the counted principals' lifecycle rows
live in the protected auth catalog (`_auth_users`, LLP 0055 agent records),
which carry no app `_version` column and whose `Auth`-kind captures commit
validation deliberately ignores (`crates/snapback/src/storage.rs`, `CapturedReadKind::Auth`).
So this is **not** "the same machinery, no new mechanism" — it is an
**authoritative commit-stage evaluation** of the complete invariant inside the
serialized auth transaction, exactly the shape the landed G1 deactivation check
already uses (`crates/snapback/src/storage/auth_agents.rs`, evaluated under an `IMMEDIATE` auth
transaction). Both writers evaluate the final-state predicate — remaining
eligible holders of the protected role — at the serialized commit, so the
two-step schedule cannot compress into a race: **deactivate A ∥ remove B** over
the final two eligible holders resolves to exactly one commit and one typed
refusal in **either commit order**, because the second writer's commit-stage
evaluation observes the first's committed effect. This is the mechanism LLP
0055's deactivation refusal uses from its side over the same declaration, so the
cross-invariant race serializes identically regardless of which check runs
first. The membership `(resource, role)` holder-set read remains an ordinary
captured range dependency (that half *does* ride the app machinery and needs no
commit-stage evaluation); only the auth-catalog lifecycle leg is the
commit-stage check. Owning this commit-stage invariant jointly across M2 (this
document's writers) and the landed G1 side is a named protocol obligation.

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

The same generated command may carry a bounded initial roster:
`bootstrap(resourceValues, initialMembers?)`, with at most 64 additional
members. The creator seat is still host-derived and mandatory. Each additional
member omits the resource axis (the host injects the fresh id), names a unique
principal distinct from the creator, uses the declared role vocabulary, and
must match an ordinary declared `insert` transition as an `other` target with
the creator's `bootstrapRole` as the caller class. The host evaluates every row
against the same eligibility, field-coverage, vocabulary, and provenance rules
as an ordinary generated insert, then commits the resource and entire roster as
one storage plan. Any invalid or unauthorized seat refuses the whole command
and writes nothing. This is not sequential authority composition: every added
seat is authorized from the creator's bootstrap role, never from another seat
in the same list.

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
opts in with `expiry: { field, onExpiry }` — where `field` names an
**optional epoch-milliseconds timestamp column** (the corpus's `*AtMs`
convention; declaring any other column type is a manifest error, so a
malformed value is unwritable rather than un-sweepable, and a null or absent
value means **this row does not expire**) — and the **only** system-authority
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
(§Non-Goals). The linkage is therefore **manifest-visible, not inferred from
app code**: codegen emits, alongside the sweep mutation, a **generated sweep
action** — the cron-targetable wrapper, calling the sweep via `ctx.runMutation`
under inherited `system` authority (LLP 0039's inheritance rule), never
declared `authenticated` (system carries no user) — and the absence diagnostic
checks that **some cron entry's target is that generated action**: a direct,
closed linkage the manifest can decide. An app-authored action that happens to
call the sweep does **not** satisfy the diagnostic — call-graph reachability
through arbitrary Ibex code is not statically decidable, and a diagnostic that
guesses is worse than none. 0053 builds no deadline
scheduler, so the gap between `expiresAt` and the sweep is the app's cadence
choice — stated the way 0053 states its lease window. **Cadence is the app's
choice; _absence_ is a bug, and the manifest says so:** a declaration that opts
into `expiry` with no cron entry targeting its generated sweep action is a typed
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

As shipped when this RFC was drafted — the Implementation-status paragraph
below is the current column — the filter IR
is single-table (`QueryPlan` has one `table`;
`ValueExpr` has no relationship/EXISTS form and one auth variable,
`auth.userId`); `TableManifest` carried no membership metadata and
`IndexManifest` no uniqueness flag (both now landed); `FieldManifest` has an `optional` flag
(hence the non-null pin above); the draft baseline had no `ctx.permissions`
host operation (the declaration-bound operation has now landed);
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

**Implementation status (current 2026-07-16).** The public, enforced vertical
slice is now present: closed declarations and final-state activation validation;
nominal principal/resource types; transition, raw-write, `lastHolder`, expiry,
and provenance enforcement; declaration-bound query predicates and
`ctx.permissions`; mutation-only sanctioned membership writes including atomic
resource bootstrap; authorization invalidation; generated TypeScript contexts;
and an acceptance-tested RBAC demo.
The remaining named follow-ons are the cron-to-sweep binding,
`--as-membership`, the persisted rename diagnostic, and the incremental
semi-join/retained-offline lane. The dated milestone notes below explain the
order in which those guarantees arrived; “did not land” in those notes refers
to that milestone's original boundary, not the current tree.

*M1 landed 2026-07-14 via ENG-24907* — the **schema
surface**: the `.membership()` metadata on `TableManifest` (declaration model,
stable id with manifest-global uniqueness, closed exact-decoded vocabulary with
the reserved-name / `:` / control-character / confusable / disjointness traps,
the `lastHolder`/`expiry`/`incidental`-floor/transition-shape declaration
validation), `v.principal()` as a `FieldType`, an `unique` flag on
`IndexManifest` driving the generated true-unique `(principal, resource)` index,
and the **fail-closed activation scan** over existing data (vocabulary,
nullability, uniqueness, referential integrity, and the `lastHolder` holder
presence). At that milestone, M1 deliberately did **not** land: the transition-matrix execution,
generated write methods, and raw-write refusal (M2); the rule helpers and
`ctx.permissions` read (M3); the matcher/predicate-IR and invalidation wiring
(M4/M5); and the provenance columns/log (M5). The two then-open M1 boundaries
are now closed: activation counts LLP 0055-eligible holders rather than rows,
and codegen derives a required nominal `resourceTable` binding from `v.id(...)`
instead of trusting a hand-written string.

Round 14/15 named these **M1-completion obligations**, all due before M2 and
unshipped at that review point: the **`deny_unknown_fields`** closure on every membership
object (above); the per-op grammar refusals (§Writes — M1 requires `op`/`by`/`target` by
deserialization and rejects unknown columns/axis-patches, but leaves `from`/`to`/
`fields` optional in the wire shape with no per-operation admissibility,
empty-array rejection, or reachability check); the `resourceTable` resolution
requirement and the absent-table-is-an-empty-roster rule (the shipped scan skips
both cases); the final-state single-validator ordering with **explicit phases**
(the shipped staged-path scan runs before DDL and seed, and the same-mode/network
paths apply DDL and seed without invoking it at all — the fix is a pinned phase
order **table/column DDL → seed → final-state validation → generated
indexes/constraints**, so the generated unique index is created *after*
validation and a raw SQLite duplicate failure cannot preempt the typed
diagnostic; alternatively, early constraint failures are explicitly mapped to
the typed diagnostics); the **reverse `(resource, role, principal)` covering
index** (§Writes — M1 generates only `(principal, resource)`, which cannot serve
the holder query); the **`expiry` field type/optionality** check (the shipped
validation checks field-exists, non-axis, and `onExpiry` only — not the epoch-ms
type the design pins); the **rename-without-pinned-id diagnostic** (implementable
now from the durably stored previous manifest; the shipped code checks only id
syntax and manifest-local collision); the **eligible-holder (recoverability)
activation check** replacing row-counting (active gap, since deactivation has
landed); and the capability gate below.

**Activation is capability-honest.** The fail-open window identified by the M1
review is closed: activation validates the final post-DDL/post-seed state, and
the central storage boundary enforces the transition matrix, raw-write refusal,
`lastHolder`, expiry, provenance, referential integrity, and invalidation on all
ordinary writer paths. Production therefore does not accept a decorative
`.membership()` guarantee; a declared feature either binds or activation fails
with a typed diagnostic. The generated public authoring surface is validated
against the same manifest grammar, so a typo, unknown nominal target, or
resource-type mismatch is refused before artifacts are emitted.

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

At M3's original landing, it deliberately did **not** land: the matcher/room invalidation wiring beyond
the conservative capture (M4/M5); the incremental membership semi-join lane and
retained/offline role-gated reads (the named LLP 0008 follow-on); and the
generated per-declaration authoring spelling for the helpers and
`ctx.permissions.<decl>`. The public codegen spelling, matcher/invalidation
integration, and strict nominal resource-type check have since landed. Row-field
and argument references now carry and validate the declared target table; an
unresolved declaration, bad row field, unknown id table, or cross-table mismatch
fails artifact generation or runtime load.
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
to the **eligible**-holder predicate now that G1 has landed. The 2026-07-15 G6
prerequisite lands the generated JS authoring methods and
`ctx.membership.<decl>.*` host-op dispatch, carrying the resolved invocation
writer separately from raw buffered writes through direct, nested, replay, and
dry-run paths. At M2's original landing it deliberately did **not** land: the cron→sweep wiring and
`--as-membership` (the remaining LLP 0004 codegen/bridge follow-on); the
rule helpers and `ctx.permissions` read (M3); the matcher/predicate-IR and
invalidation wiring (M4/M5); and the provenance columns/log (M5). Those latter
runtime and provenance layers have since landed; cron→sweep and
`--as-membership` remain follow-ons. One residual is
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

> **Boundary enforced in code (2026-07-21).** LLP 0067 §F2a found this lane
> assignment was design intent only: the `live_delta` path admitted
> membership-gated plans (candidacy never checked `membership_filters`, row
> classification evaluated only ordinary filters, and membership-table-only
> commits settled as `NoChange` — freezing both visibility directions,
> including revocation, with the L4 oracle unreachable on that path). The
> repair pins the lane fail-closed at both layers: delta candidacy in
> `notify_live_subscriptions` skips plans with non-empty `membership_filters`,
> and `compute_live_delta` independently returns `Replace` for them
> (belt-and-suspenders, each with an `@ref` here); the L4 debug convergence
> assertion now also runs at `NoChange` settles, so a swallowed transition
> fails tests instead of freezing silently. Re-admitting semi-join shapes to
> the delta lane remains the named follow-on above, now gated on a certified
> semi-join evaluator plus bidirectional membership-visibility regression
> coverage.

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
and is a load-time error. This nominal resource-reference equality is now
represented end to end: the authoring kit exposes `v.id(table)` and
`v.principal()`, Rust `FieldType::Id` retains the target table, argument
references serialize `{ path, resourceTable }`, and codegen plus runtime load
validation reject unknown or mismatched targets. A plain string therefore
cannot pose as `Id<"events">`.
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

M3 owns the exact denial linearization mechanism: `requireRole` preserves the
membership lookup's snapshot-bound dependency, emits only the existing trusted
terminal authorization denial, and cannot be forged by application code. That
mechanism has landed with the imperative `ctx.permissions` read; it is no longer
a capability-gated placeholder. The ordinary denied-at-subscribe outcome is
therefore fixed as described below, including its coherent witness and terminal
retirement behavior.

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
- **Rooms.** Because membership writes are event 1, a kick by delete — and a
  role downgrade, which fires the same barrier but re-grants under the shipped
  role-blind row-existence check (downgrade-as-kick is the LLP 0013 2026-08-17
  amendment's role-narrowing follow-on) — on a resource backing a protected
  ephemeral room ([LLP 0013](./0013-ephemeral-realtime-state.rfc.md)) advances
  the version and projects room-authority suspension and fresh
  membership-snapshot reauthorization, exactly 0053's card-game fixture. The
  declaration gives the
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

**The first global holder has no witness path, and the document says so
rather than leaving it to be discovered.** The app singleton has no creation
event, so there is no bootstrap witness to spend — `bootstrapRole` on a
`scope: "app"` declaration is a manifest error, the same dead-policy class as
`lastHolder`'s refusal above — and an open self-seat transition
(`by: ["none"], target: "self"`) would make *every* authenticated principal an
`admin`, not the first one. Seating the first app-global `admin` therefore
goes through the **privileged non-invocation writers** — seed, admin data
edits, `--as-membership` — as a stated design fact, not an accident: the v1
answer to "first signup becomes owner" is a seeded or operator-seated row, and
whether a blessed *product* path should exist is a named open question.

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

**Creator-only bootstrap writes do not trigger the marker**, and the reason is
structural rather than a convenience carve-out: without an initial roster the
bootstrap capability seats **only the server-derived effective principal**, **only** under a
same-transaction creation witness, **only** in the declaration's
`bootstrapRole`, and only once (§Writes). It cannot name a principal argument,
so the self-seating escalation the marker exists to gate is unspellable through
it — a delegated agent creating an event on the user's behalf seats *the user*,
never itself. Without this carve-out every "create an event / document / game"
mutation would become non-wildcard-grantable, which is consent fatigue for the
most common delegated operation and buys no safety. Supplying any initial
member names another principal and therefore makes the function
`authorityCreating: true`; a generated wrapper cannot clear that marker. A
function that performs a bootstrap write **and** any other membership write is
marked, as usual.

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
point). The fill rule and the preservation rule compose without ambiguity: a
row whose export carries provenance values keeps them; a row imported
*without* them is filled with the tag `import`. The transition log obeys the
same continuity rule — exported log rows import verbatim, preserved rows
append nothing new, and an import-*created* membership row appends an
`import`-class entry, because **every writer class appends**: the log's value
as the `authorityCreating` audit substrate is exactly that no writer is off
the books. Adding a `provenance` declaration to an **already-populated** table
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
4b. **The `lastHolder` commit-stage invariant, jointly owned.** The eligible-
   holder final-state predicate is evaluated at the serialized commit inside the
   auth transaction (not via app captured-dependencies, which ignore auth-catalog
   rows) by **both** this document's M2 writers and the landed LLP 0055 G1
   deactivation side, so deactivate-vs-remove races over the final eligible
   holder serialize identically regardless of which check commits first. Pinning
   the shared commit-stage evaluation point and proving both commit orders
   (including catalog-absence and same-transaction lifecycle changes) is a joint
   M2/G1 obligation.

4. **Generated write-method mechanics and the writer-authority carrier.** The
   seam's *taxonomy* is design intent and is pinned here: every membership
   effect reaching the central seam carries exactly one value of a **closed,
   host-owned writer-authority carrier** — `userTransition` (with the
   transaction-local authorization witness binding caller/effective principal,
   declaration, resource, target row, operation, and old/new role),
   `systemSweep`, `privileged(seed | import | hostOps:<verb>)`, or `raw`
   (which the seam refuses for membership tables) — **unforgeable by
   application code** and propagated intact through write buffering, nested
   `ctx.runMutation`, idempotent replay, and dry-run. Today's buffered write
   carries data with no authorization and the compatibility projection
   collapses anonymous, `system`, and `adminBypass` into one representation,
   so the carrier is an M2 **prerequisite**, not an M2 detail: a check "below
   buffered Ibex and HostPlan" that cannot distinguish raw `ctx.db` from an
   authorized transition from the sweep enforces nothing. Deferred to
   implementation: the carrier's exact representation, witness non-reuse
   mechanics, and the bootstrap exception's exactly-once property.

*Resolved for ordinary user transitions 2026-07-15:* the representation is a
Rust-only buffered membership command carrying `MembershipWriter`; commit-time
planning converts it to an authorized plan kept in a lane distinct from raw
`BufferedWrite`. Bootstrap/sweep/privileged producers retain their existing
dedicated host entry points, and their broader generated wiring remains scoped
to the follow-ons above. This first bridge permits one generated membership
command per mutation. The 2026-08-15 amendment lets that one bootstrap command
contain a bounded initial roster because every additional seat is authorized
independently from the creator's declared bootstrap role and planned atomically.
Until sequential read-your-membership-writes planning is implemented, a second
command is still refused typed rather than allowing two plans authorized
against the same pre-state to compose into an undeclared transition.
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
  role-management API (a `systemSetRole` does not exist). The declared expiry
  field must be an epoch-ms timestamp column (any other type is a manifest
  error; a null value never sweeps), and the expiry-without-cron diagnostic is
  satisfied **only** by a cron entry directly targeting the generated sweep
  action — an app action that merely calls the sweep does not satisfy it.
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
- [base] **The per-op grammar is closed and fail-closed:** an `insert`
  transition omitting `to`, a `patch` omitting `fields`, an empty `by`/`from`/
  `to`/`fields` array, a `from` on `insert`, a `to` on `remove` or `patch`,
  `fields` on `setRole` or `remove`, `by: ["self"]` on `insert`, and a
  role-class `target: "self"` row are each refused at manifest load — asserted
  against the activation validator, which must refuse them **before** M2
  exists to execute them. An omitted `from` admits any current role; an
  omitted insert `fields` binds the insert to axes + role only. The
  omitted-`to` open-join insert — the fail-open self-seat reading — is proven
  **refused at load**, never reinterpreted at runtime.
- [base] **No fail-open activation:** activating a `.membership()` declaration
  whose security-significant features lack their landed central enforcement is
  refused with the typed capability diagnostic; the M1 fixtures run under the
  explicit dev-only override; a production-profile activation without M2 is
  proven refused.
- [base] **One final-state validator:** every deployment path — dev apply,
  same-mode sessions deployment, staged activation, import — invokes the
  shared activation validator against post-DDL, post-seed state; a
  `scope: "resource"` declaration without a resolvable active `resourceTable`
  is refused (omitted and misspelled variants both); an absent or newly
  created membership table validates as an **empty roster**, so a `lastHolder`
  declaration over a populated resource table refuses activation unless the
  same activation seats holders; and a seed that introduces a nonconforming
  row is caught (the scan runs after seed, not before).
- [base] **`lastHolder` counts _eligible_ holders (LLP 0055's recoverability
  predicate) — the adversarial schedule that defeated a row-counting version:**
  agents A and B both hold the protected role; **deactivate A** (allowed — not
  the sole row); then B **leaves / is demoted / expires / is deactivated** →
  **refused**, because A is ineligible and B is the last *eligible* holder.
  Also refused: **inserting or promoting an ineligible principal into the
  protected role** — the set cannot be kept full with unrecoverable holders. The
  **A-active / B-nonexistent counterexample** (deactivate A while B is a
  never-authenticatable id) is in acceptance and, until the joint LLP 0055/0056/G1
  predicate lands, documents the shipped gap where G1 wrongly admits it.
  Concurrent variants yield exactly one commit and one typed refusal **in both
  commit orders** — deactivate-A ∥ remove-B over the final two eligible holders.
  The lifecycle leg is evaluated at the **shared transaction-local final-state
  evaluator** described in §Writes and protocol obligation 4b — invoked after
  the writer's own effects, under the writer reservation, before commit — **not**
  via app captured-dependencies (auth-catalog rows carry no app `_version` and
  `CapturedReadKind::Auth` is ignored by commit validation, so no acceptance text
  relies on `Auth` captures); only the membership `(resource, role)` holder-set
  read is an ordinary captured range. A version that evaluates the invariant on
  a plain snapshot without the shared final-state check passes both racers and
  strands the resource, which is the point of the fixture.
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
- [base] **Atomic initial roster:** `bootstrap(resourceValues, initialMembers)`
  creates the resource, creator seat, and up to 64 additional seats in one
  commit; every additional seat must match an `insert` transition from the
  bootstrap role and pass vocabulary, uniqueness, eligibility, field-coverage,
  and provenance checks. An unauthorized role/target, duplicate principal,
  creator duplicate, missing transition, or over-limit roster refuses the
  entire command with zero writes. Supplying any additional member requires an
  `authorityCreating` wrapper; creator-only bootstrap retains the structural
  non-authority-creating carve-out.
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
- [live] The shipped RBAC demo keeps three independently named live scopes
  through a membership grant and later data write. Bob's initially empty scope
  receives and exactly ACKs the witnessed hidden-to-visible authorization
  snapshot; the later announcement reaches Alice and Bob under their own
  namespaces; Eve's scope remains empty, and every drained frame is checked
  against its subscription id and client-store/query-instance namespace before
  any rows are applied.
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
- [live] Room binding: a kick **by delete** on a declared membership backing a
  protected room suspends delivery and reauthorizes from a fresh membership
  snapshot (0053's card-game fixture, driven through the declaration and its
  stable id); a downgrade suspends and re-grants under the shipped role-blind
  check (role narrowing pending — LLP 0013 2026-08-17 amendment).
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
- Should a blessed **product** path exist for seating the first app-global
  `admin` (the self-hosted "first signup becomes owner" pattern), or is
  privileged seeding (§Global roles) the permanent answer?
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
- May a future protected room bind its predicate to **two** declarations (the
  OR shape blessed for queries)? V1 binds exactly one declaration on both
  operations and refuses mixing; see
  [LLP 0013's source-authored membership-backed rooms amendment](./0013-ephemeral-realtime-state.rfc.md#dated-amendment-source-authored-membership-backed-rooms-2026-08-17).
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
- **LLP 0013 companion amendment** —
  [source-authored membership-backed rooms](./0013-ephemeral-realtime-state.rfc.md#dated-amendment-source-authored-membership-backed-rooms-2026-08-17)
  binds room policy to this declaration's stable id and ships current-row
  removal invalidation. Its v1 grant is role-blind row existence; role
  narrowing and the downgrade kick remain the named follow-on.
- **LLP 0012 registrations** — the vocabulary/uniqueness/immutability/nullability/
  activation/raw-write diagnostics, the role-denial details schema (invariant
  public payload; full doctor variant), and the unique-index manifest capability.
- **LLP 0055 composition** — the `authorityCreating` marker (0055 defines;
  this RFC's `provenance` is its precondition).

## Dated amendment: the declaration-owned self-projection (2026-08-01)

Recorded per the LLP 0137 A2 finding (ticket
`20260801-0137-a2-membership-semijoin-cannot-list-own-channels`,
resolved this date) and the fix-wave triage: "channels I belong to" was
inexpressible against a resource-scoped declaration, so external apps
maintained the exact app-data roster mirror this document warns
against.

The host now serves a **reserved, declaration-owned self-projection**:
the native live query `_snapback.myMemberships` (admitted by name,
never in public listings), argument `{ membership: <effective
declaration id> }`, returning only the caller's own rows —
`{ id, resource, role, sinceMs }` — under the caller's resolved
authority (anonymous callers hold nothing; unknown declaration ids
refuse). Its captured dependencies are the caller's own rows plus one
principal-slice range capture whose `result_count` participates in the
delivery fingerprint, so the empty slice is a first-class captured fact
in this document's pinned-empty-capture idiom: a first grant wakes a
previously blank subscription, and a removal leaves the projection on
the next delivery. In sessions mode the projection is auth-scoped and
rides the witnessed invalidation lane like every other protected
query.

Disclosure posture: the projection reveals strictly less than any
existing surface — nothing about other principals, not even existence —
so the private-roster rule holds by construction. The two adjacent A2/A3
findings (principal-addressed removal, resource-partitioned keyset
pages) remain governed by LLP 0100 and are deliberately **not** part of
this amendment.

## Dated amendment: the receipted trusted-import lane (2026-08-01)

Recorded per LLP 0100 §8b (the routed seed/reset composition this
document co-owns with LLP 0109) and the LLP 0137 A3 finding
(`issues/20260801-0137-a3-membership-not-seedable-cleanup-cannot-retire-authority.md`):
this document has always reserved id-addressed membership methods for
"trusted migration/import contexts", but the one *receipted* trusted
context an application has — the LLP 0109 versioned seed — refused
membership tables outright, so a fixture could not establish authority
and a receipted reset could not retire it (the A3 arm choreographed
per-persona self-removal before every reset as a workaround).

The lane now exists, and it is this document's writer-class doctrine made
receipted:

- Fixture seats install only through the **`Seed` writer class** of the
  closed writer enumeration — a privileged non-invocation writer: it
  never evaluates the transition matrix, stamps per-row `seed`
  provenance through the same host-managed columns every writer uses,
  and synthesizes no transition records (a restore is not a stream of
  kicks). The private-roster posture is untouched: fixture rows are
  authored data entering a governed host lane, not an application read
  or write surface.
- The activation invariants this document pins — closed vocabulary,
  non-null axes, pair uniqueness, resource referential integrity,
  `lastHolder` with the LLP 0055 eligibility predicate — gate the whole
  install transaction, in sessions mode only after the provider catalog
  can satisfy eligibility (LLP 0109 §8's ordering).
- A versioned **reset-install retires every runtime seat and restores
  exactly the fixture seats in one transaction**, and its authorization
  consequence is the rotated stream incarnation at epoch 0 — the
  **event-3/declared-restore** class of this document's taxonomy,
  exactly as pinned ("reset/import carry event-3/declared-restore
  incarnation semantics"), never per-row event 1. A principal holding a
  runtime-only seat provably loses authority at that cut; fixture
  authority survives and keeps exercising the unchanged transition
  matrix.

Witnesses live with LLP 0109's §18 amendment (crates/snapback/src/storage.rs
`versioned_seed_membership_fixture_lane_*`); the §1-adjacent guide page
(`guide/backend/versioned-seeds.md`) documents the lane and its
boundary: product bootstrap remains `bootstrap()` under a real
principal.

## Dated amendment: bounded atomic bootstrap rosters (2026-08-15)

Resource-scoped declarations keep one generated membership command per
mutation, but `bootstrap(resourceValues, initialMembers?)` may now create up to
64 additional, transition-checked seats in the same atomic resource-creation
plan. The creator seat remains server-derived. Every additional member is
authorized independently as an `insert` by the creator's bootstrap role, and
any failure rolls back the resource and roster together. A non-empty initial
roster is authority-creating and requires the existing consent/provenance
profile; creator-only bootstrap retains its structural carve-out. This closes
group creation without admitting sequential membership commands or a generic
batch writer.

**Verified 2026-08-15:** The motivating case is the Clique 0.1.21
exploratory-sweep finding recorded in Diary
0081-clique-0121-snapback-simplified: the published
one-membership-command-per-mutation model could not express atomic multi-seat
fixture group creation, forcing that lane to downgrade authority to public-read
handler visibility. This amendment covers that case:
`bootstrap(resourceValues, initialMembers?)` atomically seats up to 64
additional transition-checked members, each authorized as an ordinary declared
`insert` from the creator's bootstrap role. The surface is implemented and
shipped, not merely specified: `crates/snapback/src/runtime.rs` validates the `initialMembers`
argument and carries the bootstrap-roster tests;
`packages/snapback-codegen/index.mjs` generates the authoring surface;
`guide/auth/scoped-roles.md` documents it; and the `auth.scoped-roles` and
`authority.profile.v1` rows in `guide/capabilities.md` register it. The diary's
second prong—owner-visibility `ctx.db` reads blocking cross-principal resolution
of a quoted message—is likewise covered by the explicit `ctx.db.elevated`
handler-read surface in `guide/auth/protecting-data.md`, whose worked example is
exactly the quoted-message case. Both surfaces are in the published catalog:
every `@expo/snapback*` package was published at 0.1.22 on 2026-08-15 (npm
`time.modified` 2026-08-16T00:34Z), and the published
`@expo/snapback-codegen@0.1.22` tarball contains the `.authorityProfile(...)`
facade and the `bootstrap(resourceValues, initialMembers?)` atomic-roster
signature. There is no residual expressiveness gap from the Diary
0081-clique-0121-snapback-simplified fixture case and no further amendment is
needed.

## Status

**Review** — moved from `Draft` by the author (Charlie, 2026-07-13), who is the only party LLP 0005 permits to make that call. Refined through **sixteen dual-family review rounds** (fresh Claude
Fable 5 Max and GPT gpt-5.6-sol ultra reviewers each round, none with memory of
prior rounds); all reviews are recorded verbatim with provenance in
`llp/reviews/0056-scoped-roles-and-memberships.{fable,codex}.md` (the artifacts
are the count of record).

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

The current revision incorporates the round-16 findings (both families, blind).
Round 16's central fix reconciled an eligibility-predicate divergence that this
session's concurrent LLP 0055 round-6 edit introduced — 0055 strengthened
eligibility to durable recoverability and claimed alignment with 0056, while 0056
still said "not permanently ended," each citing the other. LLP 0055 now owns the
predicate and 0056 consumes it, so the co-owned invariant has one definition;
making the shipped G1 check match it is a named joint defect obligation. This
revision has **not yet been reviewed** — round 17 is the next fresh pass. Builds on LLP 0011's rule model and LLP 0053 (Accepted);
composes with LLP 0055 but neither depends on the other landing first. Where this
document restates a contract LLP 0011, 0039, or 0053 pins, those documents win.
