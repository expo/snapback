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

Minted IDs sort by allocation order within one live engine, device or JavaScript
module instance, including equal milliseconds and clock rollback. Across devices,
restarts or separate instances, same-time suffix order is arbitrary. Use an explicit
order column for application-wide chronology; IDs are public identities, never secrets.
During rollback the encoded timestamp retains the previous logical millisecond.

Reference contexts project required rows’ `.id`. Media: decimal KB/MB/GB.

`?` makes columns/arguments nullable; omission is null. Table references do not
read targets: use `require exists t[id] else CODE` or
`r = t[id] ! else CODE`.
Defaults fill omissions; explicit wins. Formats: handle/url/email; identity may
be stricter than the email contract below. Money/decimal are
scaled integers; fractions refuse E_INPUT. `divide` names rounding and int/int
result scale. Unique-read/positive-count guards narrow; `sum` has zero. Writes,
rebinding or viewer changes invalidate.

## Limits

- Guard or assert nullable values before passing them to required parameters: E_QUARRY_TYPE.
- Values and arithmetic must fit the integer range: E_OVERFLOW.
- `/` and `%` take ints and floor: `-7 / 2` is -4, `-7 % 2` is 1. A divisor must be nonzero: E_DIV_ZERO.
- `divide(value, int, mode)` preserves kind; modes are `toward-zero`,
  `away-from-zero`, `floor`, `ceiling`, `half-away-from-zero`, `half-even`.
  Zero: E_DIV_ZERO; overflow: E_OVERFLOW.
- `divide(int, int, scale, mode)` returns `decimal scale` (literal 0–12) with
  checked wide scaling and an i53 result. Null is not zero.
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

`format email` accepts one ASCII `@`. Its 1–64 character local part uses
letter/digit/`!#$%&'*+-/=?^_`{|}~` dot-separated atoms; its 1–253 character
domain uses 1–63 character letter/digit/hyphen labels. Dots cannot bound/repeat;
hyphens cannot bound labels. `alice@localhost` is valid. Case/Unicode are not
normalized; store a normalized lookup when needed.

## Engine-assigned per-parent sequences

`ordinal: sequence by conversationId` is a transaction-assigned `int` whose
parent is a required reference. E_SEQUENCE_PARENT names a missing, optional or
non-reference parent column. Ordinal and parent are immutable. Do not supply a
value or default. Only `sequence by` declares an ordinal; a table named
`sequence` remains a reference type.

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

Counters survive deletion/reopen; store reset clears them. Adding/rebinding a
populated sequence refuses E_ADOPT with an empty-table rewrite; empty tables may
adopt it. E_SEQUENCE_EXHAUSTED refuses a transaction that would exceed the
maximum int. Create a new parent for subsequent writes; no value is consumed.
The schema carries `sequence-by`; upgrade engines/devices that refuse
E_SCHEMA_CAPABILITY. `guide writes` has prediction, ordering and the full recipe.

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
