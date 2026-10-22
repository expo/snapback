use identity password

table roles:
  principal: principal
  role: enum('vendor', 'volunteer', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('vendor', 'volunteer', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }
query myRole():
  return roles[viewer]

fn manager():
  return exists roles[viewer, role = 'manager']
fn staff():
  return exists roles[viewer, role = 'volunteer'] or manager()

table applications:
  owner: principal
  business: text 2..80
  permit: image <=5000000
  validUntil: time
  at: time default now
  immutable owner
  read <- .owner = viewer or exists roles[viewer, role = 'manager']
  insert <- .owner = viewer and exists roles[viewer, role = 'vendor']
  online only
invariant applications.read only .owner = viewer or exists roles[viewer, role = 'manager']

table markets:
  name: text 2..80
  startsAt: time
  endsAt: time
  feeCents: int 100..100000
  immutable startsAt, endsAt, feeCents
  read <- exists roles[viewer]
  insert <- exists roles[viewer, role = 'manager']
  online only

table bookings:
  owner: principal
  application: applications
  market: markets
  feeCents: int 100..100000 ?
  feeState: enum('paid', 'refunded', 'pending') default 'pending'
  refundReason: text 3..300 ?
  refundedBy: principal ?
  refundedAt: time ?
  state: enum('held', 'booked', 'released')
  at: time default now
  unique owner, market else ALREADY_BOOKED
  immutable owner, application, market
  read <- .owner = viewer or exists roles[viewer, role = 'manager']
  insert <- .owner = viewer and exists roles[viewer, role = 'vendor']
  update <- .owner = viewer or exists roles[viewer, role = 'manager']
  online only
invariant bookings.read only .owner = viewer or exists roles[viewer, role = 'manager']

table stalls:
  booking: bookings
  owner: principal
  market: markets
  startsAt: time
  endsAt: time
  vendorName: text 2..80
  stall: int 1..20 ?
  state: enum('held', 'reserved', 'checked-in', 'notified', 'missed', 'released')
  assignmentReason: text 3..300 ?
  assignedBy: principal ?
  unique booking
  unique market, stall else STALL_TAKEN
  immutable booking, owner, market, vendorName, startsAt, endsAt
  read <- .owner = viewer or (exists roles[viewer, role = 'volunteer'] or exists roles[viewer, role = 'manager'])
  insert <- .owner = viewer and exists roles[viewer, role = 'vendor']
  update <- .owner = viewer or (exists roles[viewer, role = 'volunteer'] or exists roles[viewer, role = 'manager'])
  online only
invariant stalls.read only .owner = viewer or (exists roles[viewer, role = 'volunteer'] or exists roles[viewer, role = 'manager'])

table decisions:
  booking: bookings
  action: enum('corner', 'refund')
  actor: principal
  reason: text 3..300
  at: time default now
  immutable booking, action, actor, reason, at
  read <- exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'manager'] and .actor = viewer
  online only

query applicationsMine(c: cursor ?):
  require exists roles[viewer, role = 'vendor'] else NOT_VENDOR
  return applications where .owner = viewer last 50 by .at after c
query applicationDetail(application: applications):
  return applications[application]
query bookingsMine(c: cursor ?):
  require exists roles[viewer, role = 'vendor'] else NOT_VENDOR
  return bookings where .owner = viewer last 50 by .at after c { *, place: stalls[booking = .id] }
query bookingDetail(booking: bookings):
  return bookings[booking]
query marketsList(c: cursor ?):
  return markets last 50 by .startsAt after c
query stallMap(market: markets, c: cursor ?):
  require staff() else NOT_STAFF
  return stalls where .market = market first 100 by .id after c
query managerBookings(c: cursor ?):
  require manager() else NOT_MANAGER
  return bookings last 100 by .at after c { *, place: stalls[booking = .id], business: applications[.application].business, decisions: decisions[booking = .id] last 50 by .at }

mutation apply(business: text 2..80, permit: image <=5000000, validUntil: time):
  require exists roles[viewer, role = 'vendor'] else NOT_VENDOR
  require len(trim(business)) >= 2 else BAD_BUSINESS
  require validUntil > now else PERMIT_EXPIRED
  return insert applications { owner: viewer, business, permit, validUntil }
mutation createMarket(name: text 2..80, startsAt: time, endsAt: time, feeCents: int 100..100000):
  require manager() else NOT_MANAGER
  require len(trim(name)) >= 2 else BAD_NAME
  require startsAt > now and startsAt < now + 365d else BAD_START
  require endsAt > startsAt and endsAt <= startsAt + 12h else BAD_END
  return insert markets { name, startsAt, endsAt, feeCents }
mutation book(application: applications, market: markets, stall: int 2..19, feeCents: int 100..100000 ?):
  require exists roles[viewer, role = 'vendor'] else NOT_VENDOR
  a = applications[application] ! else NOT_FOUND
  require a.owner = viewer else NOT_OWNER
  m = markets[market] ! else NOT_FOUND
  require m.startsAt > now else BOOKING_CLOSED
  misses = count(stalls where .owner = viewer and (.state = 'missed' or (.state = 'reserved' and .endsAt <= now)))
  require misses < 2 else STALL_LOST
  held = a.validUntil < m.startsAt + 30d
  b = insert bookings { owner: viewer, application, market, feeCents, feeState: 'pending' if feeCents = null else 'paid', state: 'held' if held else 'booked' }
  insert stalls { booking: b.id, owner: viewer, market, vendorName: a.business, startsAt: m.startsAt, endsAt: m.endsAt, stall: null if held else stall, state: 'held' if held else 'reserved' }
  return b
mutation setBookingFee(booking: bookings, feeCents: int 100..100000):
  require manager() else NOT_MANAGER
  b = bookings[booking] ! else NOT_FOUND
  require b.feeState != 'refunded' else ALREADY_REFUNDED
  update bookings[booking] { feeCents, feeState: 'paid' }
mutation giveNotice(booking: bookings):
  b = bookings[booking] ! else NOT_FOUND
  require b.owner = viewer else NOT_OWNER
  m = markets[b.market] ! else NOT_FOUND
  require m.startsAt > now else NOTICE_CLOSED
  require b.state != 'released' else ALREADY_RELEASED
  update bookings[booking] { state: 'released' }
  update stalls[booking = booking] { state: 'notified', stall: null }
mutation assignCorner(booking: bookings, stall: int 1..20, reason: text 3..300):
  require manager() else NOT_MANAGER
  require len(trim(reason)) >= 3 else REASON_REQUIRED
  require stall = 1 or stall = 20 else NOT_CORNER
  b = bookings[booking] ! else NOT_FOUND
  require b.state = 'booked' else NOT_BOOKED
  m = markets[b.market] ! else NOT_FOUND
  require m.endsAt > now else MARKET_ENDED
  insert decisions { booking, action: 'corner', actor: viewer, reason }
  update stalls[booking = booking] { stall, assignmentReason: reason, assignedBy: viewer }
mutation refund(booking: bookings, reason: text 3..300):
  require manager() else NOT_MANAGER
  b = bookings[booking] ! else NOT_FOUND
  require len(trim(reason)) >= 3 else REASON_REQUIRED
  require b.feeCents != null else FEE_UNCONFIRMED
  require b.feeState = 'paid' else ALREADY_REFUNDED
  insert decisions { booking, action: 'refund', actor: viewer, reason }
  update bookings[booking] { feeState: 'refunded', refundReason: reason, refundedBy: viewer, refundedAt: now }
mutation checkIn(place: stalls):
  require staff() else NOT_STAFF
  s = stalls[place] ! else NOT_FOUND
  require s.startsAt <= now and s.endsAt > now else CHECKIN_CLOSED
  require s.state = 'reserved' else NOT_RESERVED
  misses = count(stalls where .owner = s.owner and (.state = 'missed' or (.state = 'reserved' and .endsAt <= now)))
  require misses < 2 else STALL_LOST
  update stalls[place] { state: 'checked-in' }

job settleAttendance():
  for s in stalls:
    if s.state = 'reserved' and s.endsAt <= now:
      update stalls[s.id] { state: 'missed', stall: null }
  for s in stalls:
    if s.state = 'reserved' or s.state = 'held':
      misses = count(stalls where .owner = s.owner and .state = 'missed')
      if misses >= 2:
        update stalls[s.id] { state: 'released', stall: null }
        update bookings[s.booking] { state: 'released' }
schedule attendance every 1m: settleAttendance
