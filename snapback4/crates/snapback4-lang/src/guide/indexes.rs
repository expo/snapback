//! Index choice and optional tuning. Examples compile in tests/guide.rs.
pub(super) const CARD: &str = r##"# Indexes: chosen from the read

Indexes let reads seek the rows that match a predicate in the requested order.
The compiler chooses or creates them from your reads and declarations.

```quarry
table tasks:
  ownerId: principal
  projectId: id
  done: bool
  at: time
  unique ownerId, projectId else PROJECT_EXISTS 'This project already exists.'
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  online only
query one(projectId: id):
  return tasks[viewer, projectId]
query open(c: cursor ?):
  return tasks where .ownerId = viewer and .done = false first 20 by .at after c
```

`by .id` sorts ids, not creation times. `last N` reverses order: newest-first with chronological keys such as `.at`.

State the predicate and order. `check` chooses an existing index or creates
one. Rules, sync, caps and expiry also obtain their access indexes. A table
needs no `by` declaration for these reads.

`unique ownerId, projectId` is a product constraint: one row per pair.
`tasks[x]` selects identity when `x` is typed `id` or `tasks`; otherwise
exactly one declared unique key must accept the argument types in order.
Name columns when several keys accept those types: `tasks[ownerId = viewer,
projectId = projectId]`. Synthesized indexes never choose positional meaning.
In either key spelling (also `exists`), arguments for nullable columns of the
selected unique key must be provably non-null: use required types or `if x != null` guards
(`x != null and exists ...` in rules). Otherwise `E_QUARRY_NULL_KEY` refuses
the ambiguous null ties across replicas. Guard nullable arguments before
`require exists`: it proves row presence, not optional field presence.
To read null matches, use a bounded
`where` population ordered `by .id`, or address a row by id. Null for a
unique key argument returns no row at runtime, without scanning ties; the
guard is still required at compile time; maintained aggregate null groups are unchanged.
A fully pinned maintained group is unique even
with null, including rule probes that also test its value.
E_QUARRY_POINT_KEY refuses a point probe whose key can match several rows.
A fully pinned superset of a required unique key counts as unique too.
Use a unique key or a bounded `where` population; its scalar probe reports unavailable
when a scan is cut. Rule probes require a unique key.
A visible unique collision uses the optional `else CODE 'message'` hook;
a hidden collision keeps its ordinary authorization refusal. `if absent`
returns null on a visible clash. Codes are UPPER_SNAKE and never start with E_.

A bound row addresses itself: after `s = slots[slot] ! else NOT_FOUND`,
`slots[s]` reads, updates and deletes that row, as `slots[s.id]` does.

## Small lookup tables: `cap N`

A table that stays small (categories, plans, tags) declares `cap N` with no
`by`: at most N rows in the whole table. Every query may then read it whole,
filtered or not, with no `first N` and no cursor:

```quarry
table categories:
  name: text 1..40
  unique name else CATEGORY_EXISTS
  public 'shop categories'
  insert <- allow
  cap 50
  sync public
query categoryList():
  return categories by .name
mutation addCategory(name: text 1..40):
  return insert categories { name }
```

The 51st insert refuses `E_CONSTRAINT: categories holds at most 50 rows`.
A device predicts it when it holds the whole table (`sync public` with no
horizon); a private partition, a horizon or an expiring table queues the write for the server. A cap bounds a read only
up to the 8,192-row examined ceiling, and other meters still apply. Adding or
lowering a cap on a populated table checks the stored rows (`E_ADOPT`);
raising one applies in place. On an expiring table the cap counts live rows.
A table that can grow pages with `first N` and a cursor instead.

## Private lists: pin the audience

A private page is complete when its planned ranges decide the read rule.
`N_NEVER_COMPLETE` prints the missing source edit for unsupported shapes.
The planner supplies party, membership and positive compound ranges, including
owner/public/member lists. An exact positive `where exists authors[.id, viewer]`
that repeats a read-rule disjunct supplies its own complete audience. Known
parent row images supply stored scalar pins; they do not prove copied child
fields equal their parents. A readable total static negative role probe may
also decide a range; hidden or lifetime-sensitive negative probes do not. A two-party row (buyer/seller, follower/followed, requester/owner) is
one query: under `.requester = viewer or .owner = viewer`, `swaps first 20 by
.id after c` (or `where .requester = viewer or .owner = viewer`) reads the
merge of the two pinned ranges, a row in both once, with one cursor, and is
complete. Each `or` branch must pin an index prefix that decides the rule, and
the predicate must be comparisons (no arithmetic or calls); up to 8 branches.
Pure membership and owner-or-membership work when the membership rule is an exact point:
`.owner = viewer or exists members[.parent, viewer]`. The usual `unique parent,
principal` needs no cap: it bounds witnesses per target row, not a viewer's
memberships. Discovery is metered and publishes no rows or cursor if cut. Add
`cap N by principal` only as a real enrollment limit; writes and adoption
enforce it, and bounded enrollment guarantees availability. The target can be
the row id (`exists members[.id, viewer]`) or a readable parent's id
(`exists offers[.offer, baker = viewer]`); page order and its id tie-breaker
remain. Otherwise the note prints one query per party. A child page pins the column its rule reads, read from the
parent it already names: `parent = cards[card] ! else NOT_FOUND`, then
`.board = parent.board`; copy that column onto the child as an immutable field
and check it in the insert rule. A capacity check reads a count whose read rule
covers every writer (it discloses the count, not the rows), then `require`s
below the limit; a check over the private rows themselves is E_STRUCTURAL_FANOUT.

```quarry
table swaps:
  requester: principal
  owner: principal
  item: text <= 80
  read <- .requester = viewer or .owner = viewer
  insert <- .requester = viewer
  online only
query mySwaps(c: cursor ?):
  return swaps first 20 by .id after c

table boards:
  owner: principal
  read <- exists boardMembers[.id, viewer]
  insert <- .owner = viewer
  online only
table boardMembers:
  board: boards
  principal: principal
  immutable board, principal
  unique board, principal
  read <- .principal = viewer
  insert <- created boards[.board]
  online only
table cards:
  board: boards
  title: text <= 80
  immutable board
  read <- exists boardMembers[.board, viewer]
  insert <- exists boardMembers[.board, viewer]
  online only
table comments:
  board: boards
  card: cards
  body: text <= 500
  immutable board, card
  read <- exists boardMembers[.board, viewer]
  insert <- exists boardMembers[.board, viewer] and exists cards[.card, board = .board]
  online only
query cardComments(card: cards, c: cursor ?):
  parent = cards[card] ! else NOT_FOUND
  return comments where .board = parent.board and .card = card first 20 by .id after c

table shifts:
  coordinator: principal
  slots: int
  public 'shift times and capacity are public'
  insert <- .coordinator = viewer
  online only
table signups:
  shift: shifts
  volunteer: principal
  immutable shift, volunteer
  unique shift, volunteer else ALREADY_SIGNED_UP
  read <- .volunteer = viewer
  insert <- .volunteer = viewer
  online only
view signupCount: count signups by shift
  read <- allow
mutation signUp(shift: shifts):
  s = shifts[shift] ! else NOT_FOUND
  require signupCount[shift] < s.slots else SHIFT_FULL 'This shift is full'
  return insert signups { shift, volunteer: viewer }
```

A page may combine a party with a static role (`exists roles[principal =
viewer, role = 'admin']`), including a synced union. The server pages all rows
for a readable grant holder and only party rows for everyone else. The device
walks its acquired union rows without probing a remote role. Explicit pages
need no whole-table cap; an omitted page bound must still have a cap or total
unique over its original prefix. An owner cap never bounds a staff's whole table.

Positive compound rules such as `.owner = viewer or (exists staff[viewer]
and .status = 'open')` keep the status pin in the staff range. Parent membership
and status alternatives work the same way when the parent source is readable.
A nullable enum's `.species != null` enumerates its non-null variants. At most
seven alternatives plus the system range; arithmetic and negated probes keep
an exact diagnostic repair. Discovery still must complete before returning rows.

An unreadable parent-owner source cannot prove absence through an index or
cap. For an immutable parent owner, copy it onto the child as an immutable
principal, check that copy in the insert rule, and fill every insert and seed.
`check` prints the actual table/column declarations and payload edit. Existing
rows need a backfill before adoption; mutable parent owners need transactional
copy propagation. Keep the parent private.

A grant that reads no row field, such as `exists staff[viewer]` or
`viewer = 'service:ops'`, admits every row to its holder. When it holds for
the caller, and the caller may read the row that grants it (`read <-
.principal = viewer` on `staff`), the page is decided once: a staff page is
`complete`. When the rule's other disjuncts are parties (`.owner = viewer or
exists staff[viewer]`), everyone else's page is their party range, complete
too: one query serves both.
A grant row its holder cannot read decides nothing; the note says when a
grant is not used. The run never needs a guard, but `check` follows one: a
page that only grant holders reach (`require exists staff[viewer] else …`,
`if exists staff[viewer]:` around it, or `if not exists staff[viewer]: return
[]` before it; several grants may share one guard with `or`) gets no note, as
it is `complete` for every caller who runs it. A disjunct whose row columns
the scan pins (`exists rides[.ride, leader = viewer]` under `.ride = ride`)
decides the page the same way, with the pinned values, when its holders may
read the row it probes: the leader's roster is `complete`, and `check`
follows `if` or `require` of `exists rides[ride, leader = viewer]`.

A page that stays `complete: false` still holds every row the caller may
read. In `test.cases.jsonl` the default expectation passes it (write
`"expect": "capped"` to pin it); a client renders the rows and shows
`readPresentation(read).incomplete` as "there may be more", not as an error.

## Operations

Run `snapback4 check --cost` for chosen and synthesized indexes and the reads
that need them. `snapback4 why <operation>` shows each source site, selected
index, key bindings and result form. These are structural facts; use the dev
read meter to measure actual work (`guide reads`).
Index mismatch and ambiguity repairs print source only after the edit compiles
in your project; otherwise the diagnostic gives prose guidance.
The default output names planner indexes by their columns. `--verbose` and
`--json` retain their canonical names; authored index names stay as written.
Two-column labels keep a trailing `id`, as in `index (org, id)`; wider labels
may omit the final `id` tiebreaker.

Equality pins lead the index, then any time bucket, then the requested order.
`id` breaks ties in the same direction. Identical index definitions are reused.
A nullable unique key permits tied null rows, so its columns alone cannot
carry a page cursor: the planner uses a separate ordering with `id`.
Generated names are stable across declaration order. Adding a query can build
an index on adoption, but cannot change another positional key's meaning.

A finite time window ordered by another column uses engine-chosen buckets.
Write both bounds, such as `.at > now - 1d and .at <= now`; exact endpoint
filters still run after authorization. A missing bound remains a residual
scan. `guide feeds` shows the complete Trending query.

A `search body, caption` line declares searchable columns; `matching q`
chooses a words index for the predicate and order (`guide search`).
A unique key can group time without adding a stored column:

```quarry
table checkins:
  principal: principal
  at: time
  unique principal, day(at) else ALREADY_CHECKED_IN 'One check-in per day.'
  read <- .principal = viewer
  insert <- .principal = viewer
mutation checkin():
  return insert checkins { principal: viewer, at: now }
```

`day`, `hour` and `bucket` use floor ordinals from the UTC epoch. An optional
offset anchors the boundary; `day(at, 8h)` starts at 08:00 UTC. These are index
keys, absent from row shapes, rules and writable columns. Changing a period
or offset rebuilds the index. A sweep may order by a computed key only when
its underlying columns are immutable.

Existing `by name: columns` table lines remain optional tuning. Reuse requires
an identical ordered definition. The language card's final block shows the
older explicit read syntax; ordinary reads continue to name columns.

## Refusals

E_CONSTRAINT means an intrinsic id unique key, product cap, immutable field, format or
postcondition rejected the write. Keep the rule; correct its input.
For a visible duplicate handle, choose another; `if absent` is
appropriate only when doing nothing on an existing row is the intended write.


E_INDEX_KEY_BYTES means an encoded key exceeds 2048 bytes, including its
components and row id. Bound the named text column, for example `text <=80`,
and shorten or delete old oversized values before adoption. Index checks
allow up to four UTF-8 bytes per character. Table and index names together
must fit 512 UTF-8 bytes. Deletes remain available; updates may retain or
shorten existing oversized keys without growing their lengths or count.
Both server stores and devices enforce new keys; search tokens have their own cap.
For a generated index, the diagnostic names the read or declaration's source
site and the column to bound. Change that column's type; no generated index
declaration needs editing.

E_CURSOR_INDEX concerns an older explicit index that lacks a total order.
For new reads, use `tasks where .ownerId = viewer first 20 by .at after c`:
the planner adds the id tiebreak. For a non-unique explicit index, append `id`
to its definition or apply the diagnostic's mechanical `check --fix`.
Keep nullable unique constraints unchanged; use the column-ordered read
above to obtain a separate page index without weakening uniqueness.

E_QUARRY_POSITIONAL_SCAN refuses a positional key that cannot identify one
declared unique key by argument types. E_QUARRY_AMBIGUOUS refuses several matching
indexes. Name columns to state the key; if indexes share those columns in
different orders, choose an explicit index. Offered index repairs compile in
context; `check --fix` can apply a verified positional choice.

E_SCHEMA_CONSTRAINT means the named declaration violates a schema constraint.
Keep a product cap such as `cap 50 by conversationId` when it is a real rule;
the compiler supplies its index. For an audience mismatch, match `sync` to
the read rule rather than exposing private rows. Rerun `snapback4 check`."##;
