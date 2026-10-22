-- Dive Shop Tank Fills.
-- Roles: diver (every signed-in user; explicit row optional), attendant
-- (fill station), manager (shop manager). The local operator provisions roles.
use identity password
use personas d1, d2, a1, a2, m1, m2

table roles:
  principal: principal
  role: enum('diver', 'attendant', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'manager']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

query myRole():
  return roles[viewer]

mutation provision(principal: principal, role: enum('diver', 'attendant', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

-- Diver profile: display name plus the max O2 % the diver is certified for
-- (21 = air only). Divers set their own name; only staff set certification.
table divers:
  principal: principal
  name: text 1..60
  certO2: int 21..100 default 21
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  insert <- .principal = viewer
  update <- .principal = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  online only

query myDiver():
  return divers[viewer]

query diversList(c: cursor ?):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return divers last 50 by .id after c

mutation registerDiver(name: text 1..60):
  return upsert divers[viewer] { principal: viewer, name }

mutation setCert(diver: principal, certO2: int 21..100):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  d = divers[diver] ! else NOT_FOUND
  update divers[diver] { certO2 }
  return null

-- A scuba tank owned by a diver. visualAt is the last visual inspection,
-- hydroAt the last hydrostatic pressure test. Only staff move the dates.
table tanks:
  owner: principal
  label: text 1..60
  visualAt: time
  hydroAt: time
  read <- .owner = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  insert <- .owner = viewer
  update <- .owner = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  cap 200 by owner
  online only

query myTanks(c: cursor ?):
  return tanks where .owner = viewer first 50 by .id after c

query allTanks(c: cursor ?):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return tanks last 50 by .id after c

mutation addTank(label: text 1..60, visualAt: time, hydroAt: time):
  require visualAt <= now else FUTURE_DATE
  require hydroAt <= now else FUTURE_DATE
  return insert tanks { owner: viewer, label, visualAt, hydroAt }

mutation relabelTank(tank: tanks, label: text 1..60):
  t = tanks[tank] ! else NOT_FOUND
  require t.owner = viewer else NOT_OWNER
  update tanks[tank] { label }
  return null

mutation recordVisual(tank: tanks):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  t = tanks[tank] ! else NOT_FOUND
  update tanks[tank] { visualAt: now }
  return null

mutation recordHydro(tank: tanks):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  t = tanks[tank] ! else NOT_FOUND
  update tanks[tank] { hydroAt: now }
  return null

-- A fill logged by the attendant: photo of the inspection sticker plus price.
-- Status moves received -> analyzed -> filled -> collected. A mix above the
-- diver's certification needs a manager approval before it can be filled.
table fills:
  tank: tanks
  diver: principal
  mixO2: int 21..100
  priceCents: int 0..100000
  sticker: image <=5000000
  status: enum('received', 'analyzed', 'filled', 'collected') default 'received'
  at: time default now
  immutable tank, diver, mixO2, priceCents, sticker
  read <- .diver = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  cap 10000
  online only

query myFills(c: cursor ?):
  return fills where .diver = viewer last 50 by .at after c

query board(c: cursor ?):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return fills last 50 by .at after c

query queue(c: cursor ?):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return fills where .status = 'received' or .status = 'analyzed' last 50 by .at after c

query fillDetail(fill: fills):
  return fills[fill]

query approvalFor(fill: fills):
  return approvals[fill]

mutation logFill(tank: tanks, mixO2: int 21..100, priceCents: int 0..100000, sticker: image <=5000000):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  t = tanks[tank] ! else NOT_FOUND
  require exists divers[t.owner] else NO_DIVER_PROFILE
  require t.visualAt > now - 365d else VISUAL_EXPIRED
  require t.hydroAt > now - 1825d else HYDRO_STALE
  return insert fills { tank, diver: t.owner, mixO2, priceCents, sticker, status: 'received' }

mutation analyzeFill(fill: fills):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  f = fills[fill] ! else NOT_FOUND
  require f.status = 'received' else BAD_TRANSITION
  update fills[fill] { status: 'analyzed' }
  return null

mutation completeFill(fill: fills):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  f = fills[fill] ! else NOT_FOUND
  require f.status = 'analyzed' else BAD_TRANSITION
  d = divers[f.diver] ! else NO_DIVER_PROFILE
  require f.mixO2 <= d.certO2 or exists approvals[fill = fill] else NEEDS_APPROVAL
  update fills[fill] { status: 'filled' }
  return null

mutation collectFill(fill: fills):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  f = fills[fill] ! else NOT_FOUND
  require f.status = 'filled' else BAD_TRANSITION
  update fills[fill] { status: 'collected' }
  return null

-- Manager approval for an enriched mix above the diver's certification,
-- recording the certificate card and the reason. Must precede the fill.
table approvals:
  fill: fills
  diver: principal
  manager: principal
  certCard: text 1..120
  reason: text 1..500
  unique fill
  immutable fill, diver, manager, certCard, reason
  read <- .diver = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'manager']
  cap 10000
  online only

mutation approveMix(fill: fills, certCard: text 1..120, reason: text 1..500):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  f = fills[fill] ! else NOT_FOUND
  d = divers[f.diver] ! else NO_DIVER_PROFILE
  require f.mixO2 > d.certO2 else NOT_ENRICHED
  require f.status = 'received' or f.status = 'analyzed' else TOO_LATE
  return insert approvals { fill, diver: f.diver, manager: viewer, certCard, reason }

-- Privacy intent from the spec, stated independently of enforcement.
invariant divers.read only .principal = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
invariant tanks.read only .owner = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
invariant fills.read only .diver = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
invariant approvals.read only .diver = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
invariant fills.logFill only exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
invariant fills.analyzeFill only exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
invariant fills.completeFill only exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
invariant fills.collectFill only exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
invariant approvals.approveMix only exists roles[viewer, role = 'manager']
