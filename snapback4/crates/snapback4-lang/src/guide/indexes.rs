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
`upsert`) needs a unique index over exactly the key's columns; `exists
t[key]` needs any index over exactly them; a page needs an index whose
prefix is the key, and pages in the order of the remaining columns. When
two indexes match, `by name` chooses. `expire at .col` needs an index
leading with the column; a merge's lanes are equal-width prefixes of one
index; a job's `chunk` sweeps an index whose columns are `id` or
`immutable`. The diagnostic names the indexes that exist and the one to
declare.

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
