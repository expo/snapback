// @ref LLP 3000.036.000#2.4 — the recipes every E_SYNC union rewrite points to.
//! The sharing card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Sharing: rows more than one kind of reader holds

**Start here:** A synced row reaches exactly the readers its read rule names, so a row shared by an owner, a team, two parties or staff needs one membership that names every reader.

```quarry
table staff:
  principal: principal
  name: text <=80
  unique principal
  cap 500
  read <- exists staff[viewer]
  insert <- exists staff[viewer]
  delete <- exists staff[viewer]
  sync

table announcements:
  author: principal
  body: text <=500
  at: time
  read <- exists staff[viewer]
  insert <- .author = viewer and exists staff[viewer]
  sync last 200 by .at
```

- `online only` is the first answer to a rule with several readers: the rule stays as written, queries answer from the server and mutations never predict (offline they queue). Never make private rows public to enable sync.
- `E_SYNC`: a read rule joining two audiences with `or`, or a membership insert branch that proves no grant; the rewrite prints the recipe below against your tables.

## Reference

A synced table's read rule must be exactly one audience: `public`, one
`.column = viewer`, or one `exists members[.group..., viewer]` probe. A rule
naming two kinds of reader (an owner or staff, a buyer or a seller, anyone who
joins) leaves two choices:

1. **Keep the rule and write `online only` instead of `sync`.** Any rule works
   as written. The cost is offline: the rows never reach a device, so queries
   over the table answer from the server (offline, the last server answer or
   `E_OFFLINE`), and mutations that read or write it never predict; offline
   they queue, and the server accepts or refuses them on reconnect. Start
   here for staff consoles, admin screens and apps that are online anyway.
2. **Give each table one audience** to keep every reader's rows offline: the
   recipes after the online one.

Sync does not deliver unions: a device would have to keep a row while any one
of its audiences still grants it, through owner changes, group moves and
leaves. A members row read under `.principal = viewer or exists
members[.group, viewer]` is its own witness, so that rule syncs as the probe
alone.

### Online: any rule, as written

**A staff console, online.** When the app is online, one table can say
`.tenant = viewer or exists staff[viewer]`. A staff member's page is decided
once by the grant and answers `complete: true`, as long as each staff member
can read their own `staff` row; start the console query with the same
`require`, and a staff-only mutation can walk every row of a group the same
way (`: server` alone does not lift a page the rule does not decide). Tenants
pin their own column. Sync does not deliver this union: offline needs the
tables below. `guide recipes --section roles` adds admins who grant roles.

```quarry
table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only

table tickets:
  tenant: principal
  title: text <=200
  done: bool
  at: time
  read <- .tenant = viewer or exists staff[viewer]
  insert <- .tenant = viewer
  update <- exists staff[viewer]
  online only

query queue(c: cursor ?):
  require exists staff[viewer] else NOT_STAFF
  return tickets where not .done last 50 by .at after c

query mine(c: cursor ?):
  return tickets where .tenant = viewer last 50 by .at after c

mutation closeAllFor(tenant: principal):
  require exists staff[viewer] else NOT_STAFF
  for t in tickets where .tenant = tenant first 100 by .id:
    update tickets[t] { done: true }
```

### An org roster

**An org roster.** A membership table with no group key is one group: the
read rule `exists staff[viewer]` infers `sync`, and every member's device holds
the roster and every table read under it. A caller already in the roster may
add others (`insert <- exists staff[viewer]`); the first member comes from a
fixture, `/seed`, or a job writing as the system. Use this instead of a
singleton team row.

```quarry
table staff:
  principal: principal
  name: text <=80
  unique principal
  cap 500
  read <- exists staff[viewer]
  insert <- exists staff[viewer]
  delete <- exists staff[viewer]
  sync

table announcements:
  author: principal
  body: text <=500
  at: time
  read <- exists staff[viewer]
  insert <- .author = viewer and exists staff[viewer]
  sync last 200 by .at

mutation addStaff(who: principal, name: text <=80):
  return insert staff { principal: who, name } if absent

mutation announce(body: text <=500):
  return insert announcements { author: viewer, body, at: now }

query recent(c: cursor ?):
  return announcements last 20 by .at after c
```

### A team the owner manages

**A team the owner manages, and children of the team.** Each member row
grants its principal every row of its team, so every insert branch of
`teamMembers` must prove the caller already holds that grant (`exists
teamMembers[.team, viewer]`), or that this mutation created the team
(`created teams[.team]`). Ownership of the parent row is not membership:
conjoin the probe, as the second branch does. The owner's own member row is
written by the creating mutation and checked by `after insert`, so the owner
reads through the same membership as everyone else. A child table carries
the group key inline when it is cheap to copy: `comments` stores `team`,
`immutable` and checked against its task in the insert rule, and syncs like
any team table. `checks` instead reads one hop away (`.task.team`), which
means `read through .task`: it needs no copied column, and its window is
written as columns (`last 500 by .at`), with the inherited group first. A
named horizon index on a hopped audience orders the window inside each group,
in that index's column order.

```quarry
table teams:
  owner: principal
  name: text <=80
  read <- exists teamMembers[.id, viewer]
  insert <- .owner = viewer
  after insert <- exists teamMembers[team = .id, principal = .owner]
  sync

table teamMembers:
  team: teams
  principal: principal
  unique team, principal
  immutable team, principal
  cap 200 by team
  read <- exists teamMembers[.team, viewer]
  insert <- created teams[.team] or (exists teams[.team, owner = viewer] and exists teamMembers[.team, viewer])
  delete <- .principal = viewer or exists teams[.team, owner = viewer]
  sync

table tasks:
  team: teams
  title: text <=200
  at: time
  immutable team
  read <- exists teamMembers[.team, viewer]
  insert <- exists teamMembers[.team, viewer]
  sync last 500 by .at

table comments:
  task: tasks
  team: teams
  body: text <=1000
  at: time
  immutable task, team
  read <- exists teamMembers[.team, viewer]
  insert <- .team = .task.team and exists teamMembers[.team, viewer]
  sync last 1000 by .at

table checks:
  task: tasks
  label: text <=100
  at: time
  immutable task
  read <- exists teamMembers[.task.team, viewer]
  insert <- exists teamMembers[.task.team, viewer]
  sync last 500 by .at

mutation createTeam(name: text <=80):
  t = insert teams { owner: viewer, name }
  insert teamMembers { team: t.id, principal: viewer }
  return t

mutation invite(team: teams, who: principal):
  return insert teamMembers { team, principal: who } if absent

mutation comment(task: tasks, body: text <=1000):
  t = tasks[task] ! else NOT_FOUND
  return insert comments { task, team: t.team, body, at: now }

query teamComments(team: teams, c: cursor ?):
  return comments where .team = team last 50 by .at after c
```

### A group's private list, complete

**A list only a group's members read (a household's charges, a tenant's
records).** A child read under `exists residents[.household, viewer]` pages
`complete` when the scan pins `.household`: take the group as an argument
(`charges`), or, when each person belongs to one group, bind the caller's
own membership first and pin it (`myCharges`). A scan that leaves the group
free, `charges where exists residents[.household, viewer]`, is never
complete (`N_NEVER_COMPLETE`): the server cannot tell "no more" from "more
in households you are not in". The creating mutation writes the founder's
member row (`created households[.household]`, checked by `after insert`);
members add members. A clash on `unique principal` against another
household's hidden row refuses `E_RULE`. These tables are `online only`;
to hold them offline, give each `sync` as the team above does.

```quarry
use personas alice, bob, carol, dave

table households:
  name: text 1..80
  read <- exists residents[.id, viewer]
  insert <- allow
  after insert <- exists residents[.id, viewer]
  online only

table residents:
  household: households
  principal: principal
  unique household, principal
  unique principal
  immutable household, principal
  read <- .principal = viewer or exists residents[.household, viewer]
  insert <- created households[.household] or exists residents[.household, viewer]
  online only

table charges:
  household: households
  payer: principal
  label: text 1..120
  cents: int
  at: time default now
  immutable household, payer
  read <- exists residents[.household, viewer]
  insert <- .payer = viewer and exists residents[.household, viewer]
  online only

query charges(household: households, c: cursor ?):
  return charges where .household = household last 50 by .at after c

query myCharges(c: cursor ?):
  me = residents[principal = viewer]
  if me != null:
    return charges where .household = me.household last 50 by .at after c
  return []

mutation createHousehold(name: text 1..80):
  h = insert households { name }
  insert residents { household: h.id, principal: viewer }
  return h

mutation invite(household: households, who: principal):
  require exists residents[household, viewer] else NOT_RESIDENT
  return insert residents { household, principal: who }

mutation addCharge(household: households, label: text 1..120, cents: int):
  require exists residents[household, viewer] else NOT_RESIDENT
  return insert charges { household, payer: viewer, label, cents }
```

Cases (alice and bob in household `h1`, which has one charge; carol in `h2`):

```jsonl
{"as":"bob","op":"myCharges","expect":"complete","count":1}
{"as":"carol","op":"charges","args":{"household":"h1"},"expect":"complete","count":0,"label":"another household's list is empty, not partial"}
{"as":"carol","op":"addCharge","args":{"household":"h1","label":"x","cents":1},"expect":"NOT_RESIDENT"}
{"as":"dave","op":"createHousehold","args":{"name":"Ash"},"save":"ash"}
{"as":"dave","op":"invite","args":{"household":"$ash","who":"dev:carol"},"expect":"E_RULE","label":"carol already lives elsewhere"}
```

### Two parties

**Two parties (buyer and seller).** `.buyer = viewer or .seller = viewer` is
two audiences. Give the row a parties table with one row per reader and read
through it; both parties' devices hold the order, and each can predict writes
to it. The creating mutation is the only one that may add parties here
(`created orders[.orderId]`); an owner sharing with others is the team recipe
above with one group per item.

```quarry
table orders:
  buyer: principal
  seller: principal
  item: text <=200
  at: time
  read <- exists orderParties[.id, viewer]
  insert <- .buyer = viewer
  after insert <- exists orderParties[orderId = .id, party = .buyer]
  after insert <- exists orderParties[orderId = .id, party = .seller]
  sync

table orderParties:
  orderId: orders
  party: principal
  unique orderId, party
  immutable orderId, party
  cap 2 by orderId
  read <- exists orderParties[.orderId, viewer]
  insert <- created orders[.orderId]
  sync

mutation placeOrder(seller: principal, item: text <=200):
  o = insert orders { buyer: viewer, seller, item, at: now }
  insert orderParties { orderId: o.id, party: viewer }
  insert orderParties { orderId: o.id, party: seller }
  return o
```

### An owner plus staff, offline

**An owner plus staff.** `.tenant = viewer or exists staff[viewer]` is a
private audience plus a role; every staff device holding every tenant's rows
is a union this release does not sync. Keep one table per audience and let
the mutations write across: the tenant's `requests`, the staff `desk` (the
org roster's audience), and `updates` the staff write into the tenant's
partition. Writes need no read of the other audience's rows, so both sides
work offline. When one staff member handles a request, the two-party recipe
with the assignee as a party is smaller.

```quarry
table staff:
  principal: principal
  unique principal
  cap 100
  read <- exists staff[viewer]
  insert <- exists staff[viewer]
  sync

table requests:
  tenant: principal
  title: text <=200
  at: time
  read <- .tenant = viewer
  insert <- .tenant = viewer
  sync last 200 by .at

table desk:
  request: id
  tenant: principal
  title: text <=200
  status: enum('open', 'doing', 'done')
  at: time
  unique request
  read <- exists staff[viewer]
  insert <- .tenant = viewer
  update <- exists staff[viewer]
  sync last 1000 by .at

table updates:
  request: id
  tenant: principal
  status: enum('open', 'doing', 'done')
  at: time
  read <- .tenant = viewer
  insert <- exists staff[viewer]
  sync last 500 by .at

mutation file(title: text <=200):
  r = insert requests { tenant: viewer, title, at: now }
  insert desk { request: r.id, tenant: viewer, title, status: 'open', at: now }
  return r

mutation setStatus(request: id, status: enum('open', 'doing', 'done')):
  d = desk[request] ! else NOT_FOUND
  update desk[d] { status }
  insert updates { request, tenant: d.tenant, status, at: now }
  return null
```


### Anyone may join (open groups)

**Open groups.** A membership anyone may insert for themselves
(`insert <- .member = viewer`) cannot grant a private synced audience: `E_SYNC`
refuses it, since joining would be the only check on reading. If anyone may
join, anyone may read, so say so: the group's rows are `public`, synced as a
public window, and membership gates writing. Each device holds its own joins
and the latest posts of every group, and filters a group's page in the client
(a server query may filter by group).

```quarry
table clubs:
  founder: principal
  name: text 1..80
  immutable founder
  public 'anyone may browse and join a club'
  insert <- .founder = viewer
  sync public last 200 by .id

table joins:
  club: clubs
  member: principal
  unique club, member
  immutable club, member
  cap 500 by club
  read <- .member = viewer
  insert <- .member = viewer
  delete <- .member = viewer
  sync

table posts:
  club: clubs
  author: principal
  body: text 1..500
  at: time
  immutable club, author
  public 'anyone may join, so a post is as public as its club'
  insert <- .author = viewer and exists joins[.club, viewer]
  sync public last 500 by .at

mutation join(club: clubs):
  return insert joins { club, member: viewer } if absent

mutation leave(club: clubs):
  delete joins[club = club, member = viewer]

mutation post(club: clubs, body: text 1..500):
  return insert posts { club, author: viewer, body, at: now }

query myClubs(c: cursor ?):
  return joins where .member = viewer first 50 by .id after c { club: clubs[.club] }

query latest(c: cursor ?):
  return posts last 50 by .at after c
```

When a group's rows must stay private to its members yet anyone may join,
keep the membership rule and make the tables `online only`:

```quarry
table clubs:
  founder: principal
  name: text 1..80
  immutable founder
  public 'anyone may browse and join a club'
  insert <- .founder = viewer
  sync public last 200 by .id

table joins:
  club: clubs
  member: principal
  unique club, member
  immutable club, member
  read <- .member = viewer or exists joins[.club, viewer]
  insert <- .member = viewer
  delete <- .member = viewer
  online only

table notices:
  club: clubs
  author: principal
  body: text 1..500
  at: time
  immutable club, author
  read <- exists joins[.club, viewer]
  insert <- .author = viewer and exists joins[.club, viewer]
  online only

mutation join(club: clubs):
  return insert joins { club, member: viewer } if absent

mutation notice(club: clubs, body: text 1..500):
  return insert notices { club, author: viewer, body, at: now }

query clubNotices(club: clubs, c: cursor ?):
  return notices where .club = club last 20 by .at after c
```
"##;
