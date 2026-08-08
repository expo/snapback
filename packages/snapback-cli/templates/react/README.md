# Snapback React starter

A minimal React + Vite web app over a generated Snapback backend: one live
todo query, one mutation, and connection state, wired through
`@expo/snapback-react`.

```sh
bun install
bun run dev     # supervised backend + Vite client
bun run prove   # the acceptance command (writes .snapback/verify-receipt.json)
```

Read `AGENTS.md` before adding features. With the dev server running, the
served guide and capability index live at
`http://127.0.0.1:4287/_snapback/guide/index.md` (or run
`snapback guide <query>`).
