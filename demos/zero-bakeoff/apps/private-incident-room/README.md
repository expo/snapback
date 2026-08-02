# Private Incident Room

This paired app exercises protected partial sync: role-filtered read/write,
three live clients, revocation retirement, pending-write denial, user switching,
and out-of-band membership changes. The React surfaces expose matching test IDs
while the acceptance runners drive the provider-native headless clients.

From the repository root:

```sh
node packages/snapback-codegen/index.mjs demos/zero-bakeoff/apps/private-incident-room/snapback
SNAPBACK_SERVER_BINARY="$PWD/target/debug/snapback" node demos/zero-bakeoff/apps/private-incident-room/acceptance/snapback.mjs
bun demos/zero-bakeoff/apps/private-incident-room/acceptance/zero.mjs
```

The Snapback arm uses the real session-mode server, mailbox sign-in, generated
client, and WebSocket live queries. The Zero arm uses Zero 1.8.0,
`zero-cache-dev`, ZQL permissions, and an owned PostgreSQL database. It reads the
shared PostgreSQL URL from `demos/zero-bakeoff/.runtime/postgres/ready.json` and
deletes only its own database, slot, replica, and process tree. No hosted Zero
API key is required.

Machine-readable receipts are written under `evidence/`; the frozen checks are
in `../../protocol/acceptance/private-incident-room.v1.json`.
