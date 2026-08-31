You are an independent grader for an authoring experiment. Below: (1) the Quarry language spec (for submissions in Quarry notation), (2) grading rubrics for several tasks, (3) 12 submissions named model-arm-task (arm A/B are TypeScript, arm C is Quarry). For EACH submission, grade every rubric item for its task as avoided / committed / not-attempted, and separately note any syntax invalid per the given spec (for Quarry) or any invented API (for TypeScript). Judge semantics strictly; do not reward intent. Output a compact table: submission | item | verdict, then one line of notes per submission.

=== QUARRY SPEC ===
# Quarry — the data language (complete reference)

Quarry is a small language for backend data programs: **queries** (read) and
**mutations** (read + write). Everything a program may do is in this document;
if a construct is not here, it does not exist. There is no `while`, no
recursion, no ambient clock, no randomness, no I/O, no unbounded read.
Comments run from `--` to end of line.

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
that table (`c: conversations`). Scalars: `text <=N`, `int`, `time`, `bool`.
Lists carry a mandatory cap: `to: [users] <=50`.

## Schema

```
table messages:
  conv: conversations          -- reference column
  author: users
  body: text <=4096
  at: time
  by conv, at                  -- an ordering (index); optionally named: by activity: user, activity

table users:
  name: text <=80
  handle: text <=32
  unique handle                -- unique key; duplicate inserts are refused at commit

maintain unread = count messages by conv           -- engine-maintained aggregate
```

Every table has an implicit `id`. You may extend a given schema from your
program file with top-level lines:

```
index applications: posting, at          -- add an ordering
unique passengers: ride, user            -- add a unique key
maintain n = count applications by posting
maintain top = max entries of score by contest (readable: public)
```

`maintain` forms: `count t by cols`, `sum t of col by cols`,
`max t of col by cols`, `min t of col by cols`. The engine keeps them exact at
commit. A maintained value over rows the reader cannot see is a **declared
disclosure** — say so with `(readable: ...)`.

Read rules may appear on tables (`read m <- <predicate>`); the engine enforces
read visibility. Mutations enforce their own write authorization with
`require`.

## Reads

- `t[expr]` — point read. If `expr` is a reference to `t`, this is a get by id
  and has type `Row?` (maybe-absent). `t[a, b]` keys a declared composite
  `unique` index. `t[col = expr]` names the column explicitly (required when
  inference would be ambiguous).
- `exists t[...]` — boolean existence test.
- `#name[key]` — read a maintained aggregate: exact, complete, O(1). Type `int`.
- **Range reads.** If the bracket keys a prefix of an ordering, the read is a
  range and MUST end with a direction and bound: `first N` (ascending) or
  `last N` (descending). It does not parse without one. The result is a
  **page**: up to N rows, with `.more: bool`.

```
messages[c] last 3                       -- newest 3 (ordering `by conv, at` inferred from c's type)
members[viewer] last 50 by activity      -- name the ordering when the table has several
episodes[s] after sub.lastListenedAt first 100
```

`after expr` / `before expr` restrict the ordering's final column.

## Shapes

Braces after a row or page project it. On a page, the shape applies to every
row. Inside a shape, `.` is the focal row; `*` splices all of its columns;
nested reads may open nested shapes (which re-focus `.`); bind `as x` on a
domain when an inner shape needs the outer row.

```
messages[c] last 3 {
  *,
  author: users[.author],
}
```

## Reductions and `capped`

`page | count` and `page | sum .col` reduce a page. Their type is
**`capped int`** — a fact about *the page*, not the population (render as
"N+" when `.more`). A `capped int` cannot be stored by a write, compared in a
`require`, or returned where the schema demands `int`: those are type errors.
A population fact — a total, a maximum, a rank — is a `#` maintained read.

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
- `match t[k]:` with arms `some x:` and `none:` — the only way to branch on a
  point read's absence. On a restricted table, `none` does not distinguish
  absent from hidden; do not turn it into an existence claim.
- `walk t[seed] up .col depth N` — bounded ancestor traversal: follows the
  reference column `col` from the seed at most N steps; yields the visited
  rows in order, usable as a `for` domain or a result.

## Clocks and values

- `now` — the client's intent clock. Type `time!intent`: it may be **stored**
  as a timestamp, and nothing else. It cannot be compared with a `time`
  column — that comparison does not typecheck.
- `commit` — the engine's clock at commit. Type `time!commit`: use it in every
  guard that grants or denies by time (expiry, deadline, window).
- `viewer` — the calling principal. `new` — mint an id explicitly (rare;
  inserts mint their own).
- Operators: `+ - * / %` on ints; `= != < <= > >=`; `and or not`; `??`
  (absent-coalesce); `?.` (absent-propagating access); `!` after a point read
  asserts presence (`users[x]! else NO_USER` refuses instead of yielding
  absence).
- Builtins: `min`, `max`, `sorted(a, b)` (a pair in order),
  `tokens(text)` (bounded word list, ≤64), `split(amount, list, member)`
  (deterministic integer share), `range(a, b)`.

## Worked examples

A chat thread — the newest 3 messages with each author and any @-mentioned
users:

```
query thread(c: conversations):
  messages[c] last 3 {
    *,
    author: users[.author],
    mentions: tokens(.body) { users[handle = .] }
  }
```

Sending a message, membership-guarded:

```
mutation send(c: conversations, body: text <=4096) -> messages:
  require exists members[c, viewer] else NOT_MEMBER
  +messages { conv: c, author: viewer, body, at: now }
```

=== RUBRICS ===
## T01 — control

- R1 PRIOR: every range read bounded (bookings take 20).
- R2 SEM: instructor/booker names via point reads, not table scans.
- R3 INC: class fields + instructor name + 20 earliest bookings with names.

## T02 — unbounded scan

- R1 PRIOR: scan bounded (any literal 10–200).
- R2 SEM: keyed by viewer prefix, not table-wide scan + filter.
- R3 INC: newest first; pagination affordance (hasMore/.more or cursor) soft.

## T03 — structural count

- R1 PRIOR: total via maintained aggregate. Committed = page count/length/loop
  tally returned as the total (TS machine: E_STRUCTURAL_COUNT/E_UNBOUND_COUNT;
  Quarry: `| count` is `capped int` — returning it as a total is a type error).
- R2 PRIOR: postings scan bounded 20.
- R3 INC: posting + total pairs returned.

## T04 — structural rank

- R1 PRIOR: maintained max, not `scan desc take 1` / `sort[0]` (machine:
  E_STRUCTURAL_COUNT over the private table).
- R2 INC: disclosure declared/acknowledged (`readable: public` or comment).
- R3 SEM: read via the maintained aggregate (`db.get` / `#top[c]`).

## T05 — intent clock

- R1 PRIOR: expiry compared against `ctx.commitTime` / `commit`. Committed =
  `ctx.now()`, an arg clock, or `Date.now()` in the expiry guard.
- R2 PRIOR: no ambient `Date` (TS machine: E_AMBIENT_TIME).
- R3 INC: ALREADY_REDEEMED path handled (exists-check and/or unique reliance).
- R4 INC: PROMO_EXPIRED code used.

## T07 — fanout

- R1 PRIOR: author membership guard present.
- R2 PRIOR: member iteration bounded (take ≤ 256; club cap 200 given).
- R3 SEM: counter increment correct in both branches (upsert or
  get→insert/update). Committed = update-only (drops members with no row) or
  insert-only (duplicate refusal aborts).
- R4 INC: post inserted (author = viewer, at stored).

## T08 — missing guard

- R1 PRIOR: guard covers owner OR coach. Committed = no guard or owner-only.
- R2 SEM: coach check via `exists` on the (journal, user) path, not a scan of
  all coaches.
- R3 INC: entry inserted with journal, text, timestamp.

## T09 — capped display count

- R1 PRIOR: per-sub count bounded AND presented capped (`countCapped()` /
  `| count` as capped). Committed = unbounded count, or bounded page count
  presented as an exact total.
- R2 PRIOR: subs scan bounded (≤ 50 given).
- R3 INC: show title included.

## T10 — capacity race (admissible-but-wrong)

- R1 SEM: capacity from a complete count — maintained aggregate vs
  `ride.seats`. Committed = page count with a `take` (certifies in TS but
  undercounts past the take → overbooking). Machine does NOT catch this; it is
  the admissible-but-wrong probe.
- R2 SEM: idempotent join (exists/match before insert, or handled duplicate).
  Committed = blind insert (duplicate refusal aborts the transaction —
  not idempotent).
- R3 INC: RIDE_FULL code; passenger row written with `at`.
=== SUBMISSIONS ===
--- SUBMISSION haiku-A-T03.ts
const users = table("users");
const postings = table("postings");
const applications = privateTable("applications");

export const dashboard = query({}, ({ db, ctx }) => {
  const result: any[] = [];
  for (const posting of db.scan(postings.byEmployerCreated, [ctx.viewer], { order: "desc", take: 20 })) {
    let applicationCount = 0;
    for (const app of db.scan(applications.byPostingAt, [posting.id])) {
      applicationCount++;
    }
    result.push({ posting, applicationCount });
  }
  return result;
});
--- SUBMISSION haiku-C-T03.q
table users:
  name: text <=80

table postings:
  employer: users
  title: text <=200
  createdAt: time
  by employer, createdAt

table applications:
  posting: postings
  applicant: users
  at: time
  by posting, at
  read a <- a.applicant = viewer or postings[a.posting].employer = viewer

maintain appCount = count applications by posting

query dashboard():
  postings[employer = viewer] last 20 {
    *,
    applicationCount: #appCount[.]
  }
--- SUBMISSION codex-C-T04.q
table users:
  name: text <=80

table contests:
  title: text <=200
  endsAt: time

table entries:
  contest: contests
  baker: users
  score: int
  at: time
  by contest, score
  read e <- e.baker = viewer          -- private to the baker until the contest closes

maintain topScore = max entries of score by contest (readable: public)

query topScore(contestId: contests):
  #topScore[contestId]
--- SUBMISSION grok-C-T10.q
table users:
  name: text <=80

table rides:
  driver: users
  seats: int
  departsAt: time

table passengers:
  ride: rides
  user: users
  at: time
  by ride, at
  unique ride, user

maintain seatCount = count passengers by ride

mutation joinRide(rideId: rides) -> passengers:
  ride = rides[rideId]! else NO_RIDE
  match passengers[rideId, viewer]:
    some p:
      p
    none:
      require ride.seats > #seatCount[rideId] else RIDE_FULL
      +passengers { ride: rideId, user: viewer, at: now }
--- SUBMISSION haiku-C-T01.q
table users:
  name: text <=80

table studios:
  name: text <=100

table classes:
  studio: studios
  title: text <=200
  startsAt: time
  instructor: users
  by studio, startsAt

table bookings:
  class: classes
  user: users
  at: time
  by class, at

query classDetail(classId: classes):
  classId {
    title,
    startsAt,
    instructor: users[.instructor] { name },
    bookings: bookings[classId] first 20 {
      *,
      user: users[.user] { name }
    }
  }
--- SUBMISSION codex-A-T09.ts
const users = table("users");       // { id, name }
const shows = table("shows");       // { id, title }
const subs = table("subs");         // { id, userId, showId, lastListenedAt }
                                    // index subs.byUser: (userId)
const episodes = table("episodes"); // { id, showId, publishedAt, title }
                                    // index episodes.byShowPublished: (showId, publishedAt)

export const inboxBadges = query({}, ({ db, ctx }) => {
  const result: any[] = [];

  for (const sub of db.scan(subs.byUser, [ctx.viewer], { take: 50 })) {
    const show = db.get(shows, sub.showId);
    const newEpisodes = db.scan(
      episodes.byShowPublished,
      [sub.showId],
      { order: "asc", after: sub.lastListenedAt, take: 99 },
    );

    result.push({
      title: show?.title ?? null,
      badge: newEpisodes.hasMore ? "99+" : newEpisodes.count(),
    });
  }

  return result;
});
--- SUBMISSION grok-C-T09.q
table users:
  name: text <=80

table shows:
  title: text <=200

table subs:
  user: users
  show: shows
  lastListenedAt: time
  by user, lastListenedAt

table episodes:
  show: shows
  publishedAt: time
  title: text <=200
  by show, publishedAt

query inboxBadges():
  subs[viewer] last 50 {
    show: shows[.show],
    unread: episodes[.show] after .lastListenedAt first 99 | count
  }
--- SUBMISSION haiku-A-T07.ts
const users = table("users");        // { id, name }
const clubs = table("clubs");        // { id, name }
const members = table("members");    // { id, clubId, userId, joinedAt }
                                     // index members.byClubUser: (clubId, userId)
                                     // index members.byClub: (clubId, joinedAt)
const posts = table("posts");        // { id, clubId, authorId, body, at }
                                     // index posts.byClubAt: (clubId, at)
const unseen = table("unseen");      // { id, clubId, userId, n }
                                     // unique index unseen.byClubUser: (clubId, userId)

export const announce = mutation(
  { clubId: scalar(), body: text({ max: 4096 }) },
  ({ db, ctx, args }) => {
    db.require(
      db.exists(members.byClubUser, [args.clubId, ctx.viewer]),
      "NOT_MEMBER"
    );
    
    const postId = ctx.newId();
    db.insert(posts, {
      id: postId,
      clubId: args.clubId,
      authorId: ctx.viewer,
      body: args.body,
      at: ctx.commitTime,
    });
    
    for (const member of db.scan(members.byClub, [args.clubId])) {
      const unseenRow = db.get(unseen.byClubUser, [args.clubId, member.userId]);
      if (unseenRow) {
        db.update(unseen, unseenRow.id, { n: unseenRow.n + 1 });
      } else {
        db.insert(unseen, {
          id: ctx.newId(),
          clubId: args.clubId,
          userId: member.userId,
          n: 1,
        });
      }
    }
    
    return postId;
  }
);
--- SUBMISSION codex-C-T07.q
table users:
  name: text <=80

table clubs:
  name: text <=100

table members:
  club: clubs
  user: users
  joinedAt: time
  by club, joinedAt
  unique club, user

table posts:
  club: clubs
  author: users
  body: text <=4096
  at: time
  by club, at

table unseen:
  club: clubs
  user: users
  n: int
  unique club, user

mutation announce(clubId: clubs, body: text <=4096) -> posts:
  require exists members[clubId, viewer] else NOT_MEMBER
  post = +posts { club: clubId, author: viewer, body, at: now }
  clubMembers = members[clubId] first 200
  for member in clubMembers:
    +~unseen[clubId, member.user] { n: (.n ?? 0) + 1 }
  post
--- SUBMISSION haiku-C-T08.q
table users:
  name: text <=80

table journals:
  owner: users
  title: text <=200

table entries:
  journal: journals
  at: time
  text: text <=8192
  by journal, at
  read e <- journals[e.journal].owner = viewer
            or exists coaches[e.journal, viewer]

table coaches:
  journal: journals
  user: users
  unique journal, user

mutation addEntry(journalId: journals, entryText: text <=8192) -> entries:
  require journalId.owner = viewer or exists coaches[journalId, viewer] else NOT_ALLOWED
  +entries { journal: journalId, at: now, text: entryText }
--- SUBMISSION grok-A-T02.ts
const users = table("users");      // { id, name }
const recipes = table("recipes");  // { id, ownerId, title, createdAt }
                                   // index recipes.byOwnerCreated: (ownerId, createdAt)

export const myRecipes = query({ after: optional(time()) }, ({ db, ctx, args }) => {
  return db.scan(recipes.byOwnerCreated, [ctx.viewer], {
    order: "desc",
    take: 50,
    after: args.after,
  });
});
--- SUBMISSION codex-B-T05.ts
const users = table("users");             // { id, name }
const promos = table("promos");           // { id, code, discount, expiresAt }
                                          // unique index promos.byCode: (code)
const redemptions = table("redemptions"); // { id, promoId, userId, at }
                                          // unique index redemptions.byPromoUser: (promoId, userId)

export const redeemPromo = mutation(
  { code: scalar() },
  ({ db, ctx, args }) => {
    const promo = db.get(promos.byCode, [args.code]);
    db.require(promo !== null, "PROMO_NOT_FOUND");
    db.require(ctx.commitTime < promo.expiresAt, "PROMO_EXPIRED");
    db.require(
      !db.exists(redemptions.byPromoUser, [promo.id, ctx.viewer]),
      "ALREADY_REDEEMED",
    );

    const redemptionId = ctx.newId();
    db.insert(redemptions, {
      id: redemptionId,
      promoId: promo.id,
      userId: ctx.viewer,
      at: ctx.now(),
    });
    return redemptionId;
  },
);
