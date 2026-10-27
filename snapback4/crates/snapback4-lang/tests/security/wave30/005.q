-- Spiral Staircase Commissions.
-- Roles: client, fabricator, clerk (order clerk), manager (shop manager).
-- A clerk opens each commission with a scan of the signed staircase drawing
-- and the quoted price. The client must return the signed drawing within 21
-- days or the commission is held. A finished staircase not installed within
-- 60 days of its ready notice moves to paid shop storage. Clients see only
-- their own commissions and drawings. Fabricators see the live shop board.
-- Only the shop manager may approve a design change after cutting started,
-- recording who at the client asked for it.
use identity password

table roles:
  principal: principal
  role: enum('client', 'fabricator', 'clerk', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

table commissions:
  client: principal
  clerk: principal
  title: text 1..120
  price: money USD
  drawing: image <=10000000
  stage: enum('layout', 'cutting', 'welding', 'powder', 'ready', 'installed', 'storage') default 'layout'
  signedReturned: bool default false
  held: bool default false
  createdAt: time default now
  readyAt: time ?
  designVersion: int default 1
  immutable client, clerk, createdAt
  cap 100 by client
  read <- .client = viewer or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'clerk']
  update <- .client = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'manager']
  delete <- deny
  online only

table designChanges:
  commission: commissions
  requestedBy: text 1..120
  note: text 1..300 ?
  approvedBy: principal
  at: time default now
  immutable commission, requestedBy, approvedBy, at
  cap 50 by commission
  read <- .commission.client = viewer or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'manager']
  update <- deny
  delete <- deny
  online only

-- Spec: only the operator seats roles; clients read only their own rows;
-- staff read the board; only the manager approves post-cutting changes.
invariant roles.read only .principal = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager'] or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
invariant roles.delete only viewer = 'service:operator'
invariant roles.provision only viewer = 'service:operator'
invariant commissions.read only .client = viewer or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager']
invariant commissions.drawing read only .client = viewer or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager']
invariant commissions.insert only exists roles[viewer, role = 'clerk']
invariant commissions.openCommission only exists roles[viewer, role = 'clerk']
invariant commissions.returnSigned only .client = viewer
invariant commissions.advanceStage only exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'manager']
invariant commissions.approveDesignChange only exists roles[viewer, role = 'manager']
invariant designChanges.read only .commission.client = viewer or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager']
invariant designChanges.insert only exists roles[viewer, role = 'manager']

mutation provision(principal: principal, role: enum('client', 'fabricator', 'clerk', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query clients(c: cursor ?):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return roles where .role = 'client' last 100 by .id after c

query myCommissions(c: cursor ?):
  return commissions where .client = viewer last 50 by .id after c

query board(c: cursor ?):
  require exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return commissions last 50 by .id after c

query commissionDetail(commission: commissions):
  return commissions[commission]

query changeHistory(commission: commissions, c: cursor ?):
  return designChanges where .commission = commission last 50 by .id after c

mutation openCommission(client: principal, title: text 1..120, price: money USD, drawing: image <=10000000):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  require exists roles[client, role = 'client'] else NOT_CLIENT
  require price > 0 else BAD_PRICE
  return insert commissions { client, clerk: viewer, title, price, drawing }

mutation returnSigned(commission: commissions):
  c = commissions[commission] ! else NOT_FOUND
  require c.client = viewer else NOT_YOUR_COMMISSION
  require not c.held else ON_HOLD
  require not c.signedReturned else ALREADY_SIGNED
  require now <= c.createdAt + 21d else SIGNING_OVERDUE
  update commissions[commission] { signedReturned: true }
  return null

mutation advanceStage(commission: commissions):
  require exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'manager'] else NOT_FABRICATOR
  c = commissions[commission] ! else NOT_FOUND
  require not c.held else ON_HOLD
  if c.stage = 'layout':
    update commissions[commission] { stage: 'cutting' }
  elif c.stage = 'cutting':
    update commissions[commission] { stage: 'welding' }
  elif c.stage = 'welding':
    update commissions[commission] { stage: 'powder' }
  elif c.stage = 'powder':
    update commissions[commission] { stage: 'ready', readyAt: now }
  elif c.stage = 'ready':
    require c.readyAt != null else NOT_READY
    update commissions[commission] { stage: 'installed' }
  elif c.stage = 'installed':
    require false else ALREADY_DONE
  else:
    require false else ALREADY_DONE
  return null

mutation approveDesignChange(commission: commissions, requestedBy: text 1..120, note: text 1..300 ?):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  c = commissions[commission] ! else NOT_FOUND
  require not c.held else ON_HOLD
  require c.stage != 'layout' else CUTTING_NOT_STARTED
  require c.stage != 'installed' and c.stage != 'storage' else ALREADY_DONE
  insert designChanges { commission, requestedBy, note, approvedBy: viewer }
  update commissions[commission] { designVersion: c.designVersion + 1 }
  return null

job sweepHolds(periodStart: time, periodEnd: time):
  for c in commissions where .createdAt >= periodEnd - 90d and .createdAt < periodEnd by .createdAt:
    if not c.signedReturned and not c.held and c.createdAt + 21d < periodEnd:
      update commissions[c.id] { held: true }

job sweepStorage(periodStart: time, periodEnd: time):
  for c in commissions where .createdAt >= periodEnd - 400d and .createdAt < periodEnd by .createdAt:
    if c.stage = 'ready' and c.readyAt != null and c.readyAt + 60d < periodEnd:
      update commissions[c.id] { stage: 'storage' }

schedule holdSweep every 1d at 03:00: sweepHolds
schedule storageSweep every 1d at 03:05: sweepStorage
