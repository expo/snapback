## Search every chat I'm in

Use **grouped** for everything, grouped by chat: one filtered membership
page with each chat's newest three hits, continued with one cursor through
any number of memberships. Use **newest** for a first screen in one globally
ordered stream while every chat's head opens in one read. Both run on the
server and on the device over held rows.

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

-- everything, grouped by chat: any number of chats; a cut carries `next`
query searchGrouped(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom where exists (messages[.roomId] matching q) { roomId, hits: messages[.roomId] matching q last 3 by byRoomWords }

-- one newest-first stream across chats: for a first screen; complete while the chats open in one read
query searchNewest(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 20 by byRoomWords:
    [m.roomId] for m in members[viewer]
```

**Grouped.** Pass `c: read.next` to continue. A meter-cut filtered page
positions after its last rule-visible examined membership and carries `next`,
so an empty cut page can still lead to later matching chats. Each group shows
up to three hits. A chat whose preview the cut starved is not on the page:
it is dropped with every later chat, and `next` reaches it first, so the next
request shapes it with a fresh meter (§5.6). Use
`inRoom` above for more in that chat. This is the grouped
search screen, not an enumeration of every message in every chat.

**Newest.** Pass `c: read.next` for the next globally ordered page. With the
dense fixture below, a complete first page fits through 2,717 chats; 2,718–2,730
open every head but cut while draining, with `next` and `complete: false`.
Past 2,730 dense chats the opening is cut (`complete: false, cut: 'meter'`)
with no continuation; use the grouped form.
A uniform lazy drain cut carries `next` after its last emitted row; following
it does not clear the earlier page's incompleteness in `usePage`.

These are live reads, not a snapshot across requests: restart after a
membership change, and refresh for concurrent edits or new messages.
Reset the cursor when changing the search text. Each chat scope still admits
at most 32 distinct words matching the first term; a word-limit cut is
incomplete, and further terms can spend the meter on misses. A device read past its
acquisition horizon makes its answer `complete: false`, including an empty
match; the server searches full history.

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
grouped or newest form for complete history beyond holdings.

`held` makes `searchHeld` device-only: `check` explains the dispatch, and
calling it through `dev`, `serve` or `run` refuses E_QUERY_HELD with a rewrite
to the grouped and newest forms. The local clients never fall back to the server
for a held query, even at a horizon, meter cut or word cut.

### Measured envelope

The simulator's `clique::search_global` and both device `search_global`
suites run the Quarry above directly from this card. At each size the dense
fixture has 30 messages per chat: 24 `coffee` hits and 6 `tea` misses;
`q = 'cof'`, page size 20, equal timestamps across chats, and an unreadable
chat with newer hits. SQLite and memory devices acquire full history, close
and reopen before reading. Grouped returns every expected chat once with
its newest three hits; newest returns all expected message ids once in
global newest-first order. The unreadable chat is absent in both.

Server, SQLite device and memory device measured the same counts in every row:

| Form | Memberships | Groups / hits shown | Requests | Examined first / whole walk |
|---|---|---|---|---|
| Grouped | 100 | 100 / 300 | 6 | 140 / 700 |
| Grouped | 500 | 500 / 1,500 | 26 | 140 / 3,500 |
| Grouped | 1,000 | 1,000 / 3,000 | 51 | 140 / 7,000 |
| Newest | 100 | 100 / 2,400 | 120 | 340 / 39,600 |
| Newest | 500 | 500 / 12,000 | 600 | 1,540 / 898,000 |
| Newest | 1,000 | 1,000 / 24,000 | 1,200 | 3,040 / 3,546,000 |

These are deterministic examined counts, not milliseconds or a worst-case
text-search bound. Full sync acquires 3,000 / 15,000 / 30,000 messages at
100 / 500 / 1,000 chats. Every dense page is complete and each first page has
`next`; the final empty grouped page closes the walk. Every newest page
rediscovers the memberships, so grouped is cheaper for the grouped screen.

At 9,000 memberships with hits in chats 8,101, 8,501 and 9,000 (one-based),
grouped returns all three chats exactly once in two requests on all three
hosts. The first page is meter-cut with `next`; the second finishes complete.
| Host | Request 1: groups / examined / next | Request 2: groups / examined / next |
|---|---|---|
| Server | 0 / 8,194 / yes | 3 / 906 / no |
| SQLite device | 0 / 8,194 / yes | 3 / 906 / no |
| Memory device | 0 / 8,194 / yes | 3 / 906 / no |

Total: 9,100 examined per host. The cut page shows no chat whose `hits`
preview the meter starved: that chat is dropped, `next` reaches it first, and
the second page shapes it with a fresh meter and returns every chat with its
hits — the dropped chat's discovery is paid twice, which is the cost of never
showing a row the read could not finish (LLP 3000.007 §5.6).
