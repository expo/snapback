---
title: Familiar TypeScript profile (Experimental, non-default)
id: backend.familiar-profile
order: 5
audience: agent-first
capabilities: [backend.familiar-profile-v1, authority.profile.v1]
authorities: [llp/0056-scoped-roles-and-memberships.rfc.md, llp/0231-entity-and-permissioning-recommendation.rfc.md, llp/0237-bounded-handler-modules.rfc.md, llp/0240-application-authority-profiles.rfc.md, llp/0252-convex-familiar-authoring-profile.rfc.md, llp/0253-familiar-profile-v1-api.spec.md, llp/0059-session-projection-and-client-barrier.spec.md, crates/snapback-engine/src/runtime.rs, packages/snapback-codegen/ctx.d.mts, packages/snapback-codegen/define.mjs, packages/snapback-codegen/familiar.mjs, packages/snapback-codegen/index.mjs, packages/snapback-harness/ctx-bootstrap.js, packages/snapback-react/familiar.mjs, packages/snapback-contract/auth-coordinator.mjs, packages/snapback-contract/auth-custody-secure-store.mjs, llp/0044-asset-storage-pipeline.rfc.md]
examples: [tests/fixtures/familiar-todo, tests/fixtures/familiar-todo-explicit, tests/fixtures/familiar-vdoc-vertical, scripts/familiar-vdoc-vertical-contract.mjs, packages/snapback-codegen/familiar-phase-b.test.mjs, packages/snapback-codegen/rbac-authoring.test.mjs, packages/snapback-react/familiar.test.mjs, packages/snapback-react/package.test.mjs, packages/snapback-contract/auth-coordinator.test.mjs, packages/snapback-contract/auth-custody-secure-store.test.mjs, packages/snapback-cli/templates/expo-chat, tests/acceptance/fixtures/familiar-video-asset, tests/acceptance/familiar-video-asset-v1.mjs]
status: current
targets: [local]
maturity: partial
since: 0.1.21
reviewed: 2026-08-21
reviewed-authorities-digest: sha256:2d6275363dfe790730aed135fec80e708549fbcebe299b5dcb6f9385b1edebd4
---

# Familiar TypeScript profile (Experimental, non-default)

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

> **Experimental / non-default in 0.1.23.** The familiar profile is a source
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
  // @ref LLP 0234#phase-g2--d2-enforcing-closure — this dual-profile fixture's
  // public operations share synthetic rows, so every todo is public by design.
  todos: defineTable({
    title: v.string(),
    completed: v.boolean(),
  }).visibility({ kind: "public-read" }).index("by_completed", ["completed"]),
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
`v.object(...)` and return that value directly; the packed vertical fixture
qualifies clean generation, native execution, and headless/live plus React
projection, so `useQuery` receives the object or `null`, not a one-row array.

The relational alternative remains available when an empty row set is the
desired carrier, including membership-admission paths: declare the
**unbounded** `v.array(v.doc(table))`, bound the handler with `.take(1)`, and
return `[]` or `[row]`; unwrap the first row in application code. Do not add
`{ maxItems: 1 }`: bounded document arrays lower to `results.value`, not
`results.documents`, and cannot carry relational empty-row-set semantics.

```ts source=packages/snapback-codegen/familiar-phase-b.test.mjs
export const byId = query({
  args: { id: v.id("todos") },
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx, args) => ctx.db
    .query("todos")
    .withIndex("_id")
    .eq("_id", args.id)
    .take(1)
    .collect(),
});
```

A mutation may return one `v.doc(table)`, but a mutation document array is
refused; return an array of closed receipt records or ids instead. Familiar
actions can read
auth/runtime/secrets, refuse, and call a generated mutation reference; they do
not expose `ctx.db`, fetch, assets, jobs, realtime, or streaming.

## Translate the Familiar handler dialect

Familiar is TypeScript-shaped source lowered into the bounded Snapback handler
runtime. It is not unrestricted Node or browser TypeScript. Use this compact
rewrite table before authoring or when
`SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE` routes here:

Diary search terms: dynamic computed access; imported helper; same-file function declaration.
Further terms: captured constants; mutation document arrays; dense scoped number.

| Intent | Familiar-looking form that refuses | Shipped rewrite | Choose Explicit when… |
| --- | --- | --- | --- |
| Read a dynamic array position | `array[i]` | Iterate with `for...of`, or use a literal property/index when the position is statically fixed. | Dynamic indexed algorithms are central to the operation. |
| Share logic | `import { helper } from './helper'` | Put a named function declaration in the same function module. | The backend requires a real multi-file handler graph. |
| Capture configuration | a referenced top-level `const` | Put the literal/local value inside the handler or pass validated data through `args`; top-level values are not spliced into executable bytes. | Many operations need a shared authored configuration graph. |
| Read trusted time | `Date.now()` or `new Date()` | Call `ctx.runtime.now()` and store integer epoch milliseconds. | The operation needs unsupported timers or ambient APIs. |
| Return several written documents | mutation `returns: v.array(v.doc('todos'))` | Return one document, or a closed array of receipt records/ids. | The exact document-array carrier is part of the public contract. |
| Allocate a dense number | `ctx.sequence.allocate(...)` in a Familiar mutation | Use the Explicit profile's declared `sequences` mutation surface. Do not replace it with an app read/increment/write counter. | Dense scoped sequence allocation is required. |

The complete source/runtime refusal matrix remains in
[Handler runtime profile and generation preflight](./handler-runtime.md).
In particular, a same-file helper is a function declaration, not a captured
arrow assigned to a top-level constant.

### Escape to shared declarations, not a second runtime

The profile still generates the canonical `api`, `groups`, asset, and
ephemeral references used by the ordinary clients. Shared schema declarations
may use the lower-level public schema vocabulary when the Familiar convenience
entrypoint does not re-export a constructor. For a membership-backed ephemeral
collection, import `defineEphemeral` and `ephemeral` from
`@expo/snapback-codegen/define`, while keeping Familiar functions on
`query`/`mutation` from `./generated/server`. The declaration still lowers into
the same canonical generated `api.ephemeral` reference; it does not create a
second backend or authorize mixing Explicit function builders into the
Familiar module tree.

## Declare non-derived asset intents

A bare `v.assetRef()` still derives the small private JPEG/PNG default. When
the application needs another media type or policy, export the canonical
`defineAssetUpload` constructor from a top-level Familiar module. The module
and export become the same two-segment generated namespace as functions.
Omitting delivery on that explicit constructor uses the `public-immutable`
performance default and emits an advisory; use `private-signed` for authorized
per-user issuance when a renderer cannot attach bearers, or `private-strict`
for bearer-only next-request revocation. The owner-only example below keeps
its private tier explicitly:

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

Start with declarative table visibility. In generated Familiar TypeScript,
bind child visibility through an authored resource key. The system `_id` is
not an authored field in the table's generated field union, so admit the root
resource through the authority profile/handler declaration rather than copying
an untypeable `resourceField: "_id"` binding:

```ts source=packages/snapback-codegen/rbac-authoring.test.mjs
export default defineSchema({
  rooms: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  roomMembers,
  messages: defineTable({ roomId: v.id('rooms'), body: v.string() })
    .visibility({ kind: 'membership', declaration: 'roomAccess', resourceField: 'roomId', roles: ['member'] }),
}, { auth: { mode: 'sessions' } });
```

Ordinary `ctx.db` reads enforce those policies, including inside familiar
queries and mutations. Prefer that fail-closed path whenever the governed row
directly names the membership resource; it makes an omitted handler check hide
the row instead of widening access. For a product-visible roster alongside the
private authority rows, follow the
[private membership and product roster recipe](../recipes/membership-roster-projection.md).

<!-- since: 0.1.23 -->

For a handler that already receives the typed resource id, Familiar accepts
the same authority-profile declaration as Explicit:

```ts fragment reason="Familiar authority-profile admission uses the canonical membership predicate"
export const messages = query({
  args: { conversationId: v.id('conversations') },
  returns: v.array(v.doc('messages')),
  auth: 'authenticated',
  reads: ['messages'],
  membership: [conversationMembers.hasRole(
    membershipResource.arg('conversationId'),
    'member',
  )],
  handler: async (ctx, args) => ctx.db.query('messages')
    .withIndex('byConversation').eq('conversationId', args.conversationId)
    .take(50).collect(),
});
```

Codegen places the captured role check before the handler, blanks a denied
row-set read, and terminally denies a mutation. Read admission requires a
row-set result contract that accepts `[]`; scalar/document results and
nonempty bounded record results fail generation. It also generates the bounded
`api.<profile>.list` and caller-scoped `api.<profile>.myRole` references. The
authored handler contains no repeated permission guard.

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
id. Direct-resource handlers should use the authority-profile declaration
above; repetition remains intentional only where the relation is still
multi-hop.

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

<!-- since: 0.1.23 -->

## Persist native session custody with SecureStore

Web uses `createIndexedDbAuthCustodyStorage()`. React Native now has a
first-party, dependency-injected SecureStore adapter, so do not silently fall
back to `createMemoryAuthCustodyStorage()` for a user session that must survive
a process restart. Install the SDK-compatible `expo-secure-store` in the app;
`@expo/snapback-contract` itself stays dependency-free.

```js fragment reason="application package imports; the contract package test injects a SecureStore double instead of depending on Expo"
import * as SecureStore from 'expo-secure-store';
import { AuthCoordinator } from '@expo/snapback-contract/auth-coordinator';
import { createSecureStoreAuthCustodyStorage } from '@expo/snapback-contract/auth-custody-secure-store';
```

Construct the adapter once and pass it as `storage` with native wakeup seams
disabled:

```js source=packages/snapback-contract/auth-custody-secure-store.test.mjs
  const authStorage = createSecureStoreAuthCustodyStorage(SecureStore);
  const authCoordinator = new AuthCoordinator({
    appId,
    storage: authStorage,
    broadcastChannelFactory: null,
    hintStorage: null,
  });
```

The adapter uses `snapback.auth-custody.${authAppIdHash(appId)}` internally,
serializes ownership per app key, validates every read and write, and preserves
the coordinator's revision-CAS and authority-epoch invariants. On web keep the
IndexedDB adapter. Acceptance must terminate and relaunch the native process,
then prove `synchronize()` restores the settled session without a new
email-code exchange.

This string carrier is ordinary bearer custody only. A sender-constrained
record refuses with `SNAPBACK_AUTH_CUSTODY_STORAGE_FAILED`; the Secure
Enclave/Keystore proof transport remains outside the shipped native target.

## One Expo Router journey

Here is the shortest coherent application loop, rather than six disconnected
reference exercises:

1. Scaffold the published Expo app, install `expo-router` and SDK-compatible
   `expo-secure-store`, copy the conventional `snapback/` backend when adding
   Snapback to an existing project, select the familiar policy above, and use
   the fenced first-party custody adapter above when working from source.
2. Author `schema.ts` plus top-level function modules. Put
   `SnapbackExpoProvider`/`SnapbackProvider` and the one long-lived client in
   `app/_layout.tsx`; construct the native `AuthCoordinator` with the
   SecureStore adapter there. Route files import generated `api.module.export`
   references and use memoized argument objects.
3. Gate each protected query/mutation with active membership or admin checks.
   Keep this server-side even if Expo Router already hid the screen.
4. For a simple private JPEG/PNG field in 0.1.23, a bare `v.assetRef()` derives
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
