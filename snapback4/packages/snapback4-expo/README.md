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

The pinned Expo 57.0.22 apps list `snapback4-expo/plugin` in app.json's
`plugins`. Keep that entry when generating iOS: it supplies the scene lifecycle
required by Xcode 27, shared by the reference chat app and both starters.
After adding it, run `npx expo prebuild --platform ios`, rebuild Release and
reinstall. Preserve custom native changes when regenerating; the plugin handles
the standard Swift starter and refuses custom delegates/manifests.

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

At every milestone, run `npm run export:ios` for Hermes; on a Mac with Xcode,
`npm run native:smoke` (about 3 minutes warm). The Expo starters include both scripts.
The smoke builds and installs your Release app, chooses its own simulator and free
port, and keeps receipts in `artifacts/native-smoke/<timestamp>`. It proves local
store acquisition, cold offline reopen and reconnect. Pending write replay, media
and application assertions need the deeper scenario in `snapback4 guide witness`.
An empty starter proves lifecycle only; export alone proves no native execution.

Own-build preparation (`witness ios --build . --smoke`) uses the witness helper
in matching current `snapback4` and `snapback4-expo` packages. Its synchronous native observation hashes
the executable and the file selected by React Native SourceCode.scriptURL.
Selection must resolve to the verified installed main.jsbundle; unknown, remote
or alternate URLs fail, as do runtime __DEV__ true/unknown and launcher/updates
manifest presence. The validator
checks Release/Hermes, the selected path and hashes against the external proof. Rebuild the native module
when adopting it. Ordinary launches remain inactive. Linked expo-updates is
outside this preparation adapter because an embedded hash cannot attest a cached
update selected at runtime. The JS smoke helper consumes compiler query facts
from the driver, bound to the generation actually served. It checks every
runs/held fact against the kept backend before querying. Stale facts fail;
device-answerable loading fails, while server-only offline
E_OFFLINE is recorded as expected unavailability. Server-only reads
must answer online in prime and restart. Conditional native-module queries
require an application witness; generic smoke refuses that unsupported shape. Client semantics are unchanged.

After JS/assets edits, repeat `npm run native:smoke`; simulator selection and
fresh artifact directories are automatic. Warm Xcode intermediates
are reused; each run builds the current app and seals a new receipt. Repack
is withdrawn. NS round 0 cohort (2026-09-30), fresh starter: **221.7 s cold**, **83.5 s warm median (3 runs)**; social **186.2 s**.
Shared Apartment M5 Pro mini, 18 cores/64 GiB, Xcode/iOS 27; one-minute load: cold 3.61–61.41, warm 3.21–7.22, social 14.62–47.52.
Tools/dependencies installed first. Guidance, not a promise. See `guide witness` for scope.
