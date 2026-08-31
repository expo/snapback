# Grading key — rubric and reference solutions

Never shown to authors. Buckets per rubric item:

- **PRIOR** — prior-collision defect: a banned/unspellable construct or policy
  violation the TS prior invites (unbounded read, ambient time, intent-clock
  misuse, structural leak, missing guard, unbounded fanout/recursion).
- **SEM** — admissible-but-wrong: would certify but is semantically wrong
  (page-count as capacity/total, update-only counter, non-idempotent join).
- **SYN** — syntax/API fumble: invented API or notation, wrong signature.
  Noise bucket; scored separately so it does not drown the signal.
- **INC** — task incompleteness (missing field, missing refusal code).

Each item is graded **avoided / committed / not-attempted**. TS arms
additionally get the machine verdict (`bun src/cli.ts <module> --synthetic-schema`).

## T01 — control

- R1 PRIOR: every range read bounded (bookings take 20).
- R2 SEM: instructor/booker names via point reads, not table scans.
- R3 INC: class fields + instructor name + 20 earliest bookings with names.

Reference (TS): scan `bookings.byClassAt` asc take 20; `db.get(users, ...)`
for names.

Reference (Quarry):

```
query classDetail(c: classes):
  cls = classes[c]!
  cls {
    *,
    instructor: users[.instructor]?.name,
    bookings: bookings[c] first 20 { at: .at, name: users[.user]?.name }
  }
```

## T02 — unbounded scan

- R1 PRIOR: scan bounded (any literal 10–200).
- R2 SEM: keyed by viewer prefix, not table-wide scan + filter.
- R3 INC: newest first; pagination affordance (hasMore/.more or cursor) soft.

Reference (Quarry): `query myRecipes: recipes[viewer] last 50`

## T03 — structural count

- R1 PRIOR: total via maintained aggregate. Committed = page count/length/loop
  tally returned as the total (TS machine: E_STRUCTURAL_COUNT/E_UNBOUND_COUNT;
  Quarry: `| count` is `capped int` — returning it as a total is a type error).
- R2 PRIOR: postings scan bounded 20.
- R3 INC: posting + total pairs returned.

Reference (TS): `const appCounts = maintained("appCounts", applications);`
scan postings desc take 20, `db.get(appCounts, posting.id)`.

Reference (Quarry):

```
maintain appCount = count applications by posting

query dashboard:
  postings[viewer] last 20 { *, applications: #appCount[.id] }
```

## T04 — structural rank

- R1 PRIOR: maintained max, not `scan desc take 1` / `sort[0]` (machine:
  E_STRUCTURAL_COUNT over the private table).
- R2 INC: disclosure declared/acknowledged (`readable: public` or comment).
- R3 SEM: read via the maintained aggregate (`db.get` / `#top[c]`).

Reference (Quarry):

```
maintain top = max entries of score by contest (readable: public)

query topScore(c: contests):
  #top[c]
```

## T05 — intent clock

- R1 PRIOR: expiry compared against `ctx.commitTime` / `commit`. Committed =
  `ctx.now()`, an arg clock, or `Date.now()` in the expiry guard.
- R2 PRIOR: no ambient `Date` (TS machine: E_AMBIENT_TIME).
- R3 INC: ALREADY_REDEEMED path handled (exists-check and/or unique reliance).
- R4 INC: PROMO_EXPIRED code used.

Reference (Quarry):

```
mutation redeemPromo(c: text <=32) -> bool:
  promo = promos[code = c]! else NO_SUCH_PROMO
  require promo.expiresAt > commit else PROMO_EXPIRED
  require not exists redemptions[promo, viewer] else ALREADY_REDEEMED
  +redemptions { promo: promo, user: viewer, at: now }
  true
```

## T06 — unbounded recursion

- R1 PRIOR: bounded traversal (`recurse`/`walk` depth 12). Committed = `while`,
  recursive function, or unbounded loop.
- R2 INC: terminates at absent manager; chain starts at the employee.

Reference (TS): `recurse(args.employeeId, (cur) => db.get(employees, cur.managerId), { depth: 12, fanout: 1 })`

Reference (Quarry): `query chain(e: employees): walk employees[e] up .manager depth 12`

## T07 — fanout

- R1 PRIOR: author membership guard present.
- R2 PRIOR: member iteration bounded (take ≤ 256; club cap 200 given).
- R3 SEM: counter increment correct in both branches (upsert or
  get→insert/update). Committed = update-only (drops members with no row) or
  insert-only (duplicate refusal aborts).
- R4 INC: post inserted (author = viewer, at stored).

Reference (Quarry):

```
mutation announce(club: clubs, body: text <=4096) -> posts:
  require exists members[club, viewer] else NOT_MEMBER
  p = +posts { club, author: viewer, body, at: now }
  for m in members[club] first 200:
    +~unseen[club, m.user] { n: (.n ?? 0) + 1 }
  p
```

## T08 — missing guard

- R1 PRIOR: guard covers owner OR coach. Committed = no guard or owner-only.
- R2 SEM: coach check via `exists` on the (journal, user) path, not a scan of
  all coaches.
- R3 INC: entry inserted with journal, text, timestamp.

Reference (Quarry):

```
mutation addEntry(j: journals, entryText: text <=8192) -> entries:
  journal = journals[j]! else NOT_ALLOWED
  require journal.owner = viewer or exists coaches[j, viewer] else NOT_ALLOWED
  +entries { journal: j, at: now, text: entryText }
```

## T09 — capped display count

- R1 PRIOR: per-sub count bounded AND presented capped (`countCapped()` /
  `| count` as capped). Committed = unbounded count, or bounded page count
  presented as an exact total.
- R2 PRIOR: subs scan bounded (≤ 50 given).
- R3 INC: show title included.

Reference (Quarry):

```
query inboxBadges:
  subs[viewer] last 50 {
    title: shows[.show]?.title,
    unread: episodes[.show] after .lastListenedAt first 100 | count
  }
```

## T10 — capacity race (admissible-but-wrong)

- R1 SEM: capacity from a complete count — maintained aggregate vs
  `ride.seats`. Committed = page count with a `take` (certifies in TS but
  undercounts past the take → overbooking). Machine does NOT catch this; it is
  the admissible-but-wrong probe.
- R2 SEM: idempotent join (exists/match before insert, or handled duplicate).
  Committed = blind insert (duplicate refusal aborts the transaction —
  not idempotent).
- R3 INC: RIDE_FULL code; passenger row written with `at`.

Reference (TS):

```ts
const seatCounts = maintained("seatCounts", passengers);

export const joinRide = mutation({ rideId: scalar() }, ({ db, ctx, args }) => {
  const ride = db.get(rides, args.rideId);
  db.require(ride !== null, "NO_SUCH_RIDE");
  const existing = db.get(passengers.byRideUser, [args.rideId, ctx.viewer]);
  if (existing !== null) return existing.id;
  const taken = db.get(seatCounts, args.rideId);
  db.require(taken === null || taken.value < ride.seats, "RIDE_FULL");
  const passengerId = ctx.newId();
  db.insert(passengers, { id: passengerId, rideId: args.rideId, userId: ctx.viewer, at: ctx.now() });
  return passengerId;
});
```

Reference (Quarry):

```
maintain seatCount = count passengers by ride

mutation joinRide(r: rides) -> passengers:
  ride = rides[r]! else NO_SUCH_RIDE
  match passengers[r, viewer]:
    some p: p
    none:
      require #seatCount[r] < ride.seats else RIDE_FULL
      +passengers { ride: r, user: viewer, at: now }
```
