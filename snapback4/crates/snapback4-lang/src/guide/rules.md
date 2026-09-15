# Rules

```quarry
table docs:
  ownerId: principal
  title: text <=120
  state: enum('draft', 'final')
  by byOwner: ownerId, id
  read <- .ownerId = viewer or exists editors[.id, viewer]                  -- allow | deny | public ['why'] | .col = viewer | .col != 'x' | exists t[..] | and | or | not
  insert <- .ownerId = viewer and .state = 'draft'
  update (old, next) <- old.ownerId = viewer and next.ownerId = viewer and old.state != 'final'   -- both images of an update
  delete <- .ownerId = viewer

table editors:
  docId: docs
  principal: principal
  unique byDocPrincipal: docId, principal
  by byPrincipalDoc: principal, docId, id
  read <- exists editors[.docId, viewer]
  insert <- exists docs[id = .docId, ownerId = viewer] or created docs[.docId]   -- a probe may name its columns; created: this mutation inserted the row
  delete <- .principal = viewer
```

Each of `read`, `insert`, `update` and `delete` takes one rule over the row
(`.col`), `viewer` and literals. A table without a rule for an effect denies
it. `public 'why'` on its own line is the read rule. An `exists` probe needs
an index over the probed columns (`by index` names one when two match); named
equalities may cover a total unique key and check extra columns on that one row,
for both `exists` and `created`, without an extra index. Every focal field used
by the key or extra tests must be pinned for one verdict to serve a whole page. `created t[..]` is valid in insert rules only. Rules
compare with `=` and `!=` alone: a rule that varies with time is not an
audience a partition can hold (use `expire`). A read rule that is exactly
`exists t[.a, .b, viewer]`, `.col = viewer` or `public` can be synced (guide
sync). The system principal consults no rules, so `system` is never a rule word.
An audience read rule may add `or viewer = 'service:pusher'` (or several
service grants); sync infers its audience without them, and ordinary extra disjuncts still refuse.

For update/upsert, "readable" means the read rule admits the old row in the
pre-write state, before the patch or any of its effects. The engine resolves
id and unique-key targets privately; the update rule judges old and next.

| Target before the write | Refusal details |
| --- | --- |
| Readable | `E_RULE`; `E_CONFLICT` with a read-rule `current`; named `E_CONSTRAINT`; `E_INPUT` |
| Unreadable or absent | `NOT_FOUND` for rule denial, an `update` condition, secondary unique clash, or an incomplete insert patch; no row, index, column or branch detail |

A hidden collision on ordinary insert or `insert ... if absent` stays
`E_RULE`; a readable collision names its index (if-absent returns null).
An update or upsert-patch colliding with a different hidden row returns generic
`E_RULE` when its target is readable and `NOT_FOUND` when its target is unreadable.
Use `upsert counters[recipient] { count: 1 }` under an `update` rule to
write another principal's row. Success discloses the admitted row's existence
and the update rule predicates. It grants no extra stream or snapshot row.
A condition belongs on `update`; an upsert inserts or patches. A condition
needs a row you can read; a blind patch needs none. On a row you cannot read,
immutable columns in a patch are ignored. A readable immutable mismatch still
names the column. Before target lookup, the engine reserves room for the rule
probes and the largest merged image allowed by the schema and supplied patch;
if it cannot fit, `E_BOUND` refuses equally for a hidden or absent target.
A readable maintain over a hidden source is a declared read channel: its
delta can disclose the old contribution. `N_MAINTAIN_DELTA` notes potentially
wider update authority under a separately readable maintain.

Omitted asset columns keep their placement. An explicit asset id on a row you
cannot read must be your own upload, even if it equals the retained id. A rule
probe costs one unit regardless of expired siblings; a uniform false page is
decided from its pinned prefix and returns empty and complete at no charge.


A filtered count can disclose whether a hidden row matched its predicate;
computed groups disclose bucket membership and rank discloses relative values.
The maintain's filter grants no source-row read. N_MAINTAIN_DELTA names the
filter/key/value dependencies and the separately readable target, including
insert/delete channels. Restrict its read audience to close the channel:

```quarry
table posts:
  authorId: principal
  parentId: id ?
  at: time
  by byAuthor: authorId, id
  read <- .authorId = viewer
  insert <- .authorId = viewer
  update <- allow
  online only
maintain originalPostCounts: count posts where .parentId = null by authorId
  read <- .authorId = viewer
  online only
query ownOriginals():
  return originalPostCounts[viewer]
```

Here a writer may update a hidden post, but cannot read that author's count.
Changing the maintain to read <- allow deliberately grants the filtered-delta
channel and produces N_MAINTAIN_DELTA. Hidden-target attempts reserve both
possible aggregate groups, predicate/key work and indexes before inspecting
the old source image.
