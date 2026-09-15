# M7 diary — Day-2 evolution (polls + backfilled counts)

## What you built
Group polls as a real message type on the Snapback 4 backend, plus a
visible-message count shown in chat settings. Backend (`snapback/schema.q`,
additive only): `kind: 'poll'` + `pollQuestion` on messages, new
`pollOptions` (stable client-chosen ids, `created messages[.messageId]`
insert rule so options can only be born with their poll) and `pollVotes`
(one row per user per poll, set-state upsert) tables synced to members,
`createPoll` / `pollVote` mutations with receipt + push fan-out mirroring
text sends, and `pollState` (per-option tallies, total, own vote) /
`convoMessageCount` (visible only: tombstoned filtered, expired
engine-absent, polls count) queries. App: `PollBlock` (optimistic pick +
pending via `onWrite`, kit `PollDisplay` carrying the contract IDs),
`PollCompose` creation in the chat screen, count line in chat settings,
API.md docs. Harness: m7 acceptance block (a01/a03/a04/a06/a07/a09, with
a09 re-running all seven prior suites), snapshot export/compare scripts,
choreo poll-setup script. Pre-M7 snapshot exported before any change;
post-M7 comparison INTACT; m7 suite 6/6, regressions 7/7, choreography m7
green first attempt (live tallies 3/3, offline vote settles).

## What felt easy
Quarry itself. The language card + README answered nearly every design
question before I asked it (upsert mirrors `reactMessage`, receipts/push
mirror `sendText`, the `created` probe mirrors membership creation), `check`
compiled the first full draft with only notes of pre-existing classes, and
`dev` re-adopted the additive migration live with all 86 seeded rows
intact. The frozen kit (PollDisplay/PollCompose with the exact contract
IDs, pending/selection semantics) meant zero pixel-pushing. The
at-most-once transport made the idempotency half of vote semantics free.

## What fought you
One genuine defect of my own: `at` in the pollVotes immutable list broke
vote changes (upsert bumps `at`; E_CONSTRAINT), caught by my own API probe
before any test existed — the sibling table showed the fix. Two test-draft
slips (count arithmetic, 5-option bound expectation) caught on re-read.
Environment friction: no `setsid` on macOS plus rejected `nohup`/`&` forced
runtime-managed servers, and a shared `/tmp` filename collided with another
lane's backend log. The `sm-poll-total` page-scoped selector forced real
care: exactly one live poll may exist in the choreo group, hence fresh
option ids per run + retire-old-polls setup with a fail-loud guard.

## A migration on this backend vs the alternatives
Compared to Rails/Django migrations or hand-written SQL deltas, Quarry has
no migration files at all: the schema is the migration, `dev` re-adopts
additively, and the `deploy` classifier (additive/rule/narrowing/
destructive) is the review. That is liberating for additive work (columns,
tables, enum variants just land; old rows read fine) and stricter where it
matters (the immutable/upsert interaction refused at runtime, not review).
The gap vs SQL: no filtered aggregates and no expiry hooks, so the
"visible count" is a read-time query rather than a maintained field — the
honest shape once you accept the engine owns expiry. I kept the raw
`messageCounts` maintain beside it rather than redefining a surface M6
clients already consume.
