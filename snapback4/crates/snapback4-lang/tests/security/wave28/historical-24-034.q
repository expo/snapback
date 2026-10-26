use identity password

table roles:
  principal: principal
  role: enum('owner', 'clerk', 'restorer', 'customer')
  label: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'clerk', 'restorer', 'customer'), label: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, label }

query me():
  return roles[viewer]

query customers(c: cursor ?):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk'] else STAFF_ONLY
  return roles where .role = 'customer' first 100 by .id after c

table orders:
  customer: principal
  title: text 1..100
  damage: text 1..2000
  scan: image <=10000000
  phone: text 5..40
  address: text 5..300
  priceCents: int 1..1000000
  status: enum('scanned', 'repaired', 'proofed', 'printed') default 'scanned'
  repairNotes: text <=2000 default ''
  proof: image <=10000000 ?
  proofDue: time ?
  approvedAt: time ?
  openedAt: time default now
  openedBy: principal
  immutable customer, openedBy, openedAt
  read <- .customer = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'restorer']
  read (phone, address, priceCents) <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk']
  insert <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk']
  update <- .customer = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'restorer']
  online only

invariant orders.read only .customer = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'restorer']
invariant orders.phone read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk']
invariant orders.address read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk']
invariant orders.priceCents read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk']

query board(c: cursor ?):
  return orders last 100 by .id after c
query order(order: orders):
  return orders[order]

mutation openOrder(customer: principal, title: text 1..100, damage: text 1..2000, scan: image <=10000000, phone: text 5..40, address: text 5..300, priceCents: int 1..1000000):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk'] else COUNTER_ONLY
  require exists roles[customer, role = 'customer'] else CUSTOMER_REQUIRED
  return insert orders { customer, title, damage, scan, phone, address, priceCents, openedBy: viewer }

mutation repair(order: orders, notes: text 1..2000):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'restorer'] else RESTORER_ONLY
  r = orders[order] ! else NOT_FOUND
  require r.status = 'scanned' else WRONG_STAGE
  return update orders[order] { status: 'repaired', repairNotes: notes }

mutation publishProof(order: orders, proof: image <=10000000):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'restorer'] else RESTORER_ONLY
  r = orders[order] ! else NOT_FOUND
  require r.status = 'repaired' else WRONG_STAGE
  return update orders[order] { status: 'proofed', proof, proofDue: now + 30d, approvedAt: null }

mutation approveProof(order: orders):
  r = orders[order] ! else NOT_FOUND
  require r.customer = viewer and exists roles[viewer, role = 'customer'] else CUSTOMER_ONLY
  require r.status = 'proofed' and r.approvedAt = null else WRONG_STAGE
  require r.proofDue != null else PROOF_REQUIRED
  require now < r.proofDue else PROOF_EXPIRED
  return update orders[order] { approvedAt: now }

mutation printOrder(order: orders):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk'] else COUNTER_ONLY
  r = orders[order] ! else NOT_FOUND
  require r.status = 'proofed' and r.approvedAt != null else APPROVAL_REQUIRED
  return update orders[order] { status: 'printed' }

table reworks:
  order: orders
  reason: text 5..2000
  approvedBy: principal
  at: time default now
  immutable order, reason, approvedBy, at
  read <- exists orders[.order, customer = viewer] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'restorer']
  insert <- exists roles[viewer, role = 'owner'] and .approvedBy = viewer
  online only
invariant reworks.insert only exists roles[viewer, role = 'owner']

query reworkHistory(order: orders, c: cursor ?):
  require exists orders[order] else NOT_FOUND
  return reworks where .order = order last 100 by .id after c

mutation approveRework(order: orders, reason: text 5..2000):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  r = orders[order] ! else NOT_FOUND
  require r.status = 'proofed' or r.status = 'printed' else WRONG_STAGE
  insert reworks { order, reason, approvedBy: viewer }
  return update orders[order] { status: 'scanned', proof: null, proofDue: null, approvedAt: null, repairNotes: '' }
