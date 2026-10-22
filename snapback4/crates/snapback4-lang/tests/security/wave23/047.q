-- Wedding Flower Orders.
-- Roles: owner (shop owner), sales (sales consultant), designer (floral
-- designer), couple. Two users per role minimum; provisioned by the local
-- operator (service:operator), never self-claimed.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'sales', 'designer', 'couple')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'sales']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'sales', 'designer', 'couple')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query couples(c: cursor ?):
  require exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  return roles where .role = 'couple' first 100 by .principal after c

table orders:
  couple: principal
  title: text 1..80
  eventDate: time
  venue: text 1..200
  venueNotes: text <=1000
  colors: text 1..200
  flowers: text 1..1000
  photos: [image <=5000000] 0..4
  budget: int 0.. read <- exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
  quotedPrice: int 0.. read <- exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
  deposit: int 0.. read <- exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
  surcharge: int 0.. default 0 read <- exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
  guestCount: int 1..5000
  status: enum('ordered', 'conditioning', 'designing', 'delivered') default 'ordered'
  refund: enum('none', 'requested', 'approved', 'rejected') default 'none'
  immutable couple
  cap 200 by couple
  read <- .couple = viewer or exists roles[principal = viewer, role = 'designer'] or exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
  update <- .couple = viewer or exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'designer']
  online only

table payments:
  order: orders
  amount: int 1..
  method: text 1..40
  at: time default now
  immutable order, amount, method, at
  cap 200 by order
  read <- exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
  online only

-- A sales consultant or the owner opens an order for a couple. The quoted
-- price with deposit is required, so an order cannot exist without it.
-- Inspiration photos are optional (v2): while the couple is still deciding,
-- sales may save the order with zero photos; it reads as "inspiration photos
-- needed" until photos are supplied. Every pre-v2 order keeps its photos.
mutation createOrder(couple: principal, title: text 1..80, eventDate: time, venue: text 1..200, venueNotes: text <=1000, colors: text 1..200, flowers: text 1..1000, photos: [image <=5000000] 0..4, budget: int 0.., quotedPrice: int 0.., deposit: int 0.., guestCount: int 1..5000):
  require exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  require exists roles[principal = couple, role = 'couple'] else NOT_A_COUPLE
  require eventDate > now else BAD_DATE
  require deposit <= quotedPrice else BAD_DEPOSIT
  return insert orders { couple, title, eventDate, venue, venueNotes, colors, flowers, photos, budget, quotedPrice, deposit, guestCount }

-- Only sales consultants and the shop owner may change inspiration photos
-- (v2). Couples and floral designers view photos as before but cannot add,
-- replace or remove them: this operation no longer admits them.
mutation updateDesign(order: orders, venueNotes: text <=1000, colors: text 1..200, flowers: text 1..1000, photos: [image <=5000000] 0..4):
  require exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  o = orders[order] ! else NOT_FOUND
  update orders[o.id] { venueNotes, colors, flowers, photos }
  return null

-- Designers (and other staff) evolve the creative side without touching
-- photos or money. Same design fields as updateDesign, minus photos.
mutation updateDesignDetails(order: orders, venueNotes: text <=1000, colors: text 1..200, flowers: text 1..1000):
  require exists roles[principal = viewer, role = 'designer'] or exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  o = orders[order] ! else NOT_FOUND
  update orders[o.id] { venueNotes, colors, flowers }
  return null

-- Photo-only change path for the v2 "inspiration photos needed" flow: sales
-- or the owner supplies photos later without re-entering the design text.
mutation updatePhotos(order: orders, photos: [image <=5000000] 0..4):
  require exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  o = orders[order] ! else NOT_FOUND
  update orders[o.id] { photos }
  return null

-- Only sales and the owner touch money.
mutation updatePricing(order: orders, budget: int 0.., quotedPrice: int 0.., deposit: int 0..):
  require exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  require deposit <= quotedPrice else BAD_DEPOSIT
  o = orders[order] ! else NOT_FOUND
  update orders[o.id] { budget, quotedPrice, deposit }
  return null

-- The studio board moves forward one step at a time; staff only.
mutation setStatus(order: orders, status: enum('ordered', 'conditioning', 'designing', 'delivered')):
  require exists roles[principal = viewer, role = 'designer'] or exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  o = orders[order] ! else NOT_FOUND
  ok = status = 'conditioning' and o.status = 'ordered' or status = 'designing' and o.status = 'conditioning' or status = 'delivered' and o.status = 'designing'
  require ok else BAD_TRANSITION
  update orders[o.id] { status }
  return null

-- The final guest count is due 14 days before the event. Later changes are
-- allowed but add a $50 late-change surcharge, which must be acknowledged.
mutation updateGuestCount(order: orders, guestCount: int 1..5000, acceptSurcharge: bool):
  require exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'designer'] or exists roles[principal = viewer, role = 'couple'] else NO_ROLE
  o = orders[order] ! else NOT_FOUND
  require o.couple = viewer or exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_YOUR_ORDER
  late = now > o.eventDate - 14d
  require not late or acceptSurcharge else LATE_FEE_REQUIRED
  update orders[o.id] { guestCount, surcharge: (o.surcharge ?? 0) + (5000 if late else 0) }
  return null

mutation requestRefund(order: orders):
  o = orders[order] ! else NOT_FOUND
  require o.couple = viewer or exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_YOUR_ORDER
  require o.refund = 'none' else BAD_STATE
  update orders[o.id] { refund: 'requested' }
  return null

-- Only the shop owner approves (or rejects) a refund.
mutation decideRefund(order: orders, approve: bool):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  o = orders[order] ! else NOT_FOUND
  require o.refund = 'requested' else BAD_STATE
  update orders[o.id] { refund: 'approved' if approve else 'rejected' }
  return null

mutation recordPayment(order: orders, amount: int 1.., method: text 1..40):
  require exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  o = orders[order] ! else NOT_FOUND
  return insert payments { order: o.id, amount, method }

query myOrders(c: cursor ?):
  return orders where .couple = viewer first 50 by .id after c

query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'designer'] or exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  return orders first 50 by .id after c

query orderDetail(order: orders):
  return orders[order]

query paymentHistory(order: orders, c: cursor ?):
  require exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  return payments where .order = order first 50 by .id after c

query guestDeadline(order: orders):
  o = orders[order] ! else NOT_FOUND
  return { dueAt: o.eventDate - 14d, eventDate: o.eventDate, guestCount: o.guestCount }

-- Privacy intent, stated separately from enforcement (guide security).
-- Designers share the row audience but must never see money; only sales and
-- the owner see the couple's budget, quoted price, deposit, surcharge and
-- payment history. Couples see only their own orders.
invariant orders.read only .couple = viewer or exists roles[principal = viewer, role = 'designer'] or exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
invariant orders.budget read only exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
invariant orders.quotedPrice read only exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
invariant orders.deposit read only exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
invariant orders.surcharge read only exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
invariant orders.insert only exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
invariant payments.read only exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
invariant payments.insert only exists roles[principal = viewer, role = 'sales'] or exists roles[principal = viewer, role = 'owner']
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'sales']
