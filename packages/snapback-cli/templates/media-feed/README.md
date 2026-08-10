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

`bun run prove` delegates to `snapback verify` and covers retained live pages,
session upload/attachment, and both rendition deliveries. `bun run test:static`
checks scaffold coherence only; it is not acceptance evidence.

Read `AGENTS.md` before changing asset policy or pagination. This public feed
does not claim that an assembled infinite list is retained across reloads, and
its append-only archive behavior is not suitable for feeds that need deletion
without explicit tombstones.
