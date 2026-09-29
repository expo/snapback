# snapback4-expo

Snapback 4's device in Rust, as an Expo module: the partition in its own
SQLite, the stream applied, the outbox kept, queries and predictions
answered — the same interpreter the server runs, and the same module the
web runs as wasm — behind one JSON call. `snapback4/local` is the client
over it:

```ts
import { createLocalClient } from "snapback4/local";
import { createClient } from "snapback4/client";
import { nativeAvailable, nativeDevice } from "snapback4-expo";

const client = nativeAvailable()
  ? await createLocalClient({ url, guest: true, sessionStore, device: nativeDevice })
  : createClient({ url, session });   // Expo Go: the online tier, with a session the app keeps
```

`createNativeClient` probes the module first and rejects with
`E_NATIVE_VERSION` when the native binary predates the JavaScript client:
reloading JavaScript does not update the module; rebuild the development
build.

Expo Go loads no custom native code, so the module is present only in a
development or production build: add `expo-dev-client`, then
`npx expo run:ios` (the module autolinks; nothing to configure). The
Rust library ships in the package as `ios/Snapback4Device.xcframework`
(about 13.2 MB in 0.2.1, a 6.6 MB archive per slice, built by
`scripts/build-xcframework.sh` from `crates/snapback4-device`). It includes
SQLite and the native-query Wasm host. The earlier module measured 1.7 MB
linked and about a millisecond per call; those measurements predate the
native-query host.

Earlier iOS simulator evidence from the repository's witness in a development
build (before the published driver, recorded in
`metrics/witness.jsonl` as `dev-client-native`): a cold sync of 303 rows
in 31 ms, a reopen in 6 ms, a cold start with no network answering the
thread from the store in 2 ms, and writes composed offline surviving a
restart and landing in order. `EXPO_PUBLIC_SNAPBACK_TRACE=1` logs every
call's op, time and answer size. Android follows.

Ordinary media can be retained with `createLocalClient({ ..., device: nativeDevice,
assets: { keep: "viewed", maxBytes: 67108864 } })`. The opener supplies private
file storage beside each device store in Documents. Offline `client.asset` and
`useAsset` return a file URI; online calls revalidate. The client purges bytes
on home-row revocation, deletion, clearing or expiry and on sign-out; `once`
bytes never enter file storage. Rebuild the native app to include this storage
capability. `keep: "none"` (default) retains no bytes.

## Simulator witness

Import `witness` from `snapback4-expo/witness` in an installed iOS Release
app. `witness()` is null on ordinary launches; under `snapback4 witness ios`
it returns `{ segment, step(name, fn), receipt(object), waitFor(label) }`.
The `Witness` type is exported from the same subpath. Rebuild the native app
to include the launch-environment and Documents-file bridge. The full chat
runner, commands and artifact contract are in `snapback4 guide witness`
(aliases: `simulator`, `offline proof`) and the client package README's
“Proving it on an iOS simulator”. No Expo Go or Metro process supplies a
Release witness.

Own-build preparation (`witness ios --build … --smoke`) needs the updated native
witness helper in this source revision. Its synchronous native observation hashes
the executable and embedded HBC, records Release state and binds each launch to
the external proof; JavaScript records Hermes state. Rebuild the native module
when adopting it. Ordinary launches remain inactive. Linked expo-updates is
outside this preparation adapter because an embedded hash cannot attest a cached
update selected at runtime. The first cal25 experiment remains a partial native
result: its published 0.4.7 client returns loading for an offline ephemeral query,
so full smoke fails. See the witness card before interpreting a build receipt.
