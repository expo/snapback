//! Compiled examples first; diagnostic details are under `why`.
pub(super) const CARD: &str = r##"# Types

Types bound columns, arguments, text, lists and uploads.

```quarry
table profiles:
  owner: principal
  name: text 1..80
  bio: text ?
  createdAt: time default now
  read <- .owner = viewer
  insert <- .owner = viewer
mutation createProfile(name: text 1..80):
  return insert profiles { owner: viewer, name }
```

Reference contexts project required rows’ `.id`. Media: decimal KB/MB/GB.

Columns/arguments become nullable with `?`; omission becomes null. Table types are references; neither typing nor membership reads the target: use `require exists t[id] else CODE` or `r = t[id] ! else CODE`.
Defaults fill omissions; explicit values win. Formats: handle/url/email. `format email` is the shared ASCII address contract described below; identity providers may apply additional policy.
Money/decimal are scaled integers; fractions refuse E_INPUT. Divide them by an int with an explicit rounding mode, for example `divide(amount, 3, 'half-even')`. To produce a fractional decimal from integer inputs, name its result scale: `divide(total, count, 2, 'half-even')` returns `decimal 2`; no floating point or manual `total * 100` is introduced. Identical admitted unique-key reads narrow after exists/non-null guards, including pure helper arguments; writes, rebinding and viewer changes invalidate proof. A matching positive `count(domain)` guard also makes `min` and `max` of a required column non-null until a write or authority change invalidates that proof; `sum` already has a zero identity.

## Limits

- Guard or assert nullable values before passing them to required parameters: E_QUARRY_TYPE.
- Values and arithmetic must fit the integer range: E_OVERFLOW.
- `/` and `%` take ints and floor: `-7 / 2` is -4, `-7 % 2` is 1. A divisor must be nonzero: E_DIV_ZERO.
- `divide(value, int, mode)` preserves int/decimal/money and requires one of `toward-zero`, `away-from-zero`, `floor`, `ceiling`, `half-away-from-zero` or `half-even` as a literal mode. It uses checked integer quotient/remainder arithmetic; zero refuses E_DIV_ZERO and overflow refuses E_OVERFLOW.
- `divide(int, int, scale, mode)` returns `decimal scale`; `scale` is a literal from 0 through 12. Scaling uses a checked wide integer, then applies the same signed rounding rule and i53 result check. Null inputs are never zero.
- New required defaults must also fit the existing store: E_ADOPT.

## Details

Types describe the values a column or argument accepts.
They also set limits on text, lists and uploaded assets.

### Column types

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
  description: text
  handle: text 3..20 format handle    -- format handle | url is checked on every write
  site: text <=200 format url ?
  kind: enum('a', 'b')                -- a text literal in this position is a variant
  meta: json <=4000 ?
  raw: bytes <=1024 ?
  photo: image <=10000000 once ?      -- an upload (guide assets); `once` serves one view per principal
  clip: video <=50000000 ?
  tags: [text <=20] <=8               -- [T] 1..N | [T] <=N (0..N); `?` on the whole list, never the element
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  read <- .who = viewer
  insert <- .who = viewer
  update <- deny
  delete <- deny

fn label(kind: text): kind
query enumLabel(kind: enum('a', 'b')):
  return label(kind)

query typed(c: cursor ?, handle: text 3..20 format handle):   -- arguments take the same types, plus `cursor ?`
  return everything[handle = handle]
```

### Null guards and ids

Null guards narrow identical pure helper calls; rebinding invalidates proof. Bind impure calls once; both calls remain metered.

Mixed-table references need explicit generic ids: `[exposedId(x), exposedId(y)]`.
For nested `[].id` conflicts, widen each projected field with `exposedId(row.id)`.

```quarry
table a:
  public
table b:
  public
fn exposedId(value: id): value
query ids(x: a, y: b):
  return [exposedId(x), exposedId(y)]
query nestedIds(x: a, y: b):
  return [{ id: exposedId(x) }, { id: exposedId(y) }]
```

### Int ranges

`int 1..5`, `int 0..` and `int ..100` bound values; every write and call
checks them (`E_INPUT`).

### Text bounds

`text` defaults to `text <=10000` characters in columns, arguments and helper
parameters. Write `text <=N` or `text M..N` when the bound is a product rule;
an indexed column must also fit the key budget (`guide indexes`).

`format email` accepts one ASCII `@`, a 1–64 character local part made from
letters, digits and `!#$%&'*+-/=?^_`{|}~` atoms separated by single dots, and a
1–253 character domain made from 1–63 character ASCII letter/digit/hyphen
labels. Dots cannot lead, trail or repeat, and a domain label cannot begin or
end with `-`. A single domain label such as `alice@localhost` is allowed.
The engine does not normalize case or Unicode; store a separate normalized
lookup column when the product needs case-insensitive identity matching.

## Engine-assigned per-parent sequences

`ordinal: sequence by conversationId` is an `int` assigned by the engine
inside the write transaction. The named column must be a required reference
on this table, such as `conversationId: conversations`. E_SEQUENCE_PARENT
names a missing, optional or non-reference parent column and gives the rewrite.
The ordinal and parent reference are immutable. Do not
supply a value or default. A table named `sequence` remains a reference type;
only the two words `sequence by` introduce an ordinal.

```quarry
table conversations:
  public 'shared chat identities'
  online only

table messages:
  conversationId: conversations
  ordinal: sequence by conversationId
  public 'shared chat history'
  online only
```

Counters remain keyed by parent table and id across deletions and reopen.
An explicit store reset clears them with its rows. Adding or rebinding a sequence
on a populated table refuses E_ADOPT with an empty-table rewrite; there is no
implicit historical backfill. An empty table may adopt the declaration.
E_SEQUENCE_EXHAUSTED refuses a transaction that would exceed the maximum int.
Create a new parent for subsequent writes; the refused transaction consumes no value.
The generated schema carries the `sequence-by` engine capability; upgrade
older engines and devices that refuse it with E_SCHEMA_CAPABILITY.
See `guide writes` for prediction, ordering and the complete chat example.

## Tables

For complete index, rule and expiry recipes, open `guide indexes`,
`guide rules` or `guide expire` directly.

- Every table has an implicit unique `id`.

- **Keys and search:** `unique handle` or `unique postId, principal` enforces
  a product key. Add `else HANDLE_TAKEN 'That handle is taken.'` for a visible
  collision's code and message. Named keys resolve ambiguous positional types. Use
  `search body, caption` for word-prefix search. Predicates and `by .at`
  choose access indexes automatically; `guide indexes` explains inspection
  and optional tuning. `unique principal, day(at)` gives calendar uniqueness.

- **Constraints:** `cap N by cols` (at most N rows per group; a product constraint), `immutable cols`, `after insert <- exists
  t[..]` (a row that must exist by the end of the mutation that inserted
  this one).

- **Sync** (`guide sync`) and **retain**: `retain until-revoked` (the default: a
  device drops a group's rows when it leaves the group) or
  `retain delivered-history` (it keeps what it was given).
- **Expire:** `expire at .expiresAt` makes a row absent at its deadline.
  `guide expire` covers physical cleanup and caps.
  Held device observations republish at the deadline, including offline.
  Server-answered reads use `client.now()` and `useNow(deadline)` to hide rows
  while their next answer is pending (`guide reads`).
  This is an application table, separate from the server's `connected[p]`.
  That server-decided connection signal has no `expiresAt`.
  The server will not return it again after expiry, but does not push a
  removal at that instant.
  A null time never expires. Disappearing messages
  are one field on insert, `expiresAt: now + ttl if ttl != null else
  null` with `ttl: int ?`; nothing else to write.

"##;
