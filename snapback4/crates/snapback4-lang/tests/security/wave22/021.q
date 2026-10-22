-- Wash Fold Laundry — Snapback 4 (Quarry) schema, v1.
-- Roles: customer, attendant, driver, owner (roster in `roles`).
-- Operators bootstrap via the service:operator seat; owners manage staff after that.

use identity password

table roles:
  principal: principal
  role: enum('customer', 'attendant', 'driver', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or exists roles[viewer, role = 'owner']
  update <- viewer = 'service:operator' or exists roles[viewer, role = 'owner']
  delete <- viewer = 'service:operator' or exists roles[viewer, role = 'owner']
  online only

table driverRoutes:
  driver: principal
  route: text 1..40
  unique driver
  immutable driver
  read <- .driver = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or exists roles[viewer, role = 'owner']
  update <- viewer = 'service:operator' or exists roles[viewer, role = 'owner']
  delete <- viewer = 'service:operator' or exists roles[viewer, role = 'owner']
  online only

-- One bag drop-off. priceCents is computed server-side from weight (25c/oz).
table orders:
  customer: principal
  weightOz: int 1..3200
  priceCents: int 0..1000000
  tagPhoto: image <=5000000
  status: enum('washing', 'drying', 'folding', 'ready', 'pickedup', 'donated') default 'washing'
  route: text 1..40
  droppedAt: time default now
  readyAt: time ?
  pickedUpAt: time ?
  immutable customer, weightOz, droppedAt
  read <- .customer = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] or exists driverRoutes[viewer, route = .route]
  insert <- exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner']
  update <- exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] or .customer = viewer
  online only

-- A customer's lost/damaged claim; only the owner decides it.
table claims:
  order: orders
  customer: principal
  reason: enum('lost', 'damaged')
  detail: text 1..500
  status: enum('pending', 'approved', 'denied') default 'pending'
  refundCents: int ?
  at: time default now
  unique order else ALREADY_CLAIMED 'This order already has a claim.'
  immutable order, customer, reason, detail, at
  read <- .customer = viewer or exists roles[viewer, role = 'owner']
  insert <- .customer = viewer
  update <- exists roles[viewer, role = 'owner']
  online only

query myRole():
  return roles[viewer]

query allRoles(c: cursor ?):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  return roles first 50 by .id after c

query myOrders(c: cursor ?):
  return orders where .customer = viewer last 50 by .droppedAt after c { *, overdue: .droppedAt + 2d < now and (.status = 'washing' or .status = 'drying' or .status = 'folding') }

query receipt(order: orders):
  return orders[order]

query receipts(c: cursor ?):
  return orders where .customer = viewer and (.status = 'ready' or .status = 'pickedup') last 50 by .droppedAt after c

query board(c: cursor ?):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return orders where .status = 'washing' or .status = 'drying' or .status = 'folding' or .status = 'ready' last 100 by .droppedAt after c { *, overdue: .droppedAt + 2d < now and (.status = 'washing' or .status = 'drying' or .status = 'folding') }

query flagged(c: cursor ?):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return orders where .droppedAt + 2d < now and (.status = 'washing' or .status = 'drying' or .status = 'folding') last 100 by .droppedAt after c

query myRouteOrders(c: cursor ?):
  require exists roles[viewer, role = 'driver'] else NOT_DRIVER
  r = driverRoutes[viewer] ! else NO_ROUTE 'No route assigned to this driver.'
  return orders where .route = r.route last 100 by .droppedAt after c

query myRoute():
  return driverRoutes[viewer]

query routes(c: cursor ?):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return driverRoutes last 50 by .id after c

query myClaims(c: cursor ?):
  return claims where .customer = viewer last 50 by .at after c

query allClaims(c: cursor ?):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  return claims last 50 by .at after c

mutation provision(principal: principal, role: enum('customer', 'attendant', 'driver', 'owner')):
  require viewer = 'service:operator' or exists roles[viewer, role = 'owner'] else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

mutation assignRoute(driver: principal, route: text 1..40):
  require viewer = 'service:operator' or exists roles[viewer, role = 'owner'] else NOT_OWNER
  require exists roles[driver, role = 'driver'] else NOT_DRIVER
  return upsert driverRoutes[driver] { driver, route }

mutation dropOff(customer: principal, weightOz: int 1..3200, tagPhoto: image <=5000000, route: text 1..40):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] else NOT_ATTENDANT
  require exists roles[customer, role = 'customer'] else NOT_CUSTOMER 'Drop-offs are logged for customer accounts.'
  return insert orders { customer, weightOz, priceCents: weightOz * 25, tagPhoto, route }

mutation advanceStatus(order: orders, status: enum('drying', 'folding', 'ready')):
  o = orders[order] ! else NOT_FOUND
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  require (o.status = 'washing' and status = 'drying') or (o.status = 'drying' and status = 'folding') or (o.status = 'folding' and status = 'ready') else BAD_TRANSITION 'Bags move washing -> drying -> folding -> ready.'
  update orders[order] { status, readyAt: now if status = 'ready' else o.readyAt }
  return null

mutation pickup(order: orders):
  o = orders[order] ! else NOT_FOUND
  require o.customer = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'owner'] else NOT_YOURS
  require o.status = 'ready' else NOT_READY 'This bag is not ready for pickup.'
  require (o.readyAt ?? 0) > now - 30d else TOO_LATE 'Unclaimed bags are donated after 30 days.'
  update orders[order] { status: 'pickedup', pickedUpAt: now }
  return null

mutation fileClaim(order: orders, reason: enum('lost', 'damaged'), detail: text 1..500):
  o = orders[order] ! else NOT_FOUND
  require o.customer = viewer else NOT_YOURS 'Claims are filed by the order owner.'
  return insert claims { order, customer: viewer, reason, detail }

mutation decideClaim(claim: claims, approve: bool, refundCents: int ?):
  c = claims[claim] ! else NOT_FOUND
  require exists roles[viewer, role = 'owner'] else NOT_OWNER 'Only the store owner approves refunds.'
  require c.status = 'pending' else ALREADY_DECIDED 'This claim was already decided.'
  require not approve or (refundCents ?? 0) > 0 else BAD_REFUND 'An approved refund needs an amount.'
  require approve or refundCents = null else BAD_REFUND 'A denied claim carries no amount.'
  update claims[claim] { status: 'approved' if approve else 'denied', refundCents }
  return null

job donateUnclaimed(periodStart: time, periodEnd: time):
  for o in orders by .id:
    if o.status = 'ready' and (o.readyAt ?? 0) < periodEnd - 30d:
      update orders[o.id] { status: 'donated' }

schedule daily every 1d at 06:00: donateUnclaimed
