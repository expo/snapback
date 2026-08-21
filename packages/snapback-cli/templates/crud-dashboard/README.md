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

<!-- script-glossary:begin -->
## Script glossary

`bun run prove`: ordinary completion and the only done-oracle—the authoritative
aggregate `snapback verify` receipt (acceptance evidence, not formal proof).
`npm test`: raw acceptance implementation that `prove` wraps (debugging).
`bun run test:static`: no-server source/generated coherence.
`bun run carry:headless`, `bun run carry:web-browser`: observation artifacts after accepting the `prove` receipt,
never proof authority. `bun run carry:self-check` checks carrier wiring only.
Migration: `test:live` was removed; use `npm test` for the same raw acceptance command.
<!-- script-glossary:end -->

The registered acceptance covers the relational directory plus create, update,
and delete paths.

Read `AGENTS.md` before changing the starter. The seeded public project data
keeps a fresh scaffold usable without a sign-in UI; it is not a production
authorization pattern or a hosted-target claim.
