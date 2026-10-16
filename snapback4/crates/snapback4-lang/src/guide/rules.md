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

### Hops, operators and read through
Write rules and `after insert` keys allow three live hops: `.reaction.message.conversation`, including `exists members[.message.conversation, viewer]`. `messages[id = .message].conversation` is equivalent. Every target must be live and readable; absent, expired or hidden targets remain unknown under `not` and `= null`. Program lookups (`t[id] !`, `exists`) are reads too: a row the caller cannot read is NOT_FOUND there, before any later `require` or the delete/update rule runs, so give a moderator read access to what they moderate, or delete by id without a lookup and let the delete rule decide (`guide refusals` has the recipe). `check` notes N_UNREADABLE_PROBE on guards without proved read authority; use unique/cap/after insert constraints for global absence across hidden rows.
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

### A child inherits its parent's readers
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

### Clique receipts and reactions
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

### Row rules, probes and rule spelling

A bare `exists` probe in a table rule never inherits the target's read rule: it tests the keyed row even when the caller cannot read it.
Program `exists` is a caller-filtered read. Dotted membership hops in read rules are only `read through` (whole parent rule, immutable captures and inherited lifetime).
An online-only one-hop equality may instead lower to its explicit keyed probe, as described below; it also inherits no target read rule.
For the parent's current department roster, use `guide rule-recipes current-roster`.

A view grouped directly by the parent reference is read by key, such as `totals[issue]`; scanning its groups is refused. An unknown parent or unknown child coverage leaves that device count incomplete, never an invented zero. For independent row rules, use the comparisons and keyed probes below.

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
by the key or extra tests must be pinned for one verdict to serve a whole page. `created t[..]` is valid in insert rules only. A rule cannot vary
with time (use `expire`). A read rule that is exactly
`exists t[.a, .b, viewer]`, `.col = viewer` or `public` can be synced (guide
sync). The system principal consults no rules, so `system` is never a rule word.
An audience read rule may add `or viewer = 'service:pusher'` (or several service grants); sync infers its audience without them, and ordinary extra disjuncts still refuse.

E_QUARRY_RULE_SPELLING locates a guessed table rule: `select <-` and `view <-` become `read <-`, `create <-` becomes `insert <-`, `modify <-` and `edit <-` become `update <-`, and `remove <-` becomes `delete <-`. For `write <-`, declare separate insert, update and delete rules for the operations intended.

### What a refused write returns: E_RULE, NOT_FOUND, E_UNIQUE, E_CONSTRAINT

A mutation's `require` decides intent; each write still passes its table's rule. An unnamed update rule judges old and next. For a deliberate pre-write gate, use `update (old, next) <- old.owner = viewer and old.state = 'pending'`; that permits leaving pending, so constrain next too when the policy needs it. `E_RULE` identifies table authorization; `why recent` privately names the failing old/next image (or the named transition). Hidden targets retain `NOT_FOUND`, with no image or clause exposed to the caller. See: `guide rule-recipes update-images`.

For update/upsert, "readable" means the read rule admits the old row in the pre-write state, before the patch or any of its effects. The engine resolves id and unique-key targets privately; the update rule judges old and next.

A mutation's writes pass the table's insert, update and delete rules as the caller; only a job runs as the system. `check` also notes N_WRITE_DENIED (table authorization layer and contradictory old/next image) when preceding caller conditions provably contradict the update rule, including the update arm of an upsert; N_LOOKUP_NEVER_VISIBLE identifies a nullable point lookup whose read rule contradicts those conditions. Unknown role overlap is quiet. `check` notes N_WRITE_DENIED for a mutation's write (or upsert arm) whose rule is `deny` or omitted: write the rule its callers need, or do the write in a job. It notes the same code for a counter (`stock: v.stock - 1`) on a table whose update rule admits only a role, in a mutation that ordinary callers use and that never requires the role: keep the count as a maintained view over the rows they write instead. `check` notes N_READ_DENIED for a query or mutation that looks up an aggregate by key whose read rule is `deny`: every caller reads `null` for both a stored and absent group, so give it the rule its readers need over its group keys. In development, `snapback4 run` prints the clause that refused a write and its line; the refusal a client sees never names it. `insert` and `insert ... if absent` return E_RULE when the insert rule denies
the viewer. A unique clash with a hidden row returns E_RULE for either insert
form. For a readable secondary unique clash without a custom refusal, ordinary
insert returns E_UNIQUE naming the declared key, while `insert ... if absent`
succeeds with null. If the update rule denies an update or upsert-patch, it
returns E_RULE for a readable target and NOT_FOUND for an unreadable target. A
valid update or upsert-patch admitted by the update rule can change a hidden
row; if the resulting row remains hidden, it returns null. Without a custom
unique refusal, an update or upsert-patch with a secondary unique clash returns
NOT_FOUND if its target is unreadable, E_RULE if only the colliding row is
unreadable, and E_UNIQUE naming the declared key if both are readable. An update
condition on an unreadable target returns NOT_FOUND even if it would match; on a
readable target, a false condition returns E_CONFLICT with a read-rule
`current`. Delete returns NOT_FOUND for a missing id or an unreadable refused target, and E_RULE for a readable row whose delete rule refuses. Reading a
hidden row returns null. Use a write admitted by its rule; NOT_FOUND on an
update or upsert-patch does not prove absence.

| Update/upsert target before the write | Refusal details |
| --- | --- |
| Readable | `E_RULE`; `E_CONFLICT` with a read-rule `current`; named `E_UNIQUE` for declared keys; `E_CONSTRAINT` for other constraints; `E_INPUT` |
| Unreadable or absent | `NOT_FOUND` for rule denial, an `update` condition, secondary unique clash, or an incomplete insert patch; no row, index, column or branch detail |

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

### Refusal ladder

For a body written as asserted lookup → write → require, the ladder is: decode (`E_INPUT`) → hidden lookup (`NOT_FOUND`) → table rule (`E_RULE` on a readable denied target) → the authored `require` code. After decoding, actual statement order decides: a require before a write runs first; a later require cannot replace an earlier refusal. A nullable hidden lookup returns null; an asserted lookup uses its authored `else` code, conventionally NOT_FOUND. Hidden update/delete denial stays NOT_FOUND. Mutations roll back earlier writes.

An upsert follows the same statement-order ladder. On a readable existing
row whose update rule refuses, ladderPut returns E_RULE; on a hidden denied
row it returns NOT_FOUND. An absent own row passes insert, then AFTER_WRITE
refuses and rolls that insert back. The later require cannot rename the
write's refusal.

```quarry
use personas alice, bob, carol
table ladderCounters:
  owner: principal
  value: int
  open: bool default false
  unique owner
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer and .open = true
  online only
mutation ladderPut(owner: principal):
  upsert ladderCounters[owner = owner] { owner, value: 1 }
  require false else AFTER_WRITE
query ladderCounter(owner: principal):
  return ladderCounters[owner = owner]
```

A query over hidden rows is complete and empty when its scope uniformly refuses the viewer. A nonuniform scan may be partial even with zero visible rows; an empty list alone proves neither access nor physical absence. See: `guide rule-recipes role-workflow` for independently enforced table and mutation authority, and `guide refusals` for write-internal ordering.

### Disclosure: aggregates, assets and maintained columns
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

### Private owned fields
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
Private-field rule inputs require a named transition and ownership or audience
visibility; ordinary writers cannot test another owner's private value.
Accounting, nullable self-comparisons and expiring authority witnesses are
specified in `snapback4 why E_FIELD_AUTHORITY`.

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
default, and omit the field when writing another principal's row. A private
field in an index or aggregate needs `readable by audience` (after `written by`)
when that disclosure fits. An unreadable update or refused delete target, and an
absent upsert refused by insert authority or field ownership, keep `NOT_FOUND`
with the same refusal and meter. Direct inserts and readable targets keep
`E_FIELD_AUTHORITY`; the system keeps its rule bypass. A page over private
fields must "scope this read to a uniformly readable audience" (a walk over
hidden rows counts them): `check` refuses a scan its pins do not decide, role
guard or not. Pin the read rule's column (`visits where .parent = viewer`), move
the field to its own table keyed by the row, or make it `readable by audience`.

Read-through repairs: `why E_READ_THROUGH`, `why E_READ_THROUGH_ADOPT`,
`why E_PARENT_HAS_CHILDREN` and `why E_READ_THROUGH_SCAN`.

Membership paths spelling the whole parent rule lower to `read through`. Without sync, a one-hop read-rule equality (`.author = viewer or .goal.owner = viewer`) is the probe `exists goals[.goal, owner = viewer]`;
other read reference expressions (two hops, `!=`, a synced table) remain unsupported. Write rules admit live chains as above. Parent-key aggregates inherit the read rule. A diagnostic never suggests dropping the parent hop. An aggregate
read line proved identical to the parent's rule has a whole-line repair;
additional conditions remain a modeling choice and are not removed by `--fix`.
