# LLP 0011: Auth and permissions

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Sync, Storage, API, Security, Client integration
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-07-23 (LLP 0086 CC-4/CC-8 prior-art amendments: pushdown-compilability named as a citable requirement on row-visibility/sync-filter rules with the existing non-syncable fallback recorded as the non-pushdownable behavior class; guest auth with account claiming specified to docketable depth as proposed-in-amendment decisions; onboarding-ergonomics note rejecting default-allow while keeping fail-closed; "client-writable broadcast state without permissions" recorded as an anti-pattern; Triplit/Jazz convergence and the Jazz/Electric retreats cited as rationale evidence); 2026-07-16 (ENG-24920 companion amendment); 2026-07-14 (auth-program implementation reconciliation: items 4–8 now make the local sessions posture enableable with the shared invocation gate, server-derived handler authority, connection-bound projection, coordinator barrier, authorization invalidation, two-axis client storage, and signed-lease retained reads; hosted readiness and the broader permission-language questions remain open). 2026-07-13 (ENG-24596: record LLP 0057's implemented local auth catalog/provider/session core and its item-4/item-5 activation fence; earlier: narrow authorization-invalidation addendum: LLP 0053, once Accepted, supersedes the universal epoch/generic-resync mechanism while preserving server-directed fail-closed reauthorization, fresh snapshots, and user-switch wipe; quarantine is ratified as immediate clear-while-uncertain and typed denial ownership is pinned; earlier 2026-07-02: v1 auth/sync direction ratified before LLP 0032 P4)
**Related:** LLP 0000, LLP 0001, LLP 0004, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0020, LLP 0022, LLP 0032, LLP 0039, LLP 0053, LLP 0057, LLP 0058, LLP 0059, LLP 0060, LLP 0082, LLP 0083, LLP 0084, LLP 0085, LLP 0086

## Summary

Snapback auth is first-class application data. The paved path should provide a
built-in auth system whose users, accounts, sessions, and membership data live
next to the rest of the app data, while still allowing projects to bring their
own identity provider. Permissions must feed the query and sync layer so clients
only receive data they are allowed to see.

This RFC proposes a split between authentication, which establishes who the
request is, and authorization, which decides what that identity can read, write,
subscribe to, and sync.

This document records the v1 answer to the auth/sync direction call surfaced by
review — **ratified 2026-07-02 and narrowly refined 2026-07-13**: use
server-directed fail-closed reauthorization and fresh snapshots rather than
requiring universal precise live permission evaluation. LLP 0053, once
Accepted, owns whether a cause uses a matcher delivery obligation or the
authorization version; the earlier universal-epoch/generic-resync wording is
not a competing implementation contract.

> **Historical implementation checkpoint (2026-07-13 — ENG-24596).** The local
> provider core specified by
> [LLP 0057](./0057-auth-provider-protocol.spec.md) is built: the
> protected v1 auth catalog and namespace reservation, owner-only keyring,
> email-code challenge/exchange state machine, session-token families,
> capture mailbox, provider lifecycle/GC, process-bound impersonation carrier,
> collision rescue, and quiesced database-plus-keyring backup/declared restore.
> Its provider routes, closed DTOs, generated schemas, diagnostics, and the
> `auth.mintSession` / `auth.rescueCollidingTable` operator projections are
> implemented as well. The provider is deliberately **activation-fenced**:
> normal startup remains `dev`, public provider routes refuse with
> `SNAPBACK_AUTH_MODE_DEV`, and session minting refuses with
> `SNAPBACK_AUTH_POLICY_UNAVAILABLE` until item 4 installs staged mode and the
> shared invocation gate. Sessions remain non-enableable until item 5 installs
> connection binding, revocation projection, and the `AuthCoordinator`.
> Collision rescue is the narrow non-production exception needed to repair a
> catalog-name collision. At this item-3 checkpoint, `ctx.auth`, permission
> rules, authorized sync, and the hosted provider boundary remained later work.

> **Current local-target implementation (2026-07-14 — ENG-24597 through
> ENG-24607).** The staged mode and shared invocation gate, immutable
> server-derived `HandlerAuthProjection`, connection-bound session projection,
> two-phase revocation, `AuthCoordinator` clear barrier, negotiated
> authorization-invalidation protocol, authority descriptor/two-axis store,
> and signed-lease retained-read protocol are now implemented. The card-game
> proof exercises two real principals across finite and live hidden-hand reads,
> logout blanking, cold-process retained presentation, and exact lease expiry.
> This is a local-target implementation statement, not a status transition or
> author ratification of the Draft implementation Specs. General permission
> language and the hosted-provider/deployment boundary remain open; LLP 0060
> deliberately reports the local bearer target as not hosted-auth ready.

## Motivation

LLP 0000 treats auth as a v1 subsystem and explicitly wants auth data next to app
data. The reference apps make authorization unavoidable:

- messaging requires per-conversation visibility;
- the card game requires different players to see different hidden state;
- finance requires sensitive-data protection;
- team chat requires membership and channel visibility;
- Contract/Exact Design Mode needs permission diagnostics agents can understand.

Auth cannot be a frontend-only feature or a provider webhook bolted onto the
side. It must be part of the same data, sync, and diagnostics model as the rest
of Snapback.

## Goals

- Provide a built-in auth path suitable for prototypes and real apps.
- Keep auth data queryable, joinable, exportable, and portable.
- Support external identity providers without making them the data owner.
- Provide a stable `ctx.auth` shape for handlers.
- Enforce read visibility before sync data reaches clients.
- Give agents a way to test as a user, guest, admin, or denied session.

## Non-Goals

- Reimplement every identity provider feature.
- Define payments, billing, or enterprise compliance.
- Ship a full organization/team model before the base user/session/account model
  works.
- Let clients hide unauthorized data visually instead of preventing sync.

## Authentication Model

Snapback should model at least:

- user: the application-level person or actor;
- account: a provider-linked identity such as email, OAuth, passkey, or external
  provider subject;
- session: a current authenticated client session;
- token or credential metadata, stored according to the security model;
- optional membership records owned by app or future team abstractions.

The built-in provider can own account creation and session lifecycle. Bring-your-
own provider maps external identities into Snapback users and accounts.

Provider-specific claims may be retained, but application code should normally
depend on Snapback user ids and app-owned membership data rather than raw
provider tokens.

Valet built this model and its concrete shape is worth adopting
(`[observed - Valet LLP 0006/0042]`): Snapback owns a **stable principal id**
(`ctx.auth.userId` is always Snapback-issued), and external providers attach via
**identity links** in an `_auth_identities` table mapping
`(provider_key, external_subject) → principal`. First-login provisioning is
**transactional from the verified request** — success must not depend on a webhook
racing in first. Password hashing (Argon2) must run **outside the DB lock**
(hash first, then take the lock only for the brief user/session write), because the
single-writer model serializes everything held under that lock.

This refines, and partly **contradicts**, "auth is first-class application data."
Valet deliberately kept its core `_auth_*` tables (users, accounts, sessions,
verification codes, identities) **server-authoritative, never synced to clients, and
hidden from generated client types**, specifically to prevent accidental leaks; the
app-facing layer was app-defined profile/membership tables keyed by
`ctx.auth.userId` (`[observed - Valet LLP 0006/0042]`). Reconcile the two by
distinguishing **(a) protected identity/session/credential state** — server-owned,
not synced, hidden from client types — from **(b) app-queryable profile and
membership data** keyed by `userId`, which is genuinely first-class and joinable.
"Exportable/portable" follows the same line: Valet's bundle exported identity
(`_auth_users`/`_auth_accounts`/`_auth_identities`) but **excluded** ephemeral
sessions, verification codes, webhook-dedupe state, and secrets.

## ctx.auth

Handlers receive an auth context with a stable minimum shape:

```ts
type AuthContext = {
  userId: string | null
  sessionId: string | null
  isAuthenticated: boolean
  provider?: string
  roles?: string[]
}
```

The final generated type may be richer, but app code should not rely on raw
provider tokens inside ordinary queries and mutations. Test and doctor tools
must be able to construct explicit auth contexts for validation.

`ctx.auth` must be available **offline/locally** and must **agree between the
optimistic client run and the authoritative server replay**. In Valet, `ctx.auth`
came only from a server handshake, so a cold-start offline app could not even run a
user-scoped sync filter — adding a local auth identity was "the single biggest
blocker to a real offline-first demo"; and once a local identity existed, server
replay still saw no `ctx.auth.userId`, so the two executions disagreed and
auth-dependent mutations behaved differently
([LLP 0006](./0006-valet-retrospective.research.md),
`[confirmed - Valet diaries, 2026-06-25]`). The replay environment
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Mutation Replay) must
carry the auth context so the server reconstructs the same `ctx.auth` the client
optimistically used, and a local identity must never be silently mistaken for
server-verified identity. The server remains the authority on identity — `userId`
is derived server-side, never trusted from a client-forged token.

## Authorization Model

Authorization has two layers:

- function-level checks inside queries and mutations;
- data-visibility rules that constrain what rows can be read, subscribed to, and
  synced.

The second layer is the critical one for local-first. If a row is not visible to
the current auth context, it must not enter the initial snapshot, realtime delta,
or retained local store for that client.

Draft rule shape:

- rules are source-authored and generated into a manifest;
- rules are analyzable where they affect sync;
- rules can reference auth context, row fields, query args, and declared
  relationships;
- unsupported or opaque rules make a query non-syncable unless a later Spec
  defines a safe fallback.

Valet's enforced RLS pins the safe defaults this Spec should state outright
(`[observed - Valet LLP 0006/0019]`). Rules are enforced on **writes as well as
reads**, and the write check is **two-sided**: insert requires the new document to
match the policy; update requires both the existing row *and* the merged result to
match (so an update cannot move a row out of — or into — a forbidden state); delete
requires the existing row to match; otherwise the write is rejected. The model
**fails closed**: a missing auth variable resolves to null, which matches no rows
(the safe default), and a filter that references auth while the client is
unauthenticated is rejected immediately rather than returning everything. Auth
variables in a sync filter (`{$var: "auth.userId"}`) are resolved **once at subscribe
time**, so the filter is a pure function of `(document, resolved filter)` — see the
local-first implications below for what that means when auth changes mid-connection.

## Permission Composition

The effective permission for a live query should compose:

- table visibility rules;
- query filters and args;
- function-level checks;
- target capability gaps;
- admin or test impersonation mode where explicitly requested.

Permission denial should be explainable. A diagnostic should identify whether a
request failed because the user is unauthenticated, lacks membership, references
a forbidden row, uses an unsyncable rule, or requires a target capability that is
not present.

## Bring Your Own Provider

External providers are identity sources, not replacements for Snapback's app
authorization model.

The BYOP boundary should support:

- mapping provider subject to Snapback account;
- linking multiple provider accounts to one user;
- verifying sessions or tokens through provider-specific adapters;
- storing provider metadata needed for audit and debugging;
- keeping app permissions in Snapback-owned tables and rules.

Provider-specific features can be exposed through adapter capabilities, but the
paved path should keep application auth decisions portable.

Valet implemented a swappable provider trait (built-in, JWKS, Clerk, WorkOS, and a
hybrid) substantially end to end, so the abstraction is proven realistic, and it
settled several decisions this Spec should adopt rather than re-open
(`[observed - Valet LLP 0042]`):

- **Account-link safety.** Linking two identities that share a verified email is
  allowed *within* one provider, but **cross-provider email auto-linking must be
  opt-in only** — it is the cross-provider account-takeover vector.
- **Webhook verification belongs to the runtime, before the adapter.** The runtime
  performs the canonical HMAC signature check (with a replay window — Valet used 5
  minutes — and a body-size cap before JSON parse), so a malicious caller cannot
  reach adapter parsing code without a valid signature.
- **Admin operations are not implicitly authorized.** Creating or banning users
  requires an explicit `requiresAdmin`/system-invoker marker; "any mutation can
  create users" is a bug.
- **A provider `UserDeleted` must not cascade-delete application data by default.**
  Mark the identity link inactive and fire an app-level cleanup hook instead — the
  cascade-vs-retain decision is the app's, and silently deleting data "becomes a
  compliance emergency the day the first enterprise customer asks about it."

## Local-First and Realtime Implications

Permissions affect sync in both directions:

- reads: clients receive only authorized rows;
- writes: mutations run with `ctx.auth` and may reject unauthorized changes;
- permission changes: clients must not keep trusting rows they could see before
  but may no longer see;
- reconnect: resumed changes must be filtered through current permissions, not
  just historical visibility.

**Ratified v1 answer (2026-07-02): resubscribe on permission change, but make
it server-directed and fail-closed.** Because Valet resolved a subscription's auth
variables **once at subscribe time**, an auth/permission change did not
retroactively re-filter a live subscription; the model required a resubscribe to
pick up new visibility (`[observed - Valet LLP 0006/0019]`). Universal
mid-connection re-evaluation — emitting precise `remove` deltas for rows a
still-connected client may no longer see — is real work, especially for rules that
depend on membership tables or opaque query functions. For v1, prefer a bounded
contract:

- rules declare the auth variables and permission tables/scopes they depend on;
- matcher-observed ordinary writes re-query and protect a potential shrink with
  LLP 0053's witnessed delivery obligation, while permission-backing and
  enumerated writeless events advance the authorization version;
- the server projects the applicable disposition/obligation to affected
  subscriptions, retained queries, and protected room authorities;
- clients immediately clear affected results from read/render — quarantine while
  uncertain, delete on trusted proof — before reauthorization;
- the fresh subscription snapshot is filtered through current permissions;
- reconnect/any non-live auth-scoped resume always takes a fresh snapshot; epoch
  equality alone never releases a cached live result.

This is stricter than Valet's stale-until-manual-resubscribe behavior and cheaper
than making the v1 matcher solve arbitrary permission dependency invalidation.
Precise live `remove` deltas remain a later optimization for analyzable
single-table or membership-filter cases, using the LLP 0008 membership matcher
when the dependency graph is known.

**Ratified narrow addendum (2026-07-13): Accepted LLP 0053 controls
invalidation.** The root ledger refines the mechanism above without weakening its
security outcome. Server-resolved authorization, immediate fail-closed handling,
a fresh authorized snapshot before release, and user-switch wipe remain this
RFC's requirements. Under the now-Accepted LLP 0053:

- an ordinary matcher-observed row change does not automatically advance a
  coarse authorization epoch; a potential/result shrink is instead a persistent
  composite-witness delivery obligation;
- `permissionBacking` writes and enumerated writeless events advance the global
  authorization version and project durable-query and ephemeral-room
  reauthorization obligations;
- generic `resync_required`/destructive drain is not sufficient proof of
  delivery; disposition, fences/tombstones, ACK, and authenticated retirement
  are required; and
- reconnect/any non-live resume always fresh-snapshots an auth-scoped result,
  rather than releasing it because an epoch happens to compare equal.

The older verb "clear" is now exact: **clear means deny read and render before
reauthorization**. `quarantine` is a conforming immediate clear while authority
is uncertain (bytes remain suspended and unreadable); trusted denial or boundary
proof escalates to `delete`. This is the ratification 0053 previously inferred
but did not own. LLP 0053 is Accepted, so its review gate no longer blocks items
6 or 8. Their local dependency and implementation gates have now landed:
item 6 installs protected-query/room invalidation and item 8 installs the signed
lease/store protocol. Hosted, distributed, and broader permission-language
claims retain their separate gates.

Function-level checks also gain one trusted failure surface. LLP 0004 owns the
generated spelling and this RFC owns the semantic API:
`ctx.permissions.deny()` is a host-owned terminal operation producing
`SNAPBACK_AUTH_PERMISSION_DENIED`. The shared invocation gate brands it and
discards any later handler result even if local JavaScript catches an exception.
A plain throw or forged code is not permission proof; invalidation quarantines
it as an untyped failure. Declarative RLS and room reauthorization are the other
trusted producers enumerated by LLP 0053.

A user's local store can contain sensitive data. **On user switch, the client must
wipe all local data, mutation queues, and subscriptions** before resubscribing as
the new identity — Valet does exactly this when `auth_ok` returns a different
`userId`, "to prevent cross-user data leakage" (`[observed - Valet LLP 0006/0008]`),
which is the concrete answer to the open question about clearing local stores on
sign-out. Adapters should expose sign-out, session-expiry, and local-store cleanup
behavior. The exact storage policy is target-specific, but it must be visible in
capability reports.

## Admin, Tests, and Impersonation

Agents need safe impersonation. The local doctor/sandbox path should run a query,
mutation, or subscription check as:

- unauthenticated;
- a specific user;
- a user with specific roles or memberships;
- admin bypass, explicitly marked.

Admin bypass must never be implicit. Diagnostics and logs should clearly show
when a permission result came from bypass mode. Valet's dev mode is the model to
copy: it accepted any string as a user id with no signature validation, but only
when a `--dev` flag was set, and every use was logged with a warning
(`[observed - Valet LLP 0006]`) — explicit, logged, never the default.

## Security Considerations

LLP 0009 owns the runtime security model. Auth depends on it:

- secrets and provider credentials are not ordinary handler globals;
- logs redact tokens and secret claims;
- app code cannot bypass auth by reading raw database files;
- hosted deployments isolate sessions, users, tenants, and apps.

## Validation Requirements

The first auth acceptance tests should prove:

- built-in user/session creation or a stub that matches the final shape;
- `ctx.auth` passed to query and mutation handlers;
- unauthenticated denial;
- per-user row visibility;
- two clients subscribed to the same logical query receiving different results;
- write-side RLS rejection on insert, update (pre- and post-merge), and delete;
- a fail-closed case: an unauthenticated client subscribing to an auth-filtered
  query is rejected, not served all rows;
- `ctx.auth` available and identical across an optimistic client run and its server
  replay (offline-first parity);
- a user switch wipes all local data, queues, and subscriptions before resubscribing;
- the LLP 0053 invalidation matrix: ordinary shrinking writes use witnessed
  delivery obligations without a coarse epoch; permission-backing/enumerated
  events advance the authorization version; quarantine blocks read/render
  before reauthorization, trusted denial deletes, and every non-live auth-scoped
  resume fresh-snapshots;
- `ctx.permissions.deny()` produces trusted
  `SNAPBACK_AUTH_PERMISSION_DENIED`, while a forged code/plain throw remains an
  untyped fail-closed quarantine;
- doctor output explaining an allow and a deny.

## Open Questions

The first built-in method is no longer open: LLP 0057 implements the local
passwordless email-code provider and capture mailbox. Magic-link, password,
OAuth, passkey, and external-provider ordering remain later product choices.

- Which analyzable permission-rule subset should later graduate from
  server-directed resubscribe to precise live `remove` deltas?
- Are roles a core primitive or app-level data by default?
- How are organizations and teams modeled?
- What is the first source syntax for permission rules? (Valet used structured,
  serializable filter expressions resolved at subscribe time; opaque rules are not
  incrementally matchable — see [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).)
- (Largely answered) Local stores are cleared by a full wipe on user switch /
  sign-out; encryption-at-rest remains open.
- Which BYOP provider should be the first adapter? Valet shipped Clerk and WorkOS
  adapters, so either is a proven starting point.

## Dated addendum: agent principals and membership roles (2026-07-16)

Authentication has immutable human and agent principal kinds. A
service-principal invocation retains its actor while optionally projecting a
human effective principal; handlers receive only the server-derived sealed
projection. Delegation never changes durable identity and never permits a
caller-supplied actor/effective substitution.

The roles open question is answered for this slice: roles and memberships are
app data in a system-recognized declaration shape. The host owns principal,
resource, role, provenance, and transition enforcement; raw writes are denied.
Role failures expose only `{kind: "role"}` publicly, with full cause confined
to gated diagnostics, so denial is not a hidden-row oracle.

## Dated addendum: prior-art course corrections (2026-07-23)

Recorded under [LLP 0086](./0086-prior-art-course-corrections.plan.md) CC-4
and CC-8 (rows 6, 8, 10), from the 2026-07 prior-art passes
([LLP 0082](./0082-instantdb.research.md)–[LLP 0085](./0085-jazz.research.md)).
The pushdown requirement, anti-pattern, and citations below are rationale and
requirement additions to this RFC's existing model; the guest-claiming design
is **proposed-in-amendment** — Draft-level decisions, revisable at
implementation review, made concrete enough that implementation is docketable.
Nothing here changes a ratified decision.

### Requirement: pushdown-compilability

**Pushdown-compilability** (cite as: *LLP 0011, pushdown-compilability
requirement, 2026-07-23*): every rule in the row-visibility / sync-filter
class must remain compilable into the query plan — a predicate over
`(document, resolved auth context)` that the storage and matcher layers can
evaluate in-plan, at snapshot and live-delta time, rather than as post-query
per-row filtering on the live path. The scope is deliberately narrow: it binds
row-visibility and sync-filter rules only. Function-level authorization checks
are arbitrary code and are untouched, and the existing draft rule shape's
fallback — an unsupported or opaque rule makes its query non-syncable — is
untouched. Any future permission-language implementation Spec must cite this
requirement by name; that citation is the checkable carry-forward.

Current strategy, documented against the requirement: no general permission
language is implemented yet (the first source syntax remains an open question
above), but everything ratified so far already conforms. The Valet-derived
shape this RFC adopts — structured, serializable filter expressions with auth
variables resolved once at subscribe time, leaving a pure function of
`(document, resolved filter)` — is pushdown-compilable by construction, and
the LLP 0008 matcher and card-game hidden-hand reads operate on exactly such
analyzable filters. The requirement is recorded now because it is a property a
permission language gets by early design and cannot cheaply retrofit.

Behavior class for a rule that cannot be pushed down — **recorded choice: the
existing non-syncable fallback, i.e. online-only execution**. A
non-pushdownable rule makes its query non-syncable; the query can still run as
an ordinary server-evaluated request, but it never enters snapshots, live
deltas, or the retained local store. Silent bounded post-filtering on the live
path is rejected: it is the exact failure mode the evidence warns against.
That evidence: InstantDB evaluates CEL `view` rules post-query on every
object, including during live invalidation; it flagged CEL-to-`where`
pushdown as needed in 2024 and had not verifiably shipped it by mid-2026
(LLP 0082 §Permissions, §What to learn).

### Guest auth with account claiming (proposed-in-amendment)

Guest auth — a usable principal before sign-up, later claimed into a real
account — is adopted as a paved-path feature (Instant's best onboarding idea;
LLP 0082 §Auth). Server-evaluated and fail-closed like everything else in
this RFC. The decisions below are proposed-in-amendment, each conservative and
consistent with the existing model:

- **Principal stability / identity continuity.** A guest is a full Snapback
  principal: a real Snapback-issued `userId` with a guest marking, not a
  provisional id. Claiming preserves the `userId` — it attaches an identity
  link (`(provider_key, external_subject) → principal`) to the existing
  principal and clears the guest marking, so guest-created data needs no
  rekeying and `ctx.auth.userId` is continuous across the claim.
- **Proof of claim.** A claim requires a completed, server-verified challenge
  (the LLP 0057 email-code challenge/exchange, or a future provider's
  equivalent) performed from within the guest's authenticated session. No
  client-asserted claim is ever accepted.
- **Existing-account collision.** If the verified identifier already maps to a
  different principal, the claim is **refused** with a typed error — no
  auto-merge of the guest into the existing account. Data merge across
  principals is app-level and dangerous (the same account-takeover caution as
  the cross-provider auto-linking rule above); v1 records merge as out of
  scope, with an explicit app-level migration hook as the escape hatch.
- **Concurrent and replayed claims.** The claim transition runs under the
  single-writer lock, guarded by the principal's current state: the first
  successful claim wins; a concurrent duplicate observes already-claimed and
  fails with a typed error. Challenge codes are single-use (LLP 0057's state
  machine), so a replayed proof fails.
- **Session rotation at claim.** The claiming session's token family is
  rotated at the moment of claim and all other guest-era session tokens are
  revoked, so no token minted under guest authority ever carries claimed
  authority. Because `userId` is unchanged, this is not a user switch: the
  full local wipe is not triggered.
- **Audit events.** Claim initiation, success, and failure (with cause class)
  are durable audit events. Public failure shape stays non-oracular, with
  full cause confined to gated diagnostics, matching the role-failure rule
  above.
- **LLP 0053 interaction.** The claim commit is a `permissionBacking` write:
  it advances the authorization version and projects reauthorization
  obligations, so live results re-snapshot under the claimed authority.
  Claiming is not assumed grow-only — visibility may shrink as well as grow,
  and the ordinary fail-closed reauthorization path covers both directions.
- **Failure atomicity.** The claim transition — identity-link insert, guest
  marking clear, session rotation, audit write, authorization-version advance
  — commits atomically under the single-writer lock. Any failure leaves the
  principal fully guest with prior sessions valid; there is no
  partially-claimed state. Expensive work (hashing, external verification)
  runs outside the lock, per the existing Argon2 rule.

### Onboarding ergonomics: fail-closed stays; the first rule must be trivial

Fail-closed defaults are not softened for onboarding. Instant's default-allow
(absent rules mean `true`; LLP 0082 §Permissions) is **explicitly rejected**,
with its cost acknowledged: default-allow genuinely converts the first-five-
minutes funnel, and fail-closed means a fresh app shows nothing until its
first rule exists — a real onboarding tax, and unreviewed default-allow is
exactly wrong for agent-generated apps. The paved path absorbs that tax on
the authoring side instead: writing the first rule (an owner-only or
authenticated-only visibility rule) must be a one-liner, scaffolded by the
schema/rules generators and surfaced by permission-denial diagnostics that
say which missing rule would have allowed the read.

### Recorded anti-pattern: client-writable broadcast state without permissions

The Cloudflare Agents SDK's state sync — a whole-blob `setState` persisted to
the agent's SQLite and broadcast to all connected clients, where **clients can
push `setState` back**, distinguished only by a `source` parameter, with no
permission check (LLP 0083 §The realtime layer Cloudflare ships) — is recorded
here as a named anti-pattern: **client-writable broadcast state without
permissions**. Under this RFC, every client-originated write to shared state
passes server-evaluated authorization before it is applied or fanned out; a
provenance tag is metadata, never an authorization boundary. This binds
Snapback's own surfaces (the ephemeral lane already conforms: LLP 0013 makes
publish and subscribe authorization explicit and fails closed on custom keys)
and names the pattern for design review of future ones.

### Independent validation: convergent permission language, revisable by design

Two independent data points validate this RFC's server-evaluated, revisable
stance. Triplit converged on nearly the same permission shape: roles matched
from JWT claims, then per-collection, per-operation permissions expressed as
query filters, evaluated exclusively server-side, with invalid writes
rejected at the server and rolled back on the client (LLP 0084 §Triplit) —
independent arrival at "declarative filter permissions feed what syncs." And
Jazz's founder supplied the epitaph for the opposite design: permission
mistakes were "hard to evolve once baked into the system" — authorization
baked into cryptographic data structures could not be revised without
rewriting history, and Jazz v2 rebuilt onto server-enforced policy queries
(LLP 0085 §The retreat, §Jazz v2). Keeping rules as server-evaluated,
source-authored artifacts — revisable without touching stored data — is
therefore load-bearing, not incidental.

### Primary-source retreat citations

The two first-party retreats are cited here as rationale evidence for the
server-authoritative foundation this RFC builds on. Jazz's 2026-04-18 trilogy
("What is Jazz?", "What we learned from classic Jazz", "Four fresh ideas
behind Jazz"): adopters valued permissions *shaping what syncs* but not the
cryptography; what broke included "public-key complexity, the unusual
permission APIs, or the fact that permission mistakes were hard to evolve
once baked into the system"; and every serious team needed "at least a
semi-trusted authority somewhere" (LLP 0085 §The retreat — in their own
words). Electric's pivot post (2024-07-17): "Electric Next is a **sync
engine, not a local-first software platform**," reversing the finality-of-
local-writes stance to "embraces tentativity" (LLP 0022 §ElectricSQL). Both
are costly, first-party admissions that authority has to live at the server
— the premise of this RFC's authorization model.

## Status

Draft, with the v1 auth/sync direction **ratified 2026-07-02** by Charlie
(applied by Claude under Charlie's same-day delegation), answering this
section's own ask to settle the call before sync hardens — ratified ahead of
LLP 0032 P4's reconnect/resume protocol work so the wire design can assume
it. The ratified call: **server-directed resubscribe on permission change**
— rules declare their auth dependencies, clients fail closed, and release
only through a fresh authorized snapshot — plus the **user-switch full wipe**
of local data, queues, and subscriptions. The 2026-07-13 ratified addendum makes
Accepted LLP 0053 the controlling narrow mechanism: witnessed
shrinking-delivery obligations for ordinary writes, authorization versions for
enumerated events, query/room reauthorization, quarantine-as-immediate-clear,
and unconditional fresh snapshot on non-live resume. The older universal
epoch/generic-`resync_required` wording is historical, not a second protocol.
LLP 0053 is Accepted and its ordered item-6/item-8 implementation now ships on
the local target. LLP 0057's provider core is reachable through the staged
sessions posture; the shared `ctx.auth` invocation gate, connection-bound
session authority, invalidation barriers, and lease-bounded authorized sync are
built. A general permission/RLS language, external-provider adapters, and hosted
auth remain open, so this broad RFC itself stays Draft. Ledgered in
[LLP 0000](./0000-snapback.explainer.md).

Earlier: Valet's auth/RLS record ([LLP 0006](./0006-valet-retrospective.research.md))
is folded in — the stable-principal + identity-link model, write-side fail-closed
RLS, user-switch wipe, and webhook/admin/deletion rules are grounded in a built
system.
