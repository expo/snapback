use identity password

table roles:
  principal: principal
  role: enum('owner', 'clerk', 'guide', 'angler')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'clerk', 'guide', 'angler'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query myRole():
  return roles[viewer]

query anglers():
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  return roles where .role = 'angler' first 100 by .id { principal, name }

table trips:
  title: text 1..100
  river: enum('willow', 'north_fork', 'cedar_private')
  kind: enum('wade', 'drift')
  startsAt: time
  status: enum('booked', 'rigged', 'on_water', 'returned', 'cancelled') default 'booked'
  permission: text 10..1000 ?
  approvedBy: principal ?
  approvedAt: time ?
  createdBy: principal
  immutable title, river, kind, startsAt, createdBy
  read <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'guide'] or exists participants[.id, viewer]
  insert <- exists roles[viewer, role = 'clerk'] and .createdBy = viewer and .status = 'booked'
  update <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'guide'] or exists participants[.id, viewer]
  online only

table participants:
  trip: trips
  principal: principal
  name: text 1..80
  licenseNumber: text 3..40
  validFrom: time
  validThrough: time
  photo: image <=5000000
  loggedBy: principal
  unique trip, principal else ALREADY_ADDED
  cap 6 by trip
  immutable trip, principal, name, licenseNumber, validFrom, validThrough, photo, loggedBy
  read <- .principal = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'clerk'] and .loggedBy = viewer
  online only

table receipts:
  trip: trips
  price: int 1..500000
  refund: int 0..500000 default 0
  unique trip
  immutable trip, price
  read <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner'] or exists participants[.trip, viewer]
  insert <- exists roles[viewer, role = 'clerk']
  update <- exists roles[viewer, role = 'clerk'] or exists participants[.trip, viewer]
  online only

view headcount: count participants by .trip
  read <- exists roles[viewer, role = 'guide']

query board(c: cursor ?):
  require exists roles[viewer, role = 'guide'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return trips last 100 by .id after c

query myTrips(c: cursor ?):
  require exists roles[viewer, role = 'angler'] else NOT_ANGLER
  return participants where .principal = viewer last 100 by .id after c { id, trip: trips[.trip], name, licenseNumber, validFrom, validThrough, photo }

query tripDetail(trip: trips):
  return trips[trip]

query tripAnglers(trip: trips):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner'] else NOT_DESK
  t = trips[trip] ! else NOT_FOUND
  return participants where .trip = trip first 6 by .id

query receipt(trip: trips):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner'] or exists participants[trip, viewer] else PRIVATE_RECEIPT
  t = trips[trip] ! else NOT_FOUND
  return receipts[trip]

mutation bookTrip(title: text 1..100, river: enum('willow', 'north_fork', 'cedar_private'), kind: enum('wade', 'drift'), startsAt: time, price: int 1..500000):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  require startsAt > now and startsAt <= now + 365d else BAD_TRIP_DATE
  t = insert trips { title, river, kind, startsAt, createdBy: viewer }
  insert receipts { trip: t.id, price }
  return t

mutation addAngler(trip: trips, principal: principal, licenseNumber: text 3..40, validFrom: time, validThrough: time, photo: image <=5000000):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'booked' and t.startsAt > now else TRIP_LOCKED
  a = roles[principal] ! else ANGLER_NOT_FOUND
  require a.role = 'angler' else NOT_ANGLER
  require validFrom <= validThrough and day(validFrom) <= day(t.startsAt) and day(validThrough) >= day(t.startsAt) else INVALID_LICENSE 'License must be valid on the trip date.'
  return insert participants { trip, principal, name: a.name, licenseNumber, validFrom, validThrough, photo, loggedBy: viewer }

mutation approveStretch(trip: trips, permission: text 10..1000):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  t = trips[trip] ! else NOT_FOUND
  require t.river = 'cedar_private' else NOT_CLOSED
  require t.status = 'booked' and t.startsAt > now else TRIP_LOCKED
  require t.approvedBy = null else ALREADY_APPROVED
  update trips[trip] { permission, approvedBy: viewer, approvedAt: now }

mutation advanceTrip(trip: trips, status: enum('rigged', 'on_water', 'returned')):
  require exists roles[viewer, role = 'guide'] else NOT_GUIDE
  t = trips[trip] ! else NOT_FOUND
  require (t.status = 'booked' and status = 'rigged') or (t.status = 'rigged' and status = 'on_water') or (t.status = 'on_water' and status = 'returned') else BAD_TRANSITION
  require t.river != 'cedar_private' or t.approvedBy != null else PERMISSION_REQUIRED
  require headcount[trip] > 0 else NO_ANGLERS
  update trips[trip] { status }

mutation cancelTrip(trip: trips):
  require exists roles[viewer, role = 'clerk'] or exists participants[trip, viewer] else NOT_BOOKER
  t = trips[trip] ! else NOT_FOUND
  require t.status = 'booked' and t.startsAt > now else TRIP_LOCKED
  r = receipts[trip] ! else NOT_FOUND
  update receipts[trip] { refund: r.price if t.startsAt - now > 14d else 0 }
  update trips[trip] { status: 'cancelled' }

-- Intent: anglers see their own trips; staff share the operational board.
invariant trips.read only exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'guide'] or exists participants[.id, viewer]
-- License evidence is private to its angler and the outfitter desk.
invariant participants.read only .principal = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner']
invariant receipts.read only exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'owner'] or exists participants[.trip, viewer]
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
