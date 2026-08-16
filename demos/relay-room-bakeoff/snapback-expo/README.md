# Relay Room — Snapback arm

An Expo Router messaging app backed by Snapback. It includes one-to-one and
group conversations, seeded users and messages, reactions, reply pointers,
image messages, typing presence, retained offline history, and a visible
test-persona switcher.

From the Snapback repository root, bootstrap the runtime once:

```sh
scripts/bootstrap-ibex-runtime
```

Then, in this directory, run `node scripts/dev-server.mjs --reset`. It binds
loopback and prints the `EXPO_PUBLIC_SNAPBACK_ORIGIN=… bun run start` command.
Omit `--reset` on subsequent runs to keep your messages.

Delivering Relay Room to a **physical iOS device** over the LAN is an
**unsupported workaround.** Snapback has no accepted iOS physical-device
development carrier. If you deliberately accept that limitation, set
`RELAY_ROOM_BIND_HOST=0.0.0.0`; the launcher prints the LAN origin and warns
that dev auth lets anyone on the network assert any identity. The simulator,
Android USB, and hosted release targets are the supported paths. The open
carrier decision remains in
[`issues/20260811-ios-physical-device-dev-carrier-decision-packet.md`](../../../issues/20260811-ios-physical-device-dev-carrier-decision-packet.md).

Run `node tests/offline-acceptance.mjs` for the two-boot proof: it saves a live
conversation, stops Snapback, creates a fresh client, and asserts that the
conversation is rendered with `freshness: "retained"`.

The persona switcher is explicitly a test-only seam. It passes IDs as public
operation arguments; it is not production authentication.
