//! Read answers, pages and continuation. Compiled by tests/guide.rs.
pub const CARD: &str = r##"# Reads

Reads select authorized rows by id, predicate or search text.
Add an order, page size and cursor to browse a population.

```quarry
query readForms(roomId: rooms, messageId: messages, c: cursor ?):
  one = messages[messageId]
  must = messages[messageId] ! else NOT_FOUND
  roster = members where .roomId = roomId
  member = exists members[roomId, viewer]
  admin = exists members[roomId = roomId, principal = viewer, role = 'admin']
  return { one, must, roster, member, admin }
query newest(roomId: rooms, c: cursor ?):
  return messages where .roomId = roomId and .body != null last 20 by .at after c
query recentTotal(roomId: rooms, start: time, end: time):
  return count(messages where .roomId = roomId and .at >= start and .at <= end)
```

State the rows, then the order and page. `messages where .roomId = roomId
last 20 by .at after c` means the newest matching messages. The compiler
chooses the index. `messages[messageId]` always reads one id. A full declared
unique key also reads one row, using named columns when its arity is ambiguous.
The rules run before any projection, count or order reaches the caller.

For a table, order keys after `id` are redundant and omitted: `by .id, .at`
uses the same index and cursor as `by .id`. View orders retain later keys,
because distinct branches may carry the same source id; branch identity
breaks any remaining tie.

Unpaged aggregates infer a range seek only when its endpoint is already
present and cannot fail. Bounds requiring a short-circuit guard remain row
filters. A named id pin keeps its single-row access path and filters.

Finite ranked windows enumerate inclusive UTC buckets:
`bucket(lower) ..= bucket(upper)`. The exact endpoint comparisons still
filter every row. A missing finite upper bound stays a metered residual scan;
N_SPARSE_FILTER suggests `and .at <= now` when that is the intended window.
Paging by a maintained order key such as `.likeCount` is not a snapshot:
changes can move rows across a saved position. Restart to see the new order.
Value lanes deduplicate values; each lane keeps its source rule. Null never
becomes an index pin. When a membership list includes null, one ordinary
filtered lane reads the null-valued rows under the same rule.
A keyed `exists` inside `where` probes one authorized row per candidate;
when its discovery prefix cannot decide the other table's read rule, the
planner retains those probes and the certificate names the skipped rows.
A cut during discovery or while any lane head is unknown is incomplete and
has no cursor. A full page never certifies a prefix of an unfinished lane list.

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

Named equalities covering a total unique key read one row and check any extra
columns there: `t[key = x, col = y]` returns null on a mismatch, and
`exists t[key = x, col = y]` returns false. Named equalities covering no
unique key plan an ordinary authorized scan.
A positional key resolves only when exactly one declared unique key has its
arity. Types check that choice; they never choose between keys. If none or
several match, use named keys. Generated planning indexes never participate.
An explicit `by <authoredIndex>` keeps its existing point or prefix meaning.

References keep their table identity: `replies[id = r]` with `r: replies`
reads a reply, while `replies where .postId = p first 20 by .id` with
`p: posts` reads its replies. Passing a reference to a different table
refuses; a generic `id` does not carry that table-identity check.
An absent, hidden or null point target returns null. A predicate read returns
a page, empty when no visible row matches. A reference does not prove existence.
`snapback4 why <operation>` shows each read's source site, selected index,
column/key bindings, result form and selection reason; the same facts appear
in `check --json` execution sites. These are binder facts, not measured work.

For an expiring table, return the deadline with each row:

```quarry
query expiringMessages(roomId: rooms, c: cursor ?):
  return messages where .roomId = roomId after c last 20 by .at { id, body, expiresAt }
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
  unique roomId, principal
  read <- exists members[.roomId, viewer]
  sync to members[.roomId]

table typing:
  roomId: rooms
  principal: principal
  expiresAt: time
  unique roomId, principal
  cap 50 by roomId
  read <- exists members[.roomId, viewer]
  insert <- .principal = viewer and exists members[.roomId, viewer]
  update <- .principal = viewer and exists members[.roomId, viewer]
  expire at .expiresAt
  sync to members[.roomId]

mutation setTyping(roomId: rooms):
  upsert typing[roomId, viewer] { roomId, principal: viewer, expiresAt: now + 4500 }

query typingNow(roomId: rooms):
  return typing where .roomId = roomId by .principal { principal, expiresAt }
```

The first read examples use the language card's tables. A page's read rule is checked
once when the prefix decides it, else per row, and a page whose rule still depends
on a column the scan does not pin is never `complete` (N_NEVER_COMPLETE names
the missing equality columns and an existing compatible index when one is
available). Keep the current equality prefix when adding those pins; choosing
a conversation narrows the answer to that scope. This is author guidance,
not a `check --fix` repair, and it does not change the read rule. With a total unique `(chatKey, principal)`
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
A read states its predicate, search text, page size, order and continuation:
`t where predicate matching q last 20 by .at after c`. Omit parts the read
does not need. `first` ascends; `last` descends; id breaks ties. Predicates run
after the source rule. Parenthesize a nested read with its own modifiers:
`exists (messages[roomId = .roomId] matching q)`. The named inner key binds
the outer row's room; inside a predicate, `.` denotes that predicate's row.

## Nullable predicates and enum lanes

Inside `where`, an ordering comparison (`<`, `<=`, `>`, `>=`) with a nullable
column of that row is false when the column is null. `.due < now` therefore
selects overdue tasks without a guard or a default. On the first order key it
is a seek when its endpoint is already present and cannot fail; a nullable
upper-only seek starts exclusively above null. `= null`
and `!= null` keep their ordinary meaning. Optional arguments and locals,
and comparisons outside `where`, still need a presence guard.
An endpoint behind a guard, such as `d != 0 and .due > 10 / d` or
`x != null and .due < x` for optional `x`, stays in the residual predicate,
even with `by .due`. The guard runs before that comparison. Present literals,
`now`, required parameters and arithmetic proven not to overflow can seek.
Parenthesized predicates also work before a named shape.

For a required enum with at most eight variants, `.status != 'done'` opens
the same pinned value lanes as `.status in ['todo', 'doing']`. A bound value
can also select the excluded variant. Fallible expressions remain residual
predicates so their guards still run first. Nullable enums retain a residual
inequality, including null rows; larger enums also stay residual.
Value lanes are chosen only when every lane's prefix decides the source read
rule. Otherwise both `!=` and `in` remain residual filters on one scan, which
can continue through visible rows with `next`; the non-uniform read still
reports `complete: false`.

```quarry
table workTasks:
  owner: principal
  cap 100 by owner
  due: time ?
  status: enum('todo', 'doing', 'done')
  assignee: principal ?
  createdAt: time
  read <- .owner = viewer
  sync to .owner
shape workTaskCard = { id, due }
query overdueTasks(c: cursor ?):
  return workTasks where .owner = viewer and .due < now first 50 by .due after c
query overdueCards(c: cursor ?):
  return workTasks[owner = viewer] first 50 by .due after c where (.due < now) workTaskCard
query openTasks(c: cursor ?):
  return workTasks where .owner = viewer and .status != 'done' first 50 by .createdAt after c
query openTaskValues(c: cursor ?):
  return workTasks where .owner = viewer and .status in ['todo', 'doing'] first 50 by .createdAt after c
query board(status: enum('todo', 'doing', 'done') ?, assignee: principal ?, c: cursor ?):
  return workTasks where .owner = viewer and (status = null or .status = status) and (assignee = null or .assignee = assignee) last 50 by .createdAt after c
```

Optional filters `(status = null or .status = status)` (also `==`, either order)
choose an indexed plan for each presence combination; reset the cursor when
filters change, and inspect each variant with `check --cost`.
At most three optional inputs expand; N_OPTIONAL_FILTER_LIMIT names any extra
residual filters, which can stay metered or move into separate queries.
For mutation population loops and top-level job sweeps, put the optional
condition inside an ordinary capped loop or stable sweep; a presence-selected
read cannot supply that loop domain.

`check --cost` displays the residual that still tests each visible candidate,
including `in` when another predicate supplies the lanes. A predicate fully
extracted into pins or lanes has no residual-skip clause. These explanations
do not change read rules, meter bounds or completeness.

## Pages without a cursor

A page a query returns without
a cursor cannot be continued: an unfiltered page with more rows reads
`complete: false` with no `next` (N_NO_CURSOR); declare `c: cursor ?` and
page with `after c`, or use a narrower key, such as
`chatDeliveries where .messageId = messageId` without a page clause when a
declared cap bounds that message's acknowledgements. A matching set can
declare `cap 50 by conversationId` on the table
then read the whole group: `t where .conversationId = conversationId`, if 50 is the intended group limit
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

A boundless domain read uses the schema cap in ascending order, even in
nested shapes and mutation loops. A cap above the examined ceiling requires
explicit pagination for a returned page. `first N` remains an ordinary page;
`last N` remains the descending spelling.

## Totals, existence and continuation

`count(messages where .roomId = roomId)` and `sum(orders where .owner =
viewer, .amount)` stream their domains. They authorize and filter each row,
then release it. They do not retain a page of bodies. A meter cut or unknown
device coverage returns `data: null, complete: false`, never a partial total.
Use a maintained view for a total that should be updated with each write.
`count(page)` still counts only that page.
An unpaged aggregate keeps enum inequalities and membership predicates as
residual filters on its streaming scan. It does not turn them into a bounded
merge page: `count(tasks where .status != 'done')` and
`sum(tasks where .status in ['todo', 'doing'], .n)` return either the whole
authorized total or null on interruption. Scan admission remains unchanged.

`exists messages where .roomId = roomId` stops at a visible match. It accepts
predicates and seeks, but no page clause or cursor. A positive held witness
proves existence; absence needs complete coverage. An interrupted existence
scan cannot establish a negative answer. Mutations keep their ordinary scan
admission; rule probes keep exact-key semantics.

Finite ranked windows use inclusive UTC buckets from the lower through the
upper bound. Exact endpoints still filter rows. An `in` predicate over a list
or a read's column opens one ruled scan per distinct non-null value; a null
value adds one authorized null-filtered scan for a nullable column. Unknown
or cut discovery cannot certify the page. Use `check --cost` to inspect these
plans. Unknown widths print `lanes ≤ meter`; the author writes no lane list.

A resumable read-meter cut after every required head is known can carry `next`
after its last fully shaped emitted row, subject to final-answer eligibility.
Heap exhaustion clears the whole page to `data: null` with no continuation,
even during the drain. Step exhaustion aborts; output exhaustion can refuse.
A uniform matching scan is always lazy. Opening and word-limit cuts cannot
supply continuation. A terminal full page need not carry `next`. Following a
cursor does not clear earlier incompleteness in `usePage`.

A direct table or maintained-view cursor binds the evaluated prefix and active
generation. Another prefix or schema adoption refuses it. Ordinary writes keep
it valid, but a changing order can move rows across the cursor. Refresh a live
ranking; continuation is not a snapshot. Planned unions preserve branch and
source-row identity, even when two tables contain the same id.

A top-level returned shape carries its page's `next`. A shaped row that cannot
finish is dropped with later rows; continuation reaches the unfinished visible
row first. If the same first shape cannot fit on retry, E_SHAPE_EXCEEDS_METER
refuses instead of repeating an empty page forever. Narrow its nested reads
or move expensive components into separate queries. Non-uniform reads cannot
reveal a hidden continuation position. Independent pages in one object each
need their own continuation owner; one cursor cannot cover lost siblings.
`sort` and `group` operate on their input page and retain that page's coverage.

## Queries, mutations and jobs

A mutation classified `predicts: "never"`, from a server site or an author's
`: server` marker, may iterate a bounded plain prefix page when its read rule
is uniform over the prefix. `matching`, merges and tables with expiry are
refused for every mutation page (`E_STRUCTURAL_FANOUT`), predicting or not,
looped or only bound. Prediction still needs a complete
schema-capped group: `for m in members where .roomId = roomId:` takes its bound from the
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
  for row in members where .roomId = roomId first 10 by .principal:
    n = n + 1
  return n
```

A job may put a read-only prelude before its first sweep. It runs again
at the start of every chunk, with its bindings visible there and its work
charged to that chunk's meter. Writes belong inside the sweep body.

Arguments use column types; `c: cursor ?` is an opaque optional cursor.
An omitted optional argument is null. `walk rooms[roomId] up .parentId depth 8`
returns the seed and at most eight parent hops. List operations and helpers
are on `guide language` and `guide shapes`; writes are on `guide writes`.

Web queries and predictions trust the backend compiler's structural admission;
the server rechecks submitted mutations. Local argument, row, rule, coverage
and runtime budget checks still run. A hand-built or corrupted backend can
therefore differ from a native device's structural refusal (`guide prediction`).

A bounded list loop that only reads, computes and emits may iterate a list
column, an alias, a helper result or a filtered/shaped list from a page.
It need not preserve the whole group. If its body writes rows, including
inside helpers or nested loops, the original `E_STRUCTURAL_FANOUT` check
still applies. Every mutation page still needs a uniform plain prefix over
a table without expiry; the meter and its ceilings are unchanged.

## Operations

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

## Refusals

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

E_QUARRY_POSITIONAL_SCAN means a positional key would scan a population.
Use `posts where .authorId = owner last 20 by .at`; `posts[id = postId]` reads
one id, and named keys such as `profiles[principal = viewer]` read unique keys.

E_QUARRY_MODIFIER_SCOPE means a nested read's modifiers are ambiguous.
Parenthesize the inner read, for example `exists (messages[roomId = .roomId]
matching q)`, and put the outer page's `by .roomId after c` after its predicate.

N_SEEK is advice for an older explicit-index read whose residual filter can
seek. For a new read, write `messages where .roomId = roomId and .at >= start
first 20 by .at after c`; the planner makes that comparison a seek."##;
