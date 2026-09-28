# Expo chat starter

Two ways to run: the default `snapback4 init` declares `sync` so a
local-first client can hold its partition and work offline. `init --online`
omits `sync` and opens `createClient`: queries run on the server and stay
live through `/changes`, with no replica. Both use the same schema, rules
and meter. Add a sync line and open a local-first client when you need
offline data.

This starter opens the native Rust device in development and production
builds that carry `snapback4-expo`; Expo Go selects the online client through `createApp`, with
no native module and no wasm. `src/client.ts` exports `tier`.
Web selects `webDevice()`; `npm run build:web` exports and installs its offline shell.
Keep the generated Metro config and
metro-wasm-transformer.cjs: Metro then emits the wasm asset URL.

The reference toolchain is Expo 57.0.22, React Native 0.86.3, React 19.2.3,
expo-sqlite 57.0.3 and babel-preset-expo 57.0.11. Keep the Expo and Babel
preset major versions together; mixing them can fail Hermes compilation.

Run `npm install`, `npx snapback4 check`, then `npx snapback4 dev` in one
terminal. In another, run `npm start`
for Expo Go, or `npm run ios:dev` for
the native development build. The local server URL defaults to
http://127.0.0.1:4400 (the iOS simulator on this machine). Set
EXPO_PUBLIC_SNAPBACK_URL to your TLS deployment for a physical phone;
choose Continue as a guest to sign in. The app restores that session on reopen.
The inbox starts empty: seed a conversation and its memberships through
`POST /seed` during development. Change app.json's bundle IDs before shipping.
