-- Ice Sculpture Commissions.
-- Roles: client, coordinator (sales, opens commissions), carver (freezer board),
-- owner (studio owner; approves design changes after carving starts).
use identity password

table roles:
  principal: principal
  role: enum('client', 'coordinator', 'carver', 'owner')
  unique principal
  immutable principal
  -- Coordinators need the roster to open commissions for clients; owners audit it.
  read <- .principal = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- Spec: every user has exactly one role, granted by the operator at setup.
-- No user may grant themselves a role.
invariant roles.read only .principal = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant roles.insert only viewer = 'service:operator'

mutation provision(principal: principal, role: enum('client', 'coordinator', 'carver', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query clientRoster():
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return roles where .role = 'client' first 100 by .id

table commissions:
  client: principal
  coordinator: principal
  eventName: text 1..120
  eventDate: time
  sketch: image <=8000000 ?
  price: money USD
  depositKept: bool default false
  stage: enum('blocks', 'carving', 'finishing', 'delivered', 'cancelled') default 'blocks'
  designApprovedAt: time ?
  deliveredAt: time ?
  damaged: bool default false
  replacementOrdered: bool default false
  designChangeExtra: money USD ?
  immutable client, eventDate
  read <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'carver'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'coordinator']
  update <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'carver'] or exists roles[viewer, role = 'owner']
  delete <- deny
  online only

-- Spec: a client sees only their own commissions; staff see all.
-- Carvers see the live freezer board (all non-cancelled commissions).
invariant commissions.read only .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'carver'] or exists roles[viewer, role = 'owner']

table invoices:
  commission: commissions
  client: principal
  amount: money USD
  note: text <=200 ?
  issuedAt: time default now
  immutable commission, client, amount
  read <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  update <- deny
  delete <- deny
  online only

-- Spec: a client sees only their own invoices. Carvers never see invoices.
invariant invoices.read only .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']

table designChanges:
  commission: commissions
  note: text 1..500
  extraCost: money USD
  approved: bool default false
  requestedBy: principal
  requestedAt: time default now
  immutable commission, requestedBy
  read <- exists commissions[.commission, client = viewer] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'carver'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  update <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  delete <- deny
  online only

-- Spec: design changes are visible to the commission's client and all staff.
invariant designChanges.read only exists commissions[.commission, client = viewer] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'carver'] or exists roles[viewer, role = 'owner']

-- A design must be approved at least 14 days before the event, or the
-- commission is cancelled with the deposit kept. A sculpture delivered
-- damaged may be replaced within 24 hours of delivery. Only the studio
-- owner can approve a design change after carving starts, recording the
-- extra cost.

mutation openCommission(client: principal, eventName: text 1..120, eventDate: time, price: money USD, sketch: image <=8000000 ?):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  require eventDate > now else BAD_DATE
  return insert commissions { client, coordinator: viewer, eventName, eventDate, price, sketch }

mutation attachSketch(commission: commissions, sketch: image <=8000000):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  row = commissions[commission] ! else NOT_FOUND
  require row.stage != 'cancelled' else CANCELLED
  update commissions[commission] { sketch }
  return null

mutation approveDesign(commission: commissions):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  row = commissions[commission] ! else NOT_FOUND
  require row.stage != 'cancelled' else CANCELLED
  require row.designApprovedAt = null else ALREADY_APPROVED
  require now <= row.eventDate - 14d else DESIGN_TOO_LATE
  update commissions[commission] { designApprovedAt: now }
  return null

mutation cancelCommission(commission: commissions):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  row = commissions[commission] ! else NOT_FOUND
  require row.stage != 'cancelled' else CANCELLED
  require row.designApprovedAt = null else ALREADY_APPROVED
  require now > row.eventDate - 14d else TOO_EARLY
  update commissions[commission] { stage: 'cancelled', depositKept: true }
  return null

mutation advanceStage(commission: commissions, to: enum('carving', 'finishing', 'delivered')):
  require exists roles[viewer, role = 'carver'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  row = commissions[commission] ! else NOT_FOUND
  require row.stage != 'cancelled' else CANCELLED
  require row.designApprovedAt != null else NOT_APPROVED
  if row.stage = 'blocks':
    require to = 'carving' else BAD_TRANSITION
  else if row.stage = 'carving':
    require to = 'finishing' else BAD_TRANSITION
  else if row.stage = 'finishing':
    require to = 'delivered' else BAD_TRANSITION
  else:
    require false else BAD_TRANSITION
  if to = 'delivered':
    update commissions[commission] { stage: to, deliveredAt: now }
  else:
    update commissions[commission] { stage: to }
  return null

mutation reportDamage(commission: commissions):
  row = commissions[commission] ! else NOT_FOUND
  require exists roles[viewer, role = 'carver'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] or row.client = viewer else NOT_ALLOWED
  require row.stage = 'delivered' else NOT_DELIVERED
  update commissions[commission] { damaged: true }
  return null

mutation requestReplacement(commission: commissions):
  row = commissions[commission] ! else NOT_FOUND
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] or row.client = viewer else NOT_ALLOWED
  require row.stage = 'delivered' else NOT_DELIVERED
  require row.damaged = true else NOT_DAMAGED
  delivered = row.deliveredAt ! else NOT_DELIVERED
  require now <= delivered + 24h else WINDOW_CLOSED
  update commissions[commission] { replacementOrdered: true }
  return null

mutation requestDesignChange(commission: commissions, note: text 1..500, extraCost: money USD):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  row = commissions[commission] ! else NOT_FOUND
  require row.stage != 'cancelled' else CANCELLED
  require row.stage != 'delivered' else DELIVERED
  return insert designChanges { commission, note, extraCost, requestedBy: viewer }

mutation approveDesignChange(change: designChanges):
  ch = designChanges[change] ! else NOT_FOUND
  row = commissions[ch.commission] ! else NOT_FOUND
  require row.stage != 'cancelled' else CANCELLED
  require ch.approved = false else ALREADY_APPROVED
  if row.stage = 'blocks':
    require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  else:
    require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  update designChanges[change] { approved: true }
  update commissions[ch.commission] { designChangeExtra: ch.extraCost }
  return null

mutation issueInvoice(commission: commissions, amount: money USD, note: text <=200 ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  row = commissions[commission] ! else NOT_FOUND
  require row.stage != 'cancelled' else CANCELLED
  return insert invoices { commission, client: row.client, amount, note }

query commission(commission: commissions):
  return commissions[commission]

query myCommissions(c: cursor ?):
  return commissions where .client = viewer first 50 by .eventDate after c

query allCommissions(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'carver'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return commissions first 50 by .eventDate after c

query freezerBoard(c: cursor ?):
  require exists roles[viewer, role = 'carver'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return commissions where .stage != 'cancelled' first 100 by .eventDate after c

query myInvoices(c: cursor ?):
  return invoices where .client = viewer first 50 by .issuedAt after c

query invoicesFor(commission: commissions, c: cursor ?):
  return invoices where .commission = commission first 50 by .issuedAt after c

query designChangesFor(commission: commissions, c: cursor ?):
  return designChanges where .commission = commission first 50 by .requestedAt after c

job cancelOverdue(periodStart: time, periodEnd: time):
  for c in commissions:
    if c.designApprovedAt = null and c.stage != 'cancelled' and now > c.eventDate - 14d:
      update commissions[c.id] { stage: 'cancelled', depositKept: true }

schedule sweepHourly every 1h: cancelOverdue
