use identity password

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
  columnsPhoto: image <=5000000
  railingsPhoto: image <=5000000
  quotedPrice: money USD
  quoteAt: time
  quoteDueAt: time
  quoteStatus: enum('pending', 'accepted', 'lapsed') default 'pending'
  stage: enum('dismantled', 'repaired', 'painted', 'reopened') default 'dismantled'
  reopenedAt: time ?
  inspectionDueAt: time ?
  internalNote: text <=500 default '' read <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  immutable town, quoteAt, quoteDueAt
  read <- .town = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'clerk']
  update <- (.town = viewer and exists roles[viewer, role = 'town']) or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  online only

table columnReplacements:
  town: principal
  project: projects
  reason: text 1..500
  status: enum('requested', 'approved') default 'requested'
  heritageOfficer: text <=200 default '' read <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  approvedAt: time ?
  immutable town, project, reason, approvedAt
  read <- .town = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter']
  update <- exists roles[viewer, role = 'master']
  online only

table inspections:
  town: principal
  project: projects
  unique project
  inspectedAt: time
  photo: image <=5000000
  note: text <=500 default ''
  immutable town, project, inspectedAt, photo
  read <- .town = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('town', 'clerk', 'carpenter', 'master')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role } if absent

mutation openProject(town: principal, name: text 1..120, roofPhoto: image <=5000000, columnsPhoto: image <=5000000, railingsPhoto: image <=5000000, quotedPrice: money USD):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  require exists roles[town, role = 'town'] else NOT_TOWN
  return insert projects { town, name, roofPhoto, columnsPhoto, railingsPhoto, quotedPrice, quoteAt: now, quoteDueAt: now + 60d }

mutation acceptQuote(project: projects):
  row = projects[project] ! else NOT_FOUND
  require viewer = row.town else NOT_TOWN
  require row.quoteStatus = 'pending' else CLOSED
  require now < row.quoteDueAt else DEADLINE
  update projects[project] { quoteStatus: 'accepted' }
  return null

mutation lapseEstimate(project: projects):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  require row.quoteStatus = 'pending' else CLOSED
  require now > row.quoteDueAt else TOO_EARLY
  update projects[project] { quoteStatus: 'lapsed' }
  return null

mutation markRepaired(project: projects):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'carpenter'] else NOT_CARPENTER
  require row.quoteStatus = 'accepted' else NOT_ACCEPTED
  require row.stage = 'dismantled' else CLOSED
  update projects[project] { stage: 'repaired' }
  return null

mutation markPainted(project: projects):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'carpenter'] else NOT_CARPENTER
  require row.quoteStatus = 'accepted' else NOT_ACCEPTED
  require row.stage = 'repaired' else CLOSED
  update projects[project] { stage: 'painted' }
  return null

mutation markReopened(project: projects):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'carpenter'] else NOT_CARPENTER
  require row.quoteStatus = 'accepted' else NOT_ACCEPTED
  require row.stage = 'painted' else CLOSED
  update projects[project] { stage: 'reopened', reopenedAt: now, inspectionDueAt: monthStart(month(now) + 12) }
  return null

mutation requestColumnReplacement(project: projects, reason: text 1..500):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] else NOT_STAFF
  require row.quoteStatus = 'accepted' else NOT_ACCEPTED
  return insert columnReplacements { town: row.town, project, reason }

mutation approveColumnReplacement(replacement: columnReplacements, heritageOfficer: text 1..200):
  row = columnReplacements[replacement] ! else NOT_FOUND
  require exists roles[viewer, role = 'master'] else NOT_MASTER
  require row.status = 'requested' else CLOSED
  update columnReplacements[replacement] { status: 'approved', heritageOfficer, approvedAt: now }
  return null

mutation recordInspection(project: projects, photo: image <=5000000, note: text <=500):
  row = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master'] else NOT_STAFF
  require row.quoteStatus = 'accepted' else NOT_ACCEPTED
  require row.stage = 'reopened' else NOT_REOPENED
  return insert inspections { town: row.town, project, inspectedAt: now, photo, note }

query board(c: cursor ?):
  if exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']:
    return projects last 50 by .id after c
  return projects where .town = viewer last 50 by .id after c

query inspectionsFor(project: projects, c: cursor ?):
  row = projects[project] ! else NOT_FOUND
  if exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']:
    return inspections where .project = project last 50 by .id after c
  require viewer = row.town else NOT_TOWN
  return inspections where .project = project last 50 by .id after c

query replacementsFor(project: projects, c: cursor ?):
  row = projects[project] ! else NOT_FOUND
  if exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']:
    return columnReplacements where .project = project last 50 by .id after c
  require viewer = row.town else NOT_TOWN
  return columnReplacements where .project = project last 50 by .id after c

-- Independent intent from the spec; extend these when requirements change.
invariant projects.read only .town = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
invariant projects.internalNote read only exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
invariant columnReplacements.read only .town = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
invariant columnReplacements.heritageOfficer read only exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
invariant inspections.read only .town = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'master']
