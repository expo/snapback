# 0014 — Public scoped-role authoring

## 2026-07-16 — From runtime primitive to an ordinary application surface

I built a small sessions-mode announcements backend to exercise the complete
public RBAC path: a source-authored app-wide membership declaration, generated
membership writes, a declaration-bound live query, an imperative role check,
and a deliberately hostile raw roster write. Three users make the visibility
boundary concrete: Alice joins and posts, Bob sees nothing and cannot post
until he joins, and Eve's raw `ctx.db` insert is centrally refused and grants
her no authority.

### What felt good

One `.membership()` declaration now drives several layers that would otherwise
drift: the manifest's axes and transition vocabulary, nominal resource typing,
permission-backing reads, generated role and value types, query helpers,
mutation-only write helpers, provenance, and central enforcement. Exporting the
table builder from `schema.mjs` gives `functions.mjs` a pleasant declaration-
qualified spelling: `appMembers.memberOf()` reads like the policy rather than
like a hand-written join.

The security boundary was easy to demonstrate without test-only authority.
The acceptance uses real email-code sessions, and the handler receives only
the server-derived `ctx.auth.userId`. `ctx.membership.appMembers.insert(...)`
looks like a small SDK convenience, but the useful property is underneath it:
the host derives the caller class and target, matches the closed transition,
and owns the write. The hostile `ctx.db.insert('appMembers', ...)` fixture then
proves that choosing a different handler spelling does not bypass policy.

Nominal `v.id('events')` also improved the authoring story. The generated
schema preserves `Id<table>` instead of flattening it to `String`, and codegen
rejects both an argument and a row field for the wrong resource table. Carrying
that type provenance in the function manifest gives the Rust loader the same
fail-closed check for direct artifacts.

### What felt bad or surprising

The runtime was substantially ahead of its public surface. Membership
activation, transition execution, permission reads, and raw-write refusal all
existed, but an ordinary schema could not spell `v.principal()`, `v.id()`, or
`.membership()`, and generated handlers had no typed helpers. That gap made the
feature look design-only even though much of its harder enforcement already
shipped.

The app-wide singleton has two nearby spellings: the declarative helper omits
the resource (`appMembers.memberOf()`), while the imperative permission helper
passes `null` (`requireRole(null, ...)`). Both are type-safe and unambiguous,
but the asymmetry is learnable friction.

The first real sessions demo with an Ibex handler also found a startup lifecycle
bug outside RBAC proper. Cold artifact preflight prepared JavaScript directly
on a Tokio worker, tripping the runtime's blocking-FFI guard; existing session
demos used only HostPlan and did not reach that branch. Routing all three
startup preflight branches through the existing blocking boundary fixed it and
added a restart regression. This was a useful reminder that generated surface
completeness needs a real-server app, not only emitter snapshots.

Membership rosters are intentionally private authorization backing in v1.
That is safer than returning membership facts from a privileged helper, but it
means an application that wants a public member directory needs a separate
projection rather than reading the authority table directly.

### Snapback compared with familiar stacks

With Convex, I would likely implement role checks in functions and share a
helper library. The application code could be compact, but proving that every
reactive query, empty-result wake, and alternate write path uses the same
helper would remain application work. Snapback's declaration is heavier, but
it lets the host connect the role check to read dependencies and revocation.

With Supabase, PostgreSQL RLS can put the online predicate close to the data
and database constraints can protect parts of the roster. Expressing the
closed self/other role-transition matrix, generating client-side nominal ids,
and keeping offline/live invalidation aligned would still span policy SQL,
triggers, and application types. Snapback centralizes that subset, while
honestly leaving hosted and retained role-gated reads unavailable.

### Exact and Contract observations

Codegen emitted Contract metadata with the membership table in the query read
set, so later Contract consumers will invalidate the right binding. This demo
does not boot a Contract surface, and Exact does not participate; the proof is
intentionally about Snapback's headless authoring and enforcement boundary.

### Workarounds and remaining edges

- Resource-scoped nominal bindings are covered by the codegen/load tests; the
  real-server demo uses the smaller app-singleton form to focus on transitions
  and visibility.
- There is no incremental membership semi-join delta lane or retained/offline
  role-gated read yet; live queries conservatively re-run.
- `ctx.permissions` is unavailable in actions because actions have no
  transactional read set, and hosted RBAC remains unsupported.
- The guide previously listed scoped roles as an explicit GAP. The new
  `auth/scoped-roles` page absorbs it with snippets exercised by this demo and
  the package test, so no separate guide-gap ticket is necessary.

## 2026-07-18 — Self-service transitions without roster ids

The first version proved self-join, but it accidentally hid a reachability
cliff: `setRole`, `remove`, and `patch` required the private membership row id.
I extended the demo to invite Bob, let Bob accept with `setSelfRole`, and let
him leave with `removeSelf`. The host resolves only Bob's own row and then runs
the unchanged transition matrix, so the app gains no roster existence oracle.

This feels closer to RLS-backed products such as Supabase: routine self-service
flows are short, while the policy remains structural. Compared with a
React/Convex helper that first queries a membership document, Snapback avoids
shipping the authority row to the client or trusting a handler-side equality
check. The remaining other-target helpers still need an id; this change is
deliberately the self-service subset, not a general private-roster resolver.

## 2026-08-16 — One generated roster replaces the demo's dual authority shape

I migrated RBAC from an app-singleton membership plus separately protected
application data to one resource-scoped `appMembers` relation. `createApp`
still uses the specialized atomic bootstrap, but invitation, acceptance,
leave, role change, owner transfer, removal, roster pagination, and caller role
now come directly from `authorityProfile()`. The `applications` and
`announcements` tables reference that same profile through membership
visibility, so the row that answers a transition also answers read admission
and live invalidation.

What felt especially good was deleting the hand-written invite/accept/leave
handlers. The generated operation set is conditional on the transition matrix,
which made absence useful: an operation that the schema cannot prove simply
does not appear in the API. Owner transfer also stopped looking like two risky
role updates; one mutation returns two receipts and the storage seam protects
the exactly-one-owner final state. The authorization review made every
generated operation's profile generation and principal dependence visible,
which was much easier to audit than a convention hidden in handler source.

The hardest part was reconciling roster privacy with useful pagination. The
page must expose only `roster.visible`, keep the continuation opaque and bound
to one profile/scope, and capture both the caller admission and range read.
Another surprise was that a required incidental display field prevents a
generic `invite` operation: codegen cannot safely invent its value. Making
such product metadata optional, or moving it to an ordinary profile table, is
the honest workaround. The first rollout also found stale authoring fixtures
that predated the every-table-policy rule; those fixtures now declare their
visibility rather than bypassing G1.

Compared with Convex, the resulting component API is similarly terse through
ordinary query/mutation hooks, but Snapback additionally derives the server
transition and invalidation facts from the schema instead of relying on a
shared application helper. Compared with Supabase, the membership policy plays
the role of RLS plus transition triggers, while the generated owner-transfer
receipt and live dependency are first-class rather than separate SQL and
client conventions. Snapback asks for a more explicit finite transition
matrix, but this migration removed more handwritten authority code than it
added.

Membership-visible search and asset sharing remain intentionally refused, and
the demo does not work around either with a mirrored roster. That keeps this
entry scoped to rollout steps 2–3; the later Clique rebuild must wait for those
independent qualifications.

## 2026-08-16 — authority writes stay specialized

The owner-write rollout exposed a hostile `rawJoin` probe that reached the
private membership table through generic `ctx.db.insert`. That path predates
LLP 0264's ordinary-table policy and correctly remains a hard refusal during
the warning window. The merged authoring contract catches that probe even
earlier: codegen refuses a generic authority-table writer, while the lower-level
membership corpus retains the runtime refusal proof for direct artifacts. The
published demo therefore contains only declaration-owned `ctx.membership`
operations and keeps Eve's unseated read/live probes.
This is more explicit than app-authored RLS mutation code and avoids turning a
read membership declaration into generic write authority.
