# TITLE

A Vite + React app over the Snapback 4 backend in `snapback/*.q`, started from
the Snapback 4 web starter.

OFFLINE

```sh
npm install
npx snapback4 check      # compiles snapback/*.q, writes snapback/generated/api.ts
npm run backend         # serves http://127.0.0.1:4400 and reloads on save
npm run dev              # in a second terminal: http://localhost:5173
```

SIGN_IN

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
