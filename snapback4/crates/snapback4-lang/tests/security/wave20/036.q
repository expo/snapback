-- Knife Sharpening Drops.
--
-- A sharpening service collects knives from restaurants and home cooks. Each
-- set is photographed and counted at drop-off, is due back within five days,
-- and is donated if not collected within 60 days of the ready notice.
-- Restaurants see only their own sets, sharpeners see the live shop board,
-- couriers see only their own route, and only the shop owner records damaged
-- or missing knives and issues credits (photo + reason kept).
use identity password

table roles:
  principal: principal
  role: enum('restaurant', 'sharpener', 'courier', 'owner')
  route: text 1..40 ?
  unique principal
  immutable principal
  cap 1 by principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table sets:
  owner: principal
  label: text 1..80
  knifeCount: int 1..200
  photo: image <=5000000
  route: text 1..40
  courier: principal ?
  status: enum('dropped', 'ready', 'collected', 'donated')
  droppedAt: time default now
  dueAt: time
  readyAt: time ?
  collectedAt: time ?
  immutable owner, droppedAt, dueAt
  cap 500 by owner
  read <- .owner = viewer or .courier = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'sharpener']
  insert <- .owner = viewer or exists roles[principal = viewer, role = 'owner']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'sharpener']
  delete <- deny
  online only

table incidents:
  set: sets
  kind: enum('damaged', 'missing')
  photo: image <=5000000
  reason: text 1..500
  credit: money USD
  at: time default now
  reporter: principal
  immutable set, kind, photo, reason, credit, at, reporter
  cap 50 by set
  read <- exists sets[.set, owner = viewer] or exists sets[.set, courier = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'sharpener']
  insert <- exists roles[principal = viewer, role = 'owner']
  update <- deny
  delete <- deny
  online only

query myRole():
  return roles[viewer]

query mySets(c: cursor ?):
  return sets where .owner = viewer last 50 by .id after c

query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'sharpener'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only sharpeners and the shop owner see the shop board.'
  return sets where .status = 'dropped' or .status = 'ready' first 50 by .dueAt after c

query myRoute(c: cursor ?):
  require exists roles[principal = viewer, role = 'courier'] else NOT_COURIER 'Only couriers see a route.'
  return sets where .courier = viewer last 50 by .dueAt after c

query allSets(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the shop owner sees every set.'
  return sets last 50 by .id after c

query incidentsFor(set: sets, c: cursor ?):
  return incidents where .set = set first 50 by .id after c

mutation provision(principal: principal, role: enum('restaurant', 'sharpener', 'courier', 'owner'), route: text 1..40 ?):
  require viewer = 'service:operator' else NOT_OPERATOR 'Only the service operator provisions roles.'
  return upsert roles[principal] { principal, role, route }

mutation dropSet(label: text 1..80, knifeCount: int 1..200, photo: image <=5000000, route: text 1..40, owner: principal ?):
  actual = owner ?? viewer
  require actual = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_OWNER_OP 'Only the shop owner may drop off a set for someone else.'
  return insert sets { owner: actual, label, knifeCount, photo, route, status: 'dropped', droppedAt: now, dueAt: now + 5d }

mutation markReady(set: sets):
  s = sets[set] ! else NOT_FOUND 'No such set.'
  require exists roles[principal = viewer, role = 'sharpener'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only sharpeners and the shop owner mark sets ready.'
  require s.status = 'dropped' else BAD_STATUS 'Only a dropped-off set can be marked ready.'
  update sets[set] { status: 'ready', readyAt: now }
  return sets[set]

mutation markCollected(set: sets):
  s = sets[set] ! else NOT_FOUND 'No such set.'
  require s.status = 'ready' else BAD_STATUS 'Only a ready set can be collected.'
  require s.readyAt != null and now <= s.readyAt + 60d else COLLECT_WINDOW_PASSED 'The 60-day collection window has passed; the set is due for donation.'
  require s.owner = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_YOURS 'Only the set owner or the shop owner records a collection.'
  update sets[set] { status: 'collected', collectedAt: now }
  return sets[set]

mutation assignRoute(set: sets, courier: principal, route: text 1..40):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER_OP 'Only the shop owner assigns routes.'
  s = sets[set] ! else NOT_FOUND 'No such set.'
  require s.status = 'dropped' or s.status = 'ready' else BAD_STATUS 'Only a set still in the shop can be routed.'
  update sets[set] { courier, route }
  return sets[set]

mutation reportIncident(set: sets, kind: enum('damaged', 'missing'), photo: image <=5000000, reason: text 1..500, credit: money USD):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER_OP 'Only the shop owner records incidents and credits.'
  s = sets[set] ! else NOT_FOUND 'No such set.'
  return insert incidents { set, kind, photo, reason, credit, at: now, reporter: viewer }

job donateOverdue(periodStart: time, periodEnd: time):
  for s in sets by .id:
    if s.status = 'ready' and s.readyAt != null and s.readyAt < periodEnd - 60d:
      update sets[s.id] { status: 'donated' }

schedule donateDaily every 1d at 03:00: donateOverdue

-- Privacy intent, stated separately from the enforcing rules above.

invariant incidents.read only exists sets[.set, owner = viewer] or exists sets[.set, courier = viewer] or exists roles[principal = viewer, role = 'owner'] or (exists roles[principal = viewer, role = 'sharpener'] and (exists sets[.set, status = 'dropped'] or exists sets[.set, status = 'ready']))
