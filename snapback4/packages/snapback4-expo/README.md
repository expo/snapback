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
(about 13.1 MB in 0.2.1, a 6.6 MB archive per slice, built by
`scripts/build-xcframework.sh` from `crates/snapback4-device`). It includes
SQLite and the native-query Wasm host. The earlier module measured 1.7 MB
linked and about a millisecond per call; those measurements predate the
native-query host.

Earlier iOS simulator evidence from the repository's witness in a development
build (`WITNESS_DEV_CLIENT=1 node witness/expo.mjs`, recorded in
`metrics/witness.jsonl` as `dev-client-native`): a cold sync of 303 rows
in 31 ms, a reopen in 6 ms, a cold start with no network answering the
thread from the store in 2 ms, and writes composed offline surviving a
restart and landing in order. `EXPO_PUBLIC_SNAPBACK_TRACE=1` logs every
call's op, time and answer size. Android follows.
