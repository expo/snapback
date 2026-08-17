# team-chat

`team-chat` is the Slack/Discord-shaped pressure app for LLP 0063 Step 6.
Unlike `chat-matrix`, which compares one AI conversation across authoring
stacks and providers, this app pressures Snapback's application-platform
semantics: protected rooms, membership changes, roster reads, delivery custody, and
pagination.

The current checkpoint is deliberately local and incomplete. It is the LLP
0240 D3 server/codegen witness on `local-dev-sqlite-ibex`; it does not satisfy
`STEP6.CHAT`.

## Run the local checkpoint

```sh
node packages/snapback-codegen/index.mjs demos/team-chat/snapback
node demos/team-chat/tests/acceptance/headless.mjs
```

The headless suite boots an isolated real Snapback server, loads the committed
generated artifacts, and drives the product through generated references and
the ordinary client. Set `SNAPBACK_SERVER_BINARY` when the current Snapback
binary is not in the default target directory.

The prior React and Contract products are intentionally outside this
checkpoint: they still name the pre-profile mutations and display roster.
Generated references already work through the ordinary client and generic
React hooks; migrating those products and adding any dedicated per-profile
LLP 0238-shaped hooks remain open. They are not current evidence for this
revision.

## What this checkpoint exercises

- a room and its owner membership are created atomically;
- `api.roomMembersV2` contains the transition-derived `list`, `myRole`,
  `invite`, `join`, `leave`, `changeRole`, `transferOwner`, and `remove`
  references;
- the canonical `roomMembersV2` relation is the sole active authority and
  product roster, and the generated facade exposes neither raw rows nor ids;
  the v1 room/message/delivery declarations are retained inert because LLP
  0264 permanently refuses removal or same-push widening of installed table
  policies, and no current function reads or writes them;
- roster pages expose only `userId`/`role`, with an opaque cursor that refuses
  cross-scope and cross-caller reuse after role admission;
- pending membership remains non-enumerating;
- invite, join, role change, removal, leave, and owner transfer expose only
  durable post-commit authority transition receipts;
- owner transfer promotes the target and demotes the caller atomically; the
  exact two-plan kernel race pins `SNAPBACK_MUTATION_CONFLICT`, and a fresh
  generated roster read confirms exactly one owner; and
- message delivery reads the canonical roster through handler-side
  `ctx.authority.roomMembersV2.list`, while LLP 0264 limits the generic owner
  insert to one host-stamped sender row; cross-recipient fan-out stays red.

## Honest boundary

[`pressure-profile.v1.json`](./pressure-profile.v1.json) is the fail-closed
ledger. Search, attachments, notifications, moderation/audit, hosted
authentication and operations, the React/Contract product migration, and the
complete hosted product remain red. This server-side local witness makes no
dedicated per-profile hook, current React/Contract product, published-package,
or hosted-surface claim. Draft LLPs
0071–0073 cannot be replaced by application-local approximations.
