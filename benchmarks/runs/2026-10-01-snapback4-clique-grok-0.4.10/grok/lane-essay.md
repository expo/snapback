# Clique on Snapback 4.0.4.10 — comparison essay

This lane built Clique, a production-shaped social messenger, against **snapback4@0.4.10** and **snapback4-expo@0.4.10** only, with the backend entirely in Quarry (`snapback/*.q`) and the client an Expo Router app on the package’s replica and React arms. The comparison is to Convex, Supabase, earlier Snapback generations as remembered from public docs rather than from any checkout, and to a generic Postgres-plus-jobs stack.

## Where this backend reduced friction

The largest reduction is **one file for the product’s laws**. Identity, unique handles, public posts, follow edges, ordinals, delivery runs, disappearing TTLs, view-once photos, search indexes, digest schedule, and the push `emit` all live in `schema.q`. Convex gets close with schema-plus-functions in one repo, but uniqueness, sync windows, and receipt ordinals still leak into TypeScript. Supabase splits the same facts across SQL, RLS, Storage policies, and a cron or Edge Function. Here, `unique handle else HANDLE_TAKEN`, `expire at .expiresAt`, `image once`, and `reports delivery of messages by .conversation, .ordinal` are the product.

**Sync declarations replace a lot of client cache design.** `sync public last 1000 by .at with own keys .principal` on likes is the reason like/unlike choreography could pass: the viewer’s key is predicted, the public window carries everyone else’s recent likes, and `postState` can run on the device. That is not an equivalent of Convex queries (which are live but server-resident) or of Supabase realtime (which is a stream you still have to fold). Own-key coverage is the Snapback 4 idea that actually changed the shape of the work: you stop asking “did the server tell me?” and start asking “is this key in my partition?”

**Chat receipts are a schema, not a protocol you invent.** The published `guide receipts` is an unusually complete recipe: join floors, runs, SDK delivery reporter, screen-owned `seen`. Implementing M3 was mostly transcription plus a screen that reports `seen` when history is visible. Convex would be a table of max-read ordinals and a mutation; Supabase would be RLS plus a trigger. Snapback 4’s version includes retain-delivered-history after leave, which is the hard part of WhatsApp-like membership.

**Expiry and once-media are engine features.** Server-enforced disappearing messages with no client open, and `once` photos that `useAsset` will not fetch twice, removed whole classes of “please remember to delete” jobs. Convex scheduled functions can delete; they will not stop a replica from showing a row it still holds. Snapback 4’s `expire at` is the replica’s problem too.

**The React arm is small.** `useQuery` / `useMutation` / `useAsset` / `usePendingWrites` / `useViewer` is enough to write Clique. That is closer to Convex’s hook set than to Supabase’s split of PostgREST, auth, and storage. Generated `snapback/generated/api.ts` naming `runs: device|server` and `predicts: eligible|never` is documentation the compiler owes you; Convex infers reactivity, Snapback 4 prints the horizon.

## Where this backend added friction

**Prediction is a new failure mode.** `setFollow` with `online only` follows is `predicts: never`. Following then cannot live-update a device `home` query, even though the mutation succeeded. The feeds guide’s materialized `view following` is the “right” social pattern and still did not overlay unfollow in this 0.4.10 build until follows themselves carried own keys and `home` became a planned filter over `activity`. Convex would have re-run the server query. Supabase would have been an explicit refetch. Snapback 4 made me learn a third thing: whether the write can prove absence.

**Query horizons fight the brief’s offline search.** `search` and `people` compile as device queries whose sync order does not match the read index (`at` vs ordinal, `handle` vs `id`). The compiler says the client needs the server. Warm offline search over messages the replica already holds therefore needed a second query (`inboxSnippets`) and a client word-prefix. That is more work than `ilike` in Postgres, and more surprising than Convex’s “this query is always server.”

**`useQuery` can throw.** Passing `principal: "none"` (or a handle-shaped dummy) aborts the React tree. Convex returns `undefined`. The Snapback 4 contract is stricter and correct, and it still cost a choreography loop because an empty typing list used a sentinel instead of the viewer.

**Membership removal vs retain-delivered-history.** The client docs say membership removal replaces the query answer with denial or empty. The schema says `retain delivered-history`. Both are true; the screen must hold the last page. That is an extra client invariant Convex/Supabase would also need, but Snapback 4’s wording makes it look like the engine will keep the transcript on screen.

**Uploads are online-only.** A file picker plus immediate Send in Playwright races `client.upload`. There is no queued-bytes outbox for assets. Convex file storage is also online; the difference is Snapback 4 otherwise trains you to expect the replica to absorb the click.

**Expo Router is not the backend’s fault, and still dominated M5.** Nested `[group].tsx` versus `[group]/settings.tsx`, and a settings button that pushed a conversation UUID, were client routing. They ate more wall clock than Quarry.

## How the shape of the work changed

On Convex, the loop is: write a query, write a mutation, trust the subscription, occasionally add an action for anything non-transactional (push, email, the digest). On Supabase, the loop is: migrate SQL, write RLS, write a TypeScript caller, subscribe to a channel, remember Storage. On Snapback 4.0.4.10 the loop is: **declare the audience and the horizon, then see whether the generated `api.ts` says device or server, eligible or never.** The product work moves left into the schema. The remaining client work is almost entirely “make the frozen kit’s testIDs and semantic values true,” plus a handful of replica-lifetime issues (hold last history, await upload, freeze the DM id, don’t render Insights zeros while loading).

That is a different skill mix. Less SQL, less RLS debugging, less websocket glue. More compiler notes (`N_SYNC_ORDER`, `N_SPARSE_FILTER`, `insert if absent queues without a row`). The `npx snapback4 why <op>` surface is the right replacement for “read the planner,” and it is how follow prediction and home’s device run were actually diagnosed — not from prior Snapback source.

Versus earlier Snapback generations as advertised: 0.4.10’s own-key coverage, `reports delivery`, and `expire at` are the features this brief actually uses. The social template still ships `online only` follows next to a materialized Following view; that combination is the trap. Planned `home` over synced follows is the pattern that survived contact with two-client choreography.

I would use this backend again for a messenger or a local-first social client where receipts, expiry, and offline writes are the product. I would not use it yet for a search-heavy directory or an analytics warehouse: insights as a server loop is fine at Clique’s scale and still the place a SQL `count(*)` would have been less drama. The digest job in-schema is a joy. The Expo client is ordinary. The backend’s personality is the compiler telling you, in `api.ts`, whether you actually built a replica query or a round trip.
