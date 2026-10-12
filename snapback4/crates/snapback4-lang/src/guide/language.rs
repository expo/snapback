//! Compiled examples first; diagnostic details are under `why`.
pub const LANGUAGE: &str = r##"# Quarry — the language card

**Start here:** Declare typed tables, row rules, queries and mutations; indexes are inferred. Default-starter pattern; `guide from-sql` translates familiar idioms.

```quarry
table todos:
  title: text <=200
  ownerId: principal
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  sync to .ownerId last 100 by .id
```

- `E_QUARRY_TYPE`: wrong reference type; pass a reference to the declared table.
- `E_QUARRY_PLACEMENT`: queries cannot write; use mutations or jobs.

## Reference

```quarry
table notes:
  owner: principal
  body: text
  at: time default now
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner last 500 by .at, .id
query myNotes(c: cursor ?):
  return notes where .owner = viewer last 20 by .at after c
mutation addNote(body: text):
  return insert notes { owner: viewer, body }
```

Tables have an implicit `id`. `query` pages newest first; pass `next` as `c`. `addNote` inserts atomically with default time.

`receipts chat by .conversation, .ordinal from .sender to members:` with field mappings generates reporting (`guide receipts`; expert recipe: `guide manual-receipts`).

## Limits

- `count(x)`, `len(x)`, `length(x)`: text characters or list items; identical typing and meters. Unsupported spellings: E_QUARRY_UNSUPPORTED.
- A field or argument must fit its declared type: E_QUARRY_TYPE.

## Details

Repeated predicates and qualified helpers:

```quarry
query familiarHelpers(kind: enum('open', 'closed')):
  return schema.kindLabel(kind)          -- a helper in schema.q also accepts its file prefix
query nestedRoomRoster(c: cursor ?):
  return members where .principal = viewer first 20 by .roomId after c { roomId, roster: members[roomId = .roomId] }
query repeatedFilters(roomId: rooms, c: cursor ?):
  return messages where .roomId = roomId where .body != null last 20 by .at after c
```

Quarry defines your tables, access rules and backend operations. Queries and eligible mutations can run on devices that hold their inputs. N_SHAPE_METER: `groupedMessages` rejects unbounded candidates; query separately.

### Tables and rules
```quarry
use identity                          -- guests and password accounts; `use identity guests` or `use identity password` admits one kind
use personas alice, bob, carol        -- a development cast: `--as alice` and the persona header act as dev:alice
effect notify                         -- a name a mutation or job may `emit` under; a worker with a service token performs it (guide effects)
table folders:
  owner: principal
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  sync last 500 by .id
table documents:
  folder: folders
  body: text
  immutable folder
  read through .folder             -- the whole read rule; captures its immutable parent's audience and lifetime
  insert <- allow
  sync last 500 by .id              -- infers the captured owner audience
table rooms:
  name: text 1..80                    -- text <=N | text M..N, with `format handle` or `format url`
  ownerId: principal                  -- principal | id | <table> (a row's id) | int | time (ms) | bool
  kind: enum('open', 'closed')        -- enum('a', 'b') | decimal S | money CUR [S] | json <=N | bytes <=N | image <=N [once] | video|file <=N
  tags: [text <=20] <=8               -- [T] 1..N inclusive; [T] <=N means 0..N
  parentId: rooms ? on delete set null -- `?`: optional (null if absent); every table has an `id`
  createdAt: time default now          -- omitted on insert; evaluated on the writing host
  read <- exists members[.id, viewer]                                     -- rules: allow | deny | public ['why'] | .col = viewer | .col != 'x' | exists t[..] | created t[..] | and | or | not
  insert <- .ownerId = viewer
  update (old, next) <- old.ownerId = viewer and next.ownerId = viewer   -- an update rule may name both images
  cap 50 by parentId
  after insert <- exists members[roomId = .id, principal = .ownerId, role = 'admin']                 -- a row that must exist by the end of the mutation that inserted this one
  sync to members[.id]                -- each row reaches every principal with a members row whose roomId is this row's id
table members:
  roomId: rooms on delete cascade
  principal: principal
  role: enum('member', 'admin')
  joinedAt: time
  unique roomId, principal else MEMBER_EXISTS -- one row per key
  cap 100 by roomId                                    -- at most N rows per group; a product limit
  immutable roomId, principal                          -- columns no update may change
  read <- exists members[.roomId, viewer]
  insert <- exists members[.roomId, viewer, role = 'admin'] or created rooms[.roomId]   -- created: this mutation inserted the probed row
  delete <- .principal = viewer or exists members[.roomId, viewer, role = 'admin']
  sync to members[.roomId]
```

### Messages, uploads and expiry
```quarry
table messages:
  roomId: rooms
  ordinal: sequence by roomId         -- engine-assigned; provisional while the row is pending
  authorId: principal
  body: text <=4000 ?
  search body
  photo: image <=10000000 ?           -- an upload the row holds (guide assets); `once` after the bound serves one view per principal
  clip: video <=50000000 ?
  editedAt: time ?
  expiresAt: time ?
  at: time
  immutable roomId, authorId
  read <- exists members[.roomId, viewer]
  insert <- .authorId = viewer and exists members[.roomId, viewer]
  update <- .authorId = viewer
  delete <- .authorId = viewer
  retain delivered-history            -- a device keeps what it was given after it leaves the group; `until-revoked` (the default) drops it
  expire at .expiresAt                -- absent to reads at its deadline; null never expires; caps count live rows
  sync last 500 by .at     -- the horizon: a device acquires the newest N per group; older rows are online-only
table receipts:
  message: messages
  state: int ?
  public 'delivery status is public in this example'
  online only
fn receiptState(m: messages):
  return min(receipts where .message = m.id, 2 if .state = 2 else 1) ?? 2
query receiptStatus(messageId: messages):
  m = messages[messageId] ! else NOT_FOUND
  return { slowest: receiptState(m), fastest: max(receipts where .message = m.id, .state) }
```

### Public tables and money
```quarry
table posts:
  authorId: principal
  immutable authorId
  body: text <=500
  parentId: id ?
  score: int
  at: time
  public 'posts are public'           -- the read rule as a table line, with its reason
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  sync public last 200 by .at      -- everyone holds the same rows

table follows:
  followerId: principal
  followedId: principal
  unique followerId, followedId
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
  unique postId, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to .principal last 500 by .id

table profiles:
  principal: principal
  handle: text 3..20 format handle    -- a text format is checked on every write
  site: text <=200 format url ?
  unique principal
  search handle
  unique handle else HANDLE_TAKEN 'That handle is taken.'
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
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- deny
  delete <- deny

table likes:
  postId: posts on delete keep
  principal: principal
  at: time
  unique postId, principal
  immutable postId, principal
  public 'likes are public'
  insert <- .principal = viewer
  sync public last 2000 by .at with own keys .principal
view receivedLikes: count likes by .postId.authorId -- one immutable hop to a public target; attribution is recorded by the engine
  online only
```

### Views and calendar keys
```quarry
view messageCounts: count messages by .roomId       -- maintained count by group; missing groups return 0
                                                     -- read inherits membership through roomId
view scoreTotals: sum posts of .score by .authorId  -- count, or sum of an int, decimal or money column
  online only                         -- mutations reading this view never predict
view originalPostCounts: count posts where .parentId = null by .authorId
  online only
view dailyPosts: count posts where .parentId = null by .authorId, day(.at)
  online only
view hourlyPosts: count posts by .authorId, hour(.at)
  online only
view periodPosts: count posts by .authorId, bucket(.at, 2m)
  online only
view digestPosts: count posts by .authorId, day(.at, 8h)
  online only
view anchoredPeriods: count posts by .authorId, bucket(.at, 1d, 8h)
  online only
view reactionCounts: count reactions by .principal, .postId, emoji
  read <- .principal = viewer
view postLikes: count reactions where .direction > 0 by .postId
  read <- deny
  online only
query daily(c: cursor ?):
  return dailyPosts where .authorId = viewer first 7 by .day after c { day, count: .value }
query today():
  return dailyPosts[viewer, day(now)]
query calendar():
  return { hour: hour(now), bucket: bucket(now, 2m) }
query anchoredKeys():
  return { day: day(now, 8h), hour: hour(now, 30m), bucket: bucket(now, 1d, 8h) }
query digestToday():
  return digestPosts[viewer, day(now, 8h)]
query mostLiked(c: cursor ?):
  return postLikes last 10 by .value after c { postId, count: .value }
query chips(postId: posts, c: cursor ?):
  return reactionCounts where .principal = viewer and .postId = postId first 50 by .emoji after c { emoji, count: .value }
```

### Helpers, shapes and spreads
```quarry
fn kindLabel(value: text <=6): value                               -- every enum variant fits the text bound
shape messageCard = { *, room: rooms[.roomId], count: messageCounts[.roomId] }
shape card = { id, name, kind: kindLabel(.kind), owner: .ownerId, tagCount: count(.tags) }   -- named shape: `.` denotes the row; use `row card` or `page card`
fn messageBody(m: messages): m.body                                  -- a reference argument reads its row
fn messageById(m: messages):
  require exists messages[m] else NOT_FOUND
  return messages[m].body      -- reference arguments keep their ids
fn expiryTtl(setting: text): 60000 if setting = 'short' else null
query expiration(setting: text):
  return now + expiryTtl(setting) if expiryTtl(setting) != null else null  -- repeated pure calls narrow (guide types)
fn isBrief(ttl: int ?): ttl != null                                  -- expanded at each call
fn stamp(roomId: rooms):                                             -- inherits caller write authority; falling through returns null
  update rooms[roomId] { createdAt: now }
fn tally(n: int):
  total = 0
  for i in range(0, 1 + 1):
    total = total + n
  return total
query familiarLengths():
  return { characters: len('é🙂'), items: length([1, 2]) }
fn profileLabel(label: text): label
query spreadProfile(h: text 3..20 format handle, extra: text):
  p = profiles[handle = h] ! else NOT_FOUND
  return { spread: { ...p, extra }, shaped: p { *, extra: extra }, replaced: p { *, handle: { value: .handle } }, label: profileLabel(extra) }
query spreadObjects():
  a = { label: 'first', value: 1 }
  return { ...a, ...{ value: 2 }, label: 'last' }
query spreadChoice(h: text 3..20 format handle, flag: bool):
  p = profiles[handle = h] ! else NOT_FOUND
  return ({ ...p } if flag else { ...(p { * }) }) { handle: 'override', * }  -- spread both arms so their wildcard rules agree
```

### Queries: rows, pages, walks
```quarry
query heldRoom(roomId: rooms) held:   -- device only: dev and serve refuse E_QUERY_HELD; no server fallback
  return rooms[roomId] card
query room(roomId: rooms):            -- result type inferred onto api.ts
  return rooms[roomId] card           -- unique lookup, null if absent/hidden; applies card
query helperRows(messageId: messages):
  m = messages[messageId] ! else NOT_FOUND
  return { body: messageBody(m), byId: messageById(messageId) }
query thread(roomId: rooms, c: cursor ?):                            -- optional page cursor; omitted means null
  require exists members[roomId, viewer] else NOT_MEMBER              -- application refusal code
  return messages where .roomId = roomId and .body != null and exists members[.roomId, viewer] last 50 by .at after c messageCard   -- messageCard shapes the page after authorization
query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .roomId after c { roomId, room: rooms[.roomId], unread: messageCounts[.roomId] }
query ancestors(roomId: rooms):
  chain = walk rooms[roomId] up .parentId depth 8                   -- seed plus at most eight parents
  return chain { id, name }
```

### Loops, conditionals, arithmetic
```quarry
query digest(roomId: rooms):
  require exists members[roomId, viewer] else NOT_MEMBER
  page = messages where .roomId = roomId and .at >= now - 1d last 100 by .at                     -- named page for aggregates, slices, sorting and shapes
  (weeks, days) = divmod(count(page), 7)                             -- quotient and remainder
  (lo, hi) = sorted(weeks, days)                                     -- two values in order
  counter = 0
  for message in page:
    counter = counter + 1                                           -- loop-carried counter
  combined = [0] + [1, 2]
  offsets = []
  for i in range(0, 3):
    if i = 2:
      continue                                                      -- advances the nearest loop
    else if i < 0:
      break                                                         -- else if is a nested conditional
    offsets = offsets + [i]                                         -- append in place, under the heap meter
  label = lower(trim(' DIGEST ')) + ': ' + join(['room', 'messages'], ' / ')
  quotient = counter / 7
  doubled = tally(counter)                                          -- helper result in an expression
  remainder = counter % 7                                          -- the same Euclidean parts as divmod; zero refuses E_DIV_ZERO
  head = first(page)
  if head != null and head.body != null:
    bodySize = count(head.body)                                     -- guard narrows this snapshot field
  sum = sum(page, .at)
  earliest = min(page, .at)
  latest = max(page, .at)
  smallest = min([{ state: null }, { state: 1 }], .state)
  grouped = group(page, 'authorId') { author: .key, count: count(.items) }
  return { sum, earliest, latest, smallest, grouped, first: first(page), last: last(page), at: at(page, 1), total: messageCounts[roomId], counter, offsets, label, labelSize: count(label), doubled, quotient, remainder, weeks, days, lo, hi, brief: isBrief(null), oldest: sort(slice(page, 0, 10), 'at') { id, at }, smaller: min(weeks, days), larger: max(weeks, days) }
```

### Text, search and presence
```quarry
query mentions(body: text <=4000):
  return tokens(body)                 -- the @mentions in a text, without the @, at most 64: a bounded list
query tokenDigest(token: text <=200):
  return sha256(token)                -- lowercase SHA-256 of the exact UTF-8 bytes: text <=64
query search(roomId: rooms, q: text <=100, c: cursor ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  return messages where .roomId = roomId matching q last 50 by .at after c   -- word-prefix search: uniform expansion bounded by the meter; admitted non-uniform scopes keep 32 words; newest first
query everywhere(q: text <=100, c: cursor ?):
  return messages matching q where exists members[.roomId, viewer] last 50 by .at after c
query wholeRoster(roomId: rooms):
  return members where .roomId = roomId                         -- the schema cap is the ascending whole-group bound
query memberTotal():
  n = 0
  for m in members where .principal = viewer:                                        -- a uniform prefix under the query meter
    n = n + 1
  return n
query hasMessages(roomId: rooms):
  return exists messages where .roomId = roomId                                  -- first visible match; no page/cursor
query groupedMessages(q: text <=100, c: cursor ?):
  return members where .principal = viewer and exists (messages[roomId = .roomId] matching q) first 20 by .roomId after c { roomId, hits: messages[roomId = .roomId] matching q last 3 by .at }
query online(p: principal):
  return connected[p]                 -- server connection count; `exists connected[p]` tests (guide presence)
```

### Mutations and writes
```quarry
mutation pagePass(roomId: rooms): server
  n = 0
  for row in members where .roomId = roomId first 10 by .principal:
    n = n + 1
  return n
mutation registerProfile(handle: text 3..20 format handle):
  return insert profiles { principal: viewer, handle }
mutation createRoom(name: text 1..80, kind: enum('open', 'closed'), tags: [text <=20] <=8):
  room = insert rooms { id: new, name, ownerId: viewer, kind, tags }   -- `new` mints; omitting id also mints
  insert members { roomId: room.id, principal: viewer, role: 'admin', joinedAt: now }
  upsert rooms[room.id] { createdAt: now }                            -- patches createdAt; other fields stay
  return room card
mutation sendBrief(roomId: rooms, body: text <=4000 ?, ttl: int ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  row = insert messages { roomId, authorId: viewer, body, at: now, expiresAt: now + ttl if ttl != null else null }   -- lazy conditional; ttl narrows in the present arm
  recipients = []
  for m in members where .roomId = roomId:
    if m.principal != viewer:
      recipients = recipients + [m.principal]
  for p in recipients:                                              -- bounded derived lists may read and emit; row writes still need the complete-group proof
    if not exists connected[p]:
      emit notify { targetUserId: p, roomId, senderHandle: profiles[principal = viewer].handle, preview: slice(body ?? '', 0, 80) }   -- the profile read feeds only the effect: server-only, still predicts
  return { id: row.id, brief: isBrief(ttl), mentions: count(tokens(body ?? '')) }                                 -- `??` supplies the null fallback
mutation edit(messageId: messages, body: text <=4000, expected: text <=4000 ?) predicts:
  msg = messages[messageId] ! else NOT_FOUND                         -- the row, or refuse with the code; `msg` is present from here on
  require msg.authorId = viewer else NOT_AUTHOR
  update msg { body, editedAt: now } if .body = expected             -- a row as the key (`delete msg` too); `if` makes the update conditional: E_CONFLICT with the current row when false
  return null                                                        -- same as bare `return`
mutation join(roomId: rooms, principal: principal):
  require exists members[roomId = roomId, principal = viewer, role = 'admin'] else NOT_ADMIN
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
mutation split(total: int, people: [principal] 1..8):
  insert ledger { ownerId: viewer, amount: share(total, people, viewer), weight: 1, at: now }   -- share: one person's part of an amount split evenly, deterministically
```

### Jobs and schedules
```quarry
job nightly(periodStart: time, periodEnd: time):                    -- system sweeps; one chunk per commit
  end = periodEnd                                                   -- replayed per chunk
  for r in rooms:                                -- the index's columns are id or immutable, so nothing moves under the cursor
    if r.createdAt >= end:
      break                                                          -- ends this sweep; `return` ends the job
    stamp(r.id)
  for p in posts:
    as p.authorId:                                                   -- read-only; act outside
      visible = exists posts[p.id]
    for i in range(0, 2):                                            -- int expressions, under the step meter
      update posts[id = p.id] { score: p.score + i }
schedule everyNight every 1d at 03:00: nightly                       -- once per period boundary of the server's clock: every 2m | 1h | 1d [at HH:MM]
job rescoreNative(): native                                          -- a job whose body is the app's own Rust in snapback/native/, hosted as wasm (guide native)
query personalizeNative(first: int): native                          -- a read in the same module: on the server as the viewer, on a device over its rows
effect sendDigest secrets [MAIL_API_KEY] retry 4 backoff 1m deadline 1d cancellation deny
```

### Calendar windows
```quarry
table roomEntries:
  roomId: id
  at: time
  public 'Room entries are public.'
table checkins:
  principal: principal
  at: time
  unique principal, day(at) else ALREADY_CHECKED_IN 'One check-in per day.'
  read <- .principal = viewer
  insert <- .principal = viewer
query roomHour(roomId: id, c: cursor ?):
  return roomEntries where .roomId = roomId and .at >= (hour(now) - 3) * 1h and .at < (hour(now) - 2) * 1h last 10 by .at after c
query roomWindow(roomId: id, c: cursor ?):
  return roomEntries where .roomId = roomId and .at >= (hour(now) - 3) * 1h and .at < (hour(now) + 1) * 1h last 10 by .at after c
mutation checkin():
  return insert checkins { principal: viewer, at: now }
```

### Planned reads and unions
```quarry
table subjects:
  at: time
  voteCount: count votes
  public
  online only
table votes:
  subjectId: subjects
  amount: int
  public
  online only
effect intentDigest
table recipients:
  principal: principal
  public
  online only
table events:
  recipient: principal
  amount: int
  at: time
  public
  online only
job intentDaily(periodStart: time, periodEnd: time):
  for p in recipients:
    n = count(events where .recipient = p.principal and .at >= periodStart and .at < periodEnd)
    amount = sum(events where .recipient = p.principal and .at >= periodStart and .at < periodEnd, .amount)
    if exists events where .recipient = p.principal:
      emit intentDigest { recipient: p.principal, n, amount } once [p.principal, periodEnd]
table intentPosts:
  author: principal
  handle: text <=30
  body: text <=500
  at: time default now
  removed: bool default false
  unique handle else HANDLE_TAKEN 'That handle is taken.'
  search body
  public 'discoverable posts'
table intentReposts:
  actor: principal
  at: time default now
  public 'discoverable reposts'
view intentCounts: count intentPosts by .author
view intentActivity:
  intentPosts where not .removed { actor: .author, at, repost: false }
  intentReposts { actor, at, repost: true }
query intentPage(owner: principal, c: cursor ?):
  return intentPosts where .author = owner and not .removed last 20 by .at after c
query intentIds(c: cursor ?):
  return intentPosts first 20 by .id, .at after c -- table keys after id are redundant; uses byId
query intentSearch(q: text <=100, c: cursor ?):
  return intentPosts matching q last 20 by .at after c
query intentGlobal(c: cursor ?):
  return intentActivity last 20 by .at after c { id, actor, at, repost }
query intentCount(owner: principal):
  return intentCounts[owner]
table intentDeliveries:
  messageId: intentPosts
  principal: principal
  cap 50 by messageId                 -- a product limit per message, not across all messages
  public 'acknowledgements'
  online only
query intentDeliveriesPage(c: cursor ?):
  return intentDeliveries first 50 by .id after c
query intentDeliveriesFor(messageId: intentPosts):
  return intentDeliveries where .messageId = messageId
query intentSubject(subjectId: subjects):
  return subjects[subjectId]
query intentDurations():
  return [500ms, 30s, 15m, 24h, 7d, bucket(now, 2m)]
table intentIssues:
  owner: principal
  status: enum('todo', 'doing', 'done')
  assignee: principal ?
  at: time
  read <- .owner = viewer
query intentBoard(status: enum('todo', 'doing', 'done') ?, assignee: principal ?, c: cursor ?):
  return intentIssues where .owner = viewer and (status = null or .status = status) and (assignee = null or .assignee = assignee) last 50 by .at after c
```

### Notes
A maintained count can use another table's row as its key: `view unread: count messages by members m where .conversationId = m.conversationId and .ordinal > m.readUpTo`. Read `unread[m.id]` under the member's read rule; a large mark change reports `complete: false` while its recount settles. The complete, compiled Clique recipe is on `guide maintains`.

`snapback/schema.q` holds tables, views, shapes, helpers, programs and schedules in any order. Other `.q` files share its namespace; their operations and scheduled jobs use `<module>.<name>`. `check --fix` qualifies an unambiguous bare job name. Comments start with `--`; blocks indent two spaces. The suite compiles every block.

Time arithmetic uses durations: `now + 1m` is one minute from now, and `now - .at` is elapsed time; `day(now)`, `hour(now)` and `bucket(now, 2m)`
produce UTC calendar ordinals (`guide time`).

`createRoom` above predicts: its room is readable through the membership
inserted later in the same call. Reads authorize the current provisional
image against all pending writes. `edit` of retained history after leaving
the room also predicts, but the edited image is hidden until settlement.
See `guide prediction`.

`t[id]` reads one row; positional composite keys require an unambiguous declared
unique key. Named keys select columns. `t where predicate first 20 by .at after c`
pages ascending; `last` descends, with id breaking ties. Optional filters use
`(status = null or .status = status)`; empty `matching q` browses in order.
`count`, `sum`, `min` and `max` stream domains. Min/max skip nulls and return null
for empty/all-null domains, otherwise the value's type. Their second argument
accepts scalar row expressions; `.field` binds that row and named locals remain
in scope. Move ambiguous enclosing-row references into a helper with named inputs.
Literal `.col` extrema seek the first visible matching non-null indexed value;
other expressions scan under meters (constant under a cap, growing otherwise). `check --cost` names the plan. A cut aggregate
is unavailable, including before `??`; devices need complete domain coverage.
Rules precede comparisons. `exists` stops at a visible match; unknown domains
cannot prove absence. See `guide reads`.

`ys = xs + [value]`, `[a] + [b]` and `return xs + [value]` concatenate lists;
item types join and bounds add.
`xs = []` then `xs = xs + [value]` appends under the heap meter; `for x in xs:` can iterate the accumulated list.

`sha256` is for high-entropy capability tokens and content checksums. It hashes
the exact UTF-8 bytes without normalization and returns lowercase hexadecimal.
It is not password hashing, low-entropy email anonymization, a signature, a
MAC, or entropy generation; a digest is not automatically safe to publish.

`unique principal, day(at)` enforces calendar uniqueness. `search body`
declares word-prefix search. The planner builds indexes for predicates,
order, rule probes, sync, caps and expiry (`guide indexes`).

## With `use server`

```quarry
use server
-- Server handlers declare results, secrets and work settings (guide actions).
action summarizeRoom(room: rooms) returns { summary: text <=4000, source: rooms, tags: [text <=30] <=8 ? } secrets [MODEL_API_KEY] retry 3 backoff 2s deadline 1h cancellation allow
action scheduledSummary(periodStart: time, periodEnd: time) returns {} <- viewer = 'service:reporter'
schedule summariesEveryDay every 86400s at 08:00 as service:reporter: scheduledSummary
route roomExport: post "/room-export" wait 5s -- signed-in caller; no Quarry body or client operation
route providerEvent: post "/hooks/room-events" as service:reporter secrets [ROOM_SIGNING_KEY] retry 8 backoff 2s deadline 1h cancellation allow wait 5s
```

## Left out on purpose and idioms

Cards: `snapback4 guide <keyword>`: cheatsheet, app, social, from-sql, types, time, api, indexes, maintains, totals, offline-interactions, rules, sync, sharing, residency, prediction, evolution, expire, ephemeral, sequences,
assets, client, wire, reads, shapes, writes, programs, jobs, native, feeds, search,
effects, actions, routes, services, presence, receipts, read-only, manual-receipts, bounds, refusals, personas, testing, witness. `why
<CODE>` explains refusals. Recipes: `guide recipes`.

## An ID belongs to one intent

For a public Following feed, see `guide feeds`. Materialization requires
public sources with immutable mappings and owner write rules. Posts and reposts
may bound acquisition by time; public follows may sync fully, use a horizon,
or stay online only.

## Reads and planned views

The compiler plans predicates, ordering, `search` and unnamed `unique` indexes
(`guide indexes`). Durations are integer milliseconds in any expression.
The public activity union below supplies each reader's private
delivered feed.

```quarry
-- Following materializes this public activity view; `guide feeds` has the complete app.
table timelineProfiles:
  principal: principal
  unique byPrincipal: principal
  cap 1008
  immutable principal
  public 'timelineProfiles'
  insert <- .principal = viewer
  sync public
table timelineCards:
  parentId: timelineCards ?
  authorId: principal
  at: time
  removed: bool default false
  immutable authorId, parentId, at
  public 'cards'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public last 1000 by .at
table timelineReposts:
  actorId: principal
  postId: timelineCards
  at: time
  unique byActorPost: actorId, postId
  immutable actorId, postId, at
  public 'timelineReposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  online only
table timelineFollows:
  followerId: principal
  followedId: principal
  at: time default 0
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  immutable followerId, followedId, at
  public 'edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  online only

view timelineActivity:
  timelineCards where .parentId = null and not .removed { post: .id, actor: .authorId, at, repost: false }
  timelineReposts { post: .postId, actor: .actorId, at, repost: true }
view timeline: timelineActivity where .actor = viewer or exists timelineFollows[viewer, .actor]

mutation timelineRegister():
  insert timelineProfiles { principal: viewer }
mutation timelinePublish():
  return insert timelineCards { authorId: viewer, at: now }
mutation timelineFollow(authorId: principal):
  insert timelineFollows { followerId: viewer, followedId: authorId, at: now } if absent
mutation timelineRemove(postId: timelineCards):
  update timelineCards[postId] { removed: true }
query timelineHome(c: cursor ?):
  return timeline last 20 by .at after c { *, post: timelineCards[.post] }
```

## Field authority

Column modifiers give one field an owner and choose its read visibility.
See `guide rules` for Clique's membership and `markRead` recipe.

```quarry
table marks:
  principal: principal
  readUpTo: int default 0 written by .principal
  sharedMark: int default 0 written by .principal readable by audience
  public 'shared membership rows with private read marks'
  insert <- .principal = viewer
  update (old, next) <- next.readUpTo >= old.readUpTo
  sync public last 100 by .id
mutation markRead(memberId: marks, readUpTo: int) predicts:
  update marks[memberId] { readUpTo }
```

## Older spellings that still compile

Existing explicit indexes, merges, fixed chunks, aggregates and timelines keep
their meaning. New code uses predicates, views and `for` sweeps. Following's
view declaration is shown above; `guide feeds` owns its complete example.

```quarry
table oldEvents:
  owner: principal
  at: time
  by byOwner: owner, at, id
  public
  online only
maintain oldCounts: count oldEvents by owner
  read <- allow
query oldPage(c: cursor ?):
  return oldEvents[viewer] last 20 by byOwner after c
query oldMerged(c: cursor ?):
  return merge oldEvents after c last 20 by byOwner:
    [viewer]
job oldSweep():
  chunk e in oldEvents first 10 by byId:
    delete oldEvents[e.id]
-- For Following, declare `maintain timeline: timeline`; `guide feeds` has the complete app.
table timelineProfiles:
  principal: principal
  unique principal
  cap 1008
  immutable principal
  public 'timelineProfiles'
  insert <- .principal = viewer
  sync public
table timelineCards:
  parentId: timelineCards ?
  authorId: principal
  at: time
  removed: bool default false
  immutable authorId, parentId, at
  public 'cards'
  insert <- .authorId = viewer
  update <- .authorId = viewer
  sync public
table timelineReposts:
  actorId: principal
  postId: timelineCards
  at: time
  unique actorId, postId
  immutable actorId, postId, at
  public 'timelineReposts'
  insert <- .actorId = viewer
  delete <- .actorId = viewer
  sync public
table timelineFollows:
  followerId: principal
  followedId: principal
  at: time default 0
  unique followerId, followedId
  immutable followerId, followedId, at
  public 'edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

maintain timeline: timeline
  events timelineCards where .parentId = null and not .removed by authorId, at removed by removed
  reposts timelineReposts by actorId, postId, at
  edges timelineFollows by followerId, followedId

mutation timelineRegister():
  insert timelineProfiles { principal: viewer }
mutation timelinePublish():
  return insert timelineCards { authorId: viewer, at: now }
mutation timelineFollow(authorId: principal):
  insert timelineFollows { followerId: viewer, followedId: authorId, at: now } if absent
mutation timelineRemove(postId: timelineCards):
  update timelineCards[postId] { removed: true }
query timelineHome(c: cursor ?):
  return timeline[viewer] after c last 20 { *, post: timelineCards[.postId] }

```

An unread count can use the same expiring receipts as message history. The
server reads a total plus its unswept expiry backlog (`guide maintains`).

```quarry
table receipts:
  chat: id
  principal: principal
  state: int
  visible: bool
  expiresAt: time ?
  expire at .expiresAt
  read <- .principal = viewer
  sync last 500 by .id
view unreadCounts: count receipts where .state < 2 and .visible by .chat, .principal
query unread(chat: id):
  return unreadCounts[chat, viewer]
query inbox(c: cursor ?):
  return unreadCounts where .principal = viewer first 20 after c
```

`guide ephemeral`: short-lived server memory.

```quarry
table typing:
  principal: principal
  read <- allow
  insert <- .principal = viewer
  ephemeral 4s
```

## Membership paths

Immutable required references inherit parent membership rules:

```quarry
table members:
  conversation: id
  principal: principal
  unique conversation, principal
  cap 50 by conversation
  read <- exists members[.conversation, viewer]
  sync

table messages:
  conversation: id
  immutable conversation
  read <- exists members[.conversation, viewer]
  sync last 500 by .id

table reactions:
  message: messages
  principal: principal
  emoji: text <=32
  immutable message
  unique message, principal
  cap 50 by message
  read <- exists members[.message.conversation, viewer]
  insert <- .principal = viewer
  update <- .principal = viewer
  sync to members[.message.conversation]

mutation react(message: messages, emoji: text <=32) predicts:
  upsert reactions[message, viewer] { emoji }
```

This inherits `read through .message` semantics. `guide sync` covers three hops,
immutable required references, lifetime and E_READ_THROUGH / E_SYNC repairs;
`guide prediction` covers acquired coverage and rollback.
"##;
