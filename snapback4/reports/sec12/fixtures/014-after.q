-- Balloon Decor Installs.
--
-- Roles: owner (company owner), lead (project lead), installer, client.
-- A lead opens a project with venue photos and a quoted fee. Installers see
-- photos, plan and rigging notes but never the client's phone, the venue
-- contract or the fee. Clients see only their own projects. Status moves
-- planned -> inflated -> installed -> taken_down, and takedown must happen
-- within two days of the event. Only the owner approves a free extra arch,
-- with the reason kept on the project.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'lead', 'installer', 'client')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] or exists roles[viewer, role = 'installer']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

table projects:
  client: principal
  title: text 1..80
  venue: text 1..120
  entrancePhoto: text <=500 format url ? write <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead']
  hallPhoto: text <=500 format url
  balloonPlan: text 1..2000
  riggingNotes: text 1..500
  clientPhone: text 1..40
  venueContract: text 1..2000
  fee: money USD
  eventAt: time
  status: enum('planned', 'inflated', 'installed', 'taken_down') default 'planned'
  takedownAt: time ?
  freeArch: bool default false
  freeArchReason: text 1..200 ?
  immutable client, hallPhoto, clientPhone, venueContract, fee, eventAt
  read <- .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] or exists roles[viewer, role = 'installer']
  read (clientPhone, venueContract, fee) <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead']
  insert <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead']
  update <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] or exists roles[viewer, role = 'installer']
  delete <- deny
  online only

-- Privacy intent, stated separately from the enforcing rules above.
invariant projects.read only .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] or exists roles[viewer, role = 'installer']
invariant projects.clientPhone read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead']
invariant projects.venueContract read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead']
invariant projects.fee read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead']
invariant projects.insert only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead']
invariant projects.approveArch only exists roles[viewer, role = 'owner']
invariant projects.setEntrancePhoto only exists roles[viewer, role = 'lead']
-- Day-two change request: the entrance photo is deliberately optional. A lead
-- may open a project before that photo exists; the UI shows
-- 'Entrance photo to follow' until one is supplied.
invariant projects always .entrancePhoto = null or .entrancePhoto != null

-- Operator-only roster provisioning. Signup grants no role; the local
-- operator (or staging setup) grants each account exactly one role.
mutation provision(principal: principal, role: enum('owner', 'lead', 'installer', 'client')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query whoAmI():
  return viewer

query myRole():
  return roles[viewer]

-- One board for everyone: staff read every project, a client reads only her
-- own rows. Both answers are complete.
query board(c: cursor ?):
  if exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] or exists roles[viewer, role = 'installer']:
    return projects last 50 by .id after c
  return projects where .client = viewer last 50 by .id after c

query project(project: projects):
  return projects[project]

-- Staff directory of client accounts, so a lead opening a project can address
-- it to a real client principal. Principals are public identities, not secrets.
query clients(c: cursor ?):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] or exists roles[viewer, role = 'installer'] else NOT_STAFF
  return roles where .role = 'client' last 50 by .id after c

mutation openProject(client: principal, title: text 1..80, venue: text 1..120, entrancePhoto: text <=500 format url ?, hallPhoto: text <=500 format url, balloonPlan: text 1..2000, riggingNotes: text 1..500, clientPhone: text 1..40, venueContract: text 1..2000, fee: money USD, eventAt: time):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] else NOT_LEAD
  require exists roles[client, role = 'client'] else NOT_CLIENT
  return insert projects { client, title, venue, entrancePhoto, hallPhoto, balloonPlan, riggingNotes, clientPhone, venueContract, fee, eventAt }

mutation updatePlan(project: projects, balloonPlan: text 1..2000, riggingNotes: text 1..500):
  p = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] else NOT_LEAD
  update projects[project] { balloonPlan, riggingNotes }
  return null

-- Forward-only, one step at a time: planned -> inflated -> installed.
mutation advanceStatus(project: projects):
  p = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] or exists roles[viewer, role = 'installer'] else NOT_STAFF
  require p.status = 'planned' or p.status = 'inflated' else BAD_TRANSITION
  update projects[project] { status: 'inflated' if p.status = 'planned' else 'installed' }
  return null

-- Takedown is only allowed within two days after the event.
mutation markTakenDown(project: projects):
  p = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'lead'] or exists roles[viewer, role = 'installer'] else NOT_STAFF
  require p.status = 'installed' else BAD_TRANSITION
  require now <= p.eventAt + 2d else TAKEDOWN_LATE
  update projects[project] { status: 'taken_down', takedownAt: now }
  return null

-- Only the project lead may add, replace or remove the entrance photo after
-- creation (including clearing it back to "to follow"). Creation with a photo
-- stays owner-or-lead through the column write rule above, so owner opens keep
-- working exactly as before.
mutation setEntrancePhoto(project: projects, entrancePhoto: text <=500 format url ?):
  p = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'lead'] else NOT_LEAD
  update projects[project] { entrancePhoto }
  return null

-- Only the company owner approves a free extra arch; the reason is kept.
mutation approveArch(project: projects, reason: text 1..200):
  p = projects[project] ! else NOT_FOUND
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  require p.freeArch = false else ALREADY_APPROVED
  update projects[project] { freeArch: true, freeArchReason: reason }
  return null
