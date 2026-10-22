-- Wig Making Orders.
-- Roles: owner (studio owner), coordinator, maker (wig maker), client.
-- Roster is operator-provisioned; clients may self-register as client only.

use identity password

table roles:
  principal: principal
  role: enum('owner', 'coordinator', 'maker', 'client')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or (.principal = viewer and .role = 'client')
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'coordinator', 'maker', 'client'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

mutation claimClientRole(name: text 1..80):
  return insert roles { principal: viewer, role: 'client', name }

query myRole():
  return roles[viewer]

-- Orders. diagnosis/phone/price are visible only to the order's client,
-- the coordinator and the studio owner. Makers see workroom fields + photo.
table orders:
  client: principal
  clientName: text 1..80
  coordinator: principal
  diagnosis: text 1..500 read <- .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  phone: text 1..40 ? read <- .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  price: money USD read <- .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  photo: image <=5000000 ?
  measurements: text 1..1000
  hairSample: text 1..500
  capDesign: text 1..1000
  stage: enum('cap', 'ventilating', 'styling', 'fitting', 'complete') default 'cap'
  depositAt: time default now
  orderNotes: text <=1000 ?
  immutable client, depositAt
  read <- .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'maker']
  insert <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'maker']
  online only

mutation createOrder(client: principal, clientName: text 1..80, diagnosis: text 1..500, phone: text 1..40 ?, price: money USD, photo: image <=5000000 ?, measurements: text 1..1000, hairSample: text 1..500, capDesign: text 1..1000, orderNotes: text <=1000 ?):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] else NOT_STAFF
  return insert orders { client, clientName, coordinator: viewer, diagnosis, phone, price, photo, measurements, hairSample, capDesign, orderNotes }

mutation updateWorkroom(order: orders, measurements: text 1..1000 ?, hairSample: text 1..500 ?, capDesign: text 1..1000 ?):
  o = orders[order] ! else ORDER_MISSING
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'maker'] else NOT_STAFF
  return update orders[order] { measurements: measurements ?? o.measurements, hairSample: hairSample ?? o.hairSample, capDesign: capDesign ?? o.capDesign }

mutation moveStage(order: orders, stage: enum('ventilating', 'styling', 'fitting', 'complete')):
  o = orders[order] ! else ORDER_MISSING
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'maker'] else NOT_STAFF
  require (o.stage = 'cap' and stage = 'ventilating') or (o.stage = 'ventilating' and stage = 'styling') or (o.stage = 'styling' and stage = 'fitting') or (o.stage = 'fitting' and stage = 'complete') else BAD_STAGE
  return update orders[order] { stage }

query myOrders(c: cursor ?):
  return orders where .client = viewer first 50 by .id after c

query staffOrders(c: cursor ?):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'maker'] else NOT_STAFF
  return orders first 50 by .id after c

query board(c: cursor ?):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'maker'] else NOT_STAFF
  return orders where .stage != 'complete' first 50 by .id after c

query orderDetail(order: orders):
  return orders[order]

query clientOrders(client: principal, c: cursor ?):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] else NOT_STAFF
  return orders where .client = client first 50 by .id after c

-- Fittings. Must be scheduled/recorded within 45 days of the deposit.
table fittings:
  order: orders
  client: principal
  scheduledAt: time
  fittedAt: time ?
  fittingNotes: text <=500 ?
  immutable order, client
  read <- .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'maker']
  insert <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  online only

mutation scheduleFitting(order: orders, scheduledAt: time, fittingNotes: text <=500 ?):
  o = orders[order] ! else ORDER_MISSING
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] else NOT_STAFF
  require scheduledAt >= o.depositAt else FITTING_EARLY
  require scheduledAt <= o.depositAt + 45d else FITTING_LATE
  return insert fittings { order, client: o.client, scheduledAt, fittedAt: null, fittingNotes }

mutation completeFitting(fitting: fittings):
  f = fittings[fitting] ! else FITTING_MISSING
  o = orders[f.order] ! else ORDER_MISSING
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] else NOT_STAFF
  require now <= o.depositAt + 45d else FITTING_WINDOW_CLOSED
  return update fittings[fitting] { fittedAt: now }

query orderFittings(order: orders, c: cursor ?):
  return fittings where .order = order first 50 by .id after c

query myFittings(c: cursor ?):
  return fittings where .client = viewer first 50 by .id after c

-- Free remakes. Only the studio owner approves; the reason is kept.
table remakes:
  order: orders
  client: principal
  reason: text 1..500
  free: bool
  approvedBy: principal
  decidedAt: time default now
  immutable order, client, reason, free, approvedBy
  read <- .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  insert <- exists roles[viewer, role = 'owner']
  online only

mutation approveRemake(order: orders, reason: text 1..500, free: bool):
  o = orders[order] ! else ORDER_MISSING
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  return insert remakes { order, client: o.client, reason, free, approvedBy: viewer }

query orderRemakes(order: orders, c: cursor ?):
  return remakes where .order = order first 20 by .id after c

-- Privacy intent, stated independently from the rules above.
invariant orders.read only .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'maker']
invariant orders.diagnosis read only .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant orders.phone read only .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant orders.price read only .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant orders.price write only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant orders.diagnosis write only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant fittings.read only .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'maker']
invariant fittings.insert only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant remakes.insert only exists roles[viewer, role = 'owner']
invariant remakes.read only .client = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant roles.read only .principal = viewer or viewer = 'service:operator'
