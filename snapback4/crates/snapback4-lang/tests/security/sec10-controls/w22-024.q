use identity password

table roles:
  principal: principal
  role: enum('customer', 'technician', 'office', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'technician', 'office', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query customers(c: cursor ?):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else OFFICE_ONLY
  return roles where .role = 'customer' first 100 by .id after c

table appliances:
  customer: principal
  address: text 5..200
  model: text 1..100
  createdAt: time default now
  immutable customer, address, model, createdAt
  read <- .customer = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  insert <- .customer = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  online only

query appliances(c: cursor ?):
  if exists roles[viewer, role = 'customer']:
    return appliances where .customer = viewer last 100 by .id after c
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else NO_ROLE
  return appliances last 100 by .id after c

query appliance(appliance: appliances):
  return appliances[appliance] ! else NOT_FOUND

mutation registerAppliance(customer: principal, address: text 5..200, model: text 1..100):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] or (customer = viewer and exists roles[viewer, role = 'customer']) else FORBIDDEN
  require exists roles[customer, role = 'customer'] else NOT_CUSTOMER
  return insert appliances { customer, address, model }

table visits:
  appliance: appliances
  customer: principal
  address: text 5..200
  model: text 1..100
  modelPlate: image <=5000000
  fault: text 1..1000
  partsHistory: text <=2000
  quoteCents: int 0..10000000
  status: enum('booked', 'en_route', 'waiting_parts', 'fixed') default 'booked'
  bookedAt: time default now
  visitedAt: time ?
  warrantyUntil: time ?
  originalVisit: visits ?
  approvedBy: principal ?
  immutable appliance, customer, address, model, modelPlate, bookedAt, originalVisit, approvedBy
  read <- .customer = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  update <- exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  online only

query visits(c: cursor ?):
  if exists roles[viewer, role = 'customer']:
    return visits where .customer = viewer last 100 by .id after c
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else NO_ROLE
  return visits last 100 by .id after c

query visit(visit: visits):
  return visits[visit] ! else NOT_FOUND

mutation bookVisit(appliance: appliances, modelPlate: image <=5000000, fault: text 1..1000, quoteCents: int 0..10000000):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else OFFICE_ONLY
  require quoteCents > 0 else QUOTE_REQUIRED
  a = appliances[appliance] ! else NOT_FOUND
  return insert visits { appliance, customer: a.customer, address: a.address, model: a.model, modelPlate, fault, quoteCents, partsHistory: '' }

mutation updateRepair(visit: visits, fault: text 1..1000, partsHistory: text <=2000, quoteCents: int 0..10000000):
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else STAFF_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.status != 'fixed' else REPAIR_CLOSED
  require v.originalVisit = null or quoteCents = 0 else FREE_REVISIT
  require v.originalVisit != null or quoteCents > 0 else QUOTE_REQUIRED
  return update visits[visit] { fault, partsHistory, quoteCents }

mutation moveVisit(visit: visits, status: enum('booked', 'en_route', 'waiting_parts', 'fixed')):
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else STAFF_ONLY
  v = visits[visit] ! else NOT_FOUND
  require (v.status = 'booked' and status = 'en_route') or (v.status = 'en_route' and (status = 'waiting_parts' or status = 'fixed')) or (v.status = 'waiting_parts' and (status = 'en_route' or status = 'fixed')) else BAD_TRANSITION
  if v.status = 'booked':
    return update visits[visit] { status, visitedAt: now }
  if status = 'fixed':
    require v.visitedAt != null else NO_VISIT_DATE
    return update visits[visit] { status, warrantyUntil: v.visitedAt + 90d }
  return update visits[visit] { status }

table billing:
  visit: visits
  cardReference: text 1..100
  cardLast4: text 4..4
  invoiceCents: int 0..10000000
  partsMarkupCents: int 0..10000000
  updatedAt: time default now
  unique visit
  immutable visit
  read <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  update <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  online only

query billing(visit: visits):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else OFFICE_ONLY
  return billing[visit]

mutation saveBilling(visit: visits, cardReference: text 1..100, cardLast4: text 4..4, invoiceCents: int 0..10000000, partsMarkupCents: int 0..10000000):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner'] else OFFICE_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.originalVisit = null or invoiceCents = 0 else FREE_REVISIT
  return upsert billing[visit] { visit, cardReference, cardLast4, invoiceCents, partsMarkupCents, updatedAt: now }

table warrantyApprovals:
  customer: principal
  originalVisit: visits
  approvedBy: principal
  approvedAt: time default now
  revisit: visits
  unique originalVisit
  immutable customer, originalVisit, approvedBy, approvedAt, revisit
  read <- .customer = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'owner'] and .approvedBy = viewer
  online only

query warrantyApproval(visit: visits):
  v = visits[visit] ! else NOT_FOUND
  return warrantyApprovals[originalVisit = visit]

mutation approveWarranty(visit: visits, modelPlate: image <=5000000):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'fixed' and v.originalVisit = null else NOT_REPAIRED
  require v.warrantyUntil != null and now < v.warrantyUntil else WARRANTY_EXPIRED
  require not exists warrantyApprovals[originalVisit = visit] else ALREADY_APPROVED
  revisit = insert visits { appliance: v.appliance, customer: v.customer, address: v.address, model: v.model, modelPlate, fault: v.fault, partsHistory: v.partsHistory, quoteCents: 0, originalVisit: visit, approvedBy: viewer }
  insert warrantyApprovals { customer: v.customer, originalVisit: visit, approvedBy: viewer, revisit: revisit.id }
  return revisit

invariant appliances.read only .customer = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
invariant visits.read only .customer = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
invariant billing.read only exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'owner']
invariant roles.role write only viewer = 'service:operator'
invariant warrantyApprovals.insert only exists roles[viewer, role = 'owner']
