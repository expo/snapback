# `@expo/snapback-expo-custody`

First-party native ordinary-bearer auth custody for Snapback Expo applications.
The package provides single-runtime native compare-and-replace storage backed by
iOS Keychain or Android DataStore plus Android Keystore AES-GCM. It is a native
module and therefore requires an Expo development/production build; it is not
available in Expo Go.

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
