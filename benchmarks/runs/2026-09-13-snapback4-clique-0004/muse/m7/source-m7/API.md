# Clique custom-client API (Snapback 4 wire protocol)

Base URL: the value baked into the web client (`EXPO_PUBLIC_SNAPBACK_URL`,
this lane: `http://127.0.0.1:49300`). All JSON unless noted. Authenticated
calls carry `Authorization: Bearer <token>`. Refusals are
`{"denied": {"code", "family", "guide", "message"}}`; failed mutations are
`{"state": "failed", "why": {...}}` (retry with a fresh client-minted id —
see idempotency).

## 1. Accounts and sessions

| Call | Shape |
|---|---|
| `POST /auth/signup` | `{email, password}` → `{session: {token, principal, expiresAt}}`. Existing email: refused, then `login`. |
| `POST /auth/login` | `{email, password}` → `{session}`. |
| `POST /auth/refresh` | Bearer + `{}` → `{session}` fresh 7-day token. |
| `POST /auth/logout` | Bearer + `{}` → `{ok:true}` revokes that session now. |
| `POST /auth/logout-all` | Bearer + `{}` → `{ok:true, revoked:N}` revokes every session of the account now. |

Tokens live 7 days. Any use after `logout`/`logout-all` is refused
(`E_AUTH`); keep no copy after logout. The demo (`scripts/custom-client-demo.mjs`)
exercises signup → refresh → logout → refused-reuse → login.

## 2. Reads — `POST /q/<op>` with `{args}`

| Op | Args | Returns |
|---|---|---|
| `clock` | — | `{now}` server ms (use for day buckets, not the wall clock) |
| `appconfig` | — | window/TTL/digest-profile rows (edit `editWindow`, `deleteWindow`, TTLs, `digestProfile`, `replayMode`) |
| `me` | — | own profile + `followers/following/posts` counts |
| `profileByHandle` | `{handle}` | profile + counts, or null |
| `profileOf` | `{who}` | profile + counts, or null |
| `followEdge` | `{target}` | the follow row, or null |
| `recentUsers` | — | first 20 profiles (member-picker candidates) |
| `globalFeed` | `{c?}` | newest 20 posts + author/counts/`mine`/`myRepost`, `{rows,next?}` |
| `followingFeed` | `{c?}` | own 20 fan-out entries + post/author/counts + `ff` (follow edge) + `rp` (repost row); drop entries whose author was unfollowed (`ff` null and not self) and repost entries whose repost is gone (`repostId != postId && rp` null) |
| `profilePosts` | `{author, c?}` | that user's 20 newest posts |
| `thread` | `{postId, c?}` | `{post, replies}` (20 direct replies) |
| `postById` | `{postId}` | one post card, or null |
| `mediaOf` | `{postId}` | ≤4 `{image?, video?}` asset refs for a post |
| `trendingPool` | — | newest 200 `{id, authorId, at, kind, likeCount}`; client filters `at >= now-24h`, sorts likes desc then `at` desc, takes 10 |
| `insights` | — | server-computed totals (`posts/likes/reposts/replies/followers/following`) + 7 day buckets `postsD0..D6` / `likesD0..D6` (D6 = today UTC) + `now` |
| `inbox` | `{c?}` | 100 memberships + `chat` + `reads` (own watermark) + `count` (visible messages, see §5) |
| `chatDetail` | `{chatId}` | `{chat, members[] (+profile), count}` (visible messages, see §5; rendered in chat settings) |
| `threadMessages` | `{chatId, c?}` | 50 messages + author (oldest→newest page order) |
| `lastMessage` | `{chatId}` | 0–1 newest message |
| `quotedMessage` | `{messageId}` | one message + author, or null (hidden/gone) |
| `threadReactions` | `{chatId}` | ≤200 reaction rows for the chat |
| `threadPolls` | `{chatId}` | ≤100 polls for the chat as `pollCard`s: `{messageId, chatId, question, at, options[] ({optionId, label, tally}), total, mine}` |
| `pollOf` | `{messageId}` | one `pollCard`, or null |
| `threadReceipts` | `{chatId}` | ≤500 receipt rows for the chat |
| `typingFor` | `{chatId}` | live typing rows + typer profile |
| `typingMine` | `{c?}` | typing rows across my chats (chats-list hint) |
| `searchPeople` | `{q, c?}` | 20 profiles by word-prefix over display name + handle |
| `searchChat` | `{chatId, q, c?}` | 50 messages by word-prefix over text + caption |
| `searchAll` | `{q, c?}` | 50 messages across my chats, group client-side by `chatId` |

Cursor pages return `{rows, next?}`; pass `next` back as `c`. Responses
carry `complete`/`fresh` device flags; `fresh: false` means served from the
local store (offline).

## 3. Writes — `POST /m/<op>` with `{id, args}`

`id` is client-minted (uuid): a retried id settles the same way without
running twice. Every verb below is retry-safe: explicit entity ids use
insert-if-absent, toggles are set-state upserts/clears, creates resolve
before inserting.

| Op | Args | Effect |
|---|---|---|
| `saveProfile` | `{displayName, handle, bio?, location?, link?, avatar?}` | create-or-replace own profile; handle clash names the key |
| `setFollow` | `{target, state}` | follow/unfollow; follow backfills the author's capped history into the follower's Following feed |
| `createTextPost` | `{postId, body?}` | text post + fan-out |
| `createImagePost` | `{postId, body?, img1, img2?, img3?, img4?}` | 1–4 images (asset `{id}` refs) |
| `createVideoPost` | `{postId, body?, clip, poster?}` | ≤60 s / ≤50 MB video + still poster |
| `setLike` | `{postId, state}` | like/unlike → returns count |
| `setRepost` | `{postId, state, entryId?}` | repost/unrepost (pass own feed entry id when clearing) |
| `createReply` | `{replyId, parentId, body}` | reply (never feeds) |
| `dmResolveOrCreate` | `{other, chatId}` | resolve the pair's DM or create it with this id |
| `groupCreate` | `{chatId, title, description?, second}` | group + creator admin + second member |
| `memberAdd` | `{chatId, member}` | admin adds (idempotent) |
| `memberRemove` | `{chatId, member}` | admin removes |
| `memberPromote` | `{chatId, member}` | admin grants admin |
| `chatLeave` | `{chatId}` | leave (any member) |
| `setChatProfile` | `{chatId, name?, description?}` | admin-only; refused for DMs |
| `setChatTheme` | `{chatId, color, background?, clearBackground}` | any member; 8 palette colors |
| `setDisappearing` | `{chatId, value}` | `off`/`24h`/`7d`; DM: any member, group: admin |
| `sendText` | `{chatId, msgId, body, quoteId?}` | text + optional quote |
| `sendImage` | `{chatId, msgId, caption?, photo?, photoOnce?, viewOnce, quoteId?}` | normal or view-once photo |
| `sendVideo` | `{chatId, msgId, caption?, clip, poster?, quoteId?}` | video + poster |
| `setTyping` | `{chatId}` | keystroke ping (5 s expiry) |
| `reportReceipt` | `{messageId, state}` | 1 delivered / 2 read, monotonic |
| `markRead` | `{chatId, at}` | conversation-viewed watermark (shared across devices) |
| `setReaction` | `{messageId, emoji, clear, mutId?}` | set/replace/clear (one per user per message) |
| `editMessage` | `{messageId, body?, caption?}` | own text/caption inside the server-side edit window; refused for poll messages (`POLL_IMMUTABLE`) |
| `deleteMessage` | `{messageId}` | delete-for-everyone inside the server-side window; clears content + assets, keeps a tombstone |
| `createPoll` | `{chatId, msgId, question, optIdA, optA, optIdB, optB, optIdC?, optC?, optIdD?, optD?}` | group-only poll: question ≤200 chars, 2–4 options (id + label ≤50 chars each); idempotent on `msgId`; creates a `text` message (body = question) + poll rows; refused in DMs (`POLL_GROUP_ONLY`) |
| `setVote` | `{messageId, optionId, mutId?}` | cast/change one vote per user as idempotent set-state; retried intents converge; returns the option tally; refused for unknown options (`UNKNOWN_OPTION`), non-polls (`NOT_A_POLL`), deleted messages |

## 4. Uploads and assets — `POST /assets`, `GET /assets/<id>`

Upload raw bytes (`Content-Type: application/octet-stream`, Bearer [REDACTED] → `{asset: {id,
type, bytes, width?, height?, duration?}}`. Images ≤10 MB (JPEG/PNG/WebP,
sniffed); video ≤50 MB and ≤60 s (duration checked at send). The returned id
is placed exactly once by a later mutation (avatar, post media, poster,
chat background, message photo/clip). Unplaced uploads are swept.

`GET /assets/<id>` (Bearer) serves bytes. It is refused (`410 Gone`) for a
view-once asset after its one view (`E_ASSET_VIEWED`), and `404` for a
cleared (delete-for-everyone), replaced (old avatar/background), or expired
(disappearing) asset. Never cache a refused URL: re-fetching a revoked
asset stays refused.

## 5. Message-object field manifest (custom-client history)

`threadMessages` + `threadReactions` + `threadReceipts` compose the full
object. Per message: `id`, `chatId`, `authorId` (+`author` profile),
server timestamp `at`, `kind` (`text`/`image`/`video`), `body`/`caption`,
media refs (`photo`/`photoOnce`/`clip`/`poster` asset ids), `editedAt`
(edited flag), `tombstoned`, `quoteId` (resolve via `quotedMessage`),
`viewOnce`, `expiresAt`. Reactions: group `threadReactions` by `messageId`
→ `[{emoji, count, mine}]`. Receipts (own messages): group
`threadReceipts` by `messageId` over the member list at read time → `sent`
(no rows), `delivered` (every recipient ≥1), `read` (every recipient 2);
drop rows whose principal left before reaching the state. `pending`
device rows render as `pending`.

`count` (inbox/chatDetail) is the number of currently visible messages:
all message rows minus tombstoned (delete-for-everyone) ones; expired
(disappearing) rows vanish everywhere at once and stop counting then.
Polls are ordinary `text` messages (body = question) and count as
messages while visible. A poll's votes and tallies come from
`threadPolls`/`pollOf` (options with live `tally`, `total` over all
options, and `mine`, the caller's own vote row or null); join polls to
`threadMessages` by `messageId` and hide poll UI for tombstoned
messages. Receiving new polls/votes: poll for `threadPolls`, or watch
the sync stream (same rows sync to every member).

## 6. Sync protocol (for a from-scratch client)

`GET /sync?since=<cursor>` (Bearer) streams one JSON object per line:
`snapshot` (must replace everything), `keys` (must drop), `upsert`,
`delete`, `confirmed` (mutation ack with the client-minted id), `rejected`
(terminal mutation failure + sibling revocation listing every optimistic row
to roll back), `checkpoint` (persist `cursor`, resume here). Aim one
in-flight mutation per partition. `GET /probe` (200 + body) gates the
online/offline link bit. `GET /changes?watch=1[&wait=N]` is the live tail.
`GET /doctor` and `GET /meter` expose generation adoption and per-op cost.

## 7. Windows and expiry (server-enforced, server time)

Edit/delete windows and disappearing TTLs are read by the backend from the
`appConfig` table (`GET /q/appconfig`), seeded from
`config/windows.production.json` (production) or the fixture pack's
shortened config (grading). The client never computes a window: an edit
after the window is refused `EDIT_WINDOW_EXPIRED`, a delete
`DELETE_WINDOW_EXPIRED`, both against server time. Disappearing TTLs attach
`expiresAt` at send from the chat's current setting; the server sweep
deletes expired rows everywhere within about a second, and the tombstone
stream revokes them from every device cache.

## 8. Push seam

Message sends emit a `notify` effect per offline member
(`{targetUserId, chatId, senderDisplayName, preview}` — text sliced to 80
chars, `Photo`/`Video` otherwise); digests emit
`{targetUserId, kind: 'digest', periodStart, periodEnd, newFollowers,
newPostsInFollowing, unreadMessages, unreadChats}`. `scripts/worker.mjs`
claims the queue with a service token and appends one JSON line per
delivery to `push.log` — the seam a provider subscribes to. Effects queued
while the worker is down are delivered on claim (at-least-once);
consumers dedupe by `(targetUserId, chatId, preview)` / `(targetUserId,
periodStart)`.
