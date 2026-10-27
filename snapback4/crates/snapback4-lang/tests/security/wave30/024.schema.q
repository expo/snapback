use identity password

table roles:
  principal: principal
  role: enum('surveyor', 'installer', 'operations', 'client')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or (.principal = viewer and .role = 'client')
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('surveyor', 'installer', 'operations', 'client')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

mutation registerClient():
  if exists roles[viewer]:
    return roles[viewer]
  return insert roles { principal: viewer, role: 'client' }

query myRole():
  return roles[viewer]

query clients(c: cursor ?):
  require exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'operations'] else STAFF_ONLY
  return roles where .role = 'client' last 100 by .id after c

table installs:
  client: principal
  surveyor: principal
  title: text 3..100
  address: text 5..240
  equipment: text 3..300
  weightKg: int 1..2000
  accessNotes: text 3..1500
  equipmentPhoto: image <=10000000
  doorwayPhoto: image <=10000000
  stairwayPhoto: image <=10000000
  phone: text 7..30
  alarmCode: text 1..80
  quoteCents: int 1..100000000
  status: enum('surveyed', 'delivered', 'anchored') default 'surveyed'
  surveyedAt: time default now
  deliveredAt: time ?
  installedAt: time ?
  anchorDueAt: time ?
  immutable client, surveyor, title, address, equipment, weightKg, accessNotes, equipmentPhoto, doorwayPhoto, stairwayPhoto, phone, alarmCode, quoteCents, surveyedAt
  read <- .client = viewer or exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']
  read (phone, alarmCode, quoteCents) <- exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'operations']
  insert <- .surveyor = viewer and exists roles[viewer, role = 'surveyor'] and exists roles[.client, role = 'client'] and .status = 'surveyed'
  update <- exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']
  online only

invariant installs.read only .client = viewer or exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']
invariant installs.phone read only exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'operations']
invariant installs.alarmCode read only exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'operations']
invariant installs.quoteCents read only exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'operations']
invariant installs.insert only exists roles[viewer, role = 'surveyor']
invariant installs.update only exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']
invariant installs always .equipmentPhoto != null and .doorwayPhoto != null and .stairwayPhoto != null

query board(c: cursor ?):
  if exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']:
    return installs last 50 by .id after c
  return installs where .client = viewer last 50 by .id after c

query install(install: installs):
  return installs[install]

mutation openInstall(client: principal, title: text 3..100, address: text 5..240, equipment: text 3..300, weightKg: int 1..2000, accessNotes: text 3..1500, phone: text 7..30, alarmCode: text 1..80, quoteCents: int 1..100000000, equipmentPhoto: image <=10000000, doorwayPhoto: image <=10000000, stairwayPhoto: image <=10000000):
  require exists roles[viewer, role = 'surveyor'] else SURVEYOR_ONLY
  require exists roles[client, role = 'client'] else CLIENT_REQUIRED
  return insert installs { client, surveyor: viewer, title, address, equipment, weightKg, accessNotes, phone, alarmCode, quoteCents, equipmentPhoto, doorwayPhoto, stairwayPhoto }

mutation advanceInstall(install: installs):
  require exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations'] else INSTALLER_ONLY
  row = installs[install] { id, status, client } ! else NOT_FOUND
  if row.status = 'surveyed':
    update installs[install] { status: 'delivered', deliveredAt: now }
  elif row.status = 'delivered':
    update installs[install] { status: 'anchored', installedAt: now, anchorDueAt: now + 60d }
    insert visits { install, client: row.client, kind: 'anchor', scheduledAt: now + 30d, deadline: now + 60d, notes: 'Check all anchors and wall fixings.' }
  else:
    require false else ALREADY_ANCHORED
  return installs[install]

table visits:
  install: installs
  client: principal
  kind: enum('anchor', 'service')
  scheduledAt: time
  deadline: time ?
  notes: text 3..1000
  completedAt: time ?
  completedBy: principal ?
  immutable install, client, kind, deadline
  read <- .client = viewer or exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']
  insert <- exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']
  update <- exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']
  online only

invariant visits.read only .client = viewer or exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']

query visits(install: installs, c: cursor ?):
  parent = installs[install] { id } ! else NOT_FOUND
  if exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']:
    return visits where .install = parent.id first 100 by .scheduledAt after c
  return visits where .client = viewer and .install = parent.id first 100 by .scheduledAt after c

mutation scheduleService(install: installs, scheduledAt: time, notes: text 3..1000):
  require exists roles[viewer, role = 'operations'] else OPERATIONS_ONLY
  row = installs[install] { id, client, status } ! else NOT_FOUND
  require row.status = 'anchored' else NOT_INSTALLED
  require scheduledAt >= now and scheduledAt <= now + 365d else BAD_VISIT_TIME
  return insert visits { install, client: row.client, kind: 'service', scheduledAt, notes }

mutation rescheduleVisit(visit: visits, scheduledAt: time):
  require exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations'] else INSTALLER_ONLY
  row = visits[visit] ! else NOT_FOUND
  require row.completedAt = null else VISIT_COMPLETED
  require scheduledAt >= now and scheduledAt <= now + 365d else BAD_VISIT_TIME
  if row.kind = 'anchor':
    require row.deadline != null else MISSING_DEADLINE
    require scheduledAt <= row.deadline else ANCHOR_DEADLINE 'Anchor checks must be scheduled within 60 days of installation.'
  update visits[visit] { scheduledAt }
  return visits[visit]

mutation completeVisit(visit: visits, notes: text 3..1000):
  require exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations'] else INSTALLER_ONLY
  row = visits[visit] ! else NOT_FOUND
  require row.completedAt = null else VISIT_COMPLETED
  require now >= row.scheduledAt else VISIT_NOT_DUE
  update visits[visit] { completedAt: now, completedBy: viewer, notes }
  return visits[visit]

table kits:
  install: installs
  client: principal
  approvedBy: principal
  reason: text 5..500
  approvedAt: time default now
  unique install
  immutable install, client, approvedBy, reason, approvedAt
  read <- .client = viewer or exists roles[viewer, role = 'surveyor'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'operations']
  insert <- exists roles[viewer, role = 'operations'] and .approvedBy = viewer
  online only

invariant kits.insert only exists roles[viewer, role = 'operations']
invariant kits.reason write only exists roles[viewer, role = 'operations']

query kit(install: installs):
  parent = installs[install] { id } ! else NOT_FOUND
  return kits[parent.id]

mutation approveKit(install: installs, reason: text 5..500):
  require exists roles[viewer, role = 'operations'] else OPERATIONS_ONLY
  row = installs[install] { id, client } ! else NOT_FOUND
  require not exists kits[install] else KIT_ALREADY_APPROVED
  return insert kits { install, client: row.client, approvedBy: viewer, reason }
