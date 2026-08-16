---
title: Bind a principal to your app's user identity
id: auth.app-identity-binding
order: 2
audience: agent-first
capabilities: [auth.sessions, auth.external-identity-broker]
authorities: [llp/0039-auth-vertical-slice.rfc.md, llp/0057-auth-provider-protocol.spec.md, llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md, llp/0096-auth-profiles-for-protocol-clients.spec.md, llp/0151-first-party-identity-integrations.rfc.md, llp/0183-zerobugs-quality-surface.rfc.md, llp/0214-snapback-identity-core.spec.md, llp/0226-identity-architecture.decision.md, packages/snapback-client/index.mjs, packages/snapback-codegen/ctx.d.mts, src/auth/invocation.rs, src/storage/auth_identity.rs, src/cli.rs, demos/browser-auth/server/gateway.mjs, demos/browser-auth/snapback/schema.mjs, demos/browser-auth/snapback/functions.mjs, demos/browser-auth/tests/acceptance/browser-auth.mjs, demos/zerobugs/control/snapback/schema.mjs, demos/zerobugs/control/snapback/functions.mjs]
examples: [demos/browser-auth, demos/zerobugs/control]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-16
reviewed-authorities-digest: sha256:f2306d9477abd4af9d9e81a0fd94f5a9f71f3280544cb4626ea2b93c669116f6
---

# Bind a principal to your app's user identity

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](./targets.md).

Almost every app ported onto Snapback already has its own user identity: a
`users` table with a `sourceUserID` from an OAuth provider, roles, a display
name, rows that point at it. Snapback gives you a different thing —
`ctx.auth.userId`, a **server-minted principal id**. Making an existing app
work means building the join between them: a principal↔app-user table, and a
trustworthy way to populate it.

This page is that recipe. It is the first thing a port needs and the easiest
thing to get wrong, because the obvious approach — a mutation that takes the
app's user id as an argument and binds it to the caller's principal — is a
complete authentication bypass.

## Claims can inform behavior; they cannot populate a binding yet

A real catalog-backed session now exposes a deeply frozen
`ctx.auth.claims`. It contains only the identity that authenticated this
session plus active, applicable assurance records. Email, phone, and username
use their catalog-canonical value; OIDC and other federated identities expose
their exact provider/issuer/subject and omit mutable profile values. Anonymous,
dev-impersonated, admin, system, and agent authority do not receive claims.

This makes read-only in-handler inspection possible, but does not make an
ordinary `bindMe(...)` mutation safe. Snapback does not yet invoke the sealed
verified-provisioning writer described by LLP 0214 §§5.3–5.5. A
`verifiedProvisioning` identity-binding declaration currently installs the
write seal only: ordinary buffered writes and every HostPlan/IR write form fail
with `SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN`. Codegen also rejects the sealed
table as a declared handler, generated data-resource/data-transaction write
target, maintained-projection output, or non-empty versioned-seed target. Runtime
rechecks buffered batches, HostPlan writes, declarative seed installation, and
both projection rebuild and same-transaction maintenance. Schema migration and
destructive reset remain separately authorized operator lifecycle operations;
neither is an application binding writer.

> **The future sealed writer may use claims to select the app row once. The
> durable binding key will still be `ctx.auth.userId`.** Email is mutable, and
> an issuer/subject pair belongs to the auth substrate; neither replaces the
> principal in steady-state app reads or writes.

Never accept a claims object, email, subject, or app-user id from the client as
proof. Those are selection inputs under caller control.

## Define the binding table

Whichever way you populate it, the table itself is the same shape: one row
per principal, uniquely indexed on **every** side so the mapping cannot fan
out. The Zerobugs control's declaration:

```js source=demos/zerobugs/control/snapback/schema.mjs
export const identityBinding = defineTable({
  principal: v.principal(),
  userID: v.id('user'),
  sourceUserID: v.string(),
})
  .index('by_principal', ['principal'], { unique: true })
  .index('by_user', ['userID'], { unique: true })
  .index('by_source_user_id', ['sourceUserID'], { unique: true });
```

Three unique indexes, not one. `by_principal` stops a principal owning two
app identities; `by_user` and `by_source_user_id` stop one app identity being
claimed by two principals. The storage constraint is the backstop that
survives a bug in the handler logic — see
[declare structural uniqueness](../backend/mutations.md#declare-structural-uniqueness).

Keep the physical reference (`v.id('user')`) *and* the external id
(`sourceUserID`) as separate fields: the typed id is what private rows join
on, and the external string is what a provider lookup or an audit trail needs.

Do not declare this table under `verifiedProvisioning` and then try to write it
from an application handler: the declaration seals the table, but there is no
host-invoked inside writer yet. Until that platform lane lands, use Pattern A
or the acceptance-only Pattern B below on an undeclared table, with their
trusted-writer and reachability constraints intact.

After creation, every protected handler resolves only
`principal → binding → app row`; it does not repeat a claim lookup.

## Resolve the principal in every protected handler

Once the row exists, no handler ever accepts a caller-supplied identity again.
Every private read and write starts by resolving principal → binding → app
row, and re-verifies the binding still names the same row it did at write
time:

```js source=demos/zerobugs/control/snapback/functions.mjs
export async function requireSourceUser(ctx) {
  requireFixtureSession(ctx);
  const principal = ctx.auth.userId;
  const binding = await ctx.db
    .query('identityBinding')
    .withIndex('by_principal')
    .eq('principal', principal)
    .first();
  if (!binding) {
    throw new Error('session principal is not bound to a source user');
  }
  const user = await ctx.db.get('user', binding.userID);
  if (
    !user
    || user.id !== binding.sourceUserID
    || (user.role !== 'crew' && user.role !== 'user')
  ) {
    throw new Error('session principal has an invalid source user binding');
  }
  return user;
}
```

(`requireFixtureSession(ctx)` is the Zerobugs control's own fixture gate — it
just refuses an unauthenticated `ctx` before fixture work; your port omits it
and relies on `auth: 'authenticated'` plus the binding resolution below.)

Roles come from the resolved app row, never from a mint argument or a request
body:

```js source=demos/zerobugs/control/snapback/functions.mjs
export async function requireCrew(ctx) {
  const user = await requireSourceUser(ctx);
  if (user.role !== 'crew') {
    throw new Error('source user is not authorized');
  }
  return user;
}
```

Expose the caller's own binding as a query taking **no arguments** — the
absence of an identity selector is the point, and it is worth asserting in a
test that the generated args schema is empty:

```js source=demos/zerobugs/control/snapback/functions.mjs
export const acceptanceActorBindingSelf = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['identityBinding', 'user'],
  result: results.records(v.object({
    principal: v.string(),
    sourceUserID: v.string(),
    userID: v.id('user'),
    role: v.string(),
  })),
  handler: async (ctx) => {
    const user = await requireSourceUser(ctx);
    return [{
      principal: ctx.auth.userId,
      sourceUserID: user.id,
      userID: user._id,
      role: user.role,
    }];
  },
});
```

If your app also uses [scoped roles](./scoped-roles.md) or `authScopeField`
query scoping, those compare against the **principal**, not the app user row.
Store the principal on rows you want scoped by the declarative surface, and
use the binding for everything that must reach the app's own user record.

## Pattern A — still conforming: bind in trusted server code

This is the strongest executable shape today, not a hosted-production claim.
Snapback's local external-identity seam uses a trusted server-side component
that authenticates the user through your existing front door
(OAuth, your own login), calls the `auth.mintSession` host operation for that
verified identity, and hands the resulting bearer back to that same user.

The broker is the only place that holds all three facts at once — the
verified external identity, the app user row it maps to, and the principal
`auth.mintSession` just returned. So the broker is where the binding row gets
written, before the bearer is released:

This pattern currently uses an ordinary, deliberately non-public mutation, so
its binding table must not be declared as a `verifiedProvisioning`
identity-binding table. That declaration would correctly seal the write.

```js fragment reason="broker-side shape; the mint host-op authorities and the adopt-bearer half are the subject of auth/native-apps.md"
// Trusted server-side broker (never in an app bundle):
const verified = await myIdentityProvider.verify(request);      // your front door
const appUser = await myUsers.findBySubject(verified.subject);  // your user row
const minted = await hostOps.auth.mintSession({ email: verified.email });
const session = createExternalSessionClient(baseUrl, { bearerToken: minted.token });

// Only now — knowing both sides — write the binding under privileged authority,
// then release the bearer to this user and nobody else.
await session.mutate(api.bindVerifiedIdentity, {
  args: { issuer: verified.issuer, subject: verified.subject },
});
return { bearerToken: minted.token };
```

Two properties make this safe, and both are load-bearing:

- **The binding mutation is privileged, not public.** It is invoked with the
  broker's authority, is idempotent per principal, and refuses a principal or
  app user that is already bound. It must not be reachable from an ordinary
  client session; if your app has a public gateway or function allowlist,
  leave it out of the allowlist (see the omission technique below).
- **The bearer is released only to the authenticated caller.** A generic
  "mint a session for this email" endpoint with no front door is the same
  bypass in a different place.

The client then adopts the bearer with
`createExternalSessionClient(baseUrl, { bearerToken })` and carries it
normally; rotation goes through `replaceBearerToken`. Both halves are covered
in [authenticate a native app](./native-apps.md).

For a browser that needs durable coordinator custody, do not stop at that
external-bearer client. The registered
[browser sign-in and reload recipe](../recipes/browser-auth.md) stages a
one-use challenge/code and lets ordinary `authExchange` move the bearer into
`AuthCoordinator`'s IndexedDB record. It proves the private binder's gateway
omission, full-page restoration without another exchange, logout revocation,
and cross-subject protected-data isolation in real Chrome.

**Honest boundary:** `auth.mintSession` is a dev/test/demo host operation
requiring the admin token, the process-bound impersonation capability, and
active sessions mode. From a terminal, the paved spelling of the same
operation is `snapback session mint --email <email> --ready-file <ready-file>`.
LLP 0045's production email delivery adapter is unbuilt
and the Cloudflare arm exposes no sessions routes, so this page does not claim
hosted production identity. The *pattern* is the production shape; the
current mint mechanism is local.

## Pattern B — acceptance harness: a frozen actor map

An acceptance suite has a different problem. It needs several real principals
bound to specific fixture users so it can assert per-actor visibility, and
principal ids are freshly minted every run — so nothing can be seeded. But the
suite also has something a product does not: a **frozen fixture**, whose exact
user population is known in advance.

The Zerobugs control uses that to build a bootstrap that is safe *because*
it is closed. Five properties, all of them necessary:

1. **A frozen actor map.** The mutation's argument is an actor *name* from a
   closed set (`'creator'`, `'crew-admin'`, …), not a source user id. It
   selects one member of a hard-coded map; anything else refuses.
2. **A complete-fixture precondition.** Binding refuses unless exactly the
   frozen fixture is loaded — the right user count, the right ids, the right
   roles, the completion sentinel present.
3. **One-to-one refusal on both sides.**
4. **Set closure.** After the last actor is bound, the mutation refuses
   permanently.
5. **Gateway omission.** The bootstrap operations are absent from the app's
   function allowlist, so they are reachable only over the direct client the
   harness drives — never over the product's HTTP surface.

```js source=demos/zerobugs/control/snapback/functions.mjs
    const principal = ctx.auth.userId;
    const existingPrincipal = await ctx.db
      .query('identityBinding')
      .withIndex('by_principal')
      .eq('principal', principal)
      .first();
    if (existingPrincipal) {
      throw new Error('session principal is already bound');
    }

    const existingBindings = await ctx.db.query('identityBinding').take(6).collect();
    if (existingBindings.length >= 5) {
      throw new Error('actor binding is closed after the frozen actor set is complete');
    }

    const [existingUser, existingSource] = await Promise.all([
      ctx.db
        .query('identityBinding')
        .withIndex('by_user')
        .eq('userID', sourceUser._id)
        .first(),
      ctx.db
        .query('identityBinding')
        .withIndex('by_source_user_id')
        .eq('sourceUserID', sourceUser.id)
        .first(),
    ]);
    if (existingUser || existingSource) {
      throw new Error('source user is already bound');
    }
```

The suite drives it by minting one session per actor (see
[mint test personas](./sessions-and-principals.md#mint-test-personas-the-complete-local-recipe)),
calling the binding mutation once per persona, and then proving the mapping
by reading `acceptanceActorBindingSelf` back. A rerun against an
already-bound instance must observe the refusal and then prove the existing
row is the same one-to-one mapping — that is what makes the harness idempotent
without weakening the refusal.

The same closure technique gates the fixture loader itself; see
[loading large deterministic fixtures](../testing/large-fixtures.md#gate-the-loader-in-a-sessions-app).

**This is a harness pattern, not a product answer.** Its safety comes
entirely from the frozen fixture and the closed actor set. Do not lift it
into an application: without those, the actor argument is a caller-selected
identity again.

**Evidence:** the control's binding surface is exercised by its own
`bun run test:lane2` (runtime-independent witnesses) and `test:lane2:live`
(a seven-actor live gate), and by the retained ZB gate receipts under
[`demos/zerobugs/evidence`](repo:demos/zerobugs/evidence). It is not part of
the repository's CI proof; treat the snippets as a reviewed reference
implementation whose behavior is receipt-witnessed at a point in time.

## Reset reissues principals; it does not reissue app rows

`app.reset` advances the auth boundary: existing bearers stop working and the
same email remints to a **different** `userId`
([reset invalidates sessions](./sessions-and-principals.md#reset-invalidates-sessions-and-reissues-principals)).
Your app user rows, if they are seeded, survive. So every binding row is stale
after a reset and must be rebuilt.

Two rules follow:

- **Never seed a binding row with a captured principal id.** Seed the app
  users; bind after the reset, once real principals exist.
- **Order the bootstrap: reset → load fixture → mint principals → bind.**
  The dependency is circular by nature (the fixture creates the users a later
  binding maps to), which is exactly why the loader and the binder each carry
  their own closure sentinel.

## Current boundary

The local target now supplies verified read-only claims and a complete
ordinary-write seal for declared identity-binding tables. It does **not** yet
supply the host-invoked writer inside that seal. Pattern A and the frozen
Pattern B remain the executable conforming choices because they arrange for a
trusted writer to hold both sides before releasing or using the principal;
their tables remain undeclared until the host writer exists. Draft LLP 0151
separately owns future provider identity/lifecycle and hosted-target work; this
app-level join does not pretend to implement it.

## Anti-patterns

- **Do not accept an app user id as a mutation argument and bind it to the
  caller's principal.** That is the bypass this whole page exists to prevent;
  the caller controls the argument.
- **Do not write a `verifiedProvisioning` handler today.** Its declared
  identity-binding table is sealed against ordinary handlers, and the
  host-invoked inside writer remains an open platform ask.
- **Do not derive the app identity from anything the client sends** — not an
  email in the body, not a header, not a JWT the client hands you. If the
  handler did not mint it, the handler cannot verify it.
- **Do not index only `by_principal`.** Without unique indexes on the app-user
  and external-id sides, one app identity can be bound by two principals.
- **Do not seed binding rows.** Principal ids are minted per run and reissued
  by reset; a seeded binding points at an identity that no longer exists.
- **Do not leave the bootstrap binding mutation in your public function
  allowlist.** Reachability from an ordinary client session turns a closed
  bootstrap back into an identity-selection API.
- **Do not read app roles from the session.** Resolve the binding and read
  the role off the app row.
