## Search every chat I'm in

For 100–1,000 memberships, choose full device holdings for cheap offline
search, or walk bounded chat batches on the server for history that is not
held. The earlier `everywhere` example discovers only its first 50 chats;
its result cursor does not advance membership discovery.
For a wired server walk, run `snapback4 init --recipe search` and
`snapback4 check`; the installed helper manages both cursors and stops on
any cut. The installable backend and usage are below.

```quarry
table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  sync to members[.roomId]

table messages:
  roomId: id
  body: text <=4000
  at: time
  by byRoomTime: roomId, at, id
  by byRoomWords: roomId, words(body), at, id
  by byWords: words(body), at, id
  read <- exists members[.roomId, viewer]
  sync to members[.roomId]

query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c last 20 by byWords

query searchChats(c: cursor ?):
  return members[viewer] after c first 50 by byPrincipalRoom

query searchChatBatch(q: text <=100, batch: cursor ?, c: cursor ?):
  return merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer] after batch first 50 by byPrincipalRoom
```

**Device holdings.** With horizon-free sources, `check` reports horizon-free
source coverage for `searchHeld`: it reads one unscoped words index over the
messages this device holds, with no membership merge or per-reader copy.
Use the local client and continue with `c: read.next`.
Runtime meter cuts, the 32-word limit and page continuation still apply;
`complete` describes each returned page, and `fresh` separately describes
sync freshness.
Expiring memberships require runtime audience checks; an unscoped matching
read can remain non-uniform and `complete: false` below every meter and word
limit. A page bound without continuation can also make an answer incomplete.
For the non-expiring membership shape above, a full scan of acquired rows
without a cut is complete. The source-coverage line alone promises no answer's
completeness and is absent for a horizon, an online-only source or zero read sites.
Sources include reads nested in the `matching` expression, not just the searched table.

Cold acquisition costs every live message in every held chat; the query's
cheap read does not make that acquisition cheap. This block intentionally emits N_NO_HORIZON
for `messages` (full history is acquired). The scoped server operations
compile without notes. Add `last 200 by byRoomTime` to the messages sync
line to acquire only the newest 200 per chat. That bounds acquisition,
not later holdings, and word search then reports `complete: false`, even
on an empty match: it cannot prove that older server history has no match.
Offline, label these results as searched on this device. Online, use the
scoped server walk for complete history beyond holdings.

`held` makes `searchHeld` device-only: `check` explains the dispatch, and
calling it through `dev`, `serve` or `run` refuses E_QUERY_HELD with a rewrite
to this scoped server walk. The local clients never fall back to the server
for a held query, even at a horizon, meter cut or word cut.

**Server batches.** Begin with `batch = null`. Call `searchChats(c: batch)`
and save its `next`. With that same batch start, call `searchChatBatch`
with `c = null`, then follow its result `next` until absent. Only then
advance `batch` to the saved membership `next` and reset `c = null`.
Finish when the membership page has no `next`. Do not stop on an empty
search batch: later chats may contain matches. The two cursors have
different indexes and jobs; do not exchange them. Keep the query text
and batch start fixed while continuing a result page.

Each result is newest first within its batch. Group returned messages by
`roomId` in the client and deduplicate by message `id` as pages accumulate;
all messages of a chat are in the same batch. To show one newest-first
stream across batches, first obtain a head from every batch and merge
those ordered streams, or finish the walk and sort by `(at, id)` descending.
Do not call the first batch the newest page across all chats. A page's
`complete: true` describes that page, not completion of the whole walk.
These are live reads, not a snapshot across requests: restart after a
membership change, and refresh for concurrent edits or new messages.

Both forms still require at most 32 distinct words matching the first
term in each scope (the device's whole held index is one scope). A broad
prefix can exceed that bound even when it fits separately in each chat;
narrow the first term or use scoped search. Further terms filter candidates
and can spend the meter on misses. Fifty server lanes and twenty results
are a measured starting point, not a guarantee for arbitrary text: word
fan-out, duplicates and other metered work can still cut the batch. A
matching merge cut during opening or at the word limit has no safe result
continuation. A uniform lazy merge cut while draining established heads carries
`next` after its last emitted row; its page stays `complete: false, cut: 'meter'`.
Treat `cut: 'meter'` or `cut: 'words'` as unfinished, narrow the term or retry with fewer
chat lanes; never advance past it and claim an exhaustive search.
To reduce a batch, change both membership `first 50` bounds together
(`searchChats` and `searchChatBatch`) and restart the walk. Advancing a
50-chat discovery cursor after searching only ten of those chats skips
the other forty.

### Measured envelope

The simulator's `clique::search_global` and the device suite's
`search_global` run the Quarry above, read directly from this card.
At each size the fixture has 30 messages per chat: 24 `coffee` hits and
6 `tea` misses; `q = 'cof'`, page size 20, equal timestamps across chats,
and an extra unreadable chat with newer hits. Both SQLite and memory
devices are synced, closed and reopened before the walk. All expected
ids are found once, newest first within each page, and grouped into every
held chat; the unreadable chat is absent.

| Memberships | Hits / chats in the full walk | Full-sync messages acquired | Device examined, first / whole walk | Server examined, first / whole walk |
|---|---|---|---|---|
| 100 | 2,400 / 100 | 3,000 | 22 / 2,638 | 1,201 / 79,181 |
| 500 | 12,000 / 500 | 15,000 | 22 / 13,198 | 1,201 / 396,149 |
| 1,000 | 24,000 / 1,000 | 30,000 | 22 / 26,398 | 1,201 / 792,359 |

Every full-sync device and bounded server result page is `complete: true`.
The walks take 120 / 600 / 1,200 result pages. Server totals include the
separate 2 / 10 / 20 membership discovery calls (101 / 509 / 1,019 examined);
the matching merges also rediscover their own 50 memberships on every
result page. Maximum examined per result page is 22 on either device
store and 1,201 on the server. These are deterministic examined counts,
not milliseconds or a worst-case text-search bound.

With a ten-message acquisition horizon, either device store instead
acquires 1,000 / 5,000 / 10,000 messages and finds 400 / 2,000 / 4,000
hits across every chat in 20 / 100 / 200 pages: examined first/max 22,
whole walk 438 / 2,198 / 4,398. Every page, including an empty search,
is `complete: false`; the retained 4 hits per chat are exhaustively found,
but 20 older hits per chat are outside acquisition.

For comparison, the unbatched `first 1000` membership merge examines
2,400 / 8,358 / 8,880 on its first result page at these sizes. Only the
100-chat case is complete and has a result cursor; 500 and 1,000 hit the
unchanged 8,192 ceiling and have no continuation. The recorded examined
ledger can exceed that ceiling as later lanes attempt charges after the
cut; those attempts do not make the read complete.

**Per-reader inbox considered.** It buys the same single-lane read shape
by copying each message into each reader's search table, but is not cheap
for shared chats already synced to devices. At the example's 100-member
chat cap, 30 messages × 100 / 500 / 1,000 chats means 300,000 / 1,500,000 /
3,000,000 copied rows, versus 3,000 / 15,000 / 30,000 originals. Each send
adds up to 100 copies; edits, deletes, expiry, joins and revocations must
keep those copies correct. These are arithmetic copy counts, not a
maintained-inbox benchmark. A `maintain` grouped from messages does not
expand one source into its membership audience. This recipe therefore
keeps shared messages and recommends the two forms measured above; no
per-reader inbox is installed.

### Install the bounded server walk

Held search remains the UI path for acquired history. For optional server
history, run `snapback4 init --recipe search`, then `snapback4 check`.
This installs the following exact backend as `snapback/search.q` and a typed
`src/search.ts` helper, using the same installer as `--recipe feeds`.
It adds to an existing project or creates the normal starter in an empty
directory. `--prefix history` renames its declarations and the helper's API
references when the app already has `members` or `messages`; no files are
written on a collision. These online-only example tables acquire no extra
rows. In an existing chat app, replace their declarations and references
with the app's membership and message tables and matching indexes; keep the
rule and both membership bounds aligned. The recipe exposes reads only;
use the app's authorized mutations to populate its tables, never a second
unrestricted write API. It does not copy the app's messages automatically.

```quarry
table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  online only

table messages:
  roomId: id
  body: text <=4000
  at: time
  by byRoomWords: roomId, words(body), at, id
  read <- exists members[.roomId, viewer]
  online only

query searchChats(c: cursor ?):
  return members[viewer] after c first 50 by byPrincipalRoom

query searchChatBatch(q: text <=100, batch: cursor ?, c: cursor ?):
  return merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer] after batch first 50 by byPrincipalRoom
```

Call `for await (const step of searchServer(client, text))` using the
export from `src/search.ts` and your app's client. A step has `phase`
(`memberships` on discovery failure, otherwise `results`), the original
`read`, the batch start, and `finished`. Render its loading/denied/data
states and preserve `read.complete`, `read.cut` and `read.fresh`.
Only the last successful result page has `finished: true`; an empty
intermediate batch still advances to the next membership page.
The helper streams pages without accumulating the whole result in memory.
Group by `roomId` and deduplicate by `id`; ordering is within each batch,
not globally across batches. Breaking the loop cancels further requests.

An incomplete or stale page stops the helper at its current batch; it never
advances a meter- or word-cut batch, even if a cursor is present. Narrow the
term or reduce **both** `first 50` bounds and restart; do not call a stopped
walk exhaustive. Restart on membership changes and refresh after concurrent
message changes: this remains a live walk, not a multi-request snapshot.
