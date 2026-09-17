//! Read answers, pages and continuation. Compiled by tests/guide.rs.
pub const CARD: &str = r##"# Reads

Every ready `Read` carries `cut: 'meter' | 'words' | null` beside `complete`,
on the server and either device store. An empty page with `cut: 'meter'`
means partial: retry narrower, or continue if `next` exists; never "no matches".
`words` means the first term expanded past 32 words in a scope: narrow that
term or use scoped search (guide search). If both limits cut, `meter` wins.
Device reads and uniform server reads keep precise reasons.
Non-uniform server reads report `cut: null`: the reason is withheld, with `complete: false` still truthful.
`null` means "not disclosed here", not "not cut"; it also covers a horizon,
missing coverage or a page without continuation. For `complete: false` with
`cut: null`, render "Results may be incomplete", even when empty; never "no matches".
A complete empty page has `cut: null` and `complete: true`.
For ordinary device reads, online fallback asks the server only for a missing
fact or unknown presence; a meter or word cut and a cursorless page stay local,
as do held queries and retained left groups, and pending predictable writes
still prevent fallback.

A read denied by a table's rule answers as an empty page, not a refusal,
and a client cannot tell it apart from an empty readable page — by design,
so that a hidden row cannot be probed. For access UI, use a membership query
the viewer may read, such as a conversation lookup readable by its members:
a member gets the conversation even when its message page is empty.
An explicit `require … else CODE` still refuses with the program's code.

Declare `query name(..) held:` for a device-only answer. `check` prints
`runs: device (held; server refuses E_QUERY_HELD; no server fallback)`.
`dev`, `serve` and `run` refuse it with E_QUERY_HELD and a guide search rewrite;
the local clients answer from held rows, online or offline, without server
fallback even at a horizon or cut. With horizon-free sources, `check` reports
horizon-free source coverage. Answer completeness still depends on runtime
authorization, limits and continuation; the marker does not acquire rows.
An unscoped search through expiring memberships can remain non-uniform and
incomplete below every limit. A `first 1` page without a cursor is incomplete
when its range contains two held rows. Read `complete` on each answer; a held query with an
online-only source or no read sites gets no source-coverage line.
Sources include reads nested in expressions such as the search text after `matching`.
For full server history beyond holdings, use the grouped or newest form on the search card.

To inspect a real account's server work under loopback `dev`, use the online
client `createClient({ url, session })` (or a bearer `token`); meters are available by default.
Successful `query` and `observe` answers include `Read.meter`:
`{ examined, indexEntries, probes, steps, heapBytes, outputBytes, rowsWritten, cut }`.
`Read.meter.cut` keeps the precise reason even for a non-uniform server read;
it is `meter`, `words` or null, with `meter` winning when both limits cut.
These are the engine's counters for that answer, not latency or process memory;
`probes` is rule_probes and `heapBytes` is charged heap work. A remembered
offline watch keeps the counters of its last server answer. Local device reads
have no meter; use the online client to inspect the server for the same account.
`meter: true` and `x-snapback-meter: 1` on `POST /q/<op>` remain explicit forms.
Loopback dev includes the field without either; `serve` ignores the header and never returns
meters. The counters can reflect hidden work and are development-only.
`snapback4 run <op> '<json args>' --as <principal id> --json` also prints
the engine's `metered` counters against `.snapback4/store.sqlite`.
A declared persona such as `alice` resolves to `dev:alice`; any other `--as`
value is used verbatim (including `user:...`, `member:42` and `dev:alice`).
The default is `dev:alice`. Jobs still run as the system.

Named equalities covering a total unique key read one row and check any extra
columns there: `t[key = x, col = y]` returns null on a mismatch, and
`exists t[key = x, col = y]` returns false. A non-unique prefix still needs an index. When several indexes match a positional
key, a single exact-type match wins first; if that remains ambiguous, exactly one
unique index covering the whole key wins; otherwise name `by index`
(the ambiguity diagnostic carries a mechanical `check --fix` rewrite).

```quarry
query readForms(roomId: rooms, messageId: messages, c: cursor ?):
  one = messages[messageId]                                  -- one row by a unique key: null if absent or hidden
  must = messages[messageId] ! else NOT_FOUND                 -- the row, or refuse with the code
  roster = members[roomId] by byRoomPrincipal                 -- ascending whole group, bounded by cap 100
  anyMessage = exists messages[roomId]                        -- first visible match; false on absence
  member = exists members[roomId, viewer]                    -- true or false; positional keys match the index columns
  admin = exists members[roomId = roomId, principal = viewer, role = 'admin']   -- named keys; `by` names the index when two match
  oldest = messages[roomId, at < must.at] last 20 by byRoomTime           -- the nearest earlier rows
  newest = messages[roomId] after c last 20 by byRoomTime where .body != null    -- a page, descending, from a cursor
  everyone = profiles first 50 by byHandle                   -- the whole table's page: the empty prefix, spelled without brackets
  merged = merge posts last 20 by byAuthorTime:              -- one ordered page over several prefixes of one index
    [viewer]
    [f.followedId] for f in follows[viewer] first 20 by byPair
  chain = walk rooms[roomId] up .parentId depth 8            -- the row, its parent, and so on: at most 8 rows
  return { one, must, member, admin, newest, chain }
```

For an expiring table, return the deadline with each row:

```quarry
query expiringMessages(roomId: rooms, c: cursor ?):
  return messages[roomId] after c last 20 by byRoomTime { id, body, expiresAt }
```

A typing indicator or presence row with a short deadline needs this local
filter: hide it at its deadline, even while the next answer is still pending.
A row already returned stays in that answer until the next answer; a live
reader that must hide it at its deadline drops it locally by `expiresAt`.
The server will not return the row again after expiry, but does not push a
removal at the instant of expiry. Select the deadline in the query, as above.
The local client reschedules its watch at `Read.nextExpiry`; keep the render
filter so the row hides at its deadline rather than at the refetch.
Given `rows` from a ready answer and your `render` function, render now and
schedule another render at each non-null deadline (epoch milliseconds):

```ts
const paint = () => render(rows.filter(row => row.expiresAt === null || row.expiresAt > Date.now()));
paint(); const timers = rows.flatMap(row => row.expiresAt === null ? [] : [setTimeout(paint, Math.max(0, row.expiresAt - Date.now()))]);
```

Clear these timers with `timers.forEach(clearTimeout)` before replacing the
answer or unmounting. This short-lived-row example uses the client's clock
and timer scheduling; `null` never expires.

For example, this typing indicator lasts 4,500 ms after the last keystroke.
Render `typingNow`'s ready rows with the filter and timers above. Each new
answer replaces those timers; cleanup also runs when the reader unmounts.
This is an application table, separate from the server's `connected[p]`.

```quarry
table rooms:
  read <- exists members[.id, viewer]
  sync to members[.id]

table members:
  roomId: rooms
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId
  read <- exists members[.roomId, viewer]
  sync to members[.roomId]

table typing:
  roomId: rooms
  principal: principal
  expiresAt: time
  unique byRoomPrincipal: roomId, principal
  by byExpiresAt: expiresAt
  cap 50 by roomId
  read <- exists members[.roomId, viewer]
  insert <- .principal = viewer and exists members[.roomId, viewer]
  update <- .principal = viewer and exists members[.roomId, viewer]
  expire at .expiresAt
  sync to members[.roomId]

mutation setTyping(roomId: rooms):
  upsert typing[roomId, viewer] { roomId, principal: viewer, expiresAt: now + 4500 }

query typingNow(roomId: rooms):
  return typing[roomId] by byRoomPrincipal { principal, expiresAt }
```

The first read examples use the language card's tables. A page's read rule is checked
once when the prefix decides it, else per row, and a page whose rule still depends
on a column the scan does not pin is never `complete` (N_NEVER_COMPLETE names
the index that would decide it). With a total unique `(chatKey, principal)`
key on t, `.principal = viewer or exists t[.chatKey, viewer]` is decided by
the chat alone because the row is its own witness, so a roster page pinned
by the chat is complete and no second table is needed. An aborting mutation
page costs one examined unit before its verdict, plus its rule probes on
both true and false verdicts; a true verdict then examines candidates.
A page verdict evaluated from its pinned prefix charges the rule's static probe count on either outcome, including probes skipped by `and`/`or` short-circuiting.
A point read reserves that same static allowance before its lookup, equally
for a readable row, a hidden row and a miss. If it cannot pay, authorization
has no verdict and the answer remains incomplete. A device's trusted held
row needs no authorization probes.
A table page accepts its modifiers in any order, once each. The printed order
is `[matching q]`, `after c`, `first N` or `last N`, `by index`, `where predicate`.
At the predicate's level, a non-index modifier ends `where` and belongs to that outer
read: `posts[viewer] where exists follows[viewer, .authorId] last 20 by byAuthorTime`.
An immediate `by` or `matching` after an unparenthesized inner read is ambiguous
(`E_QUARRY_MODIFIER_SCOPE`): parenthesize the inner read, or move the modifier
before `where`. `check --fix` preserves the inner index by adding parentheses:
`where exists (follows[viewer, .authorId] by byPair)`.
For an inner search use `where exists (messages[.roomId] matching q)`.

## Pages without a cursor

A page a query returns without
a cursor cannot be continued: an unfiltered page with more rows reads
`complete: false` with no `next` (N_NO_CURSOR); declare `c: cursor ?` and
page with `after c`, or declare `cap 50 by conversationId` on the table
then read the whole group: `t[prefix]`, pinned by `conversationId`, if 50 is the intended group limit
and no existing cap already bounds that group. Unscoped pages and pages
whose existing cap exceeds their bound or the meter still need continuation.
A cap refuses writes beyond its limit: it is a data constraint, not a hint.
A single-group page omits this note only when its bound
covers the group cap and that cap fits the default 8,192-row examined ceiling.
Other metered work and authorization can still make an answer incomplete;
a per-lane cap does not bound a merge. Inspect `Read.cut`: `meter` means narrow
the read or continue with `next`, `words` means narrow the search term, and null
does not establish completeness. For `complete: false` with `cut: null`, render
"Results may be incomplete", even when empty. Loopback dev's online client
includes `Read.meter` by default: examine `examined`, `indexEntries`, `probes`
and `cut` on the returned answer. Local device reads have no meter; `serve`
never returns these development counters.

A boundless whole-group read uses the schema cap in ascending order, even in
nested shapes and mutation loops. A cap above the examined ceiling requires
explicit pagination for a returned page. `first N` remains an ordinary page;
`last N` remains the descending spelling.

In a program, `exists t[prefix]` or `exists (t[prefix] matching q)` stops at its
first visible match below the page: it owns no cursor and never causes page
overflow. It charges examined rows, including expired siblings, and matching
word discovery. A meter cut before a match returns false on an already capped
answer. On a device, a positive held witness is exact regardless of the horizon;
a negative answer beyond a horizon needs coverage and is incomplete. Exact-key
program probes and all rule probes keep their existing meaning. A mutation's
prefix existence scan needs the same uniform, plain, non-expiring prefix as
its other page reads. `exists` accepts no `where`, bound, cursor or seek.

## Merges, seeks and continuation

A query merge lane's `for` accepts the domains a query statement `for`
accepts: a prefix page, `range(a, b)` over int expressions, a bounded list
argument or a bounded list expression, except `walk`. Range bounds evaluate
once before discovery, without materializing the range; lists yield their
elements in order. Empty domains give an empty complete page, and duplicate
lanes still return each row once. Lane descriptors are heap-charged and
iteration and scans remain metered. A non-uniform answer, an opening cut or a
word-limit cut withholds `next`. A uniform lazy merge cut while draining
established heads carries `next` after its last emitted row, with
`complete: false, cut: 'meter'`.
`check --cost` prints `lanes ≤ meter` for an unknown width. Literal bounds,
the same expression plus literal offsets, and a list's `<=N` bound supply a
static count; only a static count above 50 emits N_WIDE_MERGE.
Lanes computed from `now` move between pages: at an hour boundary the newest
lane appears and the oldest drops; the order-column cursor stays valid, and
new-lane rows sorting before it are skipped, as with scores moving between pages.

A merge reads ordered lanes, including time-key indexes, or matching lanes over a
words index (guide search). Uniform ordered merge lanes with a unique index or one ending
in `id` read one head each, then advance the winning lanes; `check` notes
an explicitly bounded merge past 50 lanes (N_WIDE_MERGE). The meter counts examined rows and
probes; a query it cuts returns what it found and `complete: false`.
A merge position uses the ordering suffix and appends the row id when that
suffix does not already end in `id`, so equal ordering values never skip rows.
An older merge token missing that id is refused; restart the walk. Tokens whose
suffix already ends in `id` keep their encoding, as do direct-page tokens.
A uniform lazy merge cut while draining established lane heads carries `next`
after its last emitted row, with `complete: false, cut: 'meter'`.
An opening cut or word-limit cut has no continuation. A non-uniform answer
withholds a merge's `next` even when that read ran after the merge.
`t[prefix, col >= start, col < end]` seeks on the first unpinned index column;
its bounds have that column's type. A lone `where .col >= start` on that
column lowers to the seek and emits N_SEEK naming the key spelling.
Other `where` predicates run after the read rule, with `.` bound to each row.
Comparisons, `and`/`or`/`not`, arguments, `viewer`, literals and indexed reads
are metered; a predicate read is a probe. Only rows passing both count toward N.
Reads inside the predicate are below the outer page: their own top-N does not
make it incomplete or own its cursor; their meter cuts still cut the answer.
A uniformly authorized filtered page is complete when it holds N matches or
reaches the range's end, including without a cursor; a meter cut is incomplete.
Direct table and maintain page cursors bind the evaluated prefix and active
generation. Reusing one under another prefix or after adoption is refused;
ordinary writes keep it valid, and rows can move between pages.
A filled direct page positions `next` after its last returned row. A meter-cut direct page
positions after its last rule-visible examined row, even if the filter rejected
it, never after a hidden row. A non-uniform page stays incomplete; a cut in a
hidden run with no rule-visible row ends on an empty capped page."##;
