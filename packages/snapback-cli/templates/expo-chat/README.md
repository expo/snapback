# Snapback Expo chat starter

An Expo (iOS/Android/web) conversation app over a generated Snapback backend:
memberships, DM and group inboxes, replies, reactions, image upload via one
bound `send` command, and typing presence, in Sessions auth mode.

Sign-in is guest, password, or Apple/Google. The providers need no credentials
in development: `bun run dev:supervised` serves a local broker that issues
hermetic rehearsal identities — a working development sign-in, not an Apple or
Google login.

```sh
bun install
bun run generate   # regenerate after editing snapback/schema.mjs or functions.mjs
bun run dev         # terminal 1: backend; writes .env.local
bun run dev:client  # terminal 2: Expo client
bun run dev:supervised  # optional one-process Expo web supervisor
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

## Extending or ejecting acceptance

Keep journey intent and product assertions in `acceptance.mjs`. The public
`@expo/snapback-acceptance` package owns server lifecycle, readiness, session
minting, bounded retries, cleanup, and starter receipt compatibility; the
verify config derives its path registration from the same declaration. Extend
the journey with generated-operation path tokens plus `step`, `until`, and
`defer`. To replace process management, supply the documented v1 lifecycle
adapter; to eject fully, retain the documented v1 receipt contract and let
`snapback verify` admit it. The package README is the compatibility contract.

Read `AGENTS.md` before adding features — including its security caveat that
the client-supplied `senderId` is a seeded-persona demo convenience, not a
security boundary. With the dev server running, the served guide and
capability index live at `http://127.0.0.1:4287/_snapback/guide/index.md`
(or run `snapback guide <query>`).
