use identity password

table people:
  principal: principal
  name: text 1..80
  role: enum('client', 'scheduler', 'inspector', 'manager')
  branch: enum('north', 'south')
  unique principal
  immutable principal, role, branch, name
  read <- .principal = viewer or exists people[principal = viewer, branch = .branch, role = 'scheduler'] or exists people[principal = viewer, branch = .branch, role = 'inspector'] or exists people[principal = viewer, branch = .branch, role = 'manager'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  online only

table inspections:
  client: principal
  inspector: principal
  scheduler: principal
  branch: enum('north', 'south')
  site: text 1..160
  address: text 5..300
  siteType: enum('home', 'hotel')
  bookedAt: time
  feeCents: int 100..10000000
  authorization: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg')
  status: enum('booked', 'inspected', 'written', 'issued') default 'booked'
  inspectedAt: time ?
  reportDueAt: time ?
  report: text 10..10000 ?
  issuedAt: time ?
  expiresAt: time ?
  revision: int 0.. default 0
  createdAt: time default now
  immutable client, inspector, scheduler, branch, site, address, siteType, bookedAt, feeCents, authorization, createdAt
  read <- .client = viewer or exists people[principal = viewer, branch = .branch, role = 'scheduler'] or exists people[principal = viewer, branch = .branch, role = 'inspector'] or exists people[principal = viewer, branch = .branch, role = 'manager']
  insert <- .scheduler = viewer and exists people[principal = viewer, branch = .branch, role = 'scheduler']
  update <- (.inspector = viewer and exists people[principal = viewer, branch = .branch, role = 'inspector']) or exists people[principal = viewer, branch = .branch, role = 'manager']
  online only

table amendments:
  inspection: inspections
  client: principal
  branch: enum('north', 'south')
  requestedBy: principal
  reason: text 5..1000
  proposedReport: text 10..10000
  baseRevision: int 0..
  requestedAt: time default now
  approvedBy: principal ?
  approvedAt: time ?
  immutable inspection, client, branch, requestedBy, reason, proposedReport, baseRevision, requestedAt
  read <- .client = viewer or exists people[principal = viewer, branch = .branch, role = 'scheduler'] or exists people[principal = viewer, branch = .branch, role = 'inspector'] or exists people[principal = viewer, branch = .branch, role = 'manager']
  insert <- .requestedBy = viewer and exists people[principal = viewer, branch = .branch, role = 'inspector']
  update <- exists people[principal = viewer, branch = .branch, role = 'manager']
  online only

mutation provision(principal: principal, role: enum('client', 'scheduler', 'inspector', 'manager'), branch: enum('north', 'south'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert people {principal, role, branch, name}

query me():
  return people[principal = viewer]

query directory(c: cursor ?):
  p = people[principal = viewer] ! else NOT_ENROLLED
  require p.role != 'client' else STAFF_ONLY
  return people where .branch = p.branch last 50 by .id after c

shape inspectionCard = { *, overdue: .reportDueAt != null and now > .reportDueAt and (.issuedAt = null or .issuedAt > .reportDueAt), expired: .expiresAt != null and now >= .expiresAt }

query board(c: cursor ?):
  p = people[principal = viewer] ! else NOT_ENROLLED
  if p.role = 'client':
    return inspections where .client = viewer last 50 by .id after c inspectionCard
  require exists people[principal = viewer, branch = p.branch, role = 'scheduler'] or exists people[principal = viewer, branch = p.branch, role = 'inspector'] or exists people[principal = viewer, branch = p.branch, role = 'manager'] else STAFF_ONLY
  return inspections where .branch = p.branch last 50 by .id after c inspectionCard

query inspection(inspection: inspections):
  return inspections[inspection] inspectionCard

query history(inspection: inspections, c: cursor ?):
  i = inspections[inspection] ! else NOT_FOUND
  return amendments where .inspection = i.id last 50 by .id after c

mutation book(client: principal, inspector: principal, site: text 1..160, address: text 5..300, siteType: enum('home', 'hotel'), bookedAt: time, feeCents: int 100..10000000, authorization: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg')):
  p = people[principal = viewer] ! else NOT_ENROLLED
  require p.role = 'scheduler' else SCHEDULER_ONLY
  require exists people[principal = client, role = 'client', branch = p.branch] else INVALID_CLIENT
  require exists people[principal = inspector, role = 'inspector', branch = p.branch] else INVALID_INSPECTOR
  require bookedAt >= now - 5m and bookedAt <= now + 365d else BOOKING_WINDOW
  require len(trim(site)) >= 1 and len(trim(address)) >= 5 else SITE_DETAILS_REQUIRED
  return insert inspections {client, inspector, scheduler: viewer, branch: p.branch, site, address, siteType, bookedAt, feeCents, authorization}

mutation inspect(inspection: inspections):
  i = inspections[inspection] ! else NOT_FOUND
  require i.inspector = viewer and exists people[principal = viewer, role = 'inspector', branch = i.branch] else ASSIGNED_INSPECTOR_ONLY
  require i.status = 'booked' else WRONG_STAGE
  require now >= i.bookedAt else NOT_YET_BOOKED_TIME
  update inspections[i.id] {status: 'inspected', inspectedAt: now, reportDueAt: now + 3d}

mutation writeReport(inspection: inspections, report: text 10..10000):
  i = inspections[inspection] ! else NOT_FOUND
  require i.inspector = viewer and exists people[principal = viewer, role = 'inspector', branch = i.branch] else ASSIGNED_INSPECTOR_ONLY
  require i.status = 'inspected' or i.status = 'written' else WRONG_STAGE
  require len(trim(report)) >= 10 else REPORT_REQUIRED
  update inspections[i.id] {status: 'written', report: trim(report)}

fn anniversary(t: time):
  candidate = monthStart(month(t) + 24) + (t - monthStart(month(t)))
  limit = monthStart(month(t) + 25)
  return candidate if candidate < limit else limit - 1d + (t % 1d)

mutation issue(inspection: inspections):
  i = inspections[inspection] ! else NOT_FOUND
  require i.inspector = viewer and exists people[principal = viewer, role = 'inspector', branch = i.branch] else ASSIGNED_INSPECTOR_ONLY
  require i.status = 'written' and i.report != null else WRONG_STAGE
  update inspections[i.id] {status: 'issued', issuedAt: now, expiresAt: anniversary(now), revision: 1}

mutation requestAmendment(inspection: inspections, reason: text 5..1000, proposedReport: text 10..10000):
  i = inspections[inspection] ! else NOT_FOUND
  require i.inspector = viewer and exists people[principal = viewer, role = 'inspector', branch = i.branch] else ASSIGNED_INSPECTOR_ONLY
  require i.status = 'issued' else NOT_ISSUED
  require len(trim(reason)) >= 5 and len(trim(proposedReport)) >= 10 else AMENDMENT_DETAILS_REQUIRED
  return insert amendments {inspection, client: i.client, branch: i.branch, requestedBy: viewer, reason, proposedReport, baseRevision: i.revision}

mutation approveAmendment(amendment: amendments):
  a = amendments[amendment] ! else NOT_FOUND
  require exists people[principal = viewer, role = 'manager', branch = a.branch] else BRANCH_MANAGER_ONLY
  require a.approvedAt = null else ALREADY_APPROVED
  i = inspections[a.inspection] ! else NOT_FOUND
  require i.status = 'issued' and i.revision = a.baseRevision else STALE_REQUEST
  update amendments[a.id] {approvedBy: viewer, approvedAt: now}
  update inspections[i.id] {report: a.proposedReport, revision: i.revision + 1}

-- Independent intent: a client must never observe another client's job or audit.
invariant inspections.read only not exists people[principal = viewer, role = 'client'] or .client = viewer
invariant amendments.read only not exists people[principal = viewer, role = 'client'] or .client = viewer
-- Signed evidence and a positive inspection fee are mandatory at opening.
invariant inspections always .authorization != null and .feeCents >= 100
-- An issued report can only change under its branch manager's authority.
invariant inspections.report update only .status != 'issued' or exists people[principal = viewer, role = 'manager', branch = .branch]
invariant amendments.approvedBy write only exists people[principal = viewer, role = 'manager', branch = .branch]
invariant amendments.approvedAt write only exists people[principal = viewer, role = 'manager', branch = .branch]
invariant people.role write only viewer = 'service:operator'
