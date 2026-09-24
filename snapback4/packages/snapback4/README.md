# snapback4

A scale-to-zero backend: Quarry declares your data and rules; typed clients
read online or on a device, using the same Rust interpreter as the server.
The package carries the TypeScript client and the CLI (currently darwin-arm64).

## Start here: your first working account screen

Follow this `README.md` through password signup, profile, avatar and reopen.

### 1. Create and run the backend

Use Node 24. In a new app directory, install the exact package and Expo starter:

```sh
npm install --save-exact snapback4
npx snapback4 init --expo
npm install
```

Use `init --web` for the offline Vite starter, `init` for a schema, or `init --online` for an online-only app.
The example below uses the Expo starter's installed React Native and SecureStore.
Replace `snapback/schema.q`, `src/client.ts` and `App.tsx` with the blocks below,
and remove the unused `src/Inbox.tsx`, `src/Thread.tsx` and
`src/witness.ts` chat screens. Remove the chat's optional `snapback/worker.mts`.
Then run `npx snapback4 check` to generate the API; keep `npx snapback4 dev`
running in one terminal and `npm start` in another (Expo Go), or use
`npm run ios:dev` for a native development build. Do not set a persona for this
password example. The iOS simulator reaches `http://127.0.0.1:4400`; set
`EXPO_PUBLIC_SNAPBACK_URL` to your TLS deployment for a physical phone.

### 2. Declare identity and a profile

An email-and-password product declares `use identity password`; plain
`use identity` also mints guest sessions. Password signup requires at least
8 characters (Unicode scalar values) and at most 1,024 UTF-8 bytes; login
accepts at most 1,024 UTF-8 bytes. Sessions normally last seven days.
Handles are discoverable; profiles and avatars are private to their owner.
`profileFor` explicitly refuses another owner; table rules otherwise hide
unreadable rows as missing. Handle claims are server-authoritative.

```quarry
use identity password
table profiles:
  principal: principal
  handle: text 3..20 format handle
  avatar: image <=10000000 ?
  unique byPrincipal: principal
  unique byHandle: handle
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  immutable principal
  cap 1 by principal
  sync to .principal

table handles:
  principal: principal
  handle: text 3..20 format handle
  unique byPrincipal: principal
  unique byHandle: handle
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

A post-signup availability check uses the new session. The unique handle index
still decides races: keep the session after a failed save and choose another
handle. An incomplete or stale availability answer is not permission to claim it.
Availability and handle saves use the server; your private profile is held locally.

### 3. Create the app

Replace `src/client.ts`. The app restores the session, opens the right client,
and owns pending writes across restarts. Native sessions use SecureStore;
browser persistence is explicit because page scripts can read localStorage.
Expo Go uses the online client. Keep the starter's Metro config and wasm transformer.

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
});
```

### 4. Sign in, save and render

Replace `App.tsx`. A refused sign-in returns `{ ok: false, why }`. A missing
profile resumes onboarding; a denied read remains an error. Enter an image URI
accessible to the host (on web its server must allow CORS), or pass a photo
picker's Blob to `upload`. Uploads require a connection; placement is a mutation.

```tsx
// App.tsx
import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { AppProvider, useAuth, useClient, useQuery, useMutation } from "snapback4/react";
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
  const [handle, setHandle] = useState(""), [uri, setUri] = useState(""), [problem, setProblem] = useState("");
  const busy = save.inFlight || save.last?.state === "pending" || place.inFlight || place.last?.state === "pending";
  const upload = async () => {
    try {
      const result = await client.upload(await (await fetch(uri)).blob());
      if (!result.ok) { setProblem(result.why.message); return; }
      await place.run({ avatar: { id: result.asset.id } });
    } catch (error) { setProblem(String(error)); }
  };
  return <View style={{ padding: 32, gap: 12 }}>
    <Text>{"denied" in profile ? profile.denied.message : "loading" in profile ? "Loading…" : profile.data ? `@${profile.data.handle}; avatar ${profile.data.avatar?.id ?? "not placed"}` : "Choose your handle"}</Text>
    <Text>{problem || (save.last?.state === "failed" ? save.last.why.message : save.last?.state)}</Text>
    <Text>{place.last?.state === "failed" ? place.last.why.message : place.last?.state}</Text>
    <TextInput placeholder="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" />
    <Button title="Save profile" disabled={busy} onPress={() => void save.run({ handle })} />
    <TextInput placeholder="Avatar image URI" value={uri} onChangeText={setUri} />
    <Button title="Place avatar" disabled={busy || !("data" in profile && profile.data)} onPress={() => void upload()} />
    <Button title="Sign out" onPress={() => void auth.logout()} />
  </View>;
}
```

The unique handle constraint decides races. A failed save keeps the session so
you can choose another handle. Existing hooks work under `AppProvider`; online
mutations persist their IDs and arguments before dispatch, and local devices
own their durable outbox. Pending writes stay with their original account.
A terminal `sent` receipt confirms execution; `failed` carries the refusal.

### 5. Export an offline shell, then verify

`npm run build:web` in the Expo starter runs `expo export -p web` followed by
`snapback4 web-shell dist`. The Vite starter's `npm run build` ends with the same
command. For an existing export, run `npx snapback4 web-shell dist --base /` and
serve that directory over HTTPS (localhost also works). Every exported file is
public shell content; keep exports nonpersonalized. The worker never caches
API responses or assets from the backend. A replacement waits for old tabs to close.

Sign up, save a profile and avatar, reload, then open the acquired profile with
the network off for a cold-offline start. Reconnect to settle pending writes. Browser eviction can remove
offline availability; `client.acquired` states whether the replica is ready.
Defer feeds, search, schedules and server handlers until those features are needed.

## App files

Edit `snapback/*.q` and your screens. `check`/`dev` build
`snapback/generated/api.ts`; never commit it. Operations in `schema.q` are
`api.name`, and `snapback/<module>.q` operations are `api.<module>.name`.
`snapback/worker.mts` is an optional Node ESM worker for effects and actions.

## Reference map: open only what the feature needs

`snapback4 guide <card>` and `snapback4 why <code>` answer in the terminal.
Bare `guide` prints a two-line index of cards and aliases; `guide language`
prints the language card. Every refusal names a code, site and rewrite.
Every Quarry example here and on the cards compiles in the suite; the language
card's single program also runs. The chat example is optional.

| Need | One reference lookup |
|---|---|
| Quarry grammar | `guide language` |
| Complete chat example / offline web starter | `guide app` / [Vite starter](./CLIENT-AND-OPERATIONS.md#offline-web-starter) |
| Fields / indexes / rules / aggregates | `guide types` / `guide indexes` / `guide rules` / `guide maintains` |
| Reads / shapes / writes / helpers | `guide reads` / `guide shapes` / `guide writes` / `guide programs` |
| Device contents / prediction / acquisition costs | `guide sync` / `guide prediction` / `guide residency` |
| Following: `maintain feed: timeline` / Trending / search | `guide feeds` / `guide search` |
| Identity / media / expiry / seeds / clock | `guide personas` / `guide assets` / `guide expire` / `guide replay` / `guide clock` |
| Background or network work (no directive) | `guide jobs` / `guide effects` (effect handlers) / `guide presence` / `guide native` / `guide services` (`mintSession`, `revokeSessions`) |
| Limits / failures / adoption / simulator proof | `guide bounds` / `guide refusals` / `guide evolution` / `guide witness`; `why <code>` |
| Full client, React and auth | [CLIENT-AND-OPERATIONS.md §4](./CLIENT-AND-OPERATIONS.md#4-the-client) |
| Development and wire | [§5](./CLIENT-AND-OPERATIONS.md#5-development) |
| Release | [§6](./CLIENT-AND-OPERATIONS.md#6-release) |
| Expo | [§7](./CLIENT-AND-OPERATIONS.md#7-expo) |
| Exclusions | [§8](./CLIENT-AND-OPERATIONS.md#8-not-in-this-release) |
| Actions, routes and action-bound identity (`use server`) | `guide actions` / `guide routes` / [SERVER.md](./SERVER.md) (OIDC bound-session recovery is protocol-double-only; repaired-engine qualification is pending) |
