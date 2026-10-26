-- Canyoneering Guided Trips.
-- Roles: guest, guide, lead (lead guide), office (booking office).
-- Password accounts; roles are provisioned by the local operator (service:operator).
use identity password

table roles:
  principal: principal
  role: enum('guest', 'guide', 'lead', 'office')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- Spec privacy intent, stated independently from the rules below.
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'

mutation provision(principal: principal, role: enum('guest', 'guide', 'lead', 'office')):
  require viewer = 'service:operator' else NOT_OPERATOR
  r = upsert roles[principal] { principal, role }
  upsert directory[principal] { principal, role }
  return r

-- Staff address book: the office needs guest principals to log bookings.
table directory:
  principal: principal
  role: enum('guest', 'guide', 'lead', 'office')
  unique principal
  immutable principal
  read <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'lead']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

invariant directory.read only exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'lead']

query roster(c: cursor ?):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'lead'] else NOT_STAFF
  return directory last 100 by .id after c

query myRole():
  return roles[viewer]

table canyons:
  name: text 3..80
  difficulty: enum('beginner', 'intermediate', 'advanced')
  unique name else CANYON_TAKEN 'A canyon with this name already exists.'
  immutable name
  public 'The canyon catalog is public.'
  insert <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'lead']
  update <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'lead']
  delete <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'lead']
  online only

invariant canyons.insert only exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'lead']

query canyonList(c: cursor ?):
  return canyons first 100 by .id after c

mutation addCanyon(name: text 3..80, difficulty: enum('beginner', 'intermediate', 'advanced')):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'lead'] else NOT_OFFICE
  return insert canyons { name, difficulty }

table trips:
  canyon: canyons
  startsAt: time
  price: money USD
  status: enum('confirmed', 'geared_up', 'in_canyon', 'out', 'cancelled', 'rebooked', 'refunded') default 'confirmed'
  cancelledAt: time ?
  cancelReason: text 3..300 ?
  createdBy: principal
  immutable canyon, createdBy
  cap 500
  read <- exists bookings[trip = .id, guest = viewer] or exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office']
  insert <- exists roles[principal = viewer, role = 'office']
  update <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead']
  delete <- exists roles[principal = viewer, role = 'office']
  online only

-- Spec: a guest sees only trips they are booked on; the board is staff-only.
invariant trips.read only exists bookings[trip = .id, guest = viewer] or exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office']
invariant trips.insert only exists roles[principal = viewer, role = 'office']

query tripBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office'] else NOT_STAFF
  return trips last 50 by .startsAt after c { id, canyon: canyons[.canyon], startsAt, price, status, cancelledAt, cancelReason }

query myBookings(c: cursor ?):
  return bookings where .guest = viewer last 50 by .id after c { id, hasExperience, approved, approvalReason, safetyPlan, trip: trips[.trip] }

query tripDetail(trip: trips):
  return trips[trip]

query tripBookings(trip: trips, c: cursor ?):
  if exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office']:
    return bookings where .trip = trip last 100 by .id after c
  return bookings where .trip = trip and .guest = viewer last 100 by .id after c

query myWaivers(c: cursor ?):
  return waivers where .guest = viewer last 50 by .id after c { id, signedAt, booking: bookings[.booking] }

query tripWaivers(trip: trips, c: cursor ?):
  require exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office'] else NOT_STAFF
  return waivers where .trip = trip last 100 by .id after c

mutation createTrip(canyon: canyons, startsAt: time, price: money USD):
  require exists roles[principal = viewer, role = 'office'] else NOT_OFFICE
  c = canyons[canyon] ! else NOT_FOUND
  require startsAt > now else IN_THE_PAST 'Trips start in the future.'
  require price >= 0 else BAD_PRICE 'Trip price must not be negative.'
  return insert trips { canyon, startsAt, price, createdBy: viewer }

mutation gearUp(trip: trips):
  require exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] else NOT_GUIDE
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'confirmed' or t.status = 'rebooked' else BAD_STATUS 'Only a confirmed trip can gear up.'
  for b in bookings where .trip = trip:
    w = waivers[b.id] ! else WAIVER_MISSING 'Every guest needs a signed waiver before gearing up.'
    require w.signedAt + 365d >= t.startsAt else WAIVER_STALE 'A waiver older than one year must be signed again before the trip.'
    if not b.hasExperience:
      c = canyons[t.canyon] ! else NOT_FOUND
      require c.difficulty != 'advanced' or b.approved else NOT_APPROVED 'A guest without rappelling experience needs lead approval for an advanced canyon.'
  update trips[trip] { status: 'geared_up' }
  return null

mutation enterCanyon(trip: trips):
  require exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] else NOT_GUIDE
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'geared_up' else BAD_STATUS 'Only a geared-up trip can enter the canyon.'
  for b in bookings where .trip = trip:
    w = waivers[b.id] ! else WAIVER_MISSING 'Every guest needs a signed waiver before entering the canyon.'
    require w.signedAt + 365d >= t.startsAt else WAIVER_STALE 'A waiver older than one year must be signed again before the trip.'
    if not b.hasExperience:
      c = canyons[t.canyon] ! else NOT_FOUND
      require c.difficulty != 'advanced' or b.approved else NOT_APPROVED 'A guest without rappelling experience needs lead approval for an advanced canyon.'
  update trips[trip] { status: 'in_canyon' }
  return null

mutation exitCanyon(trip: trips):
  require exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] else NOT_GUIDE
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'in_canyon' else BAD_STATUS 'Only a trip in the canyon can exit.'
  update trips[trip] { status: 'out' }
  return null

mutation cancelTrip(trip: trips, reason: text 3..300):
  require exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office'] else NOT_STAFF
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'confirmed' or t.status = 'geared_up' or t.status = 'rebooked' else BAD_STATUS 'Only an upcoming trip can be cancelled.'
  update trips[trip] { status: 'cancelled', cancelledAt: now, cancelReason: reason }
  return null

mutation rebookTrip(trip: trips, startsAt: time):
  require exists roles[principal = viewer, role = 'office'] else NOT_OFFICE
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'cancelled' else BAD_STATUS 'Only a cancelled trip can be rebooked.'
  require t.cancelledAt != null and t.cancelledAt >= now - 365d else REBOOK_EXPIRED 'A cancelled trip may be rebooked within 12 months.'
  require startsAt > now else IN_THE_PAST 'Rebooked trips start in the future.'
  update trips[trip] { status: 'rebooked', startsAt }
  return null

mutation refundTrip(trip: trips):
  require exists roles[principal = viewer, role = 'office'] else NOT_OFFICE
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'cancelled' else BAD_STATUS 'Only a cancelled trip can be refunded.'
  update trips[trip] { status: 'refunded' }
  return null

table bookings:
  trip: trips on delete restrict
  guest: principal
  hasExperience: bool
  approved: bool default false
  approvalReason: text 3..300 ?
  safetyPlan: text 3..500 ?
  immutable trip, guest
  unique trip, guest else ALREADY_BOOKED 'This guest is already booked on this trip.'
  cap 50 by trip
  read <- .guest = viewer or exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office']
  insert <- exists roles[principal = viewer, role = 'office']
  update <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'lead']
  delete <- exists roles[principal = viewer, role = 'office']
  online only

-- Spec: a guest sees only their own bookings; approval is a lead-only write.
invariant bookings.read only .guest = viewer or exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office']
invariant bookings.approved update only exists roles[principal = viewer, role = 'lead']
invariant bookings.insert only exists roles[principal = viewer, role = 'office']

mutation addBooking(trip: trips, guest: principal, hasExperience: bool):
  require exists roles[principal = viewer, role = 'office'] else NOT_OFFICE
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'confirmed' else BAD_STATUS 'Guests can be added while the trip is confirmed.'
  require exists directory[guest] else UNKNOWN_GUEST 'The guest needs an account first.'
  return insert bookings { trip, guest, hasExperience }

mutation approveBooking(booking: bookings, reason: text 3..300, safetyPlan: text 3..500):
  require exists roles[principal = viewer, role = 'lead'] else NOT_LEAD
  b = bookings[booking] ! else NOT_FOUND
  t = trips[b.trip] ! else NOT_FOUND
  c = canyons[t.canyon] ! else NOT_FOUND
  require not b.hasExperience else NOT_NEEDED 'Approval is for guests without rappelling experience.'
  require c.difficulty = 'advanced' else NOT_NEEDED 'Approval is for advanced canyons.'
  update bookings[booking] { approved: true, approvalReason: reason, safetyPlan }
  return null

table waivers:
  booking: bookings on delete restrict
  trip: trips on delete restrict
  guest: principal
  signedAt: time default now
  scan: image <=5000000
  unique booking else ALREADY_SIGNED 'This booking already has a waiver; signing again replaces it.'
  immutable booking, trip, guest
  cap 50 by trip
  read <- .guest = viewer or exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office']
  insert <- .guest = viewer or exists roles[principal = viewer, role = 'office']
  update <- .guest = viewer or exists roles[principal = viewer, role = 'office']
  online only

-- Spec: a guest sees only their own waivers.
invariant waivers.read only .guest = viewer or exists roles[principal = viewer, role = 'guide'] or exists roles[principal = viewer, role = 'lead'] or exists roles[principal = viewer, role = 'office']

mutation signWaiver(booking: bookings, scan: image <=5000000):
  b = bookings[booking] ! else NOT_FOUND
  require b.guest = viewer or exists roles[principal = viewer, role = 'office'] else NOT_SIGNER
  return upsert waivers[booking] { booking, trip: b.trip, guest: b.guest, signedAt: now, scan }
