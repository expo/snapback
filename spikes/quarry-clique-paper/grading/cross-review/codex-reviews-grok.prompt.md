You are an adversarial design reviewer. Below: (1) the Quarry data-language spec, (2) the M3 milestone spec+acceptance for a messaging app, (3) another team's complete backend design (schema, programs, boundary, notes) for M1-M3, of which M3 is under review. Find real defects: semantic holes, authorization holes, race/monotonicity errors, acceptance items the backend cannot satisfy, unbounded or wrongly-bounded operations, and syntax invalid per the spec. Number findings, one line of severity (CRITICAL/MATERIAL/MINOR) + one-paragraph justification each, max 15 findings, most severe first. No praise, no restating the design.

=== QUARRY SPEC ===
# Quarry — the data language (complete reference, v0.2)

Quarry is a small language for backend data programs: **queries** (read) and
**mutations** (read + write). Everything a program may do is in this document;
if a construct is not here, it does not exist. There is no `while`, no
recursion, no ambient clock, no randomness, no I/O, no unbounded read.
Comments run from `--` to end of line.

v0.2 folds in the LLP 0329.014.009 authoring-test verdicts: auto-dereference
through references, bare-name shape fields, optional columns, `enum`, the
`asset` column type, and a section on boundary kinds.

## Programs

```
query name(arg: type, ...):
  <statements>

mutation name(arg: type, ...) -> resultType:
  <statements>
```

Bodies are indentation-scoped; the final expression is the result. Statements:
bindings (`x = expr`, `(a, b) = expr`), guards, writes, `if`/`else:` blocks,
`for` loops, `match` blocks.

**Argument types.** A table name types the argument as a reference to a row of
that table (`c: conversations`). Scalars: `text <=N`, `int`, `time`, `bool`,
`enum('a', 'b', ...)`. Lists carry a mandatory cap: `to: [users] <=50`.
Append `?` for an optional argument (`cursor: time ?`).

## Schema

```
table messages:
  conv: conversations          -- reference column
  author: users
  body: text <=4096
  kind: enum('text', 'image', 'video')
  editedAt: time ?             -- `?` = optional column, absent until written
  by conv, at                  -- an ordering (index); optionally named: by activity: user, activity

table users:
  name: text <=80
  handle: text <=32
  avatar: asset ?              -- a reference into the asset store (see Kinds)
  unique handle                -- unique key; duplicate inserts are refused at commit

maintain unread = count messages by conv           -- engine-maintained aggregate
```

Every table has an implicit `id`. You may extend a schema with top-level
lines:

```
index applications: posting, at          -- add an ordering
unique passengers: ride, user            -- add a unique key
maintain n = count applications by posting
maintain top = max entries of score by contest (readable: public)
```

`maintain` forms: `count t by cols`, `sum t of col by cols`,
`max t of col by cols`, `min t of col by cols`, each with an optional
`where <predicate over the row>`. The engine keeps them exact at commit. A
maintained value over rows the reader cannot see is a **declared
disclosure** — say so with `(readable: ...)`.

Rules appear on tables per effect (`read r <- <predicate>`,
`insert r <- ...`, `update (old, next) <- ...`, `delete r <- ...`); the
engine enforces them on every access. `public` marks a table world-readable
(a declared disclosure). Mutations may additionally guard with `require`.

## References and auto-dereference

A reference value stands for its row. You may:

- chain field access through it: `post.author.name` (reads the author row);
- key a bracket or maintained read with it: `#seatCount[ride]`,
  `messages[conv]`;
- open a shape on it: `.author { name, handle }`.

Access through an **absent** reference or optional propagates absence (like
`?.` everywhere). In a rule or guard, a predicate over an absent value is
false. Use `!` to refuse instead of propagating:
`journals[j]! else NOT_FOUND`.

## Reads

- `t[expr]` — point read, type `Row?`. A reference to `t` keys by id; a
  composite `unique` key is keyed positionally (`dms[lo, hi]`); name columns
  when inference is ambiguous (`t[col = expr]` — the left side is always a
  column name, the right side is expression scope, so an argument may share a
  column's name).
- `exists t[...]` — boolean existence test.
- `#name[key]` — read a maintained aggregate: exact, complete, O(1). Type `int`.
- **Range reads.** If the bracket keys a prefix of an ordering, the read is a
  range and MUST end with a direction and bound: `first N` (ascending) or
  `last N` (descending). It does not parse without one. The result is a
  **page**: up to N rows, with `.more: bool`.

```
messages[c] last 3                       -- newest 3 (ordering inferred from c's type)
members[viewer] last 50 by activity      -- name the ordering when several exist
episodes[s] after sub.lastListenedAt first 100
```

`after expr` / `before expr` restrict the ordering's final column — this is
also the pagination cursor: pass the last row's sort value back in.

- `merge(t[a], t[b], ...) last N` — bounded k-way fan-in over the same
  ordering of one table under several prefixes (a small home feed). For large
  or unbounded audiences, `maintain rows` a feed table instead (fan-out on
  write) — say which you chose and why.

## Shapes

Braces after a row, reference, or page project it. On a page, the shape
applies to every row. Inside a shape, `.` is the focal row; a **bare column
name** selects that column (`{ title, startsAt }`); `*` splices all columns;
`name: expr` computes a field; nested reads may open nested shapes (which
re-focus `.`); bind `as x` on a domain when an inner shape needs the outer
row.

```
messages[c] last 30 {
  *,
  author: .author { name, handle, avatar },
}
```

## Reductions and `capped`

`page | count` and `page | sum .col` reduce a page. Their type is
**`capped int`** — a fact about *the page*, not the population (render as
"N+" when `.more`). A `capped int` cannot be stored by a write, compared in a
`require`, or returned where the schema demands `int`: those are type errors.
A population fact — a total, a maximum, a rank, a follower count — is a `#`
maintained read.

## Writes (mutations only)

```
m = +messages { conv: c, author: viewer, body, at: now }   -- insert; id minted unless given; evaluates to the row
~members[m] { lastReadAt: now }                            -- patch (`.` is the old row in field exprs)
+~unseen[club, u] { n: (.n ?? 0) + 1 }                     -- upsert by unique key; key columns auto-fill on insert
-messages[m]                                               -- delete
```

Inserting a duplicate into a `unique` key refuses the whole transaction at
commit — rely on that rather than racy check-then-insert.

## Guards

```
require exists members[c, viewer] else NOT_MEMBER
require ride.seats > #seatCount[r] else RIDE_FULL
```

`require` refuses the whole transaction with the stable code after `else`.

## Control

- `if cond:` / `else:` blocks.
- `for x in <domain>:` — the domain must be a page, a capped list argument, or
  a literal list. Nothing else iterates.
- `match t[k]:` with arms `some x:` and `none:` — branch on a point read's
  absence. On a restricted table, `none` does not distinguish absent from
  hidden; do not turn it into an existence claim.
- `walk t[seed] up .col depth N` — bounded ancestor traversal along a
  reference column; yields the visited rows in order.

## Clocks and values

- `now` — the client's intent clock. Type `time!intent`: it may be **stored**
  as a timestamp, and nothing else. It cannot be compared with a `time`
  column — that comparison does not typecheck.
- `commit` — the engine's clock at commit. Type `time!commit`: use it in every
  guard that grants or denies by time (expiry, deadline, window).
- `viewer` — the calling principal. `new` — mint an id explicitly (rare;
  inserts mint their own).
- Operators: `+ - * / %` on ints; `= != < <= > >=`; `and or not`; `??`
  (absent-coalesce); `!` after a point read asserts presence with a refusal
  code.
- Builtins: `min`, `max`, `sorted(a, b)` (a pair in order), `tokens(text)`
  (bounded word list, ≤64), `range(a, b)`.

## Kinds — what is not a data program

Some capabilities are **boundary kinds**: declared in the schema, provided by
the engine, never implemented as data programs. Declare them; do not write
their internals. Data programs interact with them only through the declared
seams below.

```
use identity
  -- email+password credentials, expiring sessions, server-side logout
  -- revocation. Provides `viewer` to every program. Credentials and
  -- session tokens never appear in tables you declare.

use assets
  -- upload, storage, and delivery of images/video. Provides the `asset`
  -- column type: programs store and return asset references; bytes never
  -- pass through the data plane.

channel typing(conv: conversations):
  publish   <- exists members[conv, viewer]
  subscribe <- exists members[conv, viewer]
  ttl 5s
  -- ephemeral fan-out (typing, presence): no durable rows, no history;
  -- payloads are small structs; expiry is the engine's.

schedule closeAuction(a: auctions) at a.endsAt:
  run settle(a)
  -- durable, transactionally enqueued invocation of a named mutation under
  -- the system principal at a stored time; rescheduled when the row's time
  -- column changes. Rules and programs stay time-independent: "expires at
  -- T" is a schedule flipping a status column, never a clock comparison in
  -- a rule.
```

Effects (external I/O — push notifications, email) are likewise a kind; for
this exercise, declare them with a one-line contract if the spec needs one.

## Worked examples

A chat thread — the newest 3 messages with each author:

```
query thread(c: conversations):
  messages[c] last 3 {
    *,
    author: .author { name, handle },
  }
```

Sending a message, membership-guarded:

```
mutation send(c: conversations, body: text <=4096) -> messages:
  require exists members[c, viewer] else NOT_MEMBER
  +messages { conv: c, author: viewer, body, at: now }
```

=== M3 BRIEF ===
### M3 — Messaging core

Spec:

- **DMs:** at most one DM channel per user pair; starting a DM with an
  existing counterpart opens the existing channel.
- **Groups are entities:** created with a name (1–50 chars), optional
  description (≤200); 2–50 members; multiple groups with identical
  membership are distinct. The creator is an admin; admins can add and
  remove members and promote others to admin; anyone can leave. Adds
  take effect immediately — **no invitation/acceptance flow**.
- Text messages, ≤2000 chars.
- **Quoted replies** (WhatsApp-style): a reply carries a pointer to
  the quoted message; the bubble shows a quoted excerpt; tapping it
  scrolls/jumps to the original. No thread model.
- **Typing indicators:** appear on other members' screens within 2 s
  of typing, expire within 5 s of the last keystroke. Shown as "…"
  in the conversation and a hint in the chats list.
- **Receipts**, per message, monotonic: `sent` (accepted by the
  backend) → `delivered` (fetched by the recipient's client) →
  `read` (recipient viewed the conversation). Rendered as
  single-check / double-check / colored double-check. In groups the
  aggregate indicator shows a state only when every member of the
  message's **recipient set** has reached it — the recipient set is
  **membership at send time**, and members who leave or are removed
  before reaching a state drop out of the aggregate requirement.
- New members see the group's **full prior history** on join.
- Removed members immediately stop receiving new messages but keep
  their local copy of history from before removal.

Acceptance:

1. Alice DMs Bob; Bob replies; both see messages live with sender
   avatars. Starting the "same" DM again reuses the channel.
2. Create a group with Alice, Bob, Carol; a second group with the same
   three members coexists.
3. Bob types; Alice sees "…" within 2 s; it expires when he stops.
4. Receipt ticks transition sent → delivered → read as Bob's client
   fetches and then opens the conversation; group indicator waits for
   the slowest member.
5. Quoted reply renders the excerpt; tapping jumps to the original.
6. Admin removes Carol; she no longer receives new messages but still
   sees pre-removal history. A non-admin cannot remove members.
7. Seed is idempotent (second run: no duplicates).


=== DESIGN UNDER REVIEW ===
I'll start by reading the full prompt and the carried-forward M1/M2 design so the M3 schema and programs stay consistent.I’ll inspect the workspace and any prior design notes so M3 can extend the existing schema instead of reinventing it.Checking one language detail: whether `maintain … where` can filter on a bool, and how pair bindings from `sorted` are used.The M3 surface extends the M1/M2 schema: DMs reuse a sorted pair key, groups mint new ids, receipts use membership watermarks, and typing stays a 5s channel.

```schema
use identity
  -- email+password credentials, unique email, expiring sessions,
  -- server-side logout/revocation. Provides `viewer`. Credentials
  -- and session tokens never appear in tables.

use assets
  -- upload, storage, and delivery of avatars and post image/video. Provides the -- CHANGED
  -- `asset` column type; bytes never pass through the data plane.

table users:
  name: text <=50              -- display name; max 50; min 1 enforced in programs
  handle: text <=20            -- unique public handle; max 20
  avatar: asset ?              -- set via assets kind, then setAvatar
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=2048 ?          -- single URL, stored as text
  unique handle
  public                       -- profiles are a declared disclosure
  insert r <- r.id = viewer    -- a principal may create only their own row
  update (old, next) <- old.id = viewer and next.id = old.id

table follows:
  follower: users
  followee: users
  at: time
  unique follower, followee
  by following: follower, at
  by followers: followee, at
  public
  insert r <- r.follower = viewer and r.follower != r.followee
  delete r <- r.follower = viewer

table posts:
  author: users
  body: text <=500 ?
  kind: enum('text', 'image', 'video')
  parent: posts ?             -- absent = original; set = reply
  at: time
  by thread: parent, at
  public
  insert r <- r.author = viewer

table postAssets:
  post: posts
  asset: asset
  slot: int                   -- 0..3 images; 0 for the one video
  unique post, slot
  by post, slot
  public
  insert r <- r.post.author = viewer

table likes:
  user: users
  post: posts
  unique user, post
  read r <- r.user = viewer
  insert r <- r.user = viewer
  delete r <- r.user = viewer

table reposts:
  user: users
  post: posts
  at: time
  unique user, post
  public
  insert r <- r.user = viewer and not r.post.parent
  delete r <- r.user = viewer

table timeline:
  actor: users
  post: posts
  kind: enum('original', 'repost')
  at: time
  unique actor, post, kind
  by global: at
  by outbox: actor, at
  by profile: actor, kind, at
  public
  insert r <- r.actor = viewer and (r.kind = 'repost' or r.post.author = viewer)
  delete r <- r.actor = viewer

table home:
  owner: users
  actor: users
  post: posts
  kind: enum('original', 'repost')
  at: time
  unique owner, actor, post, kind
  by inbox: owner, at
  read r <- r.owner = viewer and (r.actor = viewer or exists follows[follower = viewer, followee = r.actor]) and (r.kind = 'original' or exists reposts[r.actor, r.post])
  insert r <- (r.owner = viewer and (r.actor = viewer or exists follows[follower = viewer, followee = r.actor])) or (r.actor = viewer and exists follows[follower = r.owner, followee = viewer])
  delete r <- r.owner = viewer or r.actor = viewer

table conversations:                                                          -- NEW
  kind: enum('dm', 'group')                                                   -- NEW
  name: text <=50 ?                                                           -- NEW
  description: text <=200 ?                                                   -- NEW
  createdBy: users                                                            -- NEW
  at: time                                                                    -- NEW
  read r <- exists members[r, viewer]                                         -- NEW
  insert r <- r.createdBy = viewer                                            -- NEW

table dmPairs:                                                                -- NEW
  lo: users                                                                   -- NEW
  hi: users                                                                   -- NEW
  conv: conversations                                                         -- NEW
  unique lo, hi                                                               -- NEW
  unique conv                                                                 -- NEW
  read r <- r.lo = viewer or r.hi = viewer                                    -- NEW
  insert r <- r.lo = viewer or r.hi = viewer                                  -- NEW

table members:                                                                -- NEW
  conv: conversations                                                         -- NEW
  user: users                                                                 -- NEW
  role: enum('admin', 'member')                                               -- NEW
  active: bool                                                                -- NEW
  joinedAt: time                                                              -- NEW
  leftAt: time ?                                                              -- NEW
  historyThru: int ?          -- last message seq visible after leave         -- NEW
  lastDeliveredAt: time ?                                                     -- NEW
  lastReadAt: time ?                                                          -- NEW
  lastActivity: time                                                          -- NEW
  unread: int                                                                 -- NEW
  preview: text <=2000 ?                                                      -- NEW
  previewAt: time ?                                                           -- NEW
  previewAuthor: users ?                                                      -- NEW
  unique conv, user                                                           -- NEW
  by inbox: user, lastActivity                                                -- NEW
  by roster: conv, active, joinedAt                                           -- NEW
  read r <- r.user = viewer or (r.active and members[r.conv, viewer].active)  -- NEW
  insert r <- r.user = viewer or conversations[r.conv].createdBy = viewer or (members[r.conv, viewer].active and members[r.conv, viewer].role = 'admin')  -- NEW
  update (old, next) <- old.conv = next.conv and old.user = next.user and members[old.conv, viewer].active and ((next.role = old.role and next.joinedAt = old.joinedAt and next.active = old.active and next.historyThru = old.historyThru) or members[old.conv, viewer].role = 'admin' or (old.user = viewer and next.role = old.role and next.joinedAt = old.joinedAt))  -- NEW

table messages:                                                               -- NEW
  conv: conversations                                                         -- NEW
  author: users                                                               -- NEW
  body: text <=2000                                                           -- NEW
  quote: messages ?                                                           -- NEW
  seq: int                    -- grant cutoff; not a display clock            -- NEW
  at: time                                                                    -- NEW
  by conv, at                                                                 -- NEW
  read r <- members[r.conv, viewer].active or r.seq <= members[r.conv, viewer].historyThru  -- NEW
  insert r <- r.author = viewer and members[r.conv, viewer].active            -- NEW

table groupSeeds:                                                             -- NEW
  key: text <=64                                                              -- NEW
  conv: conversations                                                         -- NEW
  unique key                                                                  -- NEW
  public                                                                      -- NEW
  insert r <- r.conv.createdBy = viewer                                       -- NEW

channel typing(conv: conversations):                                          -- NEW
  publish   <- members[conv, viewer].active                                   -- NEW
  subscribe <- members[conv, viewer].active                                   -- NEW
  ttl 5s                                                                      -- NEW

maintain followerCount = count follows by followee
maintain followingCount = count follows by follower
maintain likeCount = count likes by post (readable: public)
maintain replyCount = count posts by parent
maintain memberCount = count members by conv where active                     -- NEW
maintain lastSeq = max messages of seq by conv                                -- NEW

-- Removed vs M2: none
```

```programs
query me():
  -- Own profile; absent until createProfile. Subscribe on the profile
  -- screen so edits and follow counts land on other devices without a refresh.
  users[viewer] {
    *,
    followerCount: #followerCount[.] ?? 0,
    followingCount: #followingCount[.] ?? 0,
  }

query profile(u: users):
  -- Profile by id/reference. Public; absence propagates if the id is unknown.
  u {
    *,
    followerCount: #followerCount[.] ?? 0,
    followingCount: #followingCount[.] ?? 0,
    followedByMe: exists follows[viewer, .],
  }

query profileByHandle(handle: text <=20):
  -- Point read on the unique handle key (named because `handle` is also the arg).
  users[handle = handle] {
    *,
    followerCount: #followerCount[.] ?? 0,
    followingCount: #followingCount[.] ?? 0,
    followedByMe: exists follows[viewer, .],
  }

query globalFeed(cursor: time ?):
  -- Reverse-chron originals and reposts from everyone. Subscribe the first
  -- page so new posts appear on other clients without a manual refresh.
  if cursor:
    timeline before cursor last 20 by global {
      *,
      actor: .actor { name, handle, avatar },
      post: .post {
        *,
        author: .author { name, handle, avatar },
        likeCount: #likeCount[.] ?? 0,
        liked: exists likes[viewer, .],
        replyCount: #replyCount[.] ?? 0,
        reposted: exists reposts[viewer, .],
        media: postAssets[.] first 4 {
          asset,
          slot,
        },
      },
    }
  else:
    timeline last 20 by global {
      *,
      actor: .actor { name, handle, avatar },
      post: .post {
        *,
        author: .author { name, handle, avatar },
        likeCount: #likeCount[.] ?? 0,
        liked: exists likes[viewer, .],
        replyCount: #replyCount[.] ?? 0,
        reposted: exists reposts[viewer, .],
        media: postAssets[.] first 4 {
          asset,
          slot,
        },
      },
    }

query followingFeed(cursor: time ?):
  -- Reverse-chron originals and reposts from the viewer plus current followees.
  -- Own items are home rows with actor=viewer (no self-follow edge).
  if cursor:
    home[viewer] before cursor last 20 by inbox {
      *,
      actor: .actor { name, handle, avatar },
      post: .post {
        *,
        author: .author { name, handle, avatar },
        likeCount: #likeCount[.] ?? 0,
        liked: exists likes[viewer, .],
        replyCount: #replyCount[.] ?? 0,
        reposted: exists reposts[viewer, .],
        media: postAssets[.] first 4 {
          asset,
          slot,
        },
      },
    }
  else:
    home[viewer] last 20 by inbox {
      *,
      actor: .actor { name, handle, avatar },
      post: .post {
        *,
        author: .author { name, handle, avatar },
        likeCount: #likeCount[.] ?? 0,
        liked: exists likes[viewer, .],
        replyCount: #replyCount[.] ?? 0,
        reposted: exists reposts[viewer, .],
        media: postAssets[.] first 4 {
          asset,
          slot,
        },
      },
    }

query profilePosts(u: users, cursor: time ?):
  -- That user's original posts only (replies stay on the thread screen;
  -- their reposts of others stay in feeds, not on this list).
  if cursor:
    timeline[u, 'original'] before cursor last 20 by profile {
      *,
      actor: .actor { name, handle, avatar },
      post: .post {
        *,
        author: .author { name, handle, avatar },
        likeCount: #likeCount[.] ?? 0,
        liked: exists likes[viewer, .],
        replyCount: #replyCount[.] ?? 0,
        reposted: exists reposts[viewer, .],
        media: postAssets[.] first 4 {
          asset,
          slot,
        },
      },
    }
  else:
    timeline[u, 'original'] last 20 by profile {
      *,
      actor: .actor { name, handle, avatar },
      post: .post {
        *,
        author: .author { name, handle, avatar },
        likeCount: #likeCount[.] ?? 0,
        liked: exists likes[viewer, .],
        replyCount: #replyCount[.] ?? 0,
        reposted: exists reposts[viewer, .],
        media: postAssets[.] first 4 {
          asset,
          slot,
        },
      },
    }

query thread(p: posts, cursor: time ?):
  -- Parent plus direct replies, oldest-first. Named `parent =` so this is
  -- not a point read of p. Nested replies are a later thread(p = child).
  if cursor:
    p {
      *,
      author: .author { name, handle, avatar },
      likeCount: #likeCount[.] ?? 0,
      liked: exists likes[viewer, .],
      replyCount: #replyCount[.] ?? 0,
      reposted: exists reposts[viewer, .],
      media: postAssets[.] first 4 {
        asset,
        slot,
      },
      replies: posts[parent = .] after cursor first 20 by thread {
        *,
        author: .author { name, handle, avatar },
        likeCount: #likeCount[.] ?? 0,
        liked: exists likes[viewer, .],
        replyCount: #replyCount[.] ?? 0,
        reposted: exists reposts[viewer, .],
        media: postAssets[.] first 4 {
          asset,
          slot,
        },
      },
    }
  else:
    p {
      *,
      author: .author { name, handle, avatar },
      likeCount: #likeCount[.] ?? 0,
      liked: exists likes[viewer, .],
      replyCount: #replyCount[.] ?? 0,
      reposted: exists reposts[viewer, .],
      media: postAssets[.] first 4 {
        asset,
        slot,
      },
      replies: posts[parent = .] first 20 by thread {
        *,
        author: .author { name, handle, avatar },
        likeCount: #likeCount[.] ?? 0,
        liked: exists likes[viewer, .],
        replyCount: #replyCount[.] ?? 0,
        reposted: exists reposts[viewer, .],
        media: postAssets[.] first 4 {
          asset,
          slot,
        },
      },
    }

query chats(cursor: time ?):
  -- Viewer's conversations, newest activity first. Subscribe the first page
  -- so inbound messages, unread, and preview land without a pull. Typing is
  -- the typing(conv) channel, not this query.
  if cursor:
    members[viewer] before cursor last 50 by inbox {
      role,
      active,
      leftAt,
      lastActivity,
      unread,
      preview,
      previewAt,
      previewAuthor: .previewAuthor { name, handle, avatar },
      conv: .conv {
        *,
        createdBy: .createdBy { name, handle, avatar },
        memberCount: #memberCount[.] ?? 0,
        dm: dmPairs[.] {
          lo: .lo { name, handle, avatar },
          hi: .hi { name, handle, avatar },
        },
      },
    }
  else:
    members[viewer] last 50 by inbox {
      role,
      active,
      leftAt,
      lastActivity,
      unread,
      preview,
      previewAt,
      previewAuthor: .previewAuthor { name, handle, avatar },
      conv: .conv {
        *,
        createdBy: .createdBy { name, handle, avatar },
        memberCount: #memberCount[.] ?? 0,
        dm: dmPairs[.] {
          lo: .lo { name, handle, avatar },
          hi: .hi { name, handle, avatar },
        },
      },
    }

query conversation(c: conversations, cursor: time ?):
  -- Chat screen: header, live roster + receipt watermarks, newest messages
  -- with authors and quote excerpts. Subscribe while open. Ticks: a message
  -- is delivered/read when every *active* member with joinedAt <= .at except
  -- the author has lastDeliveredAt/lastReadAt >= .at. Former members keep
  -- rows with seq <= historyThru (new rows are unreadable).
  if cursor:
    c {
      *,
      createdBy: .createdBy { name, handle, avatar },
      memberCount: #memberCount[.] ?? 0,
      myMembership: members[., viewer] {
        role,
        active,
        joinedAt,
        leftAt,
        historyThru,
        lastDeliveredAt,
        lastReadAt,
        unread,
      },
      members: members[conv = ., active = true] last 50 by roster {
        role,
        joinedAt,
        lastDeliveredAt,
        lastReadAt,
        user: .user { name, handle, avatar },
      },
      dm: dmPairs[.] {
        lo: .lo { name, handle, avatar },
        hi: .hi { name, handle, avatar },
      },
      messages: messages[.] before cursor last 50 {
        *,
        author: .author { name, handle, avatar },
        quote: .quote {
          *,
          author: .author { name, handle, avatar },
        },
      },
    }
  else:
    c {
      *,
      createdBy: .createdBy { name, handle, avatar },
      memberCount: #memberCount[.] ?? 0,
      myMembership: members[., viewer] {
        role,
        active,
        joinedAt,
        leftAt,
        historyThru,
        lastDeliveredAt,
        lastReadAt,
        unread,
      },
      members: members[conv = ., active = true] last 50 by roster {
        role,
        joinedAt,
        lastDeliveredAt,
        lastReadAt,
        user: .user { name, handle, avatar },
      },
      dm: dmPairs[.] {
        lo: .lo { name, handle, avatar },
        hi: .hi { name, handle, avatar },
      },
      messages: messages[.] last 50 {
        *,
        author: .author { name, handle, avatar },
        quote: .quote {
          *,
          author: .author { name, handle, avatar },
        },
      },
    }

query message(m: messages):
  -- Point read for jumping to a quoted original that is off the current page.
  m {
    *,
    author: .author { name, handle, avatar },
    quote: .quote {
      *,
      author: .author { name, handle, avatar },
    },
  }

mutation createProfile(
  name: text <=50,
  handle: text <=20,
  bio: text <=200 ?,
  location: text <=50 ?,
  link: text <=2048 ?,
  avatar: asset ?
) -> users:
  -- Called once after identity signup, before the app treats the
  -- account as having a profile. Duplicate handle is refused at commit
  -- by `unique handle` (do not check-then-insert).
  require not exists users[viewer] else ALREADY_REGISTERED
  require name != '' else NAME_REQUIRED
  require handle != '' else HANDLE_REQUIRED
  +users { id: viewer, name, handle, bio, location, link, avatar }

mutation updateProfile(
  name: text <=50,
  handle: text <=20,
  bio: text <=200 ?,
  location: text <=50 ?,
  link: text <=2048 ?
) -> users:
  -- Full save of the text profile fields. Avatar is a separate mutation
  -- so a name/bio save cannot clobber it. Duplicate handle refused at commit.
  require exists users[viewer] else NOT_FOUND
  require name != '' else NAME_REQUIRED
  require handle != '' else HANDLE_REQUIRED
  ~users[viewer] { name, handle, bio, location, link }
  users[viewer]! else NOT_FOUND

mutation setAvatar(avatar: asset) -> users:
  -- Replace the avatar with a reference returned by the assets kind.
  require exists users[viewer] else NOT_FOUND
  ~users[viewer] { avatar }
  users[viewer]! else NOT_FOUND

mutation createPost(
  kind: enum('text', 'image', 'video'),
  body: text <=500 ?,
  image1: asset ?,
  image2: asset ?,
  image3: asset ?,
  image4: asset ?,
  video: asset ?,
  parent: posts ?
) -> posts:
  -- Original or reply. Replies skip timeline/home so they never appear in feeds.
  require exists users[viewer] else NOT_FOUND
  require not parent or exists posts[parent] else NOT_FOUND
  if kind = 'text':
    require body != '' else BODY_REQUIRED
    require not image1 and not image2 and not image3 and not image4 and not video else NO_MIX
  else:
    if kind = 'image':
      require image1 else IMAGE_REQUIRED
      require not video else NO_MIX
    else:
      require video else VIDEO_REQUIRED
      require not image1 and not image2 and not image3 and not image4 else NO_MIX
  ts = now
  p = +posts { author: viewer, body, kind, parent, at: ts }
  if image1:
    +postAssets { post: p, asset: image1, slot: 0 }
  if image2:
    +postAssets { post: p, asset: image2, slot: 1 }
  if image3:
    +postAssets { post: p, asset: image3, slot: 2 }
  if image4:
    +postAssets { post: p, asset: image4, slot: 3 }
  if video:
    +postAssets { post: p, asset: video, slot: 0 }
  if not parent:
    +timeline { actor: viewer, post: p, kind: 'original', at: ts }
    +~home[viewer, viewer, p, 'original'] { at: ts }
    for f in follows[followee = viewer] last 100 by followers:
      +~home[f.follower, viewer, p, 'original'] { at: ts }
  p {
    *,
    author: .author { name, handle, avatar },
    likeCount: #likeCount[.] ?? 0,
    liked: exists likes[viewer, .],
    replyCount: #replyCount[.] ?? 0,
    reposted: exists reposts[viewer, .],
    media: postAssets[.] first 4 {
      asset,
      slot,
    },
  }

mutation toggleFollow(u: users) -> users:
  -- Public graph, no requests. Unfollow hides via home's read rule (current
  -- follow set); follow backfills this actor's outbox into the viewer's home.
  require exists users[viewer] else NOT_FOUND
  require u != viewer else CANNOT_FOLLOW_SELF
  match follows[viewer, u]:
    some f:
      -follows[f]
    none:
      +follows { follower: viewer, followee: u, at: now }
      for ev in timeline[u] last 100 by outbox:
        +~home[viewer, u, ev.post, ev.kind] { at: ev.at }
  u {
    *,
    followerCount: #followerCount[.] ?? 0,
    followingCount: #followingCount[.] ?? 0,
    followedByMe: exists follows[viewer, .],
  }

mutation toggleLike(p: posts) -> posts:
  require exists users[viewer] else NOT_FOUND
  require exists posts[p] else NOT_FOUND
  match likes[viewer, p]:
    some l:
      -likes[l]
    none:
      +likes { user: viewer, post: p }
  p {
    *,
    author: .author { name, handle, avatar },
    likeCount: #likeCount[.] ?? 0,
    liked: exists likes[viewer, .],
    replyCount: #replyCount[.] ?? 0,
    reposted: exists reposts[viewer, .],
    media: postAssets[.] first 4 {
      asset,
      slot,
    },
  }

mutation toggleRepost(p: posts) -> posts:
  -- Own repost is a home row with actor=viewer (labeled repost), not a
  -- follow-projection of p.author. Unrepost point-deletes the timeline row;
  -- leftover home rows hide because the read rule exists() public reposts.
  require exists users[viewer] else NOT_FOUND
  require exists posts[p] else NOT_FOUND
  require not p.parent else CANNOT_REPOST_REPLY
  match reposts[viewer, p]:
    some r:
      -reposts[r]
      e = timeline[viewer, p, 'repost']
      if e:
        -timeline[e]
    none:
      ts = now
      +reposts { user: viewer, post: p, at: ts }
      +timeline { actor: viewer, post: p, kind: 'repost', at: ts }
      +~home[viewer, viewer, p, 'repost'] { at: ts }
      for f in follows[followee = viewer] last 100 by followers:
        +~home[f.follower, viewer, p, 'repost'] { at: ts }
  p {
    *,
    author: .author { name, handle, avatar },
    likeCount: #likeCount[.] ?? 0,
    liked: exists likes[viewer, .],
    replyCount: #replyCount[.] ?? 0,
    reposted: exists reposts[viewer, .],
    media: postAssets[.] first 4 {
      asset,
      slot,
    },
  }

mutation openDm(other: users) -> conversations:
  -- At most one DM per pair. Starting the same counterpart reuses the row.
  require exists users[viewer] else NOT_FOUND
  require exists users[other] else NOT_FOUND
  require other != viewer else CANNOT_DM_SELF
  (lo, hi) = sorted(viewer, other)
  match dmPairs[lo, hi]:
    some p:
      p.conv {
        *,
        createdBy: .createdBy { name, handle, avatar },
        memberCount: #memberCount[.] ?? 0,
        myMembership: members[., viewer] {
          role,
          active,
          joinedAt,
          leftAt,
          lastDeliveredAt,
          lastReadAt,
          unread,
        },
        members: members[conv = ., active = true] last 50 by roster {
          role,
          joinedAt,
          lastDeliveredAt,
          lastReadAt,
          user: .user { name, handle, avatar },
        },
        dm: dmPairs[.] {
          lo: .lo { name, handle, avatar },
          hi: .hi { name, handle, avatar },
        },
      }
    none:
      ts = now
      c = +conversations { kind: 'dm', createdBy: viewer, at: ts }
      +dmPairs { lo: lo, hi: hi, conv: c }
      +members { conv: c, user: lo, role: 'member', active: true, joinedAt: ts, lastActivity: ts, unread: 0 }
      +members { conv: c, user: hi, role: 'member', active: true, joinedAt: ts, lastActivity: ts, unread: 0 }
      c {
        *,
        createdBy: .createdBy { name, handle, avatar },
        memberCount: #memberCount[.] ?? 0,
        myMembership: members[., viewer] {
          role,
          active,
          joinedAt,
          leftAt,
          lastDeliveredAt,
          lastReadAt,
          unread,
        },
        members: members[conv = ., active = true] last 50 by roster {
          role,
          joinedAt,
          lastDeliveredAt,
          lastReadAt,
          user: .user { name, handle, avatar },
        },
        dm: dmPairs[.] {
          lo: .lo { name, handle, avatar },
          hi: .hi { name, handle, avatar },
        },
      }

mutation createGroup(
  name: text <=50,
  description: text <=200 ?,
  people: [users] <=49
) -> conversations:
  -- Always mints a new group (identical membership can coexist). `people`
  -- are additional members; the creator is inserted as admin. Max 50.
  require exists users[viewer] else NOT_FOUND
  require name != '' else NAME_REQUIRED
  ts = now
  c = +conversations { kind: 'group', name: name, description: description, createdBy: viewer, at: ts }
  +members { conv: c, user: viewer, role: 'admin', active: true, joinedAt: ts, lastActivity: ts, unread: 0 }
  for u in people:
    require exists users[u] else NOT_FOUND
    if u != viewer:
      +~members[c, u] { role: 'member', active: true, joinedAt: ts, lastActivity: ts, unread: 0 }
  c {
    *,
    createdBy: .createdBy { name, handle, avatar },
    memberCount: #memberCount[.] ?? 0,
    myMembership: members[., viewer] {
      role,
      active,
      joinedAt,
      leftAt,
      lastDeliveredAt,
      lastReadAt,
      unread,
    },
    members: members[conv = ., active = true] last 50 by roster {
      role,
      joinedAt,
      lastDeliveredAt,
      lastReadAt,
      user: .user { name, handle, avatar },
    },
  }

mutation ensureGroup(
  key: text <=64,
  name: text <=50,
  description: text <=200 ?,
  people: [users] <=49
) -> conversations:
  -- Idempotent seed path. User-facing create is createGroup (always inserts).
  require exists users[viewer] else NOT_FOUND
  require name != '' else NAME_REQUIRED
  require key != '' else KEY_REQUIRED
  match groupSeeds[key = key]:
    some s:
      s.conv {
        *,
        createdBy: .createdBy { name, handle, avatar },
        memberCount: #memberCount[.] ?? 0,
        myMembership: members[., viewer] {
          role,
          active,
          joinedAt,
          leftAt,
          lastDeliveredAt,
          lastReadAt,
          unread,
        },
        members: members[conv = ., active = true] last 50 by roster {
          role,
          joinedAt,
          lastDeliveredAt,
          lastReadAt,
          user: .user { name, handle, avatar },
        },
      }
    none:
      ts = now
      c = +conversations { kind: 'group', name: name, description: description, createdBy: viewer, at: ts }
      +groupSeeds { key: key, conv: c }
      +members { conv: c, user: viewer, role: 'admin', active: true, joinedAt: ts, lastActivity: ts, unread: 0 }
      for u in people:
        require exists users[u] else NOT_FOUND
        if u != viewer:
          +~members[c, u] { role: 'member', active: true, joinedAt: ts, lastActivity: ts, unread: 0 }
      c {
        *,
        createdBy: .createdBy { name, handle, avatar },
        memberCount: #memberCount[.] ?? 0,
        myMembership: members[., viewer] {
          role,
          active,
          joinedAt,
          leftAt,
          lastDeliveredAt,
          lastReadAt,
          unread,
        },
        members: members[conv = ., active = true] last 50 by roster {
          role,
          joinedAt,
          lastDeliveredAt,
          lastReadAt,
          user: .user { name, handle, avatar },
        },
      }

mutation addMember(c: conversations, u: users) -> members:
  -- Immediate; no invite. Singular so the 50-cap require sees one increment.
  require exists users[viewer] else NOT_FOUND
  require exists users[u] else NOT_FOUND
  require c.kind = 'group' else NOT_GROUP
  me = members[c, viewer]! else NOT_MEMBER
  require me.active and me.role = 'admin' else NOT_ADMIN
  require u != viewer else CANNOT_ADD_SELF
  require (#memberCount[c] ?? 0) < 50 else GROUP_FULL
  ts = now
  match members[c, u]:
    some m:
      require not m.active else ALREADY_MEMBER
      ~members[m] { active: true, joinedAt: ts, role: 'member', unread: 0, lastActivity: ts }
    none:
      +members { conv: c, user: u, role: 'member', active: true, joinedAt: ts, lastActivity: ts, unread: 0 }
  members[c, u]! else NOT_FOUND {
    *,
    user: .user { name, handle, avatar },
  }

mutation removeMember(c: conversations, u: users) -> members:
  require exists users[viewer] else NOT_FOUND
  require c.kind = 'group' else NOT_GROUP
  me = members[c, viewer]! else NOT_MEMBER
  require me.active and me.role = 'admin' else NOT_ADMIN
  require u != viewer else USE_LEAVE
  m = members[c, u]! else NOT_MEMBER
  require m.active else NOT_MEMBER
  ~members[m] { active: false, leftAt: now, historyThru: (#lastSeq[c] ?? 0) }
  members[c, u]! else NOT_FOUND {
    *,
    user: .user { name, handle, avatar },
  }

mutation promoteAdmin(c: conversations, u: users) -> members:
  require exists users[viewer] else NOT_FOUND
  require c.kind = 'group' else NOT_GROUP
  me = members[c, viewer]! else NOT_MEMBER
  require me.active and me.role = 'admin' else NOT_ADMIN
  m = members[c, u]! else NOT_MEMBER
  require m.active else NOT_MEMBER
  ~members[m] { role: 'admin' }
  members[c, u]! else NOT_FOUND {
    *,
    user: .user { name, handle, avatar },
  }

mutation leaveGroup(c: conversations) -> members:
  require exists users[viewer] else NOT_FOUND
  require c.kind = 'group' else NOT_GROUP
  me = members[c, viewer]! else NOT_MEMBER
  require me.active else NOT_MEMBER
  ~members[me] { active: false, leftAt: now, historyThru: (#lastSeq[c] ?? 0) }
  members[c, viewer]! else NOT_FOUND {
    *,
    user: .user { name, handle, avatar },
  }

mutation send(c: conversations, body: text <=2000, quote: messages ?) -> messages:
  require exists users[viewer] else NOT_FOUND
  me = members[c, viewer]! else NOT_MEMBER
  require me.active else NOT_MEMBER
  require body != '' else BODY_REQUIRED
  if quote:
    require quote.conv = c else BAD_QUOTE
  ts = now
  n = (#lastSeq[c] ?? 0) + 1
  m = +messages { conv: c, author: viewer, body: body, quote: quote, seq: n, at: ts }
  for mem in members[conv = c, active = true] last 50 by roster:
    if mem.user = viewer:
      ~members[mem] { lastActivity: ts, unread: 0, lastDeliveredAt: ts, lastReadAt: ts, preview: body, previewAt: ts, previewAuthor: viewer }
    else:
      ~members[mem] { lastActivity: ts, unread: .unread + 1, preview: body, previewAt: ts, previewAuthor: viewer }
  m {
    *,
    author: .author { name, handle, avatar },
    quote: .quote {
      *,
      author: .author { name, handle, avatar },
    },
  }

mutation ensureMessage(
  id: messages,
  c: conversations,
  body: text <=2000,
  quote: messages ?
) -> messages:
  -- Idempotent seed path. User-facing send always inserts.
  require exists users[viewer] else NOT_FOUND
  match messages[id]:
    some m:
      m {
        *,
        author: .author { name, handle, avatar },
        quote: .quote {
          *,
          author: .author { name, handle, avatar },
        },
      }
    none:
      me = members[c, viewer]! else NOT_MEMBER
      require me.active else NOT_MEMBER
      require body != '' else BODY_REQUIRED
      if quote:
        require quote.conv = c else BAD_QUOTE
      ts = now
      n = (#lastSeq[c] ?? 0) + 1
      msg = +messages { id: id, conv: c, author: viewer, body: body, quote: quote, seq: n, at: ts }
      for mem in members[conv = c, active = true] last 50 by roster:
        if mem.user = viewer:
          ~members[mem] { lastActivity: ts, unread: 0, lastDeliveredAt: ts, lastReadAt: ts, preview: body, previewAt: ts, previewAuthor: viewer }
        else:
          ~members[mem] { lastActivity: ts, unread: .unread + 1, preview: body, previewAt: ts, previewAuthor: viewer }
      msg {
        *,
        author: .author { name, handle, avatar },
        quote: .quote {
          *,
          author: .author { name, handle, avatar },
        },
      }

mutation markDelivered(c: conversations, at: time) -> members:
  -- Call after the client has fetched messages (chats preview or conversation
  -- page). Monotonic: never moves lastDeliveredAt backwards.
  require exists users[viewer] else NOT_FOUND
  mem = members[c, viewer]! else NOT_MEMBER
  require mem.active else NOT_MEMBER
  if mem.lastDeliveredAt:
    if at > mem.lastDeliveredAt:
      ~members[mem] { lastDeliveredAt: at }
  else:
    ~members[mem] { lastDeliveredAt: at }
  members[c, viewer]! else NOT_MEMBER {
    *,
    user: .user { name, handle, avatar },
  }

mutation markRead(c: conversations, at: time) -> members:
  -- Call when the recipient views the conversation. Also bumps delivered
  -- so sent → delivered → read stays monotonic if fetch was skipped.
  require exists users[viewer] else NOT_FOUND
  mem = members[c, viewer]! else NOT_MEMBER
  require mem.active else NOT_MEMBER
  ~members[mem] { unread: 0 }
  if mem.lastReadAt:
    if at > mem.lastReadAt:
      ~members[mem] { lastReadAt: at }
  else:
    ~members[mem] { lastReadAt: at }
  if mem.lastDeliveredAt:
    if at > mem.lastDeliveredAt:
      ~members[mem] { lastDeliveredAt: at }
  else:
    ~members[mem] { lastDeliveredAt: at }
  members[c, viewer]! else NOT_MEMBER {
    *,
    user: .user { name, handle, avatar },
  }
```

```boundary
- identity: in-system email+password (≥8 chars) via the engine's built-in credential path (adaptive KDF — argon2id, scrypt, or bcrypt at published parameters; never plaintext or reversible); unique email (duplicate signup refused); mint expiring session tokens; persist those tokens for app-restart sign-in; logout revokes the token server-side so it cannot call programs; supplies `viewer` to every program; may expose the session email to the client — email is not a `users` column.
- assets: accept fixture/user avatar uploads and post image (1–4) / video (exactly 1) uploads; store bytes; return an `asset` reference; deliver image and video bytes to clients; programs only store and return the reference. Message bodies this milestone are text; sender avatars are user.avatar.
- channels: `typing(conv)` — active members may publish and subscribe; the engine attaches the publisher as `viewer` (payload is a small struct, not the draft text); re-publish on keystroke / ≤2s heartbeat so other members see "…" in the open conversation and the chats row; `ttl 5s` from the last publish expires the indicator; dropping membership must drop the subscription.
- schedules: none this milestone (no digest, no expiry jobs).
- effects: none this milestone (no verification email, no push).
```

```notes
- DMs: `dmPairs` unique `(lo,hi)=sorted(a,b)`; `openDm` is match-or-insert. Groups always mint (same roster can coexist). Inbox is `members[viewer]` by `lastActivity` with preview/unread denormalized on send to `members[c, true] last 50` — not merge(); a user's chat count is unbounded. Roster is `(conv, active, joinedAt)` so live members ignore churned tombstones.
- Receipts are member watermarks, not per-message rows (leave cannot range-patch unbounded receipts). Ticks: every **active** member with `joinedAt <= at` except author. Leave drops unmet states; re-add writes a new `joinedAt`. Client combines `conversation` members + messages (UI shows ticks, not a count).
- History auth is `seq`/`historyThru`, not a time compare in a rule. Active members read every message (join = full history). Leave snapshots `#lastSeq`; later seqs are unreadable. Tombstones keep the chat on the inbox. Assumes unreadable rows are skipped, not slotted, in `last 50` (same as M2 unfollow).
- Typing is `channel typing(c)` ttl 5s; appear-within-2s is publish cadence + engine delivery. Seed: `openDm` / `ensureGroup(key)` / `ensureMessage(id)` match-or-insert; `createGroup`/`send` always insert. `groupSeeds.key` is global — fixture keys must not collide.
- Unread is a stored counter (watermark window, not a maintain). `#memberCount where active` is the 50-cap; `addMember` is singular so the require is once per transaction. Send fan-out patches other members' inbox fields — no column-level grants.
- Cannot: min 2 on an empty `people` list; whitespace-only body/name; `now` vs `time`; composite cursors (identical `at` can gap); unsetting optionals (re-add leaves stale `leftAt`/`historyThru`, trusts `active`). No media/edit/delete/reactions. Quote is a same-conv pointer; jump is client scroll + `message(m)` if off-page.
```
