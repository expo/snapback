# Snapback CRUD dashboard starter

A React + Vite project directory with relational team joins, list/detail/edit
flows, live detail updates, and replayable optimistic edits over a generated
Snapback backend.

```sh
bun install
bun run generate  # regenerate after editing snapback/schema.mjs or functions.mjs
bun run dev       # supervised backend + Vite client
bun run prove     # registered acceptance; writes .snapback/verify-receipt.json
```

`bun run prove` delegates to `snapback verify` and covers the relational
directory plus create, update, and delete paths. `bun run test:static` checks
the scaffold without starting a server, but is not acceptance evidence.

Read `AGENTS.md` before changing the starter. The seeded public project data
keeps a fresh scaffold usable without a sign-in UI; it is not a production
authorization pattern or a hosted-target claim.
