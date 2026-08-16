---
title: Familiar TypeScript profile (Experimental, non-default)
id: backend.familiar-profile
order: 5
audience: agent-first
capabilities: [backend.familiar-profile-v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, llp/0252-convex-familiar-authoring-profile.rfc.md, llp/0253-familiar-profile-v1-api.spec.md, src/runtime.rs, packages/snapback-codegen/ctx.d.mts, packages/snapback-codegen/define.mjs, packages/snapback-codegen/familiar.mjs, packages/snapback-codegen/index.mjs, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-react/familiar.mjs, packages/snapback-contract/auth-coordinator.mjs, llp/0044-asset-storage-pipeline.rfc.md]
examples: [tests/fixtures/familiar-todo, tests/fixtures/familiar-todo-explicit, packages/snapback-codegen/familiar-phase-b.test.mjs, packages/snapback-react/familiar.test.mjs, packages/snapback-react/package.test.mjs, packages/snapback-contract/auth-coordinator.test.mjs, packages/snapback-cli/templates/expo-chat, tests/acceptance/fixtures/familiar-video-asset, tests/acceptance/familiar-video-asset-v1.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
reviewed: 2026-08-15
reviewed-authorities-digest: sha256:6bc6ecfd2478295ba356a56cfdeb7c854d66c9d7fc484c68568e5b945583c973
---

# Familiar TypeScript profile (Experimental, non-default)

> **Experimental / non-default in 0.1.22.** The familiar profile is a source
> adapter over Snapback's canonical schema, function, runtime, and client
> owners. It is not a second backend and does not make Convex compatibility a
> target claim.

Use this profile when top-level TypeScript modules and
`query`/`mutation`/`action` constructors materially improve authoring. Use the
default explicit profile for the broadest Snapback vocabulary, especially
declarative plans, routes, cron, search/vector, and
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

Nested modules are helpers, not function namespaces. A top-level
function/intent module may export only familiar function or asset-intent
values; move exported constants and helpers out of it.

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

That shared vocabulary includes typed opaque arrays and objects. A nested
`v.principal()` may record a historical recipient snapshot, including inside
`v.array(...)`; it does not grant current authority. Membership, visibility,
and grants must still use their first-class declarations. If an installed
Familiar schema used `v.json()` for data that is now structured, keep the field
name and use the reviewed
[`ConvertJsonToStructured` migration](./migrations.md#evolve-vjson-into-a-structured-field);
direct retyping refuses.

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
Row-shaped query returns remain arrays. A point query can declare an exact
single value such as `returns: v.union([v.doc("todos"), v.null()])` or a closed
`v.object(...)` and return that value directly; `useQuery` receives the object
or `null`, not a one-row array. Familiar actions can read auth/runtime/secrets,
refuse, and call a generated mutation reference; they do not expose `ctx.db`,
fetch, assets, jobs, realtime, or streaming.

## Declare non-derived asset intents

A bare `v.assetRef()` still derives the small private JPEG/PNG default. When
the application needs another media type or policy, export the canonical
`defineAssetUpload` constructor from a top-level Familiar module. The module
and export become the same two-segment generated namespace as functions:

```ts source=tests/acceptance/fixtures/familiar-video-asset/media.ts
import { defineAssetUpload } from './generated/server';

export const videoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['video/mp4'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'owner-only' },
  video: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

This declaration produces canonical intent `media.videoUpload` and generated
reference `api.media.videoUpload`. Use that nominal reference with the normal
asset client; the upload, trusted byte detection, video finalization, custody,
typed attachment, and authorized readback paths are identical to the explicit
profile. The [asset guide](./assets.md) owns the complete policy and client
flow. Do not encode media bytes in JSON or split data URLs across document
fields when the derived image default is too narrow.

## Put authorization before business logic

`auth: "authenticated"` proves only that a principal exists. It does not prove
the caller is an active member or administrator of an app resource. For every
protected handler, make the active-member/admin decision before returning rows
or performing effects.

Start with declarative table visibility. A membership declaration can protect
its resource table through the resource row's system id and protect direct
children through their required resource id:

```ts fragment reason="membership declaration is application-specific; this shows the two shipped visibility bindings"
conversations: defineTable({ title: v.string() }).visibility({
  kind: "membership",
  declaration: conversationMembers,
  resourceField: "_id",
  roles: ["member", "admin"],
}),
messages: defineTable({
  conversationId: v.id("conversations"),
  body: v.string(),
}).visibility({
  kind: "membership",
  declaration: conversationMembers,
  resourceField: "conversationId",
  roles: ["member", "admin"],
}),
```

Ordinary `ctx.db` reads enforce those policies, including inside familiar
queries and mutations. Prefer that fail-closed path whenever the governed row
directly names the membership resource; it makes an omitted handler check hide
the row instead of widening access.

For a multi-hop relation the grammar cannot declare, use the sanctioned
handler sequence: prove the role with the declaration-qualified permission
helper, elevate only the exact protected read, and validate that every resolved
row belongs to the authorized resource before returning it:

```ts fragment reason="familiar query declaration fields and result shape vary; this is the authorization-critical handler body"
handler: async (ctx, args) => {
  await ctx.permissions.conversationMembers.requireRole(
    args.conversationId,
    "member",
    "admin",
  );

  const message = await ctx.db.elevated.get("messages", args.messageId);
  if (!message || message.conversationId !== args.conversationId) return [];

  const quoted = message.quotedMessageId
    ? await ctx.db.elevated.get("messages", message.quotedMessageId)
    : null;
  if (quoted && quoted.conversationId !== args.conversationId) return [];
  return [{ message, quoted }];
},
```

`ctx.db.elevated` is an explicit call-local authority, not an ambient server
mode. Its closed read allowlist is `get`, `getMany`, `uniqueMany`, and `query`.
It bypasses only table row visibility and remains bounded, captured, and
OCC-validated. It has no write members, is refused in actions, and does not
bypass result/egress, asset, membership-writer, or field-masking rules. If the
handler receives only a child id, perform one bounded elevated read to derive
the resource id, immediately call `requireRole` on that derived id, and return
nothing before the check succeeds.

Repeat this sequence in **every** quote lookup, receipt mutation, live query,
and other multi-hop handler that remains undeclarable, and add negative tests
for both a non-member and an authorized resource id paired with a foreign row
id. This repetition is intentional because it is where otherwise-correct
realtime code goes subtly unsafe.

The full patterns are [Scoped roles and memberships](../auth/scoped-roles.md),
[Protecting live and retained data](../auth/protecting-data.md), and
[Bind a principal to your app user](../auth/app-identity-binding.md). Use
`ctx.membership.<declaration>.bootstrap(resourceValues, initialMembers?)` when
one group and its initial roster must be atomic: the host adds the creator,
accepts at most 64 unique additional principals, authorizes every added seat
from the creator's bootstrap role through the ordinary transition matrix, and
writes nothing if any seat is invalid. Do not substitute a client-provided user
id or an `auth` string for server-side checks, and do not make protected backing
tables `public-read` just so a trusted handler can inspect them.

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
SecureStore adapter in 0.1.22, so do not silently fall back to
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
4. For a simple private JPEG/PNG field in 0.1.22, a bare `v.assetRef()` derives
   the bounded default upload intent. Upload through the generated asset
   reference and `assets.upload(...)`, wait for its ready asset id, then attach
   the typed id in a mutation. Use the complete [asset guide](./assets.md), not
   a base64 data URL. If the default is insufficient, declare
   `defineAssetUpload` in a top-level module and upload through its
   `api.module.export` reference.
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
grammar refuses: declarative plans, routes, cron, search/vector, membership
declarations not expressible in the shared schema
vocabulary, or action fetch/stream/host effects. Treat the diagnostic's route
as the boundary; do not import explicit builders into a familiar function
module or hide them behind a helper.

The complete refusal table remains in
[Generated artifact custody](../getting-started/generated-artifacts.md#diagnose-familiar-profile-refusals).
