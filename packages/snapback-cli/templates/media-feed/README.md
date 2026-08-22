# Snapback media feed starter

An Expo (iOS/Android/web) paged photo feed with session-bound uploads,
thumbnail/display renditions, typed attachment, a live newest-page window, and
an older-page accumulator.

```sh
bun install
bun run generate  # regenerate after editing snapback/schema.mjs or functions.mjs
bun run dev       # supervised backend + Expo client
bun run prove     # registered acceptance; writes .snapback/verify-receipt.json
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

The registered acceptance covers retained live pages, session
upload/attachment, and both rendition deliveries.

Read `AGENTS.md` before changing asset policy or pagination. This public feed
does not claim that an assembled infinite list is retained across reloads, and
its append-only archive behavior is not suitable for feeds that need deletion
without explicit tombstones.
