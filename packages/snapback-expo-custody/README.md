# `@expo/snapback-expo-custody`

Experimental first-party native ordinary-bearer auth custody for Snapback Expo
applications. The package provides native compare-and-replace adapters backed
by iOS Keychain or Android DataStore plus Android Keystore AES-GCM. Custody
grades are reported by the selected adapter; in v1, both OS adapters declare
only `single-runtime`.

Publication in the matched Snapback package closure does not claim native
durable custody on either OS. Those claims remain withheld until the separate
iOS and Android probes in
[`issues/20260815-llp-0258-phase-2-native-custody-evidence.md`](https://github.com/expo/snapback/blob/main/issues/20260815-llp-0258-phase-2-native-custody-evidence.md)
pass. The package is a native module and therefore requires an Expo
development/production build; it is not available in Expo Go.

```js
import { createNativeAuthCustodyStorage } from '@expo/snapback-expo-custody';

const storage = createNativeAuthCustodyStorage();
const grade = await storage.platformGrade();
```

The Expo config plugin installs the mandatory Android custody-file backup and
device-transfer exclusions. It is not applied automatically: list
`@expo/snapback-expo-custody` explicitly in the app's Expo `plugins` array.

The Android carrier retires a permanently invalidated Keystore alias before it
reports the typed custody-absent diagnostic, so a later fresh write can create
a new key. JavaScript fakes cover that restart contract; only the LLP 0263
emulator/device probes can establish real Keystore invalidation, AEAD, backup,
and OEM process-name behavior. A resolved Android process name different from
the application package fails closed as a `secondary-process` single-runtime
refusal. If every process-identity mechanism fails, custody also fails closed
before I/O with reason `process-identity-unresolved`. This is deliberate:
single-runtime identity is a security boundary under LLP 0258 D3, not an
optional diagnostic.

This is an optional add-on, not a dependency of the `@expo/snapback` umbrella.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Read [password auth and custody](http://127.0.0.1:4287/_snapback/guide/auth/passwords.md)
  for the ordinary bootstrap path and current platform limits.
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  before assuming an OS custody grade is available.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.
