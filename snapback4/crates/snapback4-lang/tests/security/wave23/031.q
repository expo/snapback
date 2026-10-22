use identity password

-- Roster grants come only from a local filesystem operator, never signup input.
table roles:
  principal: principal
  role: enum('couple', 'decorator', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('couple', 'decorator', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal = principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query customers():
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  return roles where .role = 'couple' first 100 by .id

table orders:
  couple: principal
  names: text 1..100
  eventAt: time
  inspiration: image <=2000000 ?
  design: text 1..1000
  quoteCents: int 100..10000000
  depositCents: int 1..10000000
  extraCents: int 0..10000000 default 0
  confirmedAt: time ?
  cancelledAt: time ?
  tastingAt: time ?
  immutable couple, names, eventAt, quoteCents, depositCents
  read <- .couple = viewer or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'owner'] or (.couple = viewer and exists roles[principal = viewer, role = 'couple'])
  update (old, next) <- exists roles[principal = viewer, role = 'owner'] or (old.couple = viewer and old.inspiration = next.inspiration)
  online only

table payments:
  orderId: orders
  couple: principal
  cents: int 1..10000000
  at: time
  kind: enum('deposit', 'payment')
  immutable orderId, couple, cents, at, kind
  read <- .couple = viewer or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'owner'] or (created orders[.orderId] and .couple = viewer)
  online only

table changes:
  orderId: orders
  couple: principal
  design: text 1..1000
  extraCents: int 0..10000000
  approvedBy: principal
  at: time
  immutable orderId, couple, design, extraCents, approvedBy, at
  read <- .couple = viewer or exists roles[principal = viewer, role = 'owner']
  insert <- .couple = viewer or exists roles[principal = viewer, role = 'owner']
  online only

-- Only the production brief is exposed to decorators; finances stay private.
table production:
  orderId: orders
  names: text 1..100
  eventAt: time
  design: text 1..1000
  stage: enum('baking', 'filling', 'decorating', 'boxed')
  active: bool default true
  unique orderId
  immutable orderId, names, eventAt
  read <- exists roles[principal = viewer, role = 'decorator'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'decorator'] or exists roles[principal = viewer, role = 'owner']
  online only

query listOrders(c: cursor ?):
  return orders first 100 by .id after c
query orderDetail(orderId: orders):
  return orders[orderId]
query listPayments(orderId: orders):
  return payments where .orderId = orderId first 100 by .id
query listChanges(orderId: orders):
  return changes where .orderId = orderId first 100 by .id
query productionBoard():
  require exists roles[principal = viewer, role = 'decorator'] or exists roles[principal = viewer, role = 'owner'] else STAFF_ONLY
  return production where .active = true first 100 by .id

mutation createOrder(couple: principal, names: text 1..100, eventAt: time, inspiration: image <=2000000 ?, design: text 1..1000, quoteCents: int 100..10000000, depositCents: int 1..10000000):
  require exists roles[principal = viewer, role = 'owner'] or (couple = viewer and exists roles[principal = viewer, role = 'couple']) else OWNER_OR_OWN_COUPLE_ONLY
  require exists roles[principal = couple, role = 'couple'] else INVALID_COUPLE
  require eventAt > now and eventAt <= now + 730d else EVENT_WINDOW
  require depositCents <= quoteCents else DEPOSIT_EXCEEDS_QUOTE
  row = insert orders { couple, names, eventAt, inspiration, design, quoteCents, depositCents }
  insert payments { orderId: row.id, couple, cents: depositCents, at: now, kind: 'deposit' }
  return row

mutation confirmDesign(orderId: orders):
  row = orders[orderId] ! else NOT_FOUND
  require row.couple = viewer else COUPLE_ONLY
  require row.cancelledAt = null else CANCELLED
  require row.confirmedAt = null else ALREADY_CONFIRMED
  require now <= row.eventAt - 21d else CONFIRMATION_DEADLINE
  return update orders[orderId] { confirmedAt: now }

mutation recordTasting(orderId: orders, at: time):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[orderId] ! else NOT_FOUND
  require row.cancelledAt = null else CANCELLED
  require row.tastingAt = null else TASTING_ALREADY_RECORDED
  require at <= now and at >= now - 1d and at <= row.eventAt - 30d else TASTING_DEADLINE
  return update orders[orderId] { tastingAt: at }

mutation changeDesign(orderId: orders, design: text 1..1000, extraCents: int 0..10000000):
  row = orders[orderId] ! else NOT_FOUND
  require row.cancelledAt = null else CANCELLED
  require now < row.eventAt else EVENT_PASSED
  require exists roles[principal = viewer, role = 'owner'] or (row.couple = viewer and now < row.eventAt - 7d and extraCents = 0) else OWNER_APPROVAL_REQUIRED
  require row.confirmedAt = null or exists roles[principal = viewer, role = 'owner'] else LOCKED_DESIGN
  require row.extraCents + extraCents <= 10000000 else CHARGE_LIMIT
  update orders[orderId] { design, extraCents: row.extraCents + extraCents }
  if exists production[orderId = orderId]:
    update production[orderId = orderId] { design }
  insert changes { orderId, couple: row.couple, design, extraCents, approvedBy: viewer, at: now }
  return orders[orderId]

mutation recordPayment(orderId: orders, cents: int 1..10000000):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[orderId] ! else NOT_FOUND
  require row.cancelledAt = null else CANCELLED
  return insert payments { orderId, couple: row.couple, cents, at: now, kind: 'payment' }

mutation cancelUnconfirmed(orderId: orders):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[orderId] ! else NOT_FOUND
  require row.cancelledAt = null else CANCELLED
  require row.confirmedAt = null else DESIGN_CONFIRMED
  require now > row.eventAt - 21d else TOO_EARLY_TO_CANCEL
  return update orders[orderId] { cancelledAt: now }

mutation startProduction(orderId: orders):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[orderId] ! else NOT_FOUND
  require row.cancelledAt = null else CANCELLED
  require row.confirmedAt != null else DESIGN_NOT_CONFIRMED
  require row.tastingAt != null else TASTING_REQUIRED
  require now < row.eventAt else EVENT_PASSED
  return insert production { orderId, names: row.names, eventAt: row.eventAt, design: row.design, stage: 'baking' }

mutation advanceStage(productionId: production, stage: enum('baking', 'filling', 'decorating', 'boxed')):
  require exists roles[principal = viewer, role = 'decorator'] else DECORATOR_ONLY
  row = production[productionId] ! else NOT_FOUND
  require (row.stage = 'baking' and stage = 'filling') or (row.stage = 'filling' and stage = 'decorating') or (row.stage = 'decorating' and stage = 'boxed') else INVALID_STAGE_TRANSITION
  return update production[productionId] { stage }

-- Reference edits are independent of design confirmation; only an owner may touch them.
mutation setInspiration(orderId: orders, inspiration: image <=2000000 ?):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[orderId] ! else NOT_FOUND
  return update orders[orderId] { inspiration }
