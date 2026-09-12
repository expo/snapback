# Clique focused text API

This is the selected browser/text projection on Snapback3 0.0.1-experimental.0. It is not the full Clique API or a native iOS result. One ordinary SDK client in `src/client.tsx` owns auth, inbox, history, ancillary summary, reactions, receipts and writes. The test bridge `window.clique` exposes that same instance, not an extra reader.

Install with `npm ci`. The locked Snapback tarball must remain available at its exact lockfile path. Run `npm run check`, `npm run build:web`, then `node scripts/build-shell.mjs`. Start `node scripts/start-owned.mjs serve . 54900`. This records the owner PID in `evidence/server-pids.jsonl`; stop it with `node scripts/restart-owned.mjs PID`. Only assigned ports 54900–54919 are allowed.

For a fresh starter database, run `node scripts/seed-starter.mjs`. This signs up the eight frozen starter users and replays the selected starter actions with public mutations. It is a fresh-database loader, not an idempotent replay adapter: rerunning into a populated DB may reject existing IDs. Avatar bytes are omitted and six social media posts are labeled text. Passwords are the fixture credentials (`alice@example.com`, `Alice!Clique2026`, and analogously Bob/Carol). No media is stored. The server assigns mutation timestamps in epoch milliseconds.

## Authentication and tokens

```js
import {createClient} from 'snapback3/client';
const client=createClient({url:'http://127.0.0.1:54900',storage:false,live:false});
await client.ready;
const session=await client.auth.login('alice@example.com','Alice!Clique2026');
// session.token is a bearer token; session.principal.id is server-issued.
```

`signup(email,password)`, `login(email,password)`, and `logout()` are public SDK methods. Browser storage defaults to IndexedDB; `storage:false` is for the headless demo and does not promise restart persistence. Development fixture identities use `auth.persona('u0500')`, available only under `dev`; seed principals are `dev:u0500`, etc. Production `serve` disables persona auth.

Direct HTTP authentication is `POST /api/auth/login` with JSON `{email,password}`. Subsequent HTTP requests use `Authorization: Bearer TOKEN`. `POST /api/query` accepts `{op,args}` and returns the owner query result. The SDK is recommended for mutations: it supplies the immutable intent, schema hash and plan hash, persists before send, and recovers receipts. Never call `mutate` a second time merely because settlement is late.

## Pagination, history, send, receive

`conversations.inbox({c:null})` returns up to 50 authorized conversations. `messages.page({conversationId,c:null})` returns up to 200 text messages in ascending `(serverTimestamp,id)` order. Both use opaque `snapshot.next` as the next `c`. `messages.latest({conversationId})` returns the last message as an array of zero or one rows. Do not equate a first page with full history.

```js
let c=null;
do {
  const snapshot=await client.watch('messages.page',{conversationId:'d-alice-bob',c}).refresh();
  if (!snapshot.complete) throw Error('Resource not complete');
  console.log(snapshot.data);
  c=snapshot.next ?? null;
} while(c);
const operation=client.mutate('messages.send',{
  id:crypto.randomUUID(),conversationId:'d-alice-bob',
  text:'Hello',replyTo:null
});
await operation.durable;
const receipt=await operation.settled;
if(receipt.state!=='committed') throw Error(JSON.stringify(receipt));
```

The small starter pages support that strict path. Large paginated refreshes were observed to return fresh data and a next cursor with `complete:false`. `src/acquire.ts` therefore has an explicit diagnostic workaround: consume fresh arrays, retain each SDK completeness flag, follow every cursor, and verify IDs independently. That does not turn the SDK flag into a completeness claim or establish offline durability by itself.

With default `live:true`, subscribe to `client.watch(op,args)` and read its snapshot in the listener. With `live:false`, use `refresh()` for documented polling (for example every second). `query()` can read cached results and is not a forced HTTP request. `scripts/custom-client-demo.mjs` authenticates, lists every conversation page, traverses history, sends once, and polls by refresh to find exactly one copy. Run it with `node scripts/custom-client-demo.mjs`; optional environment: `CLIQUE_URL`, `CLIQUE_PERSONA`, `CLIQUE_CHAT`, `CLIQUE_EMAIL`, `CLIQUE_PASSWORD`, and `CLIQUE_DEV=1`.

To fetch the latest message of a named chat following this document, authenticate as above and call `await client.query('messages.latest',{conversationId:'g-starter'})`, or force a request with `await client.watch('messages.latest',{conversationId:'g-starter'}).refresh()` and inspect `.data`. Membership authorization applies to each query and mutation.

## Receipts, quotes, reactions, read state

`messages.send` preserves `replyTo`; the server requires that the quoted message belongs to the same conversation. `messages.fetched({conversationId,through})` acknowledges a recipient's fetched contiguous history through an actual server timestamp. `messages.viewed` advances the recipient's viewed and fetched watermarks. The app invokes viewed only when rendering acquired first-page history in an open conversation; a committed send alone never marks it delivered/read. These are authenticated, client-reported watermarks, not device-attested viewing, and receipt UI currently shows whether any other recipient has reached the watermark. Group all-recipient receipt completeness is not claimed.

`messages.receipts({conversationId})` returns per-user watermarks. `messages.reactions({conversationId,messageId})` returns populated rows; caller-own state is `row.userId===session.principal.id`. `messages.setReaction({messageId,emoji})` sets/replaces the caller's one reaction; `emoji:null` removes it. A unique `(messageId,userId)` index enforces one per user. The older `messages.react({messageId,emoji,active})` is retained as an exact set/clear fixture operation; replacing with a different emoji should use `setReaction`.

`conversations.unread` returns a last-200 summary page and the viewer's watermark. The app computes a count of other-sender rows newer than that watermark only when the complete resource has fewer than 200 rows; otherwise it displays Unknown. This is explicit client aggregation, not a stored counter. `conversations.unavailable` is an intentionally denied ancillary-resource diagnostic used by `?denyUnread=1`.

## Offline and declared data

The service worker caches only the versioned app shell, never API/auth responses. The SDK stores data and operations in IndexedDB. Tests actually disable browser network with Playwright, then close and reopen the page in that context. Pending sends use the original durable operation identity. Search is a text filter over the currently acquired conversation page; the starter DM/group fit entirely within one page. Global search and guaranteed complete offline large-dataset acquisition are not claimed.

## Insights and existing counters

`social.insights({today})`, where today is `Math.floor(Date.now()/86400000)`, computes six totals on the server and seven UTC-day post/like buckets. Post and new-like day values derive from authoritative server mutation time. Each aggregate is bounded at 100 rows: starter correctness only, not full-scale Insights. No persisted conversation message-count field or polls exist. Existing state consists of fetched/viewed watermarks, per-post day fields, and query-derived totals; unread is client-derived. Do not claim later addition of these existing fields as new M7 work.

## Snapshot handoff

Run `CLIQUE_PERSONA=alice node scripts/snapshot-export.mjs evidence/alice.json` (and Bob/Carol analogously). It exports every authorized conversation page and message with id, conversationId, senderId, serverTimestamp, type, text, caption, null media reference, edited/tombstone flags, replyTo, populated reaction rows with `mine`, and own-message per-recipient fetched/viewed state. No fields are inferred from a committed write except server acceptance. This is a runnable authenticated Node headless exporter. A coordinator can seed tombstones and receipt/reaction controls through a fresh development seed using the existing schema, then export each persona before the separate M7 session. This run does not launch M7.

The final browser client wraps the public `createIndexedDBStorage` adapter solely to timestamp loads/writes. It delegates data unchanged and adds no cache. `window.storageTimings` records durable write resolution and admitted message IDs. Acquisition also subscribes while an already-in-flight public resource is loading (15-second bounded wait), rather than treating that transient snapshot as a page. These are app coordination/instrumentation layers and are counted explicitly; no SDK code was patched.

A populated-reaction query originally lacked the conversation authorization prefix and returned an incomplete resource. The final `byScope: conversationId,messageId,id` index and required `conversationId` argument fix that authored query shape. This adds an app index; it does not change the platform. Existing index definitions were preserved after the owner refused a destructive index-shape successor. The final starter database uses the accepted additive schema.

## M7 updated text/web API (prepared database)

The prepared database is populated and migrated. **Do not run any signup/seed recipe or replace `.snapback3`.** Use ports 54900–54903 only in this lane. `m7/commands.jsonl` retains the exact commands used for this change; `m7/selected-results.json` is the M7 result, while root `selected-results.json` remains the immutable prior regression-selection authority.

`polls.create({id,conversationId,question,optionA,optionB,optionC,optionD})` creates a message whose `type` is `poll` and whose `text` is its question. The group must exist and the caller must be a member. Question length is 1–200 and each present option is 1–50. A and B are required; C and D are nullable, and D requires C. Thus there are exactly 2–4 options. Stable option IDs are `a`, `b`, `c`, `d`, scoped to the immutable poll ID. The same message ID identifies its poll record; the record also holds a typed `messageId` reference.

`polls.get({conversationId,pollId})` returns `{poll,mine,a,b,c,d}`. Counts are exact server-maintained `pollTallies` values, not capped range counts or client totals. `mine` is the caller's selected option ID. Subscribe through the existing client's `watch` or `useQuery` for live changes. `polls.vote({pollId,optionId})` upserts one `(pollId,userId)` row, setting the requested state. Repeating the same state does not toggle or add a vote. Invalid option IDs and nonmembers are rejected.

```js
const vote = client.mutate('polls.vote', {pollId, optionId: 'b'});
await vote.durable; // SDK journal survives page close/reopen
const receipt = await vote.settled;
```

The same SDK instance and unchanged IndexedDB adapter own the durable queue. The UI displays pending selection from `state.pending`; it does not synthesize tally votes. An offline shell must first have been acquired. Actual network-disconnected close/reopen was verified for both Alice and Bob with their original operation IDs; the recovered receipts are in `m7/final-api-audit.json`. Do not create another operation because settlement is late. Exact replay of an already accepted request is separately tested in `m7/poll-api-results.json`.

`conversations.settings({conversationId})` returns the stored conversation including `messageCount`. It is displayed under Chat settings. This new nullable integer column was installed additively by the supported owner. `conversations.backfillCount({conversationId})` sets it once from the server's non-tombstoned message range; it rejects an already initialized count and rejects 201 or more visible messages. The prepared database had two conversations with 6 and 9 visible messages; both chunks committed and an eight-persona census plus post-shutdown physical census verified complete coverage. The guard avoids silently backfilling a truncated result; larger databases need a separate migration strategy. No larger or reduced backfill mutation attempt occurred in this run.

New conversations initialize the field to zero. `messages.send` and `polls.create` atomically increment it with their inserted message and receipt. They reject an unbackfilled conversation. Existing text messages retain `type:null` in storage and export as `text`; new polls export as `poll`. No public delete/expiry/media workflow is added by this text-only change. There was no persisted message count before M7: the previously documented client-derived unread count, fetched/viewed watermarks, post/like day values and query-derived Insights totals already existed.

The public compatibility contract preserves terminal receipts across schema/program changes, but parks uncommitted work whose identity has changed. M7 changes both schema and mutation program identity. No old operation identity is rewritten, dismissed, or recreated. The withheld coordinator profile was not accessed or reconnected, and an unobserved old pending send is not claimed to succeed. Parked work is not automatic compatibility.

The immediate post-migration snapshots and full required-field coverage comparison are under `m7/`. `scripts/snapshot-export.mjs` now exports `m.type ?? 'text'`; all preexisting fields and persona-specific nested reaction/receipt data remain covered. Run `CLIQUE_PERSONA=alice node scripts/snapshot-export.mjs OUTPUT.json` only after starting the owner. The exporter is read-only. `m7/custom-client/check.mjs` is the separately installed Node API regression, including an independent Bob reader, not an extra application client.
