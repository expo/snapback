## Search every chat I'm in

Use one ordinary **search** for a globally ordered page across current and retained conversations, as the social starter does. Use **grouped** to page current matching chats with previews when discovery cannot fit one read. Return presentation fields directly with key lookups:
`return messages matching q last 20 by .at after c { *, chatTitle: conversations[.conversation].title, senderName: profiles[principal = .sender].name }`. The planner selects the bare page first and decorates only its emitted hits, reading each distinct key once per authority. Missing or unreadable details are
`null`; hits, ordering, completeness, cut, continuation and freshness stay the bare page's. Current hits use ordinary server/device reads; departed hits use this device's held images. An expired or uncertain decoration becomes `null` immediately, including while a refresh is in flight or an offline answer is recovered. Because the deadline covers the page, the client conservatively nulls all point-dependent leaves, preserving nested objects and every literal or source field that does not depend on a point read. A masked decoration is a placeholder, not proof of absence. Page freshness does not prove that every decoration is current. A refresh restores values once a later deadline is proven. Both client tiers return the page from one-shots and keep it in watches, with the same freshness. Online watches retry values with capped backoff until confirmed, even if the client clock estimate is ahead. Decoration expiry never causes `E_QUERY_RETRY`; only source-page expiry can withdraw the page. The page remains one server call per publication attempt. The bare form is also valid. `check --cost` names the lifted plan and distinct-decoration reads. Table rules protect server reads; retained images confer no server authority.

A single ordinary word page, optionally with point decorations, such as
`return messages matching q where not .tombstone last 20 by .at after c` can now infer the current server audience from an exact non-expiring membership read rule and matching sync audience. `check --cost` names that inferred audience and its grouped rewrite. Its server result deliberately changes from an empty incomplete answer to the compact membership page when the work fits. Explicit membership predicates and query guards keep their meaning; other audiences, non-key subqueries and native functions keep their existing evaluator. Empty needles still take the existing browse branch, whose coverage can remain incomplete. System reads keep their original evaluator and full system-authorized domain. Inference also requires readable membership discovery. If its additional scoped index cannot fit the portable key or label budget, compilation keeps the original indexes and evaluator; that search may remain incomplete.

Current rows are authoritative by source ID, including after a scope update or ID deletion and reinsertion. In the page's one server call, the SDK sends that page's retained candidate IDs and, for decorations, ordering keys used only to choose emitted projections; authorized point reads tell it which have current readable rows. Those retained images are suppressed even when the current image no longer matches or lies before the cursor. Scope columns need not be immutable. A page can be short, or empty with a progress cursor, when suppression consumes its bounded retained candidates; follow `next` as usual.

For the proved time-ordered page (bare or point-decorated) on a local client, the SDK merges current server rows with this device's certified departed images. Both use the same
`(at, id)` order and the limit applies after deduplication. A page makes one server call; it never drains a cut to fill the limit. `next` seeks both sources after the combined consumed `(at, id)` key;
a fetched but unconsumed hit after that key stays eligible. Unconsumed hits are recomputed on the next requested
page and charged again. The coordinator and device scan share the existing
per-page device read allowance. There is no saved search session.

If the device word or read meter cuts without a continuation, its candidates
cannot establish the newest retained hit. The online page still publishes the
server's proved current rows, with `complete: false` and the constituent `cut`.
Its `next` continues only that current stream; the cut device source stays
incomplete throughout this traversal. Start a fresh search with a longer prefix
or search one chat to try retained history again. If that cut leaves no proved
server hits either, the request refuses E_BOUND with that repair instead of
returning an empty page that cannot advance. Server refusals still win.

Freshness describes emitted rows: a current-only page is fresh even when the
device holds other departed chats; a page emitting retained images is stale,
with `since` when available. Fresh does not mean complete.
With horizon-free acquisition, both sources can prove exhaustion and an empty
answer can be complete after departure. For a windowed source, the current
unscoped device word scan cannot certify exhaustion of all departed ranges,
even when their stored rows happen to be exhausted. Its boundary proof needs a
pinned group; a global `Left` list alone proves no acquisition range. That unknown
coverage keeps the combined page incomplete, including an empty terminal page.
The coordinator reports complete only if both sources prove the requested page.
A complete page can still have `next`; use that cursor to decide whether more
rows remain, including after a short page of suppressed replacements.
It must not infer “No matches” from `next: null`.

A membership, incarnation, generation or link change invalidates an incompatible
continuation. Every combined cursor binds the server's authorized audience, even
with no departed chats. Server replies are validated against the captured store
and generation, and continuations bind that validated identity. An unsynced
replacement or generation change withdraws the attempt until ordinary sync
establishes the new incarnation; its next observation starts with fresh source
positions. An unsynced audience change withdraws the stale page and
refreshes the first page of a live `usePage` observation. A one-shot query refuses
`E_QUERY_RETRY`; request a fresh first page to restart. Each observation still makes one
server call. An unrelated sync or an older-message edit preserves pagination.
An online composition starts fresh from a plain offline/server cursor, which
does not carry a validated store or audience identity. Resetting device rows
also invalidates its old combined cursors, even after reacquiring the same data.
The broader delivery fence still withdraws changes that occur during a request. Retained edits stay at their delivered image and expiry still
removes them. Rejoined scopes use the current server lane. The server’s bounded audience proof prevents a stale departed image from being merged after an unsynced rejoin; that observation waits for sync. Missing acquired
history and constituent cuts remain incomplete. An incomplete empty answer means
“Results may be incomplete,” never “No matches.” An online client without a
device searches only its current authorized domain; offline the same ordinary
body searches authorized device holdings. Other ordered shapes keep their
existing evaluator and routing. For one conversation keyed by `conversation, ordinal`, use the conversation recipe above; its named unique order and `.ordinal` form share the same search page.

Each continuation returns the next `(at, id)` rows visible at that request across current server scopes and this device's retained rows; the traversal is not a snapshot.
Changing an order key or match, or inserting a match before the consumed position, can repeat or skip that row; rows whose order, match, scope and readability stay stable appear exactly once, and `usePage` keeps one newest observed image per source ID when the generated query proves row identity.
For exactly-once pagination over message edits, declare `immutable at`; refresh from the first page to see new or newly matching rows before the cursor.

```quarry
table rooms:
  title: text <=200
  read <- exists members[.id, viewer]
  retain delivered-history
  sync to members[.id]

table profiles:
  principal: principal
  name: text <=80
  unique principal
  public
  sync public last 500 by .id

table members:
  roomId: rooms
  principal: principal
  unique roomId, principal
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  sync to members[.roomId]

table messages:
  immutable roomId, at
  roomId: rooms
  sender: principal
  body: text <=4000
  at: time
  search body
  read <- exists members[.roomId, viewer]
  retain delivered-history
  sync to members[.roomId] last 200 by .at

query searchHeld(q: text <=100, c: cursor ?) held:
  return messages matching q after c last 20 by .at

-- everything, grouped by chat: any number of chats; a cut carries `next`
query searchGrouped(q: text <=100, c: cursor ?):
  return members[principal = viewer] after c first 20 by .roomId where exists (messages[roomId = .roomId] by .at matching q) { roomId, hits: messages[roomId = .roomId] matching q last 3 by .at }

-- One ordinary newest-first stream in either link state, including after leave.
query search(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c { *, chatTitle: rooms[.roomId].title, senderName: profiles[principal = .sender].name }

query searchChat(room: rooms, q: text <=100, c: cursor ?):
  return messages[roomId = room] matching q last 20 by .at after c { *, chatTitle: rooms[.roomId].title, senderName: profiles[principal = .sender].name }

-- Optional current-membership-only scope; excludes departed images deliberately.
query searchNewest(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.roomId, viewer] last 20 by .at after c
```

`searchHeld` and `searchNewest` are optional, deliberately narrower domains:
device-only and current-membership-only respectively. Do not switch between
them based on connectivity. The starter uses ordinary `search` in both states. N_SHAPE_METER: both `searchGrouped` previews can reject unbounded candidates despite `last 3`; query each chat separately.

**Ordinary search.** Call `usePage(api.search, { q })` and render its `items`.
The decorated starter renders `row.chatTitle` and `row.senderName` directly.
The SDK accumulates identity-preserving rows by source row ID; do not append or deduplicate pages yourself.
Show “Partial results” when `readPresentation(page.read).incomplete` is true,
including nonempty `present` pages with incomplete coverage, a cut or a
continuation. Staleness is separate.

The compact server plan discovers compact membership keys, opens one authorized
order key per chat and materializes only emitted hits. Inner word expansion
keeps one best head, rescanning and paying again on refill. Pass `c: read.next`.
Every page must rediscover every chat; this is a live cursor, not a snapshot
or saved search-work session. Reset it when changing the text or memberships;
refresh for new or edited messages.

For that plan, a discovery/opening cut refuses **E_SEARCH_OPEN**, with the authorized membership
count (a lower bound if discovery was unfinished), meter envelope and grouped
rewrite. It never returns an unexplained empty dead end. Once all heads are
established, an examined/index/probe drain cut can return `complete: false`
with `next` after the last fully shaped hit. A compact page's heap exhaustion
refuses E_SEARCH_OPEN even after buffering hits; steps/output can refuse. Following a cut does not clear
`usePage`'s accumulated incompleteness.

Trusted, non-expiring server heads and emitted rows admit their actual decoded
size; wide declarations alone do not force a fallback. Private and expiring
images retain declared admission. The device and other explicit merges keep
their existing opening cuts, which can lack `next` and E_SEARCH_OPEN.

**Measured server envelope.** On the Linux calibration host, default meters complete
20-hit first pages and continuations through 4,076 memberships in the dense
one-word fixture (8,192 examined rows). At 4,077 a drain cut has `next`;
The device still reaches its earlier heap boundary near 2,700 memberships.
10,000 cannot finish discovery and refuses E_SEARCH_OPEN. The calibration
copy has 100 memberships and completes. An empty-chat extension reached
heap first on continuations: bare pages fit 5,493 memberships; decorated pages
fit 5,317. Those calibration limits predate actual-size admission.
These are fixture measurements, not a universal chat limit: word width,
further-term misses, expiry, filters and decoration consume the same meters.

**Grouped.** The membership cursor advances through filtered chats, including
empty meter-cut pages. For progress, an interrupted existence predicate retries its membership inclusively.
If it interrupts the same membership again with nothing emitted, there is no next. An unfinished preview and all
later groups are dropped so the next request retries them. Each chat shows
three hits; use a pinned-chat search for more messages. This pages chats,
not every matching message in the corpus.

**Diagnostics.** The ordinary windowed examples intentionally emit
**N_SYNC_ORDER** for unknown unscoped device coverage and **N_NEVER_COMPLETE**
for the empty-needle browse branch. These notes do not deny the inferred
non-empty current server plan; retained coverage can still be incomplete.
`check` and `check --cost` separately name **N_SEARCH_UNSCOPED**
(add the membership predicate), **N_SEARCH_OPEN** (use grouped),
**N_SEARCH_WORDS** (longer first term or pinned chat), and **N_SEARCH_SHAPE**
(identifies an unliftable aggregate, decoration predicate or non-key subquery; invalid decoration ordering is a compiler error). Every entry has a site,
summary; `check --verbose` adds rewrites and `why` explanations. No certificate predicts bytes.

**Device holdings.** With horizon-free sources, `check --verbose` reports horizon-free
source coverage for `searchHeld`: it reads one unscoped words index over the
messages this device holds, with no membership merge or per-reader copy.
Use the local client and continue with `c: read.next`.
Runtime meter cuts, the non-uniform scope's 32-word limit and page continuation still apply;
`complete` describes each returned page, and `fresh` separately describes
sync freshness.
Expiring memberships require runtime audience checks; an unscoped matching
read can remain non-uniform and `complete: false` below every meter and word
limit. Filling a declared page bound is complete without continuation.
For the non-expiring membership shape above, a full scan of acquired rows
without a cut is complete. The source-coverage line alone promises no answer's
completeness and is absent for a horizon, an online-only source or zero read sites.
Sources include reads nested in the `matching` expression, not just the searched table.

Cold acquisition costs every live message in every held chat without a horizon.
This example acquires 200 messages per chat, so device searches report incomplete
history, even for empty matches. Label offline results as searched on this device.
`searchHeld` is device-only; the server refuses E_QUERY_HELD.
The local clients never fall back to the server for a held query, even at a
horizon, meter cut or word cut. Choose this scope only for an explicitly
device-only feature; ordinary search above owns online/offline routing.

A proven permanently unavailable held one-shot refuses non-retryable `E_QUERY_HELD`.
Remove `held` for online fallback, or sync that data. Temporary misses follow
`guide client`'s bound.
