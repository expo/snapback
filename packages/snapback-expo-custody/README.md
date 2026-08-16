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

The Expo config plugin is discovered through `app.plugin.js` and installs the
mandatory Android custody-file backup and device-transfer exclusions.
