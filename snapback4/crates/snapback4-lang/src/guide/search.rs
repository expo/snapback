//! Search card, compiled with every other keyword card by tests/guide.rs.
pub const CARD: &str = r##"# Search: word prefixes, on the server and on the device

```quarry
table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  insert <- allow

table messages:
  roomId: id
  body: text <=4000 ?
  caption: text <=200 ?
  at: time
  by byRoomWords: roomId, words(body, caption), at, id   -- the scope, the words, the order, the id
  by byWords: words(body, caption), at, id                -- unscoped: every chat, the rule checked per row
  read <- exists members[.roomId, viewer]
  insert <- allow

table profiles:
  principal: principal
  displayName: text <=50
  handle: text <=30 format handle
  unique byPrincipal: principal
  by byNameWords: words(displayName, handle), id
  public 'profiles are public'
  insert <- .principal = viewer

query inRoom(roomId: id, q: text <=100, c: cursor ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  return messages[roomId] matching q after c last 50 by byRoomWords

query everywhere(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 50 by byRoomWords:
    [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by byNameWords
```

`words(cols)` is an index component: one entry per distinct word of the
named text columns, in that position, folded the same way everywhere
(NFC, lowercase, a word boundary at every character that is not a letter
or digit). The columns before it are the search's scope; the columns
after it order the page and end in `id`, so a cursor continues it. A
words index serves `matching` and nothing else, and cannot be unique.

`matching q` folds the text the same way. Its first term selects every
word it is a prefix of ("cof": coffee, coffers, cofounder — one seek each,
at most 32 words, else the page is `complete: false`), and those words
merge as ordered lanes into one page — newest first when the index says
so. Every further term must be a prefix of some word of the row ("cof
car" finds "COFFEE for Carol"). Mid-word text does not match; an empty
search matches nothing, not everything; an expired row is gone at once;
an edit re-tokenizes. A uniform scope (the rule decided by the room)
costs one verdict per scope; with a total unique `(chatKey, principal)` key
on t, `.principal = viewer or exists t[.chatKey, viewer]` is decided by the
chat alone because the row is its own witness, so a roster page pinned by
the chat is complete and no second table is needed. The unscoped `byWords` under a per-room rule
checks the rule per row and is never `complete` (`N_NEVER_COMPLETE` names
it); use `everywhere` to search the viewer's rooms, or read on the device.

`everywhere` merges matching pages from the viewer's rooms, ordered by
`at` and `id`: each lane is one verdict when its scope decides the rule,
and the page is complete when all lanes are complete; past 50 lanes
`check` emits N_WIDE_MERGE, and the device runs the same query over held rows.
A pinned conjunct such as `exists members[.roomId, viewer]` can deny a scope
before word discovery even when another conjunct needs each row. Admitted
non-uniform scopes keep per-row costs and remain incomplete. Reads inside
`where` use their own rules and search terms. Even an empty matching result
past a device horizon is incomplete; a held group can fall back to the server."##;
