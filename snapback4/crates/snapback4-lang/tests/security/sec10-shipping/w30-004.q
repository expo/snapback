use identity password

-- Role assignment is an operator task, never self-service.
table roles:
  principal: principal
  role: enum('owner', 'coordinator', 'crew', 'family')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'coordinator', 'crew', 'family')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query families(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else STAFF_ONLY
  return roles where .role = 'family' last 50 by .id after c { principal }

table jobs:
  family: principal
  coordinator: principal
  title: text 1..100
  roomCount: int 1..12
  fittedCount: int 0..12 default 0
  openedAt: time default now
  lastFittingAt: time ?
  walkthroughDueAt: time ?
  walkthroughAt: time ?
  completedAt: time ?
  immutable family, coordinator, title, roomCount, openedAt
  read <- .family = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'crew']
  insert <- .coordinator = viewer and exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'crew']
  online only

table jobPrivate:
  job: jobs
  phone: text 7..30
  careNeeds: text 1..2000
  quotedCents: int 1..100000000
  depositCents: int 0..100000000
  depositStatus: enum('held', 'cancelled') default 'held'
  unique job
  immutable job, phone, careNeeds, quotedCents, depositCents
  read <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  insert <- exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'owner']
  online only

table rooms:
  job: jobs
  name: text 1..80
  photo: image <=5000000
  measurements: text 1..500
  hazards: text 1..1000
  stage: enum('demolition', 'ramps', 'grab-bars', 'walkthrough') default 'demolition'
  fittedAt: time ?
  immutable job, name, photo, measurements, hazards
  read through .job
  insert <- exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  cap 12 by job
  online only

table cancellations:
  job: jobs
  actor: principal
  reason: text 3..500
  at: time default now
  unique job
  immutable job, actor, reason, at
  read <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  insert <- .actor = viewer and exists roles[viewer, role = 'owner']
  online only

invariant jobPrivate.read only exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
invariant cancellations.insert only exists roles[viewer, role = 'owner']
invariant rooms always .photo != null
invariant jobs.read only .family = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'crew']

query board(c: cursor ?):
  if exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'crew']:
    return jobs last 50 by .id after c
  return jobs where .family = viewer last 50 by .id after c

query jobDetail(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  return { job: j, rooms: rooms where .job = job first 12 by .id }

query privateDetail(job: jobs):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else PRIVATE
  return { details: jobPrivate[job = job], cancellation: cancellations[job = job] }

mutation openJob(family: principal, title: text 1..100, phone: text 7..30, careNeeds: text 1..2000, quotedCents: int 1..100000000, depositCents: int 0..100000000, names: [text 1..80] 1..12, photos: [image <=5000000] 1..12, measurements: [text 1..500] 1..12, hazards: [text 1..1000] 1..12):
  require exists roles[viewer, role = 'coordinator'] else COORDINATOR_ONLY
  require exists roles[principal = family, role = 'family'] else NOT_FAMILY
  require depositCents <= quotedCents else BAD_DEPOSIT
  require count(names) = count(photos) and count(names) = count(measurements) and count(names) = count(hazards) else EVERY_ROOM_REQUIRED
  j = insert jobs { family, coordinator: viewer, title, roomCount: count(names) }
  insert jobPrivate { job: j.id, phone, careNeeds, quotedCents, depositCents }
  for i in range(0, count(names)):
    roomName = at(names, i) ! else MISSING_ROOM
    photo = at(photos, i) ! else MISSING_PHOTO
    measurement = at(measurements, i) ! else MISSING_MEASUREMENT
    hazard = at(hazards, i) ! else MISSING_HAZARD
    insert rooms { job: j.id, name: roomName, photo, measurements: measurement, hazards: hazard }
  return j

mutation advanceRoom(room: rooms):
  require exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else STAFF_ONLY
  r = rooms[room] ! else NOT_FOUND
  j = jobs[r.job] ! else NOT_FOUND
  require j.completedAt = null else COMPLETED
  require r.stage != 'walkthrough' else ALREADY_FITTED
  if r.stage = 'demolition':
    update rooms[room] { stage: 'ramps' }
  elif r.stage = 'ramps':
    update rooms[room] { stage: 'grab-bars' }
  else:
    update rooms[room] { stage: 'walkthrough', fittedAt: now }
    update jobs[j.id] { fittedCount: j.fittedCount + 1, lastFittingAt: now, walkthroughDueAt: now + 10d, walkthroughAt: null }
  return rooms[room]

mutation scheduleWalkthrough(job: jobs, at: time):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else COORDINATOR_OR_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.completedAt = null else COMPLETED
  require j.fittedCount = j.roomCount and j.walkthroughDueAt != null else FITTINGS_REQUIRED
  require at >= now and at <= j.walkthroughDueAt else OUTSIDE_WINDOW 'Walkthrough must be within ten days of the last fitting.'
  update jobs[job] { walkthroughAt: at }
  return jobs[job]

mutation completeWalkthrough(job: jobs):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else COORDINATOR_OR_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.completedAt = null else COMPLETED
  require j.fittedCount = j.roomCount and j.walkthroughDueAt != null and j.walkthroughAt != null else WALKTHROUGH_REQUIRED
  require now >= j.walkthroughAt and now <= j.walkthroughDueAt else OUTSIDE_WINDOW
  update jobs[job] { completedAt: now }
  return jobs[job]

mutation cancelDeposit(job: jobs, reason: text 3..500):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  d = jobPrivate[job = job] ! else NOT_FOUND
  require d.depositStatus = 'held' else ALREADY_CANCELLED
  require count(trim(reason)) >= 3 else REASON_REQUIRED
  insert cancellations { job, actor: viewer, reason }
  update jobPrivate[d.id] { depositStatus: 'cancelled' }
  return cancellations[job = job]
