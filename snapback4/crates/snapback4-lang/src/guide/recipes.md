# Recipes: roles, two parties, booking, deleting and schedules

Each recipe is one compiled schema for an app shape that otherwise takes several cards to assemble.
Copy one whole, then rename its tables; each says how it syncs, how to test it and which refusals to expect.

```quarry
table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only

table requests:
  author: principal
  title: text 1..200
  read <- .author = viewer or exists staff[viewer]
  insert <- .author = viewer
  online only

query board(c: cursor ?):              -- one page: staff see every request, authors their own
  if exists staff[viewer]:
    return requests last 50 by .id after c
  return requests where .author = viewer last 50 by .id after c

query queue(c: cursor ?):
  require exists staff[viewer] else NOT_STAFF
  return requests last 50 by .id after c
```

The pattern under every recipe: rules say who may touch a row at all, a
`require … else CODE` in the operation says which change a caller may make and
answers with your code, and the table's sync line (or `online only`) says
whose device holds it. `guide refusals` gives the order the checks run in.

On other cards: a list only a group's members read, complete (`guide household`); bids sealed until a
deadline (`guide sealed`); roster tables and probe keys (`guide rosters`); expense claims with a PDF or photo receipt (`guide assets`, "Receipts").

## Roles: admin, staff and members

Everyone signed in is a member. A `roles` row makes a principal staff or an
admin; `exists roles[viewer]` is the staff grant and `exists roles[viewer,
role = 'admin']` the admin grant. An admin has a `roles` row, so every staff
grant admits admins too; test `role = 'staff'` where only staff is meant. Each operation repeats its grant as a
`require`, so a member gets `NOT_STAFF` instead of a bare `E_RULE`, and the
staff queue reads every open ticket and answers `complete: true`. The table's
update rule admits the author and staff; `retitle` narrows it to the author
and `close` to staff, one `require` each. A page that staff read whole and
members read their own rows of is one query that branches on the grant
(`board`): each branch scans rows its reader may read, so both answer
`complete: true`. A single `where .author = viewer or exists roles[viewer]`
scan cannot promise that (`N_NEVER_COMPLETE`), and two queries split the screen.

```quarry
use personas alice, bob, carol

table roles:
  principal: principal
  role: enum('staff', 'admin')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'admin']
  insert <- exists roles[viewer, role = 'admin'] or viewer = 'service:ops'
  update <- exists roles[viewer, role = 'admin']
  delete <- exists roles[viewer, role = 'admin']
  online only

table tickets:
  author: principal
  title: text 1..200
  done: bool default false
  at: time default now
  immutable author
  read <- .author = viewer or exists roles[viewer]
  insert <- .author = viewer
  update <- .author = viewer or exists roles[viewer]
  online only

query board(c: cursor ?):
  if exists roles[viewer]:
    return tickets last 50 by .at after c
  return tickets where .author = viewer last 50 by .at after c

query mine(c: cursor ?):
  return tickets where .author = viewer last 20 by .at after c

query queue(c: cursor ?):
  require exists roles[viewer] else NOT_STAFF
  return tickets where not .done last 50 by .at after c

mutation grant(who: principal, role: enum('staff', 'admin')):
  require exists roles[viewer, role = 'admin'] or viewer = 'service:ops' else NOT_ADMIN
  return upsert roles[who] { role }

mutation file(title: text 1..200):
  return insert tickets { author: viewer, title }

mutation retitle(ticket: tickets, title: text 1..200):
  t = tickets[ticket] ! else NOT_FOUND
  require t.author = viewer else NOT_AUTHOR
  update tickets[ticket] { title }

mutation close(ticket: tickets):
  require exists roles[viewer] else NOT_STAFF
  update tickets[ticket] { done: true }
```

Roles change who reads which rows, so the tables stay `online only`: sync
holds one audience per table (`guide sharing` keeps staff and tenants
offline with a table per audience). Seed the first admin; do not write a
persona into a rule (`viewer = 'dev:alice'` only exists under `dev`). Under
`dev` and `test` the seed is a fixture row, written as the system:

```jsonl
{"id":"r1","principal":"dev:alice","role":"admin"}
```

A deployed backend's first admin comes from the `service:ops` seat that the
insert rule names: mint its token with `snapback4 token --service ops` and
call `grant` once with it. Cases for `test.cases.jsonl` (with a ticket
`t1` by bob in the tickets fixture):

```jsonl
{"as":"alice","op":"board","args":{},"expect":"complete","label":"staff read every ticket on one page"}
{"as":"bob","op":"board","args":{},"expect":"complete","label":"a member reads their own tickets, complete too"}
{"as":"alice","op":"queue","args":{},"expect":"complete","label":"an admin sees every open ticket"}
{"as":"bob","op":"queue","args":{},"expect":"NOT_STAFF"}
{"as":"carol","op":"retitle","args":{"ticket":"t1","title":"x"},"expect":"NOT_FOUND","label":"a member cannot read bob's ticket"}
{"as":"alice","op":"grant","args":{"who":"dev:carol","role":"staff"}}
{"as":"carol","op":"close","args":{"ticket":"t1"},"label":"carol is staff now"}
{"as":"bob","op":"grant","args":{"who":"dev:bob","role":"admin"},"expect":"NOT_ADMIN"}
```

## Two parties: a buyer and a seller

An offer is read by exactly its buyer and its seller, offline on both
devices. `.buyer = viewer or .seller = viewer` is two audiences and cannot
sync, so each offer gets one `offerParties` row per reader, written by the
mutation that creates it (`created offers[.offerId]`) and checked by `after
insert`. The thread hangs off the offer through the same membership. Listing
"my offers" pages the caller's own party rows: a parties row read under
`.party = viewer or exists offerParties[.offer, viewer]` is its own witness,
so that page is complete and holds both sides.

```quarry
use personas alice, bob, carol

table listings:
  seller: principal
  title: text 1..120
  price: money USD
  immutable seller
  public 'anyone may browse listings'
  insert <- .seller = viewer
  update <- .seller = viewer
  sync public last 200 by .id

table offers:
  listing: listings
  buyer: principal
  seller: principal
  amount: money USD
  status: enum('open', 'accepted', 'declined') default 'open'
  at: time default now
  immutable listing, buyer, seller
  read <- exists offerParties[.id, viewer]
  insert <- .buyer = viewer and .seller = .listing.seller
  update <- .seller = viewer
  after insert <- exists offerParties[offer = .id, party = .buyer]
  after insert <- exists offerParties[offer = .id, party = .seller]
  sync

table offerParties:
  offer: offers
  party: principal
  unique offer, party
  immutable offer, party
  cap 2 by offer
  read <- .party = viewer or exists offerParties[.offer, viewer]
  insert <- created offers[.offer]
  sync

table notes:
  offer: offers
  sender: principal
  body: text 1..1000
  at: time default now
  immutable offer, sender
  read <- exists offerParties[.offer, viewer]
  insert <- .sender = viewer and exists offerParties[.offer, viewer]
  sync last 200 by .at

query myOffers(c: cursor ?):
  return offerParties where .party = viewer first 50 by .id after c { offer: offers[.offer] }

query thread(offer: offers, c: cursor ?):
  return notes where .offer = offer last 50 by .at after c

mutation makeOffer(listing: listings, amount: money USD):
  l = listings[listing] ! else NOT_FOUND
  require l.seller != viewer else OWN_LISTING
  o = insert offers { listing, buyer: viewer, seller: l.seller, amount }
  insert offerParties { offer: o.id, party: viewer }
  insert offerParties { offer: o.id, party: l.seller }
  return o

mutation answer(offer: offers, accept: bool):
  o = offers[offer] ! else NOT_FOUND
  require o.seller = viewer else NOT_SELLER
  require o.status = 'open' else ALREADY_ANSWERED
  update offers[offer] { status: 'accepted' if accept else 'declined' }

mutation note(offer: offers, body: text 1..1000):
  return insert notes { offer, sender: viewer, body }
```

Cases (with a listing `l1` by alice in the listings fixture):

```jsonl
{"as":"bob","op":"makeOffer","args":{"listing":"l1","amount":10000},"save":"o"}
{"as":"alice","op":"myOffers","args":{},"count":1,"expect":"complete","label":"the seller holds the offer"}
{"as":"carol","op":"note","args":{"offer":"$o","body":"hi"},"expect":"E_RULE","label":"a third party cannot write in the thread"}
{"as":"bob","op":"answer","args":{"offer":"$o","accept":true},"expect":"NOT_SELLER"}
```

## Booking: seats without double booking

Bookings are private to their guest; occupancy is public. `taken` counts
every booking per slot whatever its reader, so anyone can see how full a
slot is without seeing who booked it. `book` checks in the order a guest
should hear: the duplicate first, then the seat count; `unique … else
ALREADY_BOOKED` and `cap 50 by slot` stay as the server's backstop for two
guests racing for the last seat. A seat is a server decision: `book` reads
the online count, so it never predicts, and offline it queues and may come
back `FULL`.

```quarry
use personas alice, bob, carol

table slots:
  host: principal
  startsAt: time
  seats: int
  immutable host
  public 'the timetable and its occupancy are public'
  insert <- .host = viewer
  update <- .host = viewer
  delete <- .host = viewer
  sync public last 500 by .startsAt

table bookings:
  slot: slots on delete restrict         -- a slot with seats taken is not deleted (the default, declared)
  guest: principal
  at: time default now
  unique slot, guest else ALREADY_BOOKED 'You already hold a seat.'
  cap 50 by slot                         -- the hard ceiling for every slot
  immutable slot, guest
  read <- .guest = viewer
  insert <- .guest = viewer
  delete <- .guest = viewer
  sync last 100 by .at

view taken: count bookings by .slot      -- public occupancy over private bookings
  read <- allow

query timetable(c: cursor ?):
  return slots where .startsAt >= now first 50 by .startsAt after c { id, startsAt, seats, taken: taken[.id] }

query myBookings(c: cursor ?):
  return bookings where .guest = viewer last 20 by .at after c { id, slot: slots[.slot] }

mutation addSlot(startsAt: time, seats: int):
  require seats >= 1 and seats <= 50 else BAD_SEATS
  return insert slots { host: viewer, startsAt, seats }

mutation book(slot: slots):
  s = slots[slot] ! else NOT_FOUND
  require not exists bookings[slot, viewer] else ALREADY_BOOKED
  require taken[slot] < s.seats else FULL 'This slot is full.'
  return insert bookings { slot, guest: viewer }

mutation cancel(booking: bookings):
  delete bookings[booking]

mutation removeSlot(slot: slots):
  s = slots[slot] ! else NOT_FOUND
  require s.host = viewer else NOT_HOST
  require taken[slot] = 0 else HAS_BOOKINGS 'Guests hold seats; they cancel first.'
  delete slots[slot]
```

`slot: slots on delete restrict` refuses a slot's delete while a booking
names it (E_REFERENCED); `on delete cascade` would cancel the guests'
bookings instead (`guide writes`). `removeSlot` checks first, by the public
count, to answer with its own code: `require not exists bookings[slot = slot]`
is refused (E_STRUCTURAL_FANOUT) because the host cannot read the guests'
bookings, and a count is the one fact about them the host may see.

Cases (with a one-seat slot `s1`, hosted by alice, in the slots fixture):

```jsonl
{"as":"bob","op":"book","args":{"slot":"s1"},"save":"b"}
{"as":"bob","op":"book","args":{"slot":"s1"},"expect":"ALREADY_BOOKED","label":"the duplicate answers first"}
{"as":"carol","op":"book","args":{"slot":"s1"},"expect":"FULL"}
{"as":"bob","op":"cancel","args":{"booking":"$b"}}
{"as":"carol","op":"book","args":{"slot":"s1"}}
{"as":"alice","op":"removeSlot","args":{"slot":"s1"},"expect":"HAS_BOOKINGS","label":"alice hosts s1; carol still holds its seat"}
```

## Deleting: cascade, restrict, set null, keep

```quarry
table projects:
  owner: principal
  read <- .owner = viewer
  delete <- .owner = viewer
table tasks:
  project: projects on delete cascade   -- deleted with it; needs a cap
  cap 500 by project
  read <- allow
table comments:
  task: tasks on delete restrict        -- the default: refuses E_REFERENCED
  read <- allow
mutation dropProject(id: projects):
  delete projects[id]                   -- its tasks too, unless a comment names one
```

`set null` clears an optional reference no rule reads; `keep` leaves rows naming the deleted one (the 0.4 meaning, N_DELETE_RESTRICTED). The parent's delete authorizes the cascade and reserves its worst case (E_CASCADE_BOUND); its deleter must read the row (N_DELETE_NEEDS_READ). Others can hold your row under restrict, so their likes and RSVPs should cascade. Expiry fires nothing.

## Schedules: close at a time, remind ahead, catch up

Prefer comparing with `now` where the decision is made: `rsvp` refuses
`STARTED` once an event has begun, with no job at all. Use a schedule for
work nobody calls: `remindHosts` writes tomorrow's reminders at 06:00 UTC,
and `closeStarted` flips a stored flag for screens that list it. Jobs run as
the system and sweep one table each; the sweep's order column must be the id
or immutable (`startsAt` here).

```quarry
use personas alice, bob

table events:
  host: principal
  title: text 1..120
  startsAt: time
  closed: bool default false
  immutable host, startsAt
  public 'the event list is public'
  insert <- .host = viewer
  online only

table rsvps:
  event: events
  guest: principal
  unique event, guest else ALREADY_GOING
  immutable event, guest
  read <- .guest = viewer
  insert <- .guest = viewer
  delete <- .guest = viewer
  online only

table reminders:
  to: principal
  event: events
  at: time
  read <- .to = viewer
  sync to .to last 50 by .at

query upcoming(c: cursor ?):
  return events where .startsAt >= now first 20 by .startsAt after c

mutation host(title: text 1..120, startsAt: time):
  require startsAt > now else IN_THE_PAST
  return insert events { host: viewer, title, startsAt }

mutation rsvp(event: events):
  e = events[event] ! else NOT_FOUND
  require e.startsAt > now else STARTED
  return insert rsvps { event, guest: viewer }

job remindHosts(periodStart: time, periodEnd: time):
  for e in events where .startsAt >= periodEnd and .startsAt < periodEnd + 1d by .startsAt:
    insert reminders { to: e.host, event: e.id, at: periodEnd }

job closeStarted(periodStart: time, periodEnd: time):
  for e in events where .startsAt >= periodEnd - 7d and .startsAt < periodEnd by .startsAt:
    if not e.closed:
      update events[e.id] { closed: true }

schedule daily every 1d at 06:00: remindHosts
schedule closer every 5m: closeStarted
```

A schedule fires once per boundary of the server's clock, and boundaries it
missed (the server was down, or `clock advance` jumped past them) coalesce
into one run for the latest period only. So a sweep over exactly
`[periodStart, periodEnd)` skips rows that fell due in the missed periods;
`closeStarted` looks back seven days from `periodEnd` and skips rows already
closed, so one run catches up. Test with a running `dev`: `snapback4 clock
advance 3h` reports `fired`, the period and `skippedPeriods` for each
schedule (`guide time`, `guide jobs`).
