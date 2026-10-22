use identity password

table roles:
  principal: principal
  role: enum('owner', 'tuner', 'office', 'companyOwner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'tuner', 'office', 'companyOwner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }
query myRole():
  return roles[viewer]
query contacts(c: cursor ?):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner'] else OFFICE_ONLY
  return roles first 100 by .id after c

table pianos:
  owner: principal
  name: text 1..100
  address: text 1..240
  setting: enum('home', 'school')
  lastTuned: time
  immutable owner
  read <- .owner = viewer or exists roles[viewer, role = 'tuner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
  insert <- exists roles[viewer, role = 'office']
  update <- exists roles[viewer, role = 'tuner']
  online only

table visits:
  piano: pianos
  owner: principal
  tuner: principal
  bookedAt: time
  quotedCharge: int 1..1000000
  status: enum('booked', 'tuned', 'invoiced') default 'booked'
  pitchRaisedAt: time ?
  tunedAt: time ?
  photo: image <=5000000 ?
  tuningCharge: int 1..1000000 ?
  rebuildCharge: int 1..5000000 ?
  rebuildDescription: text 1..1000 ?
  agreedBy: principal ?
  agreedAt: time ?
  approvedBy: principal ?
  approvedAt: time ?
  invoicedAt: time ?
  invoiceTotal: int 1..6000000 ?
  immutable piano, owner, tuner, bookedAt, quotedCharge
  read <- .owner = viewer or exists roles[viewer, role = 'tuner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
  insert <- exists roles[viewer, role = 'office'] and .owner = .piano.owner
  update <- .owner = viewer or exists roles[viewer, role = 'tuner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
  online only

table reminders:
  piano: pianos
  owner: principal
  lastTuned: time
  sentAt: time
  unique piano, lastTuned
  immutable piano, owner, lastTuned, sentAt
  read <- .owner = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
  online only

query pianoList(c: cursor ?):
  return pianos first 100 by .id after c
query pianoDetail(piano: pianos):
  return pianos[piano]
query visitList(c: cursor ?):
  return visits last 100 by .id after c
query visitDetail(visit: visits):
  return visits[visit]
query reminderList(c: cursor ?):
  return reminders last 100 by .id after c

mutation addPiano(owner: principal, name: text 1..100, address: text 1..240, setting: enum('home', 'school'), lastTuned: time):
  require exists roles[viewer, role = 'office'] else OFFICE_ONLY
  require exists roles[owner, role = 'owner'] else INVALID_OWNER
  require lastTuned <= now and lastTuned >= now - 36500d else INVALID_DATE
  return insert pianos { owner, name, address, setting, lastTuned }
mutation bookVisit(piano: pianos, tuner: principal, bookedAt: time, quotedCharge: int 1..1000000):
  require exists roles[viewer, role = 'office'] else OFFICE_ONLY
  p = pianos[piano] ! else NOT_FOUND
  require exists roles[tuner, role = 'tuner'] else INVALID_TUNER
  require bookedAt >= now - 5m and bookedAt <= now + 365d else INVALID_BOOKING_TIME
  return insert visits { piano, owner: p.owner, tuner, bookedAt, quotedCharge }
mutation recordPitchRaise(visit: visits):
  require exists roles[viewer, role = 'tuner'] else TUNER_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.tuner = viewer else ASSIGNED_TUNER_ONLY
  require v.status = 'booked' else VISIT_CLOSED
  require now >= v.bookedAt else TOO_EARLY
  require v.pitchRaisedAt = null else ALREADY_RAISED
  update visits[visit] { pitchRaisedAt: now }
mutation proposeRebuild(visit: visits, charge: int 1..5000000, description: text 1..1000):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'tuner'] else STAFF_ONLY
  v = visits[visit] ! else NOT_FOUND
  require exists roles[viewer, role = 'office'] or v.tuner = viewer else ASSIGNED_TUNER_ONLY
  require v.status = 'booked' else VISIT_CLOSED
  require v.rebuildCharge = null else ALREADY_PROPOSED
  require charge > v.quotedCharge else NOT_ABOVE_QUOTE
  update visits[visit] { rebuildCharge: charge, rebuildDescription: description }
mutation agreeRebuild(visit: visits):
  v = visits[visit] ! else NOT_FOUND
  require v.owner = viewer else PIANO_OWNER_ONLY
  require v.status = 'booked' and v.rebuildCharge != null else NO_OPEN_PROPOSAL
  require v.agreedAt = null else ALREADY_AGREED
  update visits[visit] { agreedBy: viewer, agreedAt: now }
mutation approveRebuild(visit: visits):
  require exists roles[viewer, role = 'companyOwner'] else COMPANY_OWNER_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'booked' and v.rebuildCharge != null else NO_OPEN_PROPOSAL
  require v.agreedBy = v.owner and v.agreedAt != null else OWNER_AGREEMENT_REQUIRED
  require v.approvedAt = null else ALREADY_APPROVED
  update visits[visit] { approvedBy: viewer, approvedAt: now }
mutation finishTuning(visit: visits, photo: image <=5000000 ?, charge: int 1..1000000):
  require exists roles[viewer, role = 'tuner'] else TUNER_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.tuner = viewer else ASSIGNED_TUNER_ONLY
  require v.status = 'booked' else VISIT_CLOSED
  require now >= v.bookedAt else TOO_EARLY
  p = pianos[v.piano] ! else NOT_FOUND
  require now - p.lastTuned <= 730d or v.pitchRaisedAt != null else PITCH_RAISE_REQUIRED
  require v.rebuildCharge = null or v.approvedAt != null else REBUILD_APPROVAL_REQUIRED
  require charge <= v.quotedCharge else ABOVE_QUOTE
  update visits[visit] { photo: photo ?? v.photo, tuningCharge: charge, tunedAt: now, status: 'tuned' }
  update pianos[v.piano] { lastTuned: now }
-- A photo can be attached or replaced after completion/invoicing as well as before.
-- The immutable assignment is the authority; no office/owner bypass exists.
mutation setVisitPhoto(visit: visits, photo: image <=5000000):
  require exists roles[viewer, role = 'tuner'] else TUNER_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.tuner = viewer else ASSIGNED_TUNER_ONLY
  update visits[visit] { photo }
mutation sendInvoice(visit: visits):
  require exists roles[viewer, role = 'office'] else OFFICE_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'tuned' else NOT_TUNED
  update visits[visit] { status: 'invoiced', invoicedAt: now, invoiceTotal: (v.tuningCharge ?? 0) + (v.rebuildCharge ?? 0) }

job remindOverdue(periodStart: time, periodEnd: time):
  for p in pianos by .id:
    if p.lastTuned + 365d < periodEnd:
      insert reminders { piano: p.id, owner: p.owner, lastTuned: p.lastTuned, sentAt: periodEnd } if absent
schedule dailyReminders every 1d at 06:00: remindOverdue

invariant pianos.read only .owner = viewer or exists roles[viewer, role = 'tuner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
invariant visits.read only .owner = viewer or exists roles[viewer, role = 'tuner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
invariant reminders.read only .owner = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'companyOwner']
invariant roles.role write only viewer = 'service:operator'
invariant visits.approveRebuild only exists roles[viewer, role = 'companyOwner']
invariant visits.agreeRebuild only .owner = viewer
invariant visits.finishTuning only .tuner = viewer and exists roles[viewer, role = 'tuner']

invariant visits.photo update only .tuner = viewer and exists roles[viewer, role = 'tuner']
invariant visits.setVisitPhoto only .tuner = viewer and exists roles[viewer, role = 'tuner']
