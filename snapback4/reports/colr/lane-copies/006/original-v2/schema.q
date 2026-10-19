use identity password

table roles:
  principal: principal
  role: enum('parent', 'monitor', 'supervisor', 'safety')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('parent', 'monitor', 'supervisor', 'safety')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table children:
  parent: principal
  name: text 1..80
  immutable parent, name
  read <- (.parent = viewer and exists roles[viewer, role = 'parent']) or exists roles[viewer, role = 'monitor'] or exists roles[viewer, role = 'supervisor'] or exists roles[viewer, role = 'safety']
  insert <- .parent = viewer and exists roles[viewer, role = 'parent']
  online only

mutation addChild(name: text 1..80):
  require exists roles[viewer, role = 'parent'] else NOT_PARENT
  return insert children { parent: viewer, name }

query listChildren():
  return children first 200 by .id

table waivers:
  child: children
  parent: principal
  signature: text 2..100
  signedAt: time
  expiresAt: time
  immutable child, parent, signature, signedAt, expiresAt
  read <- .parent = viewer and exists roles[viewer, role = 'parent']
  insert <- .parent = viewer and .child.parent = viewer and exists roles[viewer, role = 'parent']
  online only

mutation signWaiver(child: children, signature: text 2..100):
  c = children[child] ! else NOT_FOUND
  require c.parent = viewer else NOT_PARENT
  anniversaryMonth = month(now) + 12
  dayIndex = day(now) - day(monthStart(month(now)))
  monthDays = day(monthStart(anniversaryMonth + 1)) - day(monthStart(anniversaryMonth))
  expiry = monthStart(anniversaryMonth) + min(dayIndex, monthDays - 1) * 1d + now % 1d
  return insert waivers { child, parent: viewer, signature, signedAt: now, expiresAt: expiry }

query listWaivers():
  return waivers where .parent = viewer last 200 by .id

table courts:
  name: text 1..80
  closed: bool default false
  unique name
  immutable name
  read <- exists roles[viewer]
  insert <- viewer = 'service:operator'
  update <- exists roles[viewer, role = 'safety']
  online only

mutation provisionCourt(name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert courts { name }

query listCourts():
  return courts first 100 by .id

table bookings:
  child: children
  parent: principal
  court: courts
  waiver: waivers
  startsAt: time
  priceCents: int 1800..1800
  immutable child, parent, court, waiver, startsAt, priceCents
  read <- .parent = viewer and exists roles[viewer, role = 'parent']
  insert <- .parent = viewer and .child.parent = viewer and exists roles[viewer, role = 'parent']
  online only

mutation buySession(child: children, court: courts, waiver: waivers, startsAt: time):
  require exists roles[viewer, role = 'parent'] else NOT_PARENT
  c = children[child] ! else NOT_FOUND
  require c.parent = viewer else NOT_PARENT
  w = waivers[waiver] ! else NOT_FOUND
  require w.child = child and w.parent = viewer else WRONG_WAIVER
  require w.expiresAt > now and w.expiresAt >= startsAt + 1h else WAIVER_EXPIRED
  require startsAt >= now and startsAt <= now + 30d else SESSION_WINDOW
  area = courts[court] ! else NOT_FOUND
  require not area.closed else COURT_CLOSED
  return insert bookings { child, parent: viewer, court, waiver, startsAt, priceCents: 1800 }

query listBookings():
  return bookings where .parent = viewer last 200 by .id

table reports:
  child: children
  court: courts
  author: principal
  summary: text 5..2000
  injury: bool
  photo: image <=5000000
  filedAt: time
  immutable child, court, author, summary, injury, photo, filedAt
  read <- (.author = viewer and exists roles[viewer, role = 'monitor']) or exists roles[viewer, role = 'supervisor'] or exists roles[viewer, role = 'safety']
  insert <- .author = viewer and exists roles[viewer, role = 'monitor']
  online only

-- Redacted parent projection. The original report remains the single immutable
-- asset home so ids/bytes survive both release directions without re-uploading.
table parentReports:
  report: reports
  child: children
  parent: principal
  court: courts
  author: principal
  summary: text 5..2000
  injury: bool
  filedAt: time
  unique report
  immutable report, child, parent, court, author, summary, injury, filedAt
  read <- .parent = viewer and exists roles[viewer, role = 'parent']
  insert <- .author = viewer and exists roles[viewer, role = 'monitor'] and created reports[id = .report, author = viewer]
  online only

-- System job visits the complete population, including closed courts, in
-- resumable server-managed chunks. It also catches reports written under v1.
job migrateAreaEvidence():
  for r in reports:
    c = children[r.child] ! else NOT_FOUND
    upsert parentReports[report = r.id] { report: r.id, child: r.child, parent: c.parent, court: r.court, author: r.author, summary: r.summary, injury: r.injury, filedAt: r.filedAt }

table witnesses:
  report: reports
  statement: text 1..4000
  immutable report, statement
  unique report
  read <- exists roles[viewer, role = 'supervisor'] or exists roles[viewer, role = 'safety']
  insert <- .report.author = viewer and exists roles[viewer, role = 'monitor']
  online only

mutation fileReport(child: children, court: courts, summary: text 5..2000, injury: bool, photo: image <=5000000, statement: text 1..4000):
  require exists roles[viewer, role = 'monitor'] else NOT_MONITOR
  require exists children[child] and exists courts[court] else NOT_FOUND
  r = insert reports { child, court, author: viewer, summary, injury, photo, filedAt: now }
  insert witnesses { report: r.id, statement }
  c = children[child] ! else NOT_FOUND
  insert parentReports { report: r.id, child, parent: c.parent, court, author: viewer, summary, injury, filedAt: r.filedAt }
  return r

-- The supported v2 report shape names the image by its purpose. The legacy
-- photo storage cell and fileReport mutation remain a compatibility boundary.
shape evidenceReport = { id, child, court, author, summary, injury, filedAt, areaEvidencePhoto: .photo }
shape parentReport = { id: .report, child, court, author, summary, injury, filedAt, areaEvidencePhoto: null }

mutation fileEvidenceReport(child: children, court: courts, summary: text 5..2000, injury: bool, areaEvidencePhoto: image <=5000000, statement: text 1..4000):
  require exists roles[viewer, role = 'monitor'] else NOT_MONITOR
  require exists children[child] and exists courts[court] else NOT_FOUND
  r = insert reports { child, court, author: viewer, summary, injury, photo: areaEvidencePhoto, filedAt: now }
  insert witnesses { report: r.id, statement }
  c = children[child] ! else NOT_FOUND
  insert parentReports { report: r.id, child, parent: c.parent, court, author: viewer, summary, injury, filedAt: r.filedAt }
  return r evidenceReport

query listReports():
  if exists roles[viewer, role = 'parent']:
    return parentReports last 200 by .report parentReport
  return reports last 200 by .id evidenceReport

query reportById(report: reports):
  if exists roles[viewer, role = 'parent']:
    p = parentReports[report = report]
    return p parentReport
  return reports[report] evidenceReport

query listWitnesses(report: reports):
  return witnesses where .report = report first 1 by .id

table courtHistory:
  court: courts
  actor: principal
  closed: bool
  reason: text 5..1000
  incident: reports ?
  at: time
  immutable court, actor, closed, reason, incident, at
  read <- exists roles[viewer, role = 'supervisor'] or exists roles[viewer, role = 'safety']
  insert <- .actor = viewer and exists roles[viewer, role = 'safety']
  online only

mutation changeCourt(court: courts, closed: bool, reason: text 5..1000, incident: reports ?):
  require exists roles[viewer, role = 'safety'] else NOT_SAFETY
  c = courts[court] ! else NOT_FOUND
  require c.closed != closed else ALREADY_IN_STATE
  if closed:
    require incident != null else INJURY_REQUIRED
    r = reports[incident] ! else NOT_FOUND
    require r.court = court and r.injury else INJURY_REQUIRED
  if not closed:
    require incident = null else REOPEN_WITHOUT_INCIDENT
  update courts[court] { closed }
  return insert courtHistory { court, actor: viewer, closed, reason, incident, at: now }

query listHistory(court: courts):
  return courtHistory where .court = court last 200 by .id

-- Independent privacy and authority assertions from the product specification.
invariant waivers.read only .parent = viewer and exists roles[viewer, role = 'parent']
invariant bookings.read only .parent = viewer and exists roles[viewer, role = 'parent']
invariant witnesses.read only exists roles[viewer, role = 'supervisor'] or exists roles[viewer, role = 'safety']
invariant reports.read only (.author = viewer and exists roles[viewer, role = 'monitor']) or (.child.parent = viewer and exists roles[viewer, role = 'parent']) or exists roles[viewer, role = 'supervisor'] or exists roles[viewer, role = 'safety']
invariant courts.update only exists roles[viewer, role = 'safety']
invariant courtHistory.insert only exists roles[viewer, role = 'safety']
invariant roles.role write only viewer = 'service:operator'

invariant parentReports.read only .parent = viewer and exists roles[viewer, role = 'parent']
