# Dx16 Dayone 0909b3eb 818f 4998 B92e C4a65a701c9f

A Vite + React app over the Snapback 4 backend in `snapback/*.q`, started from
the Snapback 4 web starter.

Offline: no table in `snapback/*.q` declares `sync`, so reads need the server.
Writes made offline are kept in this browser's principal journal and sent when
the link returns. Add `sync` to a table to read it offline
(`npx snapback4 guide sync`).

```sh
node scripts/install.mjs
npx snapback4 check      # compiles snapback/*.q, writes snapback/generated/api.ts
npm run backend         # serves http://127.0.0.1:4400 and reloads on save
npm run dev              # in a second terminal: http://localhost:5173
```

Sign up or sign in with email and password (`use identity password`); the SDK
keeps your session across restarts. See `snapback4 guide client --section password`.

## Files

- `snapback/*.q`: the backend (tables, rules, `sync`, queries, mutations).
  Edit it and `snapback4 dev` re-adopts it; `snapback4 check` regenerates the API.
- `fixtures/`: your rows as `fixtures/<table>.jsonl` and expectations in
  `fixtures/test.cases.jsonl`, for `npx snapback4 test --fixture fixtures`
  (`npx snapback4 guide testing`).
- `src/client.ts`: one `createApp` per app (or chosen persona). With no synced
  table it uses the browser principal journal; synced tables use `webDevice()`
  for offline reads and predictions. A bare browser `createClient()` refuses
  durable mutations with `E_ADMISSION`.
- `src/App.tsx`: the sign-in and `Home`, a screen to replace. It shows the
  viewer, your operations and your first query without required arguments,
  rendered with `matchRead`. Read with `useQuery(api.op, args)` or
  `usePage(api.list, args)` (a query that takes `c: cursor ?`), write with
  `useMutation(api.op)` (`npx snapback4 guide client`).
- `src/styles.css`, `index.html` (titled after this directory) and
  `vite.config.mts`: yours to change.

## Next steps

- Shapes most apps need (roles, two parties, booking, schedules):
  `npx snapback4 guide recipes`; one screen of forms: `guide cheatsheet`.
- Ship: `VITE_SNAPBACK_URL=https://your-backend npm run build` builds `dist/`
  with an offline app shell (`snapback4 web-shell dist`); serve it over HTTPS.
- A complete multi-screen example: `npx snapback4 init <dir> --web --template chat`.

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
