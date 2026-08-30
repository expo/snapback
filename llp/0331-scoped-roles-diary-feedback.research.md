# LLP 0331: Scoped authorization and accounts — diary evidence for Snapback2

**Type:** Research
**Status:** Draft
**Systems:** Snapback 1, Snapback2, Auth, Accounts, Identity, Memberships,
Authorization, Agent experience, Developer experience, Guide, Code generation,
Diagnostics, Competitive evaluation, Benchmarks, Demo apps
**Author:** Charlie Cheever / Claude Fable 5 (coverage audit and tiering);
Codex (Snapback2 synthesis); Grok (diary research)
**Date:** 2026-08-30
**Revised:** 2026-08-30 (Fable takeover, revision 3: added §"Coverage — the
model against the thirty-seven paper applications", which tests the
synthesis's core against every application written for the Snapback 2 data
language (LLP 0329.014.001–.005) and ends in a tiered admission rule for
authorization extensions; revised the Summary, the model table, the
non-human-principal paragraph, the recipe's deferral paragraph, and the
sequence table accordingly; the author's rulings on the six coverage
questions are recorded in §"Coverage" → "Author rulings"; the Codex delta
review of §"Coverage" (round 1, NOT READY) is folded — counts re-denominated,
events and calendar moved to Tier 2 with the closure interim's revocation
lag named, an explicit delta table from the RFC, the admission rule
tightened to a scheduled spec and a real doing-list trade, sequence row 4b
split at the bar — and its one ruling-touching concern, the shape of Tier 1,
was ruled by the author as an amendment to ruling 0 (table rules name the
system principal; no per-program grant view) and applied; Codex round 2
(NOT READY, 3 MATERIAL, all folded): stale declared-view wording removed,
the budget line corrected, a "One trusted domain" paragraph added to Tier 1,
four RFC delta rows added; Codex rounds 3 and 4 (NOT READY, residual
wording; the admission rule's third admissible class) folded; the loop is
escalated to the author after four rounds; the same day, a four-facet audit
of the Expo/EAS production backend against the rulings was folded as
§"Coverage" → "A real application: Expo/EAS"; its four rulings (E-a to
E-d: single-column `inherits` over a mutable parent scope; jobs as the
re-minted enqueuing principal; declared deletion cascades; the verified
e-mail claim carve-out) were ruled by the author and applied, and Codex round
5 over that section (NOT READY on the fold, not on the rulings) folded —
E-a's admission status and parent-policy obligation, E-b's revocation
semantics, E-c's locus and certificate line, corrected census denominators;
round 6 (NOT READY, text consistency only) folded. Audit artifacts:
`llp/reviews/0331-coverage-audit.*` and `llp/reviews/0331-coverage-audit.eas*`.);
2026-08-30 (Codex takeover, revision 2: added the Snapback2 authorization
and account synthesis. Earlier Codex `gpt-5.6-sol` xhigh review recast shipped
projection and asset-sharing composition, established the eligible-lane
denominator, withdrew in-place `requireRole` broadening, and narrowed the
bootstrap gap to the creator seat. Dispositions and the verbatim artifact are
at the end.)
**Related:** LLP 0011, LLP 0016, LLP 0056, LLP 0061, LLP 0100, LLP 0137,
LLP 0151, LLP 0201, LLP 0214, LLP 0226, LLP 0231, LLP 0240, LLP 0243,
LLP 0258, LLP 0259, LLP 0295, LLP 0310, LLP 0329.014.000, LLP 0329.014.001,
LLP 0329.014.002, LLP 0329.014.003, LLP 0329.014.004, LLP 0329.014.005, LLP 1000,
`rules/NOT-DOING.md`, `llp/reviews/0331-coverage-audit.brief.md`, the nine
`llp/reviews/0331-coverage-audit.<slice>.md` audit artifacts, the Codex
delta-review artifact `llp/reviews/0331-coverage-audit.codex.md`, and the
five Expo/EAS audit artifacts `llp/reviews/0331-coverage-audit.eas*.md`,
[benchmarks/briefs/social-messenger.md](../benchmarks/briefs/social-messenger.md),
[guide/auth/scoped-roles.md](../guide/auth/scoped-roles.md),
[guide/auth/protecting-data.md](../guide/auth/protecting-data.md),
[guide/backend/assets.md](../guide/backend/assets.md),
[guide/recipes/membership-roster-projection.md](../guide/recipes/membership-roster-projection.md),
`issues/20260826-membership-scoped-query-reachability.md`,
`issues/20260822-membership-visibility-read-denial-needs-reverify.md`,
`issues/20260808-guide-gap-principal-to-app-identity-binding.md`,
`issues/20260819-generated-role-checks-launder-roles-through-array-slice.md`,
`issues/20260826-stale-handle-membership-plan-bypasses-successor-transition-policy.md`,
`issues/closed/20260821-private-authority-product-roster-decision.md`,
Diary 0014, Diary 0015, Diary 0021, Diary 0026, Diary 0027, Diary 0028,
Diary 0042, Diary 0044, Diary 0045-a4-events-sweep, Diary 0046-a5-ai-research-room-sweep,
Diary 0058-messaging-snapback, Diary 0079, Diary 0081, Diary 0083, Diary 0086,
Diary 0092, Diary 0100, Diary 0101, Diary 0104, Diary 0105, Diary 0108, Diary 0114,
`demos/party-wall`, `demos/messaging-snapback`

## Summary

**Recommendation for Snapback2:** do not port Snapback 1's
`.membership()` / `.authorityProfile()` subsystem. Keep one authorization
engine: mandatory table policy expressed in the bounded data-program
language. Model scoped authority as ordinary, typed app relationship rows such
as `(conversation, principal, role)`. An indexed relationship lookup plus an
explicit role comparison is RBAC; relationship existence alone is membership
or one-hop ReBAC; comparisons with stable row or actor attributes are bounded
ABAC. These are schema patterns, not competing runtimes.

Keep the security wins that motivated the Snapback 1 subsystem: an unforgeable
server-derived actor; a closed role vocabulary; unique and immutable
principal/scope axes; atomic bootstrap and transitions; no existence oracle;
and revocation that invalidates future delivery. Express those properties with
the same table types, indexes, rules, constraints, named programs, and traces
used everywhere else. Do not recreate a private authority roster, generated
operation facade, authority lattice, session-carried roles, or policy sidecar.

**Coverage (revision 3).** That model was tested against all thirty-seven
paper applications written for the Snapback 2 data language (§"Coverage").
The human who-may rules of thirty-one of them are the recipe above outright —
scoped relation rows, owner fields, one-hop probes with a `where`, negation,
`(old, next)`, `public(reason)`, scope-less role tables — once immutable scope
ids are denormalized onto child rows and secret columns are split into their
own tables; three more (events, calendar, the professional graph) need a
genuine second hop or a set-valued principal — Tier 2's bounded `any`, with
a program-maintained closure relation as an interim whose revocation lag is
a named loss; two (the document workspace, Notion-style databases) need
hierarchy; one (the app platform) needs rules composed from several authors,
which the RFC admits as dimension Q and this document leaves outside the
initial Snapback 2 scope. What the corpus needs that the recipe does not name
is not a relationship shape but an **actor**: thirty-six of thirty-seven
applications invoke something that is not a signed-in human, and thirty-three
need a system principal to read or write rows no user rule admits —
schedules, jobs, effect ingress, non-client-callable programs, and in about
five a viewer-invoked program that must branch on a row the viewer cannot
read. That is the one extension admitted for the bar (Tier 1, ratified by
the author on 2026-08-30; it includes the same-commit system continuation of
a viewer's program; the system principal is named by the rules of the tables
it must touch, not granted by a per-program view — ruling 0 as amended),
joined after the bar by single-column `inherits`, ruled on the Expo/EAS
evidence;
a link or guest is an identity-layer principal, not a rule term; hierarchy,
principal sets, two-hop probes, and hidden probes are Tier 2, each gated on
a scheduled application and a measured lowering; a principal-kind term, a
time term, a count term, and a role lattice are refused with the product
loss named. The admission rule and the budget are in §"Coverage". A
same-day audit of the **Expo/EAS** backend — 171 privacy policies, a real
per-table rule model — found the recipe carries its who-may rules outright
and Tier 1 describes what EAS already is (161 of 168 production policies
name the system context), with three load-bearing gaps the rulings did not
cover:
the app→account scope that project transfer rewrites (ruling 4 assumes an
immutable scope; the RFC's `inherits` is the form), jobs that run as the
dispatching principal rather than `system`, and deletion cascades as the
mirror of creation provenance — each ruled the same day (E-a to E-d in
§"Coverage") and folded into the tiers.

The account boundary is equally small and firm. Snapback owns a nominal,
stable `Principal` plus protected identity, credential, and session state. The
app owns an optional profile row keyed uniquely by that `Principal`. Email,
provider subjects, profile IDs, and session tokens are never principals. For
the Clique M1–M3 bar, Snapback2 needs real password registration, expiring and
revocable sessions, viewer-derived profile creation, explicit client custody,
and the scoped relationship pattern. Broader account recovery, linking,
providers, guests, passkeys, and role hierarchies wait for a concrete post-M3
demand.

The diary finding behind that recommendation is simple: Snapback 1's
scoped-roles surface is liked when agents take it, and skipped when they are on
a clock.

The host-owned closed transition matrix, atomic `bootstrap()`, `lastHolder`,
uniform `{kind:'role'}` denials, generated operations that appear only when
the schema can prove them, and (once fixed) live revocation are the parts
diaries praise more than almost any other Snapback authoring surface. The
cost is that the first path that *works* is still `public-read` plus a
handler `if`. Among Clique/Coterie Snapback lanes that *reached the
messaging milestone* and therefore had to choose an authorization design,
the declared primitive was the minority path (Finding 1). Lanes that took
it hit a stable cluster of cliffs: private roster versus product facts,
creator-seat incidental fields, `v.principal()` versus `Id<'users'>`, an
`owner`-named apex role, exact `requireRole`, and silent empty queries.

This document remains **Research**. It does not amend Snapback 1's LLP 0056,
LLP 0100, or LLP 0240, and its pre-fence number cannot make it a binding
Snapback2 design. The synthesis below is the design input for one or more
implementation-focused Snapback2 LLPs numbered 1001 or higher. Per the
Snapback2 fence, only implemented specs bind. LLP 0310 already owns the 0.1.27
Clique DX inventory and the pit-of-success standard; this document owns the
membership-system reading across the diary corpus, of which LLP 0310's F8 /
P18 (`issues/20260826-membership-scoped-query-reachability.md`) is one row.

## Governing context and document posture

This synthesis follows the Snapback2 fence rather than treating Snapback 1's
most mature surface as the default:

| Source | Status here | Constraint carried into the synthesis |
|---|---|---|
| LLP 1000#Decisions (author, 2026-08-29) plus `rules/RULES.md` / `rules/NOT-DOING.md` | Active Snapback2 root and rules | One bounded data-program language; auth always on; dev personas, not auth modes; no compatibility apparatus before promotion; only implemented specs bind |
| LLP 0329.014.004#4 The schema (v1), #5 Policy, #6 Kinds, #7 Runtime | Draft Snapback2 design input | Typed schema, effect-specific row rules, bounded relational probes, identity kind, certificates, and traced invalidation |
| LLP 0226#1 The identity namespaces and #2 Conversion rules | Active foundation decision | Stable server-minted principal; credentials/provider identities/profile data are separate namespaces; conversions are trusted and explicit |
| LLP 0231#D1 and #D6 | Accepted prior decision | Mandatory table-policy locus, read policy composed into selection, and one policy IR for reads and two-sided writes |
| LLP 0011#Authentication Model / #Authorization Model; LLP 0056#Writes / #What stays out of the session; LLP 0151#Account lifecycle; LLP 0214#3.3 Four storage layers / #5 Verified provisioning hook; LLP 0240#D1–D3 | Snapback 1 evidence at mixed statuses | Preserve identity, transition, revocation, and account-lifecycle invariants; do not assume their API or storage machinery survives |
| LLP 0331 | Draft Research, pre-fence number | Evidence and recommendation only; a 1001+ implemented spec must own binding Snapback2 API decisions |

## Snapback2 synthesis

### The authorization model: one locus, one algebra, typed relationships

The model should not ask authors to select “RBAC,” “ReBAC,” or “ABAC.” Those
labels describe common uses of one mechanism:

| Concern | Snapback2 expression | What is not introduced |
|---|---|---|
| Row and operation authorization | Explicit `read`, `insert`, `update`, and `delete` rules at the table-policy locus | Handler convention or post-filtering |
| Scoped roles | App row `{ scope: Ref<S>, principal: Principal, role: Enum<R> }` plus a unique composite index | A second membership store/runtime |
| Relationships | Typed app rows and an indexed, bounded relational probe (`exists` / `any`) | Universal subject/relation/object tuples or arbitrary graph recursion |
| Attributes | Comparisons over typed row state and server-derived actor state | Ambient network, clock, environment, or caller-asserted claims |
| Hierarchy | Explicit role sets / boolean composition; a single-column `inherits` over a `ref` (a child carries its parent's scope, rewritten by the engine when the parent moves) is admitted on the Expo/EAS evidence (E-a); a bounded declared traversal (`nearest` over `tree` / `dag`) is Tier 2 — two of thirty-seven applications are load-bearing on it (§"Coverage") | A runtime role lattice or Zanzibar-shaped sidecar |
| Non-human actors | One reserved system principal; `callable: 'system'` marks a program non-client-callable; schedules, jobs, effect ingress, and the same-commit continuation of a viewer's program run as it — or as the enqueuing viewer re-minted by the identity layer with a bounded lifetime (E-b); a table whose rows the system must read or write names it in that table's own rule (Tier 1, §"Coverage") | A `principal.kind` term in rules; a kind taxonomy; a per-program grant view; a second evaluator |
| Guests and links | The identity kind mints an ordinary principal at link redemption or guest sign-in; rules see only `viewer` | A bearer term in rules (Tier 2, `principal.bearerOf`); roles carried by the link |

Every table effect remains default-deny and uses the same rule IR. A query can
only narrow the declared read rule; it cannot broaden it. An update is checked
against old and new state. Every relationship read that influences a result
enters the same certificate and invalidation trace as other data dependencies.
That is the revocation mechanism: changing or deleting an authority row cuts
future reads, sync, and delivery without waiting for a session refresh.

“Scoped authority relation” is useful vocabulary and a useful documented
recipe. It need not be a runtime kind. If repeated benchmark evidence later
justifies `scopedRelation(...)` authoring sugar, it must expand transparently
to ordinary columns, indexes, constraints, and rules. It must not acquire its
own storage, host-private roster, generated mutation API, or semantics that
cannot be expressed in the bounded language. The compiler must never infer an
authority relation merely from names such as `members`, `userId`, or `role`.

This choice preserves the durable conclusions of LLP 0231#D1 and #D6: table
policy is the mandatory enforcement locus, policy composes into selection
instead of post-filtering, and reads and two-sided writes share one IR. It also
answers the membership question in LLP 0329.014.004#9 at the semantic level:
the primitive is a bounded indexed relational probe; membership is a
high-value schema recipe over it. Whether the source language spells that
probe `exists` or lowers a bounded `any` remains for the 1001+ spec.

### The account model: principal, login identity, credential, session, profile

“User account” is too overloaded to be a type. Snapback2 should keep these
boundaries explicit even when their first implementation is small:

| Concept | Owner | Contract |
|---|---|---|
| `Principal` | Protected Snapback identity state | Stable, server-minted, nominal authority subject; exposed to app rules as the server-derived viewer |
| Login identity | Protected identity state | An immutable `(provider installation, subject)` binding such as canonical password-email; never an app foreign key or mutable claim |
| Credential | Protected identity state | A verifier or proof attached to a principal; never exposed to app queries or sync |
| Session | Protected identity state | Expiring, revocable authority to act as one principal, carried with the server-derived auth epoch; roles are absent |
| Profile | Ordinary app table | Product facts such as handle, display name, avatar, bio, location, and link, keyed uniquely by `Principal` |
| Scoped authority | Ordinary app table | Current product relationship between a principal and a resource; evaluated live by rules |
| Operator identity | Snapback control plane | Deployment/administration authority; never an app role or app principal shortcut |

The app profile is not the principal. In a greenfield Snapback2 app there is no
reason to manufacture a second app-user identity and then expose a dangerous
principal-to-user binding seam. A profile has a unique `principal: Principal`
column; product rows may point to the principal when they mean an actor, or to
the profile row only when they mean that product entity. The type checker must
reject `Ref<profiles>` (and the current spike's `Ref<users>`) where a
`Principal` is required. A caller never supplies the **acting** principal,
`actorId`, or provider subject alongside a bearer; the runtime derives the
viewer from the verified session. Programs may accept a branded target
principal—for example, the person to follow or add—subject to ordinary policy.

An organization, team, workspace, household, or group is likewise ordinary
app data and an authorization scope—not a second kind of login account. Its
members and roles use the same scoped relationship pattern. Snapback operator
authority remains outside that app plane.

For Clique M1, the smallest real account kernel is:

1. Built-in email/password registration and sign-in with canonical unique
   email, password length at least eight, a named adaptive password KDF, a
   fixed server-side password-guess throttle, and no configuration ceremony.
   Expensive KDF work occurs outside SQLite's single-writer critical section.
2. Opaque random session bearers, only a digest at rest, a fixed expiry, and
   server-side revocation on logout. Public sign-in failure does not reveal
   whether the identity or credential failed: status/body share one class and
   an unknown identity consumes an equivalent dummy-KDF timing budget.
   Clique's required duplicate-email registration error may still be explicit.
3. One atomic **identity** registration boundary: principal, login identity,
   credential, and session either commit together or leave nothing durable.
   App profile creation is not smuggled into that privileged transaction.
   After the session-settlement barrier, an idempotent `createMyProfile`-shaped
   app program derives its principal from the viewer. A handle collision leaves
   a valid signed-in account at profile setup, not a half-bound identity.
4. The profile table structurally allows at most one row per principal; the
   principal axis is derived and immutable; only the viewer edits their row;
   handle uniqueness and the full M1 field/length/avatar contract are enforced
   server-side. For Clique, profile reads admit authenticated app viewers so
   the other-client M1 update and M2 Global author/avatar surfaces compose;
   writes remain self-only. Other apps may declare a narrower read audience.
   Registration and profile creation remain distinct action-log verbs,
   matching the benchmark.
5. One client auth owner. Sign-up or sign-in settles only after the new session
   and cache partition are installed. Logout, expiry, or principal switching
   fences old subscriptions, queued writes, and private snapshots before
   exposing successor state; active transports reauthorize or terminate, and
   an old bearer cannot resume delivery or replay queued writes. Relaunch
   restores the same still-valid session. Sign-out destroys the per-principal
   local-store key; reconnect reauthorizes before any outbox replay, applies
   each table's declared retention consequence, and evicts only rows that the
   resulting retention verdict no longer permits.
6. Session material never appears in logs, receipts, query parameters, or app
   data. It uses target-appropriate persistent storage, is cleared on logout,
   and its 1001+ spec states the browser/XSS residual threat honestly rather
   than calling browser bearer custody solved.
7. Local personas resolve stable aliases to ordinary principals and sessions,
   then exercise the same rules and programs as password users. They never
   inject roles. Hosted/production targets reject persona selection. Personas
   make auth convenient; they do not replace the benchmark's real registration
   and session proofs. Aliases are stable inside one dev store or fixture;
   reset remints principals and seeds recreate relationships through normal
   app programs.

Auth is always on. That does not mean every endpoint already has a user
session: registration and sign-in are narrow protected identity operations.
It means there is no alternate auth-off data plane and no build whose
authorization semantics change when it moves from local to hosted.

M1–M3 needs one opaque, nominal scalar principal, and every program derives
the viewer from a session. The coverage audit (§"Coverage") shows that almost
every application beyond M3 also has actors that are not password users —
service and webhook credentials, host processes, devices, API keys, contact
and guest principals — and that all of them are satisfied by the **identity
layer minting an ordinary principal** with a server-minted session, named in
rules as a column value or `viewer`; `principal.kind` never needs to appear
in a rule. The one exception is the **system principal** under which
schedules, jobs, and effect ingress run, admitted as Tier 1. Principal *sets*
(a user acting through several bound contact principals; groups as grant
subjects) are Tier 2; a named program can maintain the closure as an
ordinary relation row in the interim, at the cost of a revocation lag the
events v0 records (its unbind repair is a `take: 50` worklist outside the
transaction, against the design's immediate-loss requirement); the calendar
v0 used the RFC's bounded `any` instead.
Do not make `Principal` an alias for a users-table ID or freeze a wire
representation that precludes later kinds and bindings. Connected OAuth or API
credentials that an application uses to call an external effect are ordinary
protected app secrets; they are not login identities unless an identity spec
explicitly makes that provider an authenticator.

Guest claim should preserve the same principal, attach a verified credential,
rotate or revoke guest sessions, and refuse collisions rather than silently
merge principals. That architecture is worth preserving from Snapback 1, but
guest implementation is not on the Clique M1–M3 critical path. The same is
true of password recovery/change, verification email, OAuth/OIDC, passkeys,
MFA/assurance, identity linking/unlinking, account deletion/merge, service or
agent principals, and multi-replica session invalidation. Defer them until a
published bar or a real app requires them; do not pre-build an auth catalog.
A future provider link must prove control under its identity spec and key the
external identity by provider installation plus subject. Mutable/shared email
is never an automatic principal-link or merge key, with one carve-out ruled
on the Expo/EAS evidence (E-d): the identity kind may rebind an
*invitation's* contact principal — invitation-scoped, minted for that
invitation alone — to a user at a **verified** e-mail claim, atomically with
consuming or retargeting that invitation, refusing a collision rather than
merging; the events design's shape, so a pending-invitations list can be
served without a link. Changing an identifier creates and verifies a replacement
binding through that lifecycle; it never mutates or reinterprets an
existing provider subject in place.

### The canonical scoped-authority recipe

Use the least relationship shape the product means. Simple ownership is an
`owner: Principal` field with `row.owner == viewer`. Binary membership is a
unique `(scope, principal)` row. Add a closed role enum only when members have
different authority. Independent permissions use independent relationship
rows rather than pretending mutually exclusive roles form a universal model.

For a resource with mutually exclusive roles, use one row per current member:

```ts
conversationMembers: table({
  conversation: ref("conversations"),
  principal: principal(),
  role: enumOf("member", "admin"),
  joinedAt: time(),
})
  .unique("byConversationPrincipal", ["conversation", "principal"])
  .index("byConversationPrincipalRole", ["conversation", "principal", "role"])
  .index("byPrincipalConversation", ["principal", "conversation"])
```

The spelling is illustrative; a 1001+ Snapback2 spec owns the actual schema
API. The semantics are not:

- `principal` and `conversation` are immutable axes. Role values come from a
  closed enum. The unique index makes “one current role per principal per
  resource” structural rather than conventional.
- Conversation, roster, and message reads use an indexed `exists` for the
  current viewer's membership. Admin transitions use the triple-key role index
  (or an equivalent unique point-read plus role predicate); role admission is
  never inferred from mere relationship existence. When authority facts and
  product roster facts have the same audience, the relation's ordinary read
  rule lets one table serve both.
  When their protection classes differ, the app declares a separate
  product projection deliberately. The authority relation remains the sole
  grant source. Any duplicated membership association is engine-maintained
  from it, cannot be independently written, and is never consulted to grant
  authority; product-only facts may instead key to the authority row. Snapback
  does not impose a global duplicate roster. An outsider still gets no
  membership/existence oracle.
- Roles and relationships never become session/JWT/persona claims or
  independently trusted client entitlements. Delivered rows and scoped
  verdicts may be cached under their receipt, but the session only says who is
  acting and the server's current traced app rows say what that principal may
  do.
- Named bounded programs own transitions such as `groupCreate`, `memberAdd`,
  `memberPromote`, `memberRemove`, and `memberLeave`. They derive the acting
  principal, check old and new state, and commit atomically. Raw writes do not
  create a privileged escape lane.
- The relation table's own insert/update/delete rules bind every writer and
  prevent self-promotion, cross-scope moves, or a caller-selected **acting**
  principal. Named programs may take an explicit target, but package product
  transitions rather than granting authority. Generic constraints enforce
  structural/final-state invariants.
- `groupCreate` atomically inserts the group, the creator's `admin` row, and
  the other initial members; it enforces Clique's 2–50 member bound. The
  creator row may carry the same declared product fields as other rows. Every
  inserted seat, including the creator's, satisfies the ordinary table rule
  and transaction-final constraints using the server-derived actor; bootstrap
  does not confer authority because of a program name or elevated bypass.
- The bootstrap lowering must expose transaction-local creation provenance to
  that rule: a creator self-seat is admissible only while a **new scope
  incarnation** is being inserted by the same derived viewer in the same
  transaction, with the required creator/admin seat present in the final
  state. After the creator leaves, the old creator fact or a reusable program
  handle cannot authorize self-reseat; a current admin must add them. The
  1001+ spec must show this lowering and its unauthorized self-join/reseat
  negative rather than leaving “atomic bootstrap” as magic. Its mirror is
  ruled on the Expo/EAS evidence (E-c): a cascade edge declared **on the
  child table** (`ref(parent, { onDelete: 'cascade' | 'setNull' })`) is part
  of that child table's own mutation policy — so table policy stays the one
  locus — and lets a parent's deletion delete or null every referencing row
  as an engine write authorized by the parent's delete rule, priced in the
  certificate as a cascade line `{ edge, mode, targetTable, maxRows,
  amplification }` with the fan-out ceiling stated; a cascade that exceeds
  one commit becomes a system continuation, and the caller observes the
  parent deleted and its children draining. Instead of a `system` disjunct
  on every child table.
- Clique's frozen contract says anyone can leave, so M3 does not impose
  `lastHolder`, refuse a sole admin's departure, silently promote a successor,
  or delete a populated group. The resulting adminless-group behavior needs a
  product/benchmark ruling rather than an invented platform answer. Another
  app may declare a bounded last-admin invariant, but it must bind every writer
  as a relational table rule or generic transaction-final existence/count
  constraint. A named mutation may package that workflow; it is not the
  invariant's authority. Do not add a membership-specific primitive.
- There is no role hierarchy in the first model. Where more than one role is
  admitted, the rule says the explicit set (`admin || owner`) so broadening is
  reviewable.

For Clique specifically, deleting Carol's membership invalidates the
membership dependency immediately, so she receives no new messages. Her
already-delivered local history remains under the message table's declared
retention consequence; lingering authority is not used to fake retention.
New members can read prior server history because their new current membership
satisfies the same rule. Send-time receipt recipients are a snapshot product
fact, not a session role or permanent authority edge.

Global roles (a scope-less `{ principal, role }` row probed by `viewer`) and
pending invitations (an existing principal's relation row with a `state`
column) are ordinary uses of the recipe, not extensions; the coverage audit
found them in a dozen applications and none needed a new operator. Inherited
workspace roles, private roster projections, and arbitrary relationship
graphs are not required for M1–M3. Workspace and Notion evidence motivates a
bounded declared tree/DAG traversal (Tier 2, §"Coverage"), but do not put it
on this slice's critical path; when scheduled, all traversal dependencies
remain traceable. Do not start with a universal tuple store, external policy
service, unbounded recursion, or a second consistency plane.

### Failure and disclosure semantics

Authorization must not fail as “apparently no data” to the author while also
remaining non-enumerating to an attacker:

- Production reads compose policy into selection and reveal no hidden row or
  relationship existence. Production writes use one stable denied envelope.
- Local `why` / trace diagnostics distinguish a complete empty result from a
  policy-filtered or denied result and name the rule and missing dependency
  without changing production disclosure.
- Client APIs preserve the stable denial class rather than wrapping it as an
  arbitrary handler failure. They never return partially authorized pages as
  complete.
- Rule-input visibility is derived from the referenced table policy, not an
  author-controlled `readable`/`hidden` escape hatch.
- The server executes against the active schema, program, and rule generation;
  certificates bind the schema/rule hashes, and stale predecessor handles are
  rejected or replanned rather than admitted under yesterday's transition
  policy. A queued operation aimed at a current grant binds an immutable row
  identity/incarnation or expected version where lifetime matters, so
  remove-then-rejoin cannot turn an old promote/remove intent into an ABA hit.
- Derived tests probe allowed and denied principals for every effect, including
  role change and revocation while a live query is active, a stale program
  handle after policy replacement, and a stale grant handle after
  remove/recreate.

That is the part of Snapback 1's private-roster posture worth keeping. The
host-private duplicate roster and its projection/cursor operation surface are
not.

### What the current Snapback2 spike proves—and what it does not

The spike already has the useful skeleton: `Rules { read, insert, update,
delete }`, `RuleExpr::Exists`, a viewer term, indexed relationship lookup, and
certificate checks over rule dependencies. Its sample `memberships` table and
message rule demonstrate that one-hop scoped authorization fits the bounded
language.

It is not yet the account or authorization contract. In
`snapback2/crates/snapback2-core/src/schema.rs`, `ColumnType` has no nominal
principal or enum type. In `snapback2/crates/snapback2-core/src/programs.rs`,
the viewer is compared to fields declared as `Ref<users>`, membership insert
is unconditionally allowed, and several sample writes are `Allow`. The engine
context still accepts the viewer as a string, update evaluation applies one
predicate independently to old and new rows instead of evaluating a relational
`(old, next)` rule, and certificate metrology does not yet price every richer
role-probe alternative. `RuleExpr::Exists` also exposes `input_visibility` as
serialized input even though policy disclosure must derive it. Treat those as
spike fixtures, not paved semantics. Add the principal/enum types,
authenticated context, relational write rule, transaction-local creation
provenance/final-state constraint, derived input visibility, complete probe
accounting, and closed write policies before reusing the sample as
documentation or a benchmark start.

### Sequence and acceptance bar

The next implementation-focused Snapback2 LLPs should stay narrow. One should
own actor/principal plus the table-policy and typed-relationship contract; a
second may own credential/session/provider mechanics if combining them would
delay an implemented slice. The table below is the **account- and
authorization-relevant subset**, not a substitute for the complete canonical
Clique M1–M3 brief and assertion manifests:

| Step | Smallest implemented slice | Evidence before moving on |
|---|---|---|
| 1. Actor type | Add nominal scalar `Principal`, server-derived viewer, protected identity boundary, and compile-time separation from app row IDs | Type-negative proof for `Ref<profiles>` / `Ref<users>` as principal; no caller-supplied actor path |
| 2. M1 accounts | Password register/sign-in, post-auth viewer-derived profile creation, expiring/revocable session, one React client auth owner and restart custody | Account-relevant M1 assertions: real signup, duplicate email/handle behavior, adaptive KDF and secret inspection, profile ownership/uniqueness, relaunch persistence, logout refusal for requests, queued writes, and live delivery |
| 3. M2 relationship boundary | Profiles/posts use principals; follows are ordinary product-selection edges, not authority grants | Unfollow removes Following-feed selection but never revokes Global-readable posts; relationship does not imply authorization |
| 4. M3 authority | Canonical conversation-member rows, indexed rules, transaction-local creator bootstrap, named group/member transitions, immediate traced revocation, and contract-compliant leave | Authority-relevant M3 assertions: 2–50 atomic group, creator admin, unauthorized self-join and post-leave self-reseat refusal, add/promote/remove/leave, non-admin denial, removal cuts new delivery while prior local history remains; predecessor-policy and remove/rejoin ABA negatives; full DM/typing/receipt/reply/seed bar remains in the brief |
| 4b. The schedule actor (Tier 1, before the bar) | One reserved system principal; `callable: 'system'`; the `schedule` kind on the doing-list runs as it or as the enqueuing viewer re-minted with a bounded lifetime (E-b); the tables the system touches name it in their own rules; no kind term, no per-program grant view | A schedule-fired transition on a table whose rules admit no user write; a client call of a system-callable program refused; `check` lists the program's read and write sites; the Clique schema shows every system-touched table by inspection; no rule tests a principal kind |
| 4c. The rest of the actor (Tier 1, after the bar) | Jobs, effect ingress, and the same-commit continuation (`phase: 'system'`) on the schedule actor's lowering, each naming `system` or a re-minted principal (E-b); single-column `inherits` over a `ref` and declared cascade edges (E-a, E-c) with the first application that transfers or deletes a parent scope; nothing here is required by Clique M1–M3 | The first post-bar application that needs one names the failing assertion; the continuation's boundary (what phase one commits, what the caller observes, whether phase two is synchronous) is specified before payments- or tournaments-shaped work is scheduled |
| 5. Authoring loop | Persona aliases over real principals, rule-derived allowed/denied tests, `why` / trace, and a secure Clique start packet | Two personas exercise the same production rules; hosted rejects `--as`; no silent-denied or partial-result path |
| 6. Identity expands only on demand | Guest claim, recovery, providers, assurance, and the *binding storage* for principal sets (a contact bound to a user) | A published bar or a real application supplies the requirement and boundedness proof |
| 7. Authorization expands only by the ledger | Hierarchy, principal sets in rules, two-hop `any`, `getHidden` in viewer-invoked programs, `principal.bearerOf`, engine-maintained relation projections, program-scoped write grants — each a Tier 2 row of the extension ledger in §"Coverage" | The admission rule in §"Coverage": a load-bearing scheduled application with its reduced product named; a lowering to the existing rule IR, trace, and certificate; a priced certificate line; a ledger row saying what leaves |

Do not gate these slices on Snapback 1 compatibility, a migration path, a
general auth catalog, or a universal authorization taxonomy. The promotion
bar is the implemented 1001+ spec plus the affected proof and benchmark
evidence, not this research document.

## Coverage — the model against the thirty-seven paper applications

The synthesis above was written from Clique. The founder's question for this
revision was whether the same model carries the rest of what Snapback 2 is
meant to run — the thirty-seven applications written, in the strict data
language, to design that language (LLP 0329.014.001, .002, .003, .005; the
verbatim design and v0 artifacts under `llp/reviews/0329.014.*`) — and, where
it does not, whether the gap closes with something bounded or only with
sprawl. This section is the audit and its answer. It changes nothing above
except the sentences the header lists; it adds a tier structure and an
admission rule.

### Method

**What was tested.** The core as fixed in this document: per-table
`read` / `insert` / `update(old, next)` / `delete` rules, default-deny; terms
over the row, one opaque scalar `viewer`, and literals; `==`, `!=`,
comparisons, `&&`, `||`, `!`, `public(reason)`; one bounded indexed
relational probe of depth one (`exists` on an index keyed by row fields,
`viewer`, or literals, optionally with a `where` on the found row); the
scoped relation row `{ scope, principal, role }` with a unique
`(scope, principal)` index and a closed enum; named programs that derive the
viewer; transaction-local creation provenance; the constraint set; the trace
as revocation; the no-oracle read and the single denied envelope.

**Against what.** Every authorization requirement each application stated,
quoted from its artifacts with a line number, classified as core (with
sub-labels for a `where`, a negation, or a denormalized scope id) or as one
of twenty fixed extension codes drawn from the RFC's wider vocabulary
(`llp/reviews/0331-coverage-audit.brief.md`), each with a *load-bearing or
droppable* judgement — droppable meaning the application's own artifact
names an honest reduced product without it. Eight audit slices ran as fresh
same-family subagents; two were cut by a session rate limit after finishing
two of five applications each, and the orchestrator completed the six
remaining applications by a targeted read
(`llp/reviews/0331-coverage-audit.w3-remainder.md`). This is a research
audit, not a cross-family LLP 0005 review; a cross-family pass over the
merged verdicts is the natural next review.

**Reading conventions the slices converged on**, which the 1001+ spec should
state rather than leave to interpretation: (a) several *independent* one-hop
probes composed with `&&` / `||` / `!` are core — depth is bounded, not count;
(b) a `where` on the found row may compare the found row's fields to the
subject row's fields, `viewer`, and literals with every comparison operator
(Coterie's former-member cutoff, the health design's consent coverage, the
booking design's cross-org equality, and the tournaments design's report
window all depend on it); (c) a scope-less `{ principal, role }` row probed
by `viewer` is a global role and is core; (d) "any authenticated viewer" is
the RFC's authenticated-not-public spelling; (e) a status column flipped by
the `schedule` kind is core on the rule side and is counted under the system
actor on the runtime side; (f) a column whose audience differs from its
row's is a protection-class table split (RFC §4 `E_SECRECY_MIX`), core, with
engine-maintained projections (RFC dimension O) as later sugar; (g) a key
built from two row fields by a pure shape function (the dating design's
ordered pair) is either admitted as a shape term or replaced by storing the
ordered columns.

### The thirty-seven applications

"Actor" is what must run that is not the signed-in viewer. Codes in
parentheses are the ledger's; the per-requirement tables with quotations are
in the slice artifacts.

| App (wave) | Human who-may rules | Actor beyond `viewer` | Verdict | Load-bearing beyond core (droppable) |
|---|---|---|---|---|
| Clique (1) | core; nine child tables denormalize `conversationId` | schedules for expiry, trending, digests; push and asset effects | covered-with-denorm + actor | actor beyond M3 (edit windows → schedule-flipped status; the `S()` kind-term disjunct) |
| Ledger (1) | core; the `expenseReaders` interval denorm is already in the design | none | covered-with-denorm | — |
| Coterie (1) | core, given convention (b) for the former-member cutoff | none in the schema | covered-with-denorm | — |
| Workspace (1) | nearest-ancestor grants with denials; link redemptions re-derived on every read | purge, link and lease expiry | needs hierarchy, bearer, actor | hierarchy (20 of 29 operations); bearer links (M7–M10); actor (re-derivation on read → redeem-time check; `+1` arithmetic → OCC; last owner → constraint; integer ranks → explicit sets) |
| Auction (1) | core: seller / bidder / system split by `(old, next)`; sealed commitments by ownership | the close ranks bids no user may read; schedules | needs actor | actor — the sealed close (anti-snipe arithmetic → system continuation or drop; wallet coupling → saga) |
| Booking (1) | core: org roles verbatim, `isManager` as an explicit set | hold and offer expiry, no-show marking; promotion-on-cancel reads other holders' rows | needs actor | actor including a hidden read on the viewer's behalf (cutoffs → schedule-flipped; strikes and last owner → constraints) |
| BI (2) | core as shipped (equality grants); team grants → per-member rows | SDK source credentials, the OLAP replica, exports, erasure | covered-with-denorm + actor + service principal | service principal (identity layer); actor (predicate-tree grants → equality grants, the v0's own change; download link → sign-in) |
| Game (2) | core: seat and spectator membership, `revealed` probes | closers read sealed envelopes; matchmaker; push feeder | needs actor only | actor (ingress grace → drop) |
| Health (2) | core after the protection-class split; care relationships, break-glass, holds as `{ scope, principal, state }` rows; consent coverage by convention (b) | retention and destruction, disposition, consent activation | covered-with-denorm + actor | actor (policy matrix as data → versioned rules; device posture → sessions; offline packet → online-only) |
| Payments (2) | core; eight tables denormalize an immutable wallet id | processor webhooks; hold expiry; a viewer-invoked transfer reads the destination's hidden debt | needs actor including a hidden probe | `callable: 'system'`, a webhook principal, `getHidden` (droppable only by a stated product change) |
| Semantic (2) | core except cross-team sharing (two hops) | indexing worker; sealed share checks | needs a two-hop probe or a product cap; bearer; actor | worker principal (identity) and actor (team-grant arm → home-team-only; ∀-sources → requester-private; links → sign-in) |
| Editor (2) | core; `docAccess` flattened onto child rows | push effect, prune job | needs bearer + actor | bearer links — link guests are a stated user class (`ctx.replica` → drop) |
| Graph (2) | second-degree reachability as authorization | hint and PYMK jobs, GitHub webhook | needs bounded two-hop `any` (or a maintained hop-2 relation); actor | two-hop `any` — "a project tracker with a friends list" without it; `dag` closure as integrity; actor (anonymous → sign-in) |
| Realtime (2) | core; `participants` split by audience; a friend-witness column | host process per epoch, payment webhook, matcher | needs host principal; actor | host and webhook as ordinary principals (pool classification → system matcher; join codes → invite) |
| Twitch (3) | core: interval-bounded channel grants as rows, role sets as booleans, negated bans | accrual, sampling, payout, automod finalization, head-row allocation | needs actor; strong time term refused | actor; the one application whose bar rejects schedule-flipped expiry — RFC dimension B refuses the time term and the v0 promises approximate expiry (anonymous device → sign-in; broadcast fan-out is runtime) |
| Dating (3) | core; messages denormalize `matchId` / `pairKey`; generation on the pair row | recommendation build, expiry, pair-event application | covered-with-denorm + actor | actor (push re-check as recipient → in-app only) |
| Events (3) | scoped role rows with exploded permission bits; a user acts through a *set* of bound contact principals — the v0 wrote a program-maintained `userAccess` closure at bind and claim, whose unbind repair is a `take: 50` worklist outside the transaction | promotion, refund and check-in windows, OTP and delivery ingress; the invite lookup reads a row the host may not list (an inferred footgun in the v0) | needs a set-valued principal (Tier 2 `existsAny`, or the closure relation with a capped, named revocation lag); contact or link principal; actor | contact/link principal at redemption (identity layer; P1); the principal set (P2 — the closure interim conflicts with the design's "when a binding ends, the former user loses that contact's rows" unless the repair is capped and acknowledged); actor (contact dedup → per-host mint) |
| Real estate (3) | core: independent, scoped, interval-bounded permission rows plus assignment rows | a system evaluator whose read scope the v0 spelled as a `reads:` view; feed promotion; PII destruction | needs actor | actor — the evaluator's read scope is the set of tables whose read rules admit `system` (ruling 0 as amended), which keeps the v0's embargo concern (its `reads:` view existed so "system is total" would not leak embargoed facts into alerts) as a per-table decision (anonymous submit → account; service identities → principals; decrypt capability → re-check) |
| eBay (3) | core: every party rule a one-hop `where`, secrets split, `noBids` negated | the fold rewrites another bidder's stand and notice; per-row close timers; processor webhook | needs actor | actor — the sealed fold (outbid-edge coupling → inside the continuation; arithmetic → program-written columns) |
| Prediction market (3) | core: every recusal a negated one-hop probe over the actor's own rows; roles as tables | matcher over hidden orders; resolution and payout jobs; secret tallies | needs actor | actor (MFA on withdraw → session-only; API keys → key-as-principal) |
| Fantasy (3) | core: owner rows, one-hop parent probes, operators and feeds as role tables; post-lock reveal by a `where` on the game's state | lock closer, scoring epochs, settlement, payout; non-client-callable ingest | covered-with-denorm + actor | actor; seat claim ↔ posting coupling as an event-coupled *constraint* (kinds → rows; column-level not required) |
| Brokerage (3) | core: `account_parties` verbatim, perms as booleans on the unique row; `accountId` denormalized onto children | venue inbox, schedulers; `PlaceOrder` reads the sealed risk mark | needs actor including a hidden probe | `getHidden` for the risk mark as stated (droppable to the delayed mark with a wider collar); dual control → single approver |
| Photos (3) | core: album membership, `shareLocation` as a one-hop `where`, location columns split; the partner set as a program-maintained relation | derive, reindex, purge, export jobs; the link is resolved by an effect into an ephemeral principal | covered-with-denorm + actor | actor (link viewer → effect-minted principal, the v0's own path) |
| Calendar (3) | core except group and org audiences (two hops) and the accountless guest | reminders re-checked as the recipient; address resolution must not reveal account existence | needs bounded `any` over the viewer's groups (the v0's own form — Tier 2) or a closure fan-out as the interim; a guest principal or bearer; actor including a hidden probe | group/org audiences (the v0 spells it `any(groupMemberships…, { take: 64, where: grant probe })`); the guest (contract 7); cross-org address lookup (`visibleTo` → in-app references; attribution → program discipline) |
| Uber (3) | core: party equality, one-hop `where`s, five audience view tables maintained by hand | dispatch, timeout closer, surge publisher, settlement | needs actor | actor (share-link viewer → sign-in; `ctx.device` → trust same-account devices) |
| DoorDash (3) | core: `scoped_grant` verbatim; three audience tables; `locationId` onto order children | dispatch, deadlines, settlement, payout, apply-result — eleven client-callable holes without `callable: 'system'` | covered-with-denorm + actor | actor (`callable: 'system'`) (projections → three tables; kinds → rows) |
| Fast-casual (3) | core: the scoped-role recipe; `storeId` / `stationId` denormalized | time-fired holds and orders; POS and processor ingress | needs actor | actor (guest link → authenticated invitation; POS credential → effect) |
| Tournaments (3) | core: `orgTos` / `tournamentTos` / `entryMembers` one hop after an `orgId` denorm; report visibility as three independent probes | round timers, payouts; confirm branches on the opponent's hidden report and writes opponents' rows | covered-with-denorm + actor including a hidden probe | actor including `probeHidden` for two-party consensus (unlisted → public without a listing index; split) |
| Notion (3) | hierarchical ACLs with inheritance breaks; groups as grant subjects; deny-wins | jobs, mention gating | needs hierarchy + principal sets; actor | hierarchy (the workspace *is* the product); groups (10,000-member tenants) (mention gating → read rule; last admin → product rule; links → invite; timed shares → none) |
| Cash (4) | server plane core: ownership, one device-role enum, a mint-only registry | settlement writer, sweeps, claim continuation | server plane needs actor; device plane outside this document's initial scope (RFC dimension P) | actor (program-owned writes); `verifySignature` as a runtime builtin — the device plane is dimension P |
| E2EE (4) | server plane core once the device is the principal: historical entitlement intervals as `where`d probes | sweep, push expansion | server plane needs a device principal; bearer for blobs; actor; device plane outside this document's initial scope (RFC dimension P) | per-device queues (a device principal bound to the account keeps rules core); blob capability (or `groupId` on the blob row); actor (revoke fan-out → `cap`) |
| Spreadsheet (4) | table rules core: rectangle grants as a `where`, roles and flags as a relation row | system recalc reads what the editor cannot; feeds; the `formulas` kind evaluates as a stored principal | covered-with-denorm + actor; evaluate-as inside the kind | actor (elevated formulas → remove; links → registered principals) |
| Vault (4) | server plane core: account membership, mailbox grants, delivery rows | delayed-release schedule, GC and compaction | server plane covered-with-denorm + actor; device plane outside this document's initial scope (RFC dimension P, its question 6) | actor (three route/GC/release tokens → relations) |
| Zero-trust (4) | core: nine facility-scoped roles as explicit sets, delegation, break-glass, audit audiences | 5 s sweeper, ingest effects; admissibility is a function of the commit instant over session- and device-scoped evidence | needs commit-fresh evidence and session/device terms; actor | `fresh(row, …, at: 'commit')` and session/device as terms (the product; agreement at the instant is "not this system") (four-eyes → single approver) |
| Multi-region (4) | core: `operators(region, user, role)` verbatim; auditors scope-less; `skuId` / `customerId` denorm | allocation events, heal, expiry, fence, rebalancing | server plane covered-with-denorm + actor | actor (operator-of-current-authority chain → capture the region at write); home, apply, quorum are dimension P |
| PIR (4) | control plane core | host receipts, epoch publication; a session-less drop admitted by a bearer proof | needs an anonymous principal with a proof; actor | the anonymous caller *with* a proof (sending does not name the sender); actor — every PIR read and write is the `oblivious` kind, outside the plane |
| Platform (4) | tenant scope, staff permission rows, install scope-grants, field ownership — all core-with-denorm | fan-out continuations, reactions, invoices; tenant-installed rules composed with the host's; an install as a principal; two principals per execution | needs rule composition (dimension Q); an install principal; actor | dimension Q (a platform without it is a webhook platform); the install as an ordinary principal; actor (`ctx.initiator` → app scopes regardless of the clicker, the industry default) |

### What the audit says

**1. The relationship recipe holds.** The human who-may rules of thirty-one
applications are the recipe outright — scoped relation rows, owner fields,
one-hop probes with a `where`, negated probes, `(old, next)`, `public(reason)`,
scope-less role tables — once immutable scope ids are denormalized onto child
rows and secret columns are split into their own tables. Three more (events,
calendar, the professional graph) need a genuine second hop or a set-valued
principal. The events v0 wrote a `userAccess` closure at bind and claim
rather than asking rules to union a user's bound contacts — but its unbind
repair is a `take: 50` worklist outside the transaction and its claim returns
`mergeWork: 'pending'`, against the design's requirement that a former user
lose the contact's rows when the binding ends; the calendar v0 uses the RFC's
bounded `any` over the viewer's groups with a grant probe in its `where`; the
graph's second hop is the same `any`. Those three are Tier 2 as stated, with
the closure relation as an interim whose revocation lag must be capped and
named. Two (the document workspace, Notion-style databases) need hierarchy,
and both are load-bearing on it. One (the app platform) needs rules composed
from several authors, which the RFC admits as dimension Q and this document
leaves outside the initial Snapback 2 scope. No application needed a role lattice: the
largest role vocabulary was nine facility roles, and every `>=` in the corpus
reduced to an explicit set. No application needed a `principal.kind` term in
a rule. Two holes that every wave-1 design left open — a permanent creator
fact that lets a departed creator re-seat itself, and a self-clause that
admits raw self-promotion — are closed by this document's own core
(transaction-local provenance; `(old, next)`).

**2. The missing thing is an actor, not a shape.** Thirty-six of the
thirty-seven applications invoke something that is not a signed-in human;
only the ledger has no schedule, job, or effect, and Coterie's three upload
effects touch no table a user rule denies. Counted by what matters to the
rule language — a system principal reading or writing rows no user rule
admits — the number is thirty-three, and the hidden read inside a
viewer-invoked program is about five. The need has three faces, in
decreasing frequency: (c) schedules, jobs, and effect
ingress that write rows no user rule admits and read rows no user may read
(auction close, booking expiry, game closers, dispatch, settlement, payout,
recommendation build — thirty-three applications, load-bearing in every one);
(b) programs that must not be client-callable (`callable: 'system'` — the
DoorDash v0 counts eleven holes without it); (a) a *viewer-invoked* program
that must branch on or write a row the viewer cannot read — the payments
transfer reading the destination's hidden debt, the tournament confirm
branching on the opponent's report, the calendar organizer addressing an
account it may not see, the booking member's cancel promoting another
holder — nine mentions, load-bearing in about five. The synthesis above says
nothing about any of these because its slice stops at Clique M3; but the
`schedule` kind is on `rules/NOT-DOING.md`'s doing-list before the bar, so
the question is already open. The v0s that need privileged system writes
spell the answer as `|| principal.kind === 'system'` on every table a
schedule touches. That is the one extension this revision admits (Tier 1
below). It is a reserved principal plus an invocation policy, not a kind
taxonomy, not a second evaluator, and not Snapback 1's roster or facade.
The Codex delta review found the first form of ruling 0 — a per-program
declared view that grants what table rules deny — inconsistent with the
one-locus model, and the author amended it: the system principal is *named
by the table rules* it needs, the form every v0 with privileged system
writes used.

**3. Guests and links are an identity-layer principal.** Seventeen
applications mention a bearer capability — invite links, share links, join
codes, magic links, decrypt and GC tokens. Counted by *product promise* — the
artifact promises access to someone with no account — eight depend on one
(workspace, editor, calendar, events, Uber's live share map, photos' link
viewer, E2EE attachments, PIR). Counted by *rule-language need* — a bearer
term still required after the identity layer mints a principal at redemption
— the number is one or two: PIR, whose drop must have no session by design,
and any product that refuses to give a share-map viewer a session. The first
draft's "six" mixed those two denominators (Codex delta review, Part A item
3). Every audit found two bounded forms: the RFC's `unique(…, { bearer: true })` index with
`principal.bearerOf` as a rule input, or the identity kind minting an
ordinary principal when the link is redeemed (the events v0's "link session
is a contact principal, never a user"; the photos v0's effect that resolves a
token to an ephemeral principal; this document's own guest-claim shape). The
second form changes the identity boundary and leaves the rule grammar at
`{ row, viewer }`; the first adds a rule input that is also a
possession-based authority the trace must carry. This revision takes the
second as the paved form and defers `bearerOf` to Tier 2 for the cases where
possession must admit without any session at all (the PIR drop; a share map
viewed without signing in) — a stated product loss until then.

**4. Hierarchy and principal sets are real and rare.** Hierarchy is
load-bearing in two applications (workspace, Notion) and appears as integrity
in one more (the graph's `dag`). Principal sets — a user acting through
several bound contacts, groups as grant subjects — are load-bearing in
Notion and appear in events and calendar, where a program-maintained closure
relation keeps the rules one-hop at the cost of a fan-out the program owns.
Both are RFC dimensions (E, N) with unmeasured lowerings (`nearest`, `dag`
amplification, the bounded principal closure). They are Tier 2: each waits
for a scheduled application of its shape and a measured lowering, and the
closure-table recipe is documented as the interim.

**5. Nothing else was load-bearing on the server plane, or it is outside the
system.** Time-bounded authority appears in nearly every application and is
core everywhere but Twitch once the window is a status a schedule flips; the
Twitch design's bar — a timeout exact at the commit instant with no job
flipping a flag — is the one demand for a time term in a rule, which RFC
dimension B refuses and the Twitch v0 answers by promising approximate
expiry. Count-shaped invariants (a last owner remains, at most N admins,
dual control) are transaction-final constraints, which the core already
admits, never rule terms. Event-coupled writes (a seat claim must be paid
for; a notice only on the outbid edge) are the RFC's constraint class or an
alternative lowering of the system continuation — never additive.
Permissions-as-data was droppable in both applications that stated it (BI,
health) by their own concessions and is inside dimension Q for the platform.
Audience projections were a table split in every one of the twelve
applications that had one. Session and device as rule terms are load-bearing
in zero-trust (the commit-instant product) and, narrowly, in E2EE's
per-device queues — where a device principal bound to the account keeps the
grammar unchanged. Commit-instant oracle agreement, the PIR mechanism, and
cryptographic double-spend impossibility are outside this system by the RFC's
§9 verdict. Device-plane evaluation (dimension P), tenant rule composition
(dimension Q), and multi-region quorum are dimensions the RFC *admits*; this
document leaves them outside the initial Snapback 2 authorization scope as
its own proposal ("Delta from LLP 0329.014.004" below), and none is charged
to the core.

**6. Two things the corpus teaches about the pit of success.**
Denormalization is cheap and under-used: about twenty applications had a
two-hop rule as written, and in all but four the fix is one immutable scope
id copied by the named program — a column the design usually already carried
on a sibling table. `check` should propose it: a rule that chains a probe
through a found row is refused with the column pasted, not admitted with a
per-row probe budget. And the `|| S()` disjunct on every schedule-touched
table is the same "handler `if`" this document's diary findings warn about,
transposed into rules — and under ruling 0 as amended it is also the
visible record of where the system may act, one reviewable clause per
table, which is the point. What must not recur is the v0s' spelling of it
as a *kind* test (`principal.kind === 'system'`), the seed of a taxonomy;
the reserved principal is compared as a literal.

### The extension ledger

Counts are of thirty-seven applications; "mentioned" includes droppable
appearances. Dispositions are this revision's proposal for the 1001+ spec.

| Code | Extension | Mentioned / load-bearing | Smallest bounded form | Disposition |
|---|---|---|---|---|
| X11 | A non-human actor: schedules, jobs, effect ingress, and same-commit continuations under a system principal; non-client-callable programs; a viewer-invoked program reading a hidden row | 36 invoke a non-human / 33 need privileged table access (face (a) alone: 9 / ~5) | one reserved system principal, named by the rules of the tables it must touch (a `viewer === system` disjunct), never a kind test; `callable: 'system'`; `phase: 'system'`; no per-program grant view (the certificate's read and write sites describe, they do not authorize); `getHidden` as the scoped spelling for face (a): control flow and writes only, never returned, certificate-marked, prediction `partial` | **Tier 1** (faces b, c, and the continuation — ruling 0 as amended); face (a) Tier 2, the continuation as its interim where honest (ruling 3); EAS: 161 of 168 production policies name the system context, 218 in-program escalation sites, and 31 of 35 jobs run as the *dispatching* principal — jobs may run as the re-minted enqueuing viewer (E-b, ruled) |
| X4 | Bearer capability | 17 / 8 by product promise; 1–2 as a rule term after the identity form | the identity kind mints a principal at redemption (guest claim); `unique(…, { bearer: true })` + `principal.bearerOf` for session-less possession | identity layer now (ruling 2); `bearerOf` **Tier 2** |
| X3 (ordinary) | Non-human, anonymous, contact, device, API-key, install principals | ~18 / ~8 | an ordinary opaque `Principal` with a server-minted session, named in rules as a column value or `viewer` | **Tier 0** clarification — no rule-language change |
| X3 (sets) | A principal acting through a bounded set of bindings; groups as subjects | 3 / 3 (Notion, events, calendar) | `existsAny(index, { principalIn: viewer.bindings })` over a capped binding set, or an engine-maintained `maintain.rows`; a program-maintained closure relation as an interim with a capped, named revocation lag | **Tier 2**; closure interim documented with its loss |
| X2 | Hierarchy: nearest-ancestor grants, inherited columns, DAG closure | 3 / 2 (+ EAS for the inherited column) | `nearest` over `tree` / `dag` with certificate-reported `engineWrites`; single-column `inherits` over a `ref` | `nearest` **Tier 2**; `inherits` **Tier 1** (E-a) |
| X1 | Multi-hop probe | ~20 / 4 (+ EAS: some 270 uses through a *mutable* parent) | denormalize the immutable scope id; `any(index, prefix, { take ≤ cap, where })` for genuine second hops (graph, calendar audiences); `inherits(fk)` when the parent's scope column is rewritten by a program (EAS project transfer) | denorm **Tier 0** for an immutable scope — `check` refuses the two-hop rule with the column and its cross-column constraint pasted (ruling 4); single-column `inherits` **Tier 1** for a mutable one (E-a); `any` **Tier 2** |
| X6 (weak) | Time-bounded authority as a schedule-flipped status | ~30 / — | a status column + the `schedule` kind | **Tier 0** rule side; X11 runtime side |
| X6 (strong) | A time term in a rule (interval containment at `commitTime`) | 1 / 1 (Twitch) | — | **refused** (RFC dimension B); the product states approximate expiry |
| X6 (where) | A `where` comparing the found row to the subject row | 5 / 5 | convention (b) | **Tier 0** (ruling 1) |
| X20-S | Pure shape functions in probe keys (the dating pair key) | 1 / 0 | the RFC's versioned stdlib (`orderedPair`, `idMod`, `hashToInt`) in key terms; nothing user-defined | **Tier 0** when the stdlib lands (ruling 5) |
| X5 | Audience projection | 12 / 0 | protection-class table split; RFC dimension O projections as sugar | split **Tier 0**; projections later |
| X17 | Count-shaped authority | ~8 / 0 | transaction-final `cap` / `atLeast` constraints | constraint class, not a rule term |
| X19 | Event-coupled two-row write; deletion cascades | ~8 / 0 as a rule (+ EAS: 70 cascade-provenance rule instantiations, 249 cascade edges) | RFC §4 event-coupled transitions; or the system continuation; a schema-declared cascade edge as an engine write | constraint class; alternative to X11; the cascade edge is **Tier 0** provenance (E-c, ruled) |
| X15 | Role lattice / role comparison | ~5 / 0 | explicit sets | **refused** |
| X16 | Permissions or rules as data | 3 / 0 (platform: inside Q) | versioned rules; equality grants | **refused** outside Q |
| X13 | Engine-maintained authority relations / fan-out | 6 / 1 (E2EE at scale) (+ EAS: the attenuated worker token, ~80 policies; app transfer as `propagate`) | program-maintained relation (interim); `maintain.rows`, `propagate` | **Tier 2** sugar over the closure recipe |
| X9 | Session, device, freshness as rule terms | 6 / 2 (+ EAS: staff mode on ~123 policies, sudo on 9 programs — reducible to a sibling staff principal) | a device principal bound to the account (E2EE); a staff principal minted at step-up (EAS); `fresh(row, …, at: 'commit')` for zero-trust | device principal **Tier 0**; `fresh` outside the M1–M3 system |
| X20-W | Program-scoped write grants (`writers: [...]`) | ~6 / 0 as a rule-locus feature | named-program write grants (RFC dimension C); the one-locus forms are event-coupled constraints (RFC §4) and the system continuation | listed under **Tier 2** but not admissible through the rule: a second locus, refused by ruling 0 as amended; needs a fresh ruling |
| X8 | Rule ownership and composition | 1 / 1 (platform) | RFC dimension Q | **out** of this system's scope |
| X10 | Device-plane rule evaluation | 4 / 4 (wave 4) | RFC dimension P | **out** |
| X18 | Rules over ranked or geo sites | 1 / 0 | the site class, not a rule | not an authorization item |

### Tiers and the admission rule

**Tier 0 — the core, implemented for Clique M1–M3.** The synthesis above,
with the seven reading conventions stated in the spec (ruling 1), the
denormalization rewrite emitted by `check` for an immutable scope (ruling
4), and transaction-local creation provenance. Its deletion mirror — the
declared cascade edge (E-c) — belongs to the same class but is not needed
for Clique M1–M3 (M3 deletes no populated group) and enters with the first
application that deletes a parent scope (sequence row 4c). Rule inputs: the row
(`old` / `next` on update), `viewer`, literals; key terms may use the RFC's
versioned standard-library shape functions and nothing user-defined (ruling
5). One probe form: `exists`, depth one, with a `where` over found row ×
subject row × `viewer` × literals. No kind, time, count, or program-name term.

**Tier 1 — the system actor, admitted by this audit and ratified by the
author (ruling 0).** One reserved system principal under which schedules,
jobs, and effect ingress run — or, ruled on the Expo/EAS evidence (E-b),
under which they run as the **enqueuing viewer re-minted** by the identity
layer with a bounded lifetime, so that a job carries its requester's
authority and attribution and its tables need no `system` disjunct (31 of
35 EAS jobs run that way). Re-minting is not a snapshot: the job's
relation rows are read live when it runs (the trace), a principal disabled
or a session revoked before the run refuses the job, step-up state (sudo,
staff mode) is never copied into a job principal, a retry cannot extend the
original bound, and the trace records `enqueuedBy`, `runAs`, the authority
epoch, and the expiry — EAS today copies a sudo bit into a 30-minute
envelope, which is the hole this rules out. And under which the **same-commit
continuation** of a viewer's program runs (the RFC's `phase: 'system'`: the
viewer's half commits the intent, the system half reads what the viewer may
not and writes what no user rule admits, and the certificate is the pair;
eBay's fold, the auction's anti-snipe, and the tournament confirm are its
shape); `callable: 'system'` on a program refuses client invocation; **a
table whose rows a system program must read or write says so in its own
rule** — one disjunct, `|| viewer === system`, reviewable in the schema — so
table policy stays the only locus and the certificate's `readSites` /
`writeSites` describe what a program touches without granting anything;
rules never test a principal *kind* (the reserved principal is an ordinary
literal term; the spike's `PrincipalKind` term is deleted, not kept as a
lowering). Its cost is one visible disjunct per system-touched table and one
reserved principal; its evidence is
thirty-three load-bearing applications and the `schedule` kind already on
the doing-list. It adds no storage, no roster, no session claim, no generated
facade, and no second evaluator.

**One trusted domain.** Naming `system` in a table rule admits *every*
system program to that table; the auction v0 says so of its own wallet rule
— "which also admits any other scheduled mutation that patches any wallet"
(`llp/reviews/0329.014.001-paper-archetypes.grok-auction.md:730`). This
document accepts that consequence rather than hiding it: system programs
are one fully trusted domain, as Snapback 1's server code is, and what
isolates them is review and the certificate, not a per-program grant. Each
system program's `writeSites` and `readSites` are listed and reviewed; and
the RFC's negative and flow claims — `independentOf(table)` and the taint
check that hidden inputs cannot escape through fields, refusal codes, or
failure detail (RFC §2.1) — are required of every system program whose
reads exceed what its callers may see, so that a system continuation cannot
launder a sealed bid or a hidden debt into a visible field. A finer
per-program grant is exactly the second locus the amendment refused; if a
bar ever needs it, that is a fresh ruling reopening the one-locus model, not
an entry through the admission rule.

**Tier 1, second entry — single-column `inherits` over a `ref` (E-a).**
Ruling 4's rewrite assumes the scope column a child copies is immutable.
The Expo/EAS audit found the one column every EAS chain shares —
`apps.accountId` — rewritten by project transfer under some 270 rule uses,
and product → account → resource with transfer is the shape of every
developer-tool SaaS. So: when a two-hop rule's intermediate scope column is
written by any program, `check` refuses the copy and pastes
`inherits(<parent>, '<column>')` instead — the engine copies the parent's
scope onto the child at insert and rewrites every copy in the parent's own
commit, the certificate reports the fan-out as `engineWrites`, and the
child's rule is one hop again. It is the admission rule's third class (an
engine-maintained *derived field*, declared in the schema, readable through
the child table's own rules); the tree walk (`nearest`) stays Tier 2. Two
obligations come with it. **The copy is the scope, not the verdict:** where
the parent table has a rule of its own beyond the scope check, the child's
rule keeps a one-hop probe of the parent (`exists(apps, [row.appId]) where
<the app's read rule>`), and `check` may elide it only when it proves the
parent's rule implied by the child's — a proof invalidated when the parent's
rule changes (EAS loads every intermediate with the viewer's authorization,
and its app schema reserves per-project privacy). **Admission status:**
ruled by the author in principle (E-a); it is not needed for Clique M1–M3
and enters the implemented spec only when the admission rule's conditions 1
and 4 are met by the first application that transfers a parent scope — a
scheduled 1001+ spec with an implementer and date, the failing assertion
named, and a doing-list trade — which also owns the lowering and its
measurement.

**Tier 2 — dimension-level; each row enters only through the admission rule
below.** Hierarchy as a bounded traversal (`nearest` over `tree` / `dag`;
workspace, Notion — single-column `inherits` over a `ref` is Tier 1 by
E-a); principal sets (`existsAny` over bindings; Notion); bounded two-hop `any` (graph;
calendar audiences); `getHidden` in viewer-invoked programs (payments,
tournaments, calendar, booking, brokerage — a scoped read beyond the
viewer's rules, certificate-marked, never returned; the same-commit
continuation is the interim where honest, ruling 3);
`principal.bearerOf` (session-less possession; the guest or contact
principal minted at redemption is the paved form, ruling 2); engine-
maintained relation projections replacing program-maintained closure
tables (`maintain.rows`, `propagate`, the tree/dag closures — the third
admissible class of the rule below); and, listed so the RFC's dimension C is
not silently dropped, program-scoped write grants — which **cannot enter
through the admission rule as written**, because they are a second
authorization locus, the thing ruling 0 as amended refuses; entering them
would require reopening that ruling, not satisfying this rule. Until a row
enters, its interim recipe
is documented beside it (closure table, with its revocation lag capped and
named; denormalization; guest principal; schedule-flipped status). The
same-commit continuation is the interim for the hidden read in tournaments,
booking, and calendar; it is *not* an honest interim for payments or
brokerage, whose designs require the hidden-dependent outcome inside the
viewer's own atomic commit (the payments v0 marks the scheduled-recovery
rewrite a violation of I7/I20) — those carry the stated product loss until
`getHidden` enters.

**Refused, with the product loss named.** A time term in rules (Twitch:
approximate expiry); a role lattice (never load-bearing; explicit sets); a
principal-kind term in rules (never needed: the reserved system principal
is compared as a literal by the table rules that admit it); permissions as data outside dimension Q (BI, health: versioned
rules); a second membership store, a private roster, or a generated
operation facade (this document's opening recommendation, unchanged).

**Outside the initial Snapback 2 authorization scope.** Commit-instant oracle
agreement, the PIR mechanism, and cryptographic double-spend impossibility —
the RFC's own "not this system" verdicts (§9). Device-plane evaluation
(dimension P), tenant rule composition (dimension Q), and multi-region quorum
— dimensions the RFC admits and leaves open (its question 6), which this
document proposes to leave out until a bar asks; that is a scope decision of
this document, not an RFC verdict. An application that needs one is a
different product boundary, not a gap in the recipe.

**The admission rule.** An authorization extension enters the Snapback 2
rule language only when all four hold:

1. A scheduled 1001+ spec with an implementer and a date names a product
   assertion that fails without it — a benchmark milestone, or a corpus
   application actually being built — and the honest reduced product without
   it is written beside the row. The paper corpus alone does not satisfy
   this: thirty-seven designs would admit everything.
2. It lowers to the existing rule IR, trace, and certificate as one of three
   things: a new rule *input*, a new *bounded probe* form, or an
   *engine-maintained derived field or relation* declared in the schema —
   a relation readable only through its own rules, or a field readable
   through the rules of the table it lives on; written only by the engine;
   its write amplification reported in the certificate (`engineWrites`), as
   the RFC's `tree` / `dag` closures, `tree.inherit`, and `maintain.rows`
   already are. Never as
   hidden storage, a private roster, a session claim, a generated facade, a
   second authorization locus, or a second evaluator.
3. `check` prices it: the certificate reports the input, the probe bound,
   or — for a derived field or relation — the engine write's amplification
   (`engineWrites`), and the refusal names the ceiling and pastes the
   rewrite.
4. Something comes off the doing-list in the same change, named in the
   ledger row; if nothing can, the answer is no (`rules/NOT-DOING.md`).

**The budget after Tier 1.** Rule inputs `{ row, viewer, literals }` (key
terms may apply the versioned stdlib shape functions); probe forms
`{ exists }`; reserved principals `{ system }`, which may appear in a rule
only as a literal compared with `viewer` — never as a `principal.kind` test;
program declarations `{ callable, phase }`. Every Tier 2 row adds exactly
one input, one probe form, or one declared engine-maintained relation, and
must say which — and must state the *authority* it can carry (which rows it
admits that `viewer` alone could not), since one hidden input or bearer term
carries more than several ordinary probes.

### Open questions from the audit

1. Convention (b) — a `where` comparing the found row to the subject row —
   decides Coterie's former-member read, the health consent coverage, and the
   tournaments report window. Should the 1001+ spec admit it outright, or
   restrict `where` to literals and `viewer` and route those four through a
   denormalized status?
2. Is the guest/contact principal minted at link redemption the paved form
   for every bearer case except session-less possession (PIR; an unsigned
   share map), and does that leave `bearerOf` with any M-series demand?
3. Should `getHidden` in a viewer-invoked program be admitted with Tier 1,
   since it is the same declared-view lowering, or held to Tier 2 until a
   payments- or tournaments-shaped application is scheduled?
4. Should `check` refuse a two-hop rule with the denormalization pasted (the
   pit-of-success reading of finding 6), or admit it under a per-row probe
   budget as the RFC's `any` hoisting allows?
5. Are pure shape functions in probe keys (the dating design's ordered pair;
   the RFC's `orderedPair`) a Tier 0 term or a reason to store the ordered
   columns?
6. A cross-family review of the merged verdicts has not been run; which
   verdicts are most likely to move — the load-bearing calls on hierarchy
   (two applications) and on `getHidden` (five) are the ones the tiering
   rests on.

### Author rulings (2026-08-30)

Ruled by the founder after a walk-through of each question with the
orchestrator's recommendation and confidence. The rulings are binding on
this document's proposal; per the Snapback2 fence they bind Snapback 2 only
through the implemented 1001+ spec.

| # | Ruling | Author's confidence | What it changes |
|---|---|---|---|
| 0 | **Ratified.** Tier 1 is the system actor: one reserved principal; `callable: 'system'`; schedules, jobs, effect ingress, and the same-commit continuation (`phase: 'system'`) run as it; no kind term in rules. **Amended 2026-08-30:** the system principal is named by the rules of the tables it must touch (a `viewer === system` disjunct); there is no per-program `reads:` / `writes:` grant view — the certificate's read and write sites describe, they do not authorize; program-scoped write grants stay Tier 2. | firm (amendment: firm) | Tier 1 text, the model table, sequence row 4b, the budget, ledger X11 |
| 1 | **Admitted.** A `where` may compare the found row's fields to the subject row's fields, `viewer`, and literals with every comparison operator; no arithmetic in rules. | firm | reading convention (b) is Tier 0; Coterie's cutoff, health consent coverage, booking cross-org equality, workspace `pathAtMint`, tournaments report window are core |
| 2 | **Paved form (A):** the identity kind mints a guest or contact principal at link redemption and writes an ordinary relation row; `principal.bearerOf` deferred to Tier 2 for session-less possession. | provisional — "not sure, but the recommendation seems ok" | ledger X4; the model table's "Guests and links" row; session-less viewing (an unsigned share map, an unlisted bracket) is a stated product loss until a bar asks for it |
| 3 | **Hold `getHidden` at Tier 2 for now;** the same-commit system continuation is the interim for the applications that need a hidden read inside a viewer-invoked program. The Codex delta review narrows this: the continuation is honest for tournaments, booking, and calendar, not for payments or brokerage (atomic hidden-dependent outcome); those carry the stated product loss. | provisional — "ok for now" | ledger X11 face (a); revisit when a payments- or tournaments-shaped application is scheduled, at which point `getHidden` is a one-line admission on the same lowering |
| 4 | **Refuse two-hop rules with the rewrite pasted:** `check` names the immutable scope column to add, the copy at insert, and emits the cross-column constraint so the copy cannot drift; genuine second hops wait for Tier 2's `any`. | firm | ledger X1; Tier 0 text; the Clique template ships with the columns in place so the refusal is paid by the template, not the agent |
| 5 | **Admit only the RFC's versioned stdlib shape functions in key terms** (`orderedPair`, `idMod`, `hashToInt`), nothing user-defined, when the stdlib lands. | firm, low stakes | ledger X20-S; the budget line |
| 6 | **Run the cross-family review,** scoped to §"Coverage", the ledger, and the verdicts the tiering rests on (the two hierarchy calls, the five `getHidden` calls, the bearer reduction, the Twitch time-term refusal). | firm | ran 2026-08-30 as `llp/reviews/0331-coverage-audit.codex.md` — round 1 **NOT READY** (Part A 5 agree / 3 disagree; 5 MATERIAL + 1 MINOR), round 2 **NOT READY** (4 resolved / 4 partly; 3 MATERIAL, all folded), round 3 **NOT READY** (3 resolved / 1 partly; 1 new MATERIAL — two delta-table rows, folded), round 4 **NOT READY** (residuals resolved; one contradiction in pre-existing text between the admission rule and Tier 2's engine-maintained rows, folded); dispositions below; loop escalated to the author after four rounds |
| E-a | **Ruled (Expo/EAS audit).** When a two-hop rule's intermediate scope column is written by any program, `check` pastes `inherits(<parent>, '<column>')` instead of a copy; single-column `inherits` over a `ref` is admitted in principle as the admission rule's third class (an engine-maintained derived field; Tier 1, second entry, after the bar), the parent's own rule stays conjoined unless proved implied, and it enters the implemented spec when conditions 1 and 4 are met by the first transferring application; the tree walk stays Tier 2. | firm ("your proposals seem solid") | ruling 4 narrowed to immutable scopes; the third class generalized to "derived field or relation"; Tier 1; the model table; sequence row 4c; ledger X1, X2; the delta table |
| E-b | **Ruled.** A job, schedule, or continuation runs as `system` or as the enqueuing viewer re-minted by the identity layer with a bounded lifetime; rules see only `viewer`. | firm | Tier 1; the model table; sequence rows 4b/4c; ledger X11 |
| E-c | **Ruled.** Transaction-local provenance extends to deletion: a cascade edge declared on the child table, as part of that table's own mutation policy, is an engine write authorized by the parent's delete rule and priced as a certificate cascade line; a cascade exceeding one commit becomes a system continuation; not needed for the bar. | firm | Tier 0 (placement), the recipe's provenance bullet, sequence row 4c, ledger X19 |
| E-d | **Ruled.** The identity kind may rebind an invitation's contact principal to a user at a verified e-mail claim. | firm, low stakes | the account model's "e-mail is never a link key" paragraph |

### Delta from LLP 0329.014.004

The RFC is Draft and authorizes nothing; this document narrows it for the
initial Snapback 2 authorization scope. Every narrowing of the RFC's
rule-language and program-input vocabulary that bears on authorization is
listed so the 1001+ spec inherits a stated delta, not a silent one.

| RFC (§3, §2.2, §9) | This document | Why |
|---|---|---|
| admits `principal.kind` as a rule term | refused; one reserved system principal, never a kind predicate | every corpus use was `=== 'system'`; a kind taxonomy invites roles-in-sessions (ruling 0) |
| admits `principal.bearerOf` | Tier 2; the identity kind mints a principal at redemption | 1–2 applications need a bearer *term* after the identity form (ruling 2) |
| admits `db.getHidden` | Tier 2; the continuation is the interim where it is honest | ~5 applications; none before the bar (ruling 3) |
| admits `any(index, prefix, { take, where })` and `nearest` / `inherits` | `any` and `nearest` Tier 2; single-column `inherits` over a `ref` Tier 1 (E-a); `check` refuses two-hop rules with the denormalization pasted when the scope is immutable, with `inherits` pasted when it is not | ~20 two-hop rules in the paper corpus, 4 genuine (ruling 4); some 270 through a mutable parent in EAS (E-a) |
| admits a `where` on the found row | admitted, with subject-row terms stated explicitly | ruling 1 |
| versioned stdlib shape functions | admitted in key terms only | ruling 5 |
| dimension P (device-plane authority) — open question 6 | outside the initial scope | a scope decision here, not an RFC verdict |
| dimension Q (rule ownership and composition) | outside the initial scope | same |
| multi-region quorum as a host boundary | outside the initial scope | same |
| "not this system": cash double-spend, commit-instant oracle agreement, PIR | inherited as stated | RFC §9 |
| dimension L: a per-mutation `reads:` view so "system is total" is not the only alternative | no per-program grant view; the system principal is an ordinary principal that table rules name where it may act | one locus (ruling 0 as amended) |
| admits `ctx.replica` as a rule input (§3) | not admitted; a device or replica is an ordinary principal bound to the account where an application needs one | the E2EE and editor audits: a device principal keeps the grammar unchanged |
| dimensions N and G: `ctx.session`, `ctx.device`, `fresh(row, …, at: 'commit')` as rule terms | outside the initial scope on the server plane | load-bearing only in zero-trust (commit-instant evidence) and, narrowly, E2EE (per-device queues, reducible to a device principal) |
| dimension C: named-program write grants | listed under Tier 2 but not admissible through the admission rule (a second locus, refused by ruling 0 as amended); the one-locus forms are event-coupled constraints and the system continuation | no application is load-bearing on it as a rule-locus feature |
| dimension N: a bounded principal closure in rules (`existsAny(index, { principalIn: viewer.bindings })`) | Tier 2 (principal sets), with the program-maintained closure relation as an interim whose revocation lag is capped and named | load-bearing in Notion, events, calendar (ruling 2's sibling; ledger X3 sets) |
| dimension E (v1.2): `propagate({ from, onto, along })` as an engine write for authority fan-out | Tier 2 (engine-maintained authority relations; ledger X13) | load-bearing only in E2EE at stated scale; the interim is a program-maintained relation or `cap({ by })` |
| v1.2 program inputs: `db.evaluate(rule, { as, asOf })`, `verifySignature`, `crypto.oprf`, the device keyring | not authorization scope here (dimensions D, P) | listed so the delta is complete |

### Codex delta-review dispositions (round 1, 2026-08-30)

Verbatim artifact: `llp/reviews/0331-coverage-audit.codex.md` (NOT READY).
This fold does not change `Status`.

| Concern | Disposition |
|---|---|
| Part A item 3 — the bearer count mixed product-promise and rule-term denominators (Uber, photos excluded; events included) | FOLDED: finding 3 and ledger X4 now give both denominators (8 by promise; 1–2 as a term) |
| Part A item 6 / MATERIAL 3 — Tier 1 not shown minimal; a per-program `reads:` / `writes:` view that grants what table rules deny is a second locus, and Tier 2's "program-scoped write grants" already sits inside Tier 1 | FOLDED as an **amendment to ruling 0** (ruled by the author 2026-08-30): table rules name the system principal; no per-program grant view; Tier 1, the model table, sequence row 4b, the budget, and ledger X11 updated |
| Part A item 8 / MATERIAL 2 — the events closure is not core-safe (unbind repair is a `take: 50` worklist; claim returns `mergeWork: 'pending'`; the design requires immediate loss); the calendar v0 used `any`, not a closure | FOLDED: events and calendar moved to Tier 2 in the Summary, finding 1, the account-model paragraph, the table, and ledger X3 (sets); the closure is an interim with a capped, named revocation lag; "shipped" replaced |
| MATERIAL 1 — headline counts without stable denominators; "35/37" conflated invocation with privileged access; Coterie has three upload effects | FOLDED: 36 invoke a non-human / 33 need privileged access / ~5 hidden reads; Coterie corrected; the 31-app figure is stated as the human who-may axis only |
| MATERIAL 4 — silent reversals of the RFC; "outside by the RFC's verdict" misstated for P, Q, multi-region | FOLDED: "Delta from LLP 0329.014.004" table; finding 5 and the "Outside" paragraph distinguish RFC verdicts from this document's scope decisions |
| MATERIAL 5 — the admission rule admits any corpus app; condition 4's "why nothing can" contradicts NOT-DOING; the budget is syntactic; row 4b over-admits before the bar; rows 6/7 blur binding storage and rule input | FOLDED: condition 1 requires a scheduled spec with implementer and date and a failing assertion; condition 4 requires a real trade; the budget states the authority an input carries; row 4b split into 4b (schedule actor, pre-bar) and 4c (the rest, post-bar); row 6 names binding storage |
| MINOR — "every v0" too broad; events contact lookup stated as fact from an inferred line | FOLDED: finding 2 reworded; the events row marks the lookup inferred |
| Part A item 4 note — the continuation is honest only if the viewer phase does not commit the hidden-dependent outcome; payments rejects after-the-fact repair | FOLDED into ruling 3's row and the Tier 2 interim text |
| Open question 1 — is `phase: 'system'` a second enqueued transaction or an elevated phase inside one? | NOTED as a 1001+ spec question (sequence row 4c); the RFC's wording ("a continuation enqueued in the same commit") reads as the former, which is why payments and brokerage are excluded from the interim |

### Codex delta-review dispositions (round 2, 2026-08-30)

Verbatim artifact: the dated round-2 section of
`llp/reviews/0331-coverage-audit.codex.md` (NOT READY; Part A 4 resolved / 4
partly / 0 unresolved; 3 MATERIAL).

| Concern | Disposition |
|---|---|
| Part A 2 / MATERIAL 1 — the amendment was not consistently folded: stale "declared view" language in finding 6, the Tier 2 `getHidden` entry, the refused list, and the Real Estate row; the budget said `system` is "never in a rule", contradicting `viewer === system` | FOLDED: all five spots rewritten; the budget now says the reserved principal may appear only as a literal compared with `viewer`, never as a kind test |
| MATERIAL 2 — one reserved system principal makes every system program authoritative over every system-admitting table; descriptive certificate sites do not constrain disclosure flows | FOLDED: Tier 1 gains "One trusted domain" — the consequence is accepted explicitly, the auction v0's warning is cited, the certificate's write and read sites plus the RFC's negative/flow claims are required of system programs whose reads exceed their callers', and per-program isolation is named as the Tier 2 grant the amendment refused |
| Part A 5 / MATERIAL 3 — the delta table claimed completeness but omitted `ctx.replica`, `ctx.session` / `ctx.device` / `fresh`, and named-program write grants | FOLDED: four rows added (including the v1.2 program inputs); the completeness claim narrowed to the rule-language and program-input vocabulary that bears on authorization |
| Part A 7 — "the form every v0 used" reintroduced twice | FOLDED: "every v0 with privileged system writes" |
| Part A 1, 3, 4, 8 — bearer denominators, events/calendar, count recount, `phase: 'system'` handling | RESOLVED by the round-1 fold; no change |

### Codex delta-review dispositions (round 3, 2026-08-30)

Verbatim artifact: the dated round-3 section of
`llp/reviews/0331-coverage-audit.codex.md` (NOT READY; Part A 3 resolved / 1
partly; 1 new MATERIAL).

| Concern | Disposition |
|---|---|
| Part A 3 — the delta table still omitted dimension N's bounded principal closure (`existsAny`), which this document defers to Tier 2 | FOLDED: row added |
| NEW MATERIAL — the v1.2 row said `propagate` is "not authorization scope" while ledger X13 places it in Tier 2 | FOLDED: `propagate` given its own row (dimension E, Tier 2, ledger X13) and removed from the not-in-scope row |
| Part A 1, 2, 4 — the consistent fold, the "One trusted domain" paragraph, the "every v0" wording | RESOLVED; no change |

### Codex delta-review dispositions (round 4, 2026-08-30)

Verbatim artifact: the dated round-4 section of
`llp/reviews/0331-coverage-audit.codex.md` (NOT READY; both round-3
residuals resolved; no new concern from the fold; one MATERIAL contradiction
in pre-existing text).

| Concern | Disposition |
|---|---|
| MATERIAL — the admission rule admits only a new input or a bounded probe and excludes storage, and the budget says every Tier 2 row adds one input or probe; but Tier 2 holds engine-maintained relations (`propagate`, the tree/dag closures — engine writes) and program-scoped write grants (a locus change), so those rows could not enter under the rule as written | FOLDED: condition 2 gains a third admissible class — a schema-declared, certificate-reported engine-maintained relation (as the RFC's `tree` / `dag` closures and `maintain.rows` already are) — and the budget matches; program-scoped write grants are marked as *not admissible through the rule* (a second locus, refused by ruling 0 as amended; a fresh ruling would be needed), in the Tier 2 list, ledger X20-W, the delta table, and the trusted-domain paragraph. Whether to move them from "listed under Tier 2" to "refused" outright is put to the author |
| Round-3 residuals (`existsAny` row; `propagate` row) | RESOLVED; no change |

### Codex delta-review dispositions (round 5 — the Expo/EAS section, 2026-08-30)

Verbatim artifact: the dated round-5 section of
`llp/reviews/0331-coverage-audit.codex.md` (NOT READY; Part A: all three
EAS claims AGREED on substance with corrected counts; Part B: 4 MATERIAL,
1 MINOR — all about how rulings E-a to E-d were folded, none reopening a
ruling).

| Concern | Disposition |
|---|---|
| MATERIAL 1 — E-a is not an instance of the third class as written (a derived child column, not a relation with its own rules); admission conditions 1 and 4 are not met; the Summary still said "the one extension admitted"; "all three are the third class" contradicted E2's own text | FOLDED: the third class generalized to "an engine-maintained derived field or relation"; E-a's status stated as ruled in principle, entering the implemented spec when conditions 1 and 4 are met by the first transferring application; Summary reworded; E1/E2/E3 classified separately |
| MATERIAL 2 — the `inherits` lowering drops the intermediate parent's own read policy (EAS loads every intermediate with authorization; its app schema reserves per-project privacy) | FOLDED: "the copy is the scope, not the verdict" — the child's rule keeps a one-hop probe of the parent where the parent has a rule of its own; `check` may elide it only by a proof invalidated when the parent's rule changes |
| MATERIAL 3 — E-b left live-vs-snapshot authority and revocation undefined (EAS copies a sudo bit into a 30-minute envelope) | FOLDED: relation rows read live at run; disabled principal or revoked session refuses the job; step-up state never copied; retries cannot extend the bound; trace records `enqueuedBy`, `runAs`, epoch, expiry |
| MATERIAL 4 — E-c not reconciled with one locus (a parent's rule authorizing child writes) or bounded certificates; Tier 0 said "for M1–M3" while row 4c said after the bar | FOLDED: the cascade edge is declared on the child table as part of its own mutation policy; a certificate cascade line `{ edge, mode, targetTable, maxRows, amplification }`; over-budget cascades become a continuation with the observable state named; Tier 0 now says the mirror enters after the bar (Clique M3 deletes no populated group) |
| MINOR — mixed census denominators (164/148 of 168 included test fixtures; "43 cascade rule sites" vs 70 instantiations; 256/294 not reproducible from the artifact's own chain list; "thirty-six jobs") | FOLDED: 161/145 of 168 production (164/148 of 171); 70 instantiations; 272 of 292 path instantiations at two or more steps with the app chain "over two hundred"; 35 production jobs; "four contain an explicit elevation" |
| Suggestion — E-d narrowing (invitation-scoped contact principal; atomic with consuming the invitation; collisions refuse) | FOLDED into the account-model carve-out |

### Codex delta-review dispositions (round 6 — the Expo/EAS fold, 2026-08-30)

Verbatim artifact: the dated round-6 section of
`llp/reviews/0331-coverage-audit.codex.md` (NOT READY; round-5 MATERIAL 2
and 4 and the E-d suggestion RESOLVED; MATERIAL 1 and 3 and the census
MINOR PARTLY — stale pre-fold wording; two MATERIAL and two MINOR, all text
consistency).

| Concern | Disposition |
|---|---|
| E-a wording still contradictory: the E1 verdict cell said `inherits` and `propagate` are "both Tier 2"; the EAS section's own rulings table read as immediate admission | FOLDED: E1 cell and the EAS rulings row now match the operative Tier 1 text — ruled in principle, after the bar, on conditions 1 and 4 |
| Condition 3 of the admission rule priced only "the input or the probe bound", omitting the derived write's amplification the third class requires | FOLDED: condition 3 now names `engineWrites` for a derived field or relation |
| The E2 verdict cell still read as an outstanding Tier 1 defect | FOLDED: "Tier 1 now says so (E-b)" |
| Ledger rows X11, X1, X19 and the Tier 1 second-entry paragraph kept the rejected denominators (164/168; ~280; 43) | FOLDED: 161 of 168 production; some 270; 70 instantiations |

### Amendment to ruling 0 (ruled 2026-08-30)

Ruling 0 recorded Tier 1 with "a declared per-program `reads:` / `writes:`
view in the certificate." The Codex delta review points out that if that
view *grants* a system program access the table rules deny, it is a second
authorization locus — contradicting this document's own "table policy is the
mandatory locus" — and that Tier 2's "program-scoped write grants" is then
already inside Tier 1. If instead the view only *describes* access, it
cannot remove the system disjuncts from rules, and the certificate already
carries that description (`readSites` / `writeSites`).

**Ruled:** keep the table rules as the only locus. The system principal is
an ordinary reserved principal value; a table whose rows a system program
must read or write says so in its own rule — one disjunct per table,
`insert: p => p.ownerId === viewer || viewer === system`, reviewable in the schema,
exactly the form every v0 with privileged system writes used and the spike's existing
`Literal` term lowers to with no new IR. `callable: 'system'` stays as
invocation policy (who may call), `phase: 'system'` as the continuation's
principal; the per-program `reads:` / `writes:` view is dropped from Tier 1
(the certificate's `readSites` / `writeSites` already record what a program
touches), and program-scoped write grants stay in Tier 2 as the RFC's
dimension-C item. Cost: one visible disjunct on each system-written table.
Benefit: one locus, zero new IR, and the spike's `PrincipalKind` term can be
deleted rather than kept as a lowering. Orchestrator's confidence at
recommendation: ~75%; ruled firm by the author.

### A real application: Expo/EAS (2026-08-30)

The thirty-seven applications are paper. The founder asked whether the
proposal *as ruled* would carry a real one with a decade of accreted
authorization: the Expo/EAS backend (`~/projects/universe/server/www/src`
at `ac32403958` — a private repository; the artifacts cite paths and
two-line fragments of authorization logic only). Four facet audits —
actors and sessions, the rule vocabulary and permission model, the
resources and their policies, the non-human plane — are landed as
`llp/reviews/0331-coverage-audit.eas-{actors,rules,resources,nonhuman}.md`
with the brief beside them. They are same-family research audits.

**Why it is the right test.** EAS *is* a per-table rule model. It runs on
`@expo/entity`: 171 privacy-policy files (168 outside tests), each with
ordered `read` / `create` / `update` / `delete` rule lists evaluated per
row against a viewer context, built from 33 shared rule classes and about
ten per-entity ones. Its actors are three kinds (`User`, `SSOUser`, `Robot`)
plus anonymous, partner-provisioned, scoped-token, internal, sudo and
staff-mode contexts. Its permission model is four independent bits
(`OWN` / `ADMIN` / `PUBLISH` / `VIEW`) stored one row per bit in
`user_permissions { grantor(account), grantee(actor), permission }`, with
roles derived for display and `CUSTOM` for any other set. Thirty-five
production background jobs, build and workflow workers, four kinds of webhook
ingress, anonymous devices fetching updates, and a billing plan sit around
it. Nothing in the paper corpus has this many tables, actors, or years.

**The verdict in one paragraph.** The recipe carries EAS's who-may rules
outright: the permission relation is the scoped relation row verbatim,
independent bits are independent rows, the role is a presentation function
and no check compares roles (no lattice), grant authority is two explicit
cases (`OWN` needs `OWN`, else `ADMIN`), the last-owner rule is a count
constraint (a trigger today), staff is a global role, public reads are
`public(reason)`, and only one table in the whole system truly mixes
audiences in a row (environment variables, redacted in resolvers today — a
split under the proposal); credentials are single-audience rows. No privacy
policy depends on a count, a quota, a plan, or a clock — those live in
validators and triggers. Every actor kind reduces to an ordinary principal
plus relation rows written at mint; every `is*ViewerContext()` kind test in
a rule is redundant with an owner or role comparison. And Tier 1 as amended
is not a proposal for EAS, it is a description: 161 of the 168 production
policies name the omnipotent context on writes and 145 name the omniscient
one on reads (164 and 148 of 171 with the three test fixtures) —
the `|| viewer === system` disjunct on nearly every table is what a decade
produced. What the proposal as ruled does **not** carry are three things,
one of them structural.

| # | EAS requirement | Evidence | Verdict under the rulings | What EAS would lose |
|---|---|---|---|---|
| E1 | **An app-scoped row is readable or writable iff the viewer holds permission P on the app's *current* account** — and apps are transferred between accounts by a viewer with `OWN` on the source and `ADMIN` on the destination | `rules/AllowIfAccountActorHasPermissionOnAssociatedAccountPrivacyPolicyRule.ts:18-27` (path of `{ entity, field }` steps); of 435 membership-probing rule uses, 32% are one hop, 46% two, 16% three, 6% four; of the 292 association-path instantiations, 272 walk two or more steps (depths 20 / 176 / 69 / 27) and the great majority pass through `AppEntity` (the audit's own chain list accounts for 216; its headline "256 of 294" is not reproducible from that list and is not relied on); the longest is `updateAssetEdge → update → branch → app → account`; `projects/AppUtils.ts:126-129` rewrites `apps.accountId`; no child table (builds, branches, channels, updates, submissions, webhooks, workflows) carries `accountId` | **ruling 4 does not cover it**: the intermediate scope is mutable, so "denormalize the immutable scope id" is wrong for some 270 rule uses; the honest forms are the RFC's `inherits(fk)` (dimension E — an engine-maintained inherited column rewritten in the parent's commit, `engineWrites` in the certificate) or `propagate` on transfer — `inherits` now Tier 1 in principle by E-a (after the bar, once conditions 1 and 4 are met), `propagate` Tier 2 | project transfer — or transfer as a system job that rewrites the copies inside a declared window, with drift-tolerant reads meanwhile (the ledger tables already accept that) |
| E2 | **31 of 35 background jobs run as the principal that dispatched them** (a user, robot, or worker), re-checking that principal's rules at run time and attributing writes to it; the other four contain an explicit elevation, not a wholly-system run | `BackgroundJobDispatching.ts:69` serializes the viewer context; `BackgroundJobRouter.ts:115-119` deserializes; `DeleteUserBackgroundJob.ts:74-83` re-checks; workers are the initiating actor re-minted for 24 h (`TurtleJobRunUtils.ts:350-358`); scheduled workflow runs are attributed to the installation robot (`WorkflowsRouter.ts:632-664`) | **Tier 1's text said jobs and schedules run as `system`**; EAS says a job names the principal it runs as. No rule change — the identity layer re-mints the enqueuing viewer with a bounded lifetime, and table rules see only `viewer` — and Tier 1 now says so (E-b) | attribution and least authority for everything asynchronous — or every job's tables gain a `system` disjunct they do not need today |
| E3 | **Deleting a user, account, app, robot, SSO token, build, or job run must delete or null every referencing row, including rows the deleter can no longer read**, and the last-owner invariant is suspended inside the cascade | seven `AllowIfIn*DeletionCascade…` rule classes, 70 instantiations across the policies; 24 `cascadingDeleteCause` sites; 174 `CASCADE` + 75 `SET_NULL` edges; `turtlebuild/TurtleBuildPrivacyPolicy.ts:133-141` "allow reading by initiating user … to nullify these fields during their user deletion even if they no longer have access" | the mirror of Tier 0's *creation* provenance, which no tier named before E-c: without it the cascade is Tier 1 (the deletion program's system continuation, `system` on ~40 child tables) — the honest primitive is a **schema-declared cascade edge** performed as an engine write authorized by the parent's delete rule, the same class as `tree.inherit` (RFC `E_STRUCTURAL_WRITE`) | attribution of the cascade to the deleter; otherwise nothing — the continuation works |
| E4 | A worker token is the same actor **attenuated** to `VIEW` / `PUBLISH`, live-linked to the actor's current rows, for 1–24 h (EAS Build, Workflows, Echo) | `constants.ts:25` `ScopedUserPermission`; `AllowIfScopedAccountActorHasPermissionOnAccountPrivacyPolicyRule.ts:46-51` delegates to the underlying viewer; about 80 policies opt in | Tier 2 X13 (a derived relation: token rows = actor rows ⊓ scope) as built; **core interim**: a distinct job principal with copied capped rows and in-transaction repair by the membership programs (or accept revocation lag ≤ the token TTL, which is the stateless JWT's own gap today) | nothing the product states; only the automatic tracking of the user's live grants |
| E5 | Staff mode: an Expo admin's *session* is elevated for 120 min (or is an internal session in read or write mode) and gains read on ~123 tables, write on one; sudo re-authentication gates nine programs | `rules/AllowIfViewerStaffModeSessionPrivacyPolicyRule.ts:28-43`; `SessionEntity.ts:245-263`; `internalApiSecurity.ts:6-22`; `enforceSudoSessionUserViewerContext` (9 sites) | session state as a rule term — **outside the scope** (X9) as built; **core by reduction**: the identity layer's step-up mints a sibling staff principal with a short fixed session and `{ principal, role: 'staffRead' or 'staffWrite' }` rows named on read vs write rules (ruling 2's mechanism); sudo stays inside identity-layer programs | the "same login, toggled per session" ergonomics; no step-up on the three app programs that use sudo |
| E6 | An invitee identified only by **verified e-mail equality** may read, accept, or decline pending invitations from the dashboard (the e-mail also carries a token link) | `AllowIfViewerEmailMatchesInvitationEmailRule.ts:35-53`; `UserInvitationMutation.ts:429-437`; accept-by-token grants under omnipotent (L442-455) | accept-by-token is ruling 2's paved form (core); the dashboard list is Tier 2 X3 (sets) as built — **core interim** if the identity kind mints a contact principal at invitation and rebinds the relation row at e-mail verification, which needs a carve-out of this document's "e-mail is never a link key" for *verified* contact claims | the pending-invitations list; the flow itself survives on the token |
| E7 | A robot (or its token) may be managed by a viewer holding `ADMIN` on **any** account the robot belongs to | `rules/AllowIfAccountActorHasPermissionOnSharedAccountWithRobot.ts:24-29` (two account sets intersected) | two probes joined on a free variable — the calendar's group-audience shape: Tier 2 `any` with a probe in its `where`; **core** if a robot has an immutable home account (the product already creates robots inside one organization) | cross-account robot management, which the product does not ship |
| E8 | Viewer programs read rows the viewer cannot — 218 `withOmni*ViewerContext` call sites in programs (account-by-name lookups, admin-account ids, session rows, invitation grants) | `utils/auth.ts:40-47`; `UserPermissionsUtils.ts:180-204`; census in the actors artifact §1.9 | most are literal scope ids or identity-layer reads (core); the residue is X11 face (a) — `getHidden` at Tier 2 with the continuation as interim (ruling 3) | nothing the product states; the cost is the disjunct count the amendment already accepted |
| E9 | Anonymous devices fetch the latest update for `(project, channel, runtime, platform)`; Expo Go on a store build must hold `VIEW`; a free-plan account over its monthly quota is refused | `updateRoutes.ts:40-47`; `serveUpdateResponse.ts:588-593, 648-680` (served under omniscient with a hand-written check); `UpdatesServingUtils.ts:151-195` (quota from ClickHouse) | a `public(reason)` served projection keyed by the composite index (core split); the quota is a schedule-flipped account status (X6 weak + Tier 1); the Expo-Go gate is a caller-asserted header (outside — EAS ships it as a dry run) | one schedule period of quota lag; the header gate |
| E10 | Environment variables: one row with metadata for `VIEW`, a sensitive value for `PUBLISH` on request, and a secret value for the build system only | `EnvironmentVariableUtils.ts:91-93`; `graphql/types/EnvironmentVariable.ts:74-76` (resolver redaction) | protection-class split + `system` on the secret-value table — core + Tier 1 | nothing |
| E11 | Webhook ingress (GitHub, App Store Connect) is re-attributed to the installation's robot; Stripe, Cloudflare, Sentry events mutate as system; workers write build state as an ordinary principal | `withGitHubInstallationRobotViewerContextAsync.ts:24-45`; `StripeWebhookRouter.ts:123-127`; `TurtleBuildsRouter.ts:232-241` | core (identity layer mints the webhook/robot principal) and Tier 1 | nothing |

**What EAS changes in the tiering.** Three rows are load-bearing and were
not covered by the rulings; each has a bounded form the RFC already names,
and they are three different things: E1 is an engine-maintained *derived
field* (the third admissible class, generalized to say so), E2 is identity-
layer re-minting with no rule-language change, and E3 is a structural
referential effect declared on the child table:

1. **E1, the mutable parent.** Ruling 4's rewrite assumes the scope column
   is immutable. In EAS the one column every chain shares is rewritten by a
   shipped feature, and the paper corpus had only edge cases of it
   (workspace links, multi-region authority). Product → account → resource
   with project transfer is the shape of every developer-tool SaaS. The
   smallest admission is single-column `inherits(app, 'accountId')`: the
   engine copies the parent's scope onto the child at insert and rewrites
   every copy in the parent's own commit, the certificate reports the
   fan-out, and the child's rule is one hop again — with the parent's own
   read rule still conjoined unless `check` proves it implied (EAS loads
   every intermediate *with* authorization, and its app schema anticipates
   per-project privacy). That is RFC dimension E for a `ref`, not a tree.
2. **E2, jobs as ordinary principals.** Tier 1's wording is narrower than
   the runtime it describes. The fix is one sentence: a job, schedule, or
   continuation names the principal it runs as — `system`, or the enqueuing
   viewer re-minted by the identity layer with a bounded lifetime — and
   rules see only `viewer`. No rule-language change.
3. **E3, deletion provenance.** Creation provenance was in Tier 0; its mirror
   was not, and EAS instantiates it seventy times. A declared cascade edge on
   the child table is an engine write authorized once by the parent's delete
   rule; without it every child table carries a `system` disjunct for the
   deletion job.

Everything else EAS does is core, core by a stated reduction (E4–E8), or
the parts of Tier 1 and the identity layer already ruled (E9–E11). No
EAS requirement needed a role lattice, a `principal.kind` term,
permissions as data, or a time term in a rule; the 218 omnipotent call
sites are the honest measure of what "one trusted domain" costs at scale
and why the taint claims in Tier 1 are not optional.

**Rulings from the EAS audit (ruled by the author 2026-08-30 — "your
proposals seem solid" — and applied to the tiers above).**

| # | Ruling | Orchestrator's confidence at recommendation |
|---|---|---|
| E-a | Amend ruling 4: when the intermediate scope column of a two-hop rule is written by any program, `check` refuses the copy and pastes `inherits(<parent>, '<column>')` instead; admit single-column `inherits` over a `ref` in principle as the admission rule's third class (an engine-maintained derived field), on EAS's evidence (some 270 rule uses through `apps.accountId`), entering the implemented spec when conditions 1 and 4 are met by the first transferring application, which owns the lowering and its measurement | ~85% |
| E-b | Amend Tier 1's text: a job, schedule, or continuation runs as `system` or as the enqueuing viewer re-minted by the identity layer with a bounded lifetime; table rules see only `viewer` | ~85% |
| E-c | Extend Tier 0's transaction-local provenance to deletion: a schema-declared cascade edge (`ref(parent, { onDelete: 'cascade' or 'setNull' })`) is an engine write authorized by the parent's delete rule, reported as `engineWrites`; the system continuation remains the interim | ~75% |
| E-d | Carve out of the account model's "e-mail is never a link key": the identity kind may rebind an invitation's contact principal to a user at *verified* e-mail claim (events' shape) | ~70% |

## Evidence boundary and method

The source observations are the demo diaries under `diaries/` that actually
exercised, skipped, or worked around scoped roles, plus the open and closed
`issues/` those diaries filed, plus the 0.1.29 Clique lane diaries under
`benchmarks/runs/2026-08-27-clique-published-0129-matrix/lanes/`. Highest-
signal diaries: 0014, 0015, 0021, 0042, 0044, 0058-messaging-snapback, 0081,
0086, 0100, 0101, 0104, 0105, 0108. Diary 0114 is the published-matrix
digest, not a membership-system build. Diary 0073 is program-level Clique
pilot evidence, not a membership-system build. Duplicate diary numbers
are cited with slugs (0045, 0046, 0058).

This document records **both** diary-time experience and 2026-08-30
current source. Findings that mix the two now label *observed then*
versus *current now*. A diary written against 0.1.7 does not describe
0.1.29.

The corpus is not a controlled prevalence study. Different diaries used
different published closures (0.1.7 through 0.1.29), local `main`, Explicit
versus Familiar, and different clocks. A finding licenses “this incident
occurred in these builds, and it recurred.” It does not license frequency
in the wild, a magnitude claim against Convex, or a sequencing priority
among unrelated subsystems. Ranking in the conclusions is qualitative
(discoverability, security, remaining capability gap), not a count of
diaries.

**Eligible-lane rule for skip/use claims.** A Clique/Coterie Snapback
lane is *eligible* only if it reached the messaging milestone (M3), where
scoped conversation authorization was required, and therefore had to
choose a design. Lanes that stalled at M1 (GLM/terra 0.1.29) are
*censored*, not evidence of skipping. Digests (0109–0114, 0073) are not
independent membership builds.

| Eligible Snapback Clique/Coterie lane (reached M3) | Path |
|---|---|
| 0100 opus-clique-explicit 0.1.24; 0101 opus-clique-familiar 0.1.24 | declared `.membership()` (+ profile on 0101) |
| 0105 sol-high familiar local-main; 0108 sonnet familiar local-main | declared, then widened some tables to `public-read` |
| 0081 clique-simplified 0.1.21 | started toward the profile, then *dodged* to public-read handlers |
| 0086 coterie Snapback adapter | declared current-seat membership; messages stay public-read |
| 0079, 0083, 0092–0099, 0102–0104, 0106, 0107 | handler path; no `.membership()` / `.authorityProfile()` |
| 0.1.29 grok/sol Explicit and Familiar (4 lanes) | handler path; reached M3 without the primitive |
| 0.1.29 GLM/terra Snapback | censored (did not reach M3) |

Claims about *current* source were checked against
`guide/auth/scoped-roles.md` (reviewed 2026-08-25),
`guide/auth/protecting-data.md`, `guide/backend/assets.md`,
`guide/recipes/membership-roster-projection.md`,
`guide/backend/versioned-seeds.md`,
`packages/snapback-cli/templates/expo-chat/snapback/schema.mjs`,
`demos/coterie/snapback/schema.mjs`, `demos/rbac/snapback/schema.mjs`,
`demos/team-chat/snapback/schema.mjs`, `demos/party-wall/snapback/schema.mjs`,
and `demos/messaging-snapback/snapback/schema.mjs` on 2026-08-30. The
evolution table below is the reconciliation. A 2026-08-30 Codex review
(`llp/reviews/0331-scoped-roles-diary-feedback.codex.md`) found the first
draft's current-source pass stale on projection, asset-sharing composition,
and hooks; those rows are corrected here.

Two authoring populations must not be averaged:

1. **Declared path.** `.membership()` and usually `.authorityProfile()`,
   host-evaluated transitions, generated `bootstrap` / `insert` /
   `removePrincipal` / profile operations. Diaries 0014, 0015, 0021, 0026,
   0042 / 0044 / 0045-a4-events-sweep / 0046-a5-ai-research-room-sweep,
   0058-messaging-snapback, 0100, 0101, 0105, 0108, and the 0086 typing
   adoption.
2. **Handler path.** Ordinary `members` tables, per-mutation role checks,
   often `public-read` storage posture. Eligible Clique/Coterie lanes that
   reached messaging without the primitive (0079, 0083, 0092–0099,
   0102–0104, 0106, 0107, 0.1.29 grok/sol Explicit/Familiar).

Praise from population 1 and greens from population 2 are not the same
signal. Population 2 can ship Clique without ever meeting LLP 0056.

## Finding 1: the primitive is still an optional advanced path

**Confidence:** high for *eligible* Clique/Coterie Snapback lanes that
reached messaging; not a prevalence claim over 0073–0114 as a set.

Among eligible lanes (table above), the declared primitive was the
minority path. Four 0.1.29 grok/sol Explicit/Familiar lanes that reached
M3 all skipped `.membership()` / `.authorityProfile()`. Opus 0.1.24
(0100, 0101) and the later familiar local-main lanes (0105, 0108) took
it. GLM/terra 0.1.29 lanes that never reached M3 are censored. Diary
0114 can therefore say Snapback’s differentiator is “reviewable
authority” while PocketBase still wins greens: the benchmark rubric
(LLP 0201) does not force the declaration, so under a clock *eligible*
agents often skip it.

That is why the smoothness problem is not only “make `bootstrap()` take
`joinedAt`.” Until the chat template, start packet, and Coterie reference
make membership-scoped visibility the default for messages, eligible
timed lanes will keep skipping the system and only the rare careful lane
will hit the sharp edges.

**What they copy instead.** The `expo-chat` template marks conversations,
memberships, and messages `public-read`, with a comment that production
chat uses membership
(`packages/snapback-cli/templates/expo-chat/snapback/schema.mjs`). Coterie,
the social reference, declares a current-seat `.membership()` table and
then marks messages and receipts `public-read`
(`demos/coterie/snapback/schema.mjs`). The RBAC demo and Team Chat v1
*do* use `.visibility({ kind: 'membership', … })`. Agents building Clique
copy the template and Coterie.

`guide/start/expo-chat.md` contains no occurrence of “visibility.” An
agent working from the packet meets read posture first as a silent empty
query. `public-read` is the edit that makes the failure go away. That is
the pit-of-success miss already filed as
`issues/20260826-membership-scoped-query-reachability.md` (LLP 0310 F8 /
P18). This document adds: the first-party social artifacts teach the
wrong production posture, so fixing the packet without fixing the template
and Coterie will not change what Clique lanes copy.

## Finding 2: when they take the path, they praise it

**Confidence:** high for the named builds; not a product-wide satisfaction
claim.

Recurring praise, with representative quotes:

- **One declaration, many layers.** Diary 0014: `.membership()` driving
  axes, types, query helpers, mutation writes, provenance, and central
  refusal. Diary 0100: “The membership declaration paid for itself within
  an hour.”
- **`bootstrap()`.** Diaries 0015, 0021, 0026, 0100, 0101: create the
  resource and seat the caller atomically; “I never had to write
  create-then-add-creator-then-hope.” Diary 0015: `lastHolder: { protect:
  'host' }` made host-orphaning “unrepresentable for free.”
- **Host-evaluated transitions.** Diary 0100: “A non-admin cannot remove
  members is not a handler check I wrote and could forget… the refusal
  arrives before the target is even looked up”
  (`SNAPBACK_MEMBERSHIP_TRANSITION_DENIED`). Raw `ctx.db` roster writes
  refuse (`SNAPBACK_MEMBERSHIP_RAW_WRITE_DENIED`).
- **Live revocation.** Diary 0042: Bob’s live handle blanked ~1.7s after
  seat loss; Alice’s next message never reached him; fresh read was the
  same non-disclosing denial. Convex matched delivery; it could not match
  non-disclosure. Diaries 0027/0028 recorded the pre-fix failure
  (`requireRole` JS lives retained rows, dependence `["opaque"]`); later
  remediations blank before the causing mutation returns.
- **Generated operations from the matrix.** Diary 0014/0021: missing
  operations are absent, not runtime no-ops. Owner transfer as one
  mutation with two receipts.
- **Membership-scoped ephemeral, once it exists.** Diary 0101:
  `allow.members('chatAccess')` inherited from the durable declaration.
  Diary 0086 post-fix: former-member negative battery on typing.

Diary 0101’s comparison is the strongest positive in the corpus: for real
rooms and per-resource roles they would pick Snapback over Convex *for
that alone*; Firebase rules drift; Convex leaves it to handler discipline;
Snapback “refuses to let you write the roster any other way.” The same
diary says a weekend prototype would resent the walls. Diary 0100 agrees:
“On a messaging app I think Snapback’s trade is right. On a weekend
project I would resent it.”

## Finding 3: under a clock they ship `public-read` on purpose

**Confidence:** high. This is not ignorance. Several lanes named the
posture as wrong and shipped it anyway.

| Diary / ticket | What they shipped | Why |
|---|---|---|
| 0081 Clique simplified | conversation / membership / message tables `public-read`, checks in named functions | Owner visibility on `ctx.db` blocked quoted-message and roster joins; the authority profile’s one-command-per-mutation model “does not fit atomic multi-seat fixture group creation.” Called “the lane’s largest authority compromise.” (`bootstrap(..., initialMembers?)` later closed the fixture case; `ctx.db.elevated` closed the quote case — LLP 0056 2026-08-15 amendment. The *choice* to widen still recurs.) |
| 0092 sol-clique-explicit | “broad public-read table access to make the small live-query set work quickly” | Agent says this is where mature RLS would have been safer. |
| 0104 sol-high explicit | authenticated but globally readable conversation/message live queries | Green for the frozen M3 contract; “not a production private-messaging claim.” |
| 0105 sol-high familiar | inbox projection `public-read`, narrowed only by the app function | “honest production hardening gap.” |
| 0108 sonnet familiar | `messages`, receipts, reactions, presentational roster `public-read`; write-path `assertConversationMember` only | Membership-scoped reads denied bona-fide members (see Finding 6). Any authenticated user who guessed a conversation id could read messages. |
| grok familiar 0.1.29 | durable typing table instead of `allow.members()` | “too expensive to adopt in-budget.” |
| `issues/20260826-membership-scoped-query-reachability.md` | familiar Clique 0.1.27 | Lane **named** it “not a production ACL.” |

The paved path exists on `guide/backend/familiar-profile.md` and
`guide/auth/protecting-data.md` (“Do not use public-read merely to silence
the implicit-visibility warning”). Agents do not start there. An empty
membership-gated query looks like “no data yet.”

**If the app does not use membership authority, removal is not a cutoff.**
`issues/closed/20260825-familiar-removed-member-live-cutoff-leak.md`:
`public-read` plus `ctx.db.patch({ active: false })` is not an
authorization transition. Open live clients still received messages. That
is Finding 3 taken all the way to a security miss. The platform will not
fence a row marked public.

## Finding 4: private roster versus product facts is the modeling tax

**Confidence:** high for the *observed-then* rediscovery. Current-now: the
generated product projection is shipped; the remaining authoring hole is
narrower than the first draft claimed.

V1 membership rows are not app-readable (`SNAPBACK_MEMBERSHIP_READ_PRIVATE`).
Diary 0101: “The private roster is right, and it costs you.” Agents then
built the shape the scoped-roles page tells them not to build.

| Need | Observed then | Current now |
|---|---|---|
| Channels I belong to (0042) | `channelSeats` app-data mirror | membership visibility on the resource table with `resourceField: '_id'`; `_snapback.myMemberships` (LLP 0100) |
| Join time / send-time recipients (0100, 0101) | `chatJoins` companion table | profile `projection.recipients` freezes send-time sets from writer-seam row images (`guide/recipes/membership-roster-projection.md`, maturity: shipped). Residual: the **creator seat** still cannot take incidental values through `bootstrap()` (below). Additional `initialMembers` already may carry insert-transition `fields`. |
| Display roster (0058-messaging-snapback, 0105) | hand-maintained projection, then a second reconciliation mutation for `changeRole`/`remove` | generated `list` / `myRole` / `history` / `incarnations`. Closed by LLP 0240 and `issues/closed/20260821-private-authority-product-roster-decision.md`. Diary 0058 remains valid *historical* evidence of the interim, including that generated profile ops are directly callable. |
| Incarnation history (0086) | canonical-current table plus `conversationMembers` ledger | generated incarnation projection; unbounded history churn is a dated 0086 finding |
| Seeded org with seats (0044) | app-data invites + `by: ['none']` self-insert | declared seed fixture lane (`guide/backend/versioned-seeds.md`) |

`bootstrap()` still has no slot for incidental values on the **creator**
seat. Diaries 0100, 0101, 0058-messaging-snapback, 0105:
`SNAPBACK_FIELD_MISSING` → `SNAPBACK_MEMBERSHIP_INSERT_FIELD_DENIED` → a
result-contract violation on the generated `list` when they made `joinedAt`
optional. Additional `initialMembers` already match an ordinary insert
transition, including its `fields` list. The missing input is the
server-synthesized creator seat, not the invitee list.

`removePrincipal` always returns `null` on present *and* absent. Companion
writes must be correct on both branches (Diary 0100: “the one place that is
genuinely delicate”). Profile `changeRole`/`remove` still cannot be
marshaled from an authored handler (`SNAPBACK_MEMBERSHIP_OPERATION_INVALID`,
Diary 0058-messaging-snapback). A profile already emits the supported subset
of `invite`, `join`, `leave`, `changeRole`, `remove`, and `transferOwner`
when the transition matrix admits them (`guide/auth/scoped-roles.md`). That
is not a remaining program; it is shipped under LLP 0240.

**Residual after the shipped projection.** Creator-seat incidentals;
whether first-party demos have adopted the recipe (Coterie messages remain
`public-read`; `demos/messaging-snapback` still comments that “today’s
profile writers are not projection-aware” and treats option 1 as the
interim); discoverability of the recipe from the start packet and chat
template. Remaining projection work routes to LLP 0240, not a new program.

Diary 0101 asked by name for one paragraph: “keep product facts about
participants in your own table; the declaration is authority only,” and
for a worked example of “I need a roster for display *and* an
authorization store, and the roster is private.” That paragraph now exists
as the projection recipe; the start packet still does not link it. Diary
0105: the pages “contained the architecture, but the path was fragmented.”

## Finding 5: identity mix-up is a loaded gun

**Confidence:** high for the 0108 incident; the typing-gap recommendation
does not depend on how the read-path question resolves.

Diary 0108 inserted **users-table row ids** (`v.id('users')`) into
membership `userId` fields declared `v.principal()`. Membership-visibility
then denied bona-fide members, reproduced three ways: a plain indexed
query, the documented `requireRole` + `elevated.query` sequence, and a
bare `ctx.db.get` on a committed row. They later found the type confusion,
**did not re-test** membership visibility with corrected principals, and
left `public-read` in place.
`issues/20260822-membership-visibility-read-denial-needs-reverify.md` is
still open.

At the JS layer both ids are opaque strings. A branded `Principal` that
cannot be assigned from `Id<'users'>` would have caught 0108 at
`snapback generate` time instead of two milestones later. Related:
`issues/20260808-guide-gap-principal-to-app-identity-binding.md` (guide
page landed; verified-provisioning writer still deferred).

The expo-chat template uses `userId: v.id('users')` on an ordinary
product-membership table, not a `.membership()` declaration. That identity
is not intrinsically wrong for the template’s public-read starter. The
hazard is the comment that “production chat uses membership”: it invites
copy-paste or migration onto `.membership()` without teaching the
`Id<'users'>` → `v.principal()` bridge. Diary 0108 is what happens after
that jump.

Diaries 0079/0081: structured interiors reject nested principal validators,
so recipient snapshots become server-authored string IDs or `v.json()`.

## Finding 6: product vocabulary is locked to `owner` on a profile

**Confidence:** high for `authorityProfile()`; `lastHolder` alone is more
flexible.

An `authorityProfile()` requires a role literally named `owner`, and that
role must be the `bootstrapRole` / `lastHolder.protect` role
(`guide/auth/scoped-roles.md`). Clique’s brief is “creator is an admin,
anyone can leave.” Diaries 0100/0101 had to rename the product: last owner
must transfer before leaving.

Coterie avoided the profile: one role `member`, `bootstrapRole: 'member'`,
product-level admin on a separate incarnation table, and
`principalAddressedWrites: { remove: true }`. That works, and it means the
first-party social demo never exercises the profile lattice.

`requireRole(id, 'admin')` is exact, not hierarchical: an owner is refused
(Diary 0101). `hasRole('member')` on a profile *is* hierarchical. Agents
who expect the lattice to apply to both helpers stop trusting them and
write `assertConversationMember`.

`principalAddressedWrites` (kick via `removePrincipal`) and
`authorityProfile` (generated `list` / `changeRole` / `transferOwner`) are
two completeness stories. Agents who attach both, or expect one to imply
the other, get confused. Diary 0101 called them incompatible.

## Finding 7: two denial semantics, and the client envelope hides them

**Confidence:** high; already documented on the scoped-roles page, still
rediscovered.

| Idiom | Outsider sees | Diaries |
|---|---|---|
| Declarative membership on a query / table visibility | empty result, non-enumerating | 0015, 0026, 0042, 0100, 0101 |
| `ctx.permissions.requireRole` in a handler | `SNAPBACK_AUTH_PERMISSION_DENIED` `{kind:'role'}` | 0026, 0042 |
| Same denial through an action | `SNAPBACK_HANDLER_FAILED` | 0045-a4-events-sweep, 0046-a5-ai-research-room-sweep |
| Same denial through some client envelopes | `SNAPBACK_HANDLER_FAILED` or a redacted throw | 0112, 0094 |

Diary 0026 expected a denied membership-gated query to throw. Diary 0015:
React locked-page versus Contract empty-branch. Switching idiom changes
what a probing outsider can confirm and what the UI must do. The
scoped-roles page now has “Choose between filtering and denying”
(`issues/closed/20260801-0137-a1-guide-gap-membership-filter-vs-deny.md`).
Start packets still do not.

Actions have no `ctx.permissions` (Diary 0014). That is intentional (no
transactional read set). The collapse of a role denial into
`SNAPBACK_HANDLER_FAILED` is the part that costs correction loops (0112:
could not distinguish product behavior from harness mismatch).

## Finding 8: historical cliffs that are now closed, and the ones that are not

**Confidence:** high for the closed rows (repository tickets + LLP 0056 /
0100 amendments); current-source check 2026-08-30 for the still-open
column.

| Cliff | First seen | Status on 2026-08-30 |
|---|---|---|
| Invite/accept needed private `memberId` (0015) | 2026-07-18 | Closed: `setSelfRole` / `removeSelf` |
| Owner cannot kick (0021, 0042) | July–Aug 1 | Closed: LLP 0100 `removePrincipal` |
| “Channels I belong to” inexpressible (0042) | Aug 1 | Closed: `_snapback.myMemberships` + resource-table membership visibility |
| One membership command per mutation vs multi-seat create (0081) | Aug 14 | Closed: `bootstrap(..., initialMembers?)` up to 64 (LLP 0056 2026-08-15) |
| Owner-visibility `ctx.db` blocking handler joins (0081) | Aug 14 | Closed as capability: `ctx.db.elevated`. The *discoverability* of that path is Finding 3. |
| Seed cannot name membership tables (0044) | Aug 1 | Closed as capability: declared fixture lane in `guide/backend/versioned-seeds.md`. `SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED` is reserved/retired. Clique/Coterie still replay starter actions through the write path; they did not adopt the fixture lane. |
| Membership-scoped search (0044, 0046) | 0.1.7 | Later shipped on the RBAC demo (same profile, duplicated table + index declaration). Start packets still do not mention it. |
| `requireRole` JS live query retained rows after kick (0027, 0028) | bakeoff | Closed: blank before the causing mutation returns. |
| Ephemeral `allow.members` role-blind / pendingRoles refused | 0086 | Closed 2026-08-21; Diary 0058-messaging-snapback witness. On some 0.1.24 pins it was still missing (0100 used `allow.all()`). |
| Roster projection recipe missing from the first-read path | 0058-messaging-snapback, 0101 | Capability shipped (LLP 0240; recipe `maturity: shipped`). Start packet / template still do not link it. |
| Ordinary membership-gated asset sharing | 0014, 0045-a4-events-sweep, 0046-a5-ai-research-room-sweep | Closed as capability: `.assetSharing({ kind: 'membership', membership, roles })` (`guide/backend/assets.md`); Party Wall is the first-party proof. |
| Authority-profile-composed asset sharing | same diaries, later 0056/0240 | Still refused (`SNAPBACK_AUTHORITY_PROFILE_UNSUPPORTED_COMPOSITION_CLASS`). Split ordinary membership from profile composition; one “membership” row is too coarse. |
| Generated product projection / profile ops | 0058-messaging-snapback, 0100, 0101 | Closed: LLP 0240 + `issues/closed/20260821-private-authority-product-roster-decision.md`. Recipe `maturity: shipped`. Residual: creator-seat incidentals; demo/recipe drift (messaging-snapback still comments the interim). |
| Offline / retained role-gated reads | 0014, 0042 A2-08, 0028 | Still a GAP. Honest fail-closed; product fact remains. |
| Hosted RBAC | 0014 | Still unsupported. |
| App-generated per-profile React wrappers (`useRoomAccess…`) | 0021 (2026-08-16) | Still absent. Package-generic authority hooks (`useSnapbackAuthorityRoster`, `useSnapbackAuthorityMyRole`, `useSnapbackAuthorityMutation`, `useSnapbackAuthorityMutationStatus`) are shipped and re-exported by Expo (`guide/auth/scoped-roles.md`). |
| `bootstrap()` incidental fields on the creator seat | 0100, 0101, 0105 | Still refused. |
| `authorityProfile` requires the string `owner` | 0101 | Still required. |
| `requireRole` exact vs `hasRole` hierarchical | 0101 | Still the contract. |
| Start-packet / template visibility pit | 0310 F8, 0081, 0092, 0104, 0105, 0108 | Open. |
| Membership-visibility reverify after principal fix | 0108 | Open. |
| Generated `requireRole` / `allowsRole` laundering via `Array.prototype.slice` | `issues/20260819-generated-role-checks-launder-roles-through-array-slice.md` | Open. |
| Stale-handle membership plan bypasses successor policy | `issues/20260826-stale-handle-membership-plan-bypasses-successor-transition-policy.md` and the last-holder sibling | Open. |
| Generated profile ops are directly callable; a coordinator cannot be the only writer | 0058-messaging-snapback | By design; `artifacts.json` made the bypass visible. |

The self-service and kick gaps being closed is real progress. The *shape*
that remains — private roster, one command per mutation, creator seat
without incidentals, profile apex named `owner` — is still the thing
agents work around first.

## Finding 9: other surfaces still cannot say “members of this resource”

**Confidence:** medium-high. Some of these have since grown a lane; the
diary pattern is that agents meet them as walls and do not come back.

- **Search.** On 0.1.7, native search visibility was public-read or owner
  (0044 f2, 0046). The RBAC demo later points a search index at the same
  profile; the declaration is duplicated on the table and the index
  (Diary 0014).
- **Assets.** On the packaged closures those arms used (0045-a4-events-sweep,
  0046-a5-ai-research-room-sweep), membership sharing was unimplemented /
  attach unverified. Diary 0014 refused to manufacture a mirror. Current-now:
  ordinary membership `.assetSharing({ kind: 'membership', … })` is shipped
  (`guide/backend/assets.md`; Party Wall). Authority-profile composition
  still fails generation.
- **Ephemeral.** First `allow.all()` made typing spoofable by former
  members (0086); the surface was removed until `allow.members` shipped.
  Timed lanes still skip it (grok familiar 0.1.29; 0100 on 0.1.24
  explicit). Familiar sometimes does not export the ephemeral constructor
  (0105).
- **Multi-hop authorization.** A receipt that names a message while
  membership is keyed by conversation is undeclarable
  (`guide/auth/protecting-data.md`). Denormalize the conversation id, or
  use `requireRole` + `elevated` in every named function. Diary 0100: the
  docs predicted the wall.
- **`in()` binding budget.** Owner and membership visibility bindings on
  protected tables consume the same 500-binding `in()` budget (0086).
- **Clock-dependent visibility.** `SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY`
  is the platform being right (0108). The diagnostic does not name the
  sanctioned hatches (move the clock into a mutation; `delivery: 'read'`).
  LLP 0114 later paved a recipe; rediscovery cost remains.

## Finding 10: comparisons, distilled

**Confidence:** qualitative, from the diaries’ own essays. Not a scored
bakeoff. Individual comparisons, not a consensus sample.

| Backend | Reported comparisons in the cited diaries |
|---|---|
| **Convex** | Faster. Membership is handler memory. Snapback stronger for rooms/roles (0101 would pick Snapback over Convex for that alone). Convex would skip the projection table (0100). Weekend prototype still Convex. Schema evolution with connected clients is the normal case; 0.1.7 wedged (0044). |
| **Supabase / RLS** | Expressiveness similar for this app; legibility worse (SQL in migrations versus table-adjacent declaration). If you cheat with `public-read` (0092, 0104), RLS would have been *safer*. Realtime+RLS alignment costs more (0109, 0113, 0114). Presence privacy lives in channels, not schema (0086). Supabase tempts using the auth table as the UI table; Snapback’s hard privacy forced a cleaner split (0015). |
| **Firebase rules** | Worst place for last-admin / membership transitions (0100). Rules drift from code (0101). Fast client, weak invariants. |
| **PocketBase** | Fastest to green (0114). The rubric does not reward Snapback’s reviewable authority. |
| **Postgres + Express** | No walls, more minutes per redesign (0100). You will get identity/membership slightly wrong. |

Diary 0114: “the friction that actually cost milestones was behavioral
(realtime custody, dev-loop stability, media limits), not syntactic.”
Explicit’s declaration ceremony is heavier than Convex’s and “made
authorization boundaries reviewable in a way the others don’t.” That
reviewability only appears if the lane takes the declaration.

## Snapback 1 evidence: what not to change in the existing subsystem

These diary complaints are the Snapback 1 system working. A Snapback 1 change
program should not “fix” them into Convex-shaped helpers. Snapback2 preserves
the properties in the synthesis above, not necessarily these mechanisms:

- Private roster with no existence oracle.
- `lastHolder` making an ownerless resource unrepresentable.
- Empty list versus explicit denial as a *product* choice, once the author
  knows both exist.
- One membership command per mutation (atomicity of
  `bootstrap` + `initialMembers` is the replacement).
- Clock-dependent visibility refusals.
- Present/absent indistinguishability on `removePrincipal`.
- Generated profile operations being directly callable when the transition
  matrix admits them (Diary 0058-messaging-snapback’s coordinator cannot be the only writer
  without omitting those transitions).

The failure mode is not that those rules exist. It is that the first
working app never encounters them, because `public-read` plus a handler
`if` is shorter, the template already did it, and an empty query does not
say why.

## Snapback 1 follow-through — what would make the existing surface smoother

For Snapback 1, these are grouped qualitatively: discoverability of the
already-shipped path, then remaining capability holes, then
security-preserving correctness. They are not a Plan, they do not amend LLP
0056, they do not prescribe Snapback2's mechanism, and they are not ranked by
diary count. A follow-up Plan or RFC should pick from this list with a
traceability row (observation, current gap, security invariant, existing
owner, decision vehicle). This document does not.

**Discoverability (capability exists; first path is still the wrong one)**

1. **Make membership-scoped reads the first path that works.** Put a
   visibility trap in the chat start packet. Empty-query-because-policy
   should name the policy in admin/dev inspection (not to the outsider).
   Stop teaching `public-read` memberships as the only template shape. A
   comment that “production uses membership” is not a paved path. Coterie
   should either use membership visibility on messages or say loudly that
   its public-read + handler check is a benchmark compromise. Ticket
   20260826 already frames the packet half; items 2–3 (diagnostic +
   setup-cost) still need an owner. LLP 0259’s 16,384-byte first-read
   ceiling is the constraint on the packet edit. Owner: LLP 0310 P18 /
   start-packet editor.

2. **Link the shipped group-chat composition, do not re-spec it.** The
   pieces exist: `bootstrap(resource, initialMembers)` + profile
   `list`/`myRole`/`projection` + table visibility
   `{ kind: 'membership', resourceField: 'roomId' }` + send-time recipient
   snapshot + generated `remove`/`changeRole` when the matrix admits them.
   Residual for a recipe is the **creator-seat** `joinedAt` hole, the
   principal bridge off the template’s `Id<'users'>`, and a start-packet
   link. Diary 0104 asked for the Explicit form of the same composition.
   Owner of the projection itself: LLP 0240.

3. **Teach the seed fixture lane next to Clique/Coterie replay.** The
   capability exists (`guide/backend/versioned-seeds.md`). Timed lanes
   still replay starter actions through the app write path.

4. **Keep membership meaning through the client envelope.** A role denial
   that arrives as `SNAPBACK_HANDLER_FAILED` (0112, 0045-a4-events-sweep)
   or a redacted throw (0094) costs a correction loop and hides the
   filter-versus-deny choice.

**Remaining capability holes (not already shipped)**

5. **Let the creator seat carry declared incidental values.** Additional
   `initialMembers` already may include insert-transition `fields`. The
   missing input is the server-synthesized creator seat. A later RFC must
   say which of those fields the caller may supply versus host-stamped
   provenance/`joinedAt`. Owner: LLP 0056.

6. **Brand `Principal` so `Id<'users'>` cannot silently seat.**
   Generate-time refusal would have saved 0108’s disclosed privacy
   regression. Independently, re-verify membership-visibility reads with
   corrected principals (ticket 20260822). The unperformed retest remains
   an uncertainty, not evidence of a second read-path defect.

7. **Relax or alias the `owner` lock-in on `authorityProfile()`.** Allow
   `bootstrapRole` / `lastHolder.protect` to be any named apex role
   (`admin`, `host`), or generate a documented alias so Clique’s “creator
   is admin, last holder still protected” is spellable without renaming
   the product. The lattice is load-bearing; the string `owner` is not.
   Owner: LLP 0240.

8. **Do not change in-place `requireRole` to inherit the lattice.** Direct
   `requireRole(resource, 'admin')` is an exact-role check. Closing it
   through the profile hierarchy would silently admit owners where an
   existing app asked only for `admin`. Prefer a distinct
   profile-qualified hierarchical helper, codegen expansion at *declared*
   call sites, or a diagnostic that names the exact/hierarchical split and
   suggests the explicit role set. Any migration must make broadened
   admission reviewable. Diary 0101’s observation stands; the first
   draft’s “or match `hasRole`” option is withdrawn.

**Correctness under the happy path**

9. **Close the two correctness holes** before claiming “declaration-owned
    authority” in competitive copy: role laundering via
    `Array.prototype.slice` (20260819), stale-handle membership plans
    against a predecessor manifest (20260826). These are not authoring
    polish.

**Withdrawn from the first draft.** “Attaching a profile should imply
kick/promote/list” — already the shipped generated-operation subset
(LLP 0240). “One pair of changes would have prevented most disclosed ACL
compromises” — unsupported without an incident-to-cause matrix; the
creator-seat hole does not explain 0092/0104/0105/0108 public-read. A
hypothesis, not a finding: template + empty-query diagnostic teaching
membership visibility would have changed the *eligible* Clique lanes’
first copy-paste. That is not the same as preventing 0108’s type
confusion or 0105’s inbox projection.

## Snapback 1 open questions

1. Was Diary 0108’s membership-visibility denial *only* the
   `v.principal()` / `Id<'users'>` confusion, or is there a separate
   read-path defect that public-read is still masking? The lane
   deliberately did not re-test. The unperformed retest is an uncertainty,
   not evidence of a second defect.
2. Is membership-visibility setup cost (`.membership()` + `bootstrap()`)
   itself enough to make `public-read` win inside a clock, independent of
   discoverability? Ticket 20260826 left this to a design owner.
3. Should Clique’s frozen contract *require* membership-scoped table
   visibility for messages, or keep scoring handler-checked `public-read`
   as green? The current rubric produces Finding 1.
4. After LLP 0240’s shipped projection, which product-fact needs remain
   unsupported: creator-seat incidentals, projection-declaration
   ergonomics, or first-party demo lag (`demos/messaging-snapback` still
   comments the interim)?
5. Should ordinary membership and authority-profile composition be
   analyzed as separate product surfaces for search, assets, and
   ephemeral state?
6. What backward-compatible helper can expose profile-hierarchical
   admission without changing the meaning of existing exact `requireRole`
   calls?
7. Should the Expo chat template remain deliberately simple and public,
   or include a second production-private schema variant with an explicit
   `Id<'users'>`–to–`Principal` bridge?
8. Should Familiar grow a first-class membership example, or is Explicit
   the completing profile for this app (Diary 0109’s reading)?
9. Which first-party demo should be the canonical complete group-chat
   composition, and how will its diary distinguish platform friction from
   benchmark-imposed shortcuts?

## Sources (diaries)

**Authored the primitive:** 0014 (RBAC authoring), 0015 (Shindig), 0021
(Team Chat), 0026 (Access Desk), 0027/0028 (todo/chat bakeoff
revocation), 0029 (Linear bakeoff, light), 0042 / 0044 /
0045-a4-events-sweep / 0046-a5-ai-research-room-sweep (0137 A2–A5), 0047
(ops ledger, seed/reset), 0058-messaging-snapback (historical
projection), 0081 (simplified Clique, then *dodged* the profile), 0086
(Coterie typing adoption), 0100 (Opus Clique explicit — primary Explicit
evidence), 0101 (Opus Clique familiar — primary Familiar evidence), 0105
(sol-high familiar local-main), 0108 (Sonnet familiar — privacy
regression).

**Eligible handler path (reached M3, no `.membership()` /
`.authorityProfile()`):** 0079, 0083, 0092–0099, 0102–0104, 0106, 0107,
and the four 0.1.29 grok/sol Explicit/Familiar lanes. Evidence for
Finding 1 and Finding 3.

**Censored or not independent membership builds:** 0073 (program digest);
0109–0114 (matrix digests); 0.1.29 GLM/terra Snapback (did not reach M3).

**First-party current-source checks added after the Codex review:**
`demos/party-wall` (ordinary membership asset sharing),
`demos/messaging-snapback` (profile present; comments still describe the
projection interim).

**Tickets that absorb diary friction:** listed in the header `Related`
block and Finding 8. Closed 0137 A2/A3 membership tickets, the 0100 /
0056 dated amendments, and
`issues/closed/20260821-private-authority-product-roster-decision.md` are
historical closures. They do not retire Findings 1, 3, 5, or 6.

## Codex review dispositions (2026-08-30)

Verbatim artifact: `llp/reviews/0331-scoped-roles-diary-feedback.codex.md`
(NOT READY on the first draft). This revision does not change `Status`.

| Concern | Disposition |
|---|---|
| MATERIAL 1 — shipped projection / generated ops treated as unfinished | FOLDED into Finding 4, Finding 8, conclusion 2; remaining work routed to LLP 0240 |
| MATERIAL 2 — asset sharing conflated ordinary membership with profile composition | FOLDED into Finding 8 and Finding 9; Party Wall cited |
| MATERIAL 3 — “most” / “how often” / “prevented most” exceed the evidence boundary | FOLDED: eligible-lane table; qualitative grouping; prevention claim withdrawn to a hypothesis |
| MATERIAL 4 — in-place `requireRole` lattice would broaden authorization | FOLDED: conclusion 8 withdraws in-place broadening |
| MINOR 5 — `initialMembers` already carry insert `fields` | FOLDED: creator seat only |
| MINOR 6 — template `v.id('users')` over-attributed | FOLDED: teaching/migration hazard |
| MINOR 7 — package-generic authority hooks are shipped | FOLDED: Finding 8 hooks row |
| MINOR 8 — “Diary consensus” too strong | FOLDED: Finding 10 table renamed |

## Revision 3 note (2026-08-30, Fable)

Revision 3 added §"Coverage" and the header-listed edits only. It did not
change `Status`, the diary findings (Findings 1–10), the Snapback 1 sections,
or the Codex dispositions above. The audit artifacts it rests on are
`llp/reviews/0331-coverage-audit.brief.md` and the nine
`llp/reviews/0331-coverage-audit.<slice>.md` files; they are same-family
research artifacts, not LLP 0005 reviews, and §"Coverage" open question 6
asks for the cross-family pass.
