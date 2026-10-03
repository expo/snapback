# Clique custom-client API

Use Node 24. From a clean checkout, run `npm ci`, `npx snapback4 check`, start `npx snapback4 dev --port 49360`, and seed starter segments m1, m2, m3 (`npm run seed -- --segment m1`, etc.). The exact SDK is `snapback4@0.4.11`; generated operation handles live in `snapback/generated/api.ts`. No service token is needed or appropriate for a user client.

Authentication uses `import {login, signup} from 'snapback4/auth'`. `await login(url,email,password)` or `signup` returns `{ok:true,session}` on success, otherwise a refusal. `session.token` is the bearer access token and `session.principal` identifies its user. Built-in password sessions expire after seven days. Calling the authenticated client’s `logoutAll()` revokes every session for that user; app sign-out revokes its current session when connected; possession of an old token does not restore it. Keep tokens private and transmit over HTTPS outside local development. Each session is scoped to one principal; every operation applies the same membership and ownership rules as the app. Offline cached access follows the documented replica revocation boundary: a disconnected device cannot learn a new revocation until reconnecting. Expiry deadlines already learned remain enforced offline.

## Token-only example

```js
import {customClient} from './scripts/custom-client.mjs';
const client = customClient('http://127.0.0.1:49360', process.env.CLIQUE_TOKEN);
try {
  let cursor = null, target;
  do {
    const page = await client.conversations(cursor);
    target = page.data.find(row => row.chat?.title === 'Weekend Plans');
    cursor = page.next;
  } while (!target && cursor);
  if (!target) throw Error('Conversation not found');
  const page = await client.history(target.conversation);
  console.log(page.data[0]); // latest authorized message
  // Older history: client.history(target.conversation, page.next), until next is null.
  await client.send(target.conversation, 'Hello from another client');
} finally { client.close(); }
```

`conversations(cursor=null)` returns `{data,next}`. Each membership includes `conversation`, role, seen/delivered watermarks, `chat` metadata, and peers with profiles. Iterate every non-null cursor; cursors are opaque and query-specific. `history(conversation,cursor=null)` returns newest-first pages of 50. Membership join floors and removal rules apply. A newly joined user does not receive messages from before joining. Previously delivered retained history may remain locally on removed clients; fresh API reads require current authority.

Each history message exposes `id`, `conversationId`, `senderId`, `serverTimestamp` (Unix milliseconds), `type` (`text`, `image`, `video`, `view-once`), `text` (body or caption), `media` (asset reference or null), `edited`, `tombstone`, `replyToId` (or null), `reactions` (`{emoji,count,mine}`), and `receipt` (`sent`, `delivered`, `read` for your own messages; null otherwise). Original backend fields are also preserved. The raw query is `api.apiHistory` with `{conversation,c}`; `scripts/custom-client.mjs` supplies the normalized field manifest and caller reaction aggregation. Deleted rows are tombstones without original content; expired rows disappear. Asset references are not public URLs: use the authenticated SDK asset fetch, which enforces current grants, expiry, and view-once consumption.

`send(conversation,text)` accepts 1–2000 characters, generates a stable ID for that invocation, waits for authoritative settlement, and returns the message ID. For application-managed retries use `createClient({url,token})`, `mintId()`, and `client.mutate(api.send,{id,conversation,text,quote:null},{id:writeId})`, preserving both IDs until settled. Set-state reactions and likes use `api.react` and `api.setLike`; never invert a toggle when retrying.

Delivery is **documented polling** for this custom interface: query the newest history page every second while foregrounded, deduplicate by message ID, and page until the last known message if a burst fills one page. Re-query visible rows for edits and reactions. The web/native app separately uses SDK subscriptions and reports delivered/seen through the generated receipt family. A background API poll does not claim the user actually read a message.

Run `node scripts/custom-client-demo.mjs` after seeding to exercise authentication, conversation listing, history paging, send, and receipt of the sent message by polling. Set `BACKEND_URL`, and either `CLIQUE_TOKEN` or `CLIQUE_EMAIL`/`CLIQUE_PASSWORD`. Default credentials are the fixture Alice account, for local acceptance only. The demo is intentionally a write: it adds one labeled message.
