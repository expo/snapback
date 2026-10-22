-- Moving Crew Inventories.
--
-- Roles: owner, office, estimator, mover, customer (at least two users each).
-- A moving company packs and moves households. The estimator logs each move
-- with photos of every room and the quoted price. Movers see each move's room
-- photos, item list, fragile notes and stair/elevator access, but never the
-- quoted price, deposit or valuation coverage, which only the office and the
-- owner see (movePricing is a separate table readable only by office/owner).
-- Customers see only their own moves and inventory. The dispatch board is an
-- ordinary live query over moves as they go booked -> packing -> loaded ->
-- delivered. A damage claim must be filed within 30 days of delivery, and
-- only the owner can approve paying a damage claim.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'office', 'estimator', 'mover', 'customer')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'mover']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'office', 'estimator', 'mover', 'customer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query customerRoster(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] else NOT_STAFF
  return roles where .role = 'customer' first 100 by .principal after c

table moves:
  customer: principal
  label: text 1..120
  addressFrom: text 1..200
  addressTo: text 1..200
  access: text 1..500
  status: enum('booked', 'packing', 'loaded', 'delivered') default 'booked'
  deliveredAt: time ?
  createdAt: time default now
  immutable customer, createdAt
  cap 500 by customer
  read <- .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'mover']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'mover']
  online only

-- The money side of a move. Only the office and the owner may read it; the
-- estimator records it blind at creation (insert needs no read authority).
table movePricing:
  move: moves
  quotedPrice: money USD
  deposit: money USD ?
  valuation: text 1..200 ?
  immutable move
  unique move
  read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  online only

-- Photos of every room. Same audience as the move itself.
table roomPhotos:
  move: moves
  room: text 1..80
  photo: image <=10000000
  note: text <=500 ?
  immutable move
  cap 100 by move
  read <- exists moves[.move, customer = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'mover']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  online only

-- The item list with fragile notes. Same audience as the move itself.
table moveItems:
  move: moves
  description: text 1..200
  fragile: bool default false
  note: text <=500 ?
  immutable move
  cap 500 by move
  read <- exists moves[.move, customer = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'mover']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  delete <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
  online only

-- Damage claims. Filed by the move's customer within 30 days of delivery;
-- decided only by the owner.
table claims:
  move: moves
  customer: principal
  description: text 1..1000
  amount: money USD
  status: enum('filed', 'approved', 'paid', 'rejected') default 'filed'
  filedAt: time default now
  decidedAt: time ?
  immutable move, customer, filedAt
  cap 20 by move
  read <- .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office']
  insert <- .customer = viewer
  update <- exists roles[principal = viewer, role = 'owner']
  online only

mutation createMove(customer: principal, label: text 1..120, addressFrom: text 1..200, addressTo: text 1..200, access: text 1..500, quotedPrice: money USD, deposit: money USD ?, valuation: text 1..200 ?):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  require exists roles[principal = customer, role = 'customer'] else NOT_CUSTOMER_ACCOUNT
  mv = insert moves { customer, label, addressFrom, addressTo, access }
  insert movePricing { move: mv, quotedPrice, deposit, valuation }
  return mv

mutation setPricing(move: moves, quotedPrice: money USD, deposit: money USD ?, valuation: text 1..200 ?):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRICING
  m = moves[move] ! else NOT_FOUND
  return upsert movePricing[move] { move, quotedPrice, deposit, valuation }

mutation addPhoto(move: moves, room: text 1..80, photo: image <=10000000, note: text <=500 ?):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  m = moves[move] ! else NOT_FOUND
  return insert roomPhotos { move, room, photo, note }

mutation addItem(move: moves, description: text 1..200, fragile: bool ?, note: text <=500 ?):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  m = moves[move] ! else NOT_FOUND
  return insert moveItems { move, description, fragile: fragile ?? false, note }

mutation advanceMove(move: moves, to: enum('packing', 'loaded', 'delivered')):
  require exists roles[principal = viewer, role = 'mover'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  m = moves[move] ! else NOT_FOUND
  require m.status != 'delivered' else ALREADY_DELIVERED
  if m.status = 'booked':
    require to = 'packing' else BAD_TRANSITION
  else if m.status = 'packing':
    require to = 'loaded' else BAD_TRANSITION
  else:
    require to = 'delivered' else BAD_TRANSITION
  if to = 'delivered':
    update moves[move] { status: to, deliveredAt: now }
  else:
    update moves[move] { status: to }
  return null

mutation fileClaim(move: moves, description: text 1..1000, amount: money USD):
  require exists roles[principal = viewer, role = 'customer'] else NOT_CUSTOMER
  m = moves[move] ! else NOT_FOUND
  require m.customer = viewer else NOT_YOUR_MOVE
  require m.status = 'delivered' else NOT_DELIVERED
  delivered = m.deliveredAt ?? 0
  require delivered != 0 else NOT_DELIVERED
  require now <= delivered + 30d else CLAIM_WINDOW_CLOSED
  return insert claims { move, customer: viewer, description, amount }

mutation decideClaim(claim: claims, decision: enum('approved', 'paid', 'rejected')):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  c = claims[claim] ! else NOT_FOUND
  require c.status = 'filed' else ALREADY_DECIDED
  update claims[claim] { status: decision, decidedAt: now }
  return null

query myMoves(c: cursor ?):
  return moves where .customer = viewer first 50 by .id after c

query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'mover'] else NOT_CREW
  return moves first 50 by .id after c

query moveDetail(move: moves):
  return moves[move]

query movePhotos(move: moves, c: cursor ?):
  return roomPhotos where .move = move first 50 by .id after c

query moveItems(move: moves, c: cursor ?):
  return moveItems where .move = move first 50 by .id after c

query movePricingFor(move: moves):
  return movePricing[move]

query myClaims(c: cursor ?):
  return claims where .customer = viewer first 50 by .id after c

query moveClaims(move: moves, c: cursor ?):
  return claims where .move = move first 50 by .id after c

-- Spec intent, stated independently from the rules above.
invariant moves.read only .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'mover']
invariant moves.insert only exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'owner']
invariant movePricing.read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office']
invariant claims.read only .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office']
invariant claims.update only exists roles[principal = viewer, role = 'owner']
invariant claims.decideClaim only exists roles[principal = viewer, role = 'owner']
invariant roomPhotos.read only exists moves[.move, customer = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'mover']
invariant moveItems.read only exists moves[.move, customer = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'mover']
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'mover']
invariant roles.insert only viewer = 'service:operator'
