# `@expo/snapback-expo-dev-identity`

First-party native checkout reader for the default-off supervised Snapback Expo
development-client protocol in LLP 0262 D2.

Install the package in an Expo development-client app, register
`@expo/snapback-expo-dev-identity` in `expo.plugins`, and make its native-only
side-effect entry the first import in the app entry module:

```js
import '@expo/snapback-expo-dev-identity/install';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
```

The iOS app-delegate subscriber captures
`ProcessInfo.processInfo.environment.SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE`.
The Android activity-delegate handler captures and removes the launch Intent
string extra with the same name before Expo enters a React load path. Native
memory releases the delivery after one synchronous read; the prelude installs
it as the non-enumerable
`globalThis.__SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE__` hook before `App`
evaluates. No nonce is written to Expo public config, app config, native
resources, Metro modules, source maps, receipts, durable storage, or logs.

This package cannot run inside Expo Go. The app config must name its own iOS
bundle identifier and Android package, and the supervisor must explicitly opt
into checkout while launching those identifiers. Production and web imports of
the prelude are inert.

The live native witness app and orchestrator commands live under
`demos/expo-native-checkout-reader/`.
