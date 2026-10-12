// @ref LLP 3000.036.000#2.4 — the recipes every E_SYNC union rewrite points to.
//! The sharing card. Quarry examples are compiled by tests/guide.rs.
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
  sync last 200 by .at
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
team keeps the tasks the leaver owns. A union window (`last N by .at`) keeps
the newest N rows of each branch's own group: the owner's newest N, and each
held team's newest N; a page is complete on the device when it reads one
branch's window (`tasks where .owner = viewer last 50 by .at`, or `.team =
team` for a held team); other pages ask the server. A union window is
written as columns, never a named index.

Refused on a union, each with a rewrite: a `public` branch (a public table
and a private one, moving a row when it is shared), two group audiences
(give the second group's readers rows in the first group's membership),
`retain delivered-history`, a `read through` child (copy the branch
columns onto the child and check them in its insert rule), a synced view or
row-keyed view over it (make the view `online only`), a timeline, private
`written by` fields, and a membership table with `expire at`. Adding or
removing a branch is a new backend version: devices drop the table's rows
and acquire them again before they answer offline.

`online only` still takes any rule as written: queries answer from the
server (offline, the last server answer or `E_OFFLINE`), and mutations
never predict (offline they queue).

### An owner or a team

The example above. A task's owner reads it in any team; a teammate reads every
task of the team. `myTasks` reads the owner's window, and a page of a held
team (`tasks where .team = team last 50 by .at`) reads the team's window, so
both answer offline. Online, the server answers the team page
`complete: false` (`N_NEVER_COMPLETE`: it decides a page only from a branch
that reads no column of the row). A child that both read carries both
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
  sync last 200 by .at

table steps:
  task: tasks
  owner: principal
  team: teams
  label: text <=100
  at: time
  immutable task, owner, team
  read <- .owner = viewer or exists members[.team, viewer]
  insert <- .owner = .task.owner and .team = .task.team and (.owner = viewer or exists members[.team, viewer])
  sync last 500 by .at

mutation newTeam(name: text <=80):
  t = insert teams { name }
  insert members { team: t.id, principal: viewer }
  return t

mutation addTask(team: teams, title: text <=200):
  return insert tasks { owner: viewer, team, title, at: now }

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
  sync last 500 by .at

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
requests they filed themselves. `queue` reads the staff window and `mine`
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
  sync last 1000 by .at

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
