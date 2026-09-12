# Fresh-session handoff

The continuous-session artifact implements authenticated text chats, membership checks, quoted messages, reactions, fetched/viewed watermarks, explicit text acquisition and offline queued sends, plus starter-only server Insights. Do not launch M7 from this session.

Start the separately prepared starter owner on port 54902 as described in BUILD.md. Its existing database has DM `d-alice-bob` = 6 and group `g-starter` = 9 messages. The eight accounts use the frozen fixture credentials. All 52 starter social actions are retained, with six labeled media-to-text conversions. The main development/testing DB at the lane root contains many recorded correctness mutations; use the separate starter DB for the fresh-session controls.

Before changing anything, the coordinator should populate reactions and fetched/viewed receipt controls and a tombstone, then preserve fresh Alice/Bob/Carol exports with `scripts/snapshot-export.mjs`. The existing exporter includes all requested text-scope fields. Existing `evidence/fresh-starter-*.json` files are the pristine baseline; `evidence/*-handoff.json` are snapshots from the populated test DB and must not be mistaken for that pristine baseline.

No polls, votes, expiry scheduling or conversation message-count column have been added. Existing fields/indexes to preserve:

- `messages`: id, conversationId, senderId, text, serverTimestamp, replyTo, edited, tombstone.
- `reactions`: id, messageId, conversationId, userId, emoji; unique caller/message index and conversation-prefixed query index.
- `reads`: per-conversation/user fetchedThrough and optional viewedThrough watermarks. These express recipient acknowledgment, not merely server acceptance.
- `posts.day` and optional `likes.day` support starter UTC Insights. Lifetime totals are query-derived and bounded to 100. Unread is a client calculation from a bounded summary page; no persisted unread or conversation message counter exists.

The fresh M7 task must backfill visible counts from non-tombstoned messages in this same starter database, preserve populated fields, and add polls/votes separately. Expected selected controls remain DM6/group9, group10 after a poll, group11 after text, and Alice A→B plus Bob A→offline B gives A0/B2/total2 without retry duplication. Native Apple proof, media preservation and expiry remain unexercised omissions.

For regressions use the authored selected and control scripts with their explicit browser/text qualifiers. The selected driver records earlier failures and uses the explicit acquisition step before offline tests. A passing run does not erase earlier intermittent cold-reopen failures or the separate whole-read-batch network failure. Large hub acquisition was not completed within the deadline; do not block the small-state M7 change on that unrelated scale result.
