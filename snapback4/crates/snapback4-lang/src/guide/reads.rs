//! Read answers, pages and continuation. Compiled by tests/guide.rs.
pub const CARD: &str = r##"# Reads

Every ready `Read` carries `cut: 'meter' | 'words' | null` beside `complete`,
on the server and either device store. An empty page with `cut: 'meter'`
means partial: retry narrower, or continue if `next` exists; never "no matches".
`words` means the first term expanded past 32 words in an admitted non-uniform scope: narrow that
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
word-limit cut withholds `next`. A resumable read-meter cut while an owning
uniform lazy traversal drains established heads can carry `next` after its last
fully shaped emitted row (§5.6), subject to the final answer's continuation eligibility,
with `complete: false, cut: 'meter'`. Heap exhaustion clears the whole page to
`data: null` with no `next`, even during the drain; step exhaustion aborts and
output exhaustion can refuse after materialisation. A terminal full page need
not carry `next`; following a cut does not clear `usePage`'s accumulated incompleteness.
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
An owning uniform lazy merge with established lane heads can resume a read-meter drain cut
after its last fully shaped emitted row (§5.6), subject to final-answer eligibility, with `complete: false, cut: 'meter'`.
Heap exhaustion clears the page to `data: null` even during the drain; step exhaustion aborts and output exhaustion can refuse.
A terminal full page need not carry `next`, and following a cut retains `usePage`'s accumulated incompleteness.
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
Returning `group(page, 'roomId')` or `sort(page, 'at')`, directly, through a
once-bound variable or nested as `group(sort(page, 'at'), 'roomId')`, carries
the source page's `next` and `complete`/`cut` class on the server and both device stores.
A filled direct page positions `next` after its last returned row. A meter-cut direct page
positions after its last rule-visible examined row, even if the filter rejected
it, never after a hidden row.
The rule applies only to a query's top-level returned shape expression,
`return <base> { ... }`: the base is an inline scan or merge, or a variable
with exactly one definition, that definition a read, no reassignment and no
other use anywhere in the program. The binder marks that lowered loop; only
that loop drops a row whose shape the meter starved and every later row.
`next` reaches the unfinished row first. A preceding fully computed row
supplies its exclusive position; otherwise the first unfinished rule-visible
row supplies an inclusive position — provided the page's own materialization was
not cut: a drain-cut merge with no fully computed emission, an opening cut or a
word-limit cut retains no continuation. Following an inclusive cursor that again
starves the same first row's returned shape refuses with E_SHAPE_EXCEEDS_METER
instead of returning an empty page with the same `next`: the message names the
read site and ceiling (8,192 examined rows); bound it (`first N`/`last N`) or
move it out of the returned shape. If an earlier read spent the meter, the
refusal names the shape's source read and that earlier read; bound the earlier
read or move the shape out of the returned shape.
A shaped collector that is not the returned
expression keeps today's behavior: its empty or partial shape stays on the page,
with the existing continuation ownership and position, without trimming or rewind.
This includes assigned shapes, records, conditionals, helpers, aliases and
collector payloads; some such compositions have no continuation owner.
The answer stays `complete: false` on a meter cut, with `cut: 'meter'` on
devices and uniform server reads; non-uniform server reads keep `cut: null`.
A non-uniform page stays incomplete; a cut in a
hidden run with no rule-visible row ends on an empty capped page.

## Queries, mutations and jobs

A mutation classified `predicts: "never"`, from a server site or an author's
`: server` marker, may iterate a bounded plain prefix page when its read rule
is uniform over the prefix. `matching`, merges and tables with expiry are
refused for every mutation page (`E_STRUCTURAL_FANOUT`), predicting or not,
looped or only bound. Prediction still needs a complete
schema-capped group: `for m in members[roomId]:` takes its bound from the
schema cap, so changing the cap changes every whole-group read. An explicit
`first <cap>` stays legal; a smaller explicit bound still fails the prediction
proof. A job's inner loop may also read a capped group without restating it.
Every page a mutation reads, including a page it only
binds, must be uniformly decided by its prefix (`E_STRUCTURAL_FANOUT`): read it in
a query, or pin the deciding columns.
A page verdict evaluated from its pinned prefix charges the rule's static probe count on either outcome, including probes skipped by `and`/`or` short-circuiting; an aborting mutation page also costs one examined unit before the verdict.
The pass is atomic and remains subject to 1,024 rows written per mutation.
`check --cost` prints "a pass over the first N rows of <prefix>; examined
ceiling <n>". It never commits a partial pass after a budget abort.

```quarry
mutation recentPass(roomId: rooms): server
  n = 0
  for row in members[roomId] first 10 by byRoomPrincipal:
    n = n + 1
  return n
```

A job may put a read-only prelude before its first `chunk`. It runs again
at the start of every chunk, with its bindings visible there and its work
charged to that chunk's meter. Writes belong inside a chunk.

- **Arguments** are typed like columns; `c: cursor ?` is an opaque page
  cursor. An omitted optional argument reads as null.
- **Reads:** `t[key]` (one row by a unique key, null if absent or
  hidden), `t[key] ! else CODE` (or refuse), `exists t[key]` (an exact probe or a prefix top-1 scan), `exists (t[prefix] matching q)`; named extra
  equalities (`t[key = x, col = y]`) return null/false on a mismatch,
  `t[prefix]` (ascending whole group when a schema cap fits the examined ceiling),
  `t[prefix] first N by index` (ascending; `t first N by index` is the
  whole table's page), `t[prefix] after c last N by index` (descending,
  from a cursor; table-page modifiers may come in any order, once each), `merge t [after c]
  first N by index [where predicate]:` with `[lane]` lines (one ordered page over several
  prefixes; a query lane may be `[f.col] for f in t[prefix] by index`,
  using the schema cap or the examined meter when its prefix decides the read rule;
  its `for` also accepts `range(a, b)` over int expressions and bounded lists,
  including list arguments and expressions, in their element order; bounds are
  evaluated once, empty domains are complete, and duplicate lanes deduplicate rows;
  `walk` is not a lane domain. Unknown widths print `lanes ≤ meter`; literal
  widths, equal expressions plus literal offsets, and list bounds are static.
  A non-uniform answer, an opening cut or a word-limit cut has no `next`.
  A resumable read-meter cut while an owning uniform lazy merge drains established heads
  can carry `next` after its last fully shaped emitted row (§5.6), subject to final-answer eligibility, with `complete: false, cut: 'meter'`.
  Heap exhaustion clears the whole page even during the drain; step exhaustion aborts and output exhaustion can refuse after materialisation.
  A terminal full page need not carry `next`; following a cut does not clear `usePage`'s accumulated incompleteness.
  Lanes computed from `now` move between pages:
  the cursor remains valid, but newly appearing rows before it are skipped;
  uniform lanes with a non-nullable unique index or an index ending in
  `id` read one head per lane, then advance the winning lanes; other
  lanes read a page each; `check` notes an explicit static lane count past 50), `walk
  t[seed] up .parentId depth 8` (a bounded list of rows), `t[scope]
  matching q after c last N by wordsIndex` (word-prefix search; `guide search`), `merge t matching q [after c] last N by wordsIndex:` over scope
  lanes (search across groups; uniform scopes share one heap of discovered
  word lanes, with one verdict before discovery and meter-bounded expansion;
  only an admitted non-uniform scope keeps at most 32 words).
  A uniform matching scan is always lazy: its merge position appends the row id
  when the ordering suffix lacks it; admitted non-uniform matching scans stay eager.
  `connected[p]` (open connections; `exists connected[p]` tests;
  `guide presence`). A key may name its columns: `t[a = x, b = y]`.
  If several indexes match a positional key, a single exact-type match wins
  first. If that remains ambiguous and exactly one is unique over the whole
  key, that unique index wins; otherwise use `by index`.
  With a total unique `(chatKey, principal)` key on t, `.principal = viewer
  or exists t[.chatKey, viewer]` is decided by the chat: each row witnesses
  itself, so the chat's roster page is complete without a second table.
- **Seeks and filters:** `t[prefix, col >= start, col < end] first N by idx`
  seeks on the first unpinned index column. `t[prefix] after c first N by idx
  where predicate` filters after authorization. The Merges, seeks and continuation
  section above keeps the cursor, returned-shape and predicate-meter rules together.
- **List operations:** pages, lists, and shaped collections share `sort`,
  `slice`, `count`, `sum`, `group`, `first`, `last`, `at`, `join`, and `for`,
  subject to their element types. Aggregating a page aggregates that page;
  `check --cost` names the examined and probe work, and expression ranges
  as `steps ≤ meter`. A uniform query prefix loop may omit `first N`;
  `check --cost` prints `rows ≤ meter (8,192 examined)` and `lanes ≤ meter`
  when no fitting cap supplies a static bound. A cut loop has no continuation;
  use a `maintain` for a total over a group that can outgrow one read.
- **Shapes:** `{ *, author: users[.authorId], count: counts[.conversationId] }`
  after a page, a list, a row or an object; `.` is the row; `*` spreads its
  columns; a shape based on a row keeps its device-owned `pending?: boolean`,
  including through named spreads and another shape. A point read inside is null
  for a hidden row. A shape is
  the only projection.
- **Writes:** `insert t { fields }` (returns the row; the id is minted
  unless given as `id: new` or an id you hold), `insert t { .. } if
  absent` (null on a unique clash), `update t[key] { patch }` (`if .col =
  expected` makes it conditional, refusing `E_CONFLICT` with the current
  row; `NOT_FOUND` when the row is missing), `upsert t[key] { fields }`
  (insert or patch: omitted columns keep their values on an existing row;
  an absent row fills defaults and then, for any required column still
  missing, refuses `NOT_FOUND`, the one word an unreadable target gets),
  `delete t[key]`; the key is an id, a row you hold, or a full unique key.
  Upsert predicts an update of a held row, and the insert of a missing
  one only when the synced group has no horizon and the key proves
  readability; otherwise a first like or reaction queues without a
  predicted row. `guide prediction` shows predictable
  insert-if-absent/delete set-state writes over a held viewer partition.
  Web queries and predictions trust the backend compiler's structural admission; the server
  rechecks every submitted mutation. Argument, row, rule, coverage and runtime
  budget checks still run locally. A hand-built or corrupted backend can differ
  from a native device's structural refusal; see `guide prediction`.
  A final write is the implicit return; bind it to use it (`row = insert
  ..`). Writes check the rule, unique indexes, caps, immutables, text
  formats and `after insert`; any refusal rolls the whole mutation back.
  A device accepts a local hit for `after insert <- exists t[key]`. A miss
  predicts a refusal only when the key proves readability and the synced
  group is fully held without a horizon; otherwise the insert or upsert
  queues without a predicted row for the server to decide.
- **Statements:** `x = expr` binds or reassigns a local with a compatible type;
  reassignment resets refinements, and arguments cannot be shadowed. `(q, r) = divmod(a, b)`, `(lo, hi) = sorted(a, b)`,
  `xs = []` then `xs = xs + [value]` appends under the heap meter;
  `for x in xs:` iterates the accumulated list.
  `require cond else CODE`, `if:` / `else if:` / `else:`, `for x
  in domain:` over a page, a bounded list, `range(a, b)` (integer
  expressions, under the step meter) or `tokens(text)`, `break`, `continue`, `return [value]`, a `fn` call,
  `emit effect { payload }` (`guide effects`), and a write. Values: `viewer`, `now`, `new` (an id, mutations only),
  `count(text | page | list)` (characters or items), `lower(text)`,
  `trim(text)`, `group(list, 'col')` (first-seen `{ key, items }` groups),
  `first(list)`, `last(list)`, `at(list, i)` (element or null), `join(list, separator)`, `sum(page, .x)`, `sum(list)`, `min(a, b)`, `max(a,
  b)`, `slice(text | list, start, end)`, `sort(list, 'col', '-col')`,
  `tokens(text)` (the @mentions, at most 64), `sha256(text)` (lowercase
  64-character hexadecimal of the exact UTF-8 bytes), `share(amount, list,
  member)`, `a ?? b`, `a if cond else b` (the arm not taken is never
  evaluated; `x != null` as the condition narrows `x` in the taken arm).
  `/` and `%` give the Euclidean quotient and remainder of ints or times;
  zero refuses `E_DIV_ZERO`. `(now / 1) * 1000` scales integer milliseconds;
  store the scaled count as `int`. Bind an optional helper result once and
  guard that local before arithmetic; repeated calls do not share a null
  refinement. `divmod` binds both parts at once. Text `+` concatenates present texts;
  interpolation and formatting stay in the client. A bare `return` returns null.
  `=` and `!=` are total (null equals null); `<` and friends need present
  operands — narrow with `if x != null:` or `x ! else CODE`. Guards also
  narrow bound row fields through short circuits and surviving branches;
  rebinding the local clears its field facts. `not` binds
  tightest: `a != b`, not `not a = b`.
- Use `sha256` only for high-entropy capability tokens and content checksums.
  It performs no Unicode normalization, case folding, quoting, salting or keying.
  It is not for passwords, low-entropy email anonymization, signatures, MACs or
  entropy generation, and a digest is not automatically safe to publish.
- **Refusals** a program raises with `require .. else CODE` reach the
  client as `{ code: "CODE", family: "rule", rule: "CODE", .. }`; `CODE` is
  UPPER_SNAKE and never starts with `E_`.
- A predicting mutation’s page loop needs one complete schema-capped group
  (`cap N by cols` and `first N`). A never-predicting mutation can pass a
  bounded uniform page, as described above; a larger sweep is a job's `chunk`.

A bounded list loop that only reads, computes and emits may iterate a list
column, an alias, a helper result or a filtered/shaped list from a page.
It need not preserve the whole group. If its body writes rows, including
inside helpers or nested loops, the original `E_STRUCTURAL_FANOUT` check
still applies. Every mutation page still needs a uniform plain prefix over
a table without expiry; the meter and its ceilings are unchanged."##;
