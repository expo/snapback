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

- `E_SYNC`: a read rule joining two audiences with `or`, or a membership insert branch that proves no grant; the rewrite prints the recipe below against your tables.
- `online only` keeps any rule as written, without offline reads or prediction; never make private rows public to enable sync.

## Reference

A synced table's read rule must be exactly one audience: `public`, one
`.column = viewer`, or one `exists members[.group..., viewer]` probe. Two
readers joined by `or` are a union of two audiences. Sync does not deliver
unions: a device would have to keep a row while any one of its audiences
still grants it, through owner changes, group moves and leaves. These
recipes keep every reader offline with one audience per table. A members
row read under `.principal = viewer or exists members[.group, viewer]` is its
own witness, so that rule syncs as the probe alone.

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
"##;
