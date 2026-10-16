
## Child readable by the parent's current roster

`guide rule-recipes current-roster` follows a parent's mutable department.
Write the live rule and a real per-folder product cap. The engine owns the
private audience fields and updates every existing child in the parent's
transaction, including when another mutation writes the parent. The child has
no authored department copy and no application transfer loop.

```quarry
use personas alice, bob, carol
table liveDepartments:
  title: text 1..80
  public 'department names are public'
  online only
table liveDepartmentRoster:
  department: liveDepartments
  principal: principal
  unique department, principal
  immutable department, principal
  read <- .principal = viewer
  sync
table liveRosterFolders:
  department: liveDepartments
  read <- exists liveDepartmentRoster[.department, viewer] or viewer = 'service:ops'
  update <- viewer = 'service:ops'
  sync
table liveRosterFiles:
  folder: liveRosterFolders
  body: text 1..200
  immutable folder
  cap 20 by folder
  read through live .folder
  insert <- allow
  delete <- viewer = 'service:ops'
  sync
mutation addLiveRosterFile(folder: liveRosterFolders, body: text 1..200):
  f = liveRosterFolders[folder] ! else NOT_FOUND
  return insert liveRosterFiles { folder: f.id, body }
mutation transferLiveRosterFolder(folder: liveRosterFolders, department: liveDepartments):
  require viewer = 'service:ops' else OPERATOR_ONLY
  require exists liveDepartments[department] else NOT_FOUND
  update liveRosterFolders[folder] { department }
query liveRosterFile(file: liveRosterFiles):
  return liveRosterFiles[file]
query liveFolderFiles(folder: liveRosterFolders, c: cursor ?):
  return liveRosterFiles where .folder = folder first 20 by .id after c
```

This example prints `N_NO_HORIZON`: twenty files per folder does not bound
files per department or how many departments a device holds. Keep full-current
sync and measure `check --residency`, or choose `online only`; a horizon is
refused for live authority. The cap is a product limit, not an acquisition window. Every parent write
prepays the full schema-fixed fanout, even with no children. A write that
cannot fit rolls back the parent and all children; parent writers queue on
devices. Child-only writes keep the ordinary parent/coverage prediction rules.
Sync carries ordinary row moves in one commit; acquisition catches up before
publishing. Offline devices keep their last applied state. A parent verdict
never substitutes for child coverage, and mismatched held copies take the
server fallback. Service grants stay on the parent and add no device audience.

This first live form requires one immutable required reference and its exact
per-reference cap, ordinary nonexpiring endpoints and nonexpiring probe
graphs. It refuses chains, derived/receipt/private-field endpoints, writing
reference actions on endpoints, nonplain or oversized-key child indexes,
horizons and retained history. Sync requires one exact public, principal or
membership audience; a whole OR-heavy noninvertible parent rule is preserved
with an `online only` child. `N_LIVE_PARENT_COST` warns when the fixed price
already exceeds ordinary ceilings. Use `guide rules` for the complete boundary.

For an existing manual recipe, keep the old copies consistent in a bridge
release, then replace the child's copy/read rule with `read through live` and
remove its transfer loop. Adoption validates correspondence before dropping
columns. Rollback to the manual form fills its audience cells from the current
parent, including formerly dormant cells. Inconsistent or ambiguous policies
refuse atomically; ids do not change. Rebuild devices for `live-parent-copy-v1`.
Bulk seed/import/restore uses one bounded job account; split large input into
coherent parent-plus-children batches, never a partial parent transfer.

### Manual copy alternative

The child copy is mutable and maintained by the application's only transfer
mutation, in the same transaction as the parent. Every child insert/update
checks the live parent. This differs from an immutable copy, which preserves
creation-time authority. Twenty children per folder is this product's transfer
limit; choose an honest limit before adopting this pattern. Only the operator
seat transfers folders, and can read every child while changing its audience.
Do not expose another parent-department writer or a generic child-copy writer.

```quarry
use personas alice, bob, carol
table departments:
  title: text 1..80
  public 'department names are public'
  online only
table departmentRoster:
  department: departments
  principal: principal
  unique department, principal
  immutable department, principal
  read <- .principal = viewer
  online only
table rosterFolders:
  department: departments
  read <- exists departmentRoster[.department, viewer] or viewer = 'service:ops'
  update <- viewer = 'service:ops'
  online only
table rosterFiles:
  folder: rosterFolders
  department: departments
  body: text 1..200
  immutable folder
  cap 20 by folder
  read <- exists departmentRoster[.department, viewer] or viewer = 'service:ops'
  insert <- exists departmentRoster[.department, viewer] and .department = .folder.department
  update (old, next) <- viewer = 'service:ops' and next.department = next.folder.department
  sync to departmentRoster[.department] last 500 by .id
mutation addRosterFile(folder: rosterFolders, body: text 1..200):
  f = rosterFolders[folder] ! else NOT_FOUND
  return insert rosterFiles { folder: f.id, department: f.department, body }
mutation transferRosterFolder(folder: rosterFolders, department: departments):
  require viewer = 'service:ops' else OPERATOR_ONLY
  require exists departments[department] else NOT_FOUND
  update rosterFolders[folder] { department }
  for file in rosterFiles where .folder = folder:
    update rosterFiles[file.id] { department }
query rosterFile(file: rosterFiles):
  return rosterFiles[file]
```

The transfer has no asynchronous repair window: either every child is rekeyed
or the whole transaction rolls back. Existing sync moves each row between its
old and new audiences. A disconnected device keeps its last applied state;
after synchronization, the former roster loses the rows. For existing rows, use a bridge release to add and backfill the copy before
switching authority (`guide evolution`); route all future parent changes
through this mutation. Bare `read through` requires immutable captured parent
fields; `read through live` above delegates the maintenance to the engine. The transfer
walks the entire capped group; see `guide reads` for completeness guidance.

## Private waitlist with anonymous occupancy

`guide rule-recipes private-waitlist` keeps names and membership private while
publishing only a count. That count intentionally reveals join/leave activity,
including a one-person group. It grants no waitlist-row read access. Anonymous
occupancy means a public query; production guest/session setup is in
`guide production`.

```quarry
use personas alice, bob, carol
table waitSlots:
  label: text 1..80
  public 'slot labels and occupancy are public'
  online only
table privateWaitlist:
  slot: waitSlots
  principal: principal
  unique slot, principal
  immutable slot, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  delete <- .principal = viewer
  online only
view waitOccupancy: count privateWaitlist by .slot
  read <- allow
  disclosure reviewed 'anonymous occupancy and its join/leave deltas are public'
mutation joinWaitlist(slot: waitSlots):
  require exists waitSlots[slot] else NOT_FOUND
  return insert privateWaitlist { slot, principal: viewer }
mutation leaveWaitlist(slot: waitSlots):
  delete privateWaitlist[slot, viewer]
query occupancy(slot: waitSlots):
  return waitOccupancy[slot]
query myWait(slot: waitSlots):
  return privateWaitlist[slot, viewer]
```

## Expiring membership pages

`guide rule-recipes expiring-membership` checks one current membership before
reading a pinned page. Membership expiry removes access even without a sweep.
A held membership witness contributes its deadline, so a watch must refresh at
that boundary. The page carries its own `complete` verdict; never manufacture
completion from an empty list. See `guide reads` for completeness diagnostics.

```quarry
use personas alice, bob, carol
table memberRooms:
  label: text 1..80
  public 'room labels are public'
  online only
table timedMembers:
  room: memberRooms
  principal: principal
  expiresAt: time
  unique room, principal
  immutable room, principal, expiresAt
  expire at .expiresAt
  read <- .principal = viewer
  online only
table memberPages:
  room: memberRooms
  body: text 1..200
  immutable room
  cap 20 by room
  read <- exists timedMembers[.room, viewer]
  insert <- exists timedMembers[.room, viewer]
  online only
mutation memberPage(room: memberRooms, body: text 1..200):
  require exists memberRooms[room] else NOT_FOUND
  return insert memberPages { room, body }
query memberPageList(room: memberRooms, c: cursor ?):
  require exists timedMembers[room, viewer] else MEMBERSHIP_REQUIRED
  return memberPages where .room = room first 20 by .id after c
```

## Union audience and cold-start cost

`guide rule-recipes union-cold-start` gives an owner or their team the same
row. Bare union sync acquires **all** authorized rows, with no `last N` window;
its cold-start work and storage grow with the account's authorized population.
Do not remove a horizon to silence E_SYNC without accepting that cost. If a
bounded working set is required, use one shared roster audience with a horizon
(`guide rule-recipes offline-roster`), or keep this union online only. This
example deliberately caps each team and owner's population at 100; it still has no global
account bound because a viewer may belong to many teams.

```quarry
use personas alice, bob, carol
table unionTeams:
  label: text 1..80
  public 'team labels are public'
  online only
table unionRoster:
  team: unionTeams
  principal: principal
  unique team, principal
  immutable team, principal
  read <- .principal = viewer
  online only
table unionNotes:
  owner: principal
  team: unionTeams
  body: text 1..200
  immutable owner, team
  cap 100 by team
  cap 100 by owner
  read <- .owner = viewer or exists unionRoster[.team, viewer]
  insert <- .owner = viewer and exists unionRoster[.team, viewer]
  sync
mutation unionNote(team: unionTeams, body: text 1..200):
  require exists unionTeams[team] else NOT_FOUND
  return insert unionNotes { owner: viewer, team, body }
query ownUnionNotes(c: cursor ?):
  return unionNotes where .owner = viewer first 20 by .id after c
query teamUnionNotes(team: unionTeams, c: cursor ?):
  return unionNotes where .team = team first 20 by .id after c
```

## Public/private mirror with separate image placements

`guide rule-recipes mirror-images` uses two uploads, even for identical bytes.
An asset has one home row/column; copying a private asset id to a public row
refuses the asset-placement constraint. Upload the public version separately as the same caller and
pass its new id to publishImage. Only the public projection and that second
placement become public. Removing it revokes future downloads; previously
downloaded bytes cannot be recalled. Image capture/upload UI is in `guide assets`.

```quarry
use personas alice, bob, carol
table privateImages:
  owner: principal
  image: image <=5000000
  note: text <=200
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
table publicImages:
  source: privateImages
  image: image <=5000000
  unique source
  immutable source
  public 'the owner explicitly publishes a separate image placement'
  insert <- exists privateImages[.source, owner = viewer]
  update <- exists privateImages[.source, owner = viewer]
  delete <- exists privateImages[.source, owner = viewer]
  online only
mutation savePrivateImage(image: image <=5000000, note: text <=200):
  return insert privateImages { owner: viewer, image, note }
mutation publishImage(source: privateImages, image: image <=5000000):
  return upsert publicImages[source = source] { source, image }
mutation unpublishImage(source: privateImages):
  delete publicImages[source = source]
query publishedImage(source: privateImages):
  return publicImages[source = source]
query privateImage(source: privateImages):
  return privateImages[source]
```

## Own-or-staff queries

`guide rule-recipes own-or-staff` repeats the intended audience in the table
read rule. A query's guard can narrow access; it never widens a table rule.
Reading a hidden row with an assertion refuses NOT_FOUND before a later guard.
Place the role guard first when its custom code is the intended refusal.

```quarry
use personas alice, bob, carol
table queryStaff:
  principal: principal
  unique principal
  read <- .principal = viewer
  online only
table staffCases:
  owner: principal
  body: text 1..200
  immutable owner
  read <- .owner = viewer or exists queryStaff[viewer]
  insert <- .owner = viewer
  online only
mutation newStaffCase(body: text 1..200):
  return insert staffCases { owner: viewer, body }
query ownCases(c: cursor ?):
  return staffCases where .owner = viewer first 20 by .id after c
query staffCase(case: staffCases):
  require exists queryStaff[viewer] else STAFF_ONLY
  return staffCases[case]
query ownOrStaffCase(case: staffCases):
  return staffCases[case]
```
