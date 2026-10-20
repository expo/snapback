use identity

table people:
  principal: principal
  role: enum('renter', 'attendant', 'supervisor')
  name: text 2..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists people[viewer, role = 'supervisor'] or viewer = 'service:provision'
  insert <- viewer = 'service:provision' or (.principal = viewer and .role = 'renter')
  update <- deny
  online only

table availability:
  pavilion: enum('Willow', 'Lakeside', 'Oak')
  date: time
  occupied: bool
  unique pavilion, date
  immutable pavilion, date
  public 'Only pavilion, date, and occupancy are public; no rental or payment data.'
  insert <- exists people[viewer, role = 'renter'] or viewer = 'service:provision'
  update <- exists people[viewer, role = 'renter'] or viewer = 'service:provision'
  online only

table bookings:
  renter: principal
  attendant: principal ?
  slot: availability
  label: text 3..100
  pavilion: enum('Willow', 'Lakeside', 'Oak')
  date: time
  endsAt: time
  placedAt: time
  state: enum('held', 'confirmed', 'released')
  damage: bool
  immutable renter, slot, label, pavilion, date, endsAt, placedAt
  read <- .renter = viewer or .attendant = viewer or exists people[viewer, role = 'supervisor'] or viewer = 'service:provision'
  insert <- (.renter = viewer and exists people[viewer, role = 'renter']) or viewer = 'service:provision'
  update <- .renter = viewer or .attendant = viewer or exists people[viewer, role = 'supervisor']
  online only

table payments:
  booking: bookings
  renter: principal
  amountCents: int 10000..10000
  receipt: text 6..120
  paidAt: time
  status: enum('paid', 'refunded', 'kept')
  decidedAt: time ?
  decidedBy: principal ?
  reason: text 10..500 ?
  unique booking
  immutable booking, renter, amountCents, receipt, paidAt
  read <- .renter = viewer or exists people[viewer, role = 'supervisor'] or viewer = 'service:provision'
  insert <- (.renter = viewer and exists people[viewer, role = 'renter']) or viewer = 'service:provision'
  update <- exists people[viewer, role = 'supervisor']
  online only

table inspections:
  booking: bookings
  author: principal
  damage: bool
  note: text 5..500
  photo: image <=5000000
  at: time
  unique booking
  immutable booking, author, damage, note, photo, at
  read <- exists bookings[.booking, renter = viewer] or exists bookings[.booking, attendant = viewer] or exists people[viewer, role = 'supervisor']
  insert <- .author = viewer and exists people[viewer, role = 'attendant'] and exists bookings[.booking, attendant = viewer]
  online only

-- One required description per booking; separate row authority keeps it out of
-- renter/attendant booking results and write acknowledgements.
table depositReviews:
  booking: bookings
  description: enum('awaiting inspection', 'inspection clear', 'damage needs review')
  unique booking
  immutable booking
  read <- exists people[viewer, role = 'supervisor']
  insert <- exists bookings[.booking, renter = viewer] or exists bookings[.booking, attendant = viewer] or viewer = 'service:provision'
  update <- exists bookings[.booking, attendant = viewer]
  online only

query depositReview(booking: bookings):
  require exists people[viewer, role = 'supervisor'] else SUPERVISOR_ONLY
  return depositReviews[booking = booking]

query me():
  return { principal: viewer, profile: people[principal = viewer], now: now }
query staff():
  require exists people[viewer, role = 'supervisor'] else SUPERVISOR_ONLY
  return people where .role = 'attendant' first 100 by .id { principal, name }
query calendar(from: time, until: time):
  require until > from and until <= from + 62d else DATE_RANGE
  return availability where .date >= from and .date < until first 200 by .date { pavilion, date, occupied }
query myBookings():
  return bookings first 200 by .id
query booking(id: bookings):
  return bookings[id]
query payment(booking: bookings):
  return payments[booking = booking]
query inspection(booking: bookings):
  return inspections[booking = booking]

mutation enroll(name: text 2..80):
  require not exists people[principal = viewer] else ALREADY_ENROLLED
  return insert people { principal: viewer, role: 'renter', name }
mutation provision(principal: principal, role: enum('renter', 'attendant', 'supervisor'), name: text 2..80):
  require viewer = 'service:provision' else PROVISION_ONLY
  return insert people { principal, role, name }
mutation book(pavilion: enum('Willow', 'Lakeside', 'Oak'), date: time, label: text 3..100):
  require exists people[viewer, role = 'renter'] else RENTER_ONLY
  require date = day(date) * 1d and date >= (day(now) + 4) * 1d and date <= (day(now) + 365) * 1d else BOOKING_DATE
  s = availability[pavilion, date]
  require s = null or not s.occupied else DATE_TAKEN
  slot = upsert availability[pavilion, date] { pavilion, date, occupied: true }
  b = insert bookings { renter: viewer, attendant: null, slot: slot.id, label, pavilion, date, endsAt: date + 1d, placedAt: now, state: 'held', damage: false }
  insert depositReviews { booking: b.id, description: 'awaiting inspection' }
  return b
mutation payDeposit(booking: bookings, receipt: text 6..120):
  b = bookings[booking] ! else NOT_FOUND
  require b.renter = viewer else OWNER_ONLY
  require b.state = 'held' and now < b.placedAt + 72h else PAYMENT_CLOSED
  insert payments { booking, renter: viewer, amountCents: 10000, receipt, paidAt: now, status: 'paid', decidedAt: null, decidedBy: null, reason: null }
  update bookings[booking] { state: 'confirmed' }
mutation assign(booking: bookings, attendant: principal):
  require exists people[viewer, role = 'supervisor'] else SUPERVISOR_ONLY
  require exists people[attendant, role = 'attendant'] else NOT_ATTENDANT
  b = bookings[booking] ! else NOT_FOUND
  require b.state != 'released' and now < b.endsAt else ASSIGNMENT_CLOSED
  update bookings[booking] { attendant }
mutation inspect(booking: bookings, damage: bool, note: text 5..500, photo: image <=5000000):
  require exists people[viewer, role = 'attendant'] else ATTENDANT_ONLY
  b = bookings[booking] ! else NOT_FOUND
  require b.attendant = viewer else ASSIGNED_ONLY
  require b.state = 'confirmed' and now >= b.endsAt and now < b.endsAt + 7d else INSPECTION_CLOSED
  insert inspections { booking, author: viewer, damage, note, photo, at: now }
  update bookings[booking] { damage }
  if damage:
    upsert depositReviews[booking] { booking, description: 'damage needs review' }
  else:
    upsert depositReviews[booking] { booking, description: 'inspection clear' }
mutation keepDeposit(booking: bookings, reason: text 10..500):
  require exists people[viewer, role = 'supervisor'] else SUPERVISOR_ONLY
  b = bookings[booking] ! else NOT_FOUND
  require b.damage and now >= b.endsAt else DAMAGE_REQUIRED
  p = payments[booking = booking] ! else NOT_FOUND
  require p.status = 'paid' else DEPOSIT_CLOSED
  update payments[p.id] { status: 'kept', decidedAt: now, decidedBy: viewer, reason }

job deadlines():
  for b in bookings:
    if b.state = 'held' and now >= b.placedAt + 72h:
      update bookings[b.id] { state: 'released' }
      update availability[b.slot] { occupied: false }
    if b.state = 'confirmed' and not b.damage and now >= b.endsAt + 7d:
      p = payments[booking = b.id]
      if p != null and p.status = 'paid':
        update payments[p.id] { status: 'refunded', decidedAt: now, decidedBy: null, reason: null }
schedule deadlinesEveryMinute every 1m: deadlines

invariant bookings.read only .renter = viewer or .attendant = viewer or exists people[viewer, role = 'supervisor'] or viewer = 'service:provision'
invariant payments.read only .renter = viewer or exists people[viewer, role = 'supervisor'] or viewer = 'service:provision'
invariant payments.keepDeposit only exists people[viewer, role = 'supervisor']
invariant inspections.read only exists bookings[.booking, renter = viewer] or exists bookings[.booking, attendant = viewer] or exists people[viewer, role = 'supervisor']
invariant people.role write only viewer = 'service:provision' or (.principal = viewer and .role = 'renter')

-- Explicit idempotent migration, run by the filesystem operator on deploy/forward.
-- This also repairs stale dormant values after v1 wrote a new inspection.
job reconcileDepositReviews():
  for b in bookings:
    i = inspections[booking = b.id]
    if b.damage:
      upsert depositReviews[booking = b.id] { booking: b.id, description: 'damage needs review' }
    else:
      if i != null:
        if i.damage:
          upsert depositReviews[booking = b.id] { booking: b.id, description: 'damage needs review' }
        else:
          upsert depositReviews[booking = b.id] { booking: b.id, description: 'inspection clear' }
      else:
        upsert depositReviews[booking = b.id] { booking: b.id, description: 'awaiting inspection' }

invariant depositReviews.read only exists people[viewer, role = 'supervisor']
