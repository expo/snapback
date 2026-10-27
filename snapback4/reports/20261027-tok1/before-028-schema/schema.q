-- Bandstand Restorations: a heritage carpentry firm restores Victorian park
-- bandstands. The project clerk opens each project with photos of the roof,
-- columns and railings plus the quoted price. The town accepts the quote
-- within 60 days or the estimate lapses. After reopening, the bandstand must
-- be inspected within 12 months; the project stays flagged until the
-- inspection is recorded. Towns see only their own projects and inspections.
-- Carpenters see the live yard board (dismantled -> repaired -> painted ->
-- reopened). Only the master restorer approves replacing an original cast
-- column, recording the heritage officer's approval.
use identity password
use personas clerk, towna, townb, carpenter, master

table staff:
  principal: principal
  role: enum('clerk', 'carpenter', 'master')
  unique principal
  read <- .principal = viewer or exists staff[viewer]
  insert <- exists staff[viewer, role = 'master'] or viewer = 'service:ops'
  update <- exists staff[viewer, role = 'master']
  delete <- exists staff[viewer, role = 'master']
  online only

table projects:
  town: principal
  name: text 1..80
  price: money USD read <- .town = viewer or exists staff[viewer, role = 'clerk'] or exists staff[viewer, role = 'master']
  roofPhoto: image <=10000000
  columnPhoto: image <=10000000
  railingPhoto: image <=10000000
  quotedAt: time default now
  status: enum('estimate', 'accepted', 'dismantled', 'repaired', 'painted', 'reopened', 'lapsed', 'inspected') default 'estimate'
  reopenedAt: time ?
  inspectionDue: time ?
  flagged: bool default false
  immutable town, name, price, roofPhoto, columnPhoto, railingPhoto, quotedAt
  read <- .town = viewer or exists staff[viewer]
  insert <- exists staff[viewer, role = 'clerk']
  update <- exists staff[viewer] or .town = viewer
  cap 1000 by town
  online only

table inspections:
  project: projects
  recordedBy: principal
  inspectedAt: time default now
  late: bool default false
  notes: text 1..500
  unique project
  immutable project, recordedBy, inspectedAt, late, notes
  read <- exists projects[.project, town = viewer] or exists staff[viewer]
  insert <- exists staff[viewer, role = 'clerk'] or exists staff[viewer, role = 'master']
  online only

table columnApprovals:
  project: projects
  column: text 1..120
  heritageApproval: text 1..500
  approvedBy: principal
  approvedAt: time default now
  immutable project, column, heritageApproval, approvedBy, approvedAt
  read <- exists projects[.project, town = viewer] or exists staff[viewer]
  insert <- exists staff[viewer, role = 'master']
  cap 20 by project
  online only

invariant staff.read only .principal = viewer or exists staff[viewer]
invariant projects.read only .town = viewer or exists staff[viewer]
invariant projects.price read only .town = viewer or exists staff[viewer, role = 'clerk'] or exists staff[viewer, role = 'master']
invariant projects.insert only exists staff[viewer, role = 'clerk']
invariant inspections.read only exists projects[.project, town = viewer] or exists staff[viewer]
invariant columnApprovals.insert only exists staff[viewer, role = 'master']

query myRole():
  return staff[principal = viewer]

query townProjects(c: cursor ?):
  return projects where .town = viewer last 50 by .id after c

query yardBoard(c: cursor ?):
  require exists staff[viewer] else NOT_STAFF
  return projects where .status = 'dismantled' or .status = 'repaired' or .status = 'painted' or .status = 'reopened' last 50 by .id after c

query flaggedProjects(c: cursor ?):
  require exists staff[viewer, role = 'clerk'] or exists staff[viewer, role = 'master'] else NOT_STAFF
  return projects where .flagged = true last 50 by .id after c

query projectDetail(project: projects):
  return projects[project]

query projectInspections(project: projects, c: cursor ?):
  return inspections where .project = project last 20 by .id after c

query approvalsFor(project: projects, c: cursor ?):
  return columnApprovals where .project = project last 20 by .id after c

mutation grantStaff(who: principal, role: enum('clerk', 'carpenter', 'master')):
  require exists staff[viewer, role = 'master'] or viewer = 'service:ops' else NOT_MASTER
  return upsert staff[who] { role }

mutation openProject(town: principal, name: text 1..80, price: money USD, roof: image <=10000000, columns: image <=10000000, railings: image <=10000000):
  require exists staff[viewer, role = 'clerk'] else NOT_CLERK
  return insert projects { town, name, price, roofPhoto: roof, columnPhoto: columns, railingPhoto: railings }

mutation acceptQuote(project: projects):
  p = projects[project] ! else NOT_FOUND
  require p.town = viewer else NOT_TOWN
  require p.status = 'estimate' else BAD_STATUS
  require now <= p.quotedAt + 60d else QUOTE_LAPSED
  update projects[project] { status: 'accepted' }
  return null

mutation markEstimateLapsed(project: projects):
  require exists staff[viewer, role = 'clerk'] else NOT_CLERK
  p = projects[project] ! else NOT_FOUND
  require p.status = 'estimate' else BAD_STATUS
  require now > p.quotedAt + 60d else QUOTE_OPEN
  update projects[project] { status: 'lapsed' }
  return null

mutation advanceStage(project: projects, to: enum('dismantled', 'repaired', 'painted')):
  require exists staff[viewer] else NOT_STAFF
  p = projects[project] ! else NOT_FOUND
  require (p.status = 'accepted' and to = 'dismantled') or (p.status = 'dismantled' and to = 'repaired') or (p.status = 'repaired' and to = 'painted') else BAD_TRANSITION
  update projects[project] { status: to }
  return null

mutation reopenBandstand(project: projects):
  require exists staff[viewer] else NOT_STAFF
  p = projects[project] ! else NOT_FOUND
  require p.status = 'painted' else BAD_STATUS
  update projects[project] { status: 'reopened', reopenedAt: now, inspectionDue: now + 365d, flagged: true }
  return null

mutation recordInspection(project: projects, notes: text 1..500):
  require exists staff[viewer, role = 'clerk'] or exists staff[viewer, role = 'master'] else NOT_INSPECTOR
  p = projects[project] ! else NOT_FOUND
  require p.status = 'reopened' else BAD_STATUS
  due = p.inspectionDue
  require due != null else NOT_REOPENED
  insert inspections { project, recordedBy: viewer, notes, late: now > due }
  update projects[project] { status: 'inspected', flagged: false }
  return null

mutation approveColumnReplacement(project: projects, column: text 1..120, heritageApproval: text 1..500):
  require exists staff[viewer, role = 'master'] else NOT_MASTER
  p = projects[project] ! else NOT_FOUND
  require p.status != 'estimate' and p.status != 'lapsed' and p.status != 'inspected' else BAD_STATUS
  return insert columnApprovals { project, column, heritageApproval, approvedBy: viewer }
