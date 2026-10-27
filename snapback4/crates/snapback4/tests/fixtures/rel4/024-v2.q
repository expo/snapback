-- Home Sauna Installs (v2).
-- Roles: surveyor, installer, client, manager (operations manager).
-- A surveyor opens each install with a site photo survey (room, doorway and
-- stairway photos) plus the quoted price. Installers see each install's
-- photos, heater size and wiring notes, but not the client's phone number,
-- alarm code or price: those columns are readable only by the assigned
-- surveyor and the operations manager. Clients see only their own installs
-- and service visits. A heater safety check is due within 60 days of each
-- install. Only the operations manager can approve a free backrest kit, with
-- the reason recorded.
-- v2: each install's photos live in a separate site photo survey attached to
-- that install. Every install starts with one survey covering the three
-- areas; further surveys may be added. Only the surveyor may change a saved
-- survey; installers may view it but cannot change it.
use identity password

table roles:
  principal: principal
  role: enum('surveyor', 'installer', 'client', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('surveyor', 'installer', 'client', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table installs:
  client: principal
  surveyor: principal
  survey: photoSurveys ? on delete set null
  status: enum('surveyed', 'delivered', 'wired') default 'surveyed'
  priceCents: int 1..100000000 read <- .surveyor = viewer or exists roles[principal = viewer, role = 'manager']
  heaterSize: text 1..40
  wiringNotes: text 1..1000
  phone: text 1..30 read <- .surveyor = viewer or exists roles[principal = viewer, role = 'manager']
  alarmCode: text 1..20 read <- .surveyor = viewer or exists roles[principal = viewer, role = 'manager']
  createdAt: time default now
  immutable client, surveyor, createdAt
  read <- .client = viewer or .surveyor = viewer or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:operator'
  insert <- exists roles[principal = viewer, role = 'surveyor']
  update <- .surveyor = viewer or exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'manager']
  cap 10000 by client
  online only

table photoSurveys:
  install: installs on delete cascade
  roomPhoto: text 1..500
  doorwayPhoto: text 1..500
  stairwayPhoto: text 1..500
  immutable install
  read <- .install.client = viewer or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'surveyor'] or viewer = 'service:operator'
  update <- exists roles[principal = viewer, role = 'surveyor']
  cap 200 by install
  online only

down installs coverPhoto(survey: photoSurveys): {roomPhoto: survey.roomPhoto, doorwayPhoto: survey.doorwayPhoto, stairwayPhoto: survey.stairwayPhoto}

query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'client']:
    return installs where .client = viewer last 50 by .id after c
  return installs last 50 by .id after c

query installDetail(install: installs):
  return installs[install]

query surveysOf(install: installs, c: cursor ?):
  return photoSurveys where .install = install last 50 by .id after c

mutation openInstall(client: principal, roomPhoto: text 1..500, doorwayPhoto: text 1..500, stairwayPhoto: text 1..500, priceCents: int 1..100000000, heaterSize: text 1..40, wiringNotes: text 1..1000, phone: text 1..30, alarmCode: text 1..20):
  require exists roles[principal = viewer, role = 'surveyor'] else NOT_SURVEYOR
  inst = insert installs { client, surveyor: viewer, priceCents, heaterSize, wiringNotes, phone, alarmCode }
  surv = insert photoSurveys { install: inst.id, roomPhoto, doorwayPhoto, stairwayPhoto }
  update inst { survey: surv.id }
  return inst

mutation addPhotoSurvey(install: installs, roomPhoto: text 1..500, doorwayPhoto: text 1..500, stairwayPhoto: text 1..500):
  require exists roles[principal = viewer, role = 'surveyor'] else NOT_SURVEYOR
  i = installs[install] ! else NOT_FOUND
  return insert photoSurveys { install: i.id, roomPhoto, doorwayPhoto, stairwayPhoto }

mutation updatePhotoSurvey(survey: photoSurveys, roomPhoto: text 1..500, doorwayPhoto: text 1..500, stairwayPhoto: text 1..500):
  require exists roles[principal = viewer, role = 'surveyor'] else NOT_SURVEYOR
  s = photoSurveys[survey] ! else NOT_FOUND
  update s { roomPhoto, doorwayPhoto, stairwayPhoto }
  return null

mutation migratePhotoSurvey(install: installs, roomPhoto: text 1..500, doorwayPhoto: text 1..500, stairwayPhoto: text 1..500):
  require viewer = 'service:operator' else NOT_OPERATOR
  i = installs[install] ! else NOT_FOUND
  return insert photoSurveys { install: i.id, roomPhoto, doorwayPhoto, stairwayPhoto }

mutation advanceStatus(install: installs):
  require exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'manager'] else NOT_INSTALLER
  i = installs[install] ! else NOT_FOUND
  require i.status != 'wired' else ALREADY_WIRED
  if i.status = 'surveyed':
    update installs[install] { status: 'delivered' }
  else:
    update installs[install] { status: 'wired' }
  return null

table visits:
  install: installs on delete cascade
  client: principal
  visitedAt: time default now
  notes: text 1..1000
  immutable install, client
  read <- .client = viewer or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager']
  cap 200 by install
  online only

query visitsOf(install: installs, c: cursor ?):
  return visits where .install = install last 50 by .id after c

mutation scheduleVisit(install: installs, notes: text 1..1000):
  require exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager'] else NOT_SCHEDULER
  i = installs[install] ! else NOT_FOUND
  return insert visits { install, client: i.client, notes }

table safetyChecks:
  install: installs on delete cascade
  checkedAt: time default now
  notes: text 1..500
  unique install
  immutable install
  read <- .install.client = viewer or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'manager']
  cap 5000 by install
  online only

query safetyOf(target: installs):
  return safetyChecks[install = target]

mutation recordSafetyCheck(install: installs, notes: text 1..500):
  require exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'manager'] else NOT_CHECKER
  i = installs[install] ! else NOT_FOUND
  require now <= i.createdAt + 60d else SAFETY_OVERDUE 'Heater safety check is due within 60 days of install.'
  return insert safetyChecks { install, notes }

table backrests:
  install: installs on delete cascade
  reason: text 1..500
  approvedAt: time default now
  unique install
  immutable install
  read <- .install.client = viewer or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'manager']
  cap 5000 by install
  online only

query backrestOf(target: installs):
  return backrests[install = target]

mutation approveBackrest(install: installs, reason: text 1..500):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  i = installs[install] ! else NOT_FOUND
  return insert backrests { install, reason }
