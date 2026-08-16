---
title: "Recipe: coming from Convex and Supabase"
id: recipes.coming-from-convex-and-supabase
order: 7
audience: agent-first
capabilities: [backend.functions, auth.scoped-queries, clients.react, backend.assets, backend.relational-queries, realtime.ephemeral]
authorities: [llp/0186-agent-authoring-efficiency-program.plan.md, llp/0257-activity-scoped-presence-convenience.rfc.md, demos/card-game/snapback/functions.mjs, demos/card-game/tests/acceptance/authority-scope.mjs, demos/expo-golden-path-fixture/snapback/schema.mjs, demos/expo-golden-path-fixture/snapback/functions.mjs, demos/expo-golden-path-fixture/src/screens/chat-screen.tsx, demos/competitive-checkpoint/snapback/functions.mjs, demos/messaging-snapback/src/lib/useTyping.ts, demos/cursors-web/snapback/schema.mjs, packages/snapback-react/exact-result-types.fixture.ts]
examples: [demos/card-game, demos/expo-golden-path-fixture, demos/competitive-checkpoint, demos/messaging-snapback, demos/cursors-web, demos/partiful-matrix]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:ce7e2b314843aeeb1d854b89474a0d27a688e2849f63a74aaabb340bba401cce
---

# Recipe: coming from Convex and Supabase

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

This page is for an agent that already knows Convex or Supabase and is
looking for the Snapback shape of a task it already knows how to do
there — so it can start from a real, CI-verified translation instead of
composing one from prose. Each journey below is a complete, minimal-but-real
slice, not a symbol-substitution table.

**Non-goals.** This is not a feature-parity claim and not a marketing
comparison. Where Snapback has no equivalent for a Convex/Supabase
primitive that the [capability index](../capabilities.md) already tracks
as a GAP, this page says so plainly instead of forcing a translation.
Two examples that come up often: generic multi-way joins beyond the
bounded two-source shapes in
[relational queries](../backend/relational-queries.md), and ANN/approximate
vector search — [vector search](../backend/vector-search.md) ships exact
k-NN only, and calls out ANN as a nonclaim. Every claim on this page is
local-target-only, like every other Snapback destination it names; it does
not imply hosted parity.

## Quick map

Routes that need no code at all — go straight there:

| Convex / Supabase | Snapback |
| --- | --- |
| Convex dashboard / Supabase Studio | The [admin console](../operating/admin-console.md), opened with `snapback admin --ready-file .snapback/dev.ready.json` (the command `snapback dev --expo` prints as `adminConsoleCommand`) |
| `convex dev` / Supabase local dev | The generate → dev → verify [authoring loop](../getting-started/the-authoring-loop.md) |
| Schema and indexes | [`defineSchema`](../getting-started/your-first-backend.md) |
| Seed functions / SQL seed scripts | [Versioned seed and reset](../backend/versioned-seeds.md) |
| Offline cache | [Retained-query and outbox guarantees](../sync/offline-and-retention.md) |
| A complete app running on Convex, Supabase, and Snapback at once | `demos/partiful-matrix` — see [reactive queries](#reactive-queries) below |

## Deep worked journeys

<a id="protected-live-crud"></a>
### Protected live CRUD, end to end

**Find this page by:** "Convex useQuery", "Supabase RLS", "row level
security", "row-level security", "per-user query", "scoped query",
"hidden data", "row security".

**Use this when** you have a table of per-user rows and need a query that
returns only the signed-in caller's own rows — live, and rejecting any
attempt to pass the owner as an argument.

In Convex, a query function calls `ctx.auth.getUserIdentity()` and filters
by it; the paired React hook is automatically reactive:

```ts fragment reason="illustrative Convex snippet, not CI-run"
// convex/hands.ts
export const myHand = query({
  args: { gameId: v.string() },
  handler: async (ctx, { gameId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return await ctx.db
      .query("hands")
      .withIndex("by_owner_game", (q) =>
        q.eq("ownerId", identity.subject).eq("gameId", gameId),
      )
      .collect();
  },
});

// App.tsx
const hand = useQuery(api.hands.myHand, { gameId });
```

In Supabase, the scoping lives in a Postgres Row Level Security policy on
the table, evaluated against the caller's JWT, and the client just selects:

```sql fragment reason="illustrative Supabase policy, not CI-run"
-- once, on the `hands` table
create policy "own_hand" on hands
  for select using (auth.uid() = owner_id);
```

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
const { data: hand } = await supabase
  .from("hands")
  .select("*")
  .eq("game_id", gameId);
```

Snapback's version is a `defineLiveQuery` whose filter is the security
boundary — no owner argument, no RLS policy, no client-side trust:

```js source=demos/card-game/snapback/functions.mjs
  filter: [
    eq('ownerId', authUserId()),
    eq('gameId', arg('gameId')),
  ],
```

The acceptance suite proves it with two real, signed-in principals hitting
the same query and getting disjoint results:

```js source=demos/card-game/tests/acceptance/authority-scope.mjs
  const [adaResult, graceResult] = await Promise.all([
    ada.client.query('myHand', { args: { gameId } }),
    grace.client.query('myHand', { args: { gameId } }),
  ]);
  assert.deepEqual(adaResult.rows.map(({ card }) => card), ['ace-spades', 'queen-hearts']);
  assert.deepEqual(graceResult.rows.map(({ card }) => card), ['king-clubs', 'ten-diamonds']);
```

**Structural difference — get this exactly right.** The `eq('ownerId',
authUserId())` predicate above is the entire security boundary, in the
same sense the RLS policy is for Supabase. `authScopeField` (used on the
live-query definition) is a *different* thing: it tells the live matcher
which result field represents the principal, so it can reason about
disjoint subscriptions when rows move in or out of the result set live.
It does not inject a filter and does not scope anything by itself. See
[sessions and principals — "Queries are scoped by the server, not by
arguments"](../auth/sessions-and-principals.md#queries-are-scoped-by-the-server-not-by-arguments)
for the full statement.

The other structural difference: Convex's `useQuery` is automatically
reactive client-side — subscribe and render is one call. Snapback
separates the two: the backend declares a live query
(`defineLiveQuery`), and the client subscribes to it with
[`useSnapbackQuery`](../clients/react.md) — a real seam split, not a
rename, because it lets a non-React client (headless, Swift, another
JS runtime) subscribe to the identical live query with no React in the
picture.

**Not equivalent when** you need a client-supplied identity for
service-to-service or admin tooling — use the
[admin-impersonated CLI lane](../operating/host-ops.md#respect-admin-secret-read-and-impersonation-gates)
or an explicit [agent principal](../auth/agent-principals.md), not a query
argument; passing identity through the request body is rejected outright.

**Verify it yourself:** `demos/card-game/tests/acceptance/authority-scope.mjs`
(runs in the local proof) — it asserts the disjoint result sets above and
that logout blanks only the logged-out principal's live boundary.

**Read next:** [sessions and principals](../auth/sessions-and-principals.md),
[queries](../backend/queries.md), [React client](../clients/react.md).

<a id="expo-media-upload"></a>
### Upload and attach an Expo image under session custody

**Find this page by:** "Supabase Storage", "Convex generateUploadUrl",
"file upload", "image upload", "object storage", "Expo ImagePicker upload".

**Use this when** an app needs to let a signed-in user pick a photo and
attach it to a row, with the server — not the client — owning
finalization, GPS/EXIF stripping, and delivery authorization.

Convex mints a short-lived signed upload URL from a mutation-callable
action; the client POSTs raw bytes to it, gets back a storage ID, then a
second mutation writes that ID onto a document field:

```ts fragment reason="illustrative Convex snippet, not CI-run"
// convex/files.ts
export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

// client
const postUrl = await generateUploadUrl();
const result = await fetch(postUrl, {
  method: "POST",
  headers: { "Content-Type": file.type },
  body: file,
});
const { storageId } = await result.json();
await saveAvatar({ avatar: storageId }); // a second mutation
```

Supabase uploads a file straight to a bucket from the client (authorized
by Storage RLS policies on `storage.objects`), then stores the returned
path as a plain string column:

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
const { data, error } = await supabase.storage
  .from("avatars")
  .upload(`${userId}/${file.name}`, file);

await supabase
  .from("profiles")
  .update({ avatar_path: data?.path })
  .eq("id", userId);
```

Snapback declares the upload as a typed intent and the attaching field as
a typed `v.assetRef()`, not a bare string. The whole slice below is one
demo (`demos/expo-golden-path-fixture`): the schema field, the upload
intent it names, and the client flow. First the attaching field:

```js source=demos/expo-golden-path-fixture/snapback/schema.mjs
    messages: defineTable({
      conversationId: v.id('conversations'),
      senderId: v.id('users'),
      kind: v.string(),
      text: v.optional(v.string()),
      image: v.optional(v.assetRef({ upload: 'messageImageUpload' })),
      replyToId: v.optional(v.id('messages')),
      sentAt: v.integer(),
    })
      .index('by_conversation_sent', ['conversationId', 'sentAt'])
      // @ref LLP 0044#asset-read-authorization — this test-persona fixture is
      // intentionally public-read; production chat derives byte authority
      // from admitted conversation membership.
      .assetSharing({ kind: 'public-read' })
      .sync(),
```

Then the upload intent that field names — note the declared media-type
allowlist, the size ceiling, and the image pipeline's explicit
`location: 'strip'`. Public immutable delivery is the recommended performance
default for this deliberately public-read fixture, and remains explicit so
the policy is reviewable:

```js source=demos/expo-golden-path-fixture/snapback/functions.mjs
export const messageImageUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  accept: { mediaTypes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 12_000_000 },
  delivery: { kind: 'public-immutable' },
  access: { read: 'via-references' },
  image: {
    location: 'strip',
    variants: [{ key: 'chat', width: 1440, required: true }],
  },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
```

(This fixture deliberately shares bytes `public-read` because its chat
personas are test users; the owner-scoped equivalent of a Supabase
Storage RLS policy is `.assetSharing({ kind: 'owner', field: ... })` —
see [assets](../backend/assets.md) for the sharing kinds.)

On the client, application code hands the picker's own asset straight to
a generated command — no manual `fetch`, no raw upload, no asset id
threaded by hand:

```tsx source=demos/expo-golden-path-fixture/src/screens/chat-screen.tsx
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.86 });
    if (result.canceled || !result.assets[0]) {
      emitG3('picker-cancelled');
      return;
    }
    const picked = result.assets[0];
    emitG3('picker-image-selected', {
      source: 'photo-library-picker',
      uriScheme: picked.uri.slice(0, picked.uri.indexOf(':')).toLowerCase(),
      fileName: picked.fileName ?? null,
      mimeType: picked.mimeType ?? null,
      fileSize: picked.fileSize ?? null,
    });
    try {
      const body = proofEnabled ? G3_IMAGE_BODY : draft.trim() || undefined;
      const outcome = await observeCommand(
        conversation.commands.send({ ...(body ? { body } : {}), image: picked }),
        'picked-image',
      );
```

**Structural differences worth naming.** Ownership is never anonymous,
even when the upload intent's `auth` is `'public'`: every upload attempt
records a non-optional owner principal from `authorize`, and a dev/test
server with no real client session cannot complete a multi-step upload
over the ordinary HTTP surface at all — see
[assets — "Upload and attach"](../backend/assets.md) for the exact
refusal (`SNAPBACK_ASSET_OWNER_CUSTODY_UNSATISFIABLE`) and the two paved
local-dev answers (impersonated CLI, or a real session). GPS/EXIF
stripping happens server-side, at trusted finalization, on the canonical
bytes — never client-side and never optional-by-omission. And the
attaching field is a typed `v.assetRef()` the storage layer verifies at
commit time, not a bare URL or path string a client could forge.

**Not equivalent when** you need byte-level backup or on-the-fly
transcoding — the [asset capability](../capabilities.md) is explicit that
those remain non-claims here; the pipeline strips location metadata and
produces declared renditions, it does not back up or transcode.

**Verify it yourself:** the golden-path fixture's acceptance run
exercises this exact slice end to end — schema
(`demos/expo-golden-path-fixture/snapback/schema.mjs`), upload intent
(`demos/expo-golden-path-fixture/snapback/functions.mjs`), and the G3
image-command flow in
`demos/expo-golden-path-fixture/src/screens/chat-screen.tsx`.
`packages/snapback-codegen/asset-upload-authoring.test.mjs` pins the
schema/intent authoring rules.

**Read next:** [assets](../backend/assets.md).

<a id="relational-queries"></a>
### Reading related data without hand-writing the wrong join

**Find this page by:** "Convex joins", "Supabase joins", "nested joins",
"joins", "relational queries", "denormalized reads", "materialized views",
"conversation membership", "message sender", "chat joins",
"defineRelationalQuery", "defineMaintainedProjection".

**Use this when** a read is "each row plus its one related row" — a
conversation joined to its model, a message joined to its sender — and you
want that join proven at authoring time instead of hand-rolled.

Convex has no join operator; joins are ordinary JS-side traversal, usually an
indexed lookup per related id:

```ts fragment reason="illustrative Convex snippet, not CI-run"
// convex/conversations.ts
export const listWithModel = query({
  handler: async (ctx) => {
    const conversations = await ctx.db.query("conversations").collect();
    return await Promise.all(
      conversations.map(async (conversation) => {
        const model = await ctx.db
          .query("models")
          .withIndex("by_slug", (q) => q.eq("slug", conversation.model))
          .unique();
        return { ...conversation, modelName: model?.displayName ?? null };
      }),
    );
  },
});
```

Supabase instead exposes the join declaratively, through PostgREST's
foreign-key-derived nested selection:

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
const { data } = await supabase
  .from("conversations")
  .select("slug, title, model:models(display_name, provider)");
```

These are not one source concept: Convex's shape is imperative traversal
code you write per query; Supabase's is a declarative selection modifier the
client library expands into SQL. Snapback picks a shape by asking whether the
join needs to be re-read on demand or kept durably up to date. For an
on-demand read, `defineRelationalQuery` is a closed, bounded two-source plan
— no SQL text, no callback, proven at generation time:

```js source=demos/competitive-checkpoint/snapback/functions.mjs
export const conversationsWithModel = defineRelationalQuery({
  root: schema.tables.conversations,
  joined: schema.tables.models,
  join: [{ root: 'model', joined: 'slug' }],
  // Left: a conversation whose model is not registered still returns, with
  // null model leaves; the owner evidence rides the root.
  kind: 'left',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: 'owner',
  },
  projection: {
    slug: { root: 'slug' },
    title: { root: 'title' },
    model: { root: 'model' },
    modelName: { joined: 'displayName' },
    modelProvider: { joined: 'provider' },
  },
  take: 8,
  rootIndex: 'by_owner_created',
  joinedIndex: 'models_by_slug',
});
```

When that same join should instead be a durable, always-current table —
because most reads are "give me the joined row" rather than "recompute the
join now" — the sibling declaration is `defineMaintainedProjection`, which
keeps an output table in sync inside every source mutation's own commit. The
same file declares one right next to this query
(`conversationCardsProjection`); see
[relational queries — "Maintained projections"](../backend/relational-queries.md#maintained-projections)
for that snippet and its fan-out/coupling rules. Pick `defineRelationalQuery`
for an occasional or parameterized read; pick `defineMaintainedProjection`
when the joined shape is what most callers read most of the time and paying
the write-time maintenance cost is worth the read-time win.

**The GAP, plainly.** Both shapes are bounded to exactly two sources and
refuse a self-join outright (the same table cannot be both `root` and
`joined`). Generic multi-way joins, self-joins (reply-preview, reaction
counts), grouping, and aggregation are not hidden relational options here —
they are missing capability. Reach for a hand-written `defineJsLiveQuery`
when a read needs any of those.

**Structural differences worth naming.** The joined side must be provably
unique — `joinedIndex` names a declared `unique` index over exactly the join
key, so cardinality is a codegen-checked fact, not a runtime hope. Visibility
is explicit and separately declared per source and for the output, and the
output can never be broader than a contributing source. A live subscription
on either shape delivers whole-result replacement on any commit that touches
either source — there is no incremental delta.

**Not equivalent when** the read needs more than two sources, a self-join, or
post-join grouping/aggregation — that is a named GAP, not a translation
target.

**Verify it yourself:**
`demos/competitive-checkpoint/tests/acceptance/relational-conversations.mjs`
and `demos/competitive-checkpoint/tests/acceptance/step5-both-helpers.mjs`
(both run in the local proof) exercise `conversationsWithModel` and
`conversationCardsProjection` against the same schema.

**Read next:** [relational queries](../backend/relational-queries.md).

<!-- since: 0.1.23 -->

<a id="ephemeral-presence"></a>
### Typing indicators and cursors: presence vs. broadcast

**Find this page by:** "Supabase Presence", "Supabase Broadcast", "presence",
"cursors", "typing indicator", "ephemeral", "useSnapbackPresence",
"useSnapbackActivityPresence".

**Use this when** you need to show who else is here (online/typing state) or
where their cursor is (high-frequency motion), and you're deciding whether
that's one primitive or two.

Supabase's own docs steer these toward two different primitives. Presence
tracks slower-changing per-client state and syncs a shared roster:

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
const channel = supabase.channel("room-1");
channel
  .on("presence", { event: "sync" }, () => {
    const state = channel.presenceState(); // { [key]: [{ typing: true }] }
  })
  .subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await channel.track({ typing: true, user: "ada" });
    }
  });
```

Broadcast is a fire-and-forget pub/sub message, recommended for high-frequency
state like cursors precisely because it does not maintain roster state:

```ts fragment reason="illustrative Supabase/js snippet, not CI-run"
channel.on("broadcast", { event: "cursor" }, ({ payload }) => {
  renderCursor(payload.userId, payload.x, payload.y);
});
channel.send({ type: "broadcast", event: "cursor", payload: { userId, x, y } });
```

Snapback uses one mechanism for both: a typed ephemeral collection. The base
projection is `useSnapbackPresence`; typing uses its activity-scoped
convenience. The typing/online case:

```tsx source=demos/messaging-snapback/src/lib/useTyping.ts
export function useTyping(conversationId: string, selfHandle: string, selfName: string) {
  const scope = useMemo(() => ({ conversationId }), [conversationId]);
  const presence = useSnapbackActivityPresence(typingRef, {
    scope,
    value: () => ({ userHandle: selfHandle, name: selfName }),
    idleMs: 3_000,
  });
  const typers = useMemo<Typer[]>(() => {
    return presence.peers
      .filter((entry) => entry.value.userHandle !== selfHandle)
      .map((entry) => entry.value);
  }, [presence, selfHandle]);

  return {
    typers,
    publishTyping: presence.touch,
    clearTyping: presence.withdraw,
  };
}
```

And the cursor case is the same ephemeral mechanism over a collection tuned
for high-frequency, small-payload publishes — the difference is entirely in
the collection's declared budget, not a different wire API:

```js source=demos/cursors-web/snapback/schema.mjs
    webCursors: ephemeral.collection({
      scope: { roomId: v.string() },
      routing: ['roomId'],
      key: 'connection',
      ttlMs: 5_000,
      maxTtlMs: 30_000,
      maxValueBytes: 1_024,
      publishRate: { sustainedHz: 20, burst: 40 },
      delivery: { mode: 'latest', dispatchMs: 33 },
      value: v.object({
        x: v.number(),
        y: v.number(),
        name: v.string(),
        color: v.string(),
        updatedAt: v.optional(v.number()),
      }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
```

**Structural difference worth naming — this is the one that actually
matters, not a rename.** Supabase's two primitives differ in *expiry model*
as much as frequency: Presence state disappears when the client's realtime
connection drops, while Broadcast has no state at all to expire. Snapback's
one mechanism declares both behaviors explicitly: a connection-keyed entry is
reclaimed on disconnect (the removal normally arrives as a delta, much like a
Presence leave), and every entry additionally carries a required `ttlMs`
lease — there is no immortal entry — that bounds how long it can linger if
that remove delta is lost. TTL plus the declared publish budget
(`publishRate`, `delivery`) are the knobs that make one collection behave
"presence-like" (longer TTL, low publish rate — the `typing` collection
above) or "broadcast-like" (short TTL, high-frequency latest-state delivery —
`webCursors`), rather than needing two different wire protocols.

**Not equivalent when** you are relying on removal being
guaranteed-immediate: a remove delta can be lost, and until the `ttlMs`
lease expires peers may still see the stale entry — the lease, not the
disconnect, is the hard staleness bound. Naming this once is enough — see
[ephemeral realtime state](../realtime/ephemeral-state.md) for TTL bounds,
key modes, and the `needs_resync` recovery path, not a claim of
feature-for-feature Presence/Broadcast parity.

**Verify it yourself:** `demos/messaging-snapback/tests/acceptance/headless.mjs`
exercises the typing collection; `demos/cursors-web/tests/acceptance/react-browser.mjs`
and `demos/cursors-web/tests/acceptance/contract-browser.mjs` exercise the
high-frequency `webCursors` collection end to end (both run in the local
proof).

**Read next:** [ephemeral realtime state](../realtime/ephemeral-state.md).

<a id="reactive-queries"></a>
### Reactive queries: useQuery vs. declare-then-subscribe

**Find this page by:** "Convex useQuery", "useQuery", "reactive query",
"live query hook".

**Use this when** you already know Convex's `useQuery` and want the
Snapback shape of "subscribe to a query and re-render on change."

The auth-scoping half of this translation — why Snapback splits the backend
declaration from the client subscription, and what that split buys you — is
already covered in full in
[Protected live CRUD, end to end](#protected-live-crud); this journey does
not repeat it. What's here instead is the bare code shape, then a pointer to
a complete real app instead of another snippet.

Convex's idiomatic call is one line, auto-reactive:

```ts fragment reason="illustrative Convex snippet, not CI-run"
const data = useQuery(api.foo.bar, { arg: 1 });
```

Snapback's call site is the same one-hook shape — a generated operation
reference plus its exact arguments:

```ts source=packages/snapback-react/exact-result-types.fixture.ts
const query = useSnapbackQuery(todos, { owner: 'ada' });
```

Same one-hook-call shape at the call site; the difference is what backs it.
`api.foo.bar` is Convex's query-function reference resolved against a global
client, while `todos` is a generated reference into a backend-declared live
query, and reactivity comes from the mounted `SnapbackProvider` — the
provider owns canonical query identity, subscription lifecycle, and auth
custody, so the hook itself takes no client, provider, or identity
arguments. See [the React client](../clients/react.md) for the
prepare-binding/provider setup that precedes the first hook call.

**If a snippet isn't enough:** `demos/partiful-matrix` is a real,
CI-exercised app — events, RSVPs, and a message wall — built for LLP 0063's
comparative-fairness leg, running against Snapback, Convex, and Supabase
behind one shared provider interface. Its React surface's
`surfaces/react/src/provider.ts` and `surfaces/react/src/convex-direct.ts`
implement that interface for each backend natively (Convex over
`ConvexClient`'s own WebSocket, Snapback over `SnapbackClient.liveQuery`, no
comparison gateway in between), and
`tests/acceptance/convex-realtime-web.mjs` drives both a real Snapback and a
real Convex deployment through the identical rendered app, recording each
provider file's content hash as a `sourceInputs` entry. This is provider
implementation code, not a tutorial — its surfaces subscribe through the
harness's own provider seam (`@partitime/snapback-react`), not the canonical
`@expo/snapback-react` hooks above — so read it as "here is the whole seam,
for both backends, actually running," not as application code to copy.

**Read next:** [Protected live CRUD, end to end](#protected-live-crud),
[the React client](../clients/react.md).

## Anti-patterns

- **Do not treat this page as a symbol dictionary.** A renamed function is
  not the point; each journey above states where the shape actually
  differs and where it does not translate at all.
- **Do not skip the "not equivalent when" boundary.** Following a link
  from here into the authoritative feature page for more depth is
  succeeding, not failing.
