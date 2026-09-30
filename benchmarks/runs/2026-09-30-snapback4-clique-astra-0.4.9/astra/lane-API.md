# Clique custom-client API

Use Node 24, `snapback4@0.4.9`, and this app's generated `snapback/generated/api.ts`. Run `npm install` and `npx snapback4 check` from this checkout. The backend URL for this lane is `http://127.0.0.1:49360`. Clients use Snapback's native authenticated protocol; the example receives updates by polling. No application service token is needed.

```js
import { login } from 'snapback4/auth';
import { createClient, mintId } from 'snapback4/client';
import { api } from './snapback/generated/api.ts';
const auth = await login(url, email, password);
if (!auth.ok) throw Error(auth.why.message);
const client = createClient({url, session: auth.session});
// Alternatively, an already-issued user bearer:
// const client = createClient({url, token: accessToken});
```

Signup uses `signup(url,email,password)` from `snapback4/auth`; then `saveProfile` claims a unique handle. Password sessions last seven days. Tokens authorize exactly their principal under Quarry rules, not every conversation. `client.refreshSession()` exchanges a live token for a successor; use the session returned by `client.session()`/`onSession` to retain rotation. `client.signOut()` revokes the current session; `client.logoutAll()` revokes every session for the user. `close()` only closes the client and does not revoke the bearer. Never publish tokens in logs. A bare-token client can refresh into a full session. Local and app clients preserve pending writes separately from login state.

```js
const inbox = await client.query(api.inbox, {c: null});
if (!('data' in inbox)) throw Error('Inbox unavailable');
// Each row: conversation (ID), chat (kind/title/description/config),
// peer (the other member in a DM), and this user's membership positions.
// Follow inbox.next with the c argument to list every conversation.
const target = inbox.data.find(x => x.chat.title === desiredName);
// Names need not be unique; retain the selected opaque conversation ID.
const history = await client.query(api.apiHistory, {
  conversation: target.conversation, c: null
});
if (!('data' in history)) throw Error('History unavailable');
const latest = history.data[0]; // newest server ordinal first
const older = history.next ? await client.query(api.apiHistory, {
  conversation: target.conversation, c: history.next
}) : null;
const id = mintId(), writeId = mintId();
const sent = await client.mutate(api.send, {
  id, conversation: target.conversation, text: 'Hello', quote: null
}, {id: writeId});
if (sent.state === 'failed') throw Error(sent.why.message);
// pending is custody, not authoritative success. Poll client.write(writeId)
// when retaining an explicit write ID, or subscribe to client.onWrite.
```

To receive messages, poll the newest `apiHistory` page every second and deduplicate by message ID. Continue `next` until reaching a known ID if more than 20 arrived. Ordering follows server-assigned `ordinal`; timestamps are server milliseconds. The raw `history` operation exposes the same stored fields without aggregate decorations. Reads can be loading, denied, partial, or ready: inspect `data`, `complete`, `fresh`, `next`, and `cut`; an empty incomplete result does not prove absence. History is protected by current membership; a custom online client cannot fetch departed chat history. A replica may retain previously delivered history under the app's rules.

`apiHistory` exposes these fields per message:

| Field | Meaning |
| --- | --- |
| `id`, `conversationId`, `senderId` | Opaque entity and principal IDs |
| `ordinal`, `serverTimestamp` | Server arrival order and time |
| `type` | `text`, `image`, or `video` |
| `text` | Text or caption |
| `mediaId`, `photo`, `video`, `oncePhoto`, `viewOnce` | Asset reference, metadata and one-view flag |
| `edited`, `tombstone` | Edit and delete-for-everyone flags |
| `replyToId` | Quoted original's ID, or null |
| `reactions` | `{emoji,count,mine}` aggregate chips |
| `receipt` | Own-message `sent`, `delivered`, or `read`; null for others |
| `expiresAt` | Server deadline or null |

Use `client.asset(mediaId)` to fetch authorized media; release the returned handle with `revoke()`. A view-once fetch consumes the caller's sole grant, so never automatically retry an ambiguous result or cache its bytes. Cleared/deleted/expired media returns `E_ASSET_UNKNOWN`; a second one-view fetch returns `E_ASSET_VIEWED`. Message text is limited to 2,000 characters, captions to 500; video duration is at most 60 seconds. `editMessage`, `deleteMessage`, `setReaction`, and `setDisappearing` enforce rules and configured server deadlines. `setReaction` takes an emoji or null and is a set-state intent.

Run the complete headless example with `CLIQUE_EMAIL` and `CLIQUE_PASSWORD`, or `CLIQUE_TOKEN`, in the environment:

```sh
node scripts/custom-client-demo.mjs
```

Optional `CLIQUE_CONVERSATION` selects a chat ID; `BACKEND_URL` selects another instance. It authenticates, lists chats, pages history, sends a message and verifies receipt by polling. It prints no bearer. The caller must already belong to a chat.
