# Snapback Expo chat starter

An Expo (iOS/Android/web) conversation app over a generated Snapback backend:
memberships, DM and group inboxes, replies, reactions, image upload via one
bound `send` command, and typing presence, in Sessions auth mode.

```sh
bun install
bun run generate   # regenerate after editing snapback/schema.mjs or functions.mjs
bun run dev        # supervised backend + Expo client
bun run prove      # the acceptance command (writes .snapback/verify-receipt.json)
```

<!-- script-glossary:begin -->
## Script glossary

`bun run prove`: ordinary completion and the only done-oracle—the authoritative
aggregate `snapback verify` receipt (acceptance evidence, not formal proof).
`npm test`: raw acceptance implementation that `prove` wraps (debugging).
`bun run test:static`: no-server source/generated coherence.
`bun run carry:headless`, `bun run carry:web-browser`, `bun run carry:native-simulator`: observation artifacts after accepting the `prove` receipt,
never proof authority. `bun run carry:self-check` checks carrier wiring only.
Migration: `test:live` was removed; use `npm test` for the same raw acceptance command.
<!-- script-glossary:end -->

Read `AGENTS.md` before adding features — including its security caveat that
the client-supplied `senderId` is a seeded-persona demo convenience, not a
security boundary. With the dev server running, the served guide and
capability index live at `http://127.0.0.1:4287/_snapback/guide/index.md`
(or run `snapback guide <query>`).
