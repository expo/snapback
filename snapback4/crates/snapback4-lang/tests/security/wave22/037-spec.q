-- Orthotic Casting Orders.
-- Roles: podiatrist, clinic_staff, lab_tech (rostered via operator
-- provisioning); patient (any password account without a roster row).
-- Privacy split: `orders` carries the lab-visible fabrication fields
-- (scan, shoe size, posting, material, status); `orderDetails` carries the
-- clinic-private fields (patient name, diagnosis, insurance billing, price)
-- readable only by the patient, clinic staff and the podiatrist.
use identity password

table roles:
  principal: principal
  role: enum('podiatrist', 'clinic_staff', 'lab_tech')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('podiatrist', 'clinic_staff', 'lab_tech')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table orders:
  patient: principal
  scan: image <=10000000
  shoeSize: text 1..10
  posting: enum('medial', 'lateral', 'neutral', 'none')
  material: enum('polypropylene', 'eva', 'carbon', 'cork', 'leather')
  status: enum('cast', 'shipped', 'fitted', 'adjusted', 'remake_requested', 'remake_approved') default 'cast'
  fittedAt: time ?
  adjusted: bool default false
  adjustedAt: time ?
  remakeReason: text 1..500 ?
  createdAt: time default now
  immutable patient
  cap 500 by patient
  read <- .patient = viewer or exists roles[viewer]
  insert <- exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist']
  update <- exists roles[viewer] or .patient = viewer
  sync

table orderDetails:
  order: orders
  patient: principal
  patientName: text 1..100
  diagnosis: text 1..500
  billing: text 1..100
  price: money USD
  unique order
  immutable order, patient
  read <- .patient = viewer or exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist']
  insert <- exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist']
  update <- exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist']
  online only

table fittings:
  order: orders
  patient: principal
  notes: text 1..500
  at: time default now
  immutable order, patient
  cap 100 by order
  read <- .patient = viewer or exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist']
  insert <- exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist']
  online only

query board(c: cursor ?):
  require exists roles[viewer] else NOT_ROSTER
  return orders last 50 by .id after c

query myOrders(c: cursor ?):
  return orders where .patient = viewer last 50 by .id after c

query orderFor(order: orders):
  return orders[order]

query detailsFor(order: orders):
  return orderDetails[order]

query fittingsFor(order: orders, c: cursor ?):
  return fittings where .order = order first 50 by .id after c

mutation placeOrder(patient: principal, scan: image <=10000000, shoeSize: text 1..10, posting: enum('medial', 'lateral', 'neutral', 'none'), material: enum('polypropylene', 'eva', 'carbon', 'cork', 'leather'), patientName: text 1..100, diagnosis: text 1..500, billing: text 1..100, price: money USD):
  require exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist'] else NOT_AUTHORIZED
  o = insert orders { patient, scan, shoeSize, posting, material }
  insert orderDetails { order: o.id, patient, patientName, diagnosis, billing, price }
  return o

mutation markShipped(order: orders):
  t = orders[order] ! else NOT_FOUND
  require exists roles[viewer] else NOT_AUTHORIZED
  require t.status = 'cast' else BAD_STATE 'Only a cast order can be marked shipped.'
  update orders[order] { status: 'shipped' }
  return null

mutation markFitted(order: orders):
  t = orders[order] ! else NOT_FOUND
  require exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist'] else NOT_AUTHORIZED
  require t.status = 'shipped' else BAD_STATE 'Only a shipped order can be marked fitted.'
  update orders[order] { status: 'fitted', fittedAt: now }
  return null

mutation requestAdjustment(order: orders):
  t = orders[order] ! else NOT_FOUND
  require t.patient = viewer or exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist'] else NOT_AUTHORIZED
  require not t.adjusted else ALREADY_ADJUSTED 'This order already had its free adjustment.'
  require t.status = 'fitted' else BAD_STATE 'Only a fitted order can be adjusted.'
  windowStart = t.fittedAt ?? 0
  require windowStart != 0 and now <= windowStart + 60d else ADJUSTMENT_WINDOW_CLOSED 'The one free adjustment is within 60 days of fitting.'
  update orders[order] { status: 'adjusted', adjusted: true, adjustedAt: now }
  return null

mutation requestRemake(order: orders, reason: text 1..500):
  t = orders[order] ! else NOT_FOUND
  require t.patient = viewer or exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist'] else NOT_AUTHORIZED
  require t.status = 'fitted' or t.status = 'adjusted' else BAD_STATE 'Only a fitted or adjusted order can be remade.'
  update orders[order] { status: 'remake_requested', remakeReason: reason }
  return null

mutation approveRemake(order: orders):
  t = orders[order] ! else NOT_FOUND
  require exists roles[viewer, role = 'podiatrist'] else NOT_AUTHORIZED 'Only the podiatrist can approve a remake.'
  require t.status = 'remake_requested' else BAD_STATE 'No remake was requested for this order.'
  update orders[order] { status: 'remake_approved' }
  return null

mutation addFitting(order: orders, notes: text 1..500):
  t = orders[order] ! else NOT_FOUND
  require exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist'] else NOT_AUTHORIZED
  return insert fittings { order: order, patient: t.patient, notes }

-- Privacy intent, stated independently of the enforcement rules above.
invariant orderDetails.diagnosis read only exists roles[viewer, role = 'clinic_staff'] or exists roles[viewer, role = 'podiatrist']
