# Clique client API

Use Node 24.18.0 or newer and the published `snapback4@0.4.13` package. The native app uses exactly `snapback4-expo@0.4.13`. This is the Snapback typed protocol, not REST. All operations apply the caller's Quarry row rules. There is no service key in this client.

From a clean checkout: `npm ci`, then `npx snapback4 check` to generate `snapback/generated/api.ts`. Start the backend with `npx snapback4 dev --port 49360`. Use the app to sign up or sign in with email/password. An authenticated owner can obtain their bearer via the browser console: `(await window.clique.session()).token`. Treat that value as a password; do not commit or log it. Supply it through `CLIQUE_TOKEN`, and optionally `CLIQUE_BACKEND_URL` (default `http://127.0.0.1:49360`). Run `node scripts/custom-client-demo.mjs`. `CLIQUE_CONVERSATION` optionally selects an exact conversation ID or title.

Password sessions are issued to one principal, expire after seven days, and support atomic refresh. `client.refreshSession()` rotates a live token; use `client.onSession` to securely persist the successor if building a long-lived client. A bare-token online client has no owned session until refresh succeeds. `client.logoutAll()` revokes every session for that principal. App sign-out removes persisted local credentials and attempts remote logout; a remote refusal or revocation clears the session. `client.close()` only releases resources and does not revoke a token. Sign-out does not erase the SDK's account-scoped outbox. An offline device must reconnect before it can learn a remote revocation. Native credentials use SecureStore; the web app explicitly uses same-origin localStorage.

```js
import {createClient, mintId} from 'snapback4/client';
import {api} from './snapback/generated/api.ts';
const client = createClient({url: 'http://127.0.0.1:49360', token: process.env.CLIQUE_TOKEN});
const identity = await client.query(api.whoAmI, {});
const rooms = await client.query(api.inbox, {c: null});
```

Successful reads have `data`, `complete`, and optional `next` cursor. A refusal has `denied`; check it before consuming data. Preserve `complete: false` as incomplete, never infer absence from it. Pages are bounded. Follow `next` with identical query arguments plus `c: next` until it is null. Inbox rows expose `conversation`, `chat` (including title, kind, description, appearance, disappearing setting), and `peers` with profile information. To find a named conversation, page inbox and compare `row.chat.title`; names need not be unique, so retain the selected `row.conversation` ID. DMs can also be resolved with `api.directConversation({other: principalId})`.

```js
const history = await client.query(api.apiHistory, {conversation: roomId, c: null});
// Newest first; latest message is history.data[0] when the result is complete.
const older = history.next && await client.query(api.apiHistory, {conversation: roomId, c: history.next});
const id = mintId();
let write = await client.mutate(api.send, {
  id, conversation: roomId, text: 'Hello', quote: null,
  photo: null, video: null, oncePhoto: null
}, {id});
while (write.state === 'pending') {
  await new Promise(resolve => setTimeout(resolve, 100));
  write = await client.write(id) ?? write;
}
if (write.state === 'failed') throw Error(write.why.message);
```

A stable ID protects retries. `sent` is authoritative success; `pending` is not. The server assigns timestamp and conversation ordinal, validates membership, and captures the chat's current expiry setting. Do not backdate messages. `quote` optionally references an existing message in the same conversation. Text is at most 2,000 characters; media captions at most 500. The returned history order uses the server's conversation ordinal, breaking timestamp ties deterministically.

Every `apiHistory` message exposes: `id`, `conversationId`, `senderId`, `serverTimestamp` (Unix milliseconds), `type` (`text`, `image`, `video`, `once`), `text` (body/caption), `media` (`image`, `video`, `viewOnce` nullable asset descriptors), `edited`, `tombstone`, `replyToId`, `reactions` (each `emoji`, `count`, `mine`), and `receipt` (`sent`, `delivered`, `read` for the caller's own messages; null otherwise). Deleted messages retain a tombstone; expired messages are absent. Media descriptors are references, not permanent URLs. `client.asset(asset.id)` resolves an authorized handle or denial; release handles with `revoke()`. View-once access consumes the recipient's single opening and must never be persisted. Media is revoked when its home is cleared/deleted/expired or access is lost.

Receiving uses **polling**: query the first `apiHistory` page every second, merge by `id`, replace changed messages, and page back to the last observed ID if more than 20 arrived between polls. Reconcile expired/deleted records rather than retaining stale protected content. The demo polls for the message it sent. Third-party readers can acknowledge receipts using the generated `delivered`/`seen` operations, but only mark `seen` through messages actually visible to the user. The Expo app uses the SDK's receipt helpers and durable replica for this.

Profiles and posts are public to authenticated users. Conversation history, media, reactions and receipts require current membership. `api.whoAmI` proves token acceptance; a token is never sufficient to read another user's private conversation. `scripts/custom-client-demo.mjs` exercises identity, inbox pagination, two history pages when available, stable send settlement, and polling reception without browser or administrator access.
