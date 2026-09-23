//! The complete, compiled and executed Quarry language card.
pub const LANGUAGE: &str = r##"# Quarry — the language card

One file, `snapback/schema.q`, holds tables, maintains, shapes, helpers,
programs and schedules, in any order; more `.q` files beside it are modules
(their operations are `<module>.<name>`) sharing one namespace. Schedules use that
qualified job name too: `schedule repair every 1m: timeline.repair`; an unambiguous
bare module job gets this rewrite from `check --fix`. Comments
start with `--`. Blocks indent with two spaces. Everything the compiler
accepts is below; the suite compiles every block and runs the core program.

Time arithmetic uses milliseconds: `now + 60000` is one minute from now,
and `now - .at` is elapsed time; `day(now)`, `hour(now)` and `bucket(now, 2m)`
produce UTC calendar ordinals. See `guide jobs` for scheduled work.

```quarry
use identity                          -- guests and password accounts; `use identity guests` or `use identity password` admits one kind
use personas alice, bob, carol        -- a development cast: `--as alice` and the persona header act as dev:alice
effect notify                         -- a name a mutation or job may `emit` under; a worker with a service token performs it (guide effects)

table rooms:
  name: text 1..80                    -- text <=N | text M..N, either with `format handle` or `format url`
  ownerId: principal                  -- principal | id | <table> (a reference to its row) | int | time (milliseconds) | bool
  kind: enum('open', 'closed')        -- enum('a', 'b') | decimal S | money CUR [S] | json <=N | bytes <=N | image <=N [once] | video <=N
  tags: [text <=20] <=8               -- [type] <=N: a bounded list
  parentId: rooms ?                   -- `?` makes a column optional: null when absent. Every table has an implicit `id` and a unique `byId`
  createdAt: time default now          -- omitted on insert; evaluated on the writing host
  by byOwner: ownerId, createdAt, id  -- `by` orders; a scan pins the leading columns and pages along the rest
  read <- exists members[.id, viewer]                                     -- rules: allow | deny | public ['why'] | .col = viewer | .col != 'x' | exists t[..] | created t[..] | and | or | not
  insert <- .ownerId = viewer
  update (old, next) <- old.ownerId = viewer and next.ownerId = viewer   -- an update rule may name both images
  delete <- deny
  after insert <- exists members[.id, .ownerId, 'admin']                 -- a row that must exist by the end of the mutation that inserted this one
  sync to members[.id]                -- each row reaches every principal with a members row whose roomId is this row's id

table members:
  roomId: rooms
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique byRoomPrincipal: roomId, principal else MEMBER_EXISTS -- `unique` orders and constrains
  by byRoomPrincipalRole: roomId, principal, role
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId                                    -- at most N rows per group; needs an index leading with the group
  immutable roomId, principal                          -- columns no update may change
  read <- exists members[.roomId, viewer]
  insert <- exists members[roomId = .roomId, principal = viewer, role = 'admin'] or created rooms[.roomId]   -- created: this mutation inserted the probed row
  delete <- .principal = viewer or exists members[.roomId, viewer, 'admin']
  sync to members[.roomId]

table messages:
  roomId: rooms
  authorId: principal
  body: text <=4000 ?
  photo: image <=10000000 ?           -- an upload the row holds (guide assets); `once` after the bound serves one view per principal
  clip: video <=50000000 ?
  editedAt: time ?
  expiresAt: time ?
  at: time
  by byRoomTime: roomId, at, id
  by byRoomWords: roomId, words(body), at, id   -- a words index: one entry per distinct word of the text columns; read with `matching` (guide search)
  by byExpiresAt: expiresAt
  immutable roomId, authorId
  read <- exists members[.roomId, viewer]
  insert <- .authorId = viewer and exists members[.roomId, viewer]
  update <- .authorId = viewer
  delete <- .authorId = viewer
  retain delivered-history            -- a device keeps what it was given after it leaves the group; `until-revoked` (the default) drops it
  expire at .expiresAt                -- a row past that time is absent everywhere at once, then swept; a null time never expires
  sync last 500 by byRoomTime     -- the horizon: a device acquires the newest N per group; older rows are online-only

table posts:
  authorId: principal
  body: text <=500
  parentId: id ?
  score: int
  at: time
  by byAuthorTime: authorId, at, id
  by byTime: at, id
  public 'posts are public'           -- the read rule as a table line, with its reason
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  sync public last 200 by byTime      -- everyone holds the same rows

table feed:                         -- rendered private inbox; `guide feeds` covers delivery and removal
  readerId: principal
  eventId: posts
  authorId: principal
  body: text <=500
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  cap 50000 by readerId
  read <- .readerId = viewer
  sync

table broadcast:                    -- same rendered columns; one public lane per pulled author
  readerId: principal
  eventId: posts
  authorId: principal
  body: text <=500
  at: time
  unique byReaderEvent: readerId, eventId
  unique byReaderTime: readerId, at, eventId
  cap 32000
  public 'celebrity events are public'
  sync public

table pulls:
  readerId: principal
  authorId: principal
  unique byReaderAuthor: readerId, authorId
  cap 32 by readerId
  read <- .readerId = viewer
  sync

table follows:
  followerId: principal
  followedId: principal
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  cap 1000 by followerId
  read <- .followerId = viewer        -- exactly the audience of the sync line below
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync to .followerId                 -- each row reaches the principal in the column

table reactions:
  postId: posts
  principal: principal
  direction: int
  emoji: text <=20 default 'like'
  unique byPostPrincipal: postId, principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to .principal last 500 by byPrincipal

table profiles:
  principal: principal
  handle: text 3..20 format handle    -- a text format is checked on every write
  site: text <=200 format url ?
  unique byPrincipal: principal
  unique byHandle: handle else HANDLE_TAKEN 'That handle is taken.'
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
  online only                         -- optional; no sync line has the same meaning

table ledger:
  ownerId: principal
  amount: money USD                   -- money CUR [scale] (2 unless given) and decimal S hold integer minor units
  weight: decimal 2
  note: json <=2000 ?
  at: time
  by byOwnerTime: ownerId, at, id
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- deny
  delete <- deny

maintain messageCounts: count messages by roomId       -- an aggregate the engine keeps: read it by group and get the number, 0 when the group has no row
  read <- exists members[.roomId, viewer]
maintain scoreTotals: sum posts of score by authorId   -- count, or sum of an int, decimal or money column
  read <- allow
  online only                         -- mutations reading this maintain never predict

maintain originalPostCounts: count posts where .parentId = null by authorId
  read <- allow
  online only
maintain dailyPosts: count posts where .parentId = null by authorId, day(.at)
  read <- allow
  online only
maintain hourlyPosts: count posts by authorId, hour(.at)
  read <- allow
  online only
maintain periodPosts: count posts by authorId, bucket(.at, 2m)
  read <- allow
  online only
maintain digestPosts: count posts by authorId, day(.at, 8h)
  read <- allow
  online only
maintain anchoredPeriods: count posts by authorId, bucket(.at, 1d, 8h)
  read <- allow
  online only
maintain reactionCounts: count reactions by principal, postId, emoji
  read <- .principal = viewer
maintain postLikes: count reactions where .direction > 0 by postId
  read <- deny
  online only
  by byCount: value, id

query daily(c: cursor ?):
  return dailyPosts[viewer] after c first 7 by byGroup { day, count: .value }
query today():
  return dailyPosts[viewer, day(now)]
query calendar():
  return { hour: hour(now), bucket: bucket(now, 2m) }
query anchoredKeys():
  return { day: day(now, 8h), hour: hour(now, 30m), bucket: bucket(now, 1d, 8h) }
query digestToday():
  return digestPosts[viewer, day(now, 8h)]
query mostLiked(c: cursor ?):
  return postLikes after c last 10 by byCount { postId, count: .value }
query chips(postId: posts, c: cursor ?):
  return reactionCounts[viewer, postId] after c first 50 by byGroup { emoji, count: .value }

fn kindLabel(value: text <=6): value                               -- every enum variant fits the text bound
shape messageCard = { *, room: rooms[.roomId], count: messageCounts[.roomId] }
shape card = { id, name, kind: kindLabel(.kind), owner: .ownerId, tagCount: count(.tags) }   -- a named shape: `.` is the row; `row card` and `page card` use it
fn messageBody(m: messages): m.body                                  -- a row argument keeps its fields at this call site
fn messageById(m: messages): (messages[m] ! else NOT_FOUND).body      -- a reference argument stays a reference
fn isBrief(ttl: int ?): ttl != null                                  -- a helper expression, expanded where it is called
fn stamp(roomId: rooms):                                             -- a helper body, expanded with its caller's write authority
  update rooms[roomId] { createdAt: now }
  return
fn tally(n: int):
  total = 0
  for i in range(0, 1 + 1):
    total = total + n
  return total

query heldRoom(roomId: rooms) held:   -- device only: dev and serve refuse E_QUERY_HELD; no server fallback
  return rooms[roomId] card

query room(roomId: rooms):            -- a query reads; its result type is inferred onto api.ts
  return rooms[roomId] card           -- one row by a unique key: null when absent or hidden; then the named shape

query helperRows(messageId: messages):
  m = messages[messageId] ! else NOT_FOUND
  return { body: messageBody(m), byId: messageById(messageId) }

query thread(roomId: rooms, c: cursor ?):                            -- `cursor ?` is the page argument; an omitted optional argument is null
  require exists members[roomId, viewer] else NOT_MEMBER              -- a refusal with the program's own code
  return messages[roomId] by byRoomTime last 50 after c where .body != null and exists (members[.roomId, viewer] by byRoomPrincipal) messageCard   -- parentheses keep the explicit index on the inner read; messageCard shapes the page

query inbox(c: cursor ?):
  return members[viewer] after c first 50 by byPrincipalRoom { roomId, room: rooms[.roomId], unread: messageCounts[.roomId] }

query following(c: cursor ?):        -- syntax example: private inbox plus capped pulled authors; `snapback4 init --recipe feeds` writes the removal recipe (`snapback4 guide feeds`)
  page = merge feed after c last 20 by byReaderTime where .body != '':
    [viewer]
    broadcast[p.authorId] for p in pulls[viewer]
  return page { *, mine: reactions[.eventId, viewer] }

query ancestors(roomId: rooms):
  chain = walk rooms[roomId] up .parentId depth 8                   -- the row, its parent, and so on: at most `depth` rows
  return chain { id, name }

query digest(roomId: rooms):
  require exists members[roomId, viewer] else NOT_MEMBER
  page = messages[roomId, at >= now - 86400000] last 100 by byRoomTime                     -- a page bound to a name; count, sum, slice, sort and shapes take it
  (weeks, days) = divmod(count(page), 7)                             -- divmod binds quotient and remainder at once
  (lo, hi) = sorted(weeks, days)                                     -- two values in order
  counter = 0
  for message in page:
    counter = counter + 1                                           -- a local can carry a counter across iterations
  offsets = []
  for i in range(0, 3):
    if i = 2:
      continue                                                      -- advances the nearest for or chunk
    else if i < 0:
      break                                                         -- else if is a nested conditional
    offsets = offsets + [i]                                         -- append in place, under the heap meter
  label = lower(trim(' DIGEST ')) + ': ' + join(['room', 'messages'], ' / ')
  quotient = counter / 7
  doubled = tally(counter)                                          -- a helper body also yields a value in an expression
  remainder = counter % 7                                          -- the same Euclidean parts as divmod; zero refuses E_DIV_ZERO
  head = first(page)
  if head != null and head.body != null:
    bodySize = count(head.body)                                     -- a null guard narrows the snapshot field through the rest of this block
  sum = sum(page, .at)
  grouped = group(page, 'authorId') { author: .key, count: count(.items) }
  return { sum, grouped, first: first(page), last: last(page), at: at(page, 1), total: messageCounts[roomId], counter, offsets, label, labelSize: count(label), doubled, quotient, remainder, weeks, days, lo, hi, brief: isBrief(null), oldest: sort(slice(page, 0, 10), 'at') { id, at }, smaller: min(weeks, days), larger: max(weeks, days) }

query mentions(body: text <=4000):
  return tokens(body)                 -- the @mentions in a text, without the @, at most 64: a bounded list

query tokenDigest(token: text <=200):
  return sha256(token)                -- lowercase SHA-256 of the exact UTF-8 bytes: text <=64

query search(roomId: rooms, q: text <=100, c: cursor ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  return messages[roomId] matching q after c last 50 by byRoomWords   -- word-prefix search: uniform expansion bounded by the meter; admitted non-uniform scopes keep 32 words; newest first

query everywhere(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 50 by byRoomWords:
    [m.roomId] for m in members[viewer]

query wholeRoster(roomId: rooms):
  return members[roomId] by byRoomPrincipal                         -- the schema cap is the ascending whole-group bound

query memberTotal():
  n = 0
  for m in members[viewer]:                                        -- a uniform prefix under the query meter
    n = n + 1
  return n

query hasMessages(roomId: rooms):
  return exists messages[roomId]                                  -- a prefix existence scan: first visible match, no page or cursor

query groupedMessages(q: text <=100, c: cursor ?):
  return members[viewer] after c first 20 by byPrincipalRoom where exists (messages[.roomId] matching q) { roomId, hits: messages[.roomId] matching q last 3 by byRoomWords }

query online(p: principal):
  return connected[p]                 -- how many connections the principal holds open on the server; `exists connected[p]` tests (guide presence)

mutation pagePass(roomId: rooms): server
  n = 0
  for row in members[roomId] first 10 by byRoomPrincipal:
    n = n + 1
  return n

mutation registerProfile(handle: text 3..20 format handle):
  return insert profiles { principal: viewer, handle }

mutation createRoom(name: text 1..80, kind: enum('open', 'closed'), tags: [text <=20] <=8):
  room = insert rooms { id: new, name, ownerId: viewer, kind, tags }   -- `new` mints an id; omit `id` and one is minted anyway
  insert members { roomId: room.id, principal: viewer, role: 'admin', joinedAt: now }
  upsert rooms[room.id] { createdAt: now }                            -- patches the existing room; name, owner, kind and tags stay
  return room card

mutation sendBrief(roomId: rooms, body: text <=4000 ?, ttl: int ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  row = insert messages { roomId, authorId: viewer, body, at: now, expiresAt: now + ttl if ttl != null else null }   -- a conditional value: the arm not taken never runs, and `ttl` is present in the taken one
  recipients = []
  for m in members[roomId] by byRoomPrincipal:
    if m.principal != viewer:
      recipients = recipients + [m.principal]
  for p in recipients:                                              -- bounded derived lists may read and emit; row writes still need the complete-group proof
    if not exists connected[p]:
      emit notify { targetUserId: p, roomId, preview: slice(body ?? '', 0, 80) }   -- kept in this commit; a worker claims and settles it (guide effects)
  return { id: row.id, brief: isBrief(ttl), mentions: count(tokens(body ?? '')) }                                 -- `??` is the value when the left is null

mutation edit(messageId: messages, body: text <=4000, expected: text <=4000 ?) predicts:
  msg = messages[messageId] ! else NOT_FOUND                         -- the row, or refuse with the code; `msg` is present from here on
  require msg.authorId = viewer else NOT_AUTHOR
  update messages[msg] { body, editedAt: now } if .body = expected    -- a row as the key; `if` makes the update conditional: E_CONFLICT with the current row when false
  return null                                                        -- a bare `return` is the same

mutation join(roomId: rooms, principal: principal):
  require exists members[roomId, viewer, 'admin'] else NOT_ADMIN
  return insert members { roomId, principal, role: 'member', joinedAt: now } if absent   -- the row, or null on a unique clash

mutation leave(roomId: rooms):
  delete members[roomId = roomId, principal = viewer]                -- a key may name its columns; a full unique key names one row, NOT_FOUND when it is missing
  return null

mutation react(postId: posts, direction: int):
  require direction = 1 or direction = -1 else BAD_DIRECTION         -- =, !=, <, <=, >, >=, +, -, *, unary -, not, and, or
  upsert reactions[postId, viewer] { direction }                     -- predicts only an update of a held row; a missing row queues without a prediction

mutation post(bodies: [text <=500] <=10):
  for body in bodies:                                                -- a loop over a bounded list; `for row in page:` and `for i in range(0, 10):` are the other domains
    insert posts { authorId: viewer, body, score: 0, at: now }
  return count(bodies)

mutation split(total: int, people: [principal] <=8):
  insert ledger { ownerId: viewer, amount: share(total, people, viewer), weight: 1, at: now }   -- share: one person's part of an amount split evenly, deterministically

job nightly(periodStart: time, periodEnd: time):                    -- the server's own work: sweeps as the system principal, one page per commit
  end = periodEnd                                                   -- the prelude runs again at the start of every chunk, under that chunk's meter
  chunk r in rooms first 100 by byId:                                -- the index's columns are id or immutable, so nothing moves under the cursor
    if r.createdAt >= end:
      break                                                          -- ends this sweep; `return` ends the job
    stamp(r.id)
  chunk p in posts first 100 by byId:
    for i in range(0, 2):                                            -- int expressions, under the step meter
      update posts[p.id] { score: p.score + i }
schedule everyNight every 1d at 03:00: nightly                       -- once per period boundary of the server's clock: every 2m | 1h | 1d [at HH:MM]
job rescoreNative(): native                                          -- a job whose body is the app's own Rust in snapback/native/, hosted as wasm (guide native)
query personalizeNative(first: int): native                          -- a read in the same module: on the server as the viewer, on a device over its rows

effect sendDigest secrets [MAIL_API_KEY] retry 4 backoff 1m deadline 1d cancellation deny
table roomEntries:
  roomId: id
  at: time
  by byRoomHour: roomId, hour(at), at, id
  public 'Room entries are public.'

table checkins:
  principal: principal
  at: time
  unique byPrincipalDay: principal, day(at) else ALREADY_CHECKED_IN 'One check-in per day.'
  read <- .principal = viewer
  insert <- .principal = viewer

query roomHour(roomId: id, c: cursor ?):
  return roomEntries[roomId, hour(now) - 3] after c last 10 by byRoomHour

query roomWindow(roomId: id, c: cursor ?):
  return merge roomEntries after c last 10 by byRoomHour:
    [roomId, h] for h in range(hour(now) - 3, hour(now) + 1)

mutation checkin():
  return insert checkins { principal: viewer, at: now }

-- A declared public Following; the feeds card states its lifetime and caps.
table timelineProfiles:
  principal: principal
  unique byPrincipal: principal
  cap 1000
  immutable principal
  public 'timelineProfiles'
  insert <- .principal = viewer
  sync public
table timelineCards:
  authorId: principal
  at: time
  removed: bool default false
  cap 60000
  immutable authorId, at
  public 'cards'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public
table timelineReposts:
  actorId: principal
  postId: timelineCards
  at: time
  unique byActorPost: actorId, postId
  cap 60000
  immutable actorId, postId, at
  public 'timelineReposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public
table timelineFollows:
  followerId: principal
  followedId: principal
  at: time default 0
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  immutable followerId, followedId, at
  cap 1000 by followerId
  cap 1000 by followedId
  cap 100000
  public 'edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

maintain timeline: timeline
  authors timelineProfiles by principal
  events timelineCards by authorId, at removed by removed
  reposts timelineReposts by actorId, postId, at
  edges timelineFollows by followerId, followedId

mutation timelineRegister():
  insert timelineProfiles { principal: viewer }
mutation timelinePublish():
  return insert timelineCards { authorId: viewer, at: now }
mutation timelineFollow(authorId: principal):
  insert timelineFollows { followerId: viewer, followedId: authorId } if absent
mutation timelineRemove(postId: timelineCards):
  update timelineCards[postId] { removed: true }
query timelineHome(c: cursor ?):
  return timeline[viewer] after c last 20 { *, post: timelineCards[.postId] }

```

Helpers expand at each call: a table-typed parameter keeps a row argument as a row (fields need no lookup), while a reference argument stays a reference.
An enum fits `text <=N` when every variant has at most N characters and
contains no control characters except tab, LF and CR. This is
static and total: no variant is truncated or converted at runtime. If one
variant is too long, declare the helper parameter with the enum instead.
After a scalar `where` predicate, a declared shape name shapes the page:
`where not .hidden card` and `where not .hidden { ...card }` agree. A valid
row/object shape inside a predicate keeps its meaning; parenthesize it to
make that scope explicit, or use `{ ...card }` explicitly for the page.

Reads: `t[full unique key]` is a point; `t[prefix] [by index] [where predicate]`
reads the ascending capped group, or a meter-bounded query loop/lane source;
`t[prefix] [matching q] [after c] first|last N [by index] [where predicate]`
is an explicit page. `exists t[keys]` and `exists (t[prefix] matching q)` test
for a visible row without owning a page; rules keep exact-key probes.

Values: `viewer` (a principal), `now` (a time; in a mutation it is the commit's
instant), `new` (an id, mutations only), `true`, `false`, `null`, integers,
`'text'` or `"text"` with `\n`, `\t` and `\\`, `[a, b]` (a bounded list),
`{ a, b: c }` (an object; a bare name is `name: name`). `=` and `!=` are total
(null equals null); `<` and friends, `+`, `-` and `*` need present operands:
narrow with `if x != null:`, `x ! else CODE`, `x ?? default`, or `require x
!= null else CODE`. Guards narrow fields of a bound row too, through `and`/`or`,
conditional arms and the paths that survive an early return; rebinding clears the fact. `time - time` is an int of milliseconds; `time + int` a
time. Text `+` concatenates two present texts. `count(text | page | list)` counts characters or items; `lower(text)`, `trim(text)`, `join(list, separator)`, `sum(page, .col)`, `sum(list)`, `min(a, b)`,
`max(a, b)`, `slice(text | list, start, end)`, `sort(list, 'col', '-col')`,
`group(list, 'col')`, `first(list)`, `last(list)`, `at(list, index)` (element or null),
`tokens(text)`, `sha256(text)`, `share(amount, list, member)`, `(q, r) = divmod(a, b)`,
`(lo, hi) = sorted(a, b)`. `x = expr` binds or reassigns a local with a compatible type; reassignment resets its refinements. Arguments cannot be shadowed. A program ends
with `return [value]`, or with its last expression, or with its final write.
`xs = []` then `xs = xs + [value]` appends under the heap meter; `for x in xs:` can iterate the accumulated list.

`sha256` is for high-entropy capability tokens and content checksums. It hashes
the exact UTF-8 bytes without normalization and returns lowercase hexadecimal.
It is not password hashing, low-entropy email anonymization, a signature, a
MAC, or entropy generation; a digest is not automatically safe to publish.

Table indexes also take `day(at)`, `hour(at)` or `bucket(at, 2h, 30m)`
beside column names and `words(..)`: computed keys, not row columns (guide indexes).
A query merge's `for` takes a prefix page, `range(a, b)` or a bounded list
argument/expression, with one lane per value; `walk` is not admitted.



## With `use server`

One `use server` in any module (`schema.q` is usual) enables the whole
project; repeating it is harmless. Actions, routes and schedules naming an
action require it. Effects (including secrets, retry, backoff, deadline and
cancellation), jobs, schedules naming a job and service seats need no directive.
This block extends the core schema above.

```quarry
use server
-- Server handlers declare results, secrets and work settings (guide actions).
action summarizeRoom(room: rooms) returns { summary: text <=4000, source: rooms, tags: [text <=30] <=8 ? } secrets [MODEL_API_KEY] retry 3 backoff 2s deadline 1h cancellation allow
action scheduledSummary(periodStart: time, periodEnd: time) returns {} <- viewer = 'service:reporter'
schedule summariesEveryDay every 1d at 08:00 as service:reporter: scheduledSummary
route roomExport: post "/room-export" wait 5s -- signed-in caller; no Quarry body or client operation
route providerEvent: post "/hooks/room-events" as service:reporter secrets [ROOM_SIGNING_KEY] retry 8 backoff 2s deadline 1h cancellation allow wait 5s
```

## Fixing a refused line

E_QUARRY_SYNTAX means the parser could not read the form at the reported
file, line and column. For example, `query answer:` is missing its argument
parentheses: write `query answer():`, then indent `return 42` by two spaces
on the next line. Keep the colon, close each `(`, `[` and `{`, and separate
arguments and object fields with commas. Follow the diagnostic's rewrite;
`snapback4 check --fix` applies it only when marked mechanical. Fix the first
bad line and rerun `check`; a later empty-body error may be its consequence.

E_QUARRY_UNKNOWN means a name cannot be resolved in this scope: a local,
argument, table, column, index or helper may be misspelled or undeclared.
For example, after `message = 'hello'`, `return mesage` must be
`return message`. Check the declared spelling and the diagnostic's suggested
name; declare a missing local before using it. For a missing index, use the
named `by` line in the table's declaration; `snapback4 check --fix` can add
it when the diagnostic marks that repair mechanical.

## Left out on purpose, and the idiom

- `while` and recursion → `for` over a page, list, `range(a, b)` with int expressions, or `tokens(text)`; `walk` for a chain.
- Floats → integer minor units in `decimal S` and `money CUR S`, or a native job.
- A typed map with dynamic keys → `group(list, 'col')`, whose result is a list of `{ key, items }` groups in first-seen order.
Before editing, `check --fix` verifies every compiled source; an editor save refuses the repair with its filename. Its final compile re-reads the project.

Ordinary field access propagates null: `row.body` is null when `row` is null.
`check --fix` removes only the `?` in `a?.b`, preserving the base expression
and evaluating it once, including when it is a call or read.

- Guessed spellings are refused with a canonical rewrite; `snapback4 check --fix` applies mechanical repairs (including missing indexes, argument `once`, repeated wildcard fields and empty operation parentheses): `cond ? a : b` → `a if cond else b`; `a?.b` → `a.b`; `len(x)` → `count(x)`; `elif` → `else if`; `proc` → `fn`; `//` and `#` → `--`; `==` → `=`.

Cards: `snapback4 guide <keyword>` — app, types, indexes, maintains, rules, sync, residency, prediction, evolution, expire,
assets, reads, shapes, writes, programs, jobs, native, feeds, search,
effects, actions, routes, services, presence, bounds, refusals, personas, witness. `snapback4 why
<CODE>` explains a refusal.


## Unsupported forms

E_QUARRY_UNSUPPORTED means the guessed construct is not a Quarry form.
For example, `return len(items)` must be `return count(items)`. The
reported rewrite names the accepted spelling; `snapback4 check --fix`
applies it when marked mechanical. For a different algorithm, use the
language card's bounded loop, helper or native-job idiom. Accepting a
rewrite does not add an alias to the language.

## An ID belongs to one intent

E_ID_REUSED means the request ID already belongs to another operation or
different arguments. For example, retrying an invitation with the same ID
but a different email changes its intent. To collect or retry the original,
keep its operation, ID and raw arguments exactly; for a new invitation,
use a new ID. Explicit null and an omitted optional argument are different
raw inputs even when validation gives them the same value. See `guide
actions` for durable invocation collection and `guide writes` for mutations.

## Timelines

`maintain name: timeline` maps a public profile, original, repost and follow
model to engine-owned Following state. `guide feeds` states the caps,
removal, eager registration, lifecycle and server execution contract.

"##;
