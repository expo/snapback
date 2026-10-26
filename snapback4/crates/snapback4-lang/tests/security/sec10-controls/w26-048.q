use identity password

table roles:
  principal: principal
  role: enum('customer', 'estimator', 'fabricator', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'estimator', 'fabricator', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]
query customers(c: cursor ?):
  require exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner'] else NOT_OFFICE
  return roles where .role = 'customer' first 100 by .id after c

table orders:
  customer: principal
  estimator: principal
  title: text 1..120
  address: text 5..240
  fabric: text 1..80
  quoteCents: int 1..100000000
  sitePhoto: image <=5000000
  anchorPhoto: image <=5000000
  fabricSample: image <=5000000
  neighborWall: bool
  createdAt: time
  approvalDueAt: time
  immutable customer, estimator, title, address, fabric, quoteCents, sitePhoto, anchorPhoto, fabricSample, neighborWall, createdAt, approvalDueAt
  read <- .customer = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'owner']
  insert <- .estimator = viewer and exists roles[viewer, role = 'estimator'] and exists roles[.customer, role = 'customer']
  online only

table approvals:
  order: orders
  customer: principal
  approvedAt: time
  unique order
  immutable order, customer, approvedAt
  read <- exists orders[.order, customer = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'owner']
  insert <- .customer = viewer and exists orders[.order, customer = viewer]
  online only

table permissions:
  order: orders
  owner: principal
  neighborName: text 1..120
  writtenPermission: file <=5000000 ('application/pdf', 'image/jpeg', 'image/png')
  approvedAt: time
  unique order
  immutable order, owner, neighborName, writtenPermission, approvedAt
  read <- exists orders[.order, customer = viewer] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'fabricator']
  insert <- .owner = viewer and exists roles[viewer, role = 'owner']
  online only

table progress:
  order: orders
  stage: enum('measured', 'posts_set', 'sewn', 'tensioned')
  held: bool default false
  installedAt: time ?
  warrantyUntil: time ?
  unique order
  immutable order
  read <- exists orders[.order, customer = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'estimator'] and created orders[.order]
  update <- exists roles[viewer, role = 'fabricator']
  online only

table invoices:
  order: orders
  customer: principal
  cents: int 1..100000000
  issuedAt: time
  unique order
  immutable order, customer, cents, issuedAt
  read <- .customer = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'estimator'] and created orders[.order]
  online only

mutation createOrder(customer: principal, title: text 1..120, address: text 5..240, fabric: text 1..80, quoteCents: int 1..100000000, sitePhoto: image <=5000000, anchorPhoto: image <=5000000, fabricSample: image <=5000000, neighborWall: bool):
  require exists roles[viewer, role = 'estimator'] else NOT_ESTIMATOR
  require exists roles[customer, role = 'customer'] else NOT_CUSTOMER
  o = insert orders { customer, estimator: viewer, title, address, fabric, quoteCents, sitePhoto, anchorPhoto, fabricSample, neighborWall, createdAt: now, approvalDueAt: now + 14d }
  insert progress { order: o.id, stage: 'measured' }
  insert invoices { order: o.id, customer, cents: quoteCents, issuedAt: now }
  return o

mutation approveSample(order: orders):
  require exists roles[viewer, role = 'customer'] else NOT_CUSTOMER
  o = orders[order] ! else NOT_FOUND
  require o.customer = viewer else NOT_YOURS
  require now < o.approvalDueAt else SAMPLE_DEADLINE 'The 14-day sample approval window has closed. This order is held.'
  require not exists approvals[order] else ALREADY_APPROVED
  return insert approvals { order, customer: viewer, approvedAt: now }

mutation approveNeighbor(order: orders, neighborName: text 1..120, writtenPermission: file <=5000000 ('application/pdf', 'image/jpeg', 'image/png')):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  o = orders[order] ! else NOT_FOUND
  require o.neighborWall else NO_NEIGHBOR_WALL
  require not exists permissions[order] else ALREADY_APPROVED
  return insert permissions { order, owner: viewer, neighborName, writtenPermission, approvedAt: now }

fn warrantyEnd(at: time):
  m = month(at)
  target = monthStart(m + 120)
  targetDays = (monthStart(m + 121) - target) / 1d
  sourceDay = (at - monthStart(m)) / 1d
  targetDay = sourceDay if sourceDay < targetDays else targetDays - 1
  return target + targetDay * 1d + at % 1d

mutation advanceStage(order: orders):
  require exists roles[viewer, role = 'fabricator'] else NOT_FABRICATOR
  o = orders[order] ! else NOT_FOUND
  p = progress[order] ! else NOT_FOUND
  require exists approvals[order] else SAMPLE_NOT_APPROVED
  require not p.held else ORDER_HELD
  require not o.neighborWall or exists permissions[order] else NEIGHBOR_PERMISSION_REQUIRED
  require p.stage != 'tensioned' else ALREADY_INSTALLED
  if p.stage = 'measured':
    return update progress[order] { stage: 'posts_set' }
  else if p.stage = 'posts_set':
    return update progress[order] { stage: 'sewn' }
  else:
    return update progress[order] { stage: 'tensioned', installedAt: now, warrantyUntil: warrantyEnd(now) }

query board(c: cursor ?):
  require exists roles[viewer] else NO_ROLE
  return orders last 100 by .createdAt after c { *, work: progress[.id], approval: approvals[.id], permission: permissions[.id], onHold: not exists approvals[.id] and now >= .approvalDueAt }
query orderDetail(order: orders):
  require exists roles[viewer] else NO_ROLE
  return orders[order] { *, work: progress[.id], approval: approvals[.id], permission: permissions[.id], onHold: not exists approvals[.id] and now >= .approvalDueAt }
query invoice(order: orders):
  require exists roles[viewer, role = 'customer'] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner'] else NOT_OFFICE
  return invoices[order]

job holdOverdue():
  for o in orders:
    if now >= o.approvalDueAt and not exists approvals[o.id]:
      p = progress[o.id]
      if p != null and not p.held:
        update progress[o.id] { held: true }
schedule deadlineSweep every 1m: holdOverdue

invariant orders.read only .customer = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'fabricator'] or exists roles[viewer, role = 'owner']
invariant invoices.read only .customer = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner']
invariant roles.role write only viewer = 'service:operator'
invariant permissions.insert only exists roles[viewer, role = 'owner']
invariant approvals.insert only .customer = viewer and exists orders[.order, customer = viewer]
invariant progress.advanceStage only exists roles[viewer, role = 'fabricator']
