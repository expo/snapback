use identity password
use server

table roles:
  principal: principal
  role: enum('customer', 'estimator', 'carpenter', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table orders:
  customer: principal
  estimator: principal
  title: text 3..100
  site: text 3..300
  treePhoto: image <=5000000
  sitePhoto: image <=5000000
  quoteCents: int 10000..100000000
  openedAt: time default now
  approvalDue: time
  approvedAt: time ?
  boundary: bool
  permissionText: text 10..2000 ?
  permissionFile: image <=5000000 ?
  permissionBy: principal ?
  permissionAt: time ?
  stage: enum('measured', 'bolts set', 'framed', 'railed', 'installed', 'held') default 'measured'
  installedAt: time ?
  warrantyUntil: time ?
  immutable customer, estimator, title, site, treePhoto, sitePhoto, quoteCents, openedAt, approvalDue, boundary
  read <- .customer = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'estimator'] and .estimator = viewer
  update <- .customer = viewer or exists roles[viewer, role = 'carpenter'] or exists roles[viewer, role = 'owner']
  online only

table invoices:
  order: orders
  customer: principal
  amountCents: int 10000..100000000
  issuedAt: time default now
  unique order
  immutable order, customer, amountCents, issuedAt
  read <- .customer = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'estimator']
  online only

mutation provision(principal: principal, role: enum('customer', 'estimator', 'carpenter', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query customers(c: cursor ?):
  require exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner'] else NOT_ESTIMATOR
  return roles where .role = 'customer' last 100 by .id after c

query board(c: cursor ?):
  return orders last 100 by .id after c

query orderById(order: orders):
  return orders[order]

query invoiceList(c: cursor ?):
  return invoices last 100 by .id after c

mutation openOrder(customer: principal, title: text 3..100, site: text 3..300, treePhoto: image <=5000000, sitePhoto: image <=5000000, quoteCents: int 10000..100000000, boundary: bool):
  require exists roles[viewer, role = 'estimator'] else NOT_ESTIMATOR
  require exists roles[principal = customer, role = 'customer'] else NOT_CUSTOMER
  o = insert orders { customer, estimator: viewer, title, site, treePhoto, sitePhoto, quoteCents, boundary, approvalDue: now + 14d }
  insert invoices { order: o.id, customer, amountCents: quoteCents }
  return o

mutation approveDesign(order: orders):
  o = orders[order] ! else NOT_FOUND
  require o.customer = viewer else NOT_CUSTOMER
  require o.stage = 'measured' and o.approvedAt = null else NOT_AWAITING_APPROVAL
  require now < o.approvalDue else APPROVAL_EXPIRED
  update orders[order] { approvedAt: now }

mutation approveBoundary(order: orders, permissionText: text 10..2000, permissionFile: image <=5000000):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  o = orders[order] ! else NOT_FOUND
  require o.boundary else NOT_BOUNDARY
  require o.stage = 'measured' else BUILD_ALREADY_STARTED
  require o.permissionAt = null else PERMISSION_RECORDED
  update orders[order] { permissionText, permissionFile, permissionBy: viewer, permissionAt: now }

mutation advanceBuild(order: orders):
  require exists roles[viewer, role = 'carpenter'] else NOT_CARPENTER
  o = orders[order] ! else NOT_FOUND
  require o.approvedAt != null else DESIGN_NOT_APPROVED
  require not o.boundary or o.permissionAt != null else NEIGHBOR_PERMISSION_REQUIRED
  require o.stage = 'measured' or o.stage = 'bolts set' or o.stage = 'framed' else INVALID_STAGE
  if o.stage = 'measured':
    update orders[order] { stage: 'bolts set' }
  elif o.stage = 'bolts set':
    update orders[order] { stage: 'framed' }
  else:
    update orders[order] { stage: 'railed' }

mutation install(order: orders):
  require exists roles[viewer, role = 'carpenter'] else NOT_CARPENTER
  o = orders[order] ! else NOT_FOUND
  require o.stage = 'railed' else NOT_RAILED
  anniversary = monthStart(month(now) + 120) + (now - monthStart(month(now)))
  limit = monthStart(month(now) + 121)
  endAt = anniversary if anniversary < limit else anniversary - 1d
  update orders[order] { stage: 'installed', installedAt: now, warrantyUntil: endAt }

job holdExpired():
  for o in orders:
    if o.approvedAt = null and o.stage = 'measured' and now >= o.approvalDue:
      update orders[o.id] { stage: 'held' }
schedule holdEveryMinute every 1m: holdExpired
