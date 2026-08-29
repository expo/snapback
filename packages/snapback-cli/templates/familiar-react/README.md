# Snapback Familiar React starter

A minimal React + Vite web app whose backend starts in Snapback's Familiar
TypeScript profile: `schema.ts`, a `todos.ts` function module, generated
`api.todos.*` references, and `useQuery` / `useMutation` from
`@expo/snapback-react/familiar`.

```sh
bun install
bun run dev         # terminal 1: backend; writes .env.local
bun run dev:client  # terminal 2: Vite client
bun run prove   # the acceptance command (writes .snapback/verify-receipt.json)
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

## Extending or ejecting acceptance

Keep journey intent and product assertions in `acceptance.mjs`. The public
`@expo/snapback-acceptance` package owns server lifecycle, readiness, session
minting, bounded retries, cleanup, and starter receipt compatibility; the
verify config derives its path registration from the same declaration. Extend
the journey with generated-operation path tokens plus `step`, `until`, and
`defer`. To replace process management, supply the documented v1 lifecycle
adapter; to eject fully, retain the documented v1 receipt contract and let
`snapback verify` admit it. The package README is the compatibility contract.

Read `AGENTS.md` before adding features. With the dev server running, the
served guide and capability index live at
`http://127.0.0.1:4287/_snapback/guide/index.md` (or run
`snapback guide <query>`).
