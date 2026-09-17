//! Search card, compiled with every other keyword card by tests/guide.rs.
pub const CARD: &str = concat!(r##"# Search: word prefixes, on the server and on the device

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

query allPeople(c: cursor ?):
  return profiles after c first 20 by byId
```

`matching ''` matches nothing, including when the needle contains only whitespace or punctuation.
Use `allPeople` while the search box is empty and `people` once the user types.
This directory uses two queries and a client branch: `allPeople` pages the
whole directory in `byId` order; `people` searches through `byNameWords`,
whose trailing `id` orders the matches, not alphabetically by display name.
Continue each query with its own `next`; do not sort only the first page
and treat it as the whole directory. Reset the cursor when switching queries or changing the search text.
Normalize whitespace-only input to `''` in the client if it should browse too.

`words(cols)` is an index component: one entry per distinct word of the
named text columns, in that position, folded the same way everywhere
(NFC, lowercase, a word boundary at every character that is not a letter
or digit). The columns before it are the search's scope; the columns
after it order the page and end in `id`, so a cursor continues it. A
words index serves `matching` and nothing else, and cannot be unique.

Indexed tokens and query terms are both truncated to 64 Unicode characters
after folding (at most 256 UTF-8 bytes). Longer terms therefore search with
that truncated prefix. The full composite word entry, including scope,
ordering columns and appended id, must fit the portable 2048-byte index key.

`matching q` folds the text the same way. Its first term selects every
word it is a prefix of ("cof": coffee, coffers, cofounder — one seek each,
at most 32 words per scope, else the page is `complete: false`), and those words
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
non-uniform scopes keep per-row costs and remain incomplete; hidden rows
there still spend the query-wide examined/index-entry budget. The 32-word
bound makes that lane incomplete without cutting later lanes; operator
results name it in `word_cut_at`, separately from a meter cut in `capped_at`.
Device reads and uniform server reads expose `cut: 'words'` or `cut: 'meter'`
beside `complete`; `meter` wins if both limits cut. Non-uniform server reads
report `cut: null`: their reason is withheld, with `complete: false` still truthful.
`null` means "not disclosed here", not "not cut". Render "Results may be incomplete"
for `complete: false` with `cut: null`, even when empty; never "no matches".
The precise reason remains in development-only `Read.meter.cut`; `serve` never
returns that meter. If the server cannot answer the query, declare `query … held:`
to answer from the device; the server refuses it with E_QUERY_HELD.
Merged pages return no `next` for a non-uniform answer, an opening cut or a
word-limit cut. A uniform lazy merge cut while draining established heads
carries `next` after its last emitted row, with `complete: false, cut: 'meter'`.
Following that cursor does not clear the earlier page's incompleteness in `usePage`. Reads inside
`where` use their own rules and search terms. Even an empty matching result
past a device horizon is incomplete; a held group can fall back to the server.

"##, include_str!("search_all.md"));
