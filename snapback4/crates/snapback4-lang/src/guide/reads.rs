//! Compiled examples first; diagnostic details are under `why`.
pub(super) const CARD: &str = r##"# Reads

Read authorized rows; use a cursor for paging.

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

`one` is a row or null; `must` refuses when it is missing or hidden.
`roster` reads the capped room; `member` and `admin` test membership.
`newest` filters, sorts newest first, and continues with `c`.
`recentTotal` counts the whole matching domain under the meter.
Repeated `where` clauses combine with `and`, in written order.

## Limits

- A positional key names one row; use `where` for populations: E_QUARRY_POSITIONAL_SCAN.
- Add a cursor if the screen pages: N_NO_CURSOR.
- A rule depending on unpinned columns cannot certify completeness: N_NEVER_COMPLETE.
- A nested read with ambiguous modifiers needs parentheses: E_QUARRY_MODIFIER_SCOPE.

## Details

Reads select authorized rows by id, predicate or search text.
Add an order, page size and cursor to browse a population.

State the rows, then the order and page. `messages where .roomId = roomId
last 20 by .at after c` means the newest matching messages. The compiler
chooses the index. `messages[messageId]` always reads one id. A full declared
unique key also reads one row, using named columns when its arity is ambiguous.
The rules run before any projection, count or order reaches the caller.

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
By default `useQuery`, `usePage` and `client.observe` keep their last answer
through plain revalidation, marked `revalidating: true`, without a time limit.
A successful answer clears the mark. A transport failure retains it with
`fresh: false`; `since` still identifies the confirmed server state.
Changed arguments start their own read and never show another argument's data.
Use `{ keep: false }` to withdraw during every refresh. `{ keep: true }` also
keeps the live observation for 30 seconds after its last subscriber leaves.

Invalidation always wins: changed read dependencies, unknown change footprints,
refusals, expiry, sign-out/account change, credentials, schema adoption and store
replacement/restore withdraw immediately for every option. Dependency changes
are conservative: the protocol names tables, so an innocent write to an input
table also withdraws until re-read. Rule-probe tables are dependencies too.
A null point or empty page replaces the old answer. Snapshots check deadlines
even before delayed timers run. No application result cache is needed or safe.
`usePage` retains a valid prefix while a later page loads, and resets its suffix
when cursors change. It carries `revalidating` from its contributing pages.
Retention never grants write or media authority. The server still checks actions.

For ordinary device reads, online fallback asks the server only for a missing
fact or unknown presence; a meter or word cut and a cursorless page stay local,
as do held queries and retained left groups. While this device holds a predictable pending write to a table a query reads,
that query asks no server; a write with an unknown predicted footprint blocks
every query. Writes to unrelated tables do not hold it. A withheld answer
(a total/extremum over input past the horizon, a point read past it, or another
speculative answer) stays `loading`; a local partial answer (`complete: false`,
e.g. an order unlike the window's) stays partial.
Keep a screen query locally complete (`snapback4 why <query>`); put server-needing
decorations in their own query so the main list never waits on them.
Keep the screen shell and draft mounted; render current reads.

For an expiring table, return the deadline with each row:

```quarry
query expiringMessages(roomId: rooms, c: cursor ?):
  return messages where .roomId = roomId after c last 20 by .at { id, body, expiresAt }
```

Held device observations republish at `nextExpiry`, including offline; render
those rows directly. The browser witness measures their published expiry
within a frame. JavaScript timers still wait while a page is suspended.
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
device coverage leaves the client read `loading`, never a partial total.
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

A resumable read-meter cut after every required head is known can carry `next`
after its last fully shaped emitted row, subject to final-answer eligibility.
Heap exhaustion clears the whole page and leaves the client read `loading`, with no continuation,
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
