---
title: Familiar TypeScript profile (Experimental, non-default)
id: backend.familiar-profile
order: 5
audience: agent-first
capabilities: [backend.familiar-profile-v1]
authorities: [llp/0252-convex-familiar-authoring-profile.rfc.md, llp/0253-familiar-profile-v1-api.spec.md, packages/snapback-codegen/familiar.mjs, packages/snapback-codegen/index.mjs, packages/snapback-react/familiar.mjs, packages/snapback-contract/auth-coordinator.mjs]
examples: [tests/fixtures/familiar-todo, tests/fixtures/familiar-todo-explicit, packages/snapback-codegen/familiar-phase-b.test.mjs, packages/snapback-react/familiar.test.mjs, packages/snapback-react/package.test.mjs, packages/snapback-contract/auth-coordinator.test.mjs, packages/snapback-cli/templates/expo-chat]
status: current
targets: [local]
maturity: partial
since: 0.1.21
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:5bbaa09b77b377fd52748aa45b5d12482e00b7c2ad9d20e60f002c5b7409a875
---

# Familiar TypeScript profile (Experimental, non-default)

> **Experimental / non-default in 0.1.21.** The familiar profile is a source
> adapter over Snapback's canonical schema, function, runtime, and client
> owners. It is not a second backend and does not make Convex compatibility a
> target claim.

Use this profile when top-level TypeScript modules and
`query`/`mutation`/`action` constructors materially improve authoring. Use the
default explicit profile for the broadest Snapback vocabulary, especially
declarative plans, routes, cron, custom asset intents, search/vector, and
effectful actions. One backend selects one profile; mixing explicit
`schema.mjs`/`functions.mjs` with familiar `schema.ts`/function modules is a
typed refusal.

## Select the profile explicitly

The opt-in lives only in `snapback/codegen.policy.json`:

```json source=tests/fixtures/familiar-todo/codegen.policy.json
{
  "schemaVersion": "snapback.codegen-policy.v1",
  "committedProjections": ["normalized-definition.v1.json"],
  "authoringProfile": "snapback-familiar-ts-v1"
}
```

Omitting `authoringProfile` selects `snapback-explicit-v1`. Do not add a
runtime flag or client-side profile switch; generated app identity carries the
selection.

The familiar backend root is flat:

```text
snapback/
  codegen.policy.json
  schema.ts
  todos.ts                 # exports become api.todos.*
  contracts.ts             # non-function helper module
  generated/               # generated server/api declarations and runtime
```

Nested modules are helpers, not function namespaces. A top-level function
module may export only familiar function values; move exported constants and
helpers out of it.

## Declare schema and functions

The schema vocabulary is the shared `defineSchema`/`defineTable`/`v` surface:

```ts source=tests/fixtures/familiar-todo/schema.ts
import { defineSchema, defineTable, v } from "./generated/server";

export default defineSchema({
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
  }).index("by_completed", ["completed"]),
});
```

Each function declares its authority and data reach next to the handler. A
module `todos.ts` with export `list` becomes canonical name `todos.list` and
generated reference `api.todos.list`:

The shared operation-name grammar admits either one identifier or exactly two
identifiers separated by one dot (`IDENT` or `IDENT.IDENT`). Familiar
top-level modules generate the two-segment form, and the leaf is not restricted
to CRUD names. Client-consumed JavaScript exposes dotted operations through
the generated `api` namespace; it does not emit quoted or dotted ESM export
aliases.

```ts source=tests/fixtures/familiar-todo/todos.ts
export const list = query({
  args: { completed: v.boolean() },
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx, args) => ctx.db
    .query("todos")
    .withIndex("by_completed", (q) => q.eq("completed", args.completed))
    .collect(),
});
```

Every function requires `args`, `returns`, `auth`, and `handler`. Queries add
`reads`; mutations add `reads` and `writes`; actions may add `secrets`.
Queries are live by default; set `delivery: "read"` for a one-shot query.
Canonical queries are list-shaped. Represent a get as a bounded zero-or-one
array rather than returning a nullable document. Familiar actions can read
auth/runtime/secrets, refuse, and call a generated mutation reference; they do
not expose `ctx.db`, fetch, assets, jobs, realtime, or streaming.

## Put authorization before business logic

`auth: "authenticated"` proves only that a principal exists. It does not prove
the caller is an active member or administrator of an app resource. For every
protected handler, make the active-member/admin decision before returning rows
or performing effects. Prefer the declaration-qualified membership helpers so
the check participates in the transaction and refuses without revealing
whether the resource or membership exists.

The full patterns are [Scoped roles and memberships](../auth/scoped-roles.md)
and [Bind a principal to your app user](../auth/app-identity-binding.md). In
particular, use the documented `ctx.permissions.<declaration>.requireRole(...)`
shape for a denying handler and a declared membership predicate for an
empty-result list. Do not substitute a client-provided user id or an `auth`
string for those server-side checks.

## Keep React hook arguments identity-stable

Familiar's React doorway is `@expo/snapback-react/familiar`. It exports
`SnapbackProvider`, `useQuery`, `useMutation`, `useAction`, `useQueryState`,
and `skip` over the canonical React owner. `useQuery` returns current live data
or `undefined`; use `useQueryState` when the UI must render connection,
freshness, blocked, or diagnostic state.

Memoize stable-content argument objects at the component boundary:

```tsx fragment reason="application component names vary; packages/snapback-react/package.test.mjs proves stable identity stays silent while five consecutive equal-content identities emit SNAPBACK_REACT_LIVE_HOOK_ARGS_IDENTITY_CHURN"
const listArgs = useMemo(() => ({ completed }), [completed]);
const todos = useQuery(api.todos.list, listArgs);
```

Do the same for nested scope/value objects passed to live or presence hooks.
The canonical store key is content-based, so an inline equal-content object is
not a data-integrity bug, but repeated identity churn performs descriptor
handoffs and triggers the development diagnostic
`SNAPBACK_REACT_LIVE_HOOK_ARGS_IDENTITY_CHURN`. Memoization is lifecycle
hygiene, not a workaround for stale data.

## Persist native session custody with SecureStore

Web uses `createIndexedDbAuthCustodyStorage()`. React Native has no shipped
SecureStore adapter in 0.1.21, so do not silently fall back to
`createMemoryAuthCustodyStorage()` for a user session that must survive a
process restart. Install the SDK-compatible `expo-secure-store`, then adapt it
to `AuthCoordinator`'s ownership and compare-and-swap contract. This tested
adapter namespaces records by the canonical app-id hash and validates bytes on
both read and write:

```js source=packages/snapback-contract/auth-coordinator.test.mjs
function createSecureStoreAuthCustodyStorage(SecureStore) {
  const ownershipTails = new Map();
  return {
    async withOwnership(appId, operation) {
      const key = `snapback.auth-custody.${authAppIdHash(appId)}`;
      const previous = ownershipTails.get(key) ?? Promise.resolve();
      let release;
      const next = new Promise((resolve) => { release = resolve; });
      ownershipTails.set(key, previous.then(() => next));
      await previous;
      const read = async () => {
        const encoded = await SecureStore.getItemAsync(key);
        return encoded === null ? null : validateAuthCustody(JSON.parse(encoded), appId);
      };
      try {
        return await operation({
          read,
          async replace(expectedRevision, record) {
            const current = await read();
            const actualRevision = current?.revision ?? null;
            if (actualRevision !== expectedRevision) {
              throw Object.assign(new Error('durable custody changed before compare-and-swap'), {
                code: 'SNAPBACK_AUTH_CUSTODY_CAS_STALE',
              });
            }
            const validated = validateAuthCustody(record, appId);
            await SecureStore.setItemAsync(key, JSON.stringify(validated));
            return validated;
          },
        });
      } finally {
        release();
      }
    },
  };
}
```

Import `authAppIdHash`, `AuthCoordinator`, and `validateAuthCustody` from
`@expo/snapback-contract/auth-coordinator`, import `* as SecureStore` from
`expo-secure-store`, construct the adapter once, and pass it as `storage` with
`broadcastChannelFactory: null` and `hintStorage: null` on native. On web keep
the IndexedDB adapter. Acceptance must terminate and relaunch the native
process, then prove `synchronize()` restores the settled session without a new
email-code exchange.

This JSON carrier is for ordinary bearer custody. It does not claim native
sender-constrained key custody; the Secure Enclave/Keystore proof transport is
still outside the shipped native target.

## One Expo Router journey

Here is the shortest coherent application loop, rather than six disconnected
reference exercises:

1. Scaffold the published Expo app, install `expo-router` and SDK-compatible
   `expo-secure-store`, copy the conventional `snapback/` backend when adding
   Snapback to an existing project, and select the familiar policy above.
2. Author `schema.ts` plus top-level function modules. Put
   `SnapbackExpoProvider`/`SnapbackProvider` and the one long-lived client in
   `app/_layout.tsx`; route files import generated `api.module.export`
   references and use memoized argument objects.
3. Gate each protected query/mutation with active membership or admin checks.
   Keep this server-side even if Expo Router already hid the screen.
4. For a simple private JPEG/PNG field in 0.1.21, a bare `v.assetRef()` derives
   the bounded default upload intent. Upload through the generated asset
   reference and `assets.upload(...)`, wait for its ready asset id, then attach
   the typed id in a mutation. Use the complete [asset guide](./assets.md), not
   a base64 data URL. Custom `defineAssetUpload` declarations are not in the
   familiar function-module grammar in 0.1.21; choose the explicit profile if
   the default intent is insufficient.
5. After every source change run `snapback generate snapback`; review and
   commit the refreshed `snapback/generated/artifacts.json` plus only the
   projections selected by policy. `_generated/` is retired: do not create it,
   including as a symlink, because codegen and dev admission refuse the
   alternate root. Never patch a generated manifest to make a type error
   disappear.
6. Run `snapback dev snapback --expo` for the supervised device loop. Keep the
   acceptance owner separate from the rendered route: use the generated
   template's headless `acceptance.mjs`/`acceptance.live.mjs` pattern to boot
   isolated state, mint the test persona, drive generated references, observe
   the live result, and shut down. Add an on-device process-kill/relaunch rung
   for SecureStore restoration and the actual picker/upload path.

The profile changes authoring syntax only. Expo boot, asset custody,
acceptance process ownership, generated-artifact review, live delivery, and
authorization remain the same canonical Snapback systems documented by their
linked pages.

## Know when to leave the profile

Move the backend to the explicit profile when it needs a surface the familiar
grammar refuses: declarative plans, routes, cron, search/vector, custom asset
intents, membership declarations not expressible in the shared schema
vocabulary, or action fetch/stream/host effects. Treat the diagnostic's route
as the boundary; do not import explicit builders into a familiar function
module or hide them behind a helper.

The complete refusal table remains in
[Generated artifact custody](../getting-started/generated-artifacts.md#diagnose-familiar-profile-refusals).
