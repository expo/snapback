# Clique client API

Use Node 24, the exact `snapback4@0.4.7` dependency, and this checkout's generated `snapback/generated/api.ts`. Install with `npm ci`, then run `npx snapback4 check` to generate the typed operation descriptors from the included Quarry files. Run the Quarry backend on an allowed local port with `npx snapback4 dev --port 49360`. The public SDK protocol is the supported API; these instructions do not require service or database credentials.

Sign up or sign in in the web app. In your own authenticated browser console, `await window.clique.session()` returns your issued user session, including `token`. Keep it secret. The password provider issues user-scoped sessions valid for seven days; refresh rotates a live session, and server logout/revocation invalidates its token. The app's Log out action clears local credentials and requests server logout. An offline logout cannot revoke a remote token until the server receives the request. A client's `close()` releases resources without logging out. Membership and ownership rules apply to every request, independent of the client.

```sh
CLIQUE_TOKEN='<your token>' SNAPBACK_URL=http://127.0.0.1:49360 node scripts/custom-client-demo.mjs
```

Optionally set `CLIQUE_CONVERSATION` to a conversation ID. The demo requires an existing conversation, lists conversations, reads history (including a second page when available), sends a message, and polls to receive it. It does not print the token.

```js
import { createClient, mintId } from 'snapback4/client';
import { api } from './snapback/generated/api.ts';
const client = createClient({url: 'http://127.0.0.1:49360', token: process.env.CLIQUE_TOKEN});
const rooms = await client.query(api.chat.inbox, {c: null});
// Ready reads have data; otherwise handle loading/denied and retry loading.
const room = rooms.data.find(r => r.chat?.title === 'Weekend Plans');
const page = await client.query(api.chat.apiHistory, {conversation: room.conversation, c: null});
const latest = page.data[0]?.message; // newest server ordinal first
const older = page.next ? await client.query(api.chat.apiHistory,
  {conversation: room.conversation, c: page.next}) : null;
const write = await client.mutate(api.chat.send, {
  messageId: mintId(), conversation: room.conversation, text: 'Hello', quote: null
});
// Pending is durable custody in the app, not server success. Poll client.write(write.id)
// until sent or failed; never resubmit a new ID for an unknown outcome.
await client.close();
```

`chat.inbox` pages 50 memberships using `c`/`next`; each entry includes `conversation`, `chat` (kind, title, description, customization), and `other` for DMs. To find a named group beyond the first page, continue `next`. For a DM, match `other.handle`. History pages 20 newest first; each entry contains `message`. Its fields are:

| Field | Meaning |
|---|---|
| id, conversationId, senderId | Stable opaque identifiers |
| serverTimestamp | Server time, milliseconds since Unix epoch |
| type | `text`, `photo`, or `video` |
| text | Body or media caption; empty for a tombstone |
| media | Authorized asset reference or null; use `client.asset(media.id)` on explicit open |
| viewOnce, expiresAt | Single-view flag and optional server expiry |
| edited, tombstone | Edit and deletion state |
| replyToId | Quoted message ID or null |
| reactions | Entries `{emoji, count, mine}` for the caller |
| receipt | `sent`, `delivered`, or `read` for own messages; null for others |

Delivery of new messages uses **polling**: query the newest history page periodically (the demo polls every 200ms for its bounded check; an application can use one second), reconcile by stable ID, and follow cursors for any missed interval. Re-read existing records to see edits, tombstones, reactions, and receipts. Do not treat a partial read (`complete: false`) as exhaustive. The raw online Node client has no durable offline store; use the app's replica client for offline custody.

View-once assets must be opened only on explicit user action, never prefetched or persisted. Release the returned asset handle on close. Expired or revoked references cease to authorize bytes; never retain them in a private persistent cache. `chat.apiHistory` itself does not fetch or consume media. The backend enforces membership, edit/delete windows, asset access, expiry, reaction uniqueness, and receipts. A third-party client must report delivery/seen only for content it actually received/displayed; the app's replica handles delivery and its foreground conversation reports `chat.seen`.
