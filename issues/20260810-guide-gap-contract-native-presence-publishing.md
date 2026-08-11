# guide-gap: presence recipe shows no Contract-native publishing

**Status:** Open
**Opened:** 2026-08-10 · **Severity:** P2 · **Area:** realtime · Contract/Exact adapter
**Related:** LLP 0011, Diary 0074, `demos/pointing-room`, `demos/graffiti`

## Problem

`guide/recipes/presence-cursors.md` and `guide/clients/contract-adapter.md`
describe generated ephemeral links as "subscribe + publish pairs", but neither
shows a Contract surface *publishing* an ordinary presence value. The adapter
page's only publishing material is pointer-channel rated publishing.

Building `demos/pointing-room` this cost a full wrong turn. The first pass
concluded that publishing ordinary `{ name, picking }` presence was **not**
expressible in Contract and wrote an imperative DOM-event/timer bridge in
`main.ts` that called the generated publish link. That conclusion was wrong:
the generated `roomPresence.publish.ts` descriptor does compose with a Contract
`pointerChannel`, a mount-time `publish(...)` task, an explicit `rate`, and a
`heartbeat`. The second pass deleted the host bridge entirely.

The working example exists (the Graffiti Contract surface plus Exact's channel
tests) but is not reachable from the presence recipe, so an author following the
documented path lands on host glue and reasonably believes that is the paved
answer.

## Desired resolution

- Add a Contract-native presence publishing snippet to
  `guide/recipes/presence-cursors.md`: the `pointerChannel` declaration, the
  mount task, the `publish ... rate= heartbeat= payload={...}` view clause, and
  how a scope change (here `activeRoomId`) re-publishes into the new scope.
- Cross-link it from the ephemeral-channels bullet in
  `guide/clients/contract-adapter.md`, which currently sends readers to the
  presence recipe that lacks the Contract half.
- State plainly that ordinary collection publishing is not pointer-only, since
  the current framing invites exactly the wrong inference.
