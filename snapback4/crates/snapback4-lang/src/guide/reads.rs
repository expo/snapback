//! Read answers, pages and continuation. Compiled by tests/guide.rs.
pub const CARD: &str = r##"# Reads

Every ready `Read` carries `cut: 'meter' | 'words' | null` beside `complete`,
on the server and either device store. An empty page with `cut: 'meter'`
means partial: retry narrower, or continue if `next` exists; never "no matches".
`words` means the first term expanded past 32 words in a scope: narrow that
term or use scoped search (guide search). If both limits cut, `meter` wins.
`null` means neither cut occurred; `complete: false` can still describe a
non-uniform server read, a horizon, missing coverage or a page without continuation.
A complete empty page has `cut: null` and `complete: true`.

Declare `query name(..) held:` for a device-only answer. `check` prints
`runs: device (held; server refuses E_QUERY_HELD; no server fallback)`.
`dev`, `serve` and `run` refuse it with E_QUERY_HELD and a guide search rewrite;
the local clients answer from held rows, online or offline, without server
fallback even at a horizon or cut. The marker neither acquires rows nor
promises completeness. For full server history, use the scoped server walk
on the search card.

To inspect a real account's server work under loopback `dev`, use the online
client `createClient({ url, session, meter: true })` (or a bearer `token`).
Successful `query` and `observe` answers include `Read.meter`:
`{ examined, indexEntries, probes, steps, heapBytes, outputBytes, rowsWritten }`.
These are the engine's counters for that answer, not latency or process memory;
`probes` is rule_probes and `heapBytes` is charged heap work. A remembered
offline watch keeps the counters of its last server answer. Local device reads
have no meter; use the online client to inspect the server for the same account.
On the wire, opt in with `x-snapback-meter: 1` on `POST /q/<op>`.
Without it dev omits the field; `serve` ignores the header and never returns
meters. The counters can reflect hidden work and are development-only.
`snapback4 run <op> '<json args>' --as <principal id> --json` also prints
the engine's `metered` counters against `.snapback4/store.sqlite`.
A declared persona such as `alice` resolves to `dev:alice`; any other `--as`
value is used verbatim (including `user:...`, `member:42` and `dev:alice`).
The default is `dev:alice`. Jobs still run as the system.

Named equalities covering a total unique key read one row and check any extra
columns there: `t[key = x, col = y]` returns null on a mismatch, and
`exists t[key = x, col = y]` returns false. A non-unique prefix still needs an index. When several indexes match a positional
key, a single exact-type match wins first; if that remains ambiguous, exactly one
unique index covering the whole key wins; otherwise name `by index`
(the ambiguity diagnostic carries a mechanical `check --fix` rewrite).

```quarry
query readForms(roomId: rooms, messageId: messages, c: cursor ?):
  one = messages[messageId]                                  -- one row by a unique key: null if absent or hidden
  must = messages[messageId] ! else NOT_FOUND                 -- the row, or refuse with the code
  member = exists members[roomId, viewer]                    -- true or false; positional keys match the index columns
  admin = exists members[roomId = roomId, principal = viewer, role = 'admin']   -- named keys; `by` names the index when two match
  oldest = messages[roomId, at < must.at] last 20 by byRoomTime           -- the nearest earlier rows
  newest = messages[roomId] after c last 20 by byRoomTime where .body != null    -- a page, descending, from a cursor
  everyone = profiles first 50 by byHandle                   -- the whole table's page: the empty prefix, spelled without brackets
  merged = merge posts last 20 by byAuthorTime:              -- one ordered page over several prefixes of one index
    [viewer]
    [f.followedId] for f in follows[viewer] first 20 by byPair
  chain = walk rooms[roomId] up .parentId depth 8            -- the row, its parent, and so on: at most 8 rows
  return { one, must, member, admin, newest, chain }
```

The table names are the language card's. A page's read rule is checked
once when the prefix decides it, else per row, and a page whose rule still depends
on a column the scan does not pin is never `complete` (N_NEVER_COMPLETE names
the index that would decide it). With a total unique `(chatKey, principal)`
key on t, `.principal = viewer or exists t[.chatKey, viewer]` is decided by
the chat alone because the row is its own witness, so a roster page pinned
by the chat is complete and no second table is needed. An aborting mutation
page costs one examined unit before its verdict, plus its rule probes on
both true and false verdicts; a true verdict then examines candidates.
A page verdict evaluated from its pinned prefix charges the rule's static probe count on either outcome, including probes skipped by `and`/`or` short-circuiting.
A table page accepts its modifiers in any order, once each. The printed order
is `[matching q]`, `after c`, `first N` or `last N`, `by index`, `where predicate`.
At the predicate's level, a non-index modifier ends `where` and belongs to that outer
read: `posts[viewer] where exists follows[viewer, .authorId] last 20 by byAuthorTime`.
An immediate `by` after an unparenthesized inner read is ambiguous
(`E_QUARRY_MODIFIER_SCOPE`): parenthesize the inner read, or move the modifier
before `where`. `check --fix` preserves the inner index by adding parentheses:
`where exists (follows[viewer, .authorId] by byPair)`. A page a query returns without
a cursor cannot be continued: an unfiltered page with more rows reads
`complete: false` with no `next` (N_NO_CURSOR); declare `c: cursor ?` and
page with `after c`. A single-group page omits this note only when its bound
covers the group cap and that cap fits the default 8,192-row examined ceiling.
Other metered work can still cut a read. A merge reads plain lanes, or matching lanes over a
words index (guide search). Uniform plain merge lanes with a unique index or one ending
in `id` read one head each, then advance the winning lanes; `check` notes
a merge past 50 lanes (N_WIDE_MERGE). The meter counts examined rows and
probes; a query it cuts returns what it found and `complete: false`.
`t[prefix, col >= start, col < end]` seeks on the first unpinned index column;
its bounds have that column's type. A lone `where .col >= start` on that
column lowers to the seek and emits N_SEEK naming the key spelling.
Other `where` predicates run after the read rule, with `.` bound to each row.
Comparisons, `and`/`or`/`not`, arguments, `viewer`, literals and indexed reads
are metered; a predicate read is a probe. Only rows passing both count toward N.
A uniformly authorized filtered page is complete when it holds N matches or
reaches the range's end, including without a cursor; a meter cut is incomplete.
Direct table and maintain page cursors bind the evaluated prefix and active
generation. Reusing one under another prefix or after adoption is refused;
ordinary writes keep it valid, and rows can move between pages.
A filled page positions `next` after its last returned row. A meter-cut page
positions after its last rule-visible examined row, even if the filter rejected
it, never after a hidden row. A non-uniform page stays incomplete; a cut in a
hidden run with no rule-visible row ends on an empty capped page."##;
