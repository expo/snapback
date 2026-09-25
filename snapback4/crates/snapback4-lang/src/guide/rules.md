# Rules

```quarry
table docs:
  ownerId: principal
  title: text <=120
  state: enum('draft', 'final')
  read <- .ownerId = viewer or exists editors[.id, viewer]                  -- allow | deny | public ['why'] | .col = viewer | .col != 'x' | exists t[..] | and | or | not
  insert <- .ownerId = viewer and .state = 'draft'
  update (old, next) <- old.ownerId = viewer and next.ownerId = viewer and old.state != 'final'   -- both images of an update
  delete <- .ownerId = viewer

table editors:
  docId: docs
  principal: principal
  unique docId, principal
  read <- exists editors[.docId, viewer]
  insert <- exists docs[id = .docId, ownerId = viewer] or created docs[.docId]   -- a probe may name its columns; created: this mutation inserted the row
  delete <- .principal = viewer
```

Each of `read`, `insert`, `update` and `delete` takes one rule over the row
(`.col`), `viewer` and literals. A table without a rule for an effect denies
it. `public 'why'` on its own line is the read rule. The compiler supplies indexes for `exists` probes; named
equalities may cover a total unique key and check extra columns on that one row,
for both `exists` and `created`, without an extra index. Every focal field used
by the key or extra tests must be pinned for one verdict to serve a whole page. `created t[..]` is valid in insert rules only. Read, insert and delete rules
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
A readable aggregate view over a hidden source is a declared read channel: its
delta can disclose the old contribution. `N_MAINTAIN_DELTA` notes potentially
wider update authority under a separately readable aggregate view.

Omitted asset columns keep their placement. An explicit asset id on a row you
cannot read must be your own upload, even if it equals the retained id. A rule
probe costs one unit regardless of expired siblings; a uniform false page is
decided from its pinned prefix and returns empty and complete at no charge.


A filtered count can disclose whether a hidden row matched its predicate;
computed groups disclose bucket membership and rank discloses relative values.
The view's filter grants no source-row read. N_MAINTAIN_DELTA names the
filter/key/value dependencies and the separately readable target, including
insert/delete channels. Restrict its read audience to close the channel:

```quarry
table posts:
  authorId: principal
  parentId: id ?
  at: time
  read <- .authorId = viewer
  insert <- .authorId = viewer
  update <- allow
  online only
view originalPostCounts: count posts where .parentId = null by .authorId
  read <- .authorId = viewer
  online only
query ownOriginals():
  return originalPostCounts[viewer]
```

Here a writer may update a hidden post, but cannot read that author's count.
Changing the aggregate view to read <- allow deliberately grants the filtered-delta
channel and produces N_MAINTAIN_DELTA. Hidden-target attempts reserve both
possible aggregate groups, predicate/key work and indexes before inspecting
the old source image.


A maintained column such as `likeCount: count likes by postId` belongs to the
engine, while ordinary fields keep their existing writer rules. Source rules
authorize contributions; parent readers receive the count, including counts
over private sources. Rules and their probes cannot depend on maintained
fields. Adding or redefining the column recounts and mirrors live parents
without consulting parent write rules; its event-free generation barrier
reacquires devices and wakes server-run parent watches. See `guide maintains`.

## Field authority: written by

`readUpTo: int default 0 written by .principal` gives that field its own
writer: the required `principal` column on the same row. An insert by anyone
else omits it and receives the declared default. Supplying even the default
explicitly requires ownership. On update and the patch arm of upsert, the old
row's owner authorizes each touched owned field. Other touched fields still
require the row's update rule. An owner can patch just their fields when the
table has no update rule. A named `update (old, next)` rule also constrains
owner writes; it can compare matching integers or times with `<`, `<=`, `>`
and `>=`. Read rules keep their equality-only contract.

The field is private to its owner unless declared `readable by audience`.
Group/public log images omit private fields; the owner's principal partition
carries their image, and every owner's device receives it while the row is
readable. Queries, shapes, write results and snapshots apply the same
projection. Selecting an omitted field returns null, including in `{ * }` and as a `group`
or `sort` key; generated row types
mark the field optional. Asset downloads apply the same field visibility.
Field ownership does not grant read access to the row. Ownership changes
redact the former owner's copy, or remove it if the row also becomes unreadable.
A device queues a transition that needs another owner's omitted value or
would acquire ownership of that value. An independent owned-field patch on a
held row predicts when its own transition and resource limits permit it.
Untouched self-equalities do not require the omitted value. Ordinary row grants do not add dependencies to such a patch.
Unknown owner-delivery witnesses also do not prevent that prediction; the
server decides which owners may receive the committed image.
Only a named `update (old, next)` transition may use a private field as a
rule input; ordinary update rules cannot test guesses against it. A named
transition also cannot make an ordinary writer's success depend on another
owner's private value. Such a test requires ownership (or audience visibility).
Comparing an untouched private field with itself, such as
`next.readUpTo = old.readUpTo`, remains available without knowing its value.
Ordered self-comparisons require visibility when the field is nullable: null
is not ordered, so even `next.secret >= old.secret` can reveal nullness.
Retained write-target copies are charged at declared column bounds, so hidden
lengths cannot change the writer's meter or exhaustion boundary.
Private fields cannot supply indexes/cursors, expiry, recorded attribution,
other rules' probes, aggregate inputs, or Following mappings and predicates; make the field readable by audience
before using it there. This applies to both `view` and `maintain … timeline`.
Your meter charges only fixed reservations from declared bounds and results
that pass both row-read and field authorization; hidden candidates and rule
witnesses cannot change its charges or exhaustion boundary.
This includes point reads, range/cursor pages, planned views, word search,
streaming counts/sums, scalar reductions and recorded public columns.
Unreadable, private or expiring candidates reserve declared decoder bounds:
a large declaration can exhaust the heap even for an empty value. Public,
non-expiring rows without private fields or recorded captures establish authority before
storage access and use actual-size decoder accounting. Expired scan candidates
are discarded inside the internal ledger before any payload is priced.
Authorization witnesses expose their verdict and only the deadline needed by
a sufficient authorization proof. An independent non-expiring grant discards
a redundant witness deadline; a necessary expiring grant keeps its deadline
for invalidation. Failed branches export no dependency. Candidate decoding
and rule evaluation use an internal ledger until row authority is established.
Owner delivery prepays the declared recipient/probe bound; hidden
membership outcomes cannot change the writer's meter. Mutation event counts
count each changed private row once, independently of owner fanout. A scan of a table
with private fields must establish a uniformly readable scope before visiting
server rows; otherwise it refuses with E_FIELD_AUTHORITY. Pin the audience
key (for example `[reader = viewer]`) or query the acquired device partition.
`check` prints each field's owner and visibility.

Clique read marks use this recipe. Add `readable by audience` after
`written by .principal` when other conversation members should see receipts.
The monotonic rule is an application decision, enforced on the server and
under prediction. `markRead` predicts on a held row, including offline.

```quarry
table conversations:
  creator: principal
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  sync to members[.id]
table members:
  conversationId: conversations
  principal: principal
  readUpTo: int default 0 written by .principal
  unique conversationId, principal
  cap 100 by conversationId
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- created conversations[.conversationId] or exists members[.conversationId, viewer]
  update (old, next) <- next.readUpTo >= old.readUpTo
  sync to members[.conversationId]
mutation markRead(memberId: members, readUpTo: int) predicts:
  update members[memberId] { readUpTo }
```

E_FIELD_AUTHORITY means an owner declaration is invalid, or a supplied/updated
field is not yours. Name a required principal column on this table, declare a
default, and omit the field when writing another principal's row. For a private
field needed in an index or aggregate, append `readable by audience` only when
that disclosure matches the application. It requires `written by` first.
An unreadable update or refused delete target, and an absent upsert refused
by either insert authority or field ownership, keep `NOT_FOUND` with the same
refusal and meter. This includes callers whose insert rule allows the row but
who cannot supply another owner's private field. Direct inserts and readable targets retain
`E_FIELD_AUTHORITY` with the owner-specific repair. The trusted system
principal retains its existing rule bypass.
