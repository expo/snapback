use identity password

table roles:
  principal: principal
  role: enum('clerk', 'client', 'ironworker', 'master')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or (.role = 'client' and exists roles[viewer, role = 'clerk'])
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table projects:
  client: principal
  title: text 1..120
  location: text 1..200
  quoteCents: int 1..100000000
  quotedAt: time default now
  acceptedAt: time ?
  stage: enum('quoted', 'dismantled', 'repaired', 'rewired', 'reinstalled') default 'quoted'
  basePhoto: image <=10000000
  columnPhoto: image <=10000000
  lanternPhoto: image <=10000000
  reinstalledAt: time ?
  inspectionDue: time ?
  inspectionPending: bool default false
  baseReplacement: bool default false
  heritageApproval: text 1..1000 ?
  approvedBy: principal ?
  approvedAt: time ?
  immutable client, title, location, quoteCents, quotedAt, basePhoto, columnPhoto, lanternPhoto
  read <- .client = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'ironworker'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'clerk']
  update <- .client = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'ironworker'] or exists roles[viewer, role = 'master']
  online only

table inspections:
  project: projects
  client: principal
  inspector: principal
  recordedAt: time default now
  notes: text 1..2000
  unique project
  immutable project, client, inspector, recordedAt, notes
  read <- .client = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'ironworker'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'ironworker'] or exists roles[viewer, role = 'master']
  online only

mutation provision(principal: principal, role: enum('clerk', 'client', 'ironworker', 'master'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query myRole():
  return roles[viewer]

query clients(c: cursor ?):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  return roles where .role = 'client' last 100 by .id after c

query board(c: cursor ?):
  return projects last 100 by .id after c

query project(project: projects):
  p = projects[project] ! else NOT_FOUND
  return { record: p, quoteLapsed: p.acceptedAt = null and now >= p.quotedAt + 60d, overdue: p.inspectionPending and p.inspectionDue != null and now > p.inspectionDue, serverNow: now }

query inspectionsFor(project: projects):
  p = projects[project] ! else NOT_FOUND
  return inspections[project = p.id]

mutation openProject(client: principal, title: text 1..120, location: text 1..200, quoteCents: int 1..100000000, basePhoto: image <=10000000, columnPhoto: image <=10000000, lanternPhoto: image <=10000000):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  require exists roles[principal = client, role = 'client'] else NOT_CLIENT
  return insert projects { client, title, location, quoteCents, basePhoto, columnPhoto, lanternPhoto }

mutation acceptQuote(project: projects):
  p = projects[project] ! else NOT_FOUND
  require p.client = viewer and exists roles[viewer, role = 'client'] else NOT_PROJECT_CLIENT
  require p.acceptedAt = null else ALREADY_ACCEPTED
  require now < p.quotedAt + 60d else QUOTE_LAPSED 'This estimate has lapsed after 60 days.'
  update projects[project] { acceptedAt: now }

mutation advanceStage(project: projects):
  require exists roles[viewer, role = 'ironworker'] else NOT_IRONWORKER
  p = projects[project] ! else NOT_FOUND
  require p.acceptedAt != null else QUOTE_NOT_ACCEPTED
  require p.stage != 'reinstalled' else ALREADY_REINSTALLED
  if p.stage = 'quoted':
    update projects[project] { stage: 'dismantled' }
  elif p.stage = 'dismantled':
    update projects[project] { stage: 'repaired' }
  elif p.stage = 'repaired':
    update projects[project] { stage: 'rewired' }
  else:
    target = monthStart(month(now) + 12)
    offset = now - monthStart(month(now))
    daysInTarget = (monthStart(month(now) + 13) - target) / 1d
    dayOffset = offset / 1d
    clamped = dayOffset if dayOffset < daysInTarget else daysInTarget - 1
    due = target + clamped * 1d + offset % 1d
    update projects[project] { stage: 'reinstalled', reinstalledAt: now, inspectionDue: due, inspectionPending: true }

mutation approveBaseReplacement(project: projects, heritageApproval: text 1..1000):
  require exists roles[viewer, role = 'master'] else NOT_MASTER
  p = projects[project] ! else NOT_FOUND
  require p.acceptedAt != null and p.stage != 'reinstalled' else WRONG_STAGE
  require not p.baseReplacement else ALREADY_APPROVED
  update projects[project] { baseReplacement: true, heritageApproval, approvedBy: viewer, approvedAt: now }

mutation recordInspection(project: projects, notes: text 1..2000):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'ironworker'] or exists roles[viewer, role = 'master'] else NOT_STAFF
  p = projects[project] ! else NOT_FOUND
  require p.stage = 'reinstalled' and p.inspectionPending else NO_INSPECTION_DUE
  result = insert inspections { project, client: p.client, inspector: viewer, notes }
  update projects[project] { inspectionPending: false }
  return result

-- Independent product intent: clients never observe another client's records.
invariant projects.read only not exists roles[viewer, role = 'client'] or .client = viewer
invariant inspections.read only not exists roles[viewer, role = 'client'] or .client = viewer
-- Original casting replacement is a master-restorer decision.
invariant projects.approveBaseReplacement only exists roles[viewer, role = 'master']
invariant projects.acceptQuote only .client = viewer
invariant roles.role write only viewer = 'service:operator'
invariant projects always .basePhoto != null and .columnPhoto != null and .lanternPhoto != null
