-- Llama Trekking Trips: guided llama treks with pack llamas.
-- Office (handler/owner) logs each trek with a photo of every hiker's signed
-- trail permit and the trek price. Cancel >10 days ahead is refunded in full.
-- A permit must be valid on the trek date or the hiker cannot be added.
-- Hikers see only their own treks/receipts; handlers see the live board
-- (booked -> saddled -> on_trail -> back_at_barn); only the owner approves a
-- route across private land, recording the landowner's permission.
use identity password

table roles:
  principal: principal
  role: enum('hiker', 'handler', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  online only

mutation provision(principal: principal, role: enum('hiker', 'handler', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table treks:
  title: text 1..80
  trekDate: time
  price: money USD
  status: enum('booked', 'saddled', 'on_trail', 'back_at_barn', 'cancelled') default 'booked'
  crossesPrivateLand: bool default false
  routeApproved: bool default false
  landownerPermission: text <=500 ?
  createdBy: principal
  createdAt: time default now
  immutable createdBy, trekDate, price
  read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'handler'] or exists trekHikers[trek = .id, hiker = viewer]
  insert <- exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
  delete <- deny
  cap 5000
  online only

table trekHikers:
  trek: treks
  hiker: principal
  permitPhoto: image <=5000000
  permitValidUntil: time
  addedAt: time default now
  unique trek, hiker
  immutable trek, hiker
  read <- .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
  insert <- .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
  update <- deny
  delete <- deny
  cap 20 by trek
  online only

table receipts:
  trek: treks
  hiker: principal
  amount: money USD
  kind: enum('charge', 'refund')
  at: time default now
  unique trek, hiker, kind
  immutable trek, hiker, amount, kind
  read <- .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
  insert <- .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
  update <- deny
  delete <- deny
  cap 100000
  online only

query myTreks(c: cursor ?):
  return treks after c first 50 by .id

query trekDetail(trek: treks):
  return treks[trek]

query participants(trek: treks, c: cursor ?):
  return trekHikers where .trek = trek first 50 by .id after c

query myReceipts(c: cursor ?):
  return receipts where .hiker = viewer first 50 by .id after c

query trekReceipts(trek: treks, c: cursor ?):
  return receipts where .trek = trek first 50 by .id after c

mutation createTrek(title: text 1..80, trekDate: time, price: money USD, crossesPrivateLand: bool):
  require exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  require trekDate > now else TREK_IN_PAST
  return insert treks { title, trekDate, price, crossesPrivateLand, createdBy: viewer }

mutation addHiker(trek: treks, hiker: principal, permitPhoto: image <=5000000, permitValidUntil: time):
  t = treks[trek] ! else NOT_FOUND
  require t.status = 'booked' else TREK_NOT_OPEN
  require hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner'] else NOT_ALLOWED
  require permitValidUntil >= t.trekDate else PERMIT_INVALID 'The trail permit must be valid on the trek date.'
  insert trekHikers { trek, hiker, permitPhoto, permitValidUntil }
  return insert receipts { trek, hiker, amount: t.price, kind: 'charge' }

mutation advanceStatus(trek: treks):
  require exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  t = treks[trek] ! else NOT_FOUND
  require t.status = 'booked' or t.status = 'saddled' or t.status = 'on_trail' else NOT_ADVANCEABLE
  update treks[trek] { status: 'saddled' if t.status = 'booked' else 'on_trail' if t.status = 'saddled' else 'back_at_barn' }
  return null

mutation cancelTrek(trek: treks):
  require exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  t = treks[trek] ! else NOT_FOUND
  require t.status != 'cancelled' else ALREADY_CANCELLED
  require t.status != 'back_at_barn' else TREK_COMPLETED
  update treks[trek] { status: 'cancelled' }
  if now < t.trekDate - 10d:
    for h in trekHikers where .trek = trek by .id:
      insert receipts { trek, hiker: h.hiker, amount: t.price, kind: 'refund' }
  return null

mutation approveRoute(trek: treks, landownerPermission: text 1..500):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  t = treks[trek] ! else NOT_FOUND
  require t.crossesPrivateLand else NO_PRIVATE_LAND
  update treks[trek] { routeApproved: true, landownerPermission }
  return null

-- Spec privacy and authority intent, stated independently from the rules above.
invariant treks.read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'handler'] or exists trekHikers[trek = .id, hiker = viewer]
invariant trekHikers.read only .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
invariant receipts.read only .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
invariant treks.insert only exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
invariant treks.update only exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
invariant trekHikers.insert only .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'owner']
invariant treks.approveRoute only exists roles[principal = viewer, role = 'owner']
