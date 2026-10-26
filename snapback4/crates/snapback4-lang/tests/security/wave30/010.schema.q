-- Whitewater Rafting Trips.
-- Roles: guest (default), guide, head_guide, office. The booking office logs
-- each trip with a scan of every guest's signed waiver and the trip price.
-- A trip cancelled for high water may be rebooked within 12 months or
-- refunded. A waiver older than one year (relative to the trip date) must be
-- signed again before the trip. Guests see only their own bookings and
-- waivers; guides see the live river board confirmed -> fitted -> on_river ->
-- off_water; only the head guide approves a non-swimmer on a class 4 rapid,
-- recording the reason and the extra safety plan.
use identity password

table roles:
  principal: principal
  role: enum('guest', 'guide', 'head_guide', 'office')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

table trips:
  title: text 3..120
  section: text 3..120
  rapidClass: int 1..5
  tripDate: time
  price: money USD
  status: enum('confirmed', 'fitted', 'on_river', 'off_water', 'cancelled_high_water', 'refunded') default 'confirmed'
  cancelledAt: time ?
  createdBy: principal
  rebookedFrom: trips ?
  immutable createdBy
  read <- exists bookings[trip = .id, guest = viewer] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide']
  insert <- exists roles[viewer, role = 'office']
  update <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide']
  cap 500
  online only

table waivers:
  guest: principal
  signedAt: time default now
  scan: image <=5000000
  immutable guest
  read <- .guest = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide']
  insert <- .guest = viewer or exists roles[viewer, role = 'office']
  cap 20 by guest
  online only

table bookings:
  trip: trips
  guest: principal
  canSwim: bool default true
  approved: bool default false
  approvalReason: text 0..500 ?
  safetyPlan: text 0..1000 ?
  waiver: waivers
  bookedAt: time default now
  unique trip, guest else ALREADY_BOOKED 'This guest is already on this trip.'
  cap 12 by trip
  immutable trip, guest, waiver
  read <- .guest = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide']
  insert <- exists roles[viewer, role = 'office']
  update <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'head_guide']
  online only

-- Non-swimmers still waiting for head-guide approval, per trip.
view pendingSwim: count bookings where .canSwim = false and .approved = false by .trip
  read <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide']
  online only

mutation provision(principal: principal, role: enum('guest', 'guide', 'head_guide', 'office')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query myWaivers(c: cursor ?):
  return waivers where .guest = viewer last 20 by .id after c

query myBookings(c: cursor ?):
  return bookings where .guest = viewer last 20 by .bookedAt after c { id, canSwim, approved, approvalReason, safetyPlan, bookedAt, trip: trips[.trip] }

query riverBoard(c: cursor ?):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide'] else NOT_STAFF
  return trips last 50 by .tripDate after c

query tripBookings(trip: trips, c: cursor ?):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide'] else NOT_STAFF
  return bookings where .trip = trip last 50 by .id after c

query waiversForGuest(guest: principal, c: cursor ?):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide'] else NOT_STAFF
  return waivers where .guest = guest last 20 by .id after c

query tripDetail(trip: trips):
  return trips[trip]

query roster(c: cursor ?):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'head_guide'] else NOT_STAFF
  return roles last 50 by .principal after c

mutation logTrip(title: text 3..120, section: text 3..120, rapidClass: int 1..5, tripDate: time, price: money USD):
  require exists roles[viewer, role = 'office'] else NOT_OFFICE
  require tripDate > now else TRIP_NOT_FUTURE 'The trip date must be in the future.'
  return insert trips { title, section, rapidClass, tripDate, price, createdBy: viewer }

mutation addGuest(trip: trips, guest: principal, canSwim: bool, waiver: waivers):
  require exists roles[viewer, role = 'office'] else NOT_OFFICE
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'confirmed' else TRIP_NOT_OPEN 'Guests can only be added while the trip is confirmed.'
  require not exists bookings[trip, guest] else ALREADY_BOOKED 'This guest is already on this trip.'
  w = waivers[waiver] ! else NOT_FOUND
  require w.guest = guest else WAIVER_MISMATCH 'That waiver belongs to a different guest.'
  require w.signedAt > t.tripDate - 365d else WAIVER_EXPIRED 'That waiver is older than one year relative to the trip date; sign again.'
  return insert bookings { trip, guest, canSwim, waiver }

mutation signWaiver(scan: image <=5000000):
  return insert waivers { guest: viewer, scan }

mutation logWaiver(guest: principal, scan: image <=5000000):
  require exists roles[viewer, role = 'office'] else NOT_OFFICE
  return insert waivers { guest, scan }

mutation advanceTrip(trip: trips):
  require exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide'] else NOT_GUIDE
  t = trips[trip] ! else NOT_FOUND
  if t.status = 'confirmed':
    update trips[trip] { status: 'fitted' }
    return null
  elif t.status = 'fitted':
    if t.rapidClass = 4:
      require (pendingSwim[trip] ?? 0) = 0 else SWIM_APPROVAL_PENDING 'A non-swimmer on this class 4 rapid still needs head guide approval.'
    update trips[trip] { status: 'on_river' }
    return null
  elif t.status = 'on_river':
    update trips[trip] { status: 'off_water' }
    return null
  else:
    require false else TRIP_NOT_LIVE 'Only confirmed, fitted or on-river trips advance.'

mutation approveNonSwimmer(booking: bookings, reason: text 10..500, safetyPlan: text 10..1000):
  require exists roles[viewer, role = 'head_guide'] else NOT_HEAD_GUIDE
  b = bookings[booking] ! else NOT_FOUND
  t = trips[b.trip] ! else NOT_FOUND
  require t.rapidClass = 4 else NOT_CLASS_FOUR 'Head approval is only for class 4 rapids.'
  require b.canSwim = false else SWIMMER_NEEDS_NO_APPROVAL 'Only a guest who cannot swim needs approval.'
  update bookings[booking] { approved: true, approvalReason: reason, safetyPlan }
  return null

mutation cancelHighWater(trip: trips):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'head_guide'] else NOT_OFFICE_OR_HEAD
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'confirmed' or t.status = 'fitted' or t.status = 'on_river' else TRIP_NOT_LIVE 'Only a live trip can be cancelled for high water.'
  update trips[trip] { status: 'cancelled_high_water', cancelledAt: now }
  return null

mutation rebookTrip(trip: trips, tripDate: time):
  require exists roles[viewer, role = 'office'] else NOT_OFFICE
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'cancelled_high_water' else NOT_CANCELLED 'Only a trip cancelled for high water can be rebooked.'
  require t.cancelledAt != null and now <= t.cancelledAt + 365d else REBOOK_WINDOW_CLOSED 'Rebooking is only possible within 12 months of cancellation.'
  require tripDate > now else TRIP_NOT_FUTURE 'The trip date must be in the future.'
  return insert trips { title: t.title, section: t.section, rapidClass: t.rapidClass, tripDate, price: t.price, createdBy: viewer, rebookedFrom: trip }

mutation refundTrip(trip: trips):
  require exists roles[viewer, role = 'office'] else NOT_OFFICE
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'cancelled_high_water' else NOT_CANCELLED 'Only a trip cancelled for high water can be refunded.'
  update trips[trip] { status: 'refunded' }
  return null

-- Spec intent, stated separately from the enforcing rules above.
invariant waivers.read only .guest = viewer or exists roles[viewer]
invariant bookings.read only .guest = viewer or exists roles[viewer]
invariant trips.read only exists bookings[trip = .id, guest = viewer] or exists roles[viewer]
invariant bookings.insert only exists roles[viewer, role = 'office']
invariant bookings.approved write only exists roles[viewer, role = 'head_guide']
invariant trips.status write only exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'head_guide']
