// @ref LLP 3000.036.000#2.4 — the recipes every E_SYNC union rewrite points to.
// @ref LLP 3000.036.000.000#2.1 — the union recipes the E_SYNC rewrites point to.
//! The sharing card. Quarry examples are compiled by tests/guide.rs.
pub(super) const CARD: &str = r##"# Sharing: rows more than one kind of reader holds

**Start here:** A row read by its owner or its team, a buyer or a seller, or an owner or staff syncs to the union of those readers, and each device holds every row any of them admits.

```quarry
table teams:
  name: text <=80
  read <- exists members[.id, viewer]
  insert <- allow
  sync

table members:
  team: teams
  principal: principal
  unique team, principal
  immutable team, principal
  cap 200 by team
  read <- exists members[.team, viewer]
  insert <- created teams[.team] or exists members[.team, viewer]
  delete <- .principal = viewer
  sync

table tasks:
  owner: principal
  team: teams
  title: text <=200
  at: time
  read <- .owner = viewer or exists members[.team, viewer]
  insert <- .owner = viewer and exists members[.team, viewer]
  update <- .owner = viewer
  cap 200
  sync
```

- `sync` infers the union from the read rule; `sync to .owner or members[.team]` spells it. Each `or` branch is one whole audience: `.column = viewer` or one `exists group[.columns, viewer]`.
- `E_SYNC`: a branch with an extra condition, two group audiences, or a membership insert that proves no grant; the rewrite names the edit. Never make private rows public to enable sync.

## Reference

A synced table's read rule is one audience (`public`, `.column = viewer`,
`exists members[.group..., viewer]`) or a **union**: an `or` of any number of
`.column = viewer` branches (each a required `principal` column) and at most
one `exists members[.group..., viewer]` branch, which keeps every rule of a
group audience (a unique group and principal key, and an insert rule that
proves the caller's grant). A device holds a row while any branch admits its
viewer: giving a task away keeps it on a teammate's device, and leaving the
team keeps the tasks the leaver owns. Each device replicates every readable
row; pages and lookups run offline over that full replica. The examples use
whole-table caps to bound their populations; a cap refuses further inserts
at the declared limit. Union acquisition windows and expiry are refused.

Refused on a union, each with a rewrite: a `public` branch (a public table
and a private one, moving a row when it is shared), two group audiences
(give the second group's readers rows in the first group's membership),
`retain delivered-history`, a `read through` child (copy the branch
columns onto the child and check them in its insert rule), a row-keyed view
over it (a `view` over a union inherits no audience: the server answers
it), a timeline, private
`written by` fields, `last N by ...` on the union or its direct/inherited
membership scopes, and direct/inherited `expire at` on content or membership
scopes. Use `online only` to preserve the read rule, expiry and queries; or
remove only the sync window to replicate every readable row. Adding or
removing a branch is a new backend version: devices drop the table's rows
and acquire them again before they answer offline.

`online only` still takes any rule as written: queries answer from the
server (offline, the last server answer or `E_OFFLINE`), and mutations
never predict (offline they queue).

### An owner or a team

The example above. A task's owner reads it in any team; a teammate reads every
task of the team. `myTasks` reads the owner's rows, and a page of a held
team (`tasks where .team = team last 50 by .at`) reads the team's rows;
both answer offline from the full replica. Online, pinning `.team` decides
the membership grant for the page, so a held-team page is complete too. A child that both read carries both
branches' columns, copied from its task and checked by the insert rule:

```quarry
table teams:
  name: text <=80
  read <- exists members[.id, viewer]
  insert <- allow
  sync

table members:
  team: teams
  principal: principal
  unique team, principal
  immutable team, principal
  cap 200 by team
  read <- exists members[.team, viewer]
  insert <- created teams[.team] or exists members[.team, viewer]
  delete <- .principal = viewer
  sync

table tasks:
  owner: principal
  team: teams
  title: text <=200
  at: time
  read <- .owner = viewer or exists members[.team, viewer]
  insert <- .owner = viewer and exists members[.team, viewer]
  update <- .owner = viewer
  delete <- .owner = viewer
  cap 200
  sync

table steps:
  task: tasks
  owner: principal
  team: teams
  label: text <=100
  at: time
  immutable task, owner, team
  read <- .owner = viewer or exists members[.team, viewer]
  insert <- .owner = .task.owner and .team = .task.team and (.owner = viewer or exists members[.team, viewer])
  cap 500
  sync

mutation newTeam(name: text <=80):
  t = insert teams { name }
  insert members { team: t.id, principal: viewer }
  return t

mutation addTask(team: teams, title: text <=200):
  parent = teams[team] ! else NOT_FOUND
  return insert tasks { owner: viewer, team: parent.id, title, at: now }

mutation give(task: tasks, to: principal):
  t = tasks[task] ! else NOT_FOUND
  update tasks[t] { owner: to }
  return null

mutation addStep(task: tasks, label: text <=100):
  t = tasks[task] ! else NOT_FOUND
  return insert steps { task, owner: t.owner, team: t.team, label, at: now }

query myTasks(c: cursor ?):
  return tasks where .owner = viewer last 50 by .at after c
```

### Two parties

**A buyer and a seller.** `.buyer = viewer or .seller = viewer` syncs to both;
each party's device holds the order and can predict writes to it, and a
change of buyer moves the order to the new buyer's device and keeps it on the
seller's.

```quarry
table orders:
  buyer: principal
  seller: principal
  item: text <=200
  status: enum('open', 'paid', 'shipped') default 'open'
  at: time
  read <- .buyer = viewer or .seller = viewer
  insert <- .buyer = viewer
  update <- .seller = viewer
  cap 500
  sync

mutation placeOrder(seller: principal, item: text <=200):
  return insert orders { buyer: viewer, seller, item, at: now }

mutation ship(order: orders):
  o = orders[order] ! else NOT_FOUND
  update orders[o] { status: 'shipped' }
  return null

query purchases(c: cursor ?):
  return orders where .buyer = viewer last 50 by .at after c

query sales(c: cursor ?):
  return orders where .seller = viewer last 50 by .at after c
```

### An owner plus staff

**A tenant and the staff.** `.tenant = viewer or exists staff[viewer]` is a
tenant branch and a roster branch (a membership with no group key is one
group, below). Every staff device holds every request, a tenant's device
holds its own, and a staff member who leaves the roster keeps only the
requests they filed themselves. `queue` reads staff-visible rows and `mine`
the tenant's, so both answer offline; the grant decides `queue` for staff on
the server too.

```quarry
table staff:
  principal: principal
  unique principal
  cap 100
  read <- exists staff[viewer]
  insert <- exists staff[viewer]
  delete <- .principal = viewer
  sync

table requests:
  tenant: principal
  title: text <=200
  done: bool default false
  at: time
  read <- .tenant = viewer or exists staff[viewer]
  insert <- .tenant = viewer
  update <- exists staff[viewer]
  cap 1000
  sync

mutation file(title: text <=200):
  return insert requests { tenant: viewer, title, at: now }

mutation close(request: requests):
  require exists staff[viewer] else NOT_STAFF
  update requests[request] { done: true }
  return null

query queue(c: cursor ?):
  require exists staff[viewer] else NOT_STAFF
  return requests last 50 by .at after c

query mine(c: cursor ?):
  return requests where .tenant = viewer last 50 by .at after c
```

### Online: any rule, as written

**A staff console, online.** When the app is online, one table can say
`.tenant = viewer or exists staff[viewer]`. One query serves both: a staff
member's page is decided once by the grant (as long as each staff member can
read their own `staff` row), a tenant's is their own range, and both answer
`complete: true`. A staff-only mutation can walk every row of a group after
`require` of the grant (`: server` alone does not lift a page the rule does
not decide). To hold the union offline, use the synced staff roster and
union in the preceding recipe. `guide recipes --section roles` adds admins who grant roles.

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

query open(c: cursor ?):
  return tickets where not .done last 50 by .at after c

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
  parent = teams[team] ! else NOT_FOUND
  return insert teamMembers { team: parent.id, principal: who } if absent

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
  parent = households[household] ! else NOT_FOUND
  require exists residents[household, viewer] else NOT_RESIDENT
  return insert residents { household: parent.id, principal: who }

mutation addCharge(household: households, label: text 1..120, cents: int):
  parent = households[household] ! else NOT_FOUND
  require exists residents[household, viewer] else NOT_RESIDENT
  return insert charges { household: parent.id, payer: viewer, label, cents }
```

Cases (alice and bob in household `h1`, which has one charge; carol in `h2`):

```jsonl
{"as":"bob","op":"myCharges","expect":"complete","count":1}
{"as":"carol","op":"charges","args":{"household":"h1"},"expect":"complete","count":0,"label":"another household's list is empty, not partial"}
{"as":"carol","op":"addCharge","args":{"household":"h1","label":"x","cents":1},"expect":"NOT_RESIDENT"}
{"as":"dave","op":"createHousehold","args":{"name":"Ash"},"save":"ash"}
{"as":"dave","op":"invite","args":{"household":"$ash","who":"dev:carol"},"expect":"E_RULE","label":"carol already lives elsewhere"}
```

### An explicit parties table

**Two parties (buyer and seller), with explicit membership.** `.buyer = viewer or .seller = viewer` is
two audiences. Online, keep the rule: `orders last 50 by .at after c` is one
complete query (guide indexes, "Private lists"). As an alternative to a union
offline, give the row a parties table with one row per reader and read through
it; both parties' devices hold the order, and each can predict writes to it.
The creating mutation is the only one that may add parties here
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

### Separate tables for tenant and staff

**An owner plus staff, with separate tables.** Instead of sharing one
union table, keep one table per audience when the two sides need different
fields or workflows, and let the mutations write across: the tenant's `requests`, the staff `desk` (the
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


### Production roster bootstrap

A whole `viewer = 'service:ops'` insert/update branch may grant membership on
the server; it adds no device audience. Use `guide deploy --section first admin`
for the compiled synced-roster mutation and token commands. Every ordinary
branch still needs prior membership or a group created by the mutation.

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
  parent = clubs[club] ! else NOT_FOUND
  return insert joins { club: parent.id, member: viewer } if absent

mutation leave(club: clubs):
  delete joins[club = club, member = viewer]

mutation post(club: clubs, body: text 1..500):
  parent = clubs[club] ! else NOT_FOUND
  return insert posts { club: parent.id, author: viewer, body, at: now }

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
  parent = clubs[club] ! else NOT_FOUND
  return insert joins { club: parent.id, member: viewer } if absent

mutation notice(club: clubs, body: text 1..500):
  parent = clubs[club] ! else NOT_FOUND
  return insert notices { club: parent.id, author: viewer, body, at: now }

query clubNotices(club: clubs, c: cursor ?):
  return notices where .club = club last 20 by .at after c
```
"##;
