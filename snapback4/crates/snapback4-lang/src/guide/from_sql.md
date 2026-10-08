# From SQL and Convex

Start with the idiom you already know, then use its Quarry spelling.
Each example below compiles as a complete backend.

```quarry
table accounts:
  principal: principal
  handle: text 3..20 format handle
  bio: text ?
  createdAt: time default now
  unique principal
  unique handle else HANDLE_TAKEN
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  cap 1 by principal
  sync to .principal
mutation saveAccount(handle: text 3..20 format handle, bio: text ?):
  return upsert accounts[principal = viewer] { principal: viewer, handle, bio }
query myAccount():
  return accounts[principal = viewer]
```

| Postgres / RLS idiom | Quarry in the example |
| --- | --- |
| `CREATE TABLE accounts` | `table accounts:`; columns use `name: type`. |
| `NOT NULL` | The default; `handle` is required. |
| Nullable column | `bio: text ?`; omitted optional values are null. |
| `DEFAULT current_timestamp` | `createdAt: time default now`; explicit values win. |
| `PRIMARY KEY` | Every table has an implicit unique `id`; omit it on insert to mint one. |
| `UNIQUE (handle)` | `unique handle else HANDLE_TAKEN`; hidden collisions keep their generic refusal. |
| Bounded text / validation | `text 3..20 format handle`; validated on writes. |
| `CHECK (...)` | No general SQL CHECK clause; use column bounds/formats and `require` in every writer, as below. |
| `INSERT ... ON CONFLICT DO UPDATE` | `upsert accounts[principal = viewer]`; omitted patch fields stay unchanged. |
| RLS `USING` / `WITH CHECK` | `read <-`, `insert <-`, `update <-`; absent rules deny. |
| `auth.uid()` / `ctx.auth` | `viewer` is the authenticated principal; sessions are handled by the client auth API. |

Quarry has `int`, `time`, `bool`, `text`, `enum`, `decimal S`, `money CUR`,
`json`, `bytes`, bounded lists and asset types; `guide types` shows all of them.
A reference column carries the target table's id type. It does not enforce
existence or cascade deletion; guard required visible targets in the mutation.

## Select, join, page and aggregate

```quarry
table projects:
  title: text
  public
  online only

table members:
  conversation: projects
  principal: principal
  unique conversation, principal
  cap 50 by conversation
  public
  online only

table entries:
  project: projects
  owner: principal
  body: text
  amount: int
  removed: bool default false
  at: time default now
  search body
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only

view entryCounts: count entries by .owner
view entryTotals: sum entries of .amount by .owner

query latest(project: projects, c: cursor ?):
  return entries where .owner = viewer and .project = project and not .removed last 20 by .at after c
query expanded(project: projects, c: cursor ?):
  return entries where .owner = viewer and .project = project first 20 by .at after c { *, project: projects[.project] { title } }
query withProject(project: projects, c: cursor ?):
  return entries where .owner = viewer and .project = project and exists projects[.project] first 20 by .at after c { *, project: projects[.project] { title } }
query rosters(c: cursor ?):
  return members where .principal = viewer first 20 by .conversation after c { conversation, roster: members[conversation = .conversation] }
query member(project: projects):
  return exists members[project, viewer]
query selected(owners: [principal] <=8, c: cursor ?):
  return entries where .owner in owners first 20 by .at after c
query totals():
  return { count: entryCounts[viewer], sum: entryTotals[viewer] }
query find(q: text <=100, c: cursor ?):
  return entries where .owner = viewer matching q last 20 by .at after c
mutation add(project: projects, body: text, amount: int):
  require amount >= 0 else NEGATIVE_AMOUNT
  require exists projects[project] else PROJECT_NOT_FOUND
  return insert entries { project, owner: viewer, body, amount }
mutation remove(id: entries):
  update entries[id] { removed: true }
```

| SQL / Convex idiom | Quarry in the example |
| --- | --- |
| `REFERENCES projects(id)` | `project: projects`, not a foreign key: any id string is accepted and nothing cascades; `add` checks the target with `require exists`. |
| `SELECT ... WHERE ... ORDER BY at DESC LIMIT 20` | `latest`: predicate, `last 20 by .at`, then shape if needed. `first` ascends; `id` breaks ties. |
| Keyset pagination | `c: cursor ?` and `after c`; pass the answer's `next` back as `c`. |
| `OFFSET 100` | No offset pagination; keep and follow the opaque cursor. |
| `LEFT JOIN projects` | `expanded` uses `project: projects[.project] { title }`; absent or hidden targets are null. |
| `JOIN projects` | `withProject` adds `exists projects[.project]` before the reference shape; no arbitrary multi-table SQL join syntax. |
| Correlated subquery | `rosters` uses `members[conversation = .conversation]`; the key reads the outer row, while an inner `where` reads the inner row. |
| `EXISTS (...)` | `exists members[project, viewer]`; tests only authorized rows. |
| `IN (...)` | `.owner in owners`; rules still apply independently to every source row. |
| `COUNT(*) ... GROUP BY owner` | `view entryCounts: count entries by .owner`; lookup yields the count, including zero. |
| `SUM(amount) ... GROUP BY owner` | `view entryTotals: sum entries of .amount by .owner`. |
| Full-text / prefix search | `search body` and `matching q`; every search term is a word prefix. |
| Stemming, phrase search, relevance rank | No equivalent; use word-prefix search in a declared column order. |
| Soft delete | `removed: bool default false`, `update`, and `where not .removed`; authorization and physical retention remain your policy. |
| `ctx.db.query().withIndex().order().paginate()` | `latest` states predicates, column order and continuation; the compiler selects the index. |

This select-and-aggregate example runs online so its pages and searches can
choose different orders. For offline pages, choose a sync window and read its
own order newest first; see `guide sync` and N_SYNC_ORDER.

`count(read)` and `sum(read, .amount)` compute a live total without storing a
view; `count(page)` counts that page only. A meter cut never becomes an exact
total. Source rules run before projections, ordering and aggregates reach you.

## Transactions, triggers and background work

```quarry
use server
effect notify

table rooms:
  owner: principal
  public
  insert <- .owner = viewer
  after insert <- exists memberships[room = .id, principal = .owner]
table memberships:
  room: rooms
  principal: principal
  unique room, principal
  cap 50 by room
  public
  insert <- created rooms[.room]
  delete <- exists rooms[id = .room, owner = viewer]
table reminders:
  recipient: principal
  due: time
  expiresAt: time ?
  expire at .expiresAt
  immutable due
  read <- .recipient = viewer
  insert <- .recipient = viewer

view membershipCounts: count memberships by .room
mutation createRoom():
  room = insert rooms { owner: viewer }
  insert memberships { room: room.id, principal: viewer }
  emit notify { room: room.id, principal: viewer }
  return room
mutation setReminder(due: time):
  return insert reminders { recipient: viewer, due, expiresAt: due + 1d }
job deliver(periodStart: time, periodEnd: time):
  for r in reminders where .due >= periodStart and .due < periodEnd by .due:
    emit notify { recipient: r.recipient } once [r.id, periodEnd]
schedule eachMinute every 1m: deliver
action fetchSummary(room: rooms) returns { summary: text }
action dailySummary(periodStart: time, periodEnd: time) returns {} <- viewer = 'service:reporter'
schedule summaries every 1d at 08:00 as service:reporter: dailySummary
```

| SQL / Convex idiom | Quarry in the example |
| --- | --- |
| `BEGIN ... COMMIT` | `mutation createRoom` commits both rows and its emitted effect atomically, or rolls everything back. |
| Trigger-maintained counter | `view membershipCounts: count memberships by .room`; the engine maintains it in each source write. Older `maintain` spelling still compiles. |
| Deferred after-insert check | `after insert <- exists memberships[...]` must hold at the inserting mutation's end; it is a constraint, not an effect handler. |
| Trigger calling an external service | `emit notify` records durable work; an external worker performs it after commit. |
| Cron / scheduled function | `schedule eachMinute every 1m: deliver`; jobs receive period boundaries and chunk automatically. |
| TTL | `expire at .expiresAt`; null never expires, reads hide expired rows before the physical sweep. |
| `ON DELETE CASCADE` | No implicit cascade; delete authorized dependents in the same mutation or use a job for a large lifecycle. |
| Convex `query` | Quarry `query`, as in `myAccount`; may run on a device holding its inputs. |
| Convex `mutation` | Quarry `mutation`, as in `createRoom`; transactions remain metered and rule checked. |
| Convex `action` | Quarry `action fetchSummary`; implement its external work in the server handler. Requires `use server`. |
| Scheduled action | `summaries` invokes `dailySummary` under the named service seat. |

`emit ... once` deduplicates enqueue, not provider delivery. Jobs run as the
system; actions run under their admitted authority. `guide actions`,
`guide jobs` and `guide effects` explain handlers, retries and scheduling.

## Guesses and their one-step repairs

| Guess | Write instead |
| --- | --- |
| `len(x)`, `length(x)` or `x.length` | `count(x)`, `len(x)` and `length(x)` are accepted; `x.length` needs `count(x)`. Characters for text, items for a list or page. |
| `count(*)` | Pass the read: `count(entries where .owner = viewer)`. |
| `limit 20` | `first 20` or `last 20`, with the desired column order. |
| Two `where` modifiers | Accepted as `and` in their written order. |
| `m.helper(x)` | Accepted when the helper is declared in `m.q`; the bare name still works. |
| Two `sync` lines | Keep one audience matching the read rule; a union audience has no equivalent. Use an online-only table when it cannot be inverted. |
| Nullable lookup passed to a required helper | Require it once: `row = table[id] ! else NOT_FOUND`, then pass `row`. |

The canonical counting and required-row spellings are compiled here too:

```quarry
table entries:
  owner: principal
  body: text
  read <- .owner = viewer
fn bodySize(row: entries): count(row.body)
query size(id: entries):
  row = entries[id] ! else NOT_FOUND
  return bodySize(row)
query countMine():
  return count(entries where .owner = viewer)
```

Developer inspection: `snapback4 sql '\dt'` (or `'.tables'`) lists application
tables and maintained views; `sql '\d messages'` (or `'.schema messages'`) shows
Quarry types/nullability, indexes and unique keys. Both include the active schema
generation and bounded stored row counts (exact through 10,000, else >=10,001;
ephemeral unavailable). Use `--json` for structured output, `--release dir` for a
deployment. These read-only commands keep SQLite internals private; see `guide inspect`.
