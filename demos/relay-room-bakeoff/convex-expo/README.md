# Relay Room — Convex arm

The same Expo messaging brief implemented on Convex: DMs and groups, seeded
data, reactions, reply pointers, typing indicators, image uploads, offline
snapshot viewing, and an explicit test-persona switcher.

```sh
bun install
bunx convex dev
bunx convex run relay:seed '{}'
bun run test:offline
bun run start
```

`convex dev` writes the deployment URL to the ignored `.env.local`. The client
persists query snapshots through `expo-sqlite`'s localStorage adapter because
the Convex React Native client does not expose a documented durable offline
query cache. Writes are deliberately disabled offline instead of inventing a
second outbox protocol for this comparison.

As in the Snapback arm, the one-tap persona switch is a visibly labeled test
seam, not authentication. Mutations accept the selected user ID and verify
conversation membership; production code would derive identity from Convex
Auth instead.
