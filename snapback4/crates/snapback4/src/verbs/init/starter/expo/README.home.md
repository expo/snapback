# TITLE

An Expo (React Native) app over the Snapback 4 backend in `snapback/*.q`,
started from the Snapback 4 Expo starter. Development and production builds
open the native device and work offline; Expo Go uses the online client; web
uses the wasm device.

ADVISORIES

```sh
npm install
npx snapback4 check      # compiles snapback/*.q, writes snapback/generated/api.ts
npx snapback4 dev        # serves http://127.0.0.1:4400 and reloads on save
npm start                # in a second terminal: Expo Go, or press w for web
npm run typecheck
```

`npm run ios:dev` builds the native development build. The iOS simulator
reaches http://127.0.0.1:4400 on this machine (`EXPO_PUBLIC_SNAPBACK_URL`
overrides it); for a physical phone set `EXPO_PUBLIC_SNAPBACK_URL` to your TLS
deployment. `app.json`'s name, slug, scheme and bundle ids are named after this
directory; change the bundle ids before shipping.

SIGN_IN

## Files

- `snapback/*.q`: the backend (tables, rules, `sync`, queries, mutations).
  Edit it and `snapback4 dev` re-adopts it; `snapback4 check` regenerates the API.
- `fixtures/`: your rows as `fixtures/<table>.jsonl` and expectations in
  `fixtures/test.cases.jsonl`, for `npx snapback4 test --fixture fixtures`
  (`npx snapback4 guide testing`).
- `src/client.ts`: one `createApp` per app; it picks the native device, the
  online client (Expo Go) or `webDevice()` (web).
- `App.tsx`: the sign-in and `Home`, a screen to replace. It shows the viewer,
  your operations and your first query without required arguments, rendered
  with `matchRead`. Read with `useQuery(api.op, args)` or
  `usePage(api.list, args)` (a query that takes `c: cursor ?`), write with
  `useMutation(api.op)` (`npx snapback4 guide client`).
- `expo-env.d.ts`: Expo's types, including `process.env.EXPO_PUBLIC_*`.
- `metro.config.js` and `metro-wasm-transformer.cjs`: keep both; Metro then
  ships the web device's wasm and skips the local `.snapback4/` store.

TOOLCHAIN
## Next steps

- Shapes most apps need (roles, two parties, booking, schedules):
  `npx snapback4 guide recipes`; one screen of forms: `guide cheatsheet`.
- A complete multi-screen example: `npx snapback4 init <dir> --expo --template chat`.
