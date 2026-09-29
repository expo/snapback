# snapback4

A scale-to-zero backend: Quarry declares your data and rules; typed clients read online or on a device, using the same
Rust interpreter as the server. The package carries the TypeScript client and the CLI (currently darwin-arm64).

## Start here: your first working account screen

Follow this `README.md` through password signup, profile, avatar and reopen. Coming from SQL or Convex: `npx snapback4 guide from-sql` (aliases: `sql`, `convex`, `rosetta`). For messaging apps: `npx snapback4 new my-social --template social` installs the Expo Router starter; `guide social` explains typing, once-media and revalidation.

### 1. Create and run the backend

Use Node 24. In a new app directory, install the exact package and Expo starter:

```sh
npm install --save-exact snapback4
npx snapback4 init --expo
npm install
```

Use `init --web` for the offline Vite starter, `init` for a schema, or `init --online` for an online-only app. The
example below uses the Expo starter's installed React Native and SecureStore. Replace `snapback/schema.q`,
`src/client.ts` and `App.tsx` with the blocks below, and remove the unused `src/Inbox.tsx`, `src/Thread.tsx` and
`src/witness.ts` chat screens. Remove the chat's optional `snapback/worker.mts`. Then run `npx snapback4 check` to
generate the API; keep `npx snapback4 dev` running in one terminal and `npm start` in another (Expo Go), or use `npm run
ios:dev` for a native development build. Do not set a persona for this password example. The iOS simulator reaches
`http://127.0.0.1:4400`; set `EXPO_PUBLIC_SNAPBACK_URL` to your TLS deployment for a physical phone.

### 2. Declare identity and a profile

An email-and-password product declares `use identity password`; plain `use identity` also mints guest sessions. Password
signup requires at least 8 characters (Unicode scalar values) and at most 1,024 UTF-8 bytes; login accepts at most 1,024
UTF-8 bytes. Sessions normally last seven days. Handles are discoverable; profiles and avatars are private to their
owner. `profileFor` explicitly refuses another owner; table rules otherwise hide unreadable rows as missing. Handle
claims are server-authoritative.

```quarry
use identity password
table profiles:
  principal: principal
  handle: text 3..20 format handle
  avatar: image <=10000000 ?
  unique principal
  unique handle
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  immutable principal
  cap 1 by principal
  sync to .principal
table handles:
  principal: principal
  handle: text 3..20 format handle
  unique principal
  unique handle
  public 'handles are discoverable after signup'
  insert <- .principal = viewer
  update <- .principal = viewer
  immutable principal
  online only
query handleAvailable(handle: text 3..20 format handle):
  return not exists handles[handle = handle]
query myProfile():
  return profiles[principal = viewer]
query profileFor(owner: principal):
  require owner = viewer else PROFILE_PRIVATE
  return profiles[principal = owner]
mutation saveProfile(handle: text 3..20 format handle):
  upsert handles[principal = viewer] { principal: viewer, handle }
  upsert profiles[principal = viewer] { principal: viewer, handle }
mutation placeAvatar(avatar: image <=10000000):
  update profiles[principal = viewer] { avatar }
```

A post-signup availability check uses the new session. The unique handle index still decides races: keep the session
after a failed save and choose another handle. An incomplete or stale availability answer is not permission to claim it.
Availability and handle saves use the server; your private profile is held locally.

### 3. Create the app

Replace `src/client.ts`. The app restores the session, opens the right client, and owns pending writes across restarts.
Native sessions use SecureStore; browser persistence is explicit because page scripts can read localStorage. Expo Go
uses the online client. Keep the starter's Metro config and wasm transformer.
`assets` retains viewed media within its byte budget when a device is available; Expo Go's online tier ignores it.

Prove the native runtime: `npx snapback4 witness ios --smoke --bundle-id ID --udid "$UDID" --artifacts artifacts/native-smoke` (no app code).
Build/install Release first; `npx snapback4 guide witness` explains the three receipts and the deeper application runner.

```ts
// src/client.ts
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { webDevice } from "snapback4/web";
const sessionStore = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  delete: (key: string) => SecureStore.deleteItemAsync(key),
};
export const app = createApp({
  url: process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400",
  sessionStore: Platform.OS === "web" ? localStorageSessionStore() : sessionStore,
  device: Platform.OS === "web" ? webDevice() : nativeAvailable() ? nativeDevice : undefined,
  assets: { keep: "viewed", maxBytes: 67108864 },
});
```

### 4. Sign in, save and render

Replace `App.tsx`. A refused sign-in returns `{ ok: false, why }`. A missing profile resumes onboarding; a denied read
remains an error. Enter an image URI accessible to the host (on web its server must allow CORS), or pass a photo
picker's Blob to `upload`. Uploads require a connection; placement is a mutation.

```tsx
// App.tsx
import { useState } from "react";
import { Button, Image, Text, TextInput, View } from "react-native";
import { AppProvider, useAuth, useClient, useQuery, useMutation, useAsset } from "snapback4/react";
import { app } from "./src/client";
import { api } from "./snapback/generated/api";
export function App() { return <AppProvider app={app}><Account /></AppProvider>; }
function Account() {
  const auth = useAuth();
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  if (auth.state === "restoring") return <Text>Restoring account…</Text>;
  if (auth.state === "signed-in") return <Profile />;
  const signIn = async (mode: "signup" | "login") => {
    const result = await (mode === "signup" ? auth.signup(email, password) : auth.login(email, password));
    if (!result.ok) setProblem(result.why.message);
  };
  return <View style={{ padding: 32, gap: 12 }}>
    <Text>{problem || auth.why?.message || "Sign up or log in"}</Text>
    <TextInput placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
    <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
    <Button title="Sign up" onPress={() => void signIn("signup")} />
    <Button title="Log in" onPress={() => void signIn("login")} />
  </View>;
}
function Profile() {
  const auth = useAuth(), client = useClient();
  const profile = useQuery(api.myProfile, {}), save = useMutation(api.saveProfile), place = useMutation(api.placeAvatar);
  const avatar = useAsset("data" in profile ? profile.data?.avatar?.id : null);
  const [handle, setHandle] = useState(""), [uri, setUri] = useState(""), [problem, setProblem] = useState("");
  const busy = save.inFlight || place.inFlight;
  const upload = async () => {
    try {
      const result = await client.upload(await (await fetch(uri)).blob());
      if (!result.ok) { setProblem(result.why.message); return; }
      await place.run({ avatar: { id: result.asset.id } });
    } catch (error) { setProblem(String(error)); }
  };
  return <View style={{ padding: 32, gap: 12 }}>
    <Text>{"denied" in profile ? profile.denied.message : "loading" in profile ? "Loading…" : profile.data ? `@${profile.data.handle}; avatar ${profile.data.avatar?.id ?? "not placed"}` : "Choose your handle"}</Text>
    {avatar.status === "ready" && <Image source={{ uri: avatar.url }} style={{ width: 96, height: 96 }} />}
    <Text>{problem || (save.last?.state === "failed" ? save.last.why.message : save.last?.state === "pending" ? "queued" : save.last?.state)}</Text>
    <Text>{place.last?.state === "failed" ? place.last.why.message : place.last?.state}</Text>
    <TextInput placeholder="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" />
    <Button title="Save profile" disabled={busy} onPress={() => void save.run({ handle })} />
    <TextInput placeholder="Avatar image URI" value={uri} onChangeText={setUri} />
    <Button title="Place avatar" disabled={busy || !("data" in profile && profile.data)} onPress={() => void upload()} />
    <Button title="Sign out" onPress={() => void auth.logout()} />
  </View>;
}
```

The unique handle constraint decides races. A failed save keeps the session so you can choose another handle. Existing
hooks work under `AppProvider`; online mutations persist their IDs and arguments before dispatch, and local devices own
their durable outbox. Pending writes stay with their original account. A terminal `sent` receipt confirms execution;
`failed` carries the refusal.

Explicit write IDs must use the accepted form (26 Crockford base32 characters, starting with `0`–`7`). Normally omit `id`; the client mints it. To keep one intent across retries, call `mintId()` once and keep that ID with its unchanged
arguments. For a fixture or seed label, `idFrom(label)` gives the same valid ID every time (it sorts before minted IDs):

```ts
import { mintId, idFrom } from "snapback4/client";
const intent = { id: mintId(), args: { handle: "alice" } };
await client.mutate(api.saveProfile, intent.args, { id: intent.id }); // a fixture: { id: idFrom("seed:alice") }
```

A fresh ID on every retry does not identify that same intent. For a local send that queues without
predicting a message, render its arguments from `await client.pendingWrites()` until it settles.

### 5. Export an offline shell, then verify

`npm run build:web` in the Expo starter runs `expo export -p web` followed by `snapback4 web-shell dist`. The Vite
starter's `npm run build` ends with the same command. For an existing export, run `npx snapback4 web-shell dist --base
/` and serve that directory over HTTPS (localhost also works). Every exported file is public shell content; keep
exports nonpersonalized. The worker never caches API responses or assets from the backend. A replacement waits for old
tabs to close.

Sign up, save a profile and view its avatar, reload, then open the acquired profile with the network off for a cold-offline start. Reconnect to settle pending writes. Browser eviction can remove offline availability; `client.acquired`
states whether the replica is ready. Defer feeds, search, schedules and server handlers until those features are
needed.

### 6. Add a thread without losing its history

Keep the conversation and its messages with `retain delivered-history`. Pin the screen by conversation ID; the inbox
depends on membership and drops that row when its member row is deleted. The bare history is an ordinary query with no
membership `require`: table rules still protect every server read. The local client asks the server before acquisition
or beyond coverage, and keeps a left group's retained rows local, offline and online, through remount and reopen. An
online-only client cannot recover those retained rows.

```quarry
table conversations:
  title: text <=120
  creator: principal
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  after insert <- exists members[conversation = .id, principal = .creator]
  retain delivered-history
  sync to members[.id]
table members:
  conversation: conversations
  principal: principal
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  delete <- .principal = viewer
  sync to members[.conversation]
table messages:
  conversation: conversations
  sender: principal
  text: text <=2000
  at: time
  search text
  immutable conversation, sender, at
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  retain delivered-history
  sync to members[.conversation] last 500 by .at
query conversationScreen(conversation: conversations):
  return conversations[conversation]
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .conversation after c { conversation, chat: conversations[.conversation] }
query history(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 20 by .at after c
query search(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c
```

Render receipts, profiles, quotes and reactions separately so loading or refusal preserves history. Run `npx snapback4 guide receipts` for the complete model,
SDK delivery reporting and screen-owned visible `seen` reporting. Ordinary search combines current server hits
with retained device hits online; `usePage` accumulates by ID. Show “Partial results” only for `complete: false`.
This windowed search emits `N_SYNC_ORDER` for device coverage and `N_NEVER_COMPLETE` for empty-needle browsing (`guide search`).

`cap 50 by conversation` is this product's maximum group size, enforced on writes. Choose caps only for actual product
limits: the engine chooses its own execution bounds, and `sync last 500` bounds acquisition, not how many messages may
exist.

When adding Following, `view following` owns that name. Name its reader `query home`, as `npx snapback4 guide feeds` shows; a query also named `following` collides with the view.

## The whole model

Edit `snapback/*.q`. `check` and `dev` generate `snapback/generated/api.ts`; never commit it. A table holds data. Rules
authorize each row. Sync chooses what devices hold. A query states a predicate and order. A view derives data. A
mutation commits atomically. A job sweeps; an effect records external work. An asset follows its row's read rule.
`check` gives summaries; `check --verbose` adds rewrites and explanations. `check --cost` gives certificates: **constant**
(bounded work at any data size), **constant once background cleanup catches up**, or **grows with** a named
site. A constant verdict proves a degradation rule; timing one measures noise. Cite the verdicts in scale reports.

`complete` means the query answered its declared request within known coverage and execution limits. A full `first N` or `last N` is complete without a cursor. Indexes and job chunk sizes are chosen by the engine.
Streaming aggregates count a domain under the meter; maintained views read stored totals. A cut total is unavailable.
Jobs run as the system: select the recipient's authorized data before emitting. `once` prevents repeated emission;
the worker still deduplicates provider delivery. See `guide maintains`, `guide jobs` and `guide effects` for recipes.

Import `usePage`, `useMutation` and `useAsset` from `snapback4/react`; use them with the generated `api` handles. `usePage` keeps loaded pages while the next loads; it supplies accumulated
items, `hasMore`, `loadMore` and read completeness. For generated queries returning source rows, it keeps one newest observed image per row ID; projections keep list semantics even when they contain a field named `id`. Both read hooks keep the same-key answer marked `revalidating` through refetch, reconnect, slow reads, offline transport and retry exhaustion, with no timeout. Local commits replace it directly after the replica re-read. All change evidence—local commits, acknowledged online mutations, durable and ephemeral `/changes`, and `/sync` publications—starts a one-second bound and withdraws on failure or timeout. Successful immediate replica replacements never show `loading`. An older replica read cannot clear a pending notification; sync must apply its cut or a current server answer must replace the display. Offline ephemeral answers keep their original row expiry. Membership removal replaces the answer with the denial or empty result. `keep: false` withdraws immediately; `keep: true` adds a 30-second linger after the last subscriber. Key changes, deadlines, sign-out, credential, store and schema resets still withdraw. A reported program-generation change withdraws immediately, even with no changed tables; the old replica stays unavailable until adoption completes. Offline retention uses `fresh: false` and `since`; no profile identity latch is needed. `useMutation` tracks writes; `useAsset` resolves
a placed asset. Upload bytes with `client.upload` before passing the asset id to its placement mutation. Operations in `schema.q` are
`api.name`; module files use `api.module.name`. Effects run in the optional Node ESM `snapback/worker.mts`.

Public feeds share an activity union. Following delivers it to each reader; Trending ranks a finite time window.
See `npx snapback4 guide feeds` for the complete tested program.

## Reference map: open only what the feature needs

`snapback4 guide <card>` and `snapback4 why <code>` answer in the terminal. Bare `guide` prints a two-line index of
cards and aliases; `guide language` prints the language card. Every refusal names a code, site and rewrite.
Every Quarry example compiles in the suite; the language card also runs. The chat example is optional.
| Need | One reference lookup |
|---|---|
| Quarry grammar | `guide language` |
| Complete chat example / offline web starter | `guide app` / [Vite starter](./CLIENT-AND-OPERATIONS.md#offline-web-starter) |
| Fields / indexes / rules / aggregates | `guide types` / `guide indexes` / `guide rules` / `guide maintains` |
| Reads / shapes / writes / helpers / chat receipts | `guide reads` / `guide shapes` / `guide writes` / `guide programs` / `guide receipts` |
| Device contents / prediction / acquisition costs | `guide sync` / `guide prediction` / `guide residency` |
| Following: `view following` / Global: planned view / Trending: predicate read / search | `guide feeds` / `guide search` |
| Identity / media / expiry / seeds / clock | `guide personas` / `guide assets` / `guide expire` / `guide replay` / `guide clock` |
| Typing / scoped presence | `guide ephemeral` / [Ephemeral writes](./CLIENT-AND-OPERATIONS.md#ephemeral-writes) |
| Background or network work (no directive) | `guide jobs` / `guide effects` (effect handlers) / `guide presence` / `guide native` / `guide services` (`mintSession`, `revokeSessions`) |
| Limits / failures / adoption / simulator proof | `guide bounds` / `guide refusals` / `guide evolution` / `guide witness`; `why <code>` |
| Client patterns / auth / React list | `guide client` / [Client §4](./CLIENT-AND-OPERATIONS.md#4-the-client) / [React list](./CLIENT-AND-OPERATIONS.md#react) |
| Development and wire | [§5](./CLIENT-AND-OPERATIONS.md#5-development) |
| Release | [§6](./CLIENT-AND-OPERATIONS.md#6-release) |
| Expo | [§7](./CLIENT-AND-OPERATIONS.md#7-expo) |
| Exclusions | [§8](./CLIENT-AND-OPERATIONS.md#8-not-in-this-release) |
| Actions, routes and action-bound identity (`use server`) | `guide actions` / `guide routes` / [SERVER.md](./SERVER.md) (OIDC bound-session recovery is protocol-double-only; repaired-engine qualification is pending) |
