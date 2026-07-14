# LLP 0011: Auth and permissions

**Type:** RFC
**Status:** Draft
**Systems:** Auth, Sync, Storage, API, Security, Client integration
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-07-14 (auth-program implementation reconciliation: items 4–8 now make the local sessions posture enableable with the shared invocation gate, server-derived handler authority, connection-bound projection, coordinator barrier, authorization invalidation, two-axis client storage, and signed-lease retained reads; hosted readiness and the broader permission-language questions remain open). 2026-07-13 (ENG-24596: record LLP 0055's implemented local auth catalog/provider/session core and its item-4/item-5 activation fence; earlier: narrow authorization-invalidation addendum: LLP 0053, once Accepted, supersedes the universal epoch/generic-resync mechanism while preserving server-directed fail-closed reauthorization, fresh snapshots, and user-switch wipe; quarantine is ratified as immediate clear-while-uncertain and typed denial ownership is pinned; earlier 2026-07-02: v1 auth/sync direction ratified before LLP 0032 P4)
**Related:** LLP 0000, LLP 0001, LLP 0004, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0020, LLP 0032, LLP 0039, LLP 0053, LLP 0055, LLP 0056, LLP 0057, LLP 0058

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
> [LLP 0055](./0055-auth-provider-protocol.spec.md) is built: the
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
> language and the hosted-provider/deployment boundary remain open; LLP 0058
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

The first built-in method is no longer open: LLP 0055 implements the local
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
the local target. LLP 0055's provider core is reachable through the staged
sessions posture; the shared `ctx.auth` invocation gate, connection-bound
session authority, invalidation barriers, and lease-bounded authorized sync are
built. A general permission/RLS language, external-provider adapters, and hosted
auth remain open, so this broad RFC itself stays Draft. Ledgered in
[LLP 0000](./0000-snapback.explainer.md).

Earlier: Valet's auth/RLS record ([LLP 0006](./0006-valet-retrospective.research.md))
is folded in — the stable-principal + identity-link model, write-side fail-closed
RLS, user-switch wipe, and webhook/admin/deletion rules are grounded in a built
system.
