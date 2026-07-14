# Card game auth slice

This begins as a deliberately finite auth demo, not a complete game UI.
`myHand` is an authenticated ordinary query whose owner filter is
`authUserId()`. The acceptance runner starts a real sessions deployment,
mints two independent email-code credentials through the gated capture
mailbox, and proves that both callers receive disjoint hidden cards from the
same query. `acceptHandCard` is acceptance setup: it has no owner argument and
stamps each inserted row from the server-derived session principal.

Run the proof after codegen:

```sh
node packages/snapback-codegen/index.mjs demos/card-game/snapback
node demos/card-game/tests/acceptance/authority-scope.mjs
```

The finite gate demonstrates the item-7 boundary at the server: distinct real
credentials project distinct principals, and a raw request carrying a valid
bearer plus a forged legacy `auth` body is rejected with
`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`.

The next gate promotes `myHand` to a declared retainable live query and proves
item 8's lease-backed offline behavior. The finite proof remains separate so a
retention implementation cannot substitute for the basic session-isolation
claim.
