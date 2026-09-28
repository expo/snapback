//! Search card, compiled with every other keyword card by tests/guide.rs.
pub const CARD: &str = concat!(r##"# Search: word prefixes, on the server and on the device

Search finds rows whose words begin with the terms a user types.
The same word-prefix rules apply on the server and on the device.

```quarry
table members:
  roomId: id
  principal: principal
  unique roomId, principal
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  insert <- allow

table messages:
  roomId: id
  body: text <=4000 ?
  caption: text <=200 ?
  at: time
  search body, caption
  read <- exists members[.roomId, viewer]
  insert <- allow

table profiles:
  principal: principal
  displayName: text <=50
  handle: text <=30 format handle
  unique principal
  search displayName, handle
  public 'profiles are public'
  insert <- .principal = viewer

query inRoom(roomId: id, q: text <=100, c: cursor ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  return messages[roomId = roomId] matching q after c last 50 by .at

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by .handle
```

An empty needle, including whitespace or punctuation that folds to no terms,
browses in the query's order under the same read rule.
This directory uses one query, ordered by handle, with `next` to continue;
reset the cursor when changing the search text.
For a screen that wants nothing until typing, put `if q = '': return []`
before the read.

`search body, caption` declares the searchable columns. The planner supplies
the words index: one entry per distinct word of the
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
bounded by the meter for a uniform scope; at most 32 words for an admitted
non-uniform scope, whose page remains `complete: false` even below that bound), and those words
merge as ordered lanes into one page — newest first with `last 20 by .at`. Every further term must be a prefix of some word of the row ("cof
car" finds "COFFEE for Carol"). Mid-word text does not match; an expired row is gone at once;
an edit re-tokenizes. A uniform scope (the rule decided by the room)
costs one verdict per scope; with a total unique `(chatKey, principal)` key
on t, `.principal = viewer or exists t[.chatKey, viewer]` is decided by the
chat alone because the row is its own witness, so a roster page pinned by
the chat is complete and no second table is needed. An unscoped search under a per-room rule
checks the rule per row and is never `complete` (`N_NEVER_COMPLETE` names
it), except for the inferred ordinary server audience described below;
use the grouped or newest form below, or read on the device.

The newest form below merges the viewer's rooms by `at` and `id`, with
one verdict per scope when its prefix decides the rule. Its uniform lane
source runs under the examined meter: `check --cost` prints `lanes ≤ meter`;
an explicit `first N` above 50 still emits N_WIDE_MERGE. Use the grouped form,
which pages memberships and includes each chat's hits, when opening all rooms
cannot fit.
A pinned conjunct such as `exists members[.roomId, viewer]` can deny a scope
before word discovery even when another conjunct needs each row. Admitted
non-uniform scopes keep per-row costs and remain incomplete; hidden rows
there still spend the query-wide examined/index-entry budget. The admitted non-uniform scope's 32-word
bound records a word cut without cutting later lanes; operator
results name it in `word_cut_at`, separately from a meter cut in `capped_at`.
Device reads and uniform server reads expose `cut: 'words'` or `cut: 'meter'`
beside `complete`; `meter` wins if both limits cut. Non-uniform server reads
report `cut: null`: their reason is withheld, with `complete: false` still truthful.
`null` means "not disclosed here", not "not cut". Render "Results may be incomplete"
for `complete: false` with `cut: null`, even when empty; never "no matches".
The precise reason remains in development-only `Read.meter.cut`; `serve` never
returns that meter. If the server cannot answer the query, declare `query … held:`
to answer from the device; the server refuses it with E_QUERY_HELD. Call a held
query through a local client over acquired partitions; it has no server fallback. Use the grouped
membership read for a server answer.
Uniform word expansion is bounded by the meter. A cut during discovery or
opening returns `complete: false, cut: 'meter'` with no continuation.
Heap exhaustion clears the page: `data: null`, `complete: false`,
`cut: 'meter'`, no `next`.
Merged pages return no `next` for a non-uniform answer, an opening cut or a
word-limit cut. A resumable read-meter cut while an owning uniform lazy merge drains established heads
can carry `next` after its last fully shaped emitted row (§5.6), subject to final-answer eligibility, with `complete: false, cut: 'meter'`.
Heap exhaustion clears the whole page even during the drain; step exhaustion aborts and output exhaustion can refuse after materialisation.
A terminal full page need not carry `next`.
Following that cursor does not clear the earlier page's incompleteness in `usePage`. Reads inside
`where` use their own rules and search terms. Even an empty matching result
past a device horizon is incomplete; a held group can fall back to the server.

"##, include_str!("search_all.md"), r##"
## Membership search with an admin gate

```quarry
table conversations:
  title: text <=120
  read <- exists memberships[.id, viewer]
  insert <- allow
  sync to memberships[.id]

table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  unique conversationId, principal
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[conversationId = .conversationId, principal = viewer, role = 'admin'] or created conversations[.conversationId]
  sync to memberships[.conversationId]

table messages:
  conversationId: conversations
  authorId: principal
  body: text <=4000 ?
  caption: text <=200 ?
  at: time
  search body, caption
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  sync to memberships[.conversationId] last 500 by .at

table profiles:
  principal: principal
  displayName: text <=50
  handle: text <=30 format handle
  unique principal
  unique handle
  search displayName, handle
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer

query inChat(conversationId: conversations, q: text <=100, c: cursor ?):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  return messages[conversationId = conversationId] matching q after c last 50 by .at

-- ordinary per-chat search; retained text does not require current membership
query searchChat(conversationId: conversations, q: text <=100, c: cursor ?):
  return messages[conversationId = conversationId] matching q last 20 by .at after c

-- everything, grouped by chat
query searchGrouped(q: text <=100, c: cursor ?):
  return memberships[principal = viewer] after c first 20 by .conversationId where exists (messages[conversationId = .conversationId] by .at matching q) { conversationId, hits: messages[conversationId = .conversationId] matching q last 3 by .at }

-- a globally newest-first screen while every chat opens in one read
query searchNewest(q: text <=100, c: cursor ?):
  return messages matching q where exists memberships[.conversationId, viewer] last 20 by .at after c

query people(q: text <=100, c: cursor ?):
  return profiles matching q after c first 20 by .handle
```

This version gives conversations their own table and lets an admin add members.
`searchChat` has no membership guard: a table with `retain delivered-history`
can keep certified departed images locally in either link state. Its missing
history remains incomplete; current members can fall back below the acquisition
horizon. The guarded `inChat` still refuses NOT_MEMBER after departure.
Use `inChat` for more hits in one conversation; `searchGrouped` and
`searchNewest` use the grouped and global ordering described above.
`complete` means the query answered its declared request within known coverage and execution limits.
A full `first 1` is complete without a cursor. A horizon, an online-only source or zero read sites gets no
source-coverage line; that line never promises answer completeness.
For ordinary device reads, online fallback asks the server only for a missing
fact or unknown presence; a meter or word cut and a cursorless page stay local,
as do held queries and retained left groups, and pending predictable writes
still prevent fallback.

## Refusals

The web device folds through the browser's normalization, keeps Rust lowercase, and refuses to open with `E_HOST_UNICODE` when the browser's NFC disagrees with the contract's startup canaries.
Use a browser with standard `String.prototype.normalize`; do not substitute a
different normalization or bypass the check."##);
