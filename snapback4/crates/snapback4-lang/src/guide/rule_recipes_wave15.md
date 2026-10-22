
## Totals over the caller's readable rows

`guide rule-recipes readable-totals` pins the owner that decides the whole
source rule. Hidden rows never enter this caller's count or sum. A shared
total is a separate disclosure decision (`guide totals`); do not remove the
owner pin to make a capacity check over private rows.

```quarry
use personas alice, bob, carol
table personalCosts:
  owner: principal
  cents: int 0..1000000
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation addPersonalCost(cents: int 0..1000000):
  return insert personalCosts { owner: viewer, cents }
query readableTotals():
  return { n: count(personalCosts where .owner = viewer), cents: sum(personalCosts where .owner = viewer, .cents) }
```

These online totals cover the complete authorized domain or return unavailable
at a meter cut. They never return a partial number. For an arbitrary mixture
of partly readable rows, page the rows and label a sum of that page as a page
subtotal, or materialize a separately authorized view.

## Presence-gated durable writes with disconnect grace

`guide rule-recipes presence-write` requires an enrolled peer and the server's
`connected` verdict before recording a durable handoff. Presence belongs in
the mutation, since table rules cannot read it. Durable rules independently
restrict the writer and recipient. This is a server decision: the mutation
queues offline and predicts no handoff. Ephemeral room indicators cannot
authorize durable writes (`guide ephemeral`).

```quarry
use personas alice, bob, carol
table handoffPeers:
  principal: principal
  unique principal
  read <- .principal = viewer or viewer = 'service:ops'
  insert <- viewer = 'service:ops'
  online only
table durableHandoffs:
  sender: principal
  recipient: principal
  body: text 1..200
  immutable sender, recipient, body
  read <- .sender = viewer or .recipient = viewer
  insert <- .sender = viewer and exists handoffPeers[.recipient]
  online only
mutation enrollHandoffPeer(principal: principal):
  require viewer = 'service:ops' else OPERATOR_ONLY
  return insert handoffPeers { principal }
mutation handoff(recipient: principal, body: text 1..200):
  require exists connected[recipient] else PEER_AWAY
  return insert durableHandoffs { sender: viewer, recipient, body }
query handoffs(c: cursor ?):
  return durableHandoffs where .sender = viewer first 20 by .id after c
query handoffInbox(c: cursor ?):
  return durableHandoffs where .recipient = viewer first 20 by .id after c
query handoffPresence(recipient: principal):
  return exists connected[recipient]
```

An operator enrolls recipients with a minted `service:ops` seat and
enrollHandoffPeer (`guide services`). Account signup alone grants no enrollment.
An open authenticated change poll counts as connected. After it ends, a
35-second grace bridges poll turnover and short disconnects. A handoff inside
that grace is intentionally accepted; after it expires it gets `PEER_AWAY`.
Reconnecting starts a new connected interval. Presence is a snapshot at the
server's decision, not an acknowledgement that a person saw the message, a
delivery guarantee, or a lock on their future connection. The row survives
disconnect and server restart. Use a recipient-written durable receipt for
acknowledgement. Test grace with `POST /dev/clock/advance` and
`{ "duration": "36s" }` after the peer's poll has ended.

## Scheduled publication, withdrawal and reapproval

`guide rule-recipes scheduled-reapproval` keeps editable drafts private and
copies the approved revision into an independent public table when due.
Editing or withdrawing atomically deletes the public copy and clears approval.
Reapproval is explicit, even for the same revision after withdrawal. The job
cannot republish a withdrawn revision. Scheduled runs coalesce; publication
happens at the next job run at or after publishAt, rather than at an exact
wall-clock instant (`guide jobs`).

```quarry
use personas alice, bob, carol
table scheduledDrafts:
  owner: principal
  body: text 1..200
  revision: int default 1
  approved: bool default false
  publishAt: time
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer and .approved = false
  update <- .owner = viewer
  online only
table scheduledPublications:
  draft: scheduledDrafts
  revision: int
  body: text 1..200
  unique draft
  immutable draft
  public 'approved revision bodies are public until withdrawal'
  delete <- exists scheduledDrafts[.draft, owner = viewer]
  online only
fn retractScheduled(draft: scheduledDrafts):
  p = scheduledPublications[draft = draft]
  if p != null:
    delete scheduledPublications[p.id]
mutation newScheduledDraft(body: text 1..200, publishAt: time):
  return insert scheduledDrafts { owner: viewer, body, publishAt }
mutation editScheduledDraft(draft: scheduledDrafts, body: text 1..200):
  d = scheduledDrafts[draft] ! else NOT_FOUND
  retractScheduled(draft)
  update scheduledDrafts[draft] { body, revision: d.revision + 1, approved: false }
mutation approveScheduledDraft(draft: scheduledDrafts, publishAt: time):
  retractScheduled(draft)
  update scheduledDrafts[draft] { approved: true, publishAt }
mutation withdrawScheduledDraft(draft: scheduledDrafts):
  update scheduledDrafts[draft] { approved: false }
  retractScheduled(draft)
job publishScheduledDrafts(periodStart: time, periodEnd: time):
  for d in scheduledDrafts:
    if d.approved and d.publishAt <= periodEnd:
      upsert scheduledPublications[draft = d.id] { draft: d.id, revision: d.revision, body: d.body }
schedule scheduledPublisher every 1m: publishScheduledDrafts
query scheduledPublication(draft: scheduledDrafts):
  return scheduledPublications[draft = draft]
query scheduledDraft(draft: scheduledDrafts):
  return scheduledDrafts[draft]
```

Only the system job inserts/updates publications; the owner may delete a copy.
The approved bit always describes the current draft revision because the only
editing mutation clears it in the same transaction. Add that invariant to every
future draft writer. Already downloaded public content cannot be recalled.

## Private bookings with public availability counts

`guide rule-recipes booking-counts` discloses occupancy while keeping names
private. A maintained view sees all bookings; a caller-filtered count would
miss other people's reservations and oversell. Its public count deliberately
reveals even one-person join/leave activity. It is not anonymity against timing
inference. Empty authorized groups contribute zero.

```quarry
use personas alice, bob, carol
table availabilitySlots:
  capacity: int 1..20
  immutable capacity
  public 'slot capacity and occupied count are public'
  online only
table privateBookings:
  slot: availabilitySlots
  principal: principal
  unique slot, principal else ALREADY_BOOKED
  immutable slot, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  delete <- .principal = viewer
  online only
view bookedCount: count privateBookings by .slot
  read <- allow
  disclosure reviewed 'public occupancy reveals reservation and cancellation deltas'
mutation reserveAvailable(slot: availabilitySlots):
  s = availabilitySlots[slot] ! else NOT_FOUND
  require bookedCount[slot] < s.capacity else SLOT_FULL
  return insert privateBookings { slot, principal: viewer }
mutation cancelAvailable(slot: availabilitySlots):
  delete privateBookings[slot, viewer]
query availability(slot: availabilitySlots):
  s = availabilitySlots[slot] ! else NOT_FOUND
  return { capacity: s.capacity, booked: bookedCount[slot], free: s.capacity - bookedCount[slot] }
query myBooking(slot: availabilitySlots):
  return privateBookings[slot, viewer]
```

Admission and insertion run in one writer transaction. Keep all booking writers
behind this capacity check, including future service paths. Capacity is
immutable so reducing it cannot silently invalidate existing bookings.

## Privacy-aware leaderboard

`guide rule-recipes private-leaderboard` publishes only an opted-in owner's
chosen display name and exact total. Attempts stay private. A maintained own
total includes every attempt; the only attempt writer refreshes an existing
public entry in the same transaction. Opting out deletes that entry. The
leaderboard cannot infer a nonparticipant's score by subtracting a global total.

```quarry
use personas alice, bob, carol
table privateAttempts:
  owner: principal
  points: int 0..100
  immutable owner, points
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
view ownAttemptTotal: sum privateAttempts of .points by .owner
  read <- .owner = viewer
table publicLeaders:
  owner: principal
  name: text 1..40
  points: int
  unique owner
  immutable owner
  public 'opted-in display names, principals, exact totals and rank are public'
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  online only
mutation recordAttempt(points: int 0..100):
  insert privateAttempts { owner: viewer, points }
  entry = publicLeaders[owner = viewer]
  if entry != null:
    update publicLeaders[entry.id] { points: ownAttemptTotal[viewer] }
mutation joinLeaderboard(name: text 1..40):
  return upsert publicLeaders[owner = viewer] { owner: viewer, name, points: ownAttemptTotal[viewer] }
mutation leaveLeaderboard():
  delete publicLeaders[owner = viewer]
query leaderboard(c: cursor ?):
  return publicLeaders last 20 by .points, .id after c { name, points }
query myAttemptTotal():
  return ownAttemptTotal[viewer]
```

This consent reveals score deltas and relative ordering, even in a small group;
principals remain public in the stored rows despite the query's projection.
Use a separate unlinked publication model if principal privacy is required.
Any future attempt edit/delete must refresh the public entry too. Never keep a
public aggregate over all private attempts as a shortcut.

## Mutable ancestor access across three levels

`guide rule-recipes three-level-live` uses one ordinary authority root at every
depth: project → folder → file. Folder and file each directly inherit the
project's whole live rule, with separate per-project product caps. The copied
project reference is immutable routing, not a copied mutable owner. The file
insert rule validates that its folder belongs to that project. Transferring the
project changes all existing folders and files atomically. No application
maintenance loop is required.

```quarry
use personas alice, bob, carol
table ancestorProjects:
  owner: principal
  read <- .owner = viewer or viewer = 'service:ops'
  update <- viewer = 'service:ops'
  online only
table ancestorFolders:
  project: ancestorProjects
  immutable project
  cap 5 by project
  read through live .project
  insert <- allow
  online only
table ancestorFiles:
  folder: ancestorFolders
  project: ancestorProjects
  body: text 1..100
  immutable folder, project
  cap 20 by project
  read through live .project
  insert <- exists ancestorFolders[.folder, project = .project]
  online only
mutation addAncestorFolder(project: ancestorProjects):
  return insert ancestorFolders { project }
mutation addAncestorFile(folder: ancestorFolders, body: text 1..100):
  f = ancestorFolders[folder] ! else NOT_FOUND
  return insert ancestorFiles { folder, project: f.project, body }
mutation transferAncestor(project: ancestorProjects, owner: principal):
  require viewer = 'service:ops' else OPERATOR_ONLY
  update ancestorProjects[project] { owner }
query ancestorFile(file: ancestorFiles):
  return ancestorFiles[file]
query ancestorFolder(folder: ancestorFolders):
  return ancestorFolders[folder]
```

LIVE's first form refuses chained `read through live .folder` when the folder
itself inherits a rule. Flatten the authority root as above when all levels
have identical readers. The 077 proposal workflow has additional per-section
owner grants; inheriting only its proposal would widen access. Its checks can
instead use `read through live .section`: the ordinary section's whole custom
rule includes a keyed probe of the current proposal state. This remains online;
the section itself must keep that custom rule rather than become a live child.
Keep copied routing keys still used by queries/writers and validate them on
insert. Bare captured `read through` cannot follow a mutable state flag. A mutable audience copy is
still appropriate for unsupported live compositions, such as timed parents,
or when the child intentionally has a different audience; maintain it
atomically through every parent writer (`current-roster`, Manual copy
alternative). An immutable audience copy instead preserves creation-time access.

The 085 hymn entries share their service's complete rule and can use
`read through live .service` online after removing the writing cascade action
from that endpoint; delete the capped entries explicitly before their service.
Its public-or-staff rule stays online. The full lane's cross-service hymnUsage
total still needs its existing explicit probe form: the planner cannot prove
that total uniform after direct LIVE conversion. A maintained view over the
live endpoint is also outside this first form's derivation boundary. Keeping
cascade semantics unchanged also requires the existing
explicit keyed probes. LIVE never silently
drops a reader branch or a reference action.

For the complete 085 app as written, keep its explicit probe rule. Converting
its entry authorization to LIVE requires both removing the cascade and
replacing the cross-service total with a separately designed read; changing
only the read rule does not convert the whole app.

For the distinct per-section policy, keep that policy on the ordinary middle
table. This reduced 077 form retains the owner's active-only access and the
partner's signed-package access, with no authored ancestor copy on the check:

```quarry
use personas alice, bob, carol
table policyStaff:
  principal: principal
  role: enum('owner', 'partner')
  unique principal
  read <- .principal = viewer
  online only
table policyProposals:
  state: enum('active', 'signed') default 'active'
  read <- exists policyStaff[viewer]
  update <- exists policyStaff[viewer, role = 'partner']
  online only
table policySections:
  proposal: policyProposals
  owner: principal
  immutable proposal, owner
  read <- (.owner = viewer or exists policyStaff[viewer, role = 'partner']) and (exists policyProposals[.proposal, state = 'active'] or exists policyStaff[viewer, role = 'partner'])
  online only
table policyChecks:
  section: policySections
  body: text 1..80
  immutable section
  cap 20 by section
  read through live .section
  insert <- exists policyStaff[viewer, role = 'partner']
  online only
mutation addPolicyCheck(section: policySections, body: text 1..80):
  return insert policyChecks { section, body }
mutation signPolicyProposal(proposal: policyProposals):
  update policyProposals[proposal] { state: 'signed' }
query policyCheck(check: policyChecks):
  return policyChecks[check]
```

Changing a probed proposal state changes the online read verdict without
rewriting section/check rows. This differs from changing a policy input stored
on the immediate parent: LIVE maintains that input's private child copy in the
same parent transaction. Both keep the whole authored policy.

## Versioned status transitions with private history

`guide rule-recipes private-history` uses an expected version to reject a stale
transition, a named old/next rule for the permitted edge, and an append-only
owner-readable history row in the same transaction. No public status/history
aggregate leaks the private transition. A hidden task is `NOT_FOUND` before
the program's `STALE_VERSION` or `BAD_TRANSITION` checks.

```quarry
use personas alice, bob, carol
table versionedTasks:
  owner: principal
  status: enum('draft', 'submitted', 'approved') default 'draft'
  version: int default 1
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer and .status = 'draft' and .version = 1
  update (old, next) <- old.owner = viewer and next.owner = old.owner and ((old.status = 'draft' and next.status = 'submitted') or (old.status = 'submitted' and next.status = 'approved'))
  online only
table privateStatusHistory:
  task: versionedTasks
  owner: principal
  version: int
  status: enum('draft', 'submitted', 'approved')
  at: time default now
  unique task, version
  immutable task, owner, version, status, at
  read <- .owner = viewer
  insert <- .owner = viewer and exists versionedTasks[.task, owner = .owner, version = .version, status = .status]
  online only
mutation newVersionedTask():
  return insert versionedTasks { owner: viewer }
mutation transitionTask(task: versionedTasks, expected: int, status: enum('draft', 'submitted', 'approved')):
  t = versionedTasks[task] ! else NOT_FOUND
  require t.version = expected else STALE_VERSION
  require (t.status = 'draft' and status = 'submitted') or (t.status = 'submitted' and status = 'approved') else BAD_TRANSITION
  update versionedTasks[task] { status, version: t.version + 1 }
  insert privateStatusHistory { task, owner: viewer, version: t.version + 1, status }
query versionedTask(task: versionedTasks):
  return versionedTasks[task]
query statusHistory(task: versionedTasks, c: cursor ?):
  return privateStatusHistory where .task = task and .owner = viewer first 20 by .version after c
```

The expected-version check and increment are application invariants in this
mutation; the table transition rule independently authorizes the status edge.
Keep every future writer on the same version/history path. History insert
failure rolls the status update back. Review query-audience and
`N_REQUIRE_REFUSED` diagnostics for these workflows.


## Private immutable payloads and audience helpers

Use a pure expression helper for a repeated audience. Its typed arguments are
rule terms; its body expands before planning, with exactly the ordinary rule
semantics. A helper may also contain a single return. Pass focal fields
explicitly: a helper cannot capture the caller's dot, clock or local variables.
Effects and multi-statement helper blocks belong in operations.

A protected immutable payload is set on insert. Supplying it on update or an
existing upsert is ignored for every viewer without comparing the old value;
N_IMMUTABLE_PATCH explains that behavior. Omit it from patches. This protects
both permanence and privacy, including assets. Unique/index/cap/authority keys
still cannot use protected payloads.

```quarry
use identity guests
fn dxOwns(owner: principal): owner = viewer
fn dxStaff(): exists dxRoles[principal = viewer, role = 'staff']
table dxRoles:
  principal: principal
  role: enum('staff', 'customer')
  unique principal
  immutable principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
table dxEligibility:
  principal: principal
  eligible: bool
  unique principal
  read <- allow
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
table dxOrders:
  owner: principal
  title: text <= 80
  price: int read <- dxOwns(.owner)
  immutable owner, price
  read <- allow
  insert <- dxOwns(.owner)
  update <- dxOwns(.owner)
  online only
mutation dxRole(principal: principal, role: enum('staff', 'customer')):
  upsert dxRoles[principal = principal] { principal, role }
  upsert dxEligibility[principal = principal] { principal, eligible: role = 'customer' }
mutation dxOpen(title: text <= 80, price: int):
  return insert dxOrders { owner: viewer, title, price }
mutation dxEdit(id: dxOrders, title: text <= 80):
  return update dxOrders[id] { title }
query dxOrder(id: dxOrders):
  return dxOrders[id]
query dxPublicCustomer(principal: principal):
  return exists dxEligibility[principal = principal, eligible = true]
query dxIsCustomer(principal: principal):
  return exists dxRoles[principal = principal, role = 'customer']
mutation dxCustomerGuard(principal: principal):
  require exists dxRoles[principal = principal, role = 'customer'] else NOT_CUSTOMER
  return true
mutation dxStaffEdit(id: dxOrders, title: text <= 80):
  require dxStaff() else NOT_STAFF
  return update dxOrders[id] { title }
```

The operator can provision a customer role, but a different caller's
`dxIsCustomer(customer)` returns false: program exists applies
`dxRoles.read <- .principal = viewer`. That result means caller-visible absence.
A positive require on that result can therefore say NOT_CUSTOMER even when the
hidden role exists. N_UNREADABLE_PROBE/N_LOOKUP_FILTERED name the hiding rule
and its source site. Table-rule exists is a policy probe; it does not return
that row or borrow its read audience. A staff require also does not replace
`dxOrders.update`: dxStaffEdit still needs the order's owner rule.

The example deliberately publishes only customer eligibility in dxEligibility;
the operator updates it alongside the private role. dxPublicCustomer can test
that public fact for another principal. Use this projection only when the
specification makes eligibility public. Keep role and private payload rows hidden. For parent-child
visibility use `read through .parent` only when inheriting the entire parent
read policy is intended; `guide rule-recipes` covers that model.
