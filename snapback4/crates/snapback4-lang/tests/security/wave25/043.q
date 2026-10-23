use identity password

-- Roles are granted only by the local company operator, never by signup.
table roles:
  principal: principal
  role: enum('client', 'scheduler', 'inspector', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'manager'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

fn staff(): exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'manager']
fn inspector(): exists roles[viewer, role = 'inspector']
fn manager(): exists roles[viewer, role = 'manager']

table inspections:
  client: principal
  inspector: principal
  address: text 5..240
  scheduledAt: time
  feeCents: int 1..1000000
  authorization: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png') ?
  status: enum('booked', 'inspected', 'written', 'issued') default 'booked'
  inspectedAt: time ?
  findings: text 10..10000 ?
  outcome: enum('clear', 'activity') ?
  issuedAt: time ?
  firstIssuedAt: time ?
  revision: int 0.. default 0
  createdAt: time default now
  immutable client, inspector, address, scheduledAt, feeCents, createdAt
  read <- .client = viewer or (exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'manager'])
  insert <- exists roles[viewer, role = 'scheduler']
  update (old, next) <- exists roles[viewer, role = 'scheduler'] or (old.authorization = next.authorization and ((exists roles[viewer, role = 'inspector'] and old.inspector = viewer) or exists roles[viewer, role = 'manager']))
  online only

table amendments:
  inspection: inspections
  client: principal
  requestedBy: principal
  reason: text 10..1000
  findings: text 10..10000
  outcome: enum('clear', 'activity')
  originalFindings: text 10..10000
  originalOutcome: enum('clear', 'activity')
  originalIssuedAt: time
  requestedAt: time default now
  revision: int 1..
  approvedBy: principal ?
  approvedAt: time ?
  immutable inspection, client, requestedBy, reason, findings, outcome, originalFindings, originalOutcome, originalIssuedAt, requestedAt, revision
  read <- .client = viewer or (exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'manager'])
  insert <- exists roles[viewer, role = 'inspector'] and .requestedBy = viewer
  update <- exists roles[viewer, role = 'manager']
  online only

invariant inspections.read only .client = viewer or (exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'manager'])
invariant inspections.book only exists roles[viewer, role = 'scheduler']
invariant inspections.markInspected only exists roles[viewer, role = 'inspector'] and .inspector = viewer
invariant inspections.writeReport only exists roles[viewer, role = 'inspector'] and .inspector = viewer
invariant inspections.issueReport only exists roles[viewer, role = 'inspector'] and .inspector = viewer
invariant inspections.approveAmendment only exists roles[viewer, role = 'manager']
invariant amendments.read only .client = viewer or (exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'manager'])
invariant amendments.approveAmendment only exists roles[viewer, role = 'manager']
invariant roles.role write only viewer = 'service:operator'

shape inspectionCard = { *, authorizationMissing: .authorization = null, overdue: .inspectedAt != null and ((.firstIssuedAt = null and now > .inspectedAt + 3d) or (.firstIssuedAt != null and .firstIssuedAt > .inspectedAt + 3d)), dueAt: .inspectedAt + 3d if .inspectedAt != null else null, expiresAt: .issuedAt + 30d if .issuedAt != null and .outcome = 'clear' else null, clearValid: .status = 'issued' and .outcome = 'clear' and .issuedAt != null and now < .issuedAt + 30d }

mutation provision(principal: principal, role: enum('client', 'scheduler', 'inspector', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }
query myRole():
  return roles[principal = viewer]
query directory():
  require staff() else STAFF_ONLY
  return roles first 200 by .id
query board(c: cursor ?):
  return inspections last 100 by .createdAt after c inspectionCard
query inspection(inspection: inspections):
  return inspections[inspection] inspectionCard
query amendmentHistory(inspection: inspections):
  row = inspections[inspection] ! else NOT_FOUND
  return amendments where .inspection = row.id last 100 by .requestedAt
query verifyClear(inspection: inspections):
  row = inspections[inspection] ! else NOT_FOUND
  require row.status = 'issued' and row.outcome = 'clear' and row.issuedAt != null else NOT_CLEAR
  require now < row.issuedAt + 30d else REPORT_EXPIRED
  return { valid: true, expiresAt: row.issuedAt + 30d, revision: row.revision }

mutation book(client: principal, inspector: principal, address: text 5..240, scheduledAt: time, feeCents: int 1..1000000, authorization: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png') ?):
  require exists roles[viewer, role = 'scheduler'] else SCHEDULER_ONLY
  require exists roles[principal = client, role = 'client'] else INVALID_CLIENT
  require exists roles[principal = inspector, role = 'inspector'] else INVALID_INSPECTOR
  require scheduledAt >= now - 5m and scheduledAt <= now + 90d else INVALID_APPOINTMENT
  return insert inspections { client, inspector, address, scheduledAt, feeCents, authorization }
mutation markInspected(inspection: inspections):
  require inspector() else INSPECTOR_ONLY
  row = inspections[inspection] ! else NOT_FOUND
  require row.inspector = viewer else NOT_ASSIGNED
  require row.status = 'booked' else WRONG_STAGE
  require now >= row.scheduledAt else TOO_EARLY
  update inspections[inspection] { status: 'inspected', inspectedAt: now }
mutation writeReport(inspection: inspections, findings: text 10..10000, outcome: enum('clear', 'activity')):
  require inspector() else INSPECTOR_ONLY
  row = inspections[inspection] ! else NOT_FOUND
  require row.inspector = viewer else NOT_ASSIGNED
  require row.status = 'inspected' or row.status = 'written' else WRONG_STAGE
  update inspections[inspection] { status: 'written', findings, outcome }
mutation issueReport(inspection: inspections):
  require inspector() else INSPECTOR_ONLY
  row = inspections[inspection] ! else NOT_FOUND
  require row.inspector = viewer else NOT_ASSIGNED
  require row.status = 'written' else WRONG_STAGE
  update inspections[inspection] { status: 'issued', issuedAt: now, firstIssuedAt: now, revision: 1 }
mutation requestAmendment(inspection: inspections, reason: text 10..1000, findings: text 10..10000, outcome: enum('clear', 'activity')):
  require inspector() else INSPECTOR_ONLY
  row = inspections[inspection] ! else NOT_FOUND
  require row.inspector = viewer else NOT_ASSIGNED
  require row.status = 'issued' else WRONG_STAGE
  require not exists amendments[inspection = inspection, approvedAt = null] else REQUEST_PENDING
  return insert amendments { inspection, client: row.client, requestedBy: viewer, reason, findings, outcome, originalFindings: row.findings ! else NO_REPORT, originalOutcome: row.outcome ! else NO_REPORT, originalIssuedAt: row.issuedAt ! else NO_REPORT, revision: row.revision }
mutation approveAmendment(amendment: amendments):
  require manager() else MANAGER_ONLY
  request = amendments[amendment] ! else NOT_FOUND
  require request.approvedAt = null else ALREADY_APPROVED
  row = inspections[request.inspection] ! else NOT_FOUND
  require row.status = 'issued' and row.revision = request.revision else STALE_REQUEST
  update inspections[row.id] { findings: request.findings, outcome: request.outcome, issuedAt: now, revision: row.revision + 1 }
  update amendments[amendment] { approvedBy: viewer, approvedAt: now }

-- Only schedulers change authorization; report workflow never patches this field.
mutation setAuthorization(inspection: inspections, authorization: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png') ?):
  require exists roles[viewer, role = 'scheduler'] else SCHEDULER_ONLY
  row = inspections[inspection] ! else NOT_FOUND
  update inspections[inspection] { authorization }
invariant inspections.setAuthorization only exists roles[viewer, role = 'scheduler']
