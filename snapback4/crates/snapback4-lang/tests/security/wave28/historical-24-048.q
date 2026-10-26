-- Awning Fabrication Orders.
-- Roles: owner (shop owner), estimator, fabricator, customer.
-- Estimators open orders with wall/opening photos plus the quoted price.
-- Customers approve the fabric sample within 14 days or the order is held.
-- The frame carries a five-year warranty from installation.
-- Customers see only their own orders and invoices; fabricators see the
-- live shop board; only the owner approves facade-limit overrides.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'estimator', 'fabricator', 'customer')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'estimator', 'fabricator', 'customer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query whoAmI():
  return { principal: viewer }

-- Spec: everyone sees their own roster row; estimators and owners also see
-- the roster so they can validate a customer's principal when opening orders.
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']
invariant roles.insert only viewer = 'service:operator'

table orders:
  customer: principal
  estimator: principal
  title: text 1..80
  status: enum('measured', 'frame_welded', 'sewn', 'installed', 'held')
  photos: [image <=5000000] 1..4
  quotedPrice: money USD
  fabricApproved: bool default false
  fabricApprovedAt: time ?
  sampleDueAt: time
  installedAt: time ?
  warrantyUntil: time ?
  facadeOverride: bool default false
  landlordPermission: text 10..2000 ?
  createdAt: time default now
  read <- .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  update <- .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator']
  online only

-- Spec: customers see only their own orders; staff see the board.
-- Quoted prices and landlord permissions follow the same audience.
invariant orders.read only .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator']
invariant orders.quotedPrice read only .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator']
invariant orders.landlordPermission read only .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator']
invariant orders.insert only exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']

table invoices:
  order: orders
  customer: principal
  amount: money USD
  issuedAt: time default now
  read <- .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  online only

-- Spec: customers see only their own invoices.
invariant invoices.read only .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator']
invariant invoices.amount read only .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator']
invariant invoices.insert only exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']

mutation openOrder(customer: principal, title: text 1..80, photos: [image <=5000000] 1..4, quotedPrice: money USD):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR 'Only an estimator or the owner may open an order.'
  require exists roles[principal = customer, role = 'customer'] else NOT_CUSTOMER 'The order customer must hold the customer role.'
  return insert orders { customer, estimator: viewer, title, status: 'measured', photos, quotedPrice, sampleDueAt: now + 14d, createdAt: now }

mutation approveFabric(order: orders):
  o = orders[order] ! else NOT_FOUND
  require o.customer = viewer else NOT_YOUR_ORDER 'Customers may approve only their own orders.'
  require o.status != 'held' else ORDER_HELD 'This order is held; ask the shop to reopen it.'
  require not o.fabricApproved else ALREADY_APPROVED 'The fabric sample is already approved.'
  require now <= o.sampleDueAt else SAMPLE_EXPIRED 'The 14-day fabric sample window has passed; the order is held.'
  return update orders[order] { fabricApproved: true, fabricApprovedAt: now }

mutation advanceStatus(order: orders, status: enum('frame_welded', 'sewn')):
  o = orders[order] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'fabricator'] or exists roles[principal = viewer, role = 'owner'] else NOT_FABRICATOR 'Only a fabricator or the owner may move the shop board.'
  require o.status != 'held' else ORDER_HELD 'This order is held and cannot move.'
  require o.status != 'installed' else ALREADY_INSTALLED 'This order is already installed.'
  require o.status = 'measured' and status = 'frame_welded' or o.status = 'frame_welded' and status = 'sewn' else BAD_TRANSITION 'Orders move measured to frame welded to sewn, one step at a time.'
  require o.fabricApproved else FABRIC_NOT_APPROVED 'The customer must approve the fabric sample first.'
  return update orders[order] { status }

mutation markInstalled(order: orders):
  o = orders[order] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'fabricator'] or exists roles[principal = viewer, role = 'owner'] else NOT_FABRICATOR 'Only a fabricator or the owner may mark installation.'
  require o.status = 'sewn' else BAD_TRANSITION 'Only a sewn awning can be installed.'
  require o.fabricApproved else FABRIC_NOT_APPROVED 'The customer must approve the fabric sample first.'
  return update orders[order] { status: 'installed', installedAt: now, warrantyUntil: now + 1825d }

mutation approveFacadeOverride(order: orders, landlordPermission: text 10..2000):
  o = orders[order] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the shop owner may approve installing over the facade limits.'
  require o.status != 'installed' else ALREADY_INSTALLED 'This order is already installed.'
  return update orders[order] { facadeOverride: true, landlordPermission }

mutation createInvoice(order: orders, amount: money USD):
  o = orders[order] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR 'Only an estimator or the owner may invoice.'
  require o.status != 'held' else ORDER_HELD 'A held order cannot be invoiced.'
  return insert invoices { order, customer: o.customer, amount }

query myOrders(c: cursor ?):
  return orders where .customer = viewer first 50 by .id after c

query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only shop staff may see the board.'
  return orders first 50 by .id after c

query orderDetail(order: orders):
  return orders[order]

query myInvoices(c: cursor ?):
  return invoices where .customer = viewer first 50 by .id after c

query orderInvoices(order: orders, c: cursor ?):
  o = orders[order] ! else NOT_FOUND
  require o.customer = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator'] or exists roles[principal = viewer, role = 'owner'] else NOT_YOUR_ORDER 'Invoices follow their order audience.'
  return invoices where .order = order first 50 by .id after c

query warranty(order: orders):
  o = orders[order] ! else NOT_FOUND
  require o.customer = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'fabricator'] or exists roles[principal = viewer, role = 'owner'] else NOT_YOUR_ORDER 'Warranty follows its order audience.'
  return { installedAt: o.installedAt, warrantyUntil: o.warrantyUntil, covered: o.warrantyUntil != null and now <= (o.warrantyUntil ?? 0) }

job holdOverdue():
  for o in orders:
    if not o.fabricApproved and o.status != 'held' and o.status != 'installed' and now >= o.sampleDueAt:
      update orders[o.id] { status: 'held' }

schedule holdCheck every 1d at 03:00: holdOverdue
