use identity password

table roles:
  principal: principal
  role: enum('clerk', 'client', 'fitter', 'master', 'heritage')
  label: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'master']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('clerk', 'client', 'fitter', 'master', 'heritage'), label: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal = principal] { principal, role, label }

query myRole():
  return roles[principal = viewer]

query directory():
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'master'] else STAFF_ONLY
  return roles first 100 by .id { principal, role, label }

table projects:
  client: principal
  openedBy: principal
  title: text 1..100
  quoteCents: int 1..100000000
  quotedAt: time
  expiresAt: time
  acceptedAt: time ?
  stage: enum('lowered', 'rewired', 'restrung', 'rehung') default 'lowered'
  rehungAt: time ?
  inspectionDueAt: time ?
  inspected: bool default false
  immutable client, openedBy, title, quoteCents, quotedAt, expiresAt
  read <- .client = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master']
  insert <- exists roles[principal = viewer, role = 'clerk'] and .openedBy = viewer and exists roles[principal = .client, role = 'client']
  update <- .client = viewer or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master']
  online only

shape projectCard = { *, frame: photoSets[project = .id, label = 'Opening survey'].frame, arms: photoSets[project = .id, label = 'Opening survey'].arms, crystals: photoSets[project = .id, label = 'Opening survey'].crystals, quoteLapsed: .acceptedAt = null and .expiresAt <= now, inspectionFlag: .rehungAt != null and .inspected = false, inspectionOverdue: .inspectionDueAt != null and .inspectionDueAt <= now and .inspected = false }

query listProjects():
  return projects last 100 by .id projectCard

query project(project: projects):
  return projects[project] projectCard

mutation openProject(client: principal, title: text 1..100, frame: image <=5000000, arms: image <=5000000, crystals: image <=5000000, quoteCents: int 1..100000000):
  require exists roles[principal = viewer, role = 'clerk'] else CLERK_ONLY
  require exists roles[principal = client, role = 'client'] else NOT_CLIENT
  p = insert projects { client, openedBy: viewer, title, quoteCents, quotedAt: now, expiresAt: now + 60d }
  insert photoSets { project: p.id, frame, arms, crystals }
  return projects[p.id] projectCard

mutation acceptQuote(project: projects):
  require exists roles[principal = viewer, role = 'client'] else CLIENT_ONLY
  p = projects[project] ! else NOT_FOUND
  require p.client = viewer else NOT_YOURS
  require p.acceptedAt = null else ALREADY_ACCEPTED
  require now < p.expiresAt else QUOTE_LAPSED
  return update projects[project] { acceptedAt: now }

mutation advanceStage(project: projects):
  require exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master'] else WORKSHOP_ONLY
  p = projects[project] ! else NOT_FOUND
  require p.acceptedAt != null else QUOTE_NOT_ACCEPTED
  require p.stage != 'rehung' else ALREADY_REHUNG
  if p.stage = 'lowered':
    return update projects[project] { stage: 'rewired' }
  if p.stage = 'rewired':
    return update projects[project] { stage: 'restrung' }
  return update projects[project] { stage: 'rehung', rehungAt: now, inspectionDueAt: min(monthStart(month(now) + 12) + (now - monthStart(month(now))), monthStart(month(now) + 13) - 1), inspected: false }

table crystalApprovals:
  project: projects
  client: principal
  approvedBy: principal
  heritageOfficer: principal
  reference: text 1..200
  reason: text 1..1000
  at: time
  unique project
  immutable project, client, approvedBy, heritageOfficer, reference, reason, at
  read <- .client = viewer or .heritageOfficer = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master']
  insert <- exists roles[principal = viewer, role = 'master'] and .approvedBy = viewer and exists roles[principal = .heritageOfficer, role = 'heritage'] and .client = .project.client
  online only

query approvals():
  return crystalApprovals last 100 by .id

mutation approveCrystals(project: projects, heritageOfficer: principal, reference: text 1..200, reason: text 1..1000):
  require exists roles[principal = viewer, role = 'master'] else MASTER_ONLY
  p = projects[project] ! else NOT_FOUND
  require p.acceptedAt != null else QUOTE_NOT_ACCEPTED
  require p.stage != 'rehung' else ALREADY_REHUNG
  require exists roles[principal = heritageOfficer, role = 'heritage'] else NOT_HERITAGE_OFFICER
  return insert crystalApprovals { project, client: p.client, approvedBy: viewer, heritageOfficer, reference, reason, at: now }

table inspections:
  project: projects
  client: principal
  recordedBy: principal
  at: time
  notes: text 1..2000
  unique project
  immutable project, client, recordedBy, at, notes
  read <- .client = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master']
  insert <- .recordedBy = viewer and .client = .project.client and (exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master'])
  online only

query listInspections():
  return inspections last 100 by .id

mutation recordInspection(project: projects, notes: text 1..2000):
  require exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master'] else WORKSHOP_ONLY
  p = projects[project] ! else NOT_FOUND
  require p.stage = 'rehung' else NOT_REHUNG
  require not p.inspected else ALREADY_INSPECTED
  inspection = insert inspections { project, client: p.client, recordedBy: viewer, at: now, notes }
  update projects[project] { inspected: true }
  return inspection

-- Product privacy intent: clients see only their own restoration records;
-- workshop staff share the live board and conservation history.
invariant projects.read only .client = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master']
invariant inspections.read only .client = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master']
-- An officer's read access is confined to approvals naming that officer.
invariant crystalApprovals.read only .client = viewer or .heritageOfficer = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'master']
invariant crystalApprovals.insert only exists roles[principal = viewer, role = 'master']
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'

-- A set owns its photos; access follows the project and never broadens its audience.
table photoSets:
  project: projects on delete restrict
  label: text 1..100 default 'Opening survey'
  description: text <=2000 default ''
  frame: image <=5000000
  arms: image <=5000000
  crystals: image <=5000000
  unique project, label
  immutable project, label, frame, arms, crystals
  read through .project
  insert <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'master']
  update <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'master']
  online only

extract photoSets from projects via project: {frame:frame, arms:arms, crystals:crystals}

query listPhotoSets(project: projects, c: cursor ?):
  p = projects[project] ! else NOT_FOUND
  return photoSets where .project = project first 50 by .id after c

mutation addPhotoSet(project: projects, label: text 1..100, description: text <=2000, frame: image <=5000000, arms: image <=5000000, crystals: image <=5000000):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'master'] else PHOTO_STAFF_ONLY
  p = projects[project] ! else NOT_FOUND
  return insert photoSets { project, label, description, frame, arms, crystals }

mutation describePhotoSet(photoSet: photoSets, description: text <=2000):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'master'] else PHOTO_STAFF_ONLY
  s = photoSets[photoSet] ! else NOT_FOUND
  return update photoSets[photoSet] { description }

invariant photoSets.insert only exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'master']
invariant photoSets.update only exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'master']
