//! The guide: the language card, the keyword cards, and the refusal codes.
//! Text a builder reads once and an agent reads on demand; no freshness
//! dates, nothing generated (LLP 3000 §4, NOT-DOING).
//!
//! Every fenced ```quarry block below is compiled by `tests/guide.rs`, and
//! the language card's block is run against the engine, so a card cannot
//! promise a form the parser refuses. A block that declares a table compiles
//! on its own; one that does not compiles beside the language card's schema.

/// The keyword cards, in the order `snapback4 guide` lists them.
#[path = "guide/actions.rs"]
mod actions;
#[path = "guide/personas.rs"]
mod personas;
#[path = "guide/search.rs"]
mod search;
#[path = "guide/writes.rs"]
mod writes;
#[path = "guide/prediction.rs"]
mod prediction;
#[path = "guide/discovery.rs"]
mod discovery;
pub use discovery::{listing, nearest};
pub const KEYWORDS: &[&str] = &["language", "types", "indexes", "rules", "sync", "residency", "prediction", "evolution", "expire", "assets", "reads", "shapes", "writes", "programs", "jobs", "native", "feeds", "search", "effects", "actions", "services", "presence", "bounds", "refusals", "personas"];

// @ref LLP 3000.007#20.1 — a builder's word resolves through one table to a compiled card.
pub const ALIASES: &[(&str, &str)] = &[
    ("grammar", "language"), ("quarry", "language"),
    ("predict", "prediction"), ("predictable", "prediction"), ("offline", "prediction"),
    ("optimistic", "prediction"), ("pending", "prediction"),
    ("pagination", "reads"), ("paging", "reads"), ("cursor", "reads"), ("next", "reads"),
    ("migration", "evolution"), ("migrate", "evolution"), ("schema-evolution", "evolution"), ("adoption", "evolution"),
    ("sql", "personas"), ("inspect", "personas"),
    ("push", "effects"), ("notification", "effects"), ("notify", "effects"), ("worker", "effects"),
    ("auth", "personas"), ("signin", "personas"), ("login", "personas"), ("session", "personas"),
    ("upload", "assets"), ("media", "assets"), ("image", "assets"), ("video", "assets"),
    ("realtime", "reads"), ("live", "reads"), ("subscribe", "reads"),
    ("order", "writes"), ("ordinal", "writes"), ("arrival", "writes"),
];

/// The contents of every ```quarry block in a card or a README.
pub fn quarry(text: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        match &mut current {
            Some(block) if line.trim_end() == "```" => {
                blocks.push(std::mem::take(block));
                current = None;
            }
            Some(block) => {
                block.push_str(line);
                block.push('\n');
            }
            None if line.trim_end() == "```quarry" => current = Some(String::new()),
            None => {}
        }
    }
    blocks
}

/// The language card's one program: every form, once.
pub fn language() -> String {
    quarry(LANGUAGE).into_iter().next().expect("the language card has one block")
}

pub const TEMPLATE: &str = r##"-- Your backend. `snapback4 check` compiles it; `snapback4 dev` serves it.
use personas alice, bob

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwner: ownerId, id
  cap 1000 by ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
  sync to .ownerId                        -- each owner's device holds its own todos

query list(c: cursor ?):
  return todos[viewer] after c first 100 by byOwner

mutation add(title: text <=200):
  return insert todos { title, done: false, ownerId: viewer }

mutation toggle(todoId: todos):
  todo = todos[todoId] ! else NOT_FOUND
  update todos[todo] { done: not todo.done }
  return null

mutation remove(todoId: todos):
  delete todos[todoId]
  return null
"##;

/// The online starter uses the same private rules with no device partition.
pub const TEMPLATE_ONLINE: &str = r##"-- Online-only backend. `snapback4 check` compiles it; `snapback4 dev` serves it.
use personas alice, bob

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwner: ownerId, id
  cap 1000 by ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer

query list(c: cursor ?):
  return todos[viewer] after c first 100 by byOwner

mutation add(title: text <=200):
  return insert todos { title, done: false, ownerId: viewer }

mutation toggle(todoId: todos):
  todo = todos[todoId] ! else NOT_FOUND
  update todos[todo] { done: not todo.done }
  return null

mutation remove(todoId: todos):
  delete todos[todoId]
  return null
"##;

/// The language card: the whole grammar in one file that compiles and runs,
/// then what is left out on purpose and the idiom for each.
pub const LANGUAGE: &str = r##"# Quarry — the language card

One file, `snapback/schema.q`, holds tables, maintains, shapes, helpers,
programs and schedules, in any order; more `.q` files beside it are modules
(their operations are `<module>.<name>`) sharing one namespace. Schedules use that
qualified job name too: `schedule repair every 1m: timeline.repair`; an unambiguous
bare module job gets this rewrite from `check --fix`. Comments
start with `--`. Blocks indent with two spaces. Everything the compiler
accepts is below, once; the suite compiles and runs this file.

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
  unique byRoomPrincipal: roomId, principal            -- `unique` orders and constrains
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
  score: int
  at: time
  by byAuthorTime: authorId, at, id
  by byTime: at, id
  public 'posts are public'           -- the read rule as a table line, with its reason
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  sync public last 200 by byTime      -- everyone holds the same rows

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
  unique byHandle: handle
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
  online only                         -- opt out of inheriting public sync

shape card = { id, name, owner: .ownerId, tagCount: count(.tags) }   -- a named shape: `.` is the row; `row card` and `page card` use it
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

query room(roomId: rooms):            -- a query reads; its result type is inferred onto api.ts
  return rooms[roomId] card           -- one row by a unique key: null when absent or hidden; then the named shape

query helperRows(messageId: messages):
  m = messages[messageId] ! else NOT_FOUND
  return { body: messageBody(m), byId: messageById(messageId) }

query thread(roomId: rooms, c: cursor ?):                            -- `cursor ?` is the page argument; an omitted optional argument is null
  require exists members[roomId, viewer] else NOT_MEMBER              -- a refusal with the program's own code
  return messages[roomId] after c last 50 by byRoomTime where .body != null and exists members[.roomId, viewer] { *, room: rooms[.roomId], count: messageCounts[.roomId] }   -- a page from a cursor, shaped: `*` spreads the row; a point read inside is null for a hidden row

query inbox(c: cursor ?):
  return members[viewer] after c first 50 by byPrincipalRoom { roomId, room: rooms[.roomId], unread: messageCounts[.roomId] }

query following(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:               -- one ordered page over several prefixes of one index
    [viewer]
    [f.followedId] for f in follows[viewer] first 20 by byPair
  return page { *, author: profiles[.authorId], mine: reactions[.id, viewer] }

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

query search(roomId: rooms, q: text <=100, c: cursor ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  return messages[roomId] matching q after c last 50 by byRoomWords   -- word-prefix search: every term a prefix of some word of the row, newest first

query everywhere(q: text <=100, c: cursor ?):
  return merge messages matching q after c last 50 by byRoomWords:
    [m.roomId] for m in members[viewer] first 50 by byPrincipalRoom

query online(p: principal):
  return connected[p]                 -- how many connections the principal holds open on the server; `exists connected[p]` tests (guide presence)

mutation pagePass(roomId: rooms): server
  n = 0
  for row in members[roomId] first 10 by byRoomPrincipal:
    n = n + 1
  return n

mutation createRoom(name: text 1..80, kind: enum('open', 'closed'), tags: [text <=20] <=8):
  room = insert rooms { id: new, name, ownerId: viewer, kind, tags }   -- `new` mints an id; omit `id` and one is minted anyway
  insert members { roomId: room.id, principal: viewer, role: 'admin', joinedAt: now }
  upsert rooms[room.id] { createdAt: now }                            -- patches the existing room; name, owner, kind and tags stay
  return room card

mutation sendBrief(roomId: rooms, body: text <=4000 ?, ttl: int ?):
  require exists members[roomId, viewer] else NOT_MEMBER
  row = insert messages { roomId, authorId: viewer, body, at: now, expiresAt: now + ttl if ttl != null else null }   -- a conditional value: the arm not taken never runs, and `ttl` is present in the taken one
  for m in members[roomId] first 100 by byRoomPrincipal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, roomId, preview: slice(body ?? '', 0, 80) }   -- kept in this commit; a worker claims and settles it (guide effects)
  return { id: row.id, brief: isBrief(ttl), mentions: count(tokens(body ?? '')) }                                 -- `??` is the value when the left is null

mutation edit(messageId: messages, body: text <=4000, expected: text <=4000 ?):
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
```

Helpers expand at each call: a table-typed parameter keeps a row argument as a row (fields need no lookup), while a reference argument stays a reference.

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
`tokens(text)`, `share(amount, list, member)`, `(q, r) = divmod(a, b)`,
`(lo, hi) = sorted(a, b)`. `x = expr` binds or reassigns a local with a compatible type; reassignment resets its refinements. Arguments cannot be shadowed. A program ends
with `return [value]`, or with its last expression, or with its final write.
`xs = []` then `xs = xs + [value]` appends under the heap meter; `for x in xs:` can iterate the accumulated list.

## Left out on purpose, and the idiom

- `while` and recursion → `for` over a page, list, `range(a, b)` with int expressions, or `tokens(text)`; `walk` for a chain.
- Floats → integer minor units in `decimal S` and `money CUR S`, or a native job.
- A typed map with dynamic keys → `group(list, 'col')`, whose result is a list of `{ key, items }` groups in first-seen order.
Before editing, `check --fix` verifies every compiled source; an editor save refuses the repair with its filename. Its final compile re-reads the project.

- Guessed spellings are refused with a canonical rewrite; `snapback4 check --fix` applies mechanical repairs (including missing indexes, argument `once`, repeated wildcard fields and empty operation parentheses): `cond ? a : b` → `a if cond else b`; `a?.b` → `a.b if a != null else null`; `len(x)` → `count(x)`; `elif` → `else if`; `proc` → `fn`; `//` and `#` → `--`; `==` → `=`.

Cards: `snapback4 guide <keyword>` — types, indexes, rules, sync, residency, prediction, evolution, expire,
assets, reads, shapes, writes, programs, jobs, native, feeds, search,
effects, actions, services, presence, bounds, refusals, personas. `snapback4 why
<CODE>` explains a refusal.
"##;

pub fn card(keyword: &str) -> Option<&'static str> {
    let keyword = ALIASES.iter().find(|(alias, _)| *alias == keyword).map_or(keyword, |(_, target)| *target);
    Some(match keyword {
        "language" => LANGUAGE,
        "prediction" => prediction::CARD,
        "evolution" => discovery::EVOLUTION,
        "types" => r##"# Types

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
  handle: text 3..20 format handle    -- format handle | url is checked on every write
  site: text <=200 format url ?
  kind: enum('a', 'b')                -- a text literal in this position is a variant
  meta: json <=4000 ?
  raw: bytes <=1024 ?
  photo: image <=10000000 once ?      -- an upload (guide assets); `once` serves one view per principal
  clip: video <=50000000 ?
  tags: [text <=20] <=8               -- a bounded list of a scalar type; `?` after the whole type, never on the element
  unique byHandle: handle
  read <- .who = viewer
  insert <- .who = viewer
  update <- deny
  delete <- deny

query typed(c: cursor ?, handle: text 3..20 format handle):   -- arguments take the same types, plus `cursor ?`
  return everything[handle]
```

`?` after a type makes it optional: null when absent, and an omitted
optional argument reads as null. Text literals in id positions are ids. A
`<table>` reference is a typed id, with no implicit existence check and no
delete cascade: the string `"null"` is an id, and JSON null only fits an
optional type; when a target must be visible, `require exists t[id] else
CODE` before the write (guide writes). `=`
and `!=` are total (null equals null); `<` and friends need present operands:
narrow with `if x != null:`, `x ! else CODE`, or `x ?? default`. A null guard
also narrows a bound row's field (`r.changedAt != null`), until the local is rebound. `time`
arithmetic: `time - time` is an int, `time + int` a time. `/` and `%` give
the Euclidean quotient and remainder of ints or times; zero refuses `E_DIV_ZERO`.
Text `+` concatenates; `count(text)` counts characters. Loop-built strings and
lists are heap-bound; a write still validates their actual column lengths.
A column may end with `default <literal | now | viewer>`. Omitted insert
fields take their defaults before rules run; explicit values, including null
on an optional column, win. `now` and `viewer` use the writing host's context.
An added required column with a literal default also fills absent fields in
old images on every host, without rewriting rows or logging partition events.
Changing a required default rechecks its existing unique indexes and caps too.
`data` and `sql` show that interpretation; device persistence exports are raw storage images.
Optional columns still read null when absent. New required `default now` or
`default viewer` columns adopt only an empty table; otherwise use an optional
column or a literal default. `check` reads `.snapback4/store.sqlite` when it
exists (or `--store path`); `E_ADOPT` locates each successor refusal and its
rewrite, as `dev` refuses the save. Without a store, check only compiles.
Pages, lists and shaped collections share the list operations: `sort`, `slice`,
`count`, `sum`, `group`, `first`, `last`, `at`, `join` and `for`. Their elements
must still fit the operation: `join` joins texts; `sum(page, .amount)` projects numbers."##,
        "indexes" => r##"# Indexes

```quarry
table tasks:
  ownerId: principal
  projectId: id
  done: bool
  at: time
  unique byOwnerProject: ownerId, projectId         -- `unique` orders and constrains: one row per (ownerId, projectId)
  by byOwnerDone: ownerId, done, at, id             -- `by` orders; a scan pins a prefix and pages along the rest
  cap 500 by ownerId                                -- a cap needs an index leading with exactly its columns
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer

query indexForms(projectId: id, c: cursor ?):
  one = tasks[viewer, projectId]                    -- a point read is a full unique key
  open = tasks[viewer, false] after c first 50 by byOwnerDone   -- a range is a strict prefix; a cursor needs an index ending in id, or a unique one
  return { one, open }
```

Every table has `byId`. A point read (`t[key]`, `update`, `delete`,
`upsert`) needs a unique index over exactly the key's columns; `exists
t[key]` needs any index over exactly them; a page needs an index whose
prefix is the key, and pages in the order of the remaining columns. When
two indexes match, `by name` chooses. `expire at .col` needs an index
leading with the column; a merge's lanes are equal-width prefixes of one
index; a job's `chunk` sweeps an index whose columns are `id` or
`immutable`. The diagnostic names the indexes that exist and the one to
declare."##,
        "rules" => include_str!("guide/rules.md"),
        "sync" => r##"# Sync: the viewer's partition is the unit of sync

```quarry
table notices:
  body: text <=500
  at: time
  by byTime: at, id
  public 'notices are public'
  insert <- deny
  update <- deny
  delete <- deny
  sync last 100 by byTime            -- everyone holds the newest 100

table todos:
  ownerId: principal
  title: text <=200
  by byOwner: ownerId, id
  read <- .ownerId = viewer                 -- exactly the audience
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
  sync last 500 by byOwner      -- each row reaches the principal in the column

table participants:
  threadId: threads
  personId: principal
  addedBy: principal
  unique byThreadPerson: threadId, personId
  by byPersonThread: personId, threadId, id
  cap 50 by threadId
  read <- exists participants[.threadId, viewer]
  insert <- exists participants[.threadId, viewer]
  delete <- .personId = viewer
  sync by .personId   -- the target has two principal columns: name the recipient

table threads:
  subject: text <=200
  read <- exists participants[.id, viewer]
  insert <- allow
  update <- deny
  delete <- deny
  retain delivered-history                  -- a device keeps these rows after it leaves the thread
  sync to participants[.id] by .personId    -- each row reaches every principal with a participants row whose threadId matches
```

`sync [last N by index]` infers its audience from the read rule. Explicit
`sync public` and `sync to ...` remain valid and must agree with that rule.
The read rule must be exactly the audience — `public`, `.col = viewer`, or
`exists t[.a, .b, viewer]` — so a device never holds a row it may not read
and never misses one it may; a second disjunct or an extra conjunct is
refused with the rewrite. The target table needs a unique index over
`(a, b, principal)` and an index leading with `(principal, a, b)`; when it
has several principal columns, `by .col` names the recipient. Every insert
rule branch must also prove the caller already has that audience grant, for
example `exists participants[.threadId, viewer]`, or that this mutation
created the group. `.personId = viewer` alone is refused because it would
let anyone join. Audience keys are immutable or guarded on update. These
checks also cover insert-if-absent and upsert. The horizon
`last N by index` bounds what a device acquires per group: the newest N stay
on the device, older rows are online-only, and a local read past them is
`complete: false`. A synced table with no horizon delivers every row of
every group a device holds, at every cold start, as the table grows;
`check` notes it (N_NO_HORIZON) unless the group cannot grow (one row per
group, or a `cap` over the group). A snapshot arrives in pages the client
asks for 4,000 events at a time (2,000 by default on the wire, 10,000 at
most), each applied in its own transaction. `POST /sync` takes JSON
`{ from, limit, after, stream, pending }`: up to 256 pending write IDs of
1–128 UTF-8 bytes, with the cursor, in at most 262,144 body bytes (256 KiB).
Oversize bodies, including chunked ones, return HTTP 413 `E_INPUT`; malformed
fields return HTTP 400 `E_INPUT`. Continue snapshots with `after: next`;
`stream: true` follows the log even from zero. There is no GET sync route.
Joining a group delivers its
rows; leaving it delivers one scope tombstone, and `retain` says whether the
device keeps what it was given (`delivered-history`) or drops it
(`until-revoked`, the default). Retained rows survive a leave whatever the
horizon; the horizon bounds what a device acquires, never what it keeps.
The same local completeness rule applies after leaving: an exhausted horizon
is `complete: false`, while unbounded whole-group history is `complete: true`.
A read pinning the left group answers from those rows on the device online
and offline, through a query without a membership `require`; the server
cannot serve that retained history. Replacement snapshots keep left groups
and replace held groups with their current acquisition. If the same query
also has an unknown held-group read, it still falls back to the server.
Keep a read of a left group in its own query: mixing its retained rows with an unknown held-group read returns the whole server answer online (without the left rows) and the whole device answer offline.
A table without `sync` is online-only. A `maintain`
grouped by the audience columns inherits sync and is delivered as a value row.
`online only` on a table documents the absence of sync; on a maintain it opts
out of inheritance. Both lines absent on a table still means online only.
See `guide residency` for operation classes and cold acquisition measurements."##,
        "residency" => r##"# Residency: facts at check, coverage on each call

```quarry
table notices:
  body: text <=200
  author: principal
  at: time
  by byTime: at, id
  by byAuthor: author, id
  public 'a public bulletin'
  insert <- .author = viewer
  sync last 100 by byTime
maintain noticeCounts: count notices by author
  read <- allow
  online only
table audit:
  actor: principal
  by byActor: actor, id
  read <- .actor = viewer
  online only
query notice(id: notices):
  return notices[id]
query countNotices(author: principal):
  return noticeCounts[author]
mutation post(body: text <=200):
  insert notices { body, author: viewer, at: now }
```

`check --residency` prints two tables of facts: each table's audience and
horizon (inferred audiences say "from the read rule"; maintains name their
source), then operations and their read sites: held, horizon, or server.
Queries run on the device unless a site is server-only. Mutations predict
when eligible; every mutation can queue. An eligible mutation's horizon
sites say "may queue without a row past the horizon"; E_PREDICT names the
site, table, index and key the device could not establish. Native reads
need the app's module on the device.
Queries reading `connected` run on the server; mutations stay eligible when presence decides only effects.
Presence-derived values use only total comparisons, boolean logic and fixed-size field values; fallible work keeps `never`.

`why notice` names its horizon; `why countNotices` names the online-only
maintain and the rewrite. `why notices` prints the rule that inferred sync.
Generated api.ts documents arguments, results, runs/predicts, horizon sites
and require codes. check compares with generated/residency.json; dev compares
with the generation it serves. N_NOW_SERVER names a newly server-run query.
N_NOT_PREDICTABLE names lost eligibility or an added horizon risk, explicitly
distinguishing a call that may queue from an operation that never predicts.

N_MAINTAIN_SYNCED names public inherited aggregates and group audiences
with unbounded recipients or multiple values per group. Add online only
to opt out. Run
`test --residency --fixture dir --as alice` to measure cold rows and compact
JSON row bytes per synced table and persona, plus totals and aggregate row
counts. Facts are labelled facts; measurements exclude transport framing
and are not estimates for another fixture.

An observed server-run query re-runs after commits touching its tables.
Offline it returns its last server answer, held in memory for this client's
lifetime, with fresh: false and since. Without one it refuses E_OFFLINE
(family link, retryable). It never answers an empty device page as server data."##,
        "expire" => r##"# Expire: a row's life ends at a time

```quarry
table stories:
  authorId: principal
  body: text <=500
  expiresAt: time ?                        -- a null time never expires
  by byAuthorTime: authorId, id
  by byExpiresAt: expiresAt                -- the sweep finds due rows here, without a walk
  read <- .authorId = viewer
  insert <- .authorId = viewer
  update <- deny
  delete <- .authorId = viewer
  expire at .expiresAt
  sync to .authorId last 200 by byAuthorTime

mutation postStory(body: text <=500, ttl: int ?):
  return insert stories { authorId: viewer, body, expiresAt: now + ttl if ttl != null else null }
```

A row past the time in the column is absent — to every reader, on every
host, before any rule — from that moment; the server's sweep deletes it
within a second, and the deletion streams to each device holding it, so it
leaves local stores on the next sync. Disappearing messages are one field on
insert; there is no purge job to write. A `maintain` over an expiring table
reads its live source group under the read meter; index the grouping columns
to avoid walking unrelated groups. A rule may probe whether that live group
exists at one rule-probe unit, regardless of expired sources. A rule equality
on its `value` is refused at `check` (E_QUARRY_LIVE_MAINTAIN_PROBE): read the
maintain in the program; its live value cannot be probed at one unit. Value
equalities on non-expiring maintains and ordinary tables remain supported.
A partial device counts only held live
sources and says `complete: false`. A meter cut returns the contribution
examined so far, also incomplete. A zero sum keeps its group while sources
remain, because one signed contribution can expire before another."##,
        "assets" => r##"# Assets

The local client keeps server upload facts for prediction: `{ id }` works
offline after upload, including reads of duration and dimensions. Without
those facts the write queues unpredicted and the server judges it.
With `createLocalClient({ assets: { keep: "viewed", maxBytes: 67108864 }, ... })`,
ordinary viewed images and videos survive offline reopen in device storage.
`keep: "none"` (the default) retains no media. The byte bound evicts least
recently used assets. Home-row deletion, clearing, expiry and partition leave
purge the bytes; `once` is never stored. Online reads always revalidate.: upload, place, serve

```quarry
table clips:
  ownerId: principal
  photo: image <=10000000 once ?           -- `once`: one view per principal, never cached
  clip: video <=50000000 ?
  at: time
  by byOwnerTime: ownerId, at, id
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- deny
  delete <- .ownerId = viewer
  sync to .ownerId last 100 by byOwnerTime

mutation sendClip(clip: video <=50000000):
  duration = clip.duration                 -- the argument carries the facts the server sniffed: type, bytes, width, height, duration; null where the kind has none
  require duration != null else DURATION_UNKNOWN
  require duration <= 60000 else TOO_LONG
  return insert clips { ownerId: viewer, clip, at: now }
```

A client uploads the bytes first (`client.upload(file)` → `{ id, type,
bytes, width, height, duration }`; the server sniffs JPEG, PNG, WebP and
MP4 and refuses the rest with E_ASSET_TYPE, and anything over the largest
column's bound with E_ASSET_TOO_LARGE). Images must be nonzero, at most
16,384 pixels on either side and at most 40 million pixels total; video must
have a positive duration no longer than one hour (E_ASSET_BOUNDS). The client
passes `{ id }` as the
mutation's argument; the row carries the facts the server established. One
asset, one home: the uploader's own upload, placed once (E_ASSET_UNKNOWN,
E_ASSET_PLACED). Serving is the home row's read rule: `client.asset(id)` (a
blob URL; `useAsset(id)` in React) or `client.assetSource(id)` (a URI and
headers for native views) fetches `GET /assets/<id>` under the viewer's
credentials, and a row that is deleted, whose column is cleared, that
expired, or that the viewer may not read answers 404 E_ASSET_UNKNOWN.
`once`: the second fetch by the same principal is 410 E_ASSET_VIEWED, and
the uploader is counted after placement; before placement the uploader may
preview. A Range request against a once asset is refused before consuming a
view (E_ASSET_RANGE). Unsatisfiable ordinary ranges return HTTP 416. Every
asset response is `private, no-store`, so a browser must reauthorize each
viewer. At most two uploads run at once, and their disk writes happen outside
the engine mutex. Uploads are online only; there is nothing to queue."##,
        "reads" => r##"# Reads

Named equalities covering a total unique key read one row and check any extra
columns there: `t[key = x, col = y]` returns null on a mismatch, and
`exists t[key = x, col = y]` returns false. A non-unique prefix still needs an index.

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
Modifiers come in one order: `after c`,
then `first N` or `last N`, then `by index`, then optional `where predicate`. A page a query returns without
a cursor cannot be continued: an unfiltered page with more rows reads
`complete: false` with no `next` (N_NO_CURSOR); declare `c: cursor ?` and
page with `after c`. A merge reads plain lanes, or matching lanes over a
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
A filled page positions `next` after its last returned row. A meter-cut page
positions after its last rule-visible examined row, even if the filter rejected
it, never after a hidden row. A non-uniform page stays incomplete; a cut in a
hidden run with no rule-visible row ends on an empty capped page."##,
        "shapes" => r##"# Shapes

```quarry
shape brief = { id, body, author: .authorId }                        -- a named shape: bare columns, and `.` for the row

query shapeForms(roomId: rooms, messageId: messages, c: cursor ?):
  page = messages[roomId] after c last 20 by byRoomTime { *, room: rooms[.roomId], count: messageCounts[.roomId] }   -- over a page: `*` spreads every column; a point read inside is null for a hidden row
  row = rooms[roomId] { id, name, tagCount: count(.tags) }           -- over a row: an object; over a nullable row: null when the row is
  named = messages[messageId] brief                                  -- a named shape by its name
  nested = rooms[roomId] { ...card, extra: 1 }                        -- `...name` spreads a named shape's fields
  return { page, row, named, nested }
```

The table and shape names are the language card's. A shape over a page is
a bounded loop; its fields are the row's columns by bare name, `*` for all
of them, `...shape` for a named shape's fields, and `name: expr` with `.`
as the row. A shape is the only projection: there is no `select`.
A table-typed helper accepts that table's row or reference. A reference has no
fields: read `messages[m] ! else NOT_FOUND` first, or select through the shape's
implicit row parameter, `messages[m] { body: .body }`. Shapes are projections,
not declared helper-argument types.
A helper's early `return` inside a page's shape ends only that call; the page
keeps its `next` cursor and completeness.
A collector that exits with rows still unconsumed makes the query incomplete,
even on a short final page. Each page needs its own returned owner when it has
more rows: one field's cursor cannot cover a lost sibling or auxiliary page.
A fully consumed, exhausted scan needs no cursor owner, even when its row count
equals the bound and the query returns a scalar such as `count(rows)`.
A row-based shape keeps `pending?: boolean` from its base, including `*`, named
spreads and subsequent shapes. It is this device's unconfirmed change, absent
after confirmation; it is not a schema column or metadata on a containing record."##,
        "writes" => writes::CARD,
        "programs" => r##"# Programs

```quarry
query programForms(roomId: rooms):                             -- reads only; the last expression, or `return`, is the result, typed onto api.ts
  rooms[roomId] card

mutation programWrites(roomId: rooms, title: text 1..80):     -- reads and writes in one transaction, at most once per client-minted id
  room = rooms[roomId] ! else NOT_FOUND
  require room.ownerId = viewer else NOT_OWNER
  update rooms[room] { name: title }                           -- a final write is the implicit return
```

A mutation with `predicts: "never"` (a server site or `: server`) may pass
over a bounded plain prefix page whose read rule is uniform over its prefix,
without a complete schema-capped group. `matching`, merges and tables with
expiry are refused for every mutation page, predicting or not, looped or bound (`E_STRUCTURAL_FANOUT`). A predicting mutation
keeps the complete-group requirement. Every page a mutation reads, even just
binding it, must be uniformly decided by its prefix (`E_STRUCTURAL_FANOUT`):
read it in a query, or pin the deciding columns.
The pass is atomic and still aborts above 1,024 rows written. `check --cost`
prints "a pass over the first N rows of <prefix>; examined ceiling <n>".

The table names are the language card's; a `job` is `chunk row in
t[prefix] first N by index:` sweeps (guide jobs), or `native`: the app's
own Rust, hosted as wasm; a `query` may be `native` too, run on the server
as the viewer and on a device over its rows (guide native). Operations in `schema.q`
are called by name (`api.thread`); operations in `snapback/feed.q` are
`api.feed.<name>`; jobs are not on api.ts. `require cond else CODE` refuses
with the program's own code, which reaches the client as `{ code, family:
"rule", .. }`; `CODE` is UPPER_SNAKE and never starts with `E_`. Statements
are `x = expr` (bind or reassign a local), `(a, b) = divmod(..)`, `require`, `if:`/`else if:`/`else:`, `for x in
domain:`, `break`, `continue`, `return`, a helper `fn` call, and a write; every other
expression must be bound or returned. `fn` takes one expression or a body ending
in `return expr` or a bare `return`; calls work in statements and expressions.
A helper return exits only the helper, and its locals cannot capture the caller's.
It never repositions or reclassifies an enclosing page.
Queries cannot write or mint ids, including through a helper; the call site names
the write that does not belong."##,
        "jobs" => r##"# Jobs and schedules: the server's own work, on its own clock

Jobs in `snapback/jobs.q` are named `jobs.<name>` even in that file's schedules;
`schema.q` jobs use their bare names. `check --fix` qualifies an unambiguous bare module job.

```quarry
table invites:
  inviteeId: principal
  sentAt: time
  reminded: bool
  by byInvitee: inviteeId, id
  read <- .inviteeId = viewer
  insert <- deny
  update <- deny
  delete <- deny

job remind(periodStart: time, periodEnd: time):
  end = periodEnd                                    -- a read-only prelude, repeated before every chunk
  chunk i in invites first 100 by byId:                -- one page per commit, as the system principal; byId's columns cannot move
    if i.sentAt >= end:
      break                                            -- ends this sweep; `return` ends the job
    if not i.reminded:
      update invites[i.id] { reminded: true }
schedule remindDaily every 1d at 08:00: remind          -- or `every 2m`, `every 1h`; the shortest period is 1m
```

A job is a sequence of sweeps, optionally preceded by statements. Those
statements run at the start of every chunk under its meter; their bindings
are visible in every chunk. A write belongs to a chunk, never the prelude.
Each `chunk x in table[prefix] first N by
index:` walks one index a page per commit as the system principal (every
rule passes; validation, constraints, aggregates and partitions apply)
under the job ceilings (guide bounds). The cursor commits with the rows, so
a chunk is wholly done or not started and a restart resumes at the next
one; the index's columns are `id` or `immutable`, so nothing moves under
the cursor, and rows inserted past the key captured when the sweep began
are not visited, so a sweep over its own table ends. A refused chunk parks
the job with its refusal (`snapback4 doctor` lists runs). No client calls
a job: a schedule fires it once per period boundary of the server's clock,
exactly once across restarts, passing `periodStart` and `periodEnd` when
the job declares them (and nothing else); a schedule first seen fires from
its next boundary. `snapback4 run <job> '{..}'` runs one here and now."##,
        "native" => r##"# Native jobs and reads: the app's Rust, hosted as wasm, metered like a job

```quarry
job rescore(): native                    -- the body is snapback/native/, in Rust
schedule rescoreEvery every 5m: rescore  -- fired like any job
query personalize(first: int): native    -- a read: on the server as the viewer, on a device over its rows
```

`snapback/native/` is a Cargo package the app owns (`crate-type =
["cdylib"]`, its own `[workspace]`, a dependency on `snapback4-native`);
`module!` names its jobs and its reads. `snapback4 check` writes `snapback/generated/native.rs` — a constant per
table, index and maintain, a `serde` struct per table — builds the package
for wasm32-unknown-unknown into `snapback/generated/native.wasm`, and
refuses if a declared job or read is not one the module implements. `dev`
rebuilds on save; `deploy` ships the module with the release; `run <name>`
runs one here; `doctor` says whether the module and the toolchain are in
place.

```rust
// snapback/native/src/lib.rs
use snapback4_native::{Chunk, Ctx, Next, Order, Result, from_row, json, row_of};
mod schema { include!("../../generated/native.rs"); }
use schema::*;
snapback4_native::module! { jobs: [rescore], reads: [personalize] }

fn rescore(ctx: &Ctx, chunk: &Chunk) -> Result<Next> {
    let page = ctx.scan(tables::POSTS, indexes::posts::BY_ID, &[], Order::Asc, 100, chunk.state.as_ref())?;
    for row in page.rows {
        let post: Posts = from_row(row)?;
        let votes = ctx.maintained(maintains::POST_SCORE, &[json!(post.id)])?;
        let age_hours = (chunk.now - post.at) as f64 / 3_600_000.0;
        let score = (votes as f64 * 10.0 - age_hours.powf(1.5)).round() as i64;
        ctx.upsert_by(tables::RANKED, indexes::ranked::BY_POST, &[json!(post.id)], row_of(&Ranked { id: String::new(), post_id: post.id, score, at: post.at })?)?;
    }
    Ok(match page.next { Some(state) => Next::Again(state), None => Next::Done })
}

fn personalize(ctx: &Ctx, args: &Json) -> Result<Json> {
    let viewer = ctx.viewer()?;
    let page = ctx.scan(tables::RANKED, indexes::ranked::BY_SCORE, &[], Order::Desc, 50, None)?;
    let mut items: Vec<(i64, Json)> = Vec::new();
    for row in page.rows {
        let ranked: Ranked = from_row(row)?;
        let seen = ctx.lookup(tables::SEEN, indexes::seen::BY_READER_POST, &[json!(viewer), json!(ranked.post_id)])?.is_some();
        items.push((ranked.score - if seen { 1000 } else { 0 }, json!({ "postId": ranked.post_id, "seen": seen })));
    }
    items.sort_by_key(|(weight, _)| -*weight);
    Ok(Json::Array(items.into_iter().map(|(_, item)| item).collect()))
}
```

A **native read** (`query name(args): native`) is the twin: the same Rust
runs on the server as the viewer — every `Ctx` read under the viewer's
rules and the read meter, `complete` from the meter — and on a device over
the rows it holds, with the device's words (a page at the horizon is
`complete: false`); the same rows give the same answer, floats included
(`wasmi` is built deterministic). A device fetches the module from
`/native.wasm` once per digest and keeps it, so a cold start offline
answers native reads too; a device without the module says so and the
client asks the server. A native read cannot write, returns no cursor
(page by your own arguments), and returns the value model (ints, not
floats: round a score). A mutation cannot be native: a device predicts
Quarry and the server replays it.

One chunk per call, one transaction per chunk, under the job ceilings
(guide bounds): the job returns `Next::Again(state)` to be called again with
that state after the chunk commits — a scan's `next` is the natural state,
so a crash resumes at the next page as a Quarry `chunk` resumes by its
cursor — or `Next::Done`. Every `Ctx` read and write is the interpreter's
own on the chunk's transaction (`get`, `lookup`, `maintained`, `scan`,
`mint`, `insert`, `insert_if_absent`, `update`, `upsert`, `upsert_by`,
`delete`): rules pass for the system, validation, constraints, maintains
and partition events apply, the meter counts, and so the ordinary query and
`sync` serve what the job wrote. The first refusal — a bound, a constraint,
a bad value — parks the job with it (`snapback4 doctor` lists runs); a panic
parks it as E_NATIVE_TRAP with the panic's text; 2,000,000,000 units of
fuel per chunk (about 90,000 per host call) is the step ceiling, so the row
ceilings bind first. The module imports one host function and nothing
else: no clock, no randomness, no network — `chunk.now` is the host's — so
a native job runs under the simulator like any job. Quarry still declares
the table, its rules and its `sync`; a query or mutation cannot be native,
because a device predicts Quarry and the certificate reads it. Anything
that needs the network stays outside and writes into a table the job
reads. A query, not a mutation, can be native too (LLP 3000.005 §9)."##,
        "feeds" => r##"# Feeds: fan out on write, read one page

A feed can merge followed accounts' ordered lanes. Uniform lanes with a
unique index or one ending in id read one head each, then advance the
winning lanes. Discovery, lookahead and expired rows still consume the
meter; N_WIDE_MERGE describes that work. For frequent reads over many
accounts, write each reader's entry when the post is made, sync the
entries to the reader, and read one page:

```quarry
use identity
use personas alice, bob

table posts:
  authorId: principal
  body: text <=500
  at: time
  by byAuthorTime: authorId, at, id
  public 'posts are public'
  insert <- .authorId = viewer

table follows:
  followerId: principal
  followedId: principal
  bucket: int                     -- assigned by the app; bucket 0 receives immediate delivery
  unique byPair: followerId, followedId
  by byFollowed: followedId, followerId
  by byFollowedBucket: followedId, bucket, followerId
  cap 1000 by followedId
  cap 200 by followedId, bucket
  public 'follows are public'
  insert <- .followerId = viewer
  delete <- .followerId = viewer

table feed:                       -- one row per reader per post
  readerId: principal
  postId: posts
  authorId: principal
  at: time
  unique byReaderPost: readerId, postId
  by byReaderTime: readerId, at, id
  read <- .readerId = viewer
  insert <- .authorId = viewer    -- the author writes their readers' entries; the job writes as the system
  sync to .readerId last 200 by byReaderTime

table fanouts:                    -- the work still to do: a post's readers outside bucket 0
  postId: posts
  authorId: principal
  at: time
  read <- deny
  insert <- .authorId = viewer

mutation createPost(body: text <=500):
  p = insert posts { authorId: viewer, body, at: now }
  insert feed { readerId: viewer, postId: p.id, authorId: viewer, at: now }
  for f in follows[viewer, 0] first 200 by byFollowedBucket:
    insert feed { readerId: f.followerId, postId: p.id, authorId: viewer, at: now }
  insert fanouts { postId: p.id, authorId: viewer, at: now }
  return { id: p.id }

job fanOut():                     -- the rest, within a minute
  chunk w in fanouts first 5 by byId:
    for f in follows[w.authorId] first 1000 by byFollowed:
      insert feed { readerId: f.followerId, postId: w.postId, authorId: w.authorId, at: w.at } if absent
    delete fanouts[w.id]
schedule fanOutEveryMinute every 1m: fanOut

query following(c: cursor ?):
  return feed[viewer] after c last 20 by byReaderTime { *, post: posts[.postId] }
```

The application assigns followers to buckets of at most 200. The mutation
visits all of bucket 0, a complete schema-capped group; a first-200 slice
of a larger group is refused. The job covers the whole account, capped at
1,000 followers, under its own ceilings (5 posts × 1,000 followers a
chunk). Larger audiences use a separate lane their readers merge on read.
`insert ... if absent` makes the job's pass idempotent over the rows the
mutation already wrote. The entries sync to each reader; `following` joins
`posts`, an online-only table here, so it answers on the server — carry the
columns the reader renders on the entry itself to answer on the device. At
500 follows the reader's page examines the rows it examines at 5: one
prefix of the reader's own lane.

A ranked feed for a community keeps one shared candidate set instead of a
row per reader: a job on a schedule scores the pool from maintains into a
public `ranked` table every device holds, the viewer's own signals sync to
the viewer, and the device composes the two; an external ranker writes its
per-reader word through a service seat (guide services):

```quarry
use identity
use personas alice, bob, marc

table posts:
  authorId: principal
  body: text <=6000
  at: time
  by byTime: at, id
  immutable authorId, at
  public 'posts are public'
  insert <- .authorId = viewer
  sync public last 2000 by byTime

table votes:
  postId: posts
  principal: principal
  direction: int
  unique byPostPrincipal: postId, principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  insert <- .principal = viewer
  update (old, next) <- old.principal = viewer and next.principal = viewer
  sync to .principal last 1000 by byPrincipal

maintain postScore: sum votes of direction by postId
  read <- allow

table likes:
  postId: posts
  principal: principal
  unique byPostPrincipal: postId, principal
  public 'likes are public'
  insert <- .principal = viewer
  delete <- .principal = viewer

maintain likeCounts: count likes by postId
  read <- allow

query trending():
  day = posts[at > now - 86400000] first 8192 by byTime { id, at, likes: likeCounts[.id] }
  return slice(sort(day, '-likes', '-at'), 0, 10)

table ranked:                       -- layer 1: one shared page, scored by the server
  postId: posts
  score: int
  at: time
  unique byPost: postId
  by byScore: score, id
  public 'the ranking is one shared page'
  insert <- deny
  update <- deny
  sync public last 500 by byScore

table seen:                         -- layer 2: the viewer's own signals
  readerId: principal
  postId: posts
  at: time
  unique byReaderPost: readerId, postId
  by byReaderTime: readerId, at, id
  read <- .readerId = viewer
  insert <- .readerId = viewer
  sync to .readerId last 1000 by byReaderTime

table affinity:                     -- the ranker's word, per reader
  readerId: principal
  postId: posts
  score: int
  at: time
  unique byReaderPost: readerId, postId
  by byReaderScore: readerId, score, id
  read <- .readerId = viewer
  insert <- viewer = 'service:ranker'
  update <- viewer = 'service:ranker'
  sync to .readerId last 200 by byReaderScore

job rescore():
  chunk p in posts first 100 by byId:
    (ageHours, rem) = divmod(now - p.at, 3600000)
    upsert ranked[p.id] { postId: p.id, score: postScore[p.id] * 10 - ageHours, at: p.at }
schedule rescoreEvery every 5m: rescore

query home(c: cursor ?):
  return ranked after c last 50 by byScore { *, post: posts[.postId], seen: exists seen[viewer, .postId], mine: votes[.postId, viewer], lift: affinity[viewer, .postId] }

mutation vote(postId: posts, direction: int):
  require exists posts[postId] else POST_NOT_FOUND
  require direction = -1 or direction = 0 or direction = 1 else INVALID_VOTE
  upsert votes[postId, viewer] { postId, principal: viewer, direction }  -- predicts only an update of a held vote; a missing vote queues without a prediction

mutation markSeen(postId: posts):
  require exists posts[postId] else POST_NOT_FOUND
  return insert seen { readerId: viewer, postId, at: now } if absent

mutation setAffinity(readerId: principal, postId: posts, score: int):
  require exists posts[postId] else POST_NOT_FOUND
  upsert affinity[readerId, postId] { readerId, postId, score, at: now }
```

`trending()` seeks the trailing day up to the 8,192-row examined ceiling and ranks that set; a day past the ceiling is `complete: false`, so its top ten is of an incomplete set. When the day outgrows the ceiling, use the maintained `ranked` recipe beside it.

A maintain that groups by something other than its source's audience (a
score by post over private votes) reaches no device as a value; the job's
`ranked` row is what puts the score on every device. Time decay is the
cadence: the order refreshes when the job runs. A native job (guide native)
can score with floats and a real loop; the tables and the sync are the
same."##,
        "search" => search::CARD,
        "actions" => actions::CARD,
        "effects" => r##"# Effects: the outside world, performed by a worker

```quarry
effect notify

table members:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  by byPrincipalRoom: principal, roomId, id
  cap 100 by roomId
  read <- exists members[.roomId, viewer]
  insert <- exists members[.roomId, viewer]
  sync

table messages:
  roomId: id
  authorId: principal
  body: text <=4000
  at: time
  by byRoomTime: roomId, at, id
  read <- exists members[.roomId, viewer]
  insert <- .authorId = viewer and exists members[.roomId, viewer]
  sync last 500 by byRoomTime

mutation send(roomId: id, body: text <=4000):
  require exists members[roomId, viewer] else NOT_MEMBER
  msg = insert messages { roomId, authorId: viewer, body, at: now }
  for m in members[roomId] first 100 by byRoomPrincipal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, roomId, preview: slice(body, 0, 80) }
  return { id: msg.id }
```

This send stays eligible to predict because presence decides only effects; the server decides who is notified at commit.
Prediction also evaluates the safe untaken presence arms and discards their effects, so it pays at least their server cost. Effect ids never consume `new` or an insert's ids.
For dispatch-time presence or any other presence-dependent decision, emit unconditionally and have the worker call a service mutation that reads `connected`.

The data plane never calls out. `emit name { payload }` in a mutation or
a job writes the payload durably in the same commit as the rows (a
refused mutation emits nothing), and a worker with a service token
(`snapback4 token --service pusher`; guide services) performs it:

```ts
import { runWorker } from "snapback4/worker";
runWorker({ url, token, effects: { notify: async (payload, meta) => { await push(payload); return { providerId: meta.id }; } } });
```

The loop is `POST /effects/claim { effect?, limit?, lease?, wait? }` (a
lease in seconds; `wait` long-polls until something is due), then `POST
/effects/<id>/done { result? }` or `POST /effects/<id>/failed { error,
retry }`; `GET /effects?state=` lists them (queued, running, sent,
failed) and `doctor` counts them. A thrown handler retries with backoff
(2 s, 4 s, ... up to 5 min) until the eighth attempt, then rests as
`failed`; throw `GiveUp` to fail at once. A worker that dies loses its
lease and the effect is claimed again (E_EFFECT_LEASE for the one that
settles late); two workers never hold one effect. `meta.id` is the
idempotency key a provider should see. A scheduled job that `emit`s once
per period is the digest recipe."##,
        "services" => r##"# Services: a worker's seat, and accounts the application authenticates

```quarry
table rankings:
  postId: id
  score: int
  unique byPost: postId
  read <- allow
  insert <- viewer = 'service:ranker'     -- a text literal beside viewer names a principal
  update <- viewer = 'service:ranker'

mutation rank(postId: id, score: int):
  upsert rankings[postId] { postId, score }
```

`snapback4 token --service ranker [--days 365] [--release <dir>]` prints,
once, a bearer session for the principal `service:ranker`.
The token and one newline are the whole of stdout (even with `--json`), with prose on stderr, so capture it with `TOKEN=$(npx snapback4 token --service ranker)`.
Rules name it
like any principal, so the ranker is admitted and nobody else is; with
its token a worker claims effects (guide effects) and runs any operation
a rule admits it to.

An application that authenticates its own accounts — a phone number it
verified, a member of its own directory — mints their sessions through its
service and hands each token to that account's device, which then talks
to the server directly with `createLocalClient({ url, session })`:

```ts
import { mintSession, revokeSessions } from "snapback4/worker";
const session = await mintSession(url, serviceToken, "member:42", "member", 30);   // POST /auth/session
await revokeSessions(url, serviceToken, "member:42");                              // POST /auth/revoke
```

The principal is the application's own name for the account, outside the
engine's namespaces (`dev:`, `guest:`, `user:`, `service:` and `system`
are refused). `snapback4 dev` and `snapback4 serve` both take these
tokens; the adapter that owned every request becomes an identity provider
and a worker."##,
        "presence" => r##"# Presence: who is connected right now

```quarry
query connections(p: principal):
  return connected[p]                    -- an int; `exists connected[p]` is the bool
```

`connected[p]` is how many connections a principal holds open on the
server now: a device following the stream keeps a long poll open
(`GET /changes?wait=25&heartbeat=1`), and a poll that answered a moment ago still
counts for 35 seconds, the gap before the next. Heartbeats are JSON whitespace
every 2 seconds before the final object. On a running host, 4 seconds of
silence marks the link offline within 5 seconds; native fetch without streams
uses at most 2-second polls. Browser connectivity events give immediate hints;
authenticated `/probe` confirms recovery. Suspended hosts notify on resume.
It is not a table: nothing
syncs, nothing is written. A mutation reads it to notify only those with
no connected client (guide effects); a query reads it for an online mark.
On a device the word is unknown: a query that reads it is `complete: false`.
A mutation stays eligible to predict when presence decides only effects, so its rows are independent of presence and the server decides who is notified at commit.
Presence-derived values may use comparisons, `exists`, boolean logic and field values. Arithmetic, fallible builtins, reads, `new` or refusals controlled by presence keep `predicts: never`, as do conditional values without a fixed-size proof. Prediction charges both safe presence arms, so it may reach a bound even when the server would fit. If an untaken arm needs a combined guard's value refinement, the device queues without a row; put the data guard outside presence.
`snapback4 run` reads nobody as connected."##,
        "bounds" => r##"# Bounds and the meter

Nothing is priced at check. As a program runs, the meter counts examined
rows, index entries, rule probes, steps, heap bytes, output bytes and rows
written against ceilings: 8,192 rows examined, 16,384 index entries, 8,192
rule probes, 1,000,000 steps, 16 MiB heap, 1 MiB output, 1,024 rows written
per mutation; a job's chunk may examine 16,384 rows and write 8,192. A
query past a ceiling returns what it found with `complete: false`; a
mutation aborts with E_BOUND naming the meter, the ceiling and the site
(never the count: it would measure rows the viewer may not read).
`snapback4 check --cost` prints each site's structural class;
`snapback4 test` prints the numbers on your data. A loop is bounded
by a page's `first N`, a list's `<=N`, `range`'s int expressions, `walk`'s depth,
or `tokens`' 64. An accumulated list is bounded by the heap meter and its
iterations by the step meter. `while` stays refused.
`range(a, b)` evaluates int expressions once and iterates under the step meter,
without materializing the range. `check --cost` prints `steps ≤ meter`, a
filtered scan as `filter over ≤ examined ceiling`, its reads as `probe × examined`,
and a seek as a prefix. Sorting or grouping a page only processes that page.
"##,
        "refusals" => r##"# Refusals

Every refusal is `{ code, family, message, site?, rewrite?, guide?, rule?,
retryable? }`: `code` and `family` are stable, `rewrite` compiles, `guide`
names a card, `rule` is the program's own code on a `require` refusal, and
`retryable` says the same request may succeed later. The engine's families:
input, schema, auth, rule (your `require` codes), constraint, bound, op,
asset, action, prediction, generation, store; the client adds link (the server is
unreachable) and client (the client itself refused, as after `close()`).
`snapback4 why <CODE>` explains one. Reads never raise a rule refusal: a
hidden row is null, and a page omits it.

`dev` and `serve` also report process events on stderr: SNAPBACK4_EXIT
(a returned startup/listener error or normal stop), SNAPBACK4_PANIC (any
thread, with its name, location and abort/unwind action), SNAPBACK4_SIGNAL
(signal name and number), and SNAPBACK4_THREAD_EXIT (watcher/maintenance
stopped; an unexpected stop ends the server). Each is one line with verb,
generation and reason; generation 0 means this process has not served yet.
INT, TERM and HUP report immediately; with an application worker they clean
it up and exit 128 + signal. Otherwise, and for fatal signals, the process
terminates immediately with its OS signal status. SIGKILL,
power loss and an unwritable stderr cannot report from inside the process."##,
        "personas" => personas::CARD,
        _ => return None,
    })
}

/// Every refusal code `why` explains, with its family. A program's own
/// `require` codes are the author's and are explained by the program.
mod codes;
pub use codes::{CODES, codes, explain_code};
