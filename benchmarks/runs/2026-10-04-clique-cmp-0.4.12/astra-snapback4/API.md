# Clique custom-client API

Use Node 24 and `npm install snapback4@0.4.12`. This app's `snapback/generated/api.ts` is the checked-in build output supplied with the demo (regenerate with `npx snapback4 check`). All requests use the native Snapback protocol over HTTP. Local development URL: `http://127.0.0.1:49360`. Use HTTPS when hosting remotely.

```js
import {login, logout, logoutAll, refreshSession} from 'snapback4/auth';
import {createClient, mintId} from 'snapback4/client';
import {api} from './snapback/generated/api.ts';
const url = 'http://127.0.0.1:49360';
const auth = await login(url, email, password);
if (!auth.ok) throw Error(auth.why.message);
const client = createClient({url, session: auth.session});
// An already-issued access token needs no password or principal claim:
// const client = createClient({url, token: accessToken});
```

Password signup/login issues a bearer session scoped to that one authenticated principal. Sessions expire after seven days; `session.expiresAt` is the authoritative expiry in Unix milliseconds. `refreshSession(url, token)` rotates and invalidates the old bearer atomically. `logout(url, token)` revokes that session; `logoutAll(url, token)` revokes every current session for the account. App logout clears local credentials and attempts server revocation; an offline logout cannot promise immediate server invalidation until its revocation reaches the backend. Never distribute service credentials to users. Tokens authorize exactly the same row policies as the first-party client. The demo reads credentials/tokens from environment variables and does not print them.

```js
const listed = await client.query(api.inbox, {c: null});
if (!('data' in listed)) throw Error(JSON.stringify(listed));
// Each item has conversation (id), chat {title,isGroup,...}, and peer for DMs.
// Follow listed.next with {c: listed.next} until null; pages contain at most 50.
const conversation = listed.data[0].conversation;
const latest = await client.query(api.apiHistory, {conversation, c: null});
// Newest first, at most 20. Continue older history using latest.next.
const older = latest.next
  ? await client.query(api.apiHistory, {conversation, c: latest.next}) : null;
const writeId = mintId(); const messageId = mintId();
const sent = await client.mutate(api.send,
  {id: messageId, conversation, text: 'Hello', quote: null}, {id: writeId});
if (sent.state !== 'sent') throw Error(JSON.stringify(sent));
```

To find a named group, page `inbox` and compare `item.chat.title`; titles are not unique, so retain the selected conversation ID. A DM peer is `item.peer.peer`; resolve it with `api.profileById({principal})`. You can also resolve `api.profile({handle:'bob'})`, then `api.directConversation({other:profile.principal})`. Never substitute a handle for a principal or conversation ID. Fetch the latest named conversation message by calling `api.apiHistory({conversation})` and taking `data[0]`. An empty authorized history is an empty array.

Receiving uses **polling**: every one second call the first `api.apiHistory` page, merge by stable message ID, and follow its older-page cursor until reaching a previously known ID. Polling the latest page alone can miss bursts larger than 20 messages. Updated messages retain IDs; periodically refresh displayed older pages for edits/reactions. `next` is an opaque cursor tied to the query and current generation; on cursor refusal restart at the first page. Reads expose `data`, `next`, `complete`, `fresh`, and possible `cut`, or a `denied` refusal. Never treat incomplete results as a corpus total. Terminal failed writes include `why.code` and `why.message`; retry a lost outcome with the same write ID and same arguments, not a new message ID. `waitSeconds:0` means custody, not authoritative success.

History field manifest (every returned message):

| Field | Meaning |
|---|---|
| id, conversationId, senderId | Stable message, chat, principal IDs |
| serverTimestamp, ordinal | Unix milliseconds and server arrival order within chat |
| type | `text`, `image`, `video`, or `view-once` |
| text | Text body or media caption |
| media | Asset metadata/reference or null; fetch with `client.asset(media.id)` |
| edited, tombstone | Edit marker and delete-for-everyone marker |
| replyToId | Quoted message ID or null |
| expiresAt | Server deadline or null; expired rows disappear from history |
| reactions | Up to 50 distinct emoji/count groups; `reactionSummary` pages any further groups |
| ownReaction | Caller’s emoji or null |
| receipt | For caller’s own messages, normal receipt state; null when not applicable |

A once asset's first fetch consumes that principal's grant; revoke the returned handle on viewer close, never persist bytes. Second fetch is `E_ASSET_VIEWED`. Revoked, expired, or unauthorized bytes refuse `E_ASSET_UNKNOWN`. The server enforces membership, edit/delete windows, expiry, media bounds, and mutation permissions independently of the client.

`node scripts/custom-client-demo.mjs` exercises authentication, conversation paging, message-history paging, send, and polling. Optional variables: `CLIQUE_BACKEND_URL`, `CLIQUE_TOKEN`, `CLIQUE_EMAIL`, `CLIQUE_PASSWORD`, `CLIQUE_CHAT_ID`. Demo defaults use the seeded Alice account. Close with `await client.close()`; this stops the connection but does not revoke its login.

Additional read operations use the same authenticated client and read envelope:

| Operation | Arguments | Result |
|---|---|---|
| `api.home`, `api.global` | `{c?: cursor}` | Following or Global activity cards, 20 per page |
| `api.trending` | `{c?: cursor}` | Top ten original posts in the server's trailing 24 hours, likes descending then newest |
| `api.insights` | `{}` | Caller’s six lifetime totals, server `at`, and seven UTC `days` with zero buckets |
| `api.people` | `{q, c?}` | Case-folded word-prefix profile search |
| `api.searchMessages` | `{q, c?}` | Newest authorized message matches with chat title/sender name |
| `api.searchChat` | `{conversation, q, c?}` | Message matches within one chat |
| `api.followState` | `{principal}` | Follower/following totals and caller’s follow state |
| `api.followingPeople` | `{principal, c?}` | Followed principals, 50 per page |
| `api.roster` | `{conversation}` | Current members, roles, and profiles |
| `api.messageById` | `{message}` | Authorized message or null |
| `api.reactionSummary` | `{message, c?}` | Emoji/count groups, 50 per page |
| `api.unreadCount` | `{member}` | Current unread count for a membership ID returned by inbox |

Insights fields are `posts`, `likesReceived`, `repostsReceived`, `repliesReceived`, `followers`, `following`, `at`, and `days`; each day contains integer UTC `day` (Unix day ordinal), `posts`, and `likesReceived`. All totals are computed by the backend, never by client corpus paging. Refresh the query to obtain a new snapshot.
