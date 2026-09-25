//! The complete, compiled and executed Quarry language card.
pub const LANGUAGE: &str = r##"# Quarry — the language card

Quarry defines your tables, access rules and backend operations.
Queries and eligible mutations can run on devices that hold their inputs.

```quarry
use identity                          -- guests and password accounts; `use identity guests` or `use identity password` admits one kind
use personas alice, bob, carol        -- a development cast: `--as alice` and the persona header act as dev:alice
effect notify                         -- a name a mutation or job may `emit` under; a worker with a service token performs it (guide effects)

table rooms:
  name: text 1..80                    -- text <=N | text M..N, either with `format handle` or `format url`
  ownerId: principal                  -- principal | id | <table> (a reference to its row) | int | time (milliseconds) | bool
  kind: enum('open', 'closed')        -- enum('a', 'b') | decimal S | money CUR [S] | json <=N | bytes <=N | image <=N [once] | video <=N
  tags: [text <=20] <=8               -- [type] <=N: a bounded list
  parentId: rooms ?                   -- `?` makes a column optional: null when absent. Every table has an implicit `id` and a unique id
  createdAt: time default now          -- omitted on insert; evaluated on the writing host
  read <- exists members[.id, viewer]                                     -- rules: allow | deny | public ['why'] | .col = viewer | .col != 'x' | exists t[..] | created t[..] | and | or | not
  insert <- .ownerId = viewer
  update (old, next) <- old.ownerId = viewer and next.ownerId = viewer   -- an update rule may name both images
  delete <- deny
  after insert <- exists members[roomId = .id, principal = .ownerId, role = 'admin']                 -- a row that must exist by the end of the mutation that inserted this one
  sync to members[.id]                -- each row reaches every principal with a members row whose roomId is this row's id

table members:
  roomId: rooms
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

table messages:
  roomId: rooms
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
  expire at .expiresAt                -- absent to reads at its deadline; null never expires; caps count unswept rows
  sync last 500 by .at     -- the horizon: a device acquires the newest N per group; older rows are online-only

table receipts:
  message: messages
  state: int ?
  public 'delivery status is public in this example'
  online only

fn receiptState(m: messages):
  return min(receipts where .message = m.id, .state) ?? 2
query receiptStatus(messageId: messages):
  m = messages[messageId] ! else NOT_FOUND
  return { slowest: receiptState(m), fastest: max(receipts where .message = m.id, .state) }

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
  postId: posts
  principal: principal
  at: time
  immutable postId
  public 'likes are public'
  insert <- .principal = viewer
  online only
view receivedLikes: count likes by .postId.authorId -- one immutable hop to a public target; attribution is recorded by the engine
  online only

view messageCounts: count messages by .roomId       -- an aggregate the engine keeps: read it by group and get the number, 0 when the group has no row
                                                     -- read derives the source's membership rule because roomId is a bare group key
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

query heldRoom(roomId: rooms) held:   -- device only: dev and serve refuse E_QUERY_HELD; no server fallback
  return rooms[roomId] card

query room(roomId: rooms):            -- a query reads; its result type is inferred onto api.ts
  return rooms[roomId] card           -- one row by a unique key: null when absent or hidden; then the named shape

query helperRows(messageId: messages):
  m = messages[messageId] ! else NOT_FOUND
  return { body: messageBody(m), byId: messageById(messageId) }

query thread(roomId: rooms, c: cursor ?):                            -- `cursor ?` is the page argument; an omitted optional argument is null
  require exists members[roomId, viewer] else NOT_MEMBER              -- a refusal with the program's own code
  return messages where .roomId = roomId and .body != null and exists members[.roomId, viewer] last 50 by .at after c messageCard   -- messageCard shapes the page after authorization

query inbox(c: cursor ?):
  return members where .principal = viewer first 50 by .roomId after c { roomId, room: rooms[.roomId], unread: messageCounts[.roomId] }

query ancestors(roomId: rooms):
  chain = walk rooms[roomId] up .parentId depth 8                   -- the seed row plus at most eight parent hops
  return chain { id, name }

query digest(roomId: rooms):
  require exists members[roomId, viewer] else NOT_MEMBER
  page = messages where .roomId = roomId and .at >= now - 1d last 100 by .at                     -- a page bound to a name; count, sum, slice, sort and shapes take it
  (weeks, days) = divmod(count(page), 7)                             -- divmod binds quotient and remainder at once
  (lo, hi) = sorted(weeks, days)                                     -- two values in order
  counter = 0
  for message in page:
    counter = counter + 1                                           -- a local can carry a counter across iterations
  offsets = []
  for i in range(0, 3):
    if i = 2:
      continue                                                      -- advances the nearest loop
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
  earliest = min(page, .at)
  latest = max(page, .at)
  smallest = min([{ state: null }, { state: 1 }], .state)
  grouped = group(page, 'authorId') { author: .key, count: count(.items) }
  return { sum, earliest, latest, smallest, grouped, first: first(page), last: last(page), at: at(page, 1), total: messageCounts[roomId], counter, offsets, label, labelSize: count(label), doubled, quotient, remainder, weeks, days, lo, hi, brief: isBrief(null), oldest: sort(slice(page, 0, 10), 'at') { id, at }, smaller: min(weeks, days), larger: max(weeks, days) }

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
  return exists messages where .roomId = roomId                                  -- a prefix existence scan: first visible match, no page or cursor

query groupedMessages(q: text <=100, c: cursor ?):
  return members where .principal = viewer and exists (messages[roomId = .roomId] matching q) first 20 by .roomId after c { roomId, hits: messages[roomId = .roomId] matching q last 3 by .at }

query online(p: principal):
  return connected[p]                 -- how many connections the principal holds open on the server; `exists connected[p]` tests (guide presence)

mutation pagePass(roomId: rooms): server
  n = 0
  for row in members where .roomId = roomId first 10 by .principal:
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
  for m in members where .roomId = roomId:
    if m.principal != viewer:
      recipients = recipients + [m.principal]
  for p in recipients:                                              -- bounded derived lists may read and emit; row writes still need the complete-group proof
    if not exists connected[p]:
      emit notify { targetUserId: p, roomId, senderHandle: profiles[principal = viewer].handle, preview: slice(body ?? '', 0, 80) }   -- the profile read feeds only the effect: server-only, still predicts
  return { id: row.id, brief: isBrief(ttl), mentions: count(tokens(body ?? '')) }                                 -- `??` is the value when the left is null

mutation edit(messageId: messages, body: text <=4000, expected: text <=4000 ?) predicts:
  msg = messages[messageId] ! else NOT_FOUND                         -- the row, or refuse with the code; `msg` is present from here on
  require msg.authorId = viewer else NOT_AUTHOR
  update messages[msg] { body, editedAt: now } if .body = expected    -- a row as the key; `if` makes the update conditional: E_CONFLICT with the current row when false
  return null                                                        -- a bare `return` is the same

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

mutation split(total: int, people: [principal] <=8):
  insert ledger { ownerId: viewer, amount: share(total, people, viewer), weight: 1, at: now }   -- share: one person's part of an amount split evenly, deterministically

job nightly(periodStart: time, periodEnd: time):                    -- the server's own work: sweeps as the system principal, one engine-sized chunk per commit
  end = periodEnd                                                   -- the prelude runs again at the start of every chunk, under that chunk's meter
  for r in rooms:                                -- the index's columns are id or immutable, so nothing moves under the cursor
    if r.createdAt >= end:
      break                                                          -- ends this sweep; `return` ends the job
    stamp(r.id)
  for p in posts:
    for i in range(0, 2):                                            -- int expressions, under the step meter
      update posts[id = p.id] { score: p.score + i }
schedule everyNight every 1d at 03:00: nightly                       -- once per period boundary of the server's clock: every 2m | 1h | 1d [at HH:MM]
job rescoreNative(): native                                          -- a job whose body is the app's own Rust in snapback/native/, hosted as wasm (guide native)
query personalizeNative(first: int): native                          -- a read in the same module: on the server as the viewer, on a device over its rows

effect sendDigest secrets [MAIL_API_KEY] retry 4 backoff 1m deadline 1d cancellation deny
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

One file, `snapback/schema.q`, holds tables, views, shapes, helpers,
programs and schedules, in any order; more `.q` files beside it are modules
(their operations are `<module>.<name>`) sharing one namespace. Schedules use that
qualified job name too: `schedule repair every 1m: timeline.repair`; an unambiguous
bare module job gets this rewrite from `check --fix`. Comments
start with `--`. Blocks indent with two spaces. Everything the compiler
accepts is below; the suite compiles every block and runs the core program.

Time arithmetic uses durations: `now + 1m` is one minute from now,
and `now - .at` is elapsed time; `day(now)`, `hour(now)` and `bucket(now, 2m)`
produce UTC calendar ordinals. See `guide jobs` for scheduled work.

`createRoom` above predicts: its room is readable through the membership
inserted later in the same call. Reads authorize the current provisional
image against all pending writes. `edit` of retained history after leaving
the room also predicts, but the edited image is hidden until settlement.
See `guide prediction`.

Helpers expand at each call: a table-typed parameter keeps a row argument as a row (fields need no lookup), while a reference argument stays a reference.
An enum fits `text <=N` when every variant has at most N characters and
contains no control characters except tab, LF and CR. This is
static and total: no variant is truncated or converted at runtime. If one
variant is too long, declare the helper parameter with the enum instead.
After a scalar `where` predicate, a declared shape name shapes the page:
`where not .hidden card` and `where not .hidden { ...card }` agree. A valid
row/object shape inside a predicate keeps its meaning; parenthesize it to
make that scope explicit, or use `{ ...card }` explicitly for the page.

Reads: `t[id]` reads one row; `t[a, b]` needs one declared unique pair.
Named keys select columns explicitly. `t where predicate first 20 by .at
after c` pages matching rows. `last` reverses the order; id breaks ties.
Optional filters use `(status = null or .status = status)` to select a plan
for absent or present inputs; an empty `matching q` needle browses in order.
`count(t where predicate)`, `sum(t where predicate, .amount)`,
`min(t where predicate, .col)` and `max(t where predicate, .col)` stream a
domain. Min/max skip null values, as SQL does, and return null for an empty
or all-null domain; otherwise they return the column's type. An ordered
index seeks to the first visible matching non-null value; otherwise the
engine scans under its meters. `check --cost` names the plan. A cut aggregate
is unavailable, never a partial answer (even before `?? 2`). A device needs
complete coverage of the domain. Rules apply before any comparison. `exists` stops
at a visible match; an unknown domain cannot establish absence.

Values: `viewer` (a principal), `now` (a time; in a mutation it is the commit's
instant), `new` (an id, mutations only), `true`, `false`, `null`, integers,
`'text'` or `"text"` with `\n`, `\t` and `\\`, `[a, b]` (a bounded list),
`{ a, b: c }` (an object; a bare name is `name: name`). `=` and `!=` are total
(null equals null); `<` and friends, `+`, `-` and `*` need present operands:
narrow with `if x != null:`, `x ! else CODE`, `x ?? default`, or `require x
!= null else CODE`. Guards narrow fields of a bound row too, through `and`/`or`,
conditional arms and the paths that survive an early return; rebinding clears the fact. `time - time` is an int of milliseconds; `time + int` a
time. Text `+` concatenates two present texts. `count(text | page | list)` counts characters or items; `lower(text)`, `trim(text)`, `join(list, separator)`, `sum(page, .col)`, `sum(list)`, `min(a, b)`,
`max(a, b)`, `min(page, .col)`, `max(page, .col)` (also lists of rows), `slice(text | list, start, end)`, `sort(list, 'col', '-col')`,
`group(list, 'col')`, `first(list)`, `last(list)`, `at(list, index)` (element or null),
`tokens(text)`, `sha256(text)`, `share(amount, list, member)`, `(q, r) = divmod(a, b)`,
`(lo, hi) = sorted(a, b)`. `x = expr` binds or reassigns a local with a compatible type; reassignment resets its refinements. Arguments cannot be shadowed. A program ends
with `return [value]`, or with its last expression, or with its final write.
An inline ordered page needs parentheses to separate its order keys from
the column argument: `min((t first 20 by .at), .col)`. Binary `min(a, b)`
and `max(a, b)` retain their meaning; a collection followed by `.col` selects
the aggregate.

`xs = []` then `xs = xs + [value]` appends under the heap meter; `for x in xs:` can iterate the accumulated list.

`sha256` is for high-entropy capability tokens and content checksums. It hashes
the exact UTF-8 bytes without normalization and returns lowercase hexadecimal.
It is not password hashing, low-entropy email anonymization, a signature, a
MAC, or entropy generation; a digest is not automatically safe to publish.

`unique principal, day(at)` enforces calendar uniqueness. `search body`
declares word-prefix search. The planner builds indexes for predicates,
order, rule probes, sync, caps and expiry (`guide indexes`).

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
schedule summariesEveryDay every 86400s at 08:00 as service:reporter: scheduledSummary
route roomExport: post "/room-export" wait 5s -- signed-in caller; no Quarry body or client operation
route providerEvent: post "/hooks/room-events" as service:reporter secrets [ROOM_SIGNING_KEY] retry 8 backoff 2s deadline 1h cancellation allow wait 5s
```

## Starting in an existing directory

E_INIT_CONFLICT means `init` found files or package entries it would
overwrite, and wrote nothing. Rename the listed files or reconcile the
named package.json entries, then rerun `snapback4 init --expo` (or `--web`).
Unrelated files and symlinks can stay. An existing README.md stays intact;
the starter writes its setup instructions to README.snapback.md instead.

## Refusals

For a present row, `{ ...p, extra }` and `p { *, extra: extra }` contribute
the same columns and extra value. Shapes keep `*`; object fields and spreads
can replace inherited fields with an explicit field and its type, as `handle`
does above. Two explicit fields with the same name are refused.

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
name; declare a missing local before using it. For a page, name its predicate and order: `posts where .authorId = viewer
last 20 by .at after c`. `snapback4 check --fix` applies only mechanical repairs.

## Left out on purpose, and the idiom

- `while` and recursion → `for` over a page, list, `range(a, b)` with int expressions, or `tokens(text)`; `walk` for a chain.
- Floats → integer minor units in `decimal S` and `money CUR S`, or a native job.
- A typed map with dynamic keys → `group(list, 'col')`, whose result is a list of `{ key, items }` groups in first-seen order.
Before editing, `check --fix` verifies every compiled source; an editor save refuses the repair with its filename. Its final compile re-reads the project.

Ordinary field access propagates null: `row.body` is null when `row` is null.
`check --fix` removes only the `?` in `a?.b`, preserving the base expression
and evaluating it once, including when it is a call or read.

- Guessed spellings are refused with a canonical rewrite; `snapback4 check --fix` applies mechanical repairs (including missing indexes, argument `once`, repeated wildcard fields and empty operation parentheses): `cond ? a : b` → `a if cond else b`; `a?.b` → `a.b`; `len(x)` → `count(x)`; `elif` → `else if`; `proc` → `fn`; `//` and `#` → `--`; `==` → `=`.

Maintained columns put an aggregate on the row it describes. Their source
is ordinary and non-expiring. Omit `by` when exactly one source column references
the parent; otherwise name that reference explicitly. The
engine owns the column; a write result omits it. Read the row for its value.
Adding or redefining it recounts existing sources in atomic activation.
The event-free generation barrier makes devices reacquire; a missing stored
field reads 0 without an authored literal default. See `guide maintains`
for disclosure and stream cost, and `guide feeds` for Trending.

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

For a public Following feed, see `guide feeds`. Materialization requires
public, fully synced sources with immutable mappings and owner write rules.

## Reads and planned views

A predicate states which rows belong in a read. `by .at` orders by a column;
`first` ascends and `last` descends, with `id` breaking ties in that direction.
The compiler selects or synthesizes indexes. A positional key must name one
unambiguous declared unique key; named keys make the intended columns explicit.
`search` declares searchable text, and unnamed `unique` declares a unique key.
Duration literals are integer milliseconds in any expression.


## Materialized Following

The public activity union supplies a private delivered feed for each reader.

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
  sync public
table timelineReposts:
  actorId: principal
  postId: timelineCards
  at: time
  unique byActorPost: actorId, postId
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
  public 'edges'
  insert <- .followerId = viewer
  delete <- .followerId = viewer
  sync public

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

"##;
