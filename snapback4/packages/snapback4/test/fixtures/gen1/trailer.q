use identity password

table roles:
  principal: principal
  role: enum('renter', 'staff', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('renter', 'staff', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table trailers:
  name: text 1..80
  stalls: int 1..12
  unique name
  read <- exists roles[viewer]
  insert <- exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']
  update <- exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']
  delete <- exists roles[viewer, role = 'owner']
  online only

mutation addTrailer(name: text 1..80, stalls: int 1..12):
  require exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return insert trailers { name, stalls }

table rentals:
  renter: principal
  trailer: trailers
  pickupAt: time
  returnAt: time
  rentalDays: int default 1
  status: enum('booked', 'inspected', 'out', 'returned', 'cancelled') default 'booked'
  floorPhoto: image <=5000000 ?
  hitchPhoto: image <=5000000 ?
  lightsPhoto: image <=5000000 ?
  dailyFee: money USD default 0
  crossesStateLine: bool default false
  destination: text <=200 default ''
  healthCert: text <=500 default ''
  interstateApproved: bool default false
  lateFee: bool default false
  refundFull: bool default false
  openedAt: time default now
  cap 200 by renter
  immutable renter, trailer, pickupAt, returnAt, rentalDays, openedAt
  read <- .renter = viewer or exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']
  insert <- .renter = viewer and exists roles[viewer, role = 'renter']
  update <- .renter = viewer or exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']
  online only

mutation book(trailer: trailers, pickupAt: time, returnAt: time, crossesStateLine: bool):
  require exists roles[viewer, role = 'renter'] else NOT_RENTER
  require exists trailers[trailer] else NOT_FOUND
  require pickupAt > now else IN_THE_PAST
  require returnAt > pickupAt else BAD_RANGE
  days = max((returnAt - pickupAt) / 1d, 1)
  return insert rentals { renter: viewer, trailer, pickupAt, returnAt, rentalDays: days, crossesStateLine }

mutation inspect(rental: rentals, floor: image <=5000000, hitch: image <=5000000, lights: image <=5000000, dailyFee: money USD):
  require exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  r = rentals[rental] ! else NOT_FOUND
  require r.status = 'booked' else CLOSED
  require dailyFee > 0 else BAD_FEE
  update rentals[r] { floorPhoto: floor, hitchPhoto: hitch, lightsPhoto: lights, dailyFee, status: 'inspected' }
  insert receipts { rental: r.id, renter: r.renter, kind: 'charge', amount: dailyFee * r.rentalDays, note: 'Rental charge' }
  return null

mutation approveInterstate(rental: rentals, destination: text 1..200, healthCert: text 1..500):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  r = rentals[rental] ! else NOT_FOUND
  require r.crossesStateLine else NO_CROSSING
  require r.status = 'booked' or r.status = 'inspected' else CLOSED
  update rentals[r] { destination, healthCert, interstateApproved: true }
  return null

mutation checkout(rental: rentals):
  require exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  r = rentals[rental] ! else NOT_FOUND
  require r.status = 'inspected' else CLOSED
  require not r.crossesStateLine or r.interstateApproved else NEEDS_APPROVAL
  update rentals[r] { status: 'out' }
  return null

mutation returnTrailer(rental: rentals):
  require exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  r = rentals[rental] ! else NOT_FOUND
  require r.status = 'out' else CLOSED
  late = now > r.returnAt + 1d
  update rentals[r] { status: 'returned', lateFee: late }
  if late:
    insert receipts { rental: r.id, renter: r.renter, kind: 'extra', amount: r.dailyFee, note: 'Late return extra charge' }
  return null

mutation cancelRental(rental: rentals):
  r = rentals[rental] ! else NOT_FOUND
  require r.renter = viewer else NOT_RENTER
  require r.status = 'booked' or r.status = 'inspected' else CLOSED
  full = now < r.pickupAt - 5d
  update rentals[r] { status: 'cancelled', refundFull: full }
  if full and r.dailyFee > 0:
    insert receipts { rental: r.id, renter: r.renter, kind: 'refund', amount: r.dailyFee * r.rentalDays, note: 'Full refund: cancelled 5+ days before pickup' }
  return null

table receipts:
  rental: rentals
  renter: principal
  kind: enum('charge', 'refund', 'extra')
  amount: money USD
  note: text <=200 default ''
  createdAt: time default now
  immutable rental, renter, kind, amount, createdAt
  read <- .renter = viewer or exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']
  insert <- .renter = viewer or exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']
  update <- deny
  delete <- deny
  online only

query board(c: cursor ?):
  if exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']:
    return rentals last 50 by .id after c
  return rentals where .renter = viewer last 50 by .id after c

query fleet(c: cursor ?):
  return trailers last 50 by .id after c

query ledger(c: cursor ?):
  if exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']:
    return receipts last 50 by .id after c
  return receipts where .renter = viewer last 50 by .id after c

-- Independent intent from the spec; extend these when requirements change.
invariant roles.read only .principal = viewer
invariant trailers.read only exists roles[viewer]
invariant rentals.read only .renter = viewer or exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']
invariant receipts.read only .renter = viewer or exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']
invariant rentals.cancelRental only .renter = viewer
invariant rentals.approveInterstate only exists roles[viewer, role = 'owner']
