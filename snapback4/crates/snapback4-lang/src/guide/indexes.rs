//! The indexes card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Indexes

```quarry
table tasks:
  ownerId: principal
  projectId: id
  done: bool
  at: time
  unique byOwnerProject: ownerId, projectId else PROJECT_EXISTS 'This project already exists.' -- `unique` orders and constrains: one row per (ownerId, projectId)
  by byOwnerDone: ownerId, done, at, id             -- `by` orders; a scan pins a prefix and pages along the rest
  cap 500 by ownerId                                -- a cap needs an index leading with exactly its columns
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer

query indexForms(projectId: id, c: cursor ?):
  one = tasks[viewer, projectId]                    -- a point read is a full unique key
  open = tasks[viewer, false] after c first 50 by byOwnerDone   -- a range is a strict prefix; a cursor needs an index ending in id, or a unique one
  return { one, open }

query wholeGroup():
  return tasks[viewer] by byOwnerProject             -- ascending, first 500 from the schema cap
```

A unique index may end with `else CODE` and an optional literal message:
`unique byHandle: handle else HANDLE_TAKEN 'That handle is taken.'`.
A visible collision then refuses with that code and message, family `constraint`,
and keeps the original index text in `detail` for development. Without a message,
it says `the program refused with HANDLE_TAKEN`; without a hook, `E_CONSTRAINT`
and its original message are unchanged. Codes follow `require`: UPPER_SNAKE,
never `E_`; they are declared at the use site, not looked up in a registry.
Hidden collisions retain their ordinary authorization refusal, and `insert … if
absent` still returns null on a visible clash.
Every encoded index key must fit 2048 bytes, including every component and
the appended row id. `check` uses declared column bounds, up to four UTF-8
bytes per text character, and encoding overhead; E_INDEX_KEY_BYTES names
the column to bound with `text <=N`. This declaration check is the primary
admission gate at `check` and source adoption. Existing SQLite stores also
scan their index entries before adoption; opening an existing Postgres store
does the same. One bounded query reports an offending table, index and exact
entry count with E_INDEX_KEY_BYTES. Fresh stores skip this scan. Rewrite the
old rows by shortening indexed values or deleting them, then adopt declarations
whose bounds fit. A device reset discards its old entries instead.
Writes on SQLite, Postgres and devices refuse new oversized keys. Deletes
always remain available; updates may retain or shorten existing oversized keys
without growing their lengths or count, so old violations can be removed.
Word entries use the search token cap.
Table and index names together are limited to 512 UTF-8 bytes, reserving
their space alongside the encoded key in the Postgres layout.

Every table has `byId`. A point read (`t[key]`, `update`, `delete`,
`upsert`) needs a unique index over exactly the key's columns; a program's
`exists t[col = value]` keeps ordinary read authorization and plans a scan
when no unique key is covered. Positional keys require one declared unique
key of that arity, unless an authored `by index` explicitly selects the key.
Rule probes keep exact keys and synthesize named probe indexes in written order.
A page needs an index whose
prefix is the key, and pages in the order of the remaining columns. When
two indexes match, `by name` chooses. `expire at .col` needs an index
leading with the column; a merge's lanes are equal-width prefixes of one
index; a job's `chunk` sweeps an index whose columns are `id` or
`immutable`. The diagnostic names the indexes that exist and the one to
declare. Predicate reads synthesize their indexes; caps, expiry and sync
also obtain the indexes they need without an authored index name.

`t[prefix] by index` without a page bound reads the whole schema-capped group in
ascending order: changing `cap 500 by ownerId` changes every such read's bound.
The cap must fit one read's examined ceiling. Without a fitting cap, only a
query loop or merge lane source with a uniformly decided prefix may omit the
bound; other pages need `first N` and a cursor. Full unique keys keep their
point-read meaning, and `t[]` is the empty prefix over the whole table.

## Time-bucketed listings and daily uniqueness

```quarry
table roomEntries:
  roomId: id
  at: time
  by byRoomHour: roomId, hour(at), at, id
  public 'Room entries are public.'

table checkins:
  principal: principal
  at: time
  unique byPrincipalDay: principal, day(at) else ALREADY_CHECKED_IN 'One check-in per day.'
  read <- .principal = viewer
  insert <- .principal = viewer

query roomHour(roomId: id, c: cursor ?):
  return roomEntries[roomId, hour(now) - 3] after c last 10 by byRoomHour

query roomWindow(roomId: id, c: cursor ?):
  return merge roomEntries after c last 10 by byRoomHour:
    [roomId, h] for h in range(hour(now) - 3, hour(now) + 1)

mutation checkin():
  return insert checkins { principal: viewer, at: now }
```

A table's `by` and `unique` key lists admit `day(at[, offset])`,
`hour(at[, offset])` and `bucket(at, period[, offset])` at any position,
once per function per index. The input is a required `time` column of that
same table. Periods and offsets follow maintain groups: floor ordinals from
the Unix UTC epoch, with a nonnegative whole offset smaller than the period;
`day(-1 ms)` is -1. Pin the ordinal positionally with an int expression,
or seek on the function name: `roomEntries[roomId, hour >= start, hour < end]`
with a page bound and `by byRoomHour`.

The key is not a column: it is absent from `*`, generated `api.ts`, rules,
`cap … by` and the sync audience, and cannot be written. An index containing
one is not plain, so a mutation page cannot use it. A real column named
`day`, `hour` or `bucket` colliding with that function's key must be renamed.
Changing the underlying time reindexes the row; a job `chunk` can sweep the
index only when that column and every other non-id key column are immutable.
A cursor carries the ordinal. Adding a time key, or changing its period or
offset, rebuilds the index at activation over existing rows.

With `likeCount: count likes by postId` on posts,
`by byHourLikes: hour(at), likeCount, at, id` serves Trending directly.
Zero-like posts participate; ties use post time. Activation builds this index
with missing counts interpreted as 0, then mirrors authoritative totals.
The generation change makes devices reacquire. `guide feeds` has the query.

## Refused index declarations and reads

E_CURSOR_INDEX means the page's index cannot supply a total cursor order.
For example, `by byOwnerTime: ownerId, at` leaves ties without a declared
last key; use `by byOwnerTime: ownerId, at, id`. A total unique key also
works. Follow the named index in the diagnostic; `snapback4 check --fix`
can append `id` when that repair is marked mechanical. Keep the cursor
argument and `after c` on the query so callers can continue the page.

E_QUARRY_AMBIGUOUS means several indexes match the key and the compiler
cannot choose one by its types or full unique key. For example, two indexes
beginning with `ownerId` can both serve `tasks[viewer] first 20`; choose the
intended order explicitly with `by byOwnerTime`. Use one of the diagnostic's
listed indexes, or apply its mechanical `snapback4 check --fix` rewrite.
Choosing the index also chooses the order of the page.

E_SCHEMA_CONSTRAINT means a schema declaration is missing structural
support or violates the core's schema constraints. For example,
`cap 50 by ownerId` needs an index beginning with that column; add
`by byOwner: ownerId, id`. An expiry needs its own leading time index,
and a maintained group needs its unique group key. Follow the declaration
named in the message; an audience mismatch needs an authorized grouping,
not merely another index. Rerun `snapback4 check` after the repair.
"##;
