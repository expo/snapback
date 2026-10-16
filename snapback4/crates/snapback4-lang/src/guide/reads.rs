//! Compiled examples first; diagnostic details are under `why`.
pub(super) const CARD: &str = r##"# Reads

Read authorized rows. `sync … last N` bounds acquisition; cursors page server history (offline: acquired rows).

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

`one` returns a row/null; `must` refuses missing/hidden rows.
`roster` reads the capped room; `member`/`admin` test membership.
`newest` pages newest-first; `recentTotal` counts under the meter.
Repeated `where` clauses combine with `and` in order.

## Limits

- A positional key names one row; use `where` for populations: E_QUARRY_POSITIONAL_SCAN.
- Add a cursor if the screen pages: N_NO_CURSOR.
- Unmerged pages with unpinned rule columns cannot certify all callers. N_CONDITIONAL_COMPLETE names a readable pinned-parent guard; N_NEVER_COMPLETE has none (separate grants may still admit callers).
- A nested read with ambiguous modifiers needs parentheses: E_QUARRY_MODIFIER_SCOPE.
- N_SHAPE_METER: maintained totals (guide views), previews, or queries.

## Details

Unreadable query references act absent: null points or complete empty pages. Mutation references refuse; ids grant no authority.

Reads select authorized rows by id, predicate or search text.
Add an order, page size and cursor to browse a population.

Projections drop `id` unless listed: `{ title }` omits id; `{ id, title }` preserves it. Whole rows retain id.


### Pages and cursors

State the rows, then the order and page. `messages where .roomId = roomId
last 20 by .at after c` means the newest matching messages. The compiler
chooses the index. Positional keys select identity for `id`/same-table references,
otherwise the declared unique key accepting types in order; ambiguous types need named columns.
The rules run before any projection, count or order reaches the caller.
Declare `c: cursor ?`, read `after c`, pass each answer's `next` as `c`; `usePage` does that.

### Completeness

Pinned-parent guards are caller-dependent (`N_CONDITIONAL_COMPLETE`; `guide recipes`).
`T[]` requests a complete fitting group: `return children[] where .parent = parent`.
It needs authority and a cap/unique bound. Update capped cases that now answer complete.

`complete` means the query answered its declared request within known coverage and execution limits.
Filling a declared page bound is complete.

Every ready `Read` carries `cut: 'meter' | 'words' | null` beside `complete`,
on the server and either device store. An empty page with `cut: 'meter'`
means partial: retry narrower, or continue if `next` exists; never "no matches".
`words` means the first term expanded past 32 words in an admitted non-uniform scope: narrow that
term or use scoped search (guide search). If both limits cut, `meter` wins.
Device reads and uniform server reads keep precise reasons.
Non-uniform server reads report `cut: null`: the reason is withheld, with `complete: false` still truthful.
`null` means "not disclosed here", not "not cut"; it also covers a horizon,
missing coverage. For `complete: false` with
`cut: null`, render "Results may be incomplete", even when empty; never "no matches".
A complete empty page has `cut: null` and `complete: true`.
Same-key observations retain their last answer marked `revalidating` during
plain refetch, reconnect and transport failure. Omitted `keep` and `keep: true`
share this policy; `keep: false` withdraws immediately. Inserts and non-policy updates retain through retries; deletes, policy-input changes and unknown evidence start a nonrenewable one-second bound. Bounded failure/timeout withdraws; replacements can still publish.
A notified cut keeps older replica answers ineligible until sync publishes it.
A whole server answer at that cut may replace sooner. Expiry, sign-out,
credential, store, schema and generation resets still withdraw immediately.
`fresh` and `since` describe server freshness, independently of revalidation.
With `keep: true`, a watch also lingers for 30 seconds after its last subscriber
leaves, sharing the same observation, expiry, invalidation and reset fences.
Local commits still revalidate it while unmounted; account/backend changes,
`clear_rows`, `settle_exit`, ephemeral resets and close end its authority.
See `guide client` for the complete retention and screen-lifetime recipe.
A ready list read always carries an array; an absent point can still be null.
`usePage` returns `items: []` while its first page is loading; earlier pages
remain visible while a later page is unavailable.

For device reads, online fallback asks only for missing facts or unknown presence.
Meter/word cuts and cursorless pages stay local, as do held queries and retained left groups.
Predictable pending writes block server fallback for dependent reads; unknown prediction
footprints block every query. Unrelated writes do not block. Withheld speculation
(past-horizon totals, extrema or points) stays `loading`; local cuts stay partial.
For one-shots, see `guide client`.
Keep a screen query locally complete (`snapback4 why <query>`); put server-needing
decorations in their own query so the main list never waits on them.
Keep the screen shell and draft mounted; render current reads.

For an expiring table, return the deadline with each row:

```quarry
query expiringMessages(roomId: rooms, c: cursor ?):
  return messages where .roomId = roomId after c last 20 by .at { id, body, expiresAt }
```

Held device observations republish at `nextExpiry`, including offline; render
those rows directly. Timers follow the row's deadline; a suspended page or a
busy host can delay the callback.
Only server-answered reads need a render-deadline filter to hide a returned
row while its next network answer is pending. Return `expiresAt`, as above.
In React, `useNow(deadline)` owns the timer and responds to clock estimates:

```ts
import { useClient, useNow } from "snapback4/react";
function useExpiringRows<T extends { expiresAt: number | null }>(rows: T[]) {
  const client = useClient();
  const deadline = Math.min(...rows.flatMap(row => row.expiresAt !== null && row.expiresAt > client.now() ? [row.expiresAt] : []));
  const now = useNow(Number.isFinite(deadline) ? deadline : null);
  return rows.filter(row => row.expiresAt === null || row.expiresAt > now);
}
```

Render the rows returned by `useExpiringRows(rows)`. `client.now()` estimates the server's time and never
moves backward; `null` never expires. The hook cleans up on unmount.

For typing and viewing indicators, use an ephemeral table (`guide ephemeral`,
also `guide typing`). Keep its server query separate from the device-held
chats list. The expiring-rows recipe above is for durable disappearing messages.

## Measure live propagation

Mounted reads wake from `/changes`, sync and re-evaluate affected queries, including parent/authorization dependencies.
With two signed-in clients, separately time invocation, `sent` acknowledgement, changed `observe`, React `useLayoutEffect` and image `onLoad`.
Acknowledgement follows commit; `waitSeconds: 0` measures custody. Network traces distinguish transport/application work. Repeat 20+ times, idle and loaded.

## Nullable predicates and enum lanes

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

`check --cost` displays the residual that still tests each visible candidate,
including `in` when another predicate supplies the lanes. A predicate fully
extracted into pins or lanes has no residual-skip clause. These explanations
do not change read rules, meter bounds or completeness.

## Totals, existence and continuation

`count(messages where .roomId = roomId)` and `sum(orders where .owner =
viewer, .amount)` stream their domains. They authorize and filter each row,
then release it. They do not retain a page of bodies. A meter cut or unknown
device coverage leaves the client observation `loading`, never a partial total.
Use a maintained view for a total that should be updated with each write.
`count(page)` still counts only that page.
An unpaged aggregate keeps enum inequalities and membership predicates as
residual filters on its streaming scan. It does not turn them into a bounded
merge page: `count(tasks where .status != 'done')` and
`sum(tasks where .status in ['todo', 'doing'], .n)` return either the whole
authorized total or null on interruption. Scan admission remains unchanged.

`exists messages where .roomId = roomId` stops at a visible match. It accepts
predicates and seeks, but no page clause or cursor. A visible or held witness
proves existence (`true`); absence needs full coverage: an interrupted or
undecided scan answers nothing. Mutations keep their ordinary scan
admission; rule probes keep exact-key semantics.

A resumable read-meter cut after every required head is known can carry `next`
after its last fully shaped emitted row, subject to final-answer eligibility.
Heap exhaustion clears the whole page and leaves the client observation `loading`, with no continuation,
even during the drain. Step exhaustion aborts; output exhaustion can refuse.
A uniform matching scan is always lazy. Opening and word-limit cuts cannot
supply continuation. A terminal full page need not carry `next`. Following a
cursor does not clear earlier incompleteness in `usePage`.

## Queries, mutations and jobs

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

## Operations

To inspect a real account's server work under loopback `dev`, use the online
client `createClient({ url, session })` (or a bearer `token`); meters are available by default.
Successful `query` and `observe` answers include `Read.meter`:
`{ examined, indexEntries, probes, steps, heapBytes, outputBytes, rowsWritten, cut }`.
`Read.meter.cut` keeps the precise reason even for a non-uniform server read;
it is `meter`, `words` or null, with `meter` winning when both limits cut.
These are the engine's counters for that answer, not latency or process memory;
`probes` is rule_probes and `heapBytes` is charged heap work. A local fallback
keeps its previous answer’s counters only until the fetch settles. Local device reads
have no meter; use the online client to inspect the server for the same account.
`meter: true` and `x-snapback-meter: 1` on `POST /q/<op>` remain explicit forms.
Loopback dev includes the field without either; `serve` ignores the header and never returns
meters. The counters can reflect hidden work and are development-only.
`snapback4 run <op> '<json args>' --as <principal id> --json` also prints
the engine's `metered` counters against `.snapback4/store.sqlite`.
A declared persona such as `alice` resolves to `dev:alice`; any other `--as`
value is used verbatim (including `user:...`, `member:42` and `dev:alice`).
The default is `dev:alice`. Jobs still run as the system.

"##;
