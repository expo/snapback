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
  unique byHandle: handle else HANDLE_TAKEN 'That handle is taken.'
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
arithmetic: `time - time` is an int, `time + int` a time. `/` and `%` give
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
larger integers. For an overflowing maintain, reduce its contributions or
split the grouping; the refusal names the maintain and value column without
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

- Every table has an implicit `id` and a unique `byId` index.
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
- **Indexes:** `by name: cols` orders rows; `unique name: cols` also
  constrains them. Add `else HANDLE_TAKEN 'That handle is taken.'` to a
  unique index to supply its refusal code and message; `detail` retains the
  original index text for development. The message literal is optional;
  `else HANDLE_TAKEN` says `the program refused with HANDLE_TAKEN`.
  Codes follow `require`: UPPER_SNAKE, never `E_`, declared at the use site.
  Without the hook the `E_CONSTRAINT` message is unchanged. A point read needs a unique index over its key;
  In a program, `exists` uses an exact-key index when present, or a strict prefix scan. Rule probes need an index over exactly their keys. Named equalities covering a total
  unique key check extra columns on the one row, with no extra index; a scan needs an index whose
  leading columns are the scan's prefix, and pages in the order of the
  remaining columns; a cursor needs an index ending in `id` or a unique one.
  `by index` names one when two match. `by name: scope, words(text cols),
  at, id` is a words index: one entry per distinct word of the named text
  columns, read with `matching` (`guide search`) and nothing else.
  `day(at)`, `hour(at)` and `bucket(at, 2h, 30m)` are time key components in
  a table's `by` or `unique` list, at any position, once per function per index;
  they use a required time column and add no column to the row.
- **Constraints:** `cap N by cols` (at most N rows per group; needs an index
  leading with those columns), `immutable cols`, `after insert <- exists
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
  with no rule for an effect denies it. A rule may probe existence on a maintain
  over an expiring source at one unit, but `check` refuses an equality on its
  `value` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the maintain in the program;
  its live value cannot be probed at one unit. Equalities on non-expiring
  maintains and ordinary tables are unchanged. Rules compare with `=` and `!=`
  only; the system principal consults no rules. Write authority and refusal
  disclosure are separate, as `guide writes` states.
- **Sync** (`guide sync`) and **retain**: `retain until-revoked` (the default: a
  device drops a group's rows when it leaves the group) or
  `retain delivered-history` (it keeps what it was given).
- **Expire:** `expire at .expiresAt` (a `time ?` column with an index
  leading with it, `by byExpiresAt: expiresAt`). A row past that time is
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
  null` with `ttl: int ?`; nothing else to write. A `maintain` over an
  expiring table recomputes its live source group at read time, before the
  sweep; a partial device reports `complete: false`. If the meter interrupts
  a maintained lookup or live group, the query returns `data: null,
  complete: false`, without substituting zero or a partial total.
  Value-order indexes over expiring sources are refused
  (`E_QUARRY_MAINTAIN_EXPIRE`): live values change before the physical sweep,
  so stored top-N can miss a winner. For a window over the entity's own
  immutable time, `guide feeds` gives hour lanes over a non-expiring source;
  for contributions arriving in the window, its live bounded `rollingLikes()`
  read remains necessary, and a candidate or contribution scan cut makes it incomplete."##;
