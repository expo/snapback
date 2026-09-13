# snapback4-expo

Snapback 4's device in Rust, as an Expo module: the partition in its own
SQLite, the stream applied, the outbox kept, queries and predictions
answered — the same interpreter the server runs — behind one JSON call.
`snapback4/native` is the client over it:

```ts
import * as SQLite from "expo-sqlite";
import { createLocalClient } from "snapback4/local";
import { createNativeClient } from "snapback4/native";
import { expoSqliteDriver, openSqlite } from "snapback4/replica";
import { nativeAvailable, nativeDevice, documentDirectory } from "snapback4-expo";

const safe = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_");   // store and session names carry the URL and the viewer
const sqliteStore = { open: async (name: string, schema: unknown) => openSqlite(expoSqliteDriver(await SQLite.openDatabaseAsync(`${safe(name)}.db`)), schema) };
const client = nativeAvailable()
  ? await createNativeClient({ url, guest: true, sessionStore, native: nativeDevice, dataDir: documentDirectory() })
  : await createLocalClient({ url, guest: true, sessionStore, store: sqliteStore });   // Expo Go: the TypeScript tier
```

`createNativeClient` probes the module first and rejects with
`E_NATIVE_VERSION` when the native binary predates the JavaScript client:
reloading JavaScript does not update the module; rebuild the development
build.

Expo Go loads no custom native code, so the module is present only in a
development or production build: add `expo-dev-client`, then
`npx expo run:ios` (the module autolinks; nothing to configure). The
Rust library ships in the package as `ios/Snapback4Device.xcframework`
(9.1 MB, a 4.8 MB archive a slice, built by `scripts/build-xcframework.sh`
from `crates/snapback4-device`); it costs an app 1.7 MB linked, SQLite
included, and a module call takes about a millisecond.

Proved on the iOS simulator by the repository's witness in a development
build (`WITNESS_DEV_CLIENT=1 node witness/expo.mjs`, recorded in
`metrics/witness.jsonl` as `dev-client-native`): a cold sync of 303 rows
in 31 ms, a reopen in 6 ms, a cold start with no network answering the
thread from the store in 2 ms, and writes composed offline surviving a
restart and landing in order. `EXPO_PUBLIC_SNAPBACK_TRACE=1` logs every
call's op, time and answer size. Android follows.
