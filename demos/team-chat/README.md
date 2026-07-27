# team-chat

`team-chat` is the Slack/Discord-shaped pressure app for LLP 0063 Step 6.
Unlike `chat-matrix`, which compares one AI conversation across authoring
stacks and providers, this app pressures Snapback's application-platform
semantics: protected rooms, membership changes, fan-out, unread state, and
pagination.

The current checkpoint is deliberately local and incomplete. It proves a
bounded product kernel on `local-dev-sqlite-ibex`; it does not satisfy
`STEP6.CHAT`.

## Run the local checkpoint

```sh
node packages/snapback-codegen/index.mjs demos/team-chat/snapback
node demos/team-chat/tests/acceptance/headless.mjs
bun install --cwd demos/team-chat/surfaces/react
bun run --cwd demos/team-chat/surfaces/react typecheck
bun run --cwd demos/team-chat/surfaces/react build
node demos/team-chat/tests/acceptance/react-browser.mjs
```

The headless suite boots an isolated real Snapback server, loads the committed
generated artifacts, and drives the product through the ordinary client. The
browser suite opens three independent Chrome windows against the local React
surface and exercises the same authority transitions through product forms.
Set `SNAPBACK_SERVER_BINARY` when the current Snapback binary is not in the
default target directory.

## What this checkpoint exercises

- a room and its owner membership are created atomically;
- an owner invites another principal, who cannot read the room until accepting;
- an accepted member receives room messages and a recipient-owned inbox row;
- one message fans out atomically to a preregistered 32-recipient cohort;
- unread state is live and can be cleared room-at-a-time;
- recipient-owned inbox rows use opaque keyset continuation cursors; and
- self-leave revokes room reads, removes retained inbox rows for that room, and
  prevents subsequent sends.

The React surface uses the official `useSnapbackQuery` adapter and generated
API references. It exposes local development personas for the owner, invited
member, and unrelated outsider; that switcher is test scaffolding, not an
authentication claim.

The private membership table is the authorization source. `roomParticipants`
is ordinary display/fan-out data updated in the same mutations, but it is never
consulted as permission.

## Honest boundary

[`pressure-profile.v1.json`](./pressure-profile.v1.json) is the fail-closed
ledger. Search, attachments, notifications, moderation/audit, hosted
authentication and operations, full channel-history pagination, and the
complete cross-surface product UI remain red. The local React witness is only a
partial implementation of the admitted kernel; it is not a hosted or Contract
surface claim. Draft LLPs 0071–0073 cannot be replaced by application-local
approximations.
