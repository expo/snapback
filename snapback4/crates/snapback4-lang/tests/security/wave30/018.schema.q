-- Orchard Pruning Visits.
--
-- Roles: manager (office), grower (owns family orchards), pruner (crew),
-- lead (lead pruner; alone may approve quarantine pruning). At least two
-- users of each role; roster is operator-provisioned, never self-claimed.
-- Auth: real password accounts (`use identity password`); no personas.

use identity password

table roles:
  principal: principal
  role: enum('manager', 'grower', 'pruner', 'lead')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('manager', 'grower', 'pruner', 'lead')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- Family orchards. A grower creates their own; the office manager may also
-- open one for a grower. Growers read only their own; staff read all.
table orchards:
  owner: principal
  name: text 3..80
  fruit: enum('apple', 'pear')
  quarantine: bool default false
  createdAt: time default now
  immutable owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'pruner'] or exists roles[principal = viewer, role = 'lead']
  insert <- .owner = viewer or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'manager']
  delete <- deny
  cap 500 by owner
  online only

mutation openOrchard(owner: principal, name: text 3..80, fruit: enum('apple', 'pear')):
  r = roles[viewer]
  require r != null and (r.role = 'grower' or r.role = 'manager') else NOT_GROWER_OR_MANAGER
  require owner = viewer or (r != null and r.role = 'manager') else OWNER_MISMATCH 'Growers may only open their own orchards.'
  return insert orchards { owner, name, fruit }

mutation setQuarantine(orchard: orchards, quarantine: bool):
  r = roles[viewer]
  require r != null and r.role = 'manager' else NOT_MANAGER
  o = orchards[orchard] ! else NOT_FOUND
  update orchards[orchard] { quarantine }
  return null

-- A visit to prune one orchard's trees. The manager opens it with a photo of
-- the orchard's previous pruning plan and the quoted fee per tree
-- (feeCents), scheduled for visitDate. Lifecycle:
-- booked -> confirmed (within 7 days of booking) -> marked -> pruned ->
-- chipped. Unconfirmed visits are released by the hourly job.
table visits:
  orchard: orchards
  grower: principal
  status: enum('booked', 'confirmed', 'marked', 'pruned', 'chipped', 'released') default 'booked'
  planPhoto: image <=5000000
  feeCents: int 0..1000000
  visitDate: time
  bookedAt: time default now
  immutable orchard, grower, planPhoto, feeCents, visitDate, bookedAt
  read <- .grower = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'pruner'] or exists roles[principal = viewer, role = 'lead']
  insert <- exists roles[principal = viewer, role = 'manager'] and exists orchards[.orchard, owner = .grower]
  update <- .grower = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'pruner'] or exists roles[principal = viewer, role = 'lead']
  delete <- deny
  cap 500 by grower
  online only

mutation openVisit(orchard: orchards, grower: principal, photo: image <=5000000, feeCents: int 0..1000000, visitDate: time):
  o = orchards[orchard] ! else NOT_FOUND
  require o.owner = grower else GROWER_MISMATCH 'The visit grower must own the orchard.'
  require visitDate >= now - 1d else VISIT_DATE_PAST 'The visit date must be today or later.'
  return insert visits { orchard, grower, planPhoto: photo, feeCents, visitDate }

mutation confirmVisit(visit: visits):
  r = roles[viewer]
  require r != null and (r.role = 'manager' or r.role = 'grower') else NOT_MANAGER_OR_GROWER
  v = visits[visit] ! else NOT_FOUND
  require now <= v.bookedAt + 7d else CONFIRM_WINDOW_PASSED 'Confirmation is due within seven days of booking.'
  require v.status = 'booked' else BAD_STATUS 'Only a booked visit can be confirmed.'
  require v.grower = viewer or (r != null and r.role = 'manager') else NOT_VISIT_GROWER
  update visits[visit] { status: 'confirmed' }
  return null

mutation markVisit(visit: visits):
  r = roles[viewer]
  require r != null and (r.role = 'pruner' or r.role = 'lead') else NOT_PRUNER
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'confirmed' else BAD_STATUS 'Only a confirmed visit can be marked.'
  update visits[visit] { status: 'marked' }
  return null

mutation pruneVisit(visit: visits):
  r = roles[viewer]
  require r != null and (r.role = 'pruner' or r.role = 'lead') else NOT_PRUNER
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'marked' else BAD_STATUS 'Only a marked visit can be pruned.'
  o = orchards[v.orchard] ! else NOT_FOUND
  if o.quarantine:
    require exists approvals[visit] else QUARANTINE_APPROVAL_REQUIRED 'A quarantined orchard needs the lead pruner approval first.'
  update visits[visit] { status: 'pruned' }
  return null

mutation chipVisit(visit: visits):
  r = roles[viewer]
  require r != null and (r.role = 'pruner' or r.role = 'lead') else NOT_PRUNER
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'pruned' else BAD_STATUS 'Only a pruned visit can be chipped.'
  update visits[visit] { status: 'chipped' }
  return null

-- Fire blight quarantine approval: only the lead pruner may record the
-- inspector's permit and the extra fee, and only for a quarantined orchard.
table approvals:
  visit: visits
  grower: principal
  permit: text 4..80
  extraFeeCents: int 0..1000000
  approvedBy: principal
  approvedAt: time default now
  unique visit
  immutable visit, grower, permit, extraFeeCents, approvedBy
  read <- .grower = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'pruner'] or exists roles[principal = viewer, role = 'lead']
  insert <- exists roles[principal = viewer, role = 'lead'] and .approvedBy = viewer and exists visits[.visit, grower = .grower]
  update <- deny
  delete <- deny
  online only

mutation approveQuarantine(visit: visits, permit: text 4..80, extraFeeCents: int 0..1000000):
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'confirmed' or v.status = 'marked' else BAD_STATUS 'Approval needs a live visit.'
  o = orchards[v.orchard] ! else NOT_FOUND
  require o.quarantine else NOT_QUARANTINED 'Only a quarantined orchard needs approval.'
  return insert approvals { visit, grower: v.grower, permit, extraFeeCents, approvedBy: viewer }

-- Trees missed on the visit: a pruner records them after pruning, and they
-- may still be pruned within 30 days of the visit.
table touchups:
  visit: visits
  grower: principal
  treeTag: text 1..40
  done: bool default false
  doneAt: time ?
  createdAt: time default now
  immutable visit, grower, treeTag
  read <- .grower = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'pruner'] or exists roles[principal = viewer, role = 'lead']
  insert <- (exists roles[principal = viewer, role = 'pruner'] or exists roles[principal = viewer, role = 'lead']) and exists visits[.visit, grower = .grower]
  update <- exists roles[principal = viewer, role = 'pruner'] or exists roles[principal = viewer, role = 'lead']
  delete <- deny
  cap 200 by visit
  online only

mutation recordMissed(visit: visits, treeTag: text 1..40):
  r = roles[viewer]
  require r != null and (r.role = 'pruner' or r.role = 'lead') else NOT_PRUNER
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'pruned' or v.status = 'chipped' else BAD_STATUS 'Missed trees are recorded after pruning.'
  return insert touchups { visit, grower: v.grower, treeTag }

mutation pruneTouchup(touchup: touchups):
  r = roles[viewer]
  require r != null and (r.role = 'pruner' or r.role = 'lead') else NOT_PRUNER
  t = touchups[touchup] ! else NOT_FOUND
  require t.done = false else BAD_STATUS 'This tree is already pruned.'
  v = visits[t.visit] ! else NOT_FOUND
  require now <= v.visitDate + 30d else TOUCHUP_WINDOW_PASSED 'A missed tree may be pruned within 30 days of the visit.'
  update touchups[touchup] { done: true, doneAt: now }
  return null

-- Unconfirmed visits are released seven days after booking.
job releaseStale(periodStart: time, periodEnd: time):
  for v in visits where .bookedAt >= periodEnd - 30d and .bookedAt < periodEnd - 7d by .bookedAt:
    if v.status = 'booked':
      update visits[v.id] { status: 'released' }

schedule releaseHourly every 1h: releaseStale

query orchards(c: cursor ?):
  if exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'pruner'] or exists roles[principal = viewer, role = 'lead']:
    return orchards last 50 by .id after c
  return orchards where .owner = viewer last 50 by .id after c

query visitsBoard(c: cursor ?):
  if exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'pruner'] or exists roles[principal = viewer, role = 'lead']:
    return visits last 50 by .id after c
  return visits where .grower = viewer last 50 by .id after c

query visitDetail(visit: visits):
  return visits[visit]

query approvalsFor(visit: visits, c: cursor ?):
  return approvals where .visit = visit last 20 by .id after c

query touchupsFor(visit: visits, c: cursor ?):
  return touchups where .visit = visit last 50 by .id after c
