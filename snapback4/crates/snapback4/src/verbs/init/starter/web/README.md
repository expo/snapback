# Todos: a Snapback 4 web starter

A Vite + React app over a local-first Snapback 4 backend: one table, one live
query and three mutations. It works offline and syncs when the link returns.

```sh
npm install
npx snapback4 check      # compiles snapback/schema.q, writes snapback/generated/api.ts
npm run backend         # serves http://127.0.0.1:4400 and reloads on save
npm run dev              # in a second terminal: http://localhost:5173
```

`snapback4 init --web --port 4401` points the client at that backend and serves
the page on the next port (4402); `--web-port N` picks the page's port, which
`vite.config.mts` holds for both `npm run dev` and `vite preview`.

Choose "Continue as a guest", then add a few todos. Open a second tab to see
live updates; stop the backend to see writes queue offline and settle when it
returns.

## Files

- `snapback/schema.q`: the backend (tables, rules, `sync`, queries, mutations).
  Edit it and `snapback4 dev` re-adopts it; `snapback4 check` regenerates the API.
- `fixtures/`: seed rows and expected outcomes for `snapback4 test`.
- `src/client.ts`: one `createApp` for the whole app. This synced todo schema
  uses `device: webDevice()`; a bare `createClient()` in a browser refuses
  mutations with `E_ADMISSION`.
- `src/App.tsx`: sign-in, the live list (`usePage`) and writes (`useMutation`).
  `usePage` passes the query's cursor itself: a paged query takes `c: cursor ?`
  and reads `after c` (`npx snapback4 guide reads`); any other query reads
  with `useQuery`. Props name hook results by operation (`UsePage<typeof
  api.list>`, `UseQuery<…>`, `UseMutation<…>`), and `useSignedInViewer()` is
  the viewer below the sign-in. After you replace the schema,
  `npx snapback4 init --adapt` previews; `npx snapback4 init --adapt --apply` swaps this screen for a `Home` that compiles
  against any schema, while it is unmodified.
- `src/styles.css`, `index.html` (titled after this directory) and
  `vite.config.mts`: yours to change; `.mts` keeps Vite's config ESM even when
  package.json says `"type": "commonjs"`.

## Next steps

- Grow the schema: `npx snapback4 guide language`, then `guide rules`, `guide sync`.
- Try operations from the terminal: `npx snapback4 run add '{"title":"milk"}' --as alice`.
- Test without a server: `npx snapback4 test --fixture fixtures --as alice` loads
  `fixtures/todos.jsonl` and runs the expectations in `fixtures/test.cases.jsonl`
  (`npx snapback4 guide testing`).
- Add email accounts: change `use identity` to `use identity password` and see `guide auth`.
- Ship: `VITE_SNAPBACK_URL=https://your-backend npm run build` builds `dist/`
  with an offline app shell (`snapback4 web-shell dist`); serve it over HTTPS.
- A complete multi-screen example: `npx snapback4 init <dir> --web --template chat`.
