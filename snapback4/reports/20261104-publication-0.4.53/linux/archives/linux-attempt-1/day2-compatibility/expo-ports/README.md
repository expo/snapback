# Todos: a Snapback 4 Expo starter

An Expo (React Native) app over a local-first Snapback 4 backend: one table,
one live query and three mutations. Development and production builds open the
native device; Expo Go uses the online client; web uses the
wasm device.

Offline, in device builds and on the web: every table declares `sync`, so the
app reads and writes offline and syncs when the link returns.

> **`node scripts/install.mjs` takes a few minutes. The Expo code-signing dependency
> `node-forge` is pinned to patched 1.4.1; qualification audits development dependencies too.**

```sh
node scripts/install.mjs
npx snapback4 check      # compiles snapback/schema.q, writes snapback/generated/api.ts
npm run backend         # serves http://127.0.0.1:29120 and reloads on save
npm start                # in a second terminal: Expo Go, or press w for web
npm run typecheck
```

`npm run ios:dev` builds the native development build. The iOS simulator
reaches http://127.0.0.1:29120 on this machine (`init --expo --port N` writes
that port; `EXPO_PUBLIC_SNAPBACK_URL` overrides it); for a physical phone set
`EXPO_PUBLIC_SNAPBACK_URL` to your TLS deployment. Choose "Continue as a
guest", then add a few todos.

## Files

- `snapback/schema.q`: the backend (tables, rules, `sync`, queries, mutations).
  Edit it and `snapback4 dev` re-adopts it; `snapback4 check` regenerates the API.
- `fixtures/`: seed rows and expected outcomes for `snapback4 test`.
- `src/client.ts`: one `createApp` for the whole app; it picks the native
  device, the online client (Expo Go) or `webDevice()` (web).
- `App.tsx`: sign-in, the live list (`usePage`) and writes (`useMutation`).
  `usePage` passes the query's cursor itself: a paged query takes `c: cursor ?`
  and reads `after c` (`npx snapback4 guide reads`); any other query reads
  with `useQuery`. Props name hook results by operation (`UsePage<typeof
  api.list>`, `UseQuery<…>`, `UseMutation<…>`), and `useSignedInViewer()` is
  the viewer below the sign-in. After you replace the schema,
  `npx snapback4 init --adapt` previews; `npx snapback4 init --adapt --apply` swaps this screen for a `Home` that compiles
  against any schema, while it is unmodified.
- `expo-env.d.ts`: Expo's types, including `process.env.EXPO_PUBLIC_*`.
- `metro.config.js`: calls `snapback4-expo/metro`; the package then
  ships the web device's wasm and skips the local `.snapback4/` store.

Keep the Expo and `babel-preset-expo` major versions together; mixing them can
fail Hermes compilation.

## Audit findings

`package.json`'s `overrides` selects `uuid@11` for the config plugins' `xcode`,
patched `glob@14.0.2` and `minimatch@11.0.1` for CLI/configuration/fingerprint traversal,
patched `node-forge@1.4.1` for Expo code signing, and patched zod and
decode-uri-component versions. Qualification includes development dependencies;
fixable or unrecorded advisories fail. There are no current no-fix exceptions.

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

New Expo starters keep a patched configuration merger in `toolchain/deepmerge`,
selected by a local dependency override. Commit that directory with the app.
Existing apps keep their files; `snapback4 init --expo --skip-existing` can add
the patch, and refuses a conflicting override or modified patch file.

## Frontend proofs

New starters with a `verify` script use `npm run verify`: Quarry and TypeScript checking, acceptance,
frontend proof, then probe shutdown; the first failure stops the loop.
Allow an initial tool wait of 30000ms and a long proof timeout; progress prints every 5s.
In those starters, `npm run check` generates the API before typechecking. Replace starter fixture
acceptance with application assertions in package.json. Optional proof helpers:
`snapback4 check --proof-draft` creates a compact one-scenario packet once; fill its
cases.mjs and explicitly wire its acceptance runner. `check --proof-scaffold`
creates the exhaustive matrix. Neither is required; reuse host/accounts if useful.

`probe:serve` exits after 10 seconds ready without requests; use --hold or
SNAPBACK4_PROBE_HOLD=1 for deliberate service.

`npm run verify` builds dist and proves the starter in Chromium.
Use acceptance, frontend:proof or probe:check alone only for a targeted rerun; verify names the red phase.
Passing direct acceptance/frontend runs are reused for unchanged source in the same builder session.
Keep the pre/post lifecycle hooks when replacing business commands.
Edit the marked business assertions in scripts/frontend-proof.mjs.
If you opted into the exhaustive packet, edit its frontend.assert callback instead.
New starters include `npm run day2:proof`, saved versions and id-based conservation
across two rollback/forward cycles. Add authenticated business assertions at
BUSINESS_ASSERTION_BEGIN; return deliberately v1-written table/id and changed-field lists there.
Mark deliberate deletes with deleted:true; the proof checks they stay absent.
Existing apps can add it with `snapback4 init --adapt --day2 --apply`.
Set PORT_LO and PORT_HI at run time to confine proof servers and launchers.
Set CHROME=/path/to/chromium or install Playwright's Chromium.
