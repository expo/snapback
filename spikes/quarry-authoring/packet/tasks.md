# Authoring-test tasks

Ten tasks. Each has one seeded trap (or is a control), a shared English
statement, and the same schema in both notations. Assembled into per-arm
prompts by `assemble.mjs`.

## T01 — Class detail (control: shaped join)

### statement
Write a query `classDetail(classId)`: return the class — its title and start
time — with its instructor's name, and the earliest 20 bookings, each with the
booker's name.

### ts-schema
```ts
const users = table("users");        // { id, name }
const studios = table("studios");    // { id, name }
const classes = table("classes");    // { id, studioId, title, startsAt, instructorId }
                                     // index classes.byStudioStart: (studioId, startsAt)
const bookings = table("bookings");  // { id, classId, userId, at }
                                     // index bookings.byClassAt: (classId, at)
```

### quarry-schema
```
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
```

## T02 — My recipes (trap: unbounded scan)

### statement
Write a query `myRecipes()`: the viewer's recipes, newest first.

### ts-schema
```ts
const users = table("users");      // { id, name }
const recipes = table("recipes");  // { id, ownerId, title, createdAt }
                                   // index recipes.byOwnerCreated: (ownerId, createdAt)
```

### quarry-schema
```
table users:
  name: text <=80

table recipes:
  owner: users
  title: text <=200
  createdAt: time
  by owner, createdAt
```

## T03 — Employer dashboard (trap: structural count)

### statement
Write a query `dashboard()`: for the viewer's (an employer's) newest 20
postings, return each posting and the total number of applications it has
received.

### ts-schema
```ts
const users = table("users");              // { id, name }
const postings = table("postings");        // { id, employerId, title, createdAt }
                                           // index postings.byEmployerCreated: (employerId, createdAt)
const applications = privateTable("applications");
                                           // { id, postingId, applicantId, at }
                                           // readable only to the posting's employer and the applicant
                                           // index applications.byPostingAt: (postingId, at)
```

### quarry-schema
```
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
```

## T04 — Bake-off leaderboard (trap: structural rank)

### statement
Write a query `topScore(contestId)`: the current highest score in the
contest, for the public leaderboard page. (Note: each entry — including its
score — is visible only to its own baker until the contest closes; the
leaderboard's top score is meant to be public anyway.)

### ts-schema
```ts
const users = table("users");          // { id, name }
const contests = table("contests");    // { id, title, endsAt }
const entries = privateTable("entries");
                                       // { id, contestId, bakerId, score, at }
                                       // readable only to the entry's own baker until the contest closes
                                       // index entries.byContestScore: (contestId, score)
```

### quarry-schema
```
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
```

## T05 — Flash-sale promo (trap: intent clock)

### statement
Write a mutation `redeemPromo(code)`: record a redemption for the viewer if
the promo exists and has not expired; refuse with `PROMO_EXPIRED` if it has.
A user may redeem a given promo only once — refuse with `ALREADY_REDEEMED` on
a repeat.

### ts-schema
```ts
const users = table("users");             // { id, name }
const promos = table("promos");           // { id, code, discount, expiresAt }
                                          // unique index promos.byCode: (code)
const redemptions = table("redemptions"); // { id, promoId, userId, at }
                                          // unique index redemptions.byPromoUser: (promoId, userId)
```

### quarry-schema
```
table users:
  name: text <=80

table promos:
  code: text <=32
  discount: int
  expiresAt: time
  unique code

table redemptions:
  promo: promos
  user: users
  at: time
  unique promo, user
```

## T06 — Management chain (trap: unbounded recursion)

### statement
Write a query `chain(employeeId)`: the management chain from the employee up
to the top of the company (assume at most 12 levels), starting at the
employee.

### ts-schema
```ts
const employees = table("employees"); // { id, name, title, managerId } — managerId is null at the top
```

### quarry-schema
```
table employees:
  name: text <=80
  title: text <=100
  manager: employees          -- absent at the top
```

## T07 — Club announcement (trap: fanout)

### statement
Write a mutation `announce(clubId, body)`: as a member of the club, post an
announcement and increment every member's unseen counter. Clubs are capped at
200 members.

### ts-schema
```ts
const users = table("users");        // { id, name }
const clubs = table("clubs");        // { id, name }
const members = table("members");    // { id, clubId, userId, joinedAt }
                                     // index members.byClubUser: (clubId, userId)
                                     // index members.byClub: (clubId, joinedAt)
const posts = table("posts");        // { id, clubId, authorId, body, at }
                                     // index posts.byClubAt: (clubId, at)
const unseen = table("unseen");      // { id, clubId, userId, n }
                                     // unique index unseen.byClubUser: (clubId, userId)
```

### quarry-schema
```
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
```

## T08 — Health journal entry (trap: missing guard)

### statement
Write a mutation `addEntry(journalId, entryText)`: append an entry to a
journal. Only the journal's owner or one of its coaches may add entries;
refuse with `NOT_ALLOWED` otherwise.

### ts-schema
```ts
const users = table("users");        // { id, name }
const journals = table("journals");  // { id, ownerId, title }
const entries = privateTable("entries");
                                     // { id, journalId, at, text }
                                     // readable only to the journal's owner and its coaches
                                     // index entries.byJournalAt: (journalId, at)
const coaches = table("coaches");    // { id, journalId, userId }
                                     // index coaches.byJournalUser: (journalId, userId)
```

### quarry-schema
```
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
```

## T09 — Podcast badges (trap: capped display count)

### statement
Write a query `inboxBadges()`: for up to 50 of the viewer's subscriptions,
return the show title and how many episodes have been published since the
viewer last listened — shown as a badge that displays exact numbers up to 99
and "99+" beyond.

### ts-schema
```ts
const users = table("users");       // { id, name }
const shows = table("shows");       // { id, title }
const subs = table("subs");         // { id, userId, showId, lastListenedAt }
                                    // index subs.byUser: (userId)
const episodes = table("episodes"); // { id, showId, publishedAt, title }
                                    // index episodes.byShowPublished: (showId, publishedAt)
```

### quarry-schema
```
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
```

## T10 — Join a ride (trap: capacity race / admissible-but-wrong)

### statement
Write a mutation `joinRide(rideId)`: add the viewer as a passenger. If the
viewer already joined, return the existing state without an error
(idempotent). Refuse with `RIDE_FULL` when the ride's seats are all taken.
Rides can be popular — hundreds of people may try to join at the same moment.

### ts-schema
```ts
const users = table("users");           // { id, name }
const rides = table("rides");           // { id, driverId, seats, departsAt }
const passengers = table("passengers"); // { id, rideId, userId, at }
                                        // unique index passengers.byRideUser: (rideId, userId)
                                        // index passengers.byRideAt: (rideId, at)
```

### quarry-schema
```
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
```
