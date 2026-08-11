# Pointing Room

Pointing Room is planning poker built with Snapback and an Exact/Contract
surface. Each signed-in participant picks `1`, `2`, `3`, `5`, `8`, `13`, or
`?`; picks remain hidden until one participant reveals the round. The seeded
Planning and Platform rooms share one mounted screen whose Contract-owned
`activeRoomId` re-keys both durable live queries and ephemeral presence.

## The security boundary

Votes are durable rows, but clients never subscribe to those rows directly.
The `liveTally` JS live query reads `rounds` and `votes` and returns a computed
record for each vote. Its `value` is the stored value only when the round is
revealed or the row belongs to the caller; otherwise it is `null`.
`liveRound({ roomId })`, `liveTally({ roomId })`, and
`startRound({ roomId, topic })` all resolve the durable room on the server.
The tally's room-aware vote index and returned `roomId`/`roundId` provenance
make cross-room isolation directly assertable without exposing the vote table.

The Contract view branches on that server value: `null` renders the face-down
`?`, while a non-null value renders itself. Live Contract invariants keep the
masked and revealed node counts equal to the corresponding partitions of the
query result. Presence is separate ephemeral state and never contains a vote.

The durable bindings use `createSnapbackContractSurface` with
`keyedQueryScopes: true`; the descriptor list is an allowlist, while
`activeRoomId` supplies binding-time args. Exact owns canonical keyed identity,
refcounts, predecessor disposal, and late-delivery fencing. The published keyed
surface currently omits generated ephemeral links, so boot also creates an
ephemeral-only companion surface and merges only that missing link family.
Room selection, ephemeral subscription args, rated publication, and heartbeat
remain Contract expressions over `activeRoomId`; the companion composition is
host glue and is not presented as Contract-native provider boot.

## Verify it

From the repository root:

```sh
node packages/snapback-codegen/index.mjs demos/pointing-room/snapback

SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback \
  node demos/pointing-room/tests/acceptance/disclosure-invariant.mjs

bun install --cwd demos/pointing-room/surfaces/contract --frozen-lockfile
bun run --cwd demos/pointing-room/surfaces/contract build

SNAPBACK_RUNTIME_BINARY=/Users/ccheever/projects/snapback/target/debug/snapback \
  node demos/pointing-room/tests/acceptance/contract-browser.mjs
```

The disclosure test mints two independent session principals and asserts on
the raw bytes received by principal B: A's Planning value is absent before
reveal and present afterward, while a Platform vote never appears in the
Planning subscription bytes. The browser runner owns an isolated in-memory
backend, Vite dev server on unused ports, real session login, and headless
browser. It switches Planning → Platform → Planning without remounting, checks
the room-specific rows each time, and uses server inspection to prove that both
query subscription IDs are replaced at each transition.

The prebuilt binary can report a checkout-stamp mismatch when `main` has moved;
the runners deliberately surface that provenance warning and do not invoke
Cargo.
