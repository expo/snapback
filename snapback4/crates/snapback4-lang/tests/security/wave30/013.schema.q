use identity password

-- Roles are granted by the local operator, never by signup or a browser.
table roles:
  principal: principal
  role: enum('crew', 'inspector', 'chief')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table ladders:
  owner: principal
  label: text 2..80
  material: enum('aluminum', 'fiberglass', 'wood')
  manufacturedAt: time
  lastInspectionAt: time ?
  active: bool default false
  immutable owner, label, material, manufacturedAt
  read <- .owner = viewer or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
  insert <- .owner = viewer and exists roles[viewer, role = 'crew']
  update <- exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
  online only

table inspections:
  ladder: ladders
  owner: principal
  inspector: principal
  labelPhoto: image <=5000000
  priceCents: int 1..1000000
  repairedRails: bool
  stage: enum('received', 'examined', 'load_tested', 'tagged') default 'received'
  receivedAt: time default now
  examinedAt: time ?
  loadTestedAt: time ?
  testCertificate: text 3..200 ?
  approvalReason: text 10..1000 ?
  approvedBy: principal ?
  approvedAt: time ?
  taggedAt: time ?
  immutable ladder, owner, inspector, labelPhoto, priceCents, repairedRails, receivedAt
  read <- .owner = viewer or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
  insert <- .inspector = viewer and (exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']) and exists ladders[.ladder, owner = .owner]
  update <- exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
  online only

fn anniversary(t: time, months: int):
  target = month(t) + months
  offset = day(t) - day(monthStart(month(t)))
  maxOffset = day(monthStart(target + 1)) - day(monthStart(target)) - 1
  return monthStart(target) + min(offset, maxOffset) * 1d + t % 1d

fn staff():
  require exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief'] else NOT_INSPECTOR

mutation provision(principal: principal, role: enum('crew', 'inspector', 'chief')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query board(c: cursor ?):
  return ladders last 50 by .id after c

query ladderDetail(ladder: ladders):
  return ladders[ladder]

query history(ladder: ladders, c: cursor ?):
  l = ladders[ladder] ! else NOT_FOUND
  return inspections where .ladder = l.id last 50 by .id after c

query shopBoard(c: cursor ?):
  staff()
  return inspections last 50 by .id after c

query inspectionDetail(inspection: inspections):
  return inspections[inspection]

query siteUse(ladder: ladders):
  l = ladders[ladder] ! else NOT_FOUND
  require not l.active else IN_SHOP 'Ladder is held at the shop.'
  require l.lastInspectionAt != null else NEVER_INSPECTED 'No current inspection. Refused for site use.'
  require now <= anniversary(l.lastInspectionAt, 12) else INSPECTION_EXPIRED 'Inspection is older than 12 months. Refused for site use.'
  return { allowed: true, validUntil: anniversary(l.lastInspectionAt, 12) }

mutation registerLadder(label: text 2..80, material: enum('aluminum', 'fiberglass', 'wood'), manufacturedAt: time):
  require exists roles[viewer, role = 'crew'] else NOT_CREW
  require manufacturedAt <= now and manufacturedAt >= now - 36500d else BAD_MANUFACTURE_DATE
  return insert ladders { owner: viewer, label, material, manufacturedAt }

mutation receive(ladder: ladders, labelPhoto: image <=5000000, priceCents: int 1..1000000, repairedRails: bool):
  staff()
  l = ladders[ladder] ! else NOT_FOUND
  require not l.active else ALREADY_IN_SHOP
  update ladders[ladder] { active: true }
  return insert inspections { ladder, owner: l.owner, inspector: viewer, labelPhoto, priceCents, repairedRails }

mutation examine(inspection: inspections):
  staff()
  i = inspections[inspection] ! else NOT_FOUND
  require i.stage != 'tagged' and i.examinedAt = null else BAD_STAGE
  l = ladders[i.ladder] ! else NOT_FOUND
  require l.material != 'fiberglass' or now <= anniversary(l.manufacturedAt, 120) or i.loadTestedAt != null else LOAD_TEST_REQUIRED 'Fiberglass over 10 years needs a load test before examination.'
  update inspections[inspection] { stage: 'examined', examinedAt: now }

mutation loadTest(inspection: inspections, certificate: text 3..200):
  staff()
  i = inspections[inspection] ! else NOT_FOUND
  require i.stage != 'tagged' and i.loadTestedAt = null else BAD_STAGE
  update inspections[inspection] { stage: 'load_tested', loadTestedAt: now, testCertificate: certificate }

mutation approveRepair(inspection: inspections, reason: text 10..1000):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF
  i = inspections[inspection] ! else NOT_FOUND
  require i.stage != 'tagged' and i.repairedRails and i.approvedAt = null else BAD_STAGE
  require i.examinedAt != null and i.loadTestedAt != null and i.testCertificate != null else TEST_AND_EXAM_REQUIRED
  update inspections[inspection] { approvalReason: reason, approvedBy: viewer, approvedAt: now }

mutation tag(inspection: inspections):
  staff()
  i = inspections[inspection] ! else NOT_FOUND
  require i.stage != 'tagged' and i.examinedAt != null else EXAM_REQUIRED
  l = ladders[i.ladder] ! else NOT_FOUND
  require l.material != 'fiberglass' or now <= anniversary(l.manufacturedAt, 120) or i.loadTestedAt != null else LOAD_TEST_REQUIRED
  require not i.repairedRails or i.approvedAt != null else CHIEF_APPROVAL_REQUIRED
  update inspections[inspection] { stage: 'tagged', taggedAt: now }
  update ladders[i.ladder] { lastInspectionAt: now, active: false }

-- Independent product intent, checked separately from operation bodies.
invariant ladders.read only .owner = viewer or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
invariant inspections.read only .owner = viewer or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
invariant inspections.approvedBy write only exists roles[viewer, role = 'chief']
invariant inspections.approvedAt write only exists roles[viewer, role = 'chief']
invariant inspections.approvalReason write only exists roles[viewer, role = 'chief']
invariant inspections always .labelPhoto != null
invariant roles.role write only viewer = 'service:operator'
