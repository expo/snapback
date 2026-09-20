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

Use `init` for a web replica or `init --online` for an online-only app instead.
The example below uses the Expo starter's installed React Native and SecureStore.
Replace `snapback/schema.q`, `src/client.ts` and `App.tsx` with the blocks below,
add `src/account.ts`, and remove the unused `src/Inbox.tsx`, `src/Thread.tsx` and
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

### 3. Keep the signed-in session

Put this controller in `src/account.ts`. It persists signup/login before opening,
restores on reopen, and keeps a write's ID and arguments before sending. A pending
write waits for terminal settlement; reopening collects it with the same ID.
A failed write allows a new attempt. A missing profile resumes onboarding;
a denied read is an error, never an empty profile.

```ts
// src/account.ts
import { signup, login, keepSession, restoreSession, forgetSession } from "snapback4/auth";
import { createClient, mintId } from "snapback4/client";
import { createLocalClient, type DeviceOpener } from "snapback4/local";
import type { SessionStore } from "snapback4/auth";
import type { Client, Session, Write } from "snapback4/contract";
import { api } from "../snapback/generated/api";
export function account(url: string, store: SessionStore, device?: DeviceOpener) {
  let client: Client;
  const key = `account.write.${url}`;
  type Intent = { id: string; owner: string; op: "save"; handle: string } |
    { id: string; owner: string; op: "avatar"; avatar: { id: string } };
  async function open(session: Session) {
    client = device ? await createLocalClient({ url, session, sessionStore: store, device }) : createClient({ url, session });
    client.onSession(next => { void (next ? keepSession(url, next, store) : forgetSession(url, store)); });
    if (device && client.link() === "online") await (client as Client & { sync(): Promise<void> }).sync();
    return client; // client.acquired says when the local partition is ready.
  }
  async function submit(intent: Intent): Promise<Write> {
    await store.set(key, JSON.stringify(intent));
    const result = intent.op === "save"
      ? await client.mutate(api.saveProfile, { handle: intent.handle }, { id: intent.id })
      : await client.mutate(api.placeAvatar, { avatar: intent.avatar }, { id: intent.id });
    if (result.state !== "pending") await store.delete(key);
    return result;
  }
  async function recover(): Promise<Write | undefined> {
    const saved = await store.get(key);
    if (!saved) return;
    const intent: Intent = JSON.parse(saved);
    if (intent.owner !== client.viewer()) throw Error("Finish the pending save with its original account");
    const result = await client.write(intent.id);
    if (!result) return submit(intent); // uncertain response: same intent, same ID
    if (result.state !== "pending") await store.delete(key);
    return result;
  }
  return {
    async restore() { const kept = await restoreSession(url, store); return kept ? open(kept) : null; },
    async signIn(mode: "signup" | "login", email: string, password: string) {
      const result = mode === "signup" ? await signup(url, email, password) : await login(url, email, password);
      if (!result.ok) throw Error(`${result.why.code}: ${result.why.message}`);
      await keepSession(url, result.session, store);
      return open(result.session);
    },
    recover,
    async profile() {
      const read = await client.query(api.myProfile, {});
      if ("loading" in read) return "loading";
      if ("denied" in read) throw Error(`${read.denied.code}: ${read.denied.message}`);
      if (!read.complete) return "loading";
      return read.data ?? "profile";
    },
    async save(handle: string, file?: Blob): Promise<Write> {
      const previous = await recover();
      if (previous?.state === "pending") return previous;
      const current = await client.query(api.myProfile, {});
      if (!("data" in current)) throw Error("Wait for a readable profile answer");
      if (current.data?.handle !== handle) {
        const available = await client.query(api.handleAvailable, { handle });
        if (!("data" in available) || !available.complete || !available.fresh) throw Error("Try checking the handle again");
        if (!available.data) throw Error("Choose another handle");
      }
      const saved = await submit({ id: mintId(), owner: client.viewer()!, op: "save", handle });
      if (saved.state !== "sent" || !file) return saved;
      const uploaded = await client.upload(file); // online only; JPEG, PNG, WebP or MP4
      if (!uploaded.ok) throw Error(`${uploaded.why.code}: ${uploaded.why.message}`);
      return submit({ id: mintId(), owner: client.viewer()!, op: "avatar", avatar: { id: uploaded.asset.id } });
    },
  };
}
```

### 4. Open the client for this platform

Replace `src/client.ts`. The starter's normalized SecureStore adapter persists
native/Expo Go sessions; browser persistence is an explicit opt-in here because
scripts on the page can read localStorage. Native builds use `nativeDevice`, web
uses `webDevice()`, and Expo Go uses `createClient` with no custom native code.
Keep the starter's Metro config and wasm transformer for web asset discovery.
Sync online and consult `client.acquired` before expecting local prediction.

```ts
// src/client.ts
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { localStorageSessionStore } from "snapback4/auth";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { webDevice } from "snapback4/web";
import { account } from "./account";
const sessionStore = {
  get: (key: string) => SecureStore.getItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_")),
  set: (key: string, value: string) => SecureStore.setItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_"), value),
  delete: (key: string) => SecureStore.deleteItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_")),
};
const url = process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400";
export const firstAccount = account(url, Platform.OS === "web" ? localStorageSessionStore() : sessionStore,
  Platform.OS === "web" ? webDevice() : nativeAvailable() ? nativeDevice : undefined);
```

### 5. Save and render the profile

Replace `App.tsx`. Enter an image URI accessible to the host for this small
example (on web its server must allow CORS); a production photo picker can pass
its selected Blob to the same `save` function. Upload precedes placement; the
avatar is served under its home row's read rule. Uploads cannot queue offline.

```tsx
// App.tsx
import { useEffect, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import type { Client } from "snapback4/contract";
import { firstAccount } from "./src/client";
export function App() {
  const [client, setClient] = useState<Client | null>(null);
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [handle, setHandle] = useState(""), [uri, setUri] = useState("");
  const [status, setStatus] = useState("loading"), [busy, setBusy] = useState(false);
  async function show() {
    const write = await firstAccount.recover();
    if (write?.state === "pending") { setStatus("pending: wait, then Check save"); return; }
    if (write?.state === "failed") { setStatus(`${write.why.code}: ${write.why.message}`); return; }
    const profile = await firstAccount.profile();
    setStatus(typeof profile === "string" ? profile : `sent: @${profile.handle}; avatar ${profile.avatar?.id ?? "not placed"}`);
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    try { await work(); } catch (e) { setStatus(String(e)); } finally { setBusy(false); }
  }
  useEffect(() => {
    let opened: Client | null = null, stopped = false;
    void run(async () => { opened = await firstAccount.restore();
      if (stopped) { await opened?.close(); return; }
      setClient(opened); if (opened) await show(); else setStatus("Sign up or log in"); });
    return () => { stopped = true; void opened?.close(); };
  }, []);
  useEffect(() => () => { void client?.close(); }, [client]);
  const signIn = (mode: "signup" | "login") => run(async () => {
    setClient(await firstAccount.signIn(mode, email, password)); await show();
  });
  return <View style={{ padding: 32, gap: 12 }}>
    <Text>{status}</Text>
    {!client ? <>
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <Button title="Sign up" disabled={busy} onPress={() => void signIn("signup")} />
      <Button title="Log in" disabled={busy} onPress={() => void signIn("login")} />
    </> : <>
      <TextInput placeholder="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" />
      <TextInput placeholder="Avatar image URI (optional)" value={uri} onChangeText={setUri} />
      <Button title="Save profile and avatar" disabled={busy} onPress={() => void run(async () => {
        const write = await firstAccount.save(handle, uri ? await (await fetch(uri)).blob() : undefined);
        if (write.state === "failed") setStatus(`${write.why.code}: ${write.why.message}`);
        else if (write.state === "pending") setStatus("pending: wait, then Check save");
        else await show();
      })} />
      <Button title="Check save" disabled={busy} onPress={() => void run(show)} />
    </>}
  </View>;
}
```

### 6. Verify, then stop reading

Sign up, save the profile and avatar, reload, then log in after clearing the
saved session. A missing profile returns to onboarding; keep a pending write's
ID through retry/reopen and check its terminal result before starting another.
Local clients persist their outbox; online clients need the stored intent above
for an uncertain response. Adopted web tabs share 256 terminal receipts per
server/viewer; each outbox keeps one owner. Account switching must settle the
old account's pending writes. Keep local prediction's `pending` row indicator in
larger live screens. Your app must deliver its shell on a cold-offline start
(a service worker on web or an installed native bundle); sync stores data, not HTML.
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
| Complete chat example | `guide app` |
| Fields / indexes / rules / aggregates | `guide types` / `guide indexes` / `guide rules` / `guide maintains` |
| Reads / shapes / writes / helpers | `guide reads` / `guide shapes` / `guide writes` / `guide programs` |
| Device contents / prediction / acquisition costs | `guide sync` / `guide prediction` / `guide residency` |
| Following or Trending / search | `guide feeds` / `guide search` |
| Identity / media / expiry / seeds / clock | `guide personas` / `guide assets` / `guide expire` / `guide replay` / `guide clock` |
| Background or network work | `guide jobs` / `guide effects` / `guide presence` / `guide native` / `guide actions` / `guide routes` / `guide services` |
| Limits / failures / adoption / simulator proof | `guide bounds` / `guide refusals` / `guide evolution` / `guide witness`; `why <code>` |
| Full client, React and auth | [CLIENT-AND-OPERATIONS.md §4](./CLIENT-AND-OPERATIONS.md#4-the-client) |
| Development and wire | [§5](./CLIENT-AND-OPERATIONS.md#5-development) |
| Release | [§6](./CLIENT-AND-OPERATIONS.md#6-release) |
| Expo | [§7](./CLIENT-AND-OPERATIONS.md#7-expo) |
| Exclusions | [§8](./CLIENT-AND-OPERATIONS.md#8-not-in-this-release) |
| TypeScript handlers and identity integration | [SERVER.md](./SERVER.md) (OIDC bound-session recovery is protocol-double-only; repaired-engine qualification is pending) |
