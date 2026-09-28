# Clique custom-client API

The local server is `http://127.0.0.1:49360`. Deployments supply their own HTTPS base URL. Every operation enforces the caller's user identity and membership. You need only an access token and HTTP JSON; generated TypeScript handles are an optional convenience. The runnable Node example is `scripts/custom-client-demo.mjs` (Node 24, `npm install` from this directory).

## Authentication

POST `/auth/login` or `/auth/signup` with JSON `{ "email": "...", "password": "..." }`. Successful replies contain `session: {principal,kind,token,expiresAt}`; failures contain `denied: {code,message,...}`. Password signup requires 8–1024 Unicode characters subject to a 1024-byte limit. Password sessions normally expire after seven days; `expiresAt` is authoritative Unix milliseconds. Keep the bearer private. Send `Authorization: Bearer TOKEN` on all other requests. A token represents exactly one user and gives no service authority. Issuing a token means authenticating through login; do not mint service tokens for clients.

POST `/auth/logout` with `{}` and that bearer to revoke its session family. POST `/auth/logout-all` with `{}` revokes every session of that user. Expired or revoked tokens fail authentication. Logging out through Clique retires the app's bearer; independently issued sessions survive ordinary logout and die on logout-all. For long-running integrations, reauthenticate after expiry. The app's SDK handles its own session renewal; third-party clients need not implement rotation.

```sh
CLIQUE_EMAIL=alice@example.com CLIQUE_PASSWORD='Alice!Clique2026' node scripts/custom-client-demo.mjs
# Or CLIQUE_TOKEN=... CLIQUE_CHAT_NAME='Weekend Plans' node scripts/custom-client-demo.mjs
```

## Queries and pagination

POST `/q/OPERATION` with `{ "args": ARGUMENT_OBJECT }` as its JSON body. A successful read is `{data, complete, cut, next?, ...}`. `next` is an opaque cursor: pass it as `c` with otherwise identical arguments. Continue until `next` is absent/null. `complete:false` discloses a partial/limited answer, not a definitive absence; narrow the query or continue when a cursor exists. Refusals are `{denied:{code,message,...}}`.

| Operation | Arguments | Data |
| --- | --- | --- |
| `myProfile` | `{}` | caller profile or null |
| `people` | `{q,c:null}` | profiles, word-prefix over name/handle |
| `inbox` | `{c:null}` | up to 50 caller membership rows, each with `conversation`, `seenOrdinal`, `deliveredOrdinal`, and `chat` metadata |
| `roster` | `{conversation}` | current members and their profiles |
| `apiHistory` | `{conversation,c:null}` | newest 20 messages, followed by older cursor pages |
| `message` | `{id}` | one authorized message or null |
| `messageReactions` | `{message}` | raw per-user reactions |
| `searchIn` | `{conversation,q,c:null}` | newest word-prefix matches in this chat |
| `searchNewest` | `{q,c:null}` | newest matches across current chats |
| `searchGrouped` | `{q,c:null}` | chat groups with match previews |

To fetch the latest message of a named conversation: page `inbox` until `row.chat.title` matches, take `row.conversation`, then call `apiHistory` with that ID and `c:null`; `data[0]` is the newest message. DMs have `chat.kind:"dm"`; resolve the other member's name through `roster` if choosing by person. Do not use `groupNamed` for exhaustive discovery.

Every `apiHistory` message has:

| Field | Meaning |
| --- | --- |
| `id`, `conversation`, `sender` | stable message, conversation and user principal IDs |
| `at`, `ordinal` | server Unix milliseconds and per-chat arrival order |
| `type` | `text`, `image`, `video`, or `view-once` |
| `text` | body or caption; empty on deletion |
| `media` | null or asset reference with `id`, MIME/type, byte size and server-established media facts |
| `photo`, `video`, `oncePhoto` | explicit nullable media homes |
| `edited`, `tombstone` | edit flag and deletion marker |
| `quote` | replied-to message ID or null; same chat only |
| `reactions` | `{emoji,count,mine}` grouped chips; one reaction per user |
| `receipt` | caller-owned message: `sent`, `delivered`, or `read`; otherwise null |
| `expiresAt` | nullable server deadline; expired messages are absent |

## Writes and delivery

POST `/m/send` with `{id: WRITE_ID, args:{id: MESSAGE_ID, conversation, text, quote:null}}`. Generate IDs with `mintId` from the pinned `snapback4/client` package. Write IDs are idempotency keys: retry an uncertain write with the **same** ID and arguments. Success is `{state:"sent",id,seq,result}`. A replay says `replayed:true` and omits the historical result; query current state instead. Failures say `{state:"failed",why:{code,message,...}}`. Do not turn a transport failure into a new write ID. Text limit is 2000 characters; media captions 500.

Receive messages by polling `apiHistory` every 1–2 seconds while viewing a chat, deduplicating by message ID and reconciling edits/deletions. Page older history separately. The demo uses this documented polling path; it does not depend on a private socket protocol. SDK users may instead `observe(api.apiHistory,{conversation},callback)` for reactive updates.

Clients may POST `/m/delivered` with `{conversation,from,through}` covering an actually received contiguous ordinal interval, and `/m/seen` with `{conversation,through}` covering messages actually displayed. Both use the same write envelope. `progress` returns the caller's receipt prefix, runs, and bounded ahead page. Receipt rules exclude later joiners and removed members; never fabricate delivery for unseen gaps.

## Media, configuration and offline behavior

POST `/assets` with authenticated raw file bytes, then pass `{id:response.asset.id}` to `sendMedia` with `photo`, `video`, or `oncePhoto` (exactly one non-null), plus `id`, `conversation`, and `text`. GET `/assets/ID` with the bearer serves authorized bytes. Ordinary media permits Range. View-once media refuses Range, is never durably cached, and the second fetch by a principal returns 410. Fetch it only on explicit open, hold its transient handle above the message list, and release on close. Deletion, expiry, or loss of authorization revokes media. Image limits are 10 MB; video 50 MB and 60 seconds.

`configureChat` accepts optional `title`, `description`, `color`, and `disappearing` (`off`, `24h`, `7d`). Group configuration requires admin status. `placeBackground` accepts an uploaded `background`. TTL changes apply to future messages. The fixture profile uses 60-second edits, 120-second deletion, and 180/300-second expiry; `node scripts/configure.mjs production` restores the brief's production windows. Expiry is server-enforced without clients.

`searchHeld` and `searchInHeld` are **device-only** queries used by the replica; the server refuses them. They search retained history and disclose its limited horizon. The Expo/web app uses the package's durable outbox for offline writes, explicit set-state likes/reactions, and ordinary viewed-media retention. Raw HTTP callers must keep their own durable write IDs when offline.

The push provider seam logs JSON lines to `evidence/push.jsonl`, with payloads emitted transactionally by Quarry and delivered by `scripts/push-worker.mjs`. Message pushes contain `targetUserId`, `chatId`, `senderDisplayName`, and `preview`; media previews are `Photo`/`Video`. The worker uses effect ID as its provider idempotency key. Only a service bearer may claim effects. Replay uses the published `dev --replay` mode to suppress both effects and schedules.

## Insights, Trending, and scheduled digests

`insights` with `{}` returns the caller's six server-computed totals (`posts`, `likesReceived`, `repostsReceived`, `repliesReceived`, `followers`, `following`), `at` (server milliseconds), and seven `days` entries. Each day has a UTC epoch-day integer, `posts`, and `likesReceived`, including zeros. Posts counts mean original, non-removed posts; received reactions include the user's authored post entities. `trending` with `{}` returns up to ten original posts from the trailing 24 hours, ordered by like count descending and then newest first. Both operations can be refreshed with another query; clients do not page the corpus to derive their totals.

`digest.json` records the active schedule configuration. `node scripts/configure.mjs shortened` selects the fixture's two-minute periods; `production` selects daily periods anchored at 08:00 UTC. Run `snapback4 check` after configuring and restart a production deployment with the resulting schema. The job fires without app clients. A digest counts new active follow edges, new original posts by the recipient or currently followed authors, and currently unread, non-tombstoned, unexpired, in-period messages from other people in current memberships. `newPostsInFollowing` includes self, as the Following feed does. Payloads with all-zero counts are omitted. Emission is deduplicated by recipient and period end; the worker also deduplicates provider delivery by effect ID. A missed schedule boundary coalesces according to the published scheduler behavior. `dev --replay` holds schedules and permanently suppresses replay effects.
