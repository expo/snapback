# Rules

**Start here:** Reactions inherit their message's conversation membership; this excerpt uses the complete schema below. The dotted rule and audience are sugar for `read through` and inferred `sync`, including parent lifetime and insert authority.

```quarry
table reactions:
  message: messages
  immutable message
  read <- exists members[.message.conversation, viewer]
  sync to members[.message.conversation] last 500 by .id
```

- `E_READ_THROUGH`: the path must spell the whole parent rule; use a required immutable reference without a default, and immutable parent rule/expiry fields.
- `E_QUARRY_SELF_EQUALITY`: a nested predicate compares its row to itself; capture the outer value in a local before entering that predicate.
- `E_RULE`: a write lacks authority (mutations write as the caller; omitted rules deny); require a live readable parent and the child's insert rule, and under `dev` read the refusing clause with `snapback4 why recent`.

## Reference

Write rules and `after insert` keys allow three live hops: `.reaction.message.conversation`, including `exists members[.message.conversation, viewer]`. `messages[id = .message].conversation` is equivalent.
Every target must be live and readable; absent, expired or hidden targets remain unknown under `not` and `= null`. Program lookups (`t[id] !`, `exists`) are reads too: a row the caller cannot read is NOT_FOUND there, before any later `require` or the delete/update rule runs, so give a moderator read access to what they moderate, or delete by id without a lookup and let the delete rule decide (`guide refusals` has the recipe).
Each occurrence prepays one probe, including skipped branches. `check --cost`/`why` list them; prediction needs every read covered.
Insert uses the new image; an unnamed `update <- R` must hold for both the row before and the row after the write (pair `update <- .owner = viewer` with `immutable owner`); a named `update (old, next)` judges exactly what it names; delete uses its pre-delete image; final obligations resolve at transaction end. Read-through capture/lifetimes stay unchanged. Null guards narrow only the same term and image.
Beyond three hops, private/maintained fields and ephemeral targets refuse E_QUARRY_RULE_HOP with concrete mutation `require` checks. A rule says `=`/`!=` over `.col`, `viewer` and literals, `exists`/`created` probes and `and`/`or`/`not`; it orders (`<`, `>=`) only an insert row's own required int/time/decimal/money columns (`.stars >= 1`; an integer literal beside money is minor units) and `update (old, next)` images of the same types. The clock, arithmetic, helper calls and `else CODE` are E_QUARRY_RULE_OPERATOR: a `require … else CODE` in the mutation (`snapback4 why E_QUARRY_RULE_OPERATOR` prints the table of rule forms).

```quarry
table orgs:
  read <- exists members[.id, viewer]
  insert <- allow
  online only
table members:
  org: orgs
  principal: principal
  unique org, principal
  read <- .principal = viewer
  insert <- created orgs[.org] or exists members[.org, viewer]
  online only
table issues:
  org: orgs
  title: text <= 200
  comments: count comments by issue
  immutable org
  read through .org
  insert <- allow
  online only
table comments:
  issue: issues
  author: principal
  body: text <= 2000
  immutable issue
  read through .issue
  insert <- .author = viewer
  delete <- .author = viewer
  online only
query discussion(issue: issues, c: cursor ?):
  comments where .issue = issue first 20 by .id after c
```

A child names one required immutable reference, without a default, to an ordinary application table. `read through` is its whole read rule; put service grants on the parent. The parent's read-rule fields and authored expiry must be immutable. An insert also needs a live parent readable by the writer, before the child's insert rule runs. The engine captures those inputs; they travel with sync images but never appear in query rows or accept payload values.

Each child expires no later than its parent, through any number of levels. A parent's delete needs read authority and waits until its children are deleted and expired children swept. Its id cannot be reused while physical children remain. A mutable child deadline can shorten its life but cannot extend it past the parent.

`sync` infers exactly the parent's substituted audience after service grants are removed. A conjunction such as membership and an archived flag stays `online only`; `check --verbose` explains its server reads. A parent-pinned page resolves authorization once, while completeness still requires the child's own coverage. An unknown or mismatched parent takes the server fallback. Retained history stays marked `retained: true` beside the server's current page.
On these syncing delivered-history children, `retained` is row metadata; name an
application column `wasRetained` instead. Row shapes and spreads preserve the mark.

A device predicts a plain child insert only with a live parent covered by its
current partition, or one predicted in the same pending chain. An unheld, expired
or retained-only parent queues without a row. Upserts and `insert … if absent` need complete child-group coverage
to prove absence; changed unique keys or cap groups need their populations covered. A parent delete requires full current child
coverage and no live children. Expiry uses the later of the device's supplied
clock and the last atomically applied server time.

Clique receipts and reactions need only their message reference. The unread view uses the captured conversation field and inherits its rule, without an explicit `read` or copied deadline. These parents stay online, so reaction pages use the server:

```quarry
table conversations:
  read <- exists members[.id, viewer]
  insert <- allow
  online only

table members:
  conversation: conversations
  principal: principal
  immutable conversation, principal
  unique conversation, principal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation] or exists members[.conversation, viewer]
  online only

table messages:
  conversation: conversations
  sender: principal
  body: text <= 2000
  until: time ?
  immutable conversation, until
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  expire at .until
  online only

table receipts:
  message: messages
  principal: principal
  state: int
  immutable message, principal
  unique message, principal
  read through .message
  insert <- created messages[.message] or .principal = viewer
  update <- .principal = viewer
  online only

table reactions:
  message: messages
  immutable message
  read <- exists members[.message.conversation, viewer]
  sync to members[.message.conversation] last 500 by .id
  principal: principal
  emoji: text <= 20
  immutable principal
  unique message, principal
  insert <- .principal = viewer and exists members[.message.conversation, viewer]
  delete <- .principal = viewer and exists members[.message.conversation, viewer]

view unread: count receipts where .state < 2 by .message.conversation, .principal
  online only

query unreadFor(conversation: conversations):
  unread[conversation, viewer]
query received(message: messages, c: cursor ?):
  receipts where .message = message first 50 by .principal after c { id, principal, state }
query reacted(message: messages, c: cursor ?):
  reactions where .message = message first 50 by .principal after c { id, principal, emoji }
```

A view grouped directly by the parent reference is read by key, such as
`totals[issue]`; scanning its groups is refused. An unknown parent or unknown
child coverage leaves that device count incomplete, never an invented zero.
For independent row rules, use the comparisons and keyed probes below.

```quarry
table docs:
  ownerId: principal
  title: text
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
  insert <- exists docs[.docId, ownerId = viewer] or created docs[.docId]   -- a probe may name its columns; created: this mutation inserted the row
  delete <- .principal = viewer
```

Each of `read`, `insert`, `update` and `delete` takes one rule over the row
(`.col`), `viewer` and literals. A table without a rule for an effect denies
it. `public 'why'` on its own line is the read rule. The compiler supplies indexes for `exists` probes; named
equalities may cover a total unique key and check extra columns on that one row,
for both `exists` and `created`, without an extra index. A full positional unique
key may come first, followed by named extra-column tests, as in
`docs[.docId, ownerId = viewer]`. Every focal field used
by the key or extra tests must be pinned for one verdict to serve a whole page. `created t[..]` is valid in insert rules only. Read and delete rules
compare with `=` and `!=` alone, insert rules order only the row's own required int/time columns: a rule that varies with time is not an
audience a partition can hold (use `expire`). A read rule that is exactly
`exists t[.a, .b, viewer]`, `.col = viewer` or `public` can be synced (guide
sync). The system principal consults no rules, so `system` is never a rule word.
An audience read rule may add `or viewer = 'service:pusher'` (or several
service grants); sync infers its audience without them, and ordinary extra disjuncts still refuse.

E_QUARRY_RULE_SPELLING locates a guessed table rule: `select <-` and `view <-`
become `read <-`, `create <-` becomes `insert <-`, `modify <-` and `edit <-`
become `update <-`, and `remove <-` becomes `delete <-`. For `write <-`,
declare separate insert, update and delete rules for the operations intended.

For update/upsert, "readable" means the read rule admits the old row in the
pre-write state, before the patch or any of its effects. The engine resolves
id and unique-key targets privately; the update rule judges old and next.

A mutation's writes pass the table's insert, update and delete rules as the caller; only a job runs as the system. `check` notes N_WRITE_DENIED for a mutation's write (or upsert arm) whose rule is `deny` or omitted: write the rule its callers need, or do the write in a job. `check` notes N_READ_DENIED for a query or mutation that looks up an aggregate by key whose read rule is `deny`: every caller reads its zero value as if it were real (a `maintain … read <- deny` looked up in a shape reads as 0), so give it the rule its readers need over its group keys. In development, `snapback4 run` prints the clause that refused a write and its line; the refusal a client sees never names it. `insert` and `insert ... if absent` return E_RULE when the insert rule denies
the viewer. A unique clash with a hidden row returns E_RULE for either insert
form. For a readable secondary unique clash without a custom refusal, ordinary
insert returns E_CONSTRAINT naming the index, while `insert ... if absent`
succeeds with null. If the update rule denies an update or upsert-patch, it
returns E_RULE for a readable target and NOT_FOUND for an unreadable target. A
valid update or upsert-patch admitted by the update rule can change a hidden
row; if the resulting row remains hidden, it returns null. Without a custom
unique refusal, an update or upsert-patch with a secondary unique clash returns
NOT_FOUND if its target is unreadable, E_RULE if only the colliding row is
unreadable, and E_CONSTRAINT naming the index if both are readable. For rule
denial, an update condition or a secondary unique clash on an unreadable target,
NOT_FOUND carries no row, index, column or branch detail. A missing update
target or an incomplete upsert insert patch returns NOT_FOUND. An update
condition on an unreadable target returns NOT_FOUND even if it would match; on a
readable target, a false condition returns E_CONFLICT with a read-rule
`current`. Delete returns NOT_FOUND for a missing id or an unreadable refused target, and E_RULE for a readable row whose delete rule refuses. Reading a
hidden row returns null. Use a write admitted by its rule; NOT_FOUND on an
update or upsert-patch does not prove absence.

| Update/upsert target before the write | Refusal details |
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
wider update authority under a separately readable aggregate view. Restrict its
read audience or source write authority if that delta is private.

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
other rules' probes, aggregate source inputs, or Following mappings and predicates; make the field readable by audience
before using it there. A row-keyed count may use a private member predicate
when the member read rule requires that field's owner; `guide maintains` gives
the admission rule. This applies to both `view` and `maintain … timeline`.
Point reads, writes and authorization witnesses charge fixed declared
reservations and results that pass row-read and field authorization. Range
and cursor pages retain an examined-count residual: some scan paths charge
candidates before rejecting expired or unreadable rows, so examined counts
and meter cuts can vary within the physical walk bound. A private page that
exhausts that bound cannot expose a hidden continuation key, including when
a nested witness consumes the allowance.
Unreadable, private or expiring candidates reserve declared decoder bounds:
a large declaration can exhaust the heap even for an empty value. Public,
non-expiring rows without private fields or recorded captures establish authority before
storage access and use actual-size decoder accounting. Expired scan candidates
are discarded inside the internal ledger before any payload is priced.
Authorization witnesses expose their verdict and the earliest expiry instant
at which the complete rule's verdict can change. All witnesses expiring at
that instant disappear together; correlated alternatives share this timeline.
A stable grant needs no deadline, while necessary expiring authority does.
The bounded branch walk depends on rule structure and verdicts, never on
whether a private witness is permanent or expiring. Alternatives needed for
the complete timeline are visited in both cases.
Failed predicates and denied rows export no deadline.

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

Read-through repairs: `why E_READ_THROUGH`, `why E_READ_THROUGH_ADOPT`,
`why E_PARENT_HAS_CHILDREN` and `why E_READ_THROUGH_SCAN`.

Membership paths spelling the whole parent rule lower to `read through`; other
read reference expressions remain unsupported. Write rules admit live chains as above. Parent-key aggregates inherit the read rule. A diagnostic never suggests dropping the parent hop. An aggregate
read line proved identical to the parent's rule has a whole-line repair;
additional conditions remain a modeling choice and are not removed by `--fix`.
