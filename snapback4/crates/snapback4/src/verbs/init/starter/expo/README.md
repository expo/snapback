# Todos: a Snapback 4 Expo starter

An Expo (React Native) app over a local-first Snapback 4 backend: one table,
one live query and three mutations. Development and production builds open the
native device and work offline; Expo Go uses the online client; web uses the
wasm device.

```sh
npm install
npx snapback4 check      # compiles snapback/schema.q, writes snapback/generated/api.ts
npx snapback4 dev        # serves http://127.0.0.1:4400 and reloads on save
npm start                # in a second terminal: Expo Go, or press w for web
npm run typecheck
```

`npm run ios:dev` builds the native development build. The iOS simulator
reaches http://127.0.0.1:4400 on this machine; for a physical phone set
`EXPO_PUBLIC_SNAPBACK_URL` to your TLS deployment. Choose "Continue as a
guest", then add a few todos.

## Files

- `snapback/schema.q`: the backend (tables, rules, `sync`, queries, mutations).
  Edit it and `snapback4 dev` re-adopts it; `snapback4 check` regenerates the API.
- `fixtures/`: seed rows and expected outcomes for `snapback4 test`.
- `src/client.ts`: one `createApp` for the whole app; it picks the native
  device, the online client (Expo Go) or `webDevice()` (web).
- `App.tsx`: sign-in, the live list (`usePage`) and writes (`useMutation`).
- `expo-env.d.ts`: Expo's types, including `process.env.EXPO_PUBLIC_*`.
- `metro.config.js` and `metro-wasm-transformer.cjs`: keep both; Metro then
  ships the web device's wasm and skips the local `.snapback4/` store.

Keep the Expo and `babel-preset-expo` major versions together; mixing them can
fail Hermes compilation.

`npm install` reports about 22 audit findings and a deprecated `uuid@7`. They
come from Expo's build-time toolchain (`braces` under Metro, `node-forge` under
the Expo CLI, `uuid` under config plugins), have no fixed release inside Expo
57, and are not part of the app bundle. Do not run `npm audit fix --force`: it
"fixes" them by downgrading Expo to SDK 44. `npx expo install --fix` takes Expo
57 patch releases as they ship.

## Native proof

`npm run export:ios` publishes Hermes to `dist/` and returns at every milestone;
native proof then runs in the background at background QoS, so you can keep
building. The next export and `npx snapback4 doctor` print its result; for a
final report run `npx snapback4 witness status --wait`. Receipts and logs stay
in `artifacts/native-smoke/<timestamp>`. `npm run native:smoke` explicitly
waits for a full Release build and smoke. Smoke proves the store opens,
acquisition, cold offline reopen and reconnect; pending write replay needs an
app scenario (`npx snapback4 guide witness`).

## Next steps

- Grow the schema: `npx snapback4 guide language`, then `guide rules`, `guide sync`.
- Try operations from the terminal: `npx snapback4 run add '{"title":"milk"}' --as alice`.
- Test without a server: `npx snapback4 test --fixture fixtures --as alice` loads
  `fixtures/todos.jsonl` and runs the expectations in `fixtures/test.cases.jsonl`
  (`npx snapback4 guide testing`).
- Add email accounts: change `use identity` to `use identity password` and see `guide auth`.
- A complete multi-screen example: `npx snapback4 init <dir> --expo --template chat`.
