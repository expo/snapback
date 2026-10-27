use identity password

-- Bandstand Restorations: heritage carpentry firm restoring Victorian park
-- bandstands. Clerk opens a project with roof/column/railing photos plus the
-- quoted price; the town accepts within 60 days; the firm moves the bandstand
-- across the yard board (accepted -> dismantled -> repaired -> painted ->
-- reopened); only the master may approve replacing an original cast column,
-- recording the heritage officer's approval; the bandstand is inspected
-- within 12 months (~365 days) after reopening.

table roles:
  principal: principal
  role: enum('town', 'clerk', 'carpenter', 'master')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table projects:
  town: principal
  name: text 1..120
  roofPhoto: image <=5000000
  columnPhoto: image <=5000000
  railingPhoto: image <=5000000
  quotePrice: money GBP
  quotedAt: time default now
  acceptedAt: time ?
  reopenedAt: time ?
  status: enum('estimate', 'accepted', 'dismantled', 'repaired', 'painted', 'reopened') default 'estimate'
  internalNote: text <=500 default '' read <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  immutable town, quotedAt, roofPhoto, columnPhoto, railingPhoto, quotePrice
  read <- .town = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'clerk']
  update <- .town = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  online only

table columnReplacements:
  project: projects
  detail: text 1..300
  heritageApproval: text 1..300
  approvedBy: principal
  approvedAt: time default now
  immutable project, detail, heritageApproval, approvedBy, approvedAt
  read through .project
  insert <- exists roles[viewer, role = 'master']
  update <- deny
  delete <- deny
  online only

table inspections:
  project: projects
  note: text <=500 ?
  inspectedAt: time default now
  immutable project, inspectedAt
  unique project else ALREADY_INSPECTED 'One inspection per project.'
  read through .project
  insert <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  update <- deny
  delete <- deny
  online only

mutation provision(principal: principal, role: enum('town', 'clerk', 'carpenter', 'master')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role } if absent

mutation openProject(town: principal, name: text 1..120, roof: image <=5000000, columns: image <=5000000, railings: image <=5000000, quotePrice: money GBP):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  require exists roles[town, role = 'town'] else NOT_TOWN
  return insert projects { town, name, roofPhoto: roof, columnPhoto: columns, railingPhoto: railings, quotePrice, quotedAt: now }

mutation acceptQuote(project: projects):
  row = projects[project] ! else NOT_FOUND
  require row.town = viewer else NOT_TOWN
  require row.status = 'estimate' else CLOSED
  require now <= row.quotedAt + 60d else QUOTE_LAPSED 'The estimate lapses 60 days after the quote.'
  update projects[project] { status: 'accepted', acceptedAt: now }
  return null

mutation markDismantled(project: projects):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master'] else NOT_CARPENTER
  require row.status = 'accepted' else BAD_STAGE
  update projects[project] { status: 'dismantled' }
  return null

mutation markRepaired(project: projects):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master'] else NOT_CARPENTER
  require row.status = 'dismantled' else BAD_STAGE
  update projects[project] { status: 'repaired' }
  return null

mutation markPainted(project: projects):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master'] else NOT_CARPENTER
  require row.status = 'repaired' else BAD_STAGE
  update projects[project] { status: 'painted' }
  return null

mutation markReopened(project: projects):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master'] else NOT_CARPENTER
  require row.status = 'painted' else BAD_STAGE
  update projects[project] { status: 'reopened', reopenedAt: now }
  return null

mutation approveColumnReplacement(project: projects, detail: text 1..300, heritageApproval: text 1..300):
  require exists roles[viewer, role = 'master'] else NOT_MASTER
  row = projects[project] ! else NOT_FOUND
  return insert columnReplacements { project: project, detail, heritageApproval, approvedBy: viewer, approvedAt: now }

mutation recordInspection(project: projects, note: text <=500 ?):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master'] else NOT_STAFF
  require row.status = 'reopened' else NOT_REOPENED
  require now <= (row.reopenedAt ?? now) + 365d else INSPECTION_OVERDUE 'The bandstand must be inspected within 12 months after reopening.'
  return insert inspections { project: project, note, inspectedAt: now }

query yardBoard(c: cursor ?):
  if exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master'] or exists roles[viewer, role = 'clerk']:
    return projects last 50 by .id after c
  return projects where .town = viewer last 50 by .id after c

query townProjects(c: cursor ?):
  return projects where .town = viewer last 50 by .id after c

query projectInspections(project: projects, c: cursor ?):
  return inspections where .project = project last 20 by .id after c

query projectColumns(project: projects, c: cursor ?):
  return columnReplacements where .project = project last 20 by .id after c

query inspectionFlag(project: projects):
  row = projects[project] ! else NOT_FOUND
  return { reopened: row.status = 'reopened', inspected: exists inspections[row.id] }

-- Independent intent from the spec; extend these when requirements change.
invariant projects.read only .town = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
invariant projects.internalNote read only exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
