//! Compiled examples first; diagnostic details are under `why`.
pub(super) const CARD: &str = r##"# Shapes

Shapes choose the fields returned from a row or page.
Name a shape to reuse the same result layout across reads.

```quarry
query nestedRoster(c: cursor ?):
  return members where .principal = viewer first 20 by .roomId after c { roomId, roster: members[roomId = .roomId], room: rooms[.roomId] { name } }
```

The outer page selects your memberships.
The named inner key binds that membership's room before reading its roster.
`room` expands the reference into an object, or null when missing or hidden.
Inside each `where`, `.` denotes that read's own row.

## Limits

- Comparing a filtered row column with itself is refused, except optional-column `<=` and `>=` presence tests: E_QUARRY_SELF_EQUALITY.
- Spread a present row or object with known fields: E_QUARRY_SPREAD.
- Write each explicit field once: E_QUARRY_DUPLICATE_FIELD.
- Values joined by branches must have compatible row kinds: E_QUARRY_SHAPE_JOIN.
- Move or narrow a shape that cannot fit the meter: E_SHAPE_EXCEEDS_METER.

## Details

Shapes choose the fields returned from a row or page.
Name a shape to reuse the same result layout across reads.

```quarry
shape brief = { id, body, author: .authorId }                        -- a named shape: bare columns, and `.` for the row

query shapeForms(roomId: rooms, messageId: messages, c: cursor ?):
  page = messages where .roomId = roomId after c last 20 by .at { *, room: rooms[.roomId], count: messageCounts[.roomId] }   -- over a page: `*` spreads every column; a point read inside is null for a hidden row
  row = rooms[roomId] { id, name, tagCount: count(.tags) }           -- over a row: an object; over a nullable row: null when the row is
  named = messages[messageId] brief                                  -- a named shape by its name
  nested = rooms[roomId] { ...card, extra: 1 }                        -- `...name` spreads a named shape's fields
  return { page, row, named, nested }
```

```quarry
table listings:
  title: text
  city: text
  public
table bookings:
  guest: principal
  listing: listings
  start: time
  read <- .guest = viewer
query myBookings(c: cursor ?):
  return bookings where .guest = viewer last 20 by .start after c { *, listing: listings[.listing] { title, city } }
query listingChoice(key: listings, flag: bool):
  p = listings[key] ! else NOT_FOUND
  return ({ ...p } if flag else { ...(p { * }) }) { title: 'override', * }
```

Here `listing` is the expanded object, or null for a missing or hidden listing.

In the first example, table and shape names are the language card's. A shape over a page is
a bounded loop; its fields are the row's columns by bare name, `*` for all
of them, `...shape` for a named shape's fields, and `name: expr` with `.`
as the row. There is no `select` spelling.
A table-typed helper accepts that table's row or reference. A reference has no
fields: read `messages[m] ! else NOT_FOUND` first, or select through the shape's
implicit row parameter, `messages[m] { body: .body }`. Shapes are projections,
not declared helper-argument types.
A row-based shape keeps `pending?: boolean` from its base, including `*`, named
spreads and subsequent shapes. It is this device's unconfirmed change, absent
after confirmation; it is not a schema column or metadata on a containing record.

## Shapes and helpers

`guide reads` owns paging and continuation; `guide programs` owns helpers.
"##;
