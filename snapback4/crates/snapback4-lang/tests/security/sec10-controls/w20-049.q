use identity password

table roles:
  principal: principal
  role: enum('customer', 'installer', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'installer', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query installers():
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  return roles where .role = 'installer' first 100 by .id

table orders:
  customer: principal
  title: text 1..100
  site: text 5..300
  installer: principal ?
  createdAt: time default now
  proof: proofs ?
  proofApproved: bool default false
  permitUntil: time ?
  waived: bool default false
  authorized: bool default false
  completedAt: time ?
  immutable customer, title, site, createdAt
  read <- .customer = viewer or .installer = viewer or exists roles[principal = viewer, role = 'owner']
  insert <- .customer = viewer and exists roles[principal = viewer, role = 'customer']
  update <- .customer = viewer or .installer = viewer or exists roles[principal = viewer, role = 'owner']
  online only

table board:
  order: orders
  stage: enum('design', 'ready', 'installed')
  unique order
  immutable order
  read <- exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'owner']
  insert <- created orders[.order, customer = viewer]
  update <- exists roles[principal = viewer, role = 'owner'] or exists orders[.order, installer = viewer]
  online only

table uploads:
  order: orders
  kind: enum('logo', 'site')
  document: file <=10000000 ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  at: time default now
  immutable order, kind, document, at
  read <- exists orders[.order, customer = viewer] or exists roles[principal = viewer, role = 'owner']
  insert <- exists orders[.order, customer = viewer]
  online only

table proofs:
  order: orders
  document: file <=10000000 ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  submittedAt: time
  deadline: time
  approvedAt: time ?
  immutable order, document, submittedAt, deadline
  read <- exists orders[.order, customer = viewer] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'owner']
  update <- exists orders[.order, customer = viewer]
  online only

table permits:
  order: orders
  number: text 1..80
  issuedAt: time
  expiresAt: time
  immutable order, number, issuedAt, expiresAt
  read <- exists orders[.order, customer = viewer] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'owner']
  online only

table waivers:
  order: orders
  town: text 2..100
  reason: text 10..1000
  recordedBy: principal
  at: time default now
  immutable order, town, reason, recordedBy, at
  read <- exists orders[.order, customer = viewer] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'owner'] and .recordedBy = viewer
  online only

query myOrders(c: cursor ?):
  return orders last 50 by .id after c

query orderDetail(order: orders):
  return orders[order]

query installBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'installer'] or exists roles[principal = viewer, role = 'owner'] else STAFF_ONLY
  return board last 50 by .id after c

query documents(order: orders):
  row = orders[order] ! else NOT_FOUND
  require row.customer = viewer or exists roles[principal = viewer, role = 'owner'] else PRIVATE
  return { uploads: uploads where .order = order first 50 by .id, proofs: proofs where .order = order last 50 by .id, permits: permits where .order = order last 50 by .id, waivers: waivers where .order = order last 50 by .id }

mutation createOrder(title: text 1..100, site: text 5..300):
  require exists roles[principal = viewer, role = 'customer'] else CUSTOMER_ONLY
  row = insert orders { customer: viewer, title, site }
  insert board { order: row.id, stage: 'design' }
  return row

mutation attachFile(order: orders, kind: enum('logo', 'site'), document: file <=10000000 ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')):
  row = orders[order] ! else NOT_FOUND
  require row.customer = viewer else CUSTOMER_ONLY
  require row.completedAt = null else COMPLETED
  require kind != 'site' or document.type = 'image/png' or document.type = 'image/jpeg' or document.type = 'image/webp' else PHOTO_REQUIRED 'Site uploads must be PNG, JPEG, or WebP photos.'
  return insert uploads { order, kind, document }

mutation assignInstaller(order: orders, installer: principal):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[order] ! else NOT_FOUND
  require row.completedAt = null else COMPLETED
  require exists roles[principal = installer, role = 'installer'] else NOT_INSTALLER
  update orders[order] { installer }

mutation submitProof(order: orders, document: file <=10000000 ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[order] ! else NOT_FOUND
  require row.completedAt = null else COMPLETED
  p = insert proofs { order, document, submittedAt: now, deadline: now + 10d }
  update orders[order] { proof: p.id, proofApproved: false, authorized: false }
  update board[order] { stage: 'design' }
  return p

mutation approveProof(order: orders):
  row = orders[order] ! else NOT_FOUND
  require row.customer = viewer else CUSTOMER_ONLY
  require row.completedAt = null else COMPLETED
  require row.proof != null else NO_PROOF
  p = proofs[row.proof] ! else NOT_FOUND
  require p.approvedAt = null else ALREADY_APPROVED
  require now < p.deadline else PROOF_EXPIRED 'The ten-day proof approval window has closed; request a new proof.'
  update proofs[p.id] { approvedAt: now }
  update orders[order] { proofApproved: true }

mutation issuePermit(order: orders, number: text 1..80, issuedAt: time):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[order] ! else NOT_FOUND
  require row.completedAt = null else COMPLETED
  require issuedAt <= now and issuedAt > now - 180d else INVALID_ISSUE_DATE 'Permit must have been issued within the past 180 days.'
  p = insert permits { order, number, issuedAt, expiresAt: issuedAt + 180d }
  update orders[order] { permitUntil: p.expiresAt, authorized: false }
  return p

mutation recordWaiver(order: orders, town: text 2..100, reason: text 10..1000):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[order] ! else NOT_FOUND
  require row.completedAt = null else COMPLETED
  require not row.waived else ALREADY_WAIVED
  w = insert waivers { order, town, reason, recordedBy: viewer }
  update orders[order] { waived: true, authorized: false }
  return w

mutation authorizeInstall(order: orders):
  require exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  row = orders[order] ! else NOT_FOUND
  require row.completedAt = null else COMPLETED
  require row.proofApproved else PROOF_REQUIRED
  require row.waived or (row.permitUntil != null and now < row.permitUntil) else PERMIT_REQUIRED
  update orders[order] { authorized: true }
  update board[order] { stage: 'ready' }

mutation completeInstall(order: orders):
  row = orders[order] ! else NOT_FOUND
  require row.installer = viewer or exists roles[principal = viewer, role = 'owner'] else INSTALLER_ONLY
  require row.completedAt = null else COMPLETED
  require row.authorized and row.proofApproved else APPROVAL_REQUIRED
  require row.waived or (row.permitUntil != null and now < row.permitUntil) else PERMIT_EXPIRED 'A new permit is required before installation.'
  update orders[order] { completedAt: now }
  update board[order] { stage: 'installed' }
