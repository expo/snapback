-- Llama Trekking Trips v2: guided llama outings with pack llamas.
-- The farm office logs each llama outing with a photo of every hiker's signed
-- trail permit and the outing price. Cancel >10 days ahead is refunded in full.
-- A permit must be valid on the outing date or the hiker cannot be added.
-- Hikers see only their own outings/receipts; handlers and the farm office see
-- the live outing board (booked -> saddled -> on_trail -> back_at_barn); only
-- the owner approves a route across private land, recording the landowner's
-- permission. Only the farm office and the farm owner may add, replace or
-- remove an outing's signed trail permit photos; hikers and handlers cannot.
--
-- v2 renames treks to llama outings: tables/columns/operations carry the new
-- names, with `renamed from` preserving every existing row's identity and
-- `alias` keeping every v1 operation callable (v1 callers are subject to the
-- v2 photo rule, so handler/hiker photo writes now refuse).
use identity password

table roles:
  principal: principal
  role: enum('hiker', 'handler', 'office', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  online only

mutation provision(principal: principal, role: enum('hiker', 'handler', 'office', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table outings renamed from treks:
  title: text 1..80
  outingDate: time renamed from trekDate
  price: money USD
  status: enum('booked', 'saddled', 'on_trail', 'back_at_barn', 'cancelled') default 'booked'
  crossesPrivateLand: bool default false
  routeApproved: bool default false
  landownerPermission: text <=500 ?
  createdBy: principal
  createdAt: time default now
  immutable createdBy, outingDate, price
  read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists outingHikers[outing = .id, hiker = viewer]
  insert <- exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  delete <- deny
  cap 5000
  online only

table outingHikers renamed from trekHikers:
  outing: outings renamed from trek
  hiker: principal
  permitPhoto: image <=5000000 write <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  permitValidUntil: time
  addedAt: time default now
  unique outing, hiker
  immutable outing, hiker
  read <- .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  delete <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  cap 20 by outing
  online only

table receipts:
  outing: outings renamed from trek
  hiker: principal
  amount: money USD
  kind: enum('charge', 'refund')
  at: time default now
  unique outing, hiker, kind
  immutable outing, hiker, amount, kind
  read <- .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  insert <- .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  update <- deny
  delete <- deny
  cap 100000
  online only

query myOutings(c: cursor ?):
  return outings after c first 50 by .id
alias myTreks = myOutings

query outingDetail(outing: outings alias trek):
  return outings[outing]
alias trekDetail = outingDetail

query participants(outing: outings alias trek, c: cursor ?):
  return outingHikers where .outing = outing first 50 by .id after c

query myReceipts(c: cursor ?):
  return receipts where .hiker = viewer first 50 by .id after c

query outingReceipts(outing: outings alias trek, c: cursor ?):
  return receipts where .outing = outing first 50 by .id after c
alias trekReceipts = outingReceipts

mutation createOuting(title: text 1..80, outingDate: time alias trekDate, price: money USD, crossesPrivateLand: bool):
  require exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  require outingDate > now else OUTING_IN_PAST
  return insert outings { title, outingDate, price, crossesPrivateLand, createdBy: viewer }
alias createTrek = createOuting

mutation addOutingHiker(outing: outings alias trek, hiker: principal, permitPhoto: image <=5000000, permitValidUntil: time):
  o = outings[outing] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_ALLOWED
  require permitValidUntil >= o.outingDate else PERMIT_INVALID 'The trail permit must be valid on the outing date.'
  require o.status = 'booked' else OUTING_NOT_OPEN
  insert outingHikers { outing, hiker, permitPhoto, permitValidUntil }
  return insert receipts { outing, hiker, amount: o.price, kind: 'charge' }
alias addHiker = addOutingHiker

mutation replaceOutingPhoto(entry: outingHikers, permitPhoto: image <=5000000, permitValidUntil: time):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_ALLOWED
  e = outingHikers[entry] ! else NOT_FOUND
  o = outings[e.outing] ! else NOT_FOUND
  require permitValidUntil >= o.outingDate else PERMIT_INVALID 'The trail permit must be valid on the outing date.'
  update outingHikers[entry] { permitPhoto, permitValidUntil }
  return null

mutation removeOutingHiker(entry: outingHikers):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_ALLOWED
  e = outingHikers[entry] ! else NOT_FOUND
  delete outingHikers[entry]
  return null

mutation advanceOuting(outing: outings alias trek):
  require exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  o = outings[outing] ! else NOT_FOUND
  require o.status = 'booked' or o.status = 'saddled' or o.status = 'on_trail' else NOT_ADVANCEABLE
  update outings[outing] { status: 'saddled' if o.status = 'booked' else 'on_trail' if o.status = 'saddled' else 'back_at_barn' }
  return null
alias advanceStatus = advanceOuting

mutation cancelOuting(outing: outings alias trek):
  require exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  o = outings[outing] ! else NOT_FOUND
  require o.status != 'cancelled' else ALREADY_CANCELLED
  require o.status != 'back_at_barn' else OUTING_COMPLETED
  update outings[outing] { status: 'cancelled' }
  if now < o.outingDate - 10d:
    for h in outingHikers where .outing = outing by .id:
      insert receipts { outing, hiker: h.hiker, amount: o.price, kind: 'refund' }
  return null
alias cancelTrek = cancelOuting

mutation approveOutingRoute(outing: outings alias trek, landownerPermission: text 1..500):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  o = outings[outing] ! else NOT_FOUND
  require o.crossesPrivateLand else NO_PRIVATE_LAND
  update outings[outing] { routeApproved: true, landownerPermission }
  return null
alias approveRoute = approveOutingRoute

-- Spec privacy and authority intent, stated independently from the rules above.
invariant outings.read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists outingHikers[outing = .id, hiker = viewer]
invariant outingHikers.read only .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
invariant receipts.read only .hiker = viewer or exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
invariant outings.insert only exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
invariant outings.update only exists roles[principal = viewer, role = 'handler'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
invariant outingHikers.insert only exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
invariant outingHikers.permitPhoto update only exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
invariant outings.approveOutingRoute only exists roles[principal = viewer, role = 'owner']
invariant outingHikers.addOutingHiker only exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
invariant outingHikers.replaceOutingPhoto only exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
invariant outingHikers.removeOutingHiker only exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
