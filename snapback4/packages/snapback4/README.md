# snapback4

A scale-to-zero backend: Quarry declares your data and rules; typed clients read online or on a device, using the same Rust interpreter as the server. The package carries the TypeScript client and the CLI (prebuilt for macOS arm64 and Linux x64).

## Start here: a new app in five steps

Use Node 24. Coming from SQL or Convex: `npx snapback4 guide from-sql` (aliases: `sql`, `convex`, `rosetta`). Every Quarry example in this README and in `snapback4 guide` compiles in the suite; `npx snapback4 guide start` lists eight short patterns. **Backend first** (schema → check → test, then the client; a starter written after your schema fits it, so there is nothing to adapt):
```sh
npm install --save-exact snapback4 && npx snapback4 init   # writes only snapback/schema.q: edit it (guide cheatsheet)
npx snapback4 check                                        # until clean; notes carry rewrites; writes snapback/generated/api.ts
npx snapback4 test --fixture fixtures --as alice           # your fixtures/<table>.jsonl rows and fixtures/test.cases.jsonl
npx snapback4 init --web                                   # or --expo: sign-in (or persona picker) and a Home for your schema
```

1. **Install and scaffold.** In a new directory:
   ```sh
   npm install --save-exact snapback4
   npx snapback4 init --web      # or --expo; plain `init` writes only snapback/schema.q
   npm install
   ```
   For Expo, run `npx snapback4 init --expo`, then `npm install`: init writes the pinned Expo set. Adapter-first installs constrain RN 0.86.3 and compatible React 19; init plus `npm install` pins React/React DOM 19.2.3 and supplies the app/scripts. Upgrade with `npx snapback4@latest upgrade`, which aligns installed Expo packages. `PORT_LO`/`PORT_HI` at init bake the same ports printed and written; later runtime values override them through the npm launchers. Each starter is one screen over one table: a todo list with guest sign-in, a live query and three mutations. `init` never replaces a file (it only adds missing `package.json` entries) and never counts your `snapback/*.q` as a conflict; add `--skip-existing` to keep your other files and write only the missing ones. After you replace the starter's schema, `npx snapback4 check` names starter files that no longer fit it (the todo fixtures, a guest screen for a persona-only schema), and `npx snapback4 init --adapt` previews and `npx snapback4 init --adapt --apply` removes or rewrites them, never a file you changed (it keeps `fixtures/`, and replaces a Todos screen your schema no longer serves with a `Home` screen that compiles against any schema). The full reference chat app is `init --web --template chat` (or `--expo`); a messaging app is `npx snapback4 new my-social --template social` (`guide social`).
2. **Write the schema.** Edit `snapback/schema.q`: tables with rules, independent privacy invariants and `sync`, then queries and mutations. The todo starter states “only the owner may toggle completion” as `invariant todos.toggle only .ownerId = viewer`; do not copy the table rule as the specification; `guide security` shows spec intent and per-column audiences. Run `check` → `test` → `audit`: fixture-free campaigns synthesize per-role users, including password-only apps. Answer the rule questions and the unaccepted `snapback/generated/security-invariants.q.draft` from the product spec: for each role, which rows and columns may it read, and under which assignment, status or consent conditions? A coach role alone need not permit other coaches' athletes. Write those answers as independent read invariants, fix wider rules, then repeat `check` → `test` → `audit`. Keep a simple owner invariant when the spec confirms it. Start from `npx snapback4 guide cheatsheet` (one screen), then `guide language`, `guide rules` and `guide sync`; `guide recipes` has compiled roles (admin/staff/member), two-party, booking-capacity and schedule apps, while `guide rule-recipes` covers composite roles and blind child writers; a card over 240 lines or 12 KB prints content and a numbered index, so read one part with `--section <number>` or everything with `--full`.
3. **Check and serve.** `npx snapback4 check` names each problem with a rewrite (`npx snapback4 why <code>` explains one) and writes the typed `snapback/generated/api.ts`. `npm run backend` serves the URL printed by init and re-adopts the schema on every save; run the app beside it with `npm run dev` (web) or `npm start` (Expo). Call an operation as a development persona: `npx snapback4 run add '{"title":"milk"}' --as alice`.
4. **Seed and test.** Rows live in `fixtures/<table>.jsonl` and expected outcomes in `fixtures/test.cases.jsonl` (the starters ship both); `npx snapback4 test --fixture fixtures --as alice` runs them with no server. `npx snapback4 guide testing` shows both formats and an acceptance script over HTTP.
5. **Choose the client.** One constructor per kind of program; React hooks (`useQueryData`, `useQueryResult`, `useQuery`, `usePage`, `useMutation`, `useAuth`) come from `snapback4/react` (`guide client`). `usePage(api.list, args)` passes the cursor itself, so a paged query declares `c: cursor ?` and reads `after c` (`query list(c: cursor ?): return todos where .ownerId = viewer after c first 100 by .id`); `useQueryData` returns data/undefined and throws typed `QueryRefusal`; `useQueryResult` offers inline `why` and precise `read` (optional short screens: `guide client`). `useQuery` returns the precise `Read` (`matchRead`); use it for completeness/freshness decisions. Name hook results in props by the operation (`UseQuery<typeof api.op>`, `UsePage<typeof api.list>`, `UseMutation<typeof api.add>`); below the sign-in gate `useSignedInViewer()` is the never-null viewer; `sentResult(await add.run(args))` is a write's fresh result (`undefined` while pending, after a failure, or for a replayed receipt; the refusal is `isFailed`'s). The starters' `App.tsx` uses each. A schema with `use personas` and no `use identity` has no sign-in: act as a persona with `createApp({ url, persona: "alice", device })` (`guide personas`).

   | You are writing | Use | Notes |
   |---|---|---|
   | A Node script, seed or test | `createClient({ url, persona: "alice" })` from `snapback4/client` | Personas are development-only; for real users call `signup`/`login` from `snapback4/auth` and pass `{ url, session }`. |
   | A browser app | `createApp({ url, writes: "online", sessionStore: localStorageSessionStore() })` for server reads and writes; `createApp({ url, device: webDevice(), sessionStore: localStorageSessionStore() })` for synced tables; under `AppProvider` | **With no synced table, a browser app writes without a device** (including `createApp({ url, persona: "alice" })` on loopback dev): `createApp` journals each click synchronously in localStorage, sends it with its id, and the server runs it at most once (no offline reads, no predictions; `writes: "online"` chooses this with synced tables too). That page ships no wasm: 88,485 B gzip of JavaScript (274,853 B raw, measured writing page) against 2.5 MB (766 KB gzip) with `webDevice()`. Synced tables need the device: about 2.1 MB raw (679,418 B gzip) of wasm plus a ~24 KB worker, fetched when a session opens. A bare `createClient()` in a browser refuses every mutation with `E_ADMISSION`; a page that never writes needs neither. The `init --web` starter generates the client for your identity mode and synced tables. Missing journal APIs or incompatible write options refuse at construction; check `app.ready` for asynchronous schema/storage refusals. |
   | An Expo app | `createApp({ url, device: nativeAvailable() ? nativeDevice : undefined, sessionStore })` | The `init --expo` starter's `src/client.ts` selects `webDevice()` on web for synced tables, otherwise the browser write journal. Expo Go runs online. `npm audit` still reports an unpatched high advisory in Expo's `node-forge` code-signing dependency. Qualification warns under a dated exception, which fails when a patch ships or its recheck date arrives. Do not run `npm audit fix --force`, which downgrades Expo to SDK 44. |

## Build beyond the starter

The generated starter already contains a labelled form, live rows and a frontend proof. For a password profile with avatar uploads and a thread, follow [your first working account screen](./CLIENT-AND-OPERATIONS.md#your-first-working-account-screen). It includes the complete schema, client, screen, offline-shell and receipt examples.

## The whole model

Edit `snapback/*.q`. `check` and `dev` generate `snapback/generated/api.ts`; keep it available wherever runtime code imports it. Run `check` before typechecking or building a fresh checkout. A table holds data. Rules
authorize each row. Sync chooses what devices hold. A query states a predicate and order. A view derives data. A
mutation commits atomically. A job sweeps; an effect records external work. An asset follows its row's read rule.
`check` gives summaries; `check --verbose` adds rewrites and explanations.
For Exact apps mounted to this backend, `check` and `doctor` gate declared device
consumers: the device adapter requires its default wasm asset, and statically
declared custom device artifacts are identified by their embedded engine section.
An online adapter or a generated-operations-only mount requires no wasm. Real
devices still need a canonical embedded identity compatible with the public
schema's floor and capabilities; rebuild Exact with `bun exact.mjs snapback --rebuild`.
See `guide wire` for discovery scope and runtime admission. `check --cost` gives certificates: **constant**
(bounded work at any data size), **constant once background cleanup catches up**, or **grows with** a named
site. A constant verdict proves a degradation rule; timing one measures noise. Cite the verdicts in scale reports.

`complete` means the query answered its declared request within known coverage and execution limits. A full `first N` or `last N` is complete without a cursor. Indexes and job chunk sizes are chosen by the engine.
Streaming aggregates count a domain under the meter; maintained views read stored totals. A cut total is unavailable.
Jobs run as the system: select the recipient's authorized data before emitting. `once` prevents repeated emission;
declare `snapback/workers/push.mjs` and opt into `runWorker({ ledger: true, ... })` for durable completion deduplication; pass `meta.idempotencyKey` to the provider. See `guide maintains`, `guide jobs` and `guide effects` for recipes.

`await client.query(op, args)` returns a Read<T> envelope with `data`, `complete` and `existence`, or a refusal (never the bare rows); show partial results and refusals explicitly. Use `readPresentation(read)` from `snapback4/contract` for notices; [the complete screen](./CLIENT-AND-OPERATIONS.md#a-stable-conversation-screen) keeps an account/resource shell mounted. See `guide client` for the one-shot contract and `guide social` for the [tested bounded route-owner recipe](./CLIENT-AND-OPERATIONS.md#bounded-route-owned-observations). Import `usePage`, `useMutation` and `useAsset` from `snapback4/react`; use them with the generated `api` handles. `usePage` keeps loaded pages while the next loads; it supplies accumulated
items, `hasMore`, `loadMore` and read completeness. For generated queries returning source rows, it keeps one newest observed image per row ID; projections keep list semantics even when they contain a field named `id`. Both read hooks keep the same-key answer marked `revalidating` through refetch, reconnect, slow reads, offline transport and retry exhaustion, with no timeout. Local commits replace it directly after the replica re-read. Answers stay visible and `revalidating` until replaced unless change evidence may revoke a row; then the existing one-second withdrawal bound applies. Inserts and updates to non-policy columns retain the answer through slow or failed retries. Deletes and changes to authorization inputs retain the bound when the server supplies a known preservation list. Null or absent preservation evidence cannot certify revocation and leaves the previous answer visible while refreshing. This classification is automatic across local commits, online mutation acknowledgements, `/changes` and `/sync`. Successful immediate replica replacements never show `loading`. An older replica read cannot clear a pending notification; sync must apply its cut or a current server answer must replace the display. Offline ephemeral answers keep their original row expiry. Applied local membership removal withdraws the affected audience groups immediately, even before a staged page publishes. Older replica rows cannot return before publication. Local budgets exclude capacity queue wait; online revocation evidence includes it. `keep: false` withdraws immediately; `keep: true` adds a 30-second linger after the last subscriber. Key changes, deadlines, sign-out, credential, store and schema resets still withdraw. A reported program-generation change withdraws immediately, even with no changed tables; the old replica stays unavailable until adoption completes. Offline retention uses `fresh: false` and `since`; no profile identity latch is needed. `useMutation` tracks writes; `useAsset` resolves
a placed asset. Upload bytes with `client.upload` before passing the asset id to its placement mutation. Operations in `schema.q` are
`api.name`; module files use `api.module.name`. Effects run in declared Node 24 entries `snapback/workers/<service>.mjs` (`node` on PATH or `SNAPBACK_NODE`; Bun is not accepted, and dev exits at startup without it): dev and serve start, restart and stop them, with service tokens injected and logs redacted. `guide effects` shows `ledger: true` and the stable `meta.idempotencyKey`; a crash after the provider call but before the ledger commit still needs provider idempotency.

Public feeds share an activity union: Following delivers it to each reader; Trending ranks a finite time window (`npx snapback4 guide feeds`). Use the generated [`useFollowing` reader](./CLIENT-AND-OPERATIONS.md#following-history) for exact online history, preparation and live prepend; offline it keeps the inbox and reports that older posts are not on this device.

For a web-first tutorial, start with `npx snapback4 init --web` (or add
`--port-range 29000-29009`; PORT_LO/PORT_HI also work), then `npm install`,
`npx snapback4 check`, `npm run backend` and `npm run dev` in separate terminals.
The labelled Task form reads and writes your starter schema. Run `npm run build:web`
then `npm run proof:web`. The generated `scripts/frontend-proof.mjs` owns the
application assertions; edit them when replacing the starter screen.
Use `guide client` for password and role-gated screens; the [profile walkthrough](./CLIENT-AND-OPERATIONS.md#your-first-working-account-screen)
also works on web with createApp/localStorageSessionStore and ordinary HTML controls.

Never wait for `networkidle`: live queries hold a long poll. Use `domcontentloaded`,
wait for a labelled control, and await a fresh sent receipt for every write before rows;
text already on screen cannot prove the next write. RN-web: use pressSequentially,
accessible button labels (Button drops testID), then assert sent. See `guide testing`.

Security intent: declare invariants separately from rules; `guide security` covers `check`, `audit --json` and generated adversarial tests.

## Reference map: open only what the feature needs

`snapback4 guide <card>` and `snapback4 why <code>` answer in the terminal. Bare `guide` indexes the cards; `guide aliases`
lists words that open a card or one section (`guide pagination`). A card over 240 lines or 12 KB prints its opening, first section and a section index: `--section <number or words>` prints one, `--find <words>` greps it, `--full` prints all.
Every refusal names a code, site and rewrite.
Every Quarry example compiles in the suite; the language card also runs. The chat example is optional.
| Need | One reference lookup |
|---|---|
| Quarry grammar | `guide cheatsheet` (one screen) / `guide language` |
| Complete chat example / chat starters | `guide app` / [`init --web --template chat`](./CLIENT-AND-OPERATIONS.md#offline-web-starter) |
| Fields / indexes / rules / aggregates / totals (`count`, `sum`) | `guide types` / `guide indexes` / `guide rules` / `guide maintains` / `guide totals` |
| Reads / shapes / writes / helpers / chat receipts | `guide reads` / `guide shapes` / `guide writes` / `guide programs` / `guide receipts` |
| Device contents / prediction / acquisition costs | `guide sync` / `guide prediction` / `guide residency` |
| Following: `view following` / Global: planned view / Trending: predicate read / search | `guide feeds` / `guide search` |
| Identity / media / expiry / seeds / time and the dev clock | `guide personas` / `guide assets` / `guide expire` / `guide replay` / `guide time` |
| Typing / scoped presence | `guide ephemeral` / [Ephemeral writes](./CLIENT-AND-OPERATIONS.md#ephemeral-writes) |
| Background or network work (no directive) | `guide jobs` / `guide effects` (effect handlers) / `guide presence` / `guide native` / `guide services` (`mintSession`, `revokeSessions`) |
| Limits / failures / adoption / production upgrades and deploy / simulator proof | `guide bounds` / `guide refusals` / `guide evolution` / `guide deploy` / `guide witness`; `why <code>` |
| Client patterns / exports by subpath / auth / React list | `guide client` / `guide api` / [Client §4](./CLIENT-AND-OPERATIONS.md#4-the-client) / [React list](./CLIENT-AND-OPERATIONS.md#react) |
| Development and wire | [§5](./CLIENT-AND-OPERATIONS.md#5-development) |
| Release | [§6](./CLIENT-AND-OPERATIONS.md#6-release) |
| Expo | [§7](./CLIENT-AND-OPERATIONS.md#7-expo) |
| Exclusions | [§8](./CLIENT-AND-OPERATIONS.md#8-not-in-this-release) |
| Actions, routes and action-bound identity (`use server`) | `guide actions` / `guide routes` / [SERVER.md](./SERVER.md) (OIDC bound-session recovery is protocol-double-only; repaired-engine qualification is pending) |
Durable offline capture and placement: [OFFLINE-UPLOADS.md](./OFFLINE-UPLOADS.md) (`useUpload`, `uploadAndPlace`, typed retry/cancellation and the Exact adapter contract).
