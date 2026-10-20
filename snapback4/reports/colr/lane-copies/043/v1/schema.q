use identity password

table roles:
  principal: principal
  role: enum('renter', 'attendant', 'manager', 'officer')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'officer'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table boxes:
  number: text 1..40
  dueAt: time
  paid: bool default false
  noticeAt: time
  authorizedAt: time ?
  drilledAt: time ?
  unique number
  immutable number, dueAt, noticeAt
  read <- (exists roles[viewer, role = 'renter'] and exists members[.id, viewer]) or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'officer']
  insert <- exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'officer']
  online only

table members:
  box: boxes
  principal: principal
  addedBy: principal
  reason: text 5..500
  at: time
  unique box, principal
  immutable box, principal, addedBy, reason, at
  read <- (.principal = viewer and exists roles[viewer, role = 'renter']) or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'attendant']
  insert <- exists roles[viewer, role = 'manager'] and .addedBy = viewer
  online only

table visits:
  box: boxes
  renter: principal
  attendant: principal
  signature: image <=5000000
  idPhoto: image <=5000000
  at: time
  immutable box, renter, attendant, signature, idPhoto, at
  read <- (.renter = viewer and exists roles[viewer, role = 'renter']) or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'attendant'] and .attendant = viewer and exists members[.box, .renter]
  online only

table authorizations:
  box: boxes
  manager: principal
  reason: text 5..500
  at: time
  unique box
  immutable box, manager, reason, at
  read <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'officer']
  insert <- exists roles[viewer, role = 'manager'] and .manager = viewer
  online only

table presence:
  box: boxes
  officer: principal
  at: time
  unique box, officer
  read <- exists roles[viewer, role = 'officer'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'officer'] and .officer = viewer
  update <- exists roles[viewer, role = 'officer'] and .officer = viewer
  online only

table contents:
  box: boxes
  officerOne: principal
  officerTwo: principal
  recordedBy: principal
  photos: [image <=5000000] 1..6
  notes: text 5..1000
  at: time
  unique box
  immutable box, officerOne, officerTwo, recordedBy, photos, notes, at
  read <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'officer']
  insert <- exists roles[viewer, role = 'officer'] and .recordedBy = viewer
  online only

mutation provision(principal: principal, role: enum('renter', 'attendant', 'manager', 'officer'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query me():
  return roles[viewer]

query directory():
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'officer'] else STAFF_ONLY
  return roles first 100 by .id

query listBoxes():
  if exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'officer']:
    return boxes last 100 by .id { *, flagged: not .paid and .dueAt + 90d <= now }
  return members where .principal = viewer last 100 by .id { id: .box, number: .box.number ?? 'Unavailable', dueAt: .box.dueAt ?? 0, paid: .box.paid ?? false, noticeAt: .box.noticeAt ?? 0, authorizedAt: .box.authorizedAt, drilledAt: .box.drilledAt, flagged: (.box.paid ?? true) = false and (.box.dueAt ?? now) + 90d <= now }

query boxDetail(box: boxes):
  return boxes[box] { *, flagged: not .paid and .dueAt + 90d <= now }

query boxMembers(box: boxes):
  b = boxes[box] ! else NOT_FOUND
  return members where .box = box first 100 by .id

query visitLog():
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else STAFF_ONLY
  return visits last 100 by .at

query boxVisits(box: boxes):
  b = boxes[box] ! else NOT_FOUND
  return visits where .box = box last 100 by .at

query drillingRecords(box: boxes):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'officer'] else CONTENTS_PRIVATE
  return contents[box = box]

query drillingAuthorization(box: boxes):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'officer'] else CONTENTS_PRIVATE
  return authorizations[box = box]

query officersPresent(box: boxes):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'officer'] else CONTENTS_PRIVATE
  return presence where .box = box first 100 by .id

mutation rentBox(number: text 1..40, renter: principal, dueAt: time):
  require exists roles[viewer, role = 'manager'] else MANAGER_ONLY
  require len(trim(number)) >= 1 else BOX_NUMBER_REQUIRED
  require exists roles[renter, role = 'renter'] else NOT_RENTER
  require dueAt >= now - 365d and dueAt <= now + 730d else INVALID_DUE_DATE
  b = insert boxes { number, dueAt, noticeAt: dueAt + 90d, paid: false }
  insert members { box: b, principal: renter, addedBy: viewer, reason: 'Initial rental agreement', at: now }
  return b

mutation addCoRenter(box: boxes, renter: principal, reason: text 5..500):
  require exists roles[viewer, role = 'manager'] else MANAGER_ONLY
  require len(trim(reason)) >= 5 else REASON_REQUIRED
  b = boxes[box] ! else NOT_FOUND
  require b.drilledAt = null else BOX_DRILLED
  require exists roles[renter, role = 'renter'] else NOT_RENTER
  return insert members { box, principal: renter, addedBy: viewer, reason, at: now }

mutation recordPayment(box: boxes):
  require exists roles[viewer, role = 'manager'] else MANAGER_ONLY
  b = boxes[box] ! else NOT_FOUND
  require b.drilledAt = null else BOX_DRILLED
  require not b.paid else ALREADY_PAID
  update boxes[box] { paid: true, authorizedAt: null }

mutation authorizeDrilling(box: boxes, reason: text 5..500):
  require exists roles[viewer, role = 'manager'] else MANAGER_ONLY
  require len(trim(reason)) >= 5 else REASON_REQUIRED
  b = boxes[box] ! else NOT_FOUND
  require not b.paid and b.drilledAt = null else NOT_UNPAID
  require now >= b.dueAt + 90d else NOT_OVERDUE
  require now >= b.noticeAt + 30d else NOTICE_PERIOD
  require b.authorizedAt = null else ALREADY_AUTHORIZED
  insert authorizations { box, manager: viewer, reason, at: now }
  update boxes[box] { authorizedAt: now }

mutation logVisit(box: boxes, renter: principal, signature: image <=5000000, idPhoto: image <=5000000):
  require exists roles[viewer, role = 'attendant'] else ATTENDANT_ONLY
  b = boxes[box] ! else NOT_FOUND
  require b.drilledAt = null else BOX_DRILLED
  require exists members[box, renter] else NOT_A_RENTER
  return insert visits { box, renter, attendant: viewer, signature, idPhoto, at: now }

mutation attestPresence(box: boxes):
  require exists roles[viewer, role = 'officer'] else OFFICER_ONLY
  b = boxes[box] ! else NOT_FOUND
  require b.authorizedAt != null and not b.paid and b.drilledAt = null else NOT_AUTHORIZED
  return upsert presence[box, viewer] { box, officer: viewer, at: now }

mutation completeDrilling(box: boxes, secondOfficer: principal, photos: [image <=5000000] <=6, notes: text 5..1000):
  require exists roles[viewer, role = 'officer'] else OFFICER_ONLY
  b = boxes[box] ! else NOT_FOUND
  require b.authorizedAt != null and not b.paid and b.drilledAt = null else NOT_AUTHORIZED
  require viewer != secondOfficer else TWO_DISTINCT_OFFICERS
  require exists roles[secondOfficer, role = 'officer'] else OFFICER_ONLY
  a = presence[box, viewer] ! else PRESENCE_REQUIRED
  c = presence[box, secondOfficer] ! else PRESENCE_REQUIRED
  require a.at >= now - 1h and c.at >= now - 1h else PRESENCE_EXPIRED
  require len(photos) >= 1 else PHOTO_REQUIRED
  require len(trim(notes)) >= 5 else NOTES_REQUIRED
  insert contents { box, officerOne: viewer, officerTwo: secondOfficer, recordedBy: viewer, photos, notes, at: now }
  update boxes[box] { drilledAt: now }

-- Independent intent: a renter can never read another renter's visit or ID.
invariant visits.read only .renter = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
-- Contents and their media are never visible to attendants or renters.
invariant contents.read only exists roles[viewer, role = 'officer'] or exists roles[viewer, role = 'manager']
invariant members.insert only exists roles[viewer, role = 'manager'] and .addedBy = viewer
invariant authorizations.insert only exists roles[viewer, role = 'manager'] and .manager = viewer
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
invariant presence.insert only exists roles[viewer, role = 'officer'] and .officer = viewer
invariant boxes.read only exists members[.id, viewer] or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'officer']
