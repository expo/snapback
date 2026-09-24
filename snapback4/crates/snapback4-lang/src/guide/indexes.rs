//! Index choice and optional tuning. Examples compile in tests/guide.rs.
pub(super) const CARD: &str = r##"# Indexes: chosen from the read

State the predicate and order. `check` chooses an existing index or creates
one. Rules, sync, caps and expiry also obtain their access indexes. A table
needs no `by` declaration for these reads:

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

`unique ownerId, projectId` is a product constraint: one row per pair.
`tasks[id]` always means the row's id. A multi-value positional key needs
exactly one declared unique key of that arity, in its declared order.
Name columns when several keys have that arity: `tasks[ownerId = viewer,
projectId = projectId]`. Synthesized indexes never choose positional meaning.
A visible unique collision uses the optional `else CODE 'message'` hook;
a hidden collision keeps its ordinary authorization refusal. `if absent`
returns null on a visible clash. Codes are UPPER_SNAKE and never start with E_.

## See the plan, then tune it

Run `snapback4 check --cost` for chosen and synthesized indexes and the reads
that need them. `snapback4 why <operation>` shows each source site, selected
index, key bindings and result form. These are structural facts; use the dev
read meter to measure actual work (`guide reads`).

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

E_CONSTRAINT means a unique key, product cap, immutable field, format or
postcondition rejected the write. Keep the rule and correct the named input.
For a visible duplicate handle, choose a different handle; `if absent` is
appropriate only when doing nothing on an existing row is the intended write.


E_INDEX_KEY_BYTES means an encoded key exceeds 2048 bytes, including its
components and row id. Bound the named text column, for example `text <=80`,
and shorten or delete old oversized values before adoption. Index checks
allow up to four UTF-8 bytes per character. Table and index names together
must fit 512 UTF-8 bytes. Deletes remain available; updates may retain or
shorten existing oversized keys without growing their lengths or count.
Both server stores and devices enforce new keys; search tokens have their own cap.

E_CURSOR_INDEX concerns an older explicit index that lacks a total order.
For new reads, use `tasks where .ownerId = viewer first 20 by .at after c`:
the planner adds the id tiebreak. For a non-unique explicit index, append `id`
to its definition or apply the diagnostic's mechanical `check --fix`.
Keep nullable unique constraints unchanged; use the column-ordered read
above to obtain a separate page index without weakening uniqueness.

E_QUARRY_AMBIGUOUS means an older positional read matches several keys.
Name the key columns for a point, or write `tasks where .ownerId = viewer
first 20 by .at after c` for a page. Types validate a selected key; they do
not choose between keys.

E_SCHEMA_CONSTRAINT means the named declaration violates a schema constraint.
Keep a product cap such as `cap 50 by conversationId` when it is a real rule;
the compiler supplies its index. For an audience mismatch, match `sync` to
the read rule rather than exposing private rows. Rerun `snapback4 check`.
"##;
