-- Dog Sled Tours: a dog sledding kennel's booking office opens tours with a
-- price and a dog team; guests join with a signed waiver scan; mushers run
-- the tours; the kennel owner approves over-limit guests.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'booking', 'musher', 'guest')
  unique principal
  immutable principal
  cap 100
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table tours:
  title: text 1..120
  departsAt: time
  status: enum('booked', 'on_trail', 'returned', 'cancelled') default 'booked'
  price: money USD read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
  dogTeam: text 1..200
  weightLimit: int 1..300
  cancelledAt: time ?
  rebookedFrom: tours ?
  immutable rebookedFrom
  cap 1000
  read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'musher'] or (exists bookings[tour = .id, guest = viewer] and exists roles[principal = viewer, role = 'guest'])
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
  update <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'musher']
  online only

table bookings:
  tour: tours
  guest: principal
  guestName: text 1..80
  weight: int 1..300
  phone: text 1..40 read <- .guest = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
  emergencyContact: text 1..200 read <- .guest = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
  waiver: image <=10000000 read <- .guest = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
  approved: bool default false
  approvalReason: text 1..500 ?
  approvedAt: time ?
  unique tour, guest
  immutable tour, guest
  cap 100 by tour
  read <- .guest = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'musher']
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
  update <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
  delete <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
  online only

-- The booking office (and the owner) open tours and take bookings. The roster
-- query lets the office pick guest accounts; roles stay private otherwise.
mutation provision(principal: principal, role: enum('owner', 'booking', 'musher', 'guest')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal = principal] { principal, role }

query myRole():
  return roles[viewer]

query usersByRole(role: enum('owner', 'booking', 'musher', 'guest')):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] else NOT_OFFICE
  return roles where .role = role first 100 by .id

-- The kennel board: every staff seat sees every tour; guests use myTours.
query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'musher'] else NOT_STAFF
  return tours first 50 by .departsAt after c

query tourDetail(tour: tours):
  return tours[tour]

query tourRoster(tour: tours, c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'musher'] else NOT_STAFF
  return bookings where .tour = tour first 100 by .id after c

query myBookings(c: cursor ?):
  return bookings where .guest = viewer first 100 by .id after c

query myTours(c: cursor ?):
  return tours where exists (bookings[tour = .id, guest = viewer]) first 50 by .departsAt after c

mutation openTour(title: text 1..120, departsAt: time, price: money USD, dogTeam: text 1..200, weightLimit: int 1..300):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] else NOT_OFFICE
  require departsAt > now else BAD_DATE 'Tours open in the future.'
  return insert tours { title, departsAt, status: 'booked', price, dogTeam, weightLimit }

mutation editTour(tour: tours, title: text 1..120 ?, departsAt: time ?, price: money USD ?, dogTeam: text 1..200 ?, weightLimit: int 1..300 ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] else NOT_OFFICE
  t = tours[tour] ! else NOT_FOUND
  require t.status = 'booked' else BAD_TRANSITION 'Only a booked tour may be edited.'
  officePrice = t.price
  require officePrice != null else NOT_FOUND
  update tours[t.id] { title: title ?? t.title, departsAt: departsAt ?? t.departsAt, price: price ?? officePrice, dogTeam: dogTeam ?? t.dogTeam, weightLimit: weightLimit ?? t.weightLimit }
  return null

-- booked -> on_trail -> returned, with on_trail -> booked recalls. Mushers move
-- tours; a tour with an unapproved over-limit guest may not go on trail.
mutation setStatus(tour: tours, status: enum('booked', 'on_trail', 'returned')):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'musher'] else NOT_STAFF
  t = tours[tour] ! else NOT_FOUND
  if status = 'on_trail':
    require t.status = 'booked' else BAD_TRANSITION 'Tours go on trail from booked.'
    for b in bookings where .tour = tour:
      if b.weight > t.weightLimit and b.approved = false:
        require false else OVERWEIGHT_NEEDS_APPROVAL 'A guest over the weight limit needs owner approval.'
  else if status = 'returned':
    require t.status = 'on_trail' else BAD_TRANSITION 'Tours return from on trail.'
  else if status = 'booked':
    require t.status = 'on_trail' else BAD_TRANSITION 'A tour goes back to booked from on trail.'
  update tours[t.id] { status }
  return null

mutation cancelTour(tour: tours):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] else NOT_OFFICE
  t = tours[tour] ! else NOT_FOUND
  require t.status = 'booked' or t.status = 'on_trail' else BAD_TRANSITION 'Only a booked or on-trail tour may be cancelled.'
  update tours[t.id] { status: 'cancelled', cancelledAt: now }
  return null

-- A cancelled tour may be rebooked within 12 calendar months of cancellation.
mutation rebookTour(tour: tours, departsAt: time):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] else NOT_OFFICE
  t = tours[tour] ! else NOT_FOUND
  require t.status = 'cancelled' else NOT_CANCELLED 'Only a cancelled tour may be rebooked.'
  cancelledAt = t.cancelledAt
  require cancelledAt != null else NOT_CANCELLED 'Only a cancelled tour may be rebooked.'
  require month(now) <= month(cancelledAt) + 12 else REBOOK_EXPIRED 'A cancelled tour may be rebooked within 12 months.'
  require departsAt > now else BAD_DATE 'Rebooked tours depart in the future.'
  oldPrice = t.price
  require oldPrice != null else NOT_FOUND
  return insert tours { title: t.title, departsAt, status: 'booked', price: oldPrice, dogTeam: t.dogTeam, weightLimit: t.weightLimit, rebookedFrom: t.id }

mutation addBooking(tour: tours, guest: principal, guestName: text 1..80, weight: int 1..300, phone: text 1..40, emergencyContact: text 1..200, waiver: image <=10000000):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] else NOT_OFFICE
  require exists roles[principal = guest, role = 'guest'] else NOT_GUEST 'Bookings are for guest accounts.'
  t = tours[tour] ! else NOT_FOUND
  require t.status = 'booked' else TOUR_NOT_OPEN 'Guests join a booked tour.'
  return insert bookings { tour, guest, guestName, weight, phone, emergencyContact, waiver, approved: false }

mutation updateBooking(booking: bookings, guestName: text 1..80 ?, weight: int 1..300 ?, phone: text 1..40 ?, emergencyContact: text 1..200 ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] else NOT_OFFICE
  b = bookings[booking] ! else NOT_FOUND
  keptPhone = b.phone
  require keptPhone != null else NOT_FOUND
  keptContact = b.emergencyContact
  require keptContact != null else NOT_FOUND
  update bookings[b.id] { guestName: guestName ?? b.guestName, weight: weight ?? b.weight, phone: phone ?? keptPhone, emergencyContact: emergencyContact ?? keptContact }
  return null

mutation removeBooking(booking: bookings):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] else NOT_OFFICE
  delete bookings[booking]
  return null

-- Only the kennel owner approves a guest over the sled weight limit, and the
-- reason is recorded on the booking.
mutation approveGuest(booking: bookings, reason: text 1..500):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the kennel owner approves over-limit guests.'
  b = bookings[booking] ! else NOT_FOUND
  t = tours[b.tour] ! else NOT_FOUND
  require b.weight > t.weightLimit else NOT_OVERWEIGHT 'Approval is for guests over the sled weight limit.'
  update bookings[b.id] { approved: true, approvalReason: reason, approvedAt: now }
  return null

-- Privacy intent, stated independently from the rules above.
invariant tours.read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'musher'] or (exists bookings[tour = .id, guest = viewer] and exists roles[principal = viewer, role = 'guest'])
invariant tours.price read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
invariant tours.insert only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
invariant tours.update only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'musher']
invariant bookings.read only .guest = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'musher']
invariant bookings.phone read only .guest = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
invariant bookings.emergencyContact read only .guest = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
invariant bookings.waiver read only .guest = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
invariant bookings.insert only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
invariant bookings.update only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
invariant bookings.approved update only exists roles[principal = viewer, role = 'owner']
invariant bookings.approvalReason update only exists roles[principal = viewer, role = 'owner']
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking']
invariant roles.provision only viewer = 'service:operator'
