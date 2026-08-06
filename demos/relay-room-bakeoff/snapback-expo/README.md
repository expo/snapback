# Relay Room — Snapback arm

An Expo Router messaging app backed by Snapback. It includes one-to-one and
group conversations, seeded users and messages, reactions, reply pointers,
image messages, typing presence, retained offline history, and a visible
test-persona switcher.

From the Snapback repository root, bootstrap the runtime once:

```sh
scripts/bootstrap-ibex-runtime
```

Then, in this directory, run `node scripts/dev-server.mjs --reset`. It prints
the phone-reachable `EXPO_PUBLIC_SNAPBACK_ORIGIN=… bun run start` command. Omit
`--reset` on subsequent runs to keep your messages.

Run `node tests/offline-acceptance.mjs` for the two-boot proof: it saves a live
conversation, stops Snapback, creates a fresh client, and asserts that the
conversation is rendered with `freshness: "retained"`.

The persona switcher is explicitly a test-only seam. It passes IDs as public
operation arguments; it is not production authentication.
