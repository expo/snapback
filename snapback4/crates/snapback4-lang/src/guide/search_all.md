## Search every chat I'm in

Use **newest** for a globally ordered page when discovery fits one read.
Use **grouped** to page matching chats with previews. Return bare hits and
read chat details separately. Both forms enforce source rules on the server
and over held device rows.

```quarry
table members:
  roomId: id
  principal: principal
  unique roomId, principal
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  sync to members[.roomId]

table messages:
  roomId: id
  body: text <=4000
  at: time
  search body
  read <- exists members[.roomId, viewer]
  sync to members[.roomId] last 200 by .at

query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c last 20 by .at

-- everything, grouped by chat: any number of chats; a cut carries `next`
query searchGrouped(q: text <=100, c: cursor ?):
  return members[principal = viewer] after c first 20 by .roomId where exists (messages[roomId = .roomId] by .at matching q) { roomId, hits: messages[roomId = .roomId] matching q last 3 by .at }

-- one newest-first stream across chats: for a first screen; complete while the chats open in one read
query searchNewest(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.roomId, viewer] last 20 by .at after c
```

**Newest.** The compact server plan discovers compact membership keys, opens one authorized
order key per chat and materializes only emitted hits. Inner word expansion
keeps one best head, rescanning and paying again on refill. Pass `c: read.next`.
Every page must rediscover every chat; this is a live cursor, not a snapshot
or saved search-work session. Reset it when changing the text or memberships;
refresh for new or edited messages.

For that plan, a discovery/opening cut refuses **E_SEARCH_OPEN**, with the authorized membership
count (a lower bound if discovery was unfinished), meter envelope and grouped
rewrite. It never returns an unexplained empty dead end. Once all heads are
established, an examined/index/probe drain cut can return `complete: false`
with `next` after the last fully shaped hit. Heap exhaustion makes the result
unavailable; steps/output can refuse. Following a cut does not clear
`usePage`'s accumulated incompleteness.

The device keeps the existing metered evaluator. So do server schemas whose
declared row decode reservation exceeds the default heap ceiling; tiny stored
payloads still use actual-size admission there. Other explicit merges keep
their existing opening cuts, which can lack `next` and E_SEARCH_OPEN.

**Measured server envelope.** On the Linux calibration host, default meters complete
20-hit first pages and continuations through 4,076 memberships in the dense
one-word fixture (8,192 examined rows). At 4,077 a drain cut has `next`;
The device still reaches its earlier heap boundary near 2,700 memberships.
10,000 cannot finish discovery and refuses E_SEARCH_OPEN. The calibration
copy has 100 memberships and completes. Extending it with empty chats reaches
heap first on continuations: bare pages fit 5,493 memberships; the builder's
decorated pages fit 5,317. See the lane GS round 1 report.
These are fixture measurements, not a universal chat limit: word width,
further-term misses, expiry, filters and decoration consume the same meters.

**Grouped.** The membership cursor advances through filtered chats, including
empty meter-cut pages. For progress, an interrupted existence predicate retries its membership inclusively.
If it interrupts the same membership again with nothing emitted, there is no next. An unfinished preview and all
later groups are dropped so the next request retries them. Each chat shows
three hits; use a pinned-chat search for more messages. This pages chats,
not every matching message in the corpus.

**Diagnostics.** `check` and `check --cost` separately name **N_SEARCH_UNSCOPED**
(add the membership predicate), **N_SEARCH_OPEN** (use grouped),
**N_SEARCH_WORDS** (longer first term or pinned chat), and **N_SEARCH_SHAPE**
(remove repeated peer/detail subqueries from each hit). Every entry has a site,
rewrite and `why` explanation. No structural certificate predicts corpus bytes.

**Device holdings.** With horizon-free sources, `check` reports horizon-free
source coverage for `searchHeld`: it reads one unscoped words index over the
messages this device holds, with no membership merge or per-reader copy.
Runtime meter cuts, the non-uniform scope's 32-word limit and page continuation
still apply; `complete` describes each returned page, and `fresh` separately
describes sync freshness. Expiring memberships require runtime audience checks;
an unscoped matching read can remain non-uniform and `complete: false` below
every meter and word limit.

Cold acquisition costs every live message in every held chat without a horizon.
This example acquires 200 messages per chat, so device searches report incomplete
history, even for empty matches. Label offline results as searched on this device.
`searchHeld` is device-only; the server refuses E_QUERY_HELD.
The local clients never fall back to the server for a held query, even at a
horizon, meter cut or word cut. Use grouped/newest online for full history.
