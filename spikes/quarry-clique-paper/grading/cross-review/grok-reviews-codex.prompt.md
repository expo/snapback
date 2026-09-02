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
```schema
use identity
  -- Built-in, in-system email/password auth with unique emails and password length >=8.
  -- Stores only provider-managed adaptive password verifiers; credentials never enter app tables or logs.
  -- Issues expiring sessions, provides viewer, and rejects revoked sessions after server-side logout.

use assets
  -- Authenticated image/video upload and delivery; provides asset references while bytes remain outside the data plane.

table users:
  displayName: text <=50
  handle: text <=20
  avatar: asset ?
  bio: text <=200 ?
  location: text <=50 ?
  link: text <=2048 ?
  public
  insert r <- r.id = viewer.id
  update (old, next) <- old.id = viewer.id and next.id = old.id
  unique handle

table follows:
  follower: users
  followed: users
  at: time
  public
  insert r <- r.follower.id = viewer.id and r.followed.id != viewer.id
  delete r <- r.follower.id = viewer.id
  unique follower, followed

table posts:
  author: users
  parent: posts ?
  kind: enum('text', 'image', 'video')
  body: text <=500 ?
  image1: asset ?
  image2: asset ?
  image3: asset ?
  image4: asset ?
  video: asset ?
  at: time
  public
  insert r <- r.author.id = viewer.id
  by replies: parent, at

table profilePosts:
  post: posts
  author: users
  at: time
  public
  insert r <- r.author.id = viewer.id and r.post.author.id = viewer.id
  unique post
  by authorTime: author, at

table likes:
  post: posts
  user: users
  at: time
  public
  insert r <- r.user.id = viewer.id
  delete r <- r.user.id = viewer.id
  unique post, user

table reposts:
  post: posts
  user: users
  at: time
  public
  insert r <- r.user.id = viewer.id and exists profilePosts[r.post]
  delete r <- r.user.id = viewer.id
  unique post, user

table globalFeedEvents:
  scope: enum('all')
  post: posts
  actor: users
  kind: enum('original', 'repost')
  at: time
  public
  insert r <- r.actor.id = viewer.id and ((r.kind = 'original' and r.post.author.id = viewer.id) or (r.kind = 'repost' and exists reposts[r.post, viewer]))
  delete r <- r.actor.id = viewer.id
  unique post, actor, kind
  by timeline: scope, at

table followingFeedEvents:
  scope: enum('all')
  post: posts
  actor: users
  kind: enum('original', 'repost')
  at: time
  read r <- r.actor.id = viewer.id or exists follows[viewer, r.actor]
  insert r <- r.actor.id = viewer.id and ((r.kind = 'original' and r.post.author.id = viewer.id) or (r.kind = 'repost' and exists reposts[r.post, viewer]))
  delete r <- r.actor.id = viewer.id
  unique post, actor, kind
  by timeline: scope, at

maintain followerCount = count follows by followed (readable: public)
maintain followingCount = count follows by follower (readable: public)
maintain likeCount = count likes by post (readable: public)
maintain repostCount = count reposts by post (readable: public)
maintain replyCount = count posts by parent (readable: public)

table conversations: -- NEW
  kind: enum('dm', 'group') -- NEW
  createdBy: users -- NEW
  name: text <=50 ? -- NEW
  description: text <=200 ? -- NEW
  at: time -- NEW
  read r <- r.createdBy.id = viewer.id or exists conversationMembers[r, viewer] -- NEW
  insert r <- r.createdBy.id = viewer.id -- NEW

table dmPairs: -- NEW
  lo: users -- NEW
  hi: users -- NEW
  conversation: conversations -- NEW
  read r <- r.lo.id = viewer.id or r.hi.id = viewer.id -- NEW
  insert r <- r.conversation.kind = 'dm' and r.conversation.createdBy.id = viewer.id and r.lo.id != r.hi.id and (r.lo.id = viewer.id or r.hi.id = viewer.id) -- NEW
  unique lo, hi -- NEW
  unique conversation -- NEW

table conversationMembers: -- NEW
  conversation: conversations -- NEW
  user: users -- NEW
  role: enum('member', 'admin') -- NEW
  joinedAt: time -- NEW
  read r <- r.user.id = viewer.id or exists conversationMembers[r.conversation, viewer] -- NEW
  insert r <- (r.conversation.kind = 'dm' and r.role = 'member' and #conversationMemberCount[r.conversation] < 2 and (r.user.id = dmPairs[conversation = r.conversation].lo.id or r.user.id = dmPairs[conversation = r.conversation].hi.id)) or (r.conversation.kind = 'group' and ((r.user.id = viewer.id and r.role = 'admin' and r.conversation.createdBy.id = viewer.id and #conversationMemberCount[r.conversation] = 0) or (conversationMembers[r.conversation, viewer].role = 'admin' and r.role = 'member' and #conversationMemberCount[r.conversation] < 50))) -- NEW
  update (old, next) <- old.conversation.kind = 'group' and conversationMembers[old.conversation, viewer].role = 'admin' and old.role = 'member' and next.role = 'admin' and next.conversation.id = old.conversation.id and next.user.id = old.user.id and next.joinedAt = old.joinedAt -- NEW
  delete r <- r.conversation.kind = 'group' and (r.user.id = viewer.id or conversationMembers[r.conversation, viewer].role = 'admin') -- NEW
  unique conversation, user -- NEW
  by conversationUser: conversation, user -- NEW

table conversationActivity: -- NEW
  conversation: conversations -- NEW
  lastMessage: messages -- NEW
  at: time -- NEW
  read r <- exists conversationMembers[r.conversation, viewer] -- NEW
  insert r <- exists conversationMembers[r.conversation, viewer] -- NEW
  update (old, next) <- exists conversationMembers[old.conversation, viewer] and next.conversation.id = old.conversation.id -- NEW
  unique conversation -- NEW

table conversationStates: -- NEW
  conversation: conversations -- NEW
  user: users -- NEW
  membership: conversationMembers -- NEW
  activityAt: time -- NEW
  lastMessage: messages ? -- NEW
  read r <- r.user.id = viewer.id -- NEW
  insert r <- exists conversationMembers[r.conversation, viewer] and exists conversationMembers[r.membership] and r.membership.conversation.id = r.conversation.id and r.membership.user.id = r.user.id -- NEW
  update (old, next) <- exists conversationMembers[old.conversation, viewer] and exists conversationMembers[old.membership] and next.conversation.id = old.conversation.id and next.user.id = old.user.id and next.membership.id = old.membership.id -- NEW
  delete r <- r.user.id = viewer.id or conversationMembers[r.conversation, viewer].role = 'admin' -- NEW
  unique conversation, user -- NEW
  unique membership -- NEW
  by userActivity: user, activityAt -- NEW

table messages: -- NEW
  conversation: conversations -- NEW
  sender: users -- NEW
  body: text <=2000 -- NEW
  quoted: messages ? -- NEW
  at: time -- NEW
  read r <- exists conversationMembers[r.conversation, viewer] -- NEW
  insert r <- r.sender.id = viewer.id and exists conversationMembers[r.conversation, viewer] -- NEW
  by conversationTime: conversation, at -- NEW

table messageReceipts: -- NEW
  message: messages -- NEW
  conversation: conversations -- NEW
  membership: conversationMembers -- NEW
  recipient: users -- NEW
  state: enum('sent', 'delivered', 'read') -- NEW
  at: time -- NEW
  read r <- exists conversationMembers[r.conversation, viewer] -- NEW
  insert r <- r.message.sender.id = viewer.id and r.message.conversation.id = r.conversation.id and exists conversationMembers[r.membership] and r.membership.conversation.id = r.conversation.id and r.membership.user.id = r.recipient.id and r.recipient.id != viewer.id and r.state = 'sent' -- NEW
  update (old, next) <- old.recipient.id = viewer.id and exists conversationMembers[old.membership] and next.message.id = old.message.id and next.conversation.id = old.conversation.id and next.membership.id = old.membership.id and next.recipient.id = old.recipient.id and next.at = old.at and ((old.state = 'sent' and (next.state = 'sent' or next.state = 'delivered' or next.state = 'read')) or (old.state = 'delivered' and (next.state = 'delivered' or next.state = 'read')) or (old.state = 'read' and next.state = 'read')) -- NEW
  unique message, membership -- NEW
  by receiptSet: message, recipient -- NEW
  by membershipStateTime: membership, state, at -- NEW

table messagingSeedRuns: -- NEW
  owner: users -- NEW
  key: enum('m3-demo') -- NEW
  at: time -- NEW
  read r <- r.owner.id = viewer.id -- NEW
  insert r <- r.owner.id = viewer.id -- NEW
  unique owner, key -- NEW

maintain conversationMemberCount = count conversationMembers by conversation -- NEW
maintain unreadMessageCount = count messageReceipts by membership where r.state != 'read' -- NEW

channel typing(conv: conversations): -- NEW
  publish <- exists conversationMembers[conv, viewer] -- NEW
  subscribe <- exists conversationMembers[conv, viewer] -- NEW
  ttl 5s -- NEW
```

```programs
-- Sign-up, sign-in, session restoration, and logout are operations of `use identity`,
-- not Quarry programs.

query me():
  u = users[viewer]! else PROFILE_NOT_FOUND
  u {
    id,
    displayName,
    handle,
    avatar,
    bio,
    location,
    link,
    followerCount: #followerCount[.],
    followingCount: #followingCount[.],
    followedByViewer: exists follows[viewer, .],
  }

query profile(u: users):
  u {
    id,
    displayName,
    handle,
    avatar,
    bio,
    location,
    link,
    followerCount: #followerCount[.],
    followingCount: #followingCount[.],
    followedByViewer: exists follows[viewer, .],
  }

query profileByHandle(handle: text <=20):
  users[handle = handle] {
    id,
    displayName,
    handle,
    avatar,
    bio,
    location,
    link,
    followerCount: #followerCount[.],
    followingCount: #followingCount[.],
    followedByViewer: exists follows[viewer, .],
  }

query globalFeed():
  globalFeedEvents['all'] last 20 by timeline {
    id,
    eventKind: .kind,
    at,
    actor: .actor {
      id,
      displayName,
      handle,
      avatar,
    },
    post: .post {
      id,
      kind,
      body,
      image1,
      image2,
      image3,
      image4,
      video,
      parent,
      at,
      author: .author {
        id,
        displayName,
        handle,
        avatar,
      },
      likeCount: #likeCount[.],
      repostCount: #repostCount[.],
      replyCount: #replyCount[.],
      likedByViewer: exists likes[., viewer],
      repostedByViewer: exists reposts[., viewer],
    },
  }

query globalFeedBefore(cursor: time):
  globalFeedEvents['all'] before cursor last 20 by timeline {
    id,
    eventKind: .kind,
    at,
    actor: .actor {
      id,
      displayName,
      handle,
      avatar,
    },
    post: .post {
      id,
      kind,
      body,
      image1,
      image2,
      image3,
      image4,
      video,
      parent,
      at,
      author: .author {
        id,
        displayName,
        handle,
        avatar,
      },
      likeCount: #likeCount[.],
      repostCount: #repostCount[.],
      replyCount: #replyCount[.],
      likedByViewer: exists likes[., viewer],
      repostedByViewer: exists reposts[., viewer],
    },
  }

query followingFeed():
  followingFeedEvents['all'] last 20 by timeline {
    id,
    eventKind: .kind,
    at,
    actor: .actor {
      id,
      displayName,
      handle,
      avatar,
    },
    post: .post {
      id,
      kind,
      body,
      image1,
      image2,
      image3,
      image4,
      video,
      parent,
      at,
      author: .author {
        id,
        displayName,
        handle,
        avatar,
      },
      likeCount: #likeCount[.],
      repostCount: #repostCount[.],
      replyCount: #replyCount[.],
      likedByViewer: exists likes[., viewer],
      repostedByViewer: exists reposts[., viewer],
    },
  }

query followingFeedBefore(cursor: time):
  followingFeedEvents['all'] before cursor last 20 by timeline {
    id,
    eventKind: .kind,
    at,
    actor: .actor {
      id,
      displayName,
      handle,
      avatar,
    },
    post: .post {
      id,
      kind,
      body,
      image1,
      image2,
      image3,
      image4,
      video,
      parent,
      at,
      author: .author {
        id,
        displayName,
        handle,
        avatar,
      },
      likeCount: #likeCount[.],
      repostCount: #repostCount[.],
      replyCount: #replyCount[.],
      likedByViewer: exists likes[., viewer],
      repostedByViewer: exists reposts[., viewer],
    },
  }

query profilePostFeed(u: users):
  profilePosts[u] last 20 by authorTime {
    id,
    at,
    post: .post {
      id,
      kind,
      body,
      image1,
      image2,
      image3,
      image4,
      video,
      parent,
      at,
      author: .author {
        id,
        displayName,
        handle,
        avatar,
      },
      likeCount: #likeCount[.],
      repostCount: #repostCount[.],
      replyCount: #replyCount[.],
      likedByViewer: exists likes[., viewer],
      repostedByViewer: exists reposts[., viewer],
    },
  }

query profilePostFeedBefore(u: users, cursor: time):
  profilePosts[u] before cursor last 20 by authorTime {
    id,
    at,
    post: .post {
      id,
      kind,
      body,
      image1,
      image2,
      image3,
      image4,
      video,
      parent,
      at,
      author: .author {
        id,
        displayName,
        handle,
        avatar,
      },
      likeCount: #likeCount[.],
      repostCount: #repostCount[.],
      replyCount: #replyCount[.],
      likedByViewer: exists likes[., viewer],
      repostedByViewer: exists reposts[., viewer],
    },
  }

query thread(p: posts):
  root = posts[p]! else POST_NOT_FOUND
  root {
    id,
    kind,
    body,
    image1,
    image2,
    image3,
    image4,
    video,
    parent,
    at,
    author: .author {
      id,
      displayName,
      handle,
      avatar,
    },
    likeCount: #likeCount[.],
    repostCount: #repostCount[.],
    replyCount: #replyCount[.],
    likedByViewer: exists likes[., viewer],
    repostedByViewer: exists reposts[., viewer],
    replies: posts[.] first 20 by replies {
      id,
      kind,
      body,
      image1,
      image2,
      image3,
      image4,
      video,
      parent,
      at,
      author: .author {
        id,
        displayName,
        handle,
        avatar,
      },
      likeCount: #likeCount[.],
      repostCount: #repostCount[.],
      replyCount: #replyCount[.],
      likedByViewer: exists likes[., viewer],
      repostedByViewer: exists reposts[., viewer],
    },
  }

query threadRepliesAfter(p: posts, cursor: time):
  posts[p] after cursor first 20 by replies {
    id,
    kind,
    body,
    image1,
    image2,
    image3,
    image4,
    video,
    parent,
    at,
    author: .author {
      id,
      displayName,
      handle,
      avatar,
    },
    likeCount: #likeCount[.],
    repostCount: #repostCount[.],
    replyCount: #replyCount[.],
    likedByViewer: exists likes[., viewer],
    repostedByViewer: exists reposts[., viewer],
  }

query chatList():
  conversationStates[viewer] last 30 by userActivity {
    id,
    activityAt,
    unreadCount: #unreadMessageCount[.membership],
    conversation: .conversation {
      id,
      kind,
      name,
      description,
      memberCount: #conversationMemberCount[.],
      members: conversationMembers[.] first 50 by conversationUser {
        id,
        role,
        user: .user {
          id,
          displayName,
          handle,
          avatar,
        },
      },
    },
    lastMessage: .lastMessage {
      id,
      body,
      at,
      sender: .sender {
        id,
        displayName,
        handle,
        avatar,
      },
      quoted: .quoted {
        id,
        body,
        sender: .sender {
          id,
          displayName,
          handle,
        },
      },
    },
  }

query chatListBefore(cursor: time):
  conversationStates[viewer] before cursor last 30 by userActivity {
    id,
    activityAt,
    unreadCount: #unreadMessageCount[.membership],
    conversation: .conversation {
      id,
      kind,
      name,
      description,
      memberCount: #conversationMemberCount[.],
      members: conversationMembers[.] first 50 by conversationUser {
        id,
        role,
        user: .user {
          id,
          displayName,
          handle,
          avatar,
        },
      },
    },
    lastMessage: .lastMessage {
      id,
      body,
      at,
      sender: .sender {
        id,
        displayName,
        handle,
        avatar,
      },
      quoted: .quoted {
        id,
        body,
        sender: .sender {
          id,
          displayName,
          handle,
        },
      },
    },
  }

query conversation(c: conversations):
  membership = conversationMembers[c, viewer]! else NOT_MEMBER
  conv = conversations[c]! else CONVERSATION_NOT_FOUND
  conv {
    id,
    kind,
    name,
    description,
    at,
    viewerRole: membership.role,
    memberCount: #conversationMemberCount[.],
    members: conversationMembers[.] first 50 by conversationUser {
      id,
      role,
      joinedAt,
      user: .user {
        id,
        displayName,
        handle,
        avatar,
      },
    },
  }

query conversationHistory(c: conversations):
  membership = conversationMembers[c, viewer]! else NOT_MEMBER
  messages[c] last 50 by conversationTime {
    id,
    body,
    at,
    sender: .sender {
      id,
      displayName,
      handle,
      avatar,
    },
    quoted: .quoted {
      id,
      body,
      at,
      sender: .sender {
        id,
        displayName,
        handle,
        avatar,
      },
    },
    receipts: messageReceipts[.] first 50 by receiptSet {
      id,
      state,
      requiredNow: exists conversationMembers[.membership],
      recipient: .recipient {
        id,
        displayName,
        handle,
        avatar,
      },
    },
  }

query conversationHistoryBefore(c: conversations, cursor: time):
  membership = conversationMembers[c, viewer]! else NOT_MEMBER
  messages[c] before cursor last 50 by conversationTime {
    id,
    body,
    at,
    sender: .sender {
      id,
      displayName,
      handle,
      avatar,
    },
    quoted: .quoted {
      id,
      body,
      at,
      sender: .sender {
        id,
        displayName,
        handle,
        avatar,
      },
    },
    receipts: messageReceipts[.] first 50 by receiptSet {
      id,
      state,
      requiredNow: exists conversationMembers[.membership],
      recipient: .recipient {
        id,
        displayName,
        handle,
        avatar,
      },
    },
  }

query conversationHistoryAfter(c: conversations, cursor: time):
  membership = conversationMembers[c, viewer]! else NOT_MEMBER
  messages[c] after cursor first 50 by conversationTime {
    id,
    body,
    at,
    sender: .sender {
      id,
      displayName,
      handle,
      avatar,
    },
    quoted: .quoted {
      id,
      body,
      at,
      sender: .sender {
        id,
        displayName,
        handle,
        avatar,
      },
    },
    receipts: messageReceipts[.] first 50 by receiptSet {
      id,
      state,
      requiredNow: exists conversationMembers[.membership],
      recipient: .recipient {
        id,
        displayName,
        handle,
        avatar,
      },
    },
  }

query messageById(m: messages):
  message = messages[m]! else MESSAGE_NOT_FOUND
  message {
    id,
    body,
    at,
    conversation,
    sender: .sender {
      id,
      displayName,
      handle,
      avatar,
    },
    quoted: .quoted {
      id,
      body,
      at,
      sender: .sender {
        id,
        displayName,
        handle,
        avatar,
      },
    },
    receipts: messageReceipts[.] first 50 by receiptSet {
      id,
      state,
      requiredNow: exists conversationMembers[.membership],
      recipient: .recipient {
        id,
        displayName,
        handle,
        avatar,
      },
    },
  }

query messageReceiptState(m: messages):
  message = messages[m]! else MESSAGE_NOT_FOUND
  message {
    id,
    at,
    receipts: messageReceipts[.] first 50 by receiptSet {
      id,
      state,
      requiredNow: exists conversationMembers[.membership],
      recipient: .recipient {
        id,
        displayName,
        handle,
        avatar,
      },
    },
  }

query myUnreadReceiptBatch(c: conversations):
  membership = conversationMembers[c, viewer]! else NOT_MEMBER
  merge(
    messageReceipts[membership, 'sent'],
    messageReceipts[membership, 'delivered']
  ) first 50 {
    id,
    state,
    at,
    message: .message {
      id,
      body,
      at,
      sender: .sender {
        id,
        displayName,
        handle,
        avatar,
      },
    },
  }

mutation createProfile(
  displayName: text <=50,
  handle: text <=20,
  avatar: asset ?,
  bio: text <=200 ?,
  location: text <=50 ?,
  link: text <=2048 ?
) -> users:
  require not exists users[viewer] else PROFILE_EXISTS
  +users {
    id: viewer,
    displayName,
    handle,
    avatar,
    bio,
    location,
    link,
  }

mutation updateProfile(
  displayName: text <=50,
  handle: text <=20,
  avatar: asset ?,
  bio: text <=200 ?,
  location: text <=50 ?,
  link: text <=2048 ?
) -> users:
  u = users[viewer]! else PROFILE_NOT_FOUND
  ~users[u] {
    displayName,
    handle,
    avatar,
    bio,
    location,
    link,
  }
  users[u]! else PROFILE_NOT_FOUND

mutation toggleFollow(u: users) -> bool:
  require u.id != viewer.id else CANNOT_FOLLOW_SELF
  match follows[viewer, u]:
    some f:
      -follows[f]
      false
    none:
      +follows {
        follower: viewer,
        followed: u,
        at: now,
      }
      true

mutation createTextPost(body: text <=500) -> posts:
  p = +posts {
    author: viewer,
    kind: 'text',
    body,
    at: now,
  }
  +profilePosts {
    post: p,
    author: viewer,
    at: p.at,
  }
  +globalFeedEvents {
    scope: 'all',
    post: p,
    actor: viewer,
    kind: 'original',
    at: p.at,
  }
  +followingFeedEvents {
    scope: 'all',
    post: p,
    actor: viewer,
    kind: 'original',
    at: p.at,
  }
  p

mutation createImagePost(
  body: text <=500 ?,
  image1: asset,
  image2: asset ?,
  image3: asset ?,
  image4: asset ?
) -> posts:
  p = +posts {
    author: viewer,
    kind: 'image',
    body,
    image1,
    image2,
    image3,
    image4,
    at: now,
  }
  +profilePosts {
    post: p,
    author: viewer,
    at: p.at,
  }
  +globalFeedEvents {
    scope: 'all',
    post: p,
    actor: viewer,
    kind: 'original',
    at: p.at,
  }
  +followingFeedEvents {
    scope: 'all',
    post: p,
    actor: viewer,
    kind: 'original',
    at: p.at,
  }
  p

mutation createVideoPost(body: text <=500 ?, video: asset) -> posts:
  p = +posts {
    author: viewer,
    kind: 'video',
    body,
    video,
    at: now,
  }
  +profilePosts {
    post: p,
    author: viewer,
    at: p.at,
  }
  +globalFeedEvents {
    scope: 'all',
    post: p,
    actor: viewer,
    kind: 'original',
    at: p.at,
  }
  +followingFeedEvents {
    scope: 'all',
    post: p,
    actor: viewer,
    kind: 'original',
    at: p.at,
  }
  p

mutation createTextReply(parent: posts, body: text <=500) -> posts:
  p = posts[parent]! else POST_NOT_FOUND
  +posts {
    author: viewer,
    parent: p,
    kind: 'text',
    body,
    at: now,
  }

mutation createImageReply(
  parent: posts,
  body: text <=500 ?,
  image1: asset,
  image2: asset ?,
  image3: asset ?,
  image4: asset ?
) -> posts:
  p = posts[parent]! else POST_NOT_FOUND
  +posts {
    author: viewer,
    parent: p,
    kind: 'image',
    body,
    image1,
    image2,
    image3,
    image4,
    at: now,
  }

mutation createVideoReply(
  parent: posts,
  body: text <=500 ?,
  video: asset
) -> posts:
  p = posts[parent]! else POST_NOT_FOUND
  +posts {
    author: viewer,
    parent: p,
    kind: 'video',
    body,
    video,
    at: now,
  }

mutation toggleLike(p: posts) -> bool:
  post = posts[p]! else POST_NOT_FOUND
  match likes[post, viewer]:
    some like:
      -likes[like]
      false
    none:
      +likes {
        post,
        user: viewer,
        at: now,
      }
      true

mutation toggleRepost(p: posts) -> bool:
  post = posts[p]! else POST_NOT_FOUND
  require exists profilePosts[post] else REPLIES_CANNOT_BE_REPOSTED
  match reposts[post, viewer]:
    some repost:
      globalEvent = globalFeedEvents[post, viewer, 'repost']! else FEED_EVENT_MISSING
      followingEvent = followingFeedEvents[post, viewer, 'repost']! else FEED_EVENT_MISSING
      -globalFeedEvents[globalEvent]
      -followingFeedEvents[followingEvent]
      -reposts[repost]
      false
    none:
      repost = +reposts {
        post,
        user: viewer,
        at: now,
      }
      +globalFeedEvents {
        scope: 'all',
        post,
        actor: viewer,
        kind: 'repost',
        at: repost.at,
      }
      +followingFeedEvents {
        scope: 'all',
        post,
        actor: viewer,
        kind: 'repost',
        at: repost.at,
      }
      true

mutation startDM(counterpart: users) -> conversations:
  require counterpart.id != viewer.id else CANNOT_DM_SELF
  (lo, hi) = sorted(viewer, counterpart)
  match dmPairs[lo, hi]:
    some pair:
      pair.conversation
    none:
      conv = +conversations {
        kind: 'dm',
        createdBy: viewer,
        at: now,
      }
      +dmPairs {
        lo,
        hi,
        conversation: conv,
      }
      mine = +conversationMembers {
        conversation: conv,
        user: viewer,
        role: 'member',
        joinedAt: now,
      }
      theirs = +conversationMembers {
        conversation: conv,
        user: counterpart,
        role: 'member',
        joinedAt: now,
      }
      +conversationStates {
        conversation: conv,
        user: viewer,
        membership: mine,
        activityAt: conv.at,
      }
      +conversationStates {
        conversation: conv,
        user: counterpart,
        membership: theirs,
        activityAt: conv.at,
      }
      conv

mutation createGroup(
  name: text <=50,
  description: text <=200 ?,
  firstMember: users,
  otherMembers: [users] <=48
) -> conversations:
  require firstMember.id != viewer.id else CREATOR_ALREADY_INCLUDED
  conv = +conversations {
    kind: 'group',
    createdBy: viewer,
    name,
    description,
    at: now,
  }
  creatorMembership = +conversationMembers {
    conversation: conv,
    user: viewer,
    role: 'admin',
    joinedAt: now,
  }
  +conversationStates {
    conversation: conv,
    user: viewer,
    membership: creatorMembership,
    activityAt: conv.at,
  }
  firstMembership = +conversationMembers {
    conversation: conv,
    user: firstMember,
    role: 'member',
    joinedAt: now,
  }
  +conversationStates {
    conversation: conv,
    user: firstMember,
    membership: firstMembership,
    activityAt: conv.at,
  }
  for member in otherMembers:
    membership = +conversationMembers {
      conversation: conv,
      user: member,
      role: 'member',
      joinedAt: now,
    }
    +conversationStates {
      conversation: conv,
      user: member,
      membership,
      activityAt: conv.at,
    }
  conv

mutation addGroupMember(c: conversations, u: users) -> conversationMembers:
  conv = conversations[c]! else CONVERSATION_NOT_FOUND
  require conv.kind = 'group' else NOT_A_GROUP
  admin = conversationMembers[conv, viewer]! else NOT_MEMBER
  require admin.role = 'admin' else ADMIN_REQUIRED
  require not exists conversationMembers[conv, u] else ALREADY_MEMBER
  require #conversationMemberCount[conv] < 50 else GROUP_FULL
  membership = +conversationMembers {
    conversation: conv,
    user: u,
    role: 'member',
    joinedAt: now,
  }
  match conversationActivity[conv]:
    some activity:
      +conversationStates {
        conversation: conv,
        user: u,
        membership,
        activityAt: activity.at,
        lastMessage: activity.lastMessage,
      }
    none:
      +conversationStates {
        conversation: conv,
        user: u,
        membership,
        activityAt: conv.at,
      }
  membership

mutation removeGroupMember(c: conversations, u: users) -> bool:
  conv = conversations[c]! else CONVERSATION_NOT_FOUND
  require conv.kind = 'group' else NOT_A_GROUP
  admin = conversationMembers[conv, viewer]! else NOT_MEMBER
  require admin.role = 'admin' else ADMIN_REQUIRED
  require u.id != viewer.id else USE_LEAVE_GROUP
  target = conversationMembers[conv, u]! else NOT_MEMBER
  -conversationStates[conv, u]
  -conversationMembers[target]
  true

mutation promoteGroupAdmin(c: conversations, u: users) -> conversationMembers:
  conv = conversations[c]! else CONVERSATION_NOT_FOUND
  require conv.kind = 'group' else NOT_A_GROUP
  admin = conversationMembers[conv, viewer]! else NOT_MEMBER
  require admin.role = 'admin' else ADMIN_REQUIRED
  target = conversationMembers[conv, u]! else NOT_MEMBER
  require target.role = 'member' else ALREADY_ADMIN
  ~conversationMembers[target] {
    role: 'admin',
  }
  conversationMembers[conv, u]! else NOT_MEMBER

mutation leaveGroup(c: conversations) -> bool:
  conv = conversations[c]! else CONVERSATION_NOT_FOUND
  require conv.kind = 'group' else NOT_A_GROUP
  membership = conversationMembers[conv, viewer]! else NOT_MEMBER
  -conversationStates[conv, viewer]
  -conversationMembers[membership]
  true

mutation sendText(c: conversations, body: text <=2000) -> messages:
  conv = conversations[c]! else CONVERSATION_NOT_FOUND
  senderMembership = conversationMembers[conv, viewer]! else NOT_MEMBER
  members = conversationMembers[conv] first 50 by conversationUser
  message = +messages {
    conversation: conv,
    sender: viewer,
    body,
    at: now,
  }
  +~conversationActivity[conv] {
    lastMessage: message,
    at: message.at,
  }
  for member in members:
    if member.user.id = viewer.id:
      ~conversationStates[conv, member.user] {
        activityAt: message.at,
        lastMessage: message,
      }
    else:
      +messageReceipts {
        message,
        conversation: conv,
        membership: member,
        recipient: member.user,
        state: 'sent',
        at: message.at,
      }
      ~conversationStates[conv, member.user] {
        activityAt: message.at,
        lastMessage: message,
      }
  message

mutation sendQuotedText(
  c: conversations,
  quoted: messages,
  body: text <=2000
) -> messages:
  conv = conversations[c]! else CONVERSATION_NOT_FOUND
  senderMembership = conversationMembers[conv, viewer]! else NOT_MEMBER
  original = messages[quoted]! else QUOTED_MESSAGE_NOT_FOUND
  require original.conversation.id = conv.id else QUOTE_FROM_ANOTHER_CONVERSATION
  members = conversationMembers[conv] first 50 by conversationUser
  message = +messages {
    conversation: conv,
    sender: viewer,
    body,
    quoted: original,
    at: now,
  }
  +~conversationActivity[conv] {
    lastMessage: message,
    at: message.at,
  }
  for member in members:
    if member.user.id = viewer.id:
      ~conversationStates[conv, member.user] {
        activityAt: message.at,
        lastMessage: message,
      }
    else:
      +messageReceipts {
        message,
        conversation: conv,
        membership: member,
        recipient: member.user,
        state: 'sent',
        at: message.at,
      }
      ~conversationStates[conv, member.user] {
        activityAt: message.at,
        lastMessage: message,
      }
  message

mutation markDelivered(receipts: [messageReceipts] <=50) -> bool:
  for receiptRef in receipts:
    receipt = messageReceipts[receiptRef]! else RECEIPT_NOT_FOUND
    require receipt.recipient.id = viewer.id else NOT_RECEIPT_OWNER
    require exists conversationMembers[receipt.membership] else NOT_MEMBER
    if receipt.state = 'sent':
      ~messageReceipts[receipt] {
        state: 'delivered',
      }
  true

mutation markRead(receipts: [messageReceipts] <=50) -> bool:
  for receiptRef in receipts:
    receipt = messageReceipts[receiptRef]! else RECEIPT_NOT_FOUND
    require receipt.recipient.id = viewer.id else NOT_RECEIPT_OWNER
    require exists conversationMembers[receipt.membership] else NOT_MEMBER
    if receipt.state = 'sent' or receipt.state = 'delivered':
      ~messageReceipts[receipt] {
        state: 'read',
      }
  true

mutation seedMessagingDemo(bob: users, carol: users) -> bool:
  require bob.id != viewer.id and carol.id != viewer.id and bob.id != carol.id else INVALID_SEED_USERS
  match messagingSeedRuns[viewer, 'm3-demo']:
    some prior:
      false
    none:
      +messagingSeedRuns {
        owner: viewer,
        key: 'm3-demo',
        at: now,
      }
      (lo, hi) = sorted(viewer, bob)
      match dmPairs[lo, hi]:
        some pair:
          pair.conversation
        none:
          dm = +conversations {
            kind: 'dm',
            createdBy: viewer,
            at: now,
          }
          +dmPairs {
            lo,
            hi,
            conversation: dm,
          }
          mine = +conversationMembers {
            conversation: dm,
            user: viewer,
            role: 'member',
            joinedAt: now,
          }
          bobs = +conversationMembers {
            conversation: dm,
            user: bob,
            role: 'member',
            joinedAt: now,
          }
          +conversationStates {
            conversation: dm,
            user: viewer,
            membership: mine,
            activityAt: dm.at,
          }
          +conversationStates {
            conversation: dm,
            user: bob,
            membership: bobs,
            activityAt: dm.at,
          }
      group = +conversations {
        kind: 'group',
        createdBy: viewer,
        name: 'Clique Crew',
        at: now,
      }
      groupMine = +conversationMembers {
        conversation: group,
        user: viewer,
        role: 'admin',
        joinedAt: now,
      }
      groupBob = +conversationMembers {
        conversation: group,
        user: bob,
        role: 'member',
        joinedAt: now,
      }
      groupCarol = +conversationMembers {
        conversation: group,
        user: carol,
        role: 'member',
        joinedAt: now,
      }
      +conversationStates {
        conversation: group,
        user: viewer,
        membership: groupMine,
        activityAt: group.at,
      }
      +conversationStates {
        conversation: group,
        user: bob,
        membership: groupBob,
        activityAt: group.at,
      }
      +conversationStates {
        conversation: group,
        user: carol,
        membership: groupCarol,
        activityAt: group.at,
      }
      true
```

```boundary
- Identity — Validates unique email/password accounts, issues and restores expiring sessions, provides `viewer`, and enforces server-side logout and revocation.
- Assets — Accepts authenticated image/video uploads, returns typed `asset` references, and keeps all media bytes outside Quarry.
- Typing channel — Delivers authenticated `{conversation, viewer, typing}` signals to current members within 2 seconds; clients refresh on keystrokes and the engine expires each publisher’s signal after 5 seconds.
- Live-query transport — Re-evaluates chat lists, histories, membership, unread aggregates, and receipt projections after commits on every connected device.
- Offline client cache — Durably caches fetched messages and quoted targets; removal revokes future server reads but does not erase the former member’s already-downloaded history.
- Client receipt driver — Calls `markDelivered` only for receipt rows whose messages were fetched and calls `markRead` in bounded batches when those messages are viewed.
- Schedules and external effects — No schedule or push/email effect is declared for M3; this milestone requires neither delayed mutation execution nor external emission.
```

```notes
- `dmPairs` stores the sorted user pair under a unique key, so sequential attempts reopen one DM and concurrent duplicate creation is refused atomically.
- Groups have independent conversation ids and no membership-set uniqueness, so identical member sets may coexist.
- Requiring `firstMember` plus at most 48 additional users yields 2–50 members; duplicate list entries are refused by the membership unique key.
- Current members can read every group message regardless of `joinedAt`, giving newly added members full history.
- Each receipt captures the recipient’s membership-row id at send time; deleting that row immediately makes `requiredNow` false, even if the user later rejoins.
- Receipt rows are monotonic, and each message returns its entire ≤49-recipient set so the client can derive the slowest currently-required state exactly.
- Exact unread badges use a maintained count keyed by the membership incarnation, avoiding stale unread rows after removal and rejoin.
- Chat-list preview/activity rows are fanned out on write because group fan-out is strictly bounded at 50 members.
- Typing is ephemeral channel state, never a durable table row; the same channel feeds both the open conversation and chat-list hint.
- Quoted messages retain a durable pointer and full bounded body; excerpt clipping and scroll positioning are client behavior because Quarry has no substring primitive.
- Removed members lose server access immediately; retaining their prior history is explicitly the offline cache’s responsibility.
- Quarry cannot enforce the group-name minimum of one character or non-empty message bodies, though their maximum lengths are enforced.
- Time-only pagination cannot formally disambiguate equal intent timestamps because Quarry v0.2 has no composite cursor.
- `messagingSeedRuns` gates the demo seed transaction, so a second completed run creates no additional DM, group, memberships, or list rows.
```
