# Clique custom-client API

Install `snapback4@0.3.0` with Node 24, retain this checkout's generated `snapback/generated/api.ts`, then run `node scripts/custom-client-demo.mjs`. Defaults exercise the installed Alice starter account and her Bob DM. Supply `SNAPBACK_URL` (default http://127.0.0.1:49360), `CLIQUE_TOKEN`, and optionally `CLIQUE_CHAT` to use any issued access token and conversation id. Without a token, use `CLIQUE_EMAIL` and `CLIQUE_PASSWORD`.

Signup/login use `signup(url,email,password)` and `login(url,email,password)` from `snapback4/auth`; success returns `{ok:true,session:{principal,kind,token,expiresAt}}`. Ordinary password sessions expire after seven days. The bearer grants only that user's table rules. Never share a service token. `logout(url,token)` revokes one token, `logoutAll(url,token)` revokes every session for the user. Clique's Settings logout uses logoutAll and removes the device session. `refreshSession` rotates and invalidates the old token; persist the replacement from the client's `onSession` if maintaining a long-lived client.

```js
import {createClient,mintId} from 'snapback4/client';
import {api} from './snapback/generated/api.ts';
const c=createClient({url:'http://127.0.0.1:49360',token:process.env.CLIQUE_TOKEN});
const rooms=await c.query(api.chat.inbox,{c:null});
// Read.data contains membership rows, each with conversationId and conversation.
// conversation.name, kind, roster[].profile.handle identify a named group or DM.
const conversationId=rooms.data.find(x=>x.conversation.name==='Weekend Plans').conversationId;
const page=await c.query(api.chat.history,{conversationId,c:null});
const latest=page.data[0]; // newest first; server ordinal order, at is server time
const older=page.next?await c.query(api.chat.history,{conversationId,c:page.next}):null;
const id=mintId();
const receipt=await c.mutate(api.chat.send,{messageId:mintId(),conversationId,body:'Hello'}, {id});
// receipt.state === 'sent' is authoritative. Retry the identical intent with id.
await c.close();
```

Both inbox (100) and history (50) are paginated: continue with `Read.next` until null. A failed read has `denied` rather than data; a failed write has state `failed` and `why.code/message`. Do not treat queued/pending as server acceptance. Receive using documented polling: repeat history's first page every 1 second, deduplicate ids and update existing messages; page backward until reaching a previously seen ordinal after a long absence. Alternatively `c.observe(api.chat.history,{conversationId})` exposes getSnapshot()/subscribe(listener); the SDK long-polls commits and refreshes the query. Close subscriptions and client when done.

History field manifest: `id`, `conversationId`, `senderId`, `at` (Unix milliseconds, server stamped), `ordinal` (server order), `kind` (`text|image|video`), `body` (text or caption), nullable asset refs `photo`, `oncePhoto`, `video` (id and metadata), `edited`, `tombstone`, nullable `replyToId`, `reactions` (`emoji`, `count`, `mine`), and `receipt` (`sent|delivered|read`, meaningful for your own messages). `sender` contains the public profile, `quote` contains the direct quote, `opened` indicates the caller's consumed once photo. Expired messages disappear; tombstones retain identity but have empty text and no media. `c.asset(asset.id)` performs an authorized fetch. Once photos allow one fetch per recipient; never persist their bytes. Cleared/expired refs cannot be fetched.

`chat.acknowledge({conversationId,through:messageId,viewed:false})` records delivery, and `viewed:true` records read, with monotonic watermarks. Only acknowledge messages actually received/viewed. `social.following`, `social.global`, `social.userPosts`, `chat.searchChat`, and `chat.searchAll` also use cursor `c`; search takes `q` and scoped search takes conversationId. Generated types are the complete operation catalog. No fixture persona header or administrator credentials are required.

## With only a token and this document

No generated file is needed for HTTP. All requests use `Authorization: Bearer <access-token>` and JSON. The live generated catalog can also be downloaded with authenticated `GET /api.ts`.

```js
const url=process.env.SNAPBACK_URL || 'http://127.0.0.1:49360';
const headers={Authorization:'Bearer '+process.env.CLIQUE_TOKEN,'Content-Type':'application/json'};
async function query(op,args){
  const r=await fetch(url+'/q/'+op,{method:'POST',headers,body:JSON.stringify({args})});
  const body=await r.json(); if(body.denied)throw Error(body.denied.message); return body;
}
let rooms=[],cursor=null;
do {const p=await query('chat.inbox',{c:cursor});rooms.push(...p.data);cursor=p.next;} while(cursor);
const room=rooms.find(x=>x.conversation.name==='Weekend Plans');
// For a DM use kind==='dm' and roster.some(m=>m.profile.handle==='bob').
const first=await query('chat.history',{conversationId:room.conversationId,c:null});
console.log(first.data[0]);
```

To send, install the pinned client for its id utility (`import {mintId} from 'snapback4/client'`) and POST `/m/chat.send` with `{id:mintId(),args:{messageId:mintId(),conversationId,body:"Hello",replyToId:null,photo:null,video:null,once:false},newIds:[]}`. Keep and retry the same entire request if the transport fails. The write id is a 26-character uppercase Crockford base32 128-bit identifier with leading digit 0–7; `mintId()` produces it. Receive by polling the history route as above. HTTP history uses exactly the field manifest already documented. To authenticate without a token, POST `/auth/login` with `{email,password}`; signup uses `/auth/signup`. The SDK auth functions are preferred when maintaining rotating sessions.

`insights.summary` returns the six totals, server `at`, and seven `{day,posts,likesReceived}` UTC epoch-day buckets. `insights.trending` returns the top ten original post cards in the trailing 24 hours (optional cursor `c`); use a fresh first page on refresh. The UI takes these load/refresh snapshots explicitly from the server. Posts totals count original posts; replies received include direct replies to either an original or an authored reply. Likes received likewise includes likes on authored replies.
