-- Championship Ring Orders backend.
-- Four roles: team (customer), coordinator (opens orders), jeweler (production),
-- owner (approvals). Password identity; roles provisioned by service:ops.
use identity password

table roles:
  principal: principal
  role: enum('team', 'coordinator', 'jeweler', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'coordinator']
  insert <- viewer = 'service:ops'
  update <- viewer = 'service:ops'
  delete <- deny
  online only

table orders:
  team: principal
  designScan: image <=10000000 ?
  quotedPrice: int 100..100000000
  ringCount: int 1..500 default 1
  ceremonyAt: time
  designApprovedAt: time
  status: enum('open', 'carving', 'casting', 'setting', 'polish', 'delivered', 'cancelled') default 'open'
  extraCost: int 0..100000000 default 0
  depositKept: bool default false
  deliveredAt: time ?
  flawReported: bool default false
  flawNote: text <=2000 ?
  immutable team, ceremonyAt, designApprovedAt
  read <- .team = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'jeweler'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']
  update <- .team = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'jeweler'] or exists roles[principal = viewer, role = 'owner']
  delete <- deny
  online only

table invoices:
  order: orders
  team: principal
  amount: int 100..100000000
  paid: bool default false
  immutable order, team
  read <- .team = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists orders[.order, team = .team] and (exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'])
  update <- exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']
  delete <- deny
  online only

table designChanges:
  order: orders
  team: principal
  description: text 1..500
  extraCost: int 0..100000000
  approved: bool default false
  approvedBy: principal ?
  approvedAt: time ?
  immutable order, team
  read <- .team = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'jeweler'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists orders[.order, team = .team] and (.team = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'])
  update <- exists roles[principal = viewer, role = 'owner']
  delete <- deny
  online only

query myRole():
  return roles[viewer]

query teamList(c: cursor ?):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  return roles where .role = 'team' last 50 by .id after c

query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'jeweler'] or exists roles[principal = viewer, role = 'owner']:
    return orders last 50 by .id after c
  return orders where .team = viewer last 50 by .id after c

query myOrders(c: cursor ?):
  return orders where .team = viewer last 50 by .id after c

query orderDetail(order: orders):
  return orders[order]

query myInvoices(c: cursor ?):
  return invoices where .team = viewer last 50 by .id after c

query invoicesForOrder(order: orders, c: cursor ?):
  return invoices where .order = order last 50 by .id after c

query changesForOrder(order: orders, c: cursor ?):
  return designChanges where .order = order last 50 by .id after c

mutation provision(principal: principal, role: enum('team', 'coordinator', 'jeweler', 'owner')):
  require viewer = 'service:ops' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

mutation createOrder(team: principal, designScan: image <=10000000 ?, quotedPrice: int 100..100000000, ringCount: int 1..500, ceremonyAt: time, designApprovedAt: time):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  require exists roles[principal = team, role = 'team'] else NOT_TEAM
  return insert orders { team, designScan, quotedPrice, ringCount, ceremonyAt, designApprovedAt }

mutation setDesignScan(order: orders, designScan: image <=10000000):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  o = orders[order] ! else NOT_FOUND
  update orders[order] { designScan }
  return orders[order]

mutation clearDesignScan(order: orders):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  o = orders[order] ! else NOT_FOUND
  update orders[order] { designScan: null }
  return orders[order]

mutation advanceStage(order: orders):
  require exists roles[principal = viewer, role = 'jeweler'] or exists roles[principal = viewer, role = 'owner'] else NOT_JEWELER
  o = orders[order] ! else NOT_FOUND
  require o.status != 'cancelled' else CANCELLED
  require o.status != 'delivered' else ALREADY_DELIVERED
  if o.status = 'open':
    update orders[order] { status: 'carving' }
  elif o.status = 'carving':
    update orders[order] { status: 'casting' }
  elif o.status = 'casting':
    update orders[order] { status: 'setting' }
  elif o.status = 'setting':
    update orders[order] { status: 'polish' }
  elif o.status = 'polish':
    update orders[order] { status: 'delivered', deliveredAt: now }
  return orders[order]

mutation createInvoice(order: orders, amount: int 100..100000000):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  o = orders[order] ! else NOT_FOUND
  return insert invoices { order, team: o.team, amount }

mutation markInvoicePaid(invoice: invoices):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  update invoices[invoice] { paid: true }
  return null

mutation requestDesignChange(order: orders, description: text 1..500, extraCost: int 0..100000000):
  o = orders[order] ! else NOT_FOUND
  require o.team = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ALLOWED
  return insert designChanges { order, team: o.team, description, extraCost }

mutation approveDesignChange(change: designChanges, extraCost: int 0..100000000):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  c = designChanges[change] ! else NOT_FOUND
  o = orders[c.order] ! else NOT_FOUND
  require not c.approved else ALREADY_APPROVED
  if o.status = 'casting' or o.status = 'setting' or o.status = 'polish' or o.status = 'delivered':
    require extraCost > 0 else EXTRA_COST_REQUIRED
  update designChanges[change] { approved: true, approvedBy: viewer, approvedAt: now, extraCost }
  update orders[c.order] { extraCost: o.extraCost + extraCost }
  return null

mutation reportFlaw(order: orders, note: text 1..2000):
  o = orders[order] ! else NOT_FOUND
  require o.team = viewer else NOT_TEAM
  require o.status = 'delivered' else NOT_DELIVERED
  require o.deliveredAt != null else NOT_DELIVERED
  require now <= o.deliveredAt + 7d else FLAW_WINDOW_CLOSED
  update orders[order] { flawReported: true, flawNote: note }
  return null

mutation evaluateDeadline(order: orders):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  o = orders[order] ! else NOT_FOUND
  if o.status != 'cancelled' and o.designApprovedAt > o.ceremonyAt - 60d:
    update orders[order] { status: 'cancelled', depositKept: true }
  return orders[order]

-- v2: the approved design scan is optional at creation; coordinator/owner attach it later.
invariant orders always .designScan = null or .designScan != null
invariant orders.designScan update only exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']

job sweepLateOrders():
  for o in orders:
    if o.status != 'cancelled' and o.designApprovedAt > o.ceremonyAt - 60d:
      update orders[o.id] { status: 'cancelled', depositKept: true }

schedule sweepDaily every 1d at 03:00: sweepLateOrders
