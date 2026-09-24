//! The types card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Types

E_QUARRY_TYPE means the expression's type does not fit its position.
The diagnostic names the expected and actual types and the source location.
A table reference is that table's typed id, not its row: read `table[id]`
before selecting fields. Narrow an optional value with `if x != null:`,
`x ! else CODE` or `x ?? default` before using it where a present value is
required. Use the declared enum type when its variants cannot all widen
to the helper's text bound; changing a type never converts stored values.

```quarry
table everything:
  who: principal                      -- the authenticated subject; `viewer` is one
  tag: id                             -- an opaque identity
  parent: everything ?                -- a reference to a table's row: its id
  n: int                              -- an integer within ±(2^53 − 1); there are no floats
  at: time                            -- milliseconds since the epoch; `now` is one
  ok: bool
  price: money USD                    -- money CUR [scale]: integer minor units, scale 2 unless given
  ratio: decimal 4                    -- decimal S: an integer scaled by 10^S
  name: text 1..80                    -- text <=N, or text M..N
  handle: text 3..20 format handle    -- format handle | url is checked on every write
  site: text <=200 format url ?
  kind: enum('a', 'b')                -- a text literal in this position is a variant
  meta: json <=4000 ?
  raw: bytes <=1024 ?
  photo: image <=10000000 once ?      -- an upload (guide assets); `once` serves one view per principal
  clip: video <=50000000 ?
  tags: [text <=20] <=8               -- a bounded list of a scalar type; `?` after the whole type, never on the element
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  read <- .who = viewer
  insert <- .who = viewer
  update <- deny
  delete <- deny

fn label(kind: text <=1): kind
query enumLabel(kind: enum('a', 'b')):
  return label(kind)

query typed(c: cursor ?, handle: text 3..20 format handle):   -- arguments take the same types, plus `cursor ?`
  return everything[handle = handle]
```

`?` after a type makes it optional: null when absent, and an omitted
optional argument reads as null. Text literals in id positions are ids. A
`<table>` reference is a typed id, with no implicit existence check and no
delete cascade: the string `"null"` is an id, and JSON null only fits an
optional type; when a target must be visible, `require exists t[id] else
CODE` before the write (guide writes). `=`
and `!=` are total (null equals null); `<` and friends need present operands:
narrow with `if x != null:`, `x ! else CODE`, or `x ?? default`. A null guard
also narrows a bound row's field (`r.changedAt != null`), until the local is rebound. `time`
arithmetic: `time - time` is an int, `time + int` a time. Duration literals are integer milliseconds:
`now + 30s`, `now - 1d`, `500ms`, `15m` and `7d`. `/` and `%` give
the Euclidean quotient and remainder of ints or times; zero refuses `E_DIV_ZERO`.
An enum is accepted as `text <=N` only if every variant fits N characters
and contains no control characters except tab, LF and CR,
including when both types are optional. This is a static, total widening;
it adds no runtime conversion. Otherwise give the helper parameter the enum
type. `(now / 1) * 1000` explicitly scales integer milliseconds; a scaled
count belongs in an `int` column. Bind an optional helper result once before
its null guard: repeated calls are separate values.
Text `+` concatenates; `count(text)` counts characters. Loop-built strings and
lists are heap-bound; a write still validates their actual column lengths.
A column may end with `default <literal | now | viewer>`. Omitted insert
fields take their defaults before rules run; explicit values, including null
on an optional column, win. `now` and `viewer` use the writing host's context.
An added required column with a literal default also fills absent fields in
old images on every host, without rewriting rows or logging partition events.
Changing a required default rechecks its existing unique indexes and caps too.
`data` and `sql` show that interpretation; device persistence exports are raw storage images.
Optional columns still read null when absent. New required `default now` or
`default viewer` columns adopt only an empty table; otherwise use an optional
column or a literal default. `check` reads `.snapback4/store.sqlite` when it
exists (or `--store path`); `E_ADOPT` locates each successor refusal and its
rewrite, as `dev` refuses the save. Without a store, check only compiles.
Pages, lists and shaped collections share the list operations: `sort`, `slice`,
`count`, `sum`, `group`, `first`, `last`, `at`, `join` and `for`. Their elements
must still fit the operation: `join` joins texts; `sum(page, .amount)` projects numbers.

## Engine-assigned per-parent sequences

`ordinal: sequence by conversationId` is an `int` assigned by the engine
inside the write transaction. The named column must be a required reference
on this table, such as `conversationId: conversations`. E_SEQUENCE_PARENT
names a missing, optional or non-reference parent column and gives the rewrite.
The ordinal and parent reference are immutable; an explicit `immutable ordinal`
is redundant and accepted. Do not supply a value or default.

```quarry
table conversations:
  public 'shared chat identities'
  online only

table messages:
  conversationId: conversations
  ordinal: sequence by conversationId
  public 'shared chat history'
  online only

table members:
  conversationId: conversations
  joinedAt: sequence by conversationId
  public 'shared chat membership positions'
  online only
```

Clique's messages and members share a single counter per conversation row.
A client-supplied integer could pin history forever; engine ownership refuses
that with E_SEQUENCE_SUPPLIED. References retain their ordinary typed-id
semantics: require a visible parent explicitly when the operation needs it.
Counters remain keyed by parent table and id across deletions and reopen.
An explicit store reset clears them with its rows. Adding or rebinding a sequence
on a populated table refuses E_ADOPT with an empty-table rewrite; there is no
implicit historical backfill. An empty table may adopt the declaration.
E_SEQUENCE_EXHAUSTED refuses a transaction that would exceed the maximum int.
The generated schema carries the `sequence-by` engine capability; upgrade
older engines and devices that refuse it with E_SCHEMA_CAPABILITY.
See `guide writes` for prediction, ordering and the complete chat example.

## Runtime values that do not fit

E_TYPE means a runtime value has the wrong kind for the operation using it.
For example, a raw program cannot add the text `'3'` as an integer; supply
`3` as a number and compile the program against its schema. Read the
message's expected and actual types, correct seeds or wire inputs, and
use the generated API types. Changing a declaration does not convert old
values; repair the values before narrowing their type.

E_OVERFLOW means integer arithmetic left the value model's range of
−9,007,199,254,740,991 through 9,007,199,254,740,991. For example,
`9007199254740991 + 1` cannot be represented. Bound the inputs and
intermediate arithmetic before adding or multiplying. Decimal and money
columns store integer minor units in that same range; they do not provide
larger integers. For an overflowing aggregate, reduce its contributions or
split the grouping; the refusal names the view and value column without
revealing a hidden computed sum, and the failed write rolls back.

E_FIELD means a runtime field selection has no such field. For example,
a raw object `{ title: 'hello' }` has no `body`; select `title` or construct
the declared object instead. Compile the program so field names are checked,
and narrow an optional row with `row ! else NOT_FOUND` when presence is
required. Ordinary Quarry field access propagates a null base as null;
that is not evidence that the row exists.

## Tables

For complete index, rule and expiry recipes, open `guide indexes`,
`guide rules` or `guide expire` directly.

- Every table has an implicit unique `id`.
- **Types:** `principal`, `id`, `<table>` (a reference to that table's
  id), `int` (within ±(2^53 − 1); there are no floats), `time`
  (milliseconds), `bool`, `decimal <scale>`, `money <CUR> [scale]` (both
  hold integer minor units), `text <=N`, `text M..N`, either with
  `format handle|url`, `enum('a', 'b')`, `json <=N`, `bytes <=N`,
  `[type] <=N` (a bounded list), `image <=N [once]` and `video <=N` (an
  upload the row holds — `guide assets`); `?` after a type makes the column
  optional (null when absent). `default <literal | now | viewer>` fills an
  omitted insert column on the writing host; an explicit value wins.
  A required literal default also fills absent columns in older rows on every host; optional columns still read null when absent.
  An enum fits `text <=N` when every variant has at most N characters and
  contains no control characters except tab, LF and CR: a
  static, total widening with no runtime conversion. If any variant exceeds
  N, use the enum type on the helper parameter instead.
- **References** are typed ids, with no implicit existence check and no
  delete cascade. The string `"null"` is an id; JSON `null` only fits an
  optional reference. When a mutation requires a visible target, write
  `require exists prompts[promptId] else PROMPT_NOT_FOUND` before its
  writes: a metered point read that refuses absent and hidden targets
  alike. Target deletion and dependent-row cleanup are the application's
  policy, expressed in mutations and rules.
- **Keys and search:** `unique handle` or `unique postId, principal` enforces
  a product key. Add `else HANDLE_TAKEN 'That handle is taken.'` for a visible
  collision's code and message. Named keys cover ambiguous arities. Use
  `search body, caption` for word-prefix search. Predicates and `by .at`
  choose access indexes automatically; `guide indexes` explains inspection
  and optional tuning. `unique principal, day(at)` gives calendar uniqueness.
- **Constraints:** `cap N by cols` (at most N rows per group; a product constraint), `immutable cols`, `after insert <- exists
  t[..]` (a row that must exist by the end of the mutation that inserted
  this one).
- **Rules:** `read`, `insert`, `update`, `delete`, each `<-` one
  expression over the row (`.col`), `viewer`, and literals: `allow`,
  `deny`, `public` (or the table line `public 'reason'`, which also
  documents why), `.col = viewer`, `.col != 'x'`,
  `exists t[.a, viewer, 'literal']` (a probe may name its columns:
  `exists t[id = .docId, ownerId = viewer]`), `created t[..]` (insert rules
  only: true when this mutation inserted the probed row), `and`, `or`,
  `not`. `update (old, next) <- old.x = next.x` names both images. A table
  with no rule for an effect denies it. A rule may probe existence on an aggregate view
  over an expiring source at one unit, but `check` refuses an equality on its
  `value` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the view in the program;
  its live value cannot be probed at one unit. Equalities on non-expiring
  maintains and ordinary tables are unchanged. Rules compare with `=` and `!=`
  only; the system principal consults no rules. Write authority and refusal
  disclosure are separate, as `guide writes` states.
- **Sync** (`guide sync`) and **retain**: `retain until-revoked` (the default: a
  device drops a group's rows when it leaves the group) or
  `retain delivered-history` (it keeps what it was given).
- **Expire:** `expire at .expiresAt` (a `time ?` column; its sweep index is generated). A row past that time is
  absent to every reader on every host from that moment, before any rule;
  the server sweeps it within a second and the deletion streams to each
  device holding it. An already returned answer keeps the row until the
  next answer; a live reader that must hide it at its deadline drops it
  locally by `expiresAt` (the client example in CLIENT-AND-OPERATIONS.md).
  A typing indicator or short-lived presence row especially needs this
  filter and a render timer; `guide reads` shows the typing table and query.
  This is an application table, separate from the server's `connected[p]`.
  That server-decided connection signal has no `expiresAt`.
  The server will not return it again after expiry, but does not push a
  removal at that instant.
  A null time never expires. Disappearing messages
  are one field on insert, `expiresAt: now + ttl if ttl != null else
  null` with `ttl: int ?`; nothing else to write. A maintained `view` over an
  expiring table recomputes its live source group at read time, before the
  sweep; a partial device reports `complete: false`. If the meter interrupts
  a maintained lookup or live group, the query returns `data: null,
  complete: false`, without substituting zero or a partial total.
  Value-order indexes over expiring sources are refused
  (`E_QUARRY_MAINTAIN_EXPIRE`): live values change before the physical sweep,
  so stored top-N can miss a winner. For a window over the entity's own
  immutable time, `guide feeds` gives a predicate over a non-expiring source. A rolling
  contribution window still needs live counts; a cut makes that answer incomplete."##;
