# Clique custom-client API

Use `snapback4@0.4.8` from npm with Node 24.18.0. The live development base is `http://127.0.0.1:49360`; a deployed base must use HTTPS. All operations enforce the same principal and membership rules as the Expo app. No service token is needed or appropriate for a third-party client.

```js
import {createClient, mintId} from 'snapback4/client';
import {login} from 'snapback4/auth';
// Omit login if the account has already issued you its access token.
const auth = await login(baseURL, email, password);
if (!auth.ok) throw Error(auth.why.message);
const client = createClient({url: baseURL, token: auth.session.token});
const query = name => ({kind: 'query', name});
const mutation = name => ({kind: 'mutation', name, predicts: 'eligible'});
```

Password signup/login issue one-user bearer sessions. Ordinary password sessions expire after seven days. The first-party app rotates live sessions through the published auth API and stores them in the device's session store. A token-only third-party client must receive a renewed token or sign in again before expiry. `logout(baseURL, token)` from `snapback4/auth` revokes that session immediately; account-wide revocation uses `client.logoutAll()`. Closing a client only releases resources; it does not log the account out. Never print or commit tokens/passwords. A revoked or expired bearer is denied even when it previously read a conversation.

Every query returns a `Read`: check for `data`, or handle `denied` / `loading`. Pages expose opaque `next` cursors; use `next`, not page length, to decide whether to continue. `complete: false` means incomplete coverage or a work bound and must not be presented as an exhaustive result. A cursor is scoped to its operation, arguments, authorization and order. Refresh from a null cursor after membership changes.

| Operation | Arguments | Data |
|---|---|---|
| `publicapi.conversations` | `{c: null or cursor}` | Up to 20 memberships: `{id, conversation, role}`. `conversation` includes title, kind, peerA/peerB, settings. |
| `publicapi.history` | `{conversation: id, c: null or cursor}` | Up to 20 messages, newest ordinal first. |
| `publicapi.reactionChips` | `{message: id, c: null or cursor}` | Paged `{emoji, count, mine}` summaries. |
| `messaging.send` | `{id: mintId(), conversation: id, text, quote: null or messageId}` | Mutation receipt; successful initial result is the message ID. |
| `messaging.searchChat` | `{conversation, q, c}` | Word-prefix matches within a chat, newest first. |
| `messaging.searchGrouped` | `{q, c}` | Pages of current memberships with newest-first matching previews; use this for large chat collections. |
| `messaging.search` | `{q, c}` | One newest-first stream, including locally retained history; may refuse an opening bound for very large membership sets. |
| `messaging.roster` | `{conversation}` | Current members with roles and public profiles. |
| `messaging.seen` | `{conversation, through: ordinal}` | Advances the caller's account-wide read watermark. |

History's message-object fields are `id`, `conversationId`, `senderId`, `serverTimestamp` (Unix milliseconds), `ordinal`, `type` (`text`, `image`, `video`, `view-once`), `text` (body or caption), `media` (asset facts or null), `edited`, `tombstone`, `replyToId`, `expiresAt`, `reactions`, and `receipt` (`sent`, `delivered`, `read` for the caller's own messages; null for others). Embedded reactions contain the first 50 emoji groups; follow `publicapi.reactionChips` to exhaust unusually large historical reaction sets. Every count is exact for its emoji. Tombstones carry no body/media. Expired messages are absent. Retained history is a device capability, not authority to fetch content again after leaving.

List every conversation before looking up a name; titles need not be unique. DMs have kind `dm` and stable peer principal IDs. For a named group:

```js
let c = null, matches = [];
do {
  const r = await client.query(query('publicapi.conversations'), {c});
  if (!('data' in r)) throw Error(JSON.stringify(r));
  matches.push(...r.data.filter(x => x.conversation?.title === wantedName));
  c = r.next;
} while (c);
// Resolve ambiguity explicitly if matches.length !== 1.
const latest = await client.query(query('publicapi.history'), {
  conversation: matches[0].id, c: null,
});
if ('data' in latest) console.log(latest.data[0] ?? null);
```

Send one intent with a stable **write ID** distinct from its entity ID:

```js
const id = mintId(), writeId = mintId();
const args = {id, conversation, text: 'Hello', quote: null};
const receipt = await client.mutate(mutation('messaging.send'), args,
  {id: writeId, waitSeconds: 30});
if (receipt.state === 'failed') throw Error(receipt.why.message);
// 'sent' is authoritative success. 'pending' is not success.
// Retry an uncertain acknowledgement with the same writeId and args.
// A replay may confirm execution without repeating its historical result.
```

Text is capped at 2,000 characters; media captions at 500. Server arrival determines timestamps and ordinals. Optional `photo`, `video`, and `oncePhoto` arguments take uploaded `{id}` asset references and cannot be mixed. `client.upload(blob)` returns `{ok, asset}`; only its uploader can place an asset, once. `client.asset(assetId)` returns a revocable URI handle or `denied`. Close handles with `revoke()`. Once photos permit one fetch per principal and are never durably cached; deletion, expiry and membership loss revoke byte access.

Receiving in the standalone demo uses **polling**, not a hidden stream: request the first history page periodically, deduplicate by message ID, and page farther if more than 20 messages may have arrived. Opening a visible foreground conversation may call `messaging.seen` after rendering its settled highest ordinal. Sending and polling do not fabricate another member's read state. The first-party replica owns delivery reports automatically; the online-only demo merely reads receipt states.

Run the complete headless example after `npm install` (no generated application types are required):

```sh
CLIQUE_TOKEN='<issued token>' CLIQUE_CONVERSATION='<id or exact title>' \
  node scripts/custom-client-demo.mjs
```

Alternatively provide `CLIQUE_EMAIL` and `CLIQUE_PASSWORD`. `CLIQUE_BACKEND_URL` selects a different instance. The demo authenticates or adopts a token, exhausts conversation pages, follows a history cursor when available, sends a message, and observes it by polling. It prints only its nonsecret verification summary.
