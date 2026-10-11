# Todos: a Snapback 4 web starter

A Vite + React app over a local-first Snapback 4 backend: one table, one live
query and three mutations. It works offline and syncs when the link returns.

```sh
npm install
npx snapback4 check      # compiles snapback/schema.q, writes snapback/generated/api.ts
npx snapback4 dev        # serves http://127.0.0.1:4400 and reloads on save
npm run dev              # in a second terminal: http://localhost:5173
```

Choose "Continue as a guest", then add a few todos. Open a second tab to see
live updates; stop the backend to see writes queue offline and settle when it
returns.

## Files

- `snapback/schema.q`: the backend (tables, rules, `sync`, queries, mutations).
  Edit it and `snapback4 dev` re-adopts it; `snapback4 check` regenerates the API.
- `src/client.ts`: one `createApp` for the whole app. A browser app that writes
  passes `device: webDevice()`; a bare `createClient()` in a browser refuses
  mutations with `E_ADMISSION`.
- `src/App.tsx`: sign-in, the live list (`usePage`) and writes (`useMutation`).

## Next steps

- Grow the schema: `npx snapback4 guide language`, then `guide rules`, `guide sync`.
- Try operations from the terminal: `npx snapback4 run add '{"title":"milk"}' --as alice`.
- Test with fixtures: `npx snapback4 guide testing`.
- Add email accounts: change `use identity` to `use identity password` and see `guide auth`.
- Ship: `VITE_SNAPBACK_URL=https://your-backend npm run build` builds `dist/`
  with an offline app shell (`snapback4 web-shell dist`); serve it over HTTPS.
- A complete multi-screen example: `npx snapback4 init <dir> --web --template chat`.
