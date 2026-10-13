# snapback4

A scale-to-zero backend: Quarry declares your data and rules; typed clients read online or on a device, using the same
Rust interpreter as the server. The package carries the TypeScript client and the CLI (prebuilt for macOS arm64 and Linux x64).

## Start here: a new app in five steps

Use Node 24. Coming from SQL or Convex: `npx snapback4 guide from-sql` (aliases: `sql`, `convex`, `rosetta`). Every Quarry example in this README and in `snapback4 guide` compiles in the suite; `npx snapback4 guide start` lists eight short patterns. **Backend first** (schema → check → test, then the client; a starter written after your schema fits it, so there is nothing to adapt):
```sh
npm install --save-exact snapback4 && npx snapback4 init   # writes only snapback/schema.q: edit it (guide cheatsheet)
npx snapback4 check                                        # until clean; notes carry rewrites; writes snapback/generated/api.ts
npx snapback4 test --fixture fixtures --as alice           # your fixtures/<table>.jsonl rows and fixtures/test.cases.jsonl
npx snapback4 init --web                                   # or --expo: sign-in (or persona picker) and a Home for your schema
```

1. **Install and scaffold.** In a new directory:
   ```sh
   npm install --save-exact snapback4
   npx snapback4 init --web      # or --expo; plain `init` writes only snapback/schema.q
   npm install
   ```
   Each starter is one screen over one table: a todo list with guest sign-in, a live query and three mutations. `init` never replaces a file (it only adds missing `package.json` entries) and never counts your `snapback/*.q` as a conflict; add `--skip-existing` to keep your other files and write only the missing ones. After you replace the starter's schema, `npx snapback4 check` names starter files that no longer fit it (the todo fixtures, a guest screen for a persona-only schema), and `npx snapback4 init --adapt` removes or rewrites them, never a file you changed (it keeps `fixtures/`, and replaces a Todos screen your schema no longer serves with a `Home` screen that compiles against any schema). The full reference chat app is `init --web --template chat` (or `--expo`); a messaging app is `npx snapback4 new my-social --template social` (`guide social`).
2. **Write the schema.** Edit `snapback/schema.q`: tables with rules and `sync`, then queries and mutations. Start from `npx snapback4 guide cheatsheet` (one screen), then `guide language`, `guide rules` and `guide sync`; `guide recipes` has compiled roles (admin/staff/member), two-party, booking-capacity and schedule apps, while `guide rule-recipes` covers composite roles and blind child writers; a card over 130 lines prints its opening and a numbered index, so read one part with `--section <number>` or everything with `--full`.
3. **Check and serve.** `npx snapback4 check` names each problem with a rewrite (`npx snapback4 why <code>` explains one) and writes the typed `snapback/generated/api.ts`. `npx snapback4 dev` serves http://127.0.0.1:4400 and re-adopts the schema on every save; run the app beside it with `npm run dev` (web) or `npm start` (Expo). Call an operation as a development persona: `npx snapback4 run add '{"title":"milk"}' --as alice`.
4. **Seed and test.** Rows live in `fixtures/<table>.jsonl` and expected outcomes in `fixtures/test.cases.jsonl` (the starters ship both); `npx snapback4 test --fixture fixtures --as alice` runs them with no server. `npx snapback4 guide testing` shows both formats and an acceptance script over HTTP.
5. **Choose the client.** One constructor per kind of program; React hooks (`useQuery`, `usePage`, `useMutation`, `useAuth`) come from `snapback4/react` (`guide client`). `usePage(api.list, args)` passes the cursor itself, so a paged query declares `c: cursor ?` and reads `after c` (`query list(c: cursor ?): return todos where .ownerId = viewer after c first 100 by .id`); `useQuery` reads a query without one and returns the `Read` itself (render it with `matchRead`). Name hook results in props by the operation (`UseQuery<typeof api.op>`, `UsePage<typeof api.list>`, `UseMutation<typeof api.add>`); below the sign-in gate `useSignedInViewer()` is the never-null viewer; `sentResult(await add.run(args))` is a write's fresh result (`undefined` while pending, after a failure, or for a replayed receipt; the refusal is `isFailed`'s). The starters' `App.tsx` uses each. A schema with `use personas` and no `use identity` has no sign-in: act as a persona with `createApp({ url, persona: "alice", device })` (`guide personas`).

   | You are writing | Use | Notes |
   |---|---|---|
   | A Node script, seed or test | `createClient({ url, persona: "alice" })` from `snapback4/client` | Personas are development-only; for real users call `signup`/`login` from `snapback4/auth` and pass `{ url, session }`. |
   | A browser app | `createApp({ url, sessionStore: localStorageSessionStore() })` when no table syncs; `createApp({ url, device: webDevice(), sessionStore: localStorageSessionStore() })` for synced tables; under `AppProvider` | **With no synced table, a browser app writes without a device** (including `createApp({ url, persona: "alice" })` on loopback dev): `createApp` journals each click synchronously in localStorage, sends it with its id, and the server runs it at most once (no offline reads, no predictions; `writes: "online"` chooses this with synced tables too). That page ships no wasm: 88,485 B gzip of JavaScript (274,853 B raw, measured writing page) against 2.5 MB (766 KB gzip) with `webDevice()`. Synced tables need the device: about 2.1 MB raw (679,418 B gzip) of wasm plus a ~24 KB worker, fetched when a session opens. A bare `createClient()` in a browser refuses every mutation with `E_ADMISSION`; a page that never writes needs neither. The `init --web` starter generates the client for your identity mode and synced tables. Missing journal APIs or incompatible write options refuse at construction; check `app.ready` for asynchronous schema/storage refusals. |
   | An Expo app | `createApp({ url, device: nativeAvailable() ? nativeDevice : undefined, sessionStore })` | The `init --expo` starter's `src/client.ts` selects `webDevice()` on web for synced tables, otherwise the browser write journal. Expo Go runs online. `npm install` reports about 15 high advisories in Expo's development toolchain (`braces`, `node-forge`; no patched release exists, neither ships in the app): do not run `npm audit fix --force`, which downgrades Expo to SDK 44. |

## Tutorial: your first working account screen

### 1. Create and run the backend

Follow this `README.md` through password signup, profile, avatar and reopen. Run step 1 above with `npx snapback4 init --expo`, then
`npm install`; the example uses the Expo starter's React Native and SecureStore. Replace `snapback/schema.q`, `src/client.ts`
and `App.tsx` with the blocks below. Run `npx snapback4 init --adapt` to remove untouched todo fixtures, then `npx snapback4 check`; keep `npx snapback4 dev` running in one
terminal and `npm start` in another (Expo Go), or `npm run ios:dev` for a native development build. Do not set a persona
for this password example. The iOS simulator reaches `http://127.0.0.1:4400`; set `EXPO_PUBLIC_SNAPBACK_URL` to your TLS
deployment for a physical phone. Keep the starter's `expo-env.d.ts`: it types `process.env`.

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

A post-signup availability check uses the new session. Incomplete or stale availability is not permission to claim a handle.
Availability and handle saves use the server; your private profile is held locally. The unique index decides races.

### 3. Create the app

Replace `src/client.ts`: the app restores the session, opens its client and owns pending writes across restarts.
Native sessions use SecureStore; browser persistence is explicit because page scripts can read localStorage. Keep the starter's Metro config and wasm transformer. `assets` retains viewed media within its device byte budget; Expo Go uses the online client and ignores it.

At every milestone, `npm run export:ios` publishes Hermes to `dist/` and returns; native proof runs in the background at background QoS while you keep building.
Both Expo starters include it. The next export and `npx snapback4 doctor` print the result; `npx snapback4 witness status --wait` waits for your final report.
Failures stay visible with their log paths without failing a successful export. Unavailable hosts report a skip. A newer export supersedes pending proof.
Receipts in `artifacts/native-smoke/<timestamp>` bind the loaded export hash. Matching native inputs reuse a Release app; native changes rebuild. Background preparation allows 900 seconds without output activity and at most 60 minutes total. Activity alone does not establish build progress; repeated output can keep a stalled build occupied until that cap.
`npm run native:smoke` explicitly waits for a full build and smoke. Empty starters prove lifecycle; write replay needs an app scenario (`guide witness`).

```ts
// src/client.ts
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { smokeOrigin } from "snapback4-expo/witness";
import { webDevice } from "snapback4/web";
const sessionStore = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  delete: (key: string) => SecureStore.deleteItemAsync(key),
};
export const app = createApp({
  url: smokeOrigin(process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400"),
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
import { useNativeSmokeGuest } from "./src/native-smoke";
import { useState } from "react";
import { Button, Image, Text, TextInput, View } from "react-native";
import { AppProvider, useAuth, useClient, useQuery, useMutation, useAsset } from "snapback4/react";
import { app } from "./src/client";
import { api } from "./snapback/generated/api";
export function App() { return <AppProvider app={app}><Account /></AppProvider>; }
function Account() {
  useNativeSmokeGuest();
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

A failed handle save keeps the session; choose another handle. Under `AppProvider`, online mutations persist IDs and arguments before dispatch;
local devices own a durable outbox. Pending writes stay with their original account. Terminal `sent` confirms execution; `failed` carries the refusal.

Explicit write IDs must use the accepted form (26 Crockford base32 characters, starting with `0`–`7`). Normally omit `id`; the client mints it. To keep one intent across retries, call `mintId()` once and keep that ID with its unchanged
arguments. For a fixture or seed label, `idFrom(label)` gives the same valid ID every time (it sorts before minted IDs):

```ts
import { mintId, idFrom } from "snapback4/client";
const intent = { id: mintId(), args: { handle: "alice" } };
await client.mutate(api.saveProfile, intent.args, { id: intent.id }); // a fixture: { id: idFrom("seed:alice") }
```

A fresh ID on every retry does not identify that same intent. `usePendingItems` renders scoped text/media intents beside explicitly keyed rows, including “Sent; updating view”.
`usePendingState` selects the last admitted toggle intent. Both preserve custody and scope fences; see the intent-card recipe in CLIENT-AND-OPERATIONS.md.

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
SDK delivery and `useSeen(api.receiptFamilies.chat, { scope, through, active })` for actually visible confirmed positions on web/native (never pending or merely loaded rows). Ordinary search combines current server hits
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
declare `snapback/workers/push.mjs` and opt into `runWorker({ ledger: true, ... })` for durable completion deduplication; pass `meta.idempotencyKey` to the provider. See `guide maintains`, `guide jobs` and `guide effects` for recipes.

`await client.query(op, args)` returns ready data or a refusal; show partial results and refusals explicitly. Use `readPresentation(read)` from `snapback4/contract` for notices; [the complete screen](./CLIENT-AND-OPERATIONS.md#a-stable-conversation-screen) keeps an account/resource shell mounted. See `guide client` for the one-shot contract and `guide social` for the [tested bounded route-owner recipe](./CLIENT-AND-OPERATIONS.md#bounded-route-owned-observations). Import `usePage`, `useMutation` and `useAsset` from `snapback4/react`; use them with the generated `api` handles. `usePage` keeps loaded pages while the next loads; it supplies accumulated
items, `hasMore`, `loadMore` and read completeness. For generated queries returning source rows, it keeps one newest observed image per row ID; projections keep list semantics even when they contain a field named `id`. Both read hooks keep the same-key answer marked `revalidating` through refetch, reconnect, slow reads, offline transport and retry exhaustion, with no timeout. Local commits replace it directly after the replica re-read. Answers stay visible and `revalidating` until replaced unless change evidence may revoke a row; then the existing one-second withdrawal bound applies. Inserts and updates to non-policy columns retain the answer through slow or failed retries. Deletes, changes to authorization inputs, and unknown or older evidence retain the bound. This classification is automatic across local commits, online mutation acknowledgements, `/changes` and `/sync`. Successful immediate replica replacements never show `loading`. An older replica read cannot clear a pending notification; sync must apply its cut or a current server answer must replace the display. Offline ephemeral answers keep their original row expiry. Applied local membership removal withdraws the affected audience groups immediately, even before a staged page publishes. Older replica rows cannot return before publication. Local budgets exclude capacity queue wait; online revocation evidence includes it. `keep: false` withdraws immediately; `keep: true` adds a 30-second linger after the last subscriber. Key changes, deadlines, sign-out, credential, store and schema resets still withdraw. A reported program-generation change withdraws immediately, even with no changed tables; the old replica stays unavailable until adoption completes. Offline retention uses `fresh: false` and `since`; no profile identity latch is needed. `useMutation` tracks writes; `useAsset` resolves
a placed asset. Upload bytes with `client.upload` before passing the asset id to its placement mutation. Operations in `schema.q` are
`api.name`; module files use `api.module.name`. Effects run in declared Node 24 entries `snapback/workers/<service>.mjs` (`node` on PATH or `SNAPBACK_NODE`; Bun is not accepted, and dev exits at startup without it): dev and serve start, restart and stop them, with service tokens injected and logs redacted. `guide effects` shows `ledger: true` and the stable `meta.idempotencyKey`; a crash after the provider call but before the ledger commit still needs provider idempotency.

Public feeds share an activity union: Following delivers it to each reader; Trending ranks a finite time window (`npx snapback4 guide feeds`). Use the generated [`useFollowing` reader](./CLIENT-AND-OPERATIONS.md#following-history) for exact online history, preparation and live prepend; offline it keeps the inbox and reports that older posts are not on this device.

## Reference map: open only what the feature needs

`snapback4 guide <card>` and `snapback4 why <code>` answer in the terminal. Bare `guide` indexes the cards; `guide aliases`
lists words that open a card or one section (`guide pagination`). A card over 130 lines prints its opening, a section index
and, piped, its first section: `--section <number or words>` prints one, `--find <words>` greps it, `--full` prints all.
Every refusal names a code, site and rewrite.
Every Quarry example compiles in the suite; the language card also runs. The chat example is optional.
| Need | One reference lookup |
|---|---|
| Quarry grammar | `guide cheatsheet` (one screen) / `guide language` |
| Complete chat example / chat starters | `guide app` / [`init --web --template chat`](./CLIENT-AND-OPERATIONS.md#offline-web-starter) |
| Fields / indexes / rules / aggregates / totals (`count`, `sum`) | `guide types` / `guide indexes` / `guide rules` / `guide maintains` / `guide totals` |
| Reads / shapes / writes / helpers / chat receipts | `guide reads` / `guide shapes` / `guide writes` / `guide programs` / `guide receipts` |
| Device contents / prediction / acquisition costs | `guide sync` / `guide prediction` / `guide residency` |
| Following: `view following` / Global: planned view / Trending: predicate read / search | `guide feeds` / `guide search` |
| Identity / media / expiry / seeds / time and the dev clock | `guide personas` / `guide assets` / `guide expire` / `guide replay` / `guide time` |
| Typing / scoped presence | `guide ephemeral` / [Ephemeral writes](./CLIENT-AND-OPERATIONS.md#ephemeral-writes) |
| Background or network work (no directive) | `guide jobs` / `guide effects` (effect handlers) / `guide presence` / `guide native` / `guide services` (`mintSession`, `revokeSessions`) |
| Limits / failures / adoption / production upgrades and deploy / simulator proof | `guide bounds` / `guide refusals` / `guide evolution` / `guide deploy` / `guide witness`; `why <code>` |
| Client patterns / exports by subpath / auth / React list | `guide client` / `guide api` / [Client §4](./CLIENT-AND-OPERATIONS.md#4-the-client) / [React list](./CLIENT-AND-OPERATIONS.md#react) |
| Development and wire | [§5](./CLIENT-AND-OPERATIONS.md#5-development) |
| Release | [§6](./CLIENT-AND-OPERATIONS.md#6-release) |
| Expo | [§7](./CLIENT-AND-OPERATIONS.md#7-expo) |
| Exclusions | [§8](./CLIENT-AND-OPERATIONS.md#8-not-in-this-release) |
| Actions, routes and action-bound identity (`use server`) | `guide actions` / `guide routes` / [SERVER.md](./SERVER.md) (OIDC bound-session recovery is protocol-double-only; repaired-engine qualification is pending) |
Durable offline capture and placement: [OFFLINE-UPLOADS.md](./OFFLINE-UPLOADS.md) (`useUpload`, `uploadAndPlace`, typed retry/cancellation and the Exact adapter contract).
