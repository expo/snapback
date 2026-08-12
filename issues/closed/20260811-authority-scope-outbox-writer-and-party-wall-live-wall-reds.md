# Acceptance reds at main: authority-scope SNAPBACK_OUTBOX_NOT_WRITER; party-wall live-wall row empty

**Filed:** 2026-08-11 (ship run `llp0231-visibility-20260811`, Lane E1 verification)

Two acceptance suites fail on a bootstrapped worktree at base `952fcaa3a^`
(origin/main era 5c5f43db3), own binary, primed codegen:

1. `demos/card-game/tests/acceptance/authority-scope.mjs` — fixture install
   dies with `SNAPBACK_OUTBOX_NOT_WRITER` (client store single-writer
   ownership not held; `packages/snapback-client/rqs-store-file.mjs:477`).
   Possibly interaction with the recently landed writer-gate seam
   (LLP 0225 owner-#5) or another session's watchdog on this shared machine.
2. `demos/party-wall/tests/acceptance/headless.mjs` — 11/12; "the canonical
   handler attach lands the post on the live wall" gets `[]`.

Both reproduce identically at the pre-change base with the same binary, so
they are NOT caused by the asUser-kit extraction (landed on top). Confirmed by
an independent reviewer's parent-commit run as well. Needs triage: real main
red vs machine-environmental (fleet load / stale watchdog); reproduce on a
quiet machine, then fix-forward or close as environmental with the recipe.

## Resolution (round-2 triage, 2026-08-12)

The two reds had different causes.

### Authority scope — environmental shared RQS writer collision; fixed on main

`SNAPBACK_OUTBOX_NOT_WRITER` came from the JavaScript file RQS store's
per-`clientStoreId` writer lock. Concurrent acceptance processes reused the
deterministic `asUser:<email>` IDs and one correctly failed closed. This is not
LLP 0225 owner #5: that owner is the Rust server-global writer gate in
`src/server/writer_gate.rs` and shares no lock or custody path with the client
RQS file store.

Current main's `demos/_kit/as-user.mjs` fix (`48dde569d`, duplicate-history
landing `68acbda1c`) defaults `rqsStore` to `null`; tests that prove persistence
inject isolated stores explicitly. With this worktree's pinned bootstrapped
binary and primed codegen, authority-scope now exits 0 and prints:

```text
spawned snapback binary identity: pinned-binary-dirty-checkout
card-game real session live/authorized-retention proof: ok
```

### Party wall — real test timing bug; fixed in this worktree

Two current runs were 11/12 with:

```text
live wall row: expected [["Balloons up!","<asset-id>"]], got []
```

Spike trace showed mutation settlement preceding the scheduled subscriber
replacement/quarantine exit, as LLP 0200 permits. The test incorrectly assumed
one immediate `poll()` was enough. It now uses the harness `eventually` helper
and passes 12/12 with zero cleanup errors.

Reproduce with:

```sh
node packages/snapback-codegen/index.mjs demos/card-game/snapback
node packages/snapback-codegen/index.mjs demos/party-wall/snapback
SNAPBACK_RUNTIME_BINARY="$PWD/target/debug/snapback" \
SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback" \
  node demos/card-game/tests/acceptance/authority-scope.mjs
SNAPBACK_RUNTIME_BINARY="$PWD/target/debug/snapback" \
SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback" \
  node demos/party-wall/tests/acceptance/headless.mjs
```

Close the ticket when the contained party-wall test fix lands.
