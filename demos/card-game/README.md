# Card game auth slice

This is a deliberately finite auth demo, not a complete game UI. `myHand` is
an authenticated ordinary query whose owner filter is `authUserId()`, so Ada
and Grace receive disjoint hidden cards. `signalReady` is the small queued
mutation used to exercise authority-instance replay ownership.

Run the proof after codegen:

```sh
node packages/snapback-codegen/index.mjs demos/card-game/snapback
node demos/card-game/tests/acceptance/authority-scope.mjs
```

The proof demonstrates the item-7 boundary: refresh keeps the queue, a new
session for the same user retains principal-owned rows but strands the old
authority instance's queue, and switching users removes retained hidden rows.

It does **not** claim revocation-safe live delivery or offline presentation of
authorized query results. Those surfaces remain unavailable until the item-6
invalidation and item-8 lease work lands.
