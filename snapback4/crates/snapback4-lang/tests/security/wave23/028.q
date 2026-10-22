use identity password

table roles:
  principal: principal
  role: enum('camper', 'host', 'ranger')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

fn staff():
  return roles[principal = viewer].role = 'host' or roles[principal = viewer].role = 'ranger'
fn ranger():
  return roles[principal = viewer].role = 'ranger'
fn camper():
  return roles[principal = viewer].role = 'camper'

table sites:
  name: text 1..60
  kind: enum('tent', 'RV')
  nightly: int 100..50000
  status: enum('open', 'booked', 'occupied', 'dirty', 'cleaned', 'closed')
  current: stays ?
  holdUntil: time ?
  reason: text <=500
  unique name
  read <- exists roles[principal = viewer]
  insert <- exists roles[principal = viewer, role = 'ranger']
  update <- (exists roles[principal = viewer, role = 'host'] or exists roles[principal = viewer, role = 'ranger']) or exists roles[principal = viewer, role = 'camper']
  online only

table stays:
  owner: principal
  site: sites
  arrival: time
  nights: int 1..30
  total: int 100..1500000
  deposit: int 100..50000
  status: enum('booked', 'occupied', 'completed', 'cancelled', 'released', 'evicted', 'refunded')
  reason: text <=500
  immutable owner, site, arrival, nights, total, deposit
  read <- .owner = viewer or (exists roles[principal = viewer, role = 'host'] or exists roles[principal = viewer, role = 'ranger'])
  insert <- .owner = viewer and exists roles[principal = viewer, role = 'camper']
  update <- .owner = viewer or (exists roles[principal = viewer, role = 'host'] or exists roles[principal = viewer, role = 'ranger'])
  online only

table vehicles renamed from plates:
  owner: principal
  stay: stays
  photo: image <=5000000 read <- .owner = viewer or exists roles[principal = viewer, role = 'ranger']
  immutable owner, stay
  read <- .owner = viewer or (exists roles[principal = viewer, role = 'host'] or exists roles[principal = viewer, role = 'ranger'])
  insert <- .owner = viewer and exists roles[principal = viewer, role = 'camper']
  delete <- exists roles[principal = viewer, role = 'host'] or exists roles[principal = viewer, role = 'ranger']
  online only

table payments:
  owner: principal
  stay: stays
  charged: int 100..1500000
  refunded: int 0..1500000
  forfeited: int 0..50000
  reason: text <=500
  unique stay
  immutable owner, stay, charged
  read <- .owner = viewer or exists roles[principal = viewer, role = 'ranger']
  insert <- .owner = viewer and exists roles[principal = viewer, role = 'camper']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'ranger']
  online only

invariant stays.read only .owner = viewer or (exists roles[principal = viewer, role = 'host'] or exists roles[principal = viewer, role = 'ranger'])
invariant vehicles.read only .owner = viewer or (exists roles[principal = viewer, role = 'host'] or exists roles[principal = viewer, role = 'ranger'])
invariant vehicles.delete only (exists roles[principal = viewer, role = 'host'] or exists roles[principal = viewer, role = 'ranger'])
invariant payments.read only .owner = viewer or exists roles[principal = viewer, role = 'ranger']

mutation provision(principal: principal, role: enum('camper', 'host', 'ranger')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }
query myRole():
  return roles[principal = viewer]
query serverTime():
  require exists roles[principal = viewer] else SIGN_IN
  return now
query siteBoard():
  require exists roles[principal = viewer] else SIGN_IN
  return sites first 200 by .id { id, name, kind, nightly, reason: .reason if .status = 'closed' else '', holdUntil: null, status: 'open' if .status = 'booked' and .holdUntil != null and now >= .holdUntil else .status, current: null }
query myBookings():
  require camper() else CAMPER_ONLY
  return stays where .owner = viewer first 200 by .id
query booking(id: stays):
  return stays[id]
query myPayments():
  require camper() else CAMPER_ONLY
  return payments where .owner = viewer first 200 by .id
query payment(stay: stays):
  return payments[stay = stay]
query plate(stay: stays):
  if staff() and not ranger():
    return null
  return first(vehicles where .stay = stay first 1 by .id)
query liveStays():
  require staff() else STAFF_ONLY
  return stays first 200 by .id

mutation addSite(name: text 1..60, kind: enum('tent', 'RV'), nightly: int 100..50000):
  require ranger() else RANGER_ONLY
  require len(trim(name)) >= 1 else NAME_REQUIRED
  return insert sites { name, kind, nightly, status: 'open', current: null, holdUntil: null, reason: '' }

mutation book(site: sites, arrival: time, nights: int 1..30, photo: image <=5000000):
  require camper() else CAMPER_ONLY
  s = sites[site] ! else NOT_FOUND
  require s.status = 'open' or s.status = 'cleaned' or (s.status = 'booked' and s.holdUntil != null and now >= s.holdUntil) else SITE_UNAVAILABLE
  require arrival >= now and arrival <= now + 365d else ARRIVAL_RANGE
  total = s.nightly * nights
  b = insert stays { owner: viewer, site, arrival, nights, total, deposit: s.nightly, status: 'booked', reason: '' }
  insert vehicles { owner: viewer, stay: b.id, photo }
  insert payments { owner: viewer, stay: b.id, charged: total, refunded: 0, forfeited: 0, reason: '' }
  update sites[site] { status: 'booked', current: b.id, holdUntil: arrival + 1d, reason: '' }
  return b

mutation cancel(stay: stays):
  require camper() else CAMPER_ONLY
  b = stays[stay] ! else NOT_FOUND
  require b.owner = viewer else PRIVATE_BOOKING
  require b.status = 'booked' else NOT_BOOKED
  require now < b.arrival + 1d else HOLD_EXPIRED
  s = sites[b.site] ! else NOT_FOUND
  require s.status != 'closed' else RANGER_REFUND_REQUIRED
  lost = b.deposit if b.arrival - now < 14d else 0
  update payments[stay = stay] { refunded: b.total - lost, forfeited: lost, reason: 'Camper cancellation' }
  update stays[stay] { status: 'cancelled', reason: 'Camper cancellation' }
  update sites[b.site] { status: 'open', current: null, holdUntil: null }

mutation checkIn(stay: stays):
  require staff() else STAFF_ONLY
  b = stays[stay] ! else NOT_FOUND
  require b.status = 'booked' else NOT_BOOKED
  require now >= b.arrival else TOO_EARLY
  require now < b.arrival + 1d else HOLD_EXPIRED
  s = sites[b.site] ! else NOT_FOUND
  require s.status = 'booked' and s.current = stay else SITE_UNAVAILABLE
  update stays[stay] { status: 'occupied' }
  update sites[b.site] { status: 'occupied', holdUntil: null }

mutation checkOut(stay: stays):
  require staff() else STAFF_ONLY
  b = stays[stay] ! else NOT_FOUND
  require b.status = 'occupied' else NOT_OCCUPIED
  s = sites[b.site] ! else NOT_FOUND
  require s.status = 'occupied' and s.current = stay else SITE_UNAVAILABLE
  update stays[stay] { status: 'completed' }
  update sites[b.site] { status: 'dirty', current: null }

mutation clean(site: sites):
  require staff() else STAFF_ONLY
  s = sites[site] ! else NOT_FOUND
  require s.status = 'dirty' else NOT_DIRTY
  update sites[site] { status: 'cleaned' }

mutation closeSite(site: sites, reason: text 3..500):
  require ranger() else RANGER_ONLY
  require len(trim(reason)) >= 3 else REASON_REQUIRED
  s = sites[site] ! else NOT_FOUND
  require s.status != 'closed' else ALREADY_CLOSED
  update sites[site] { status: 'closed', reason }

mutation refundClosed(stay: stays, reason: text 3..500):
  require ranger() else RANGER_ONLY
  require len(trim(reason)) >= 3 else REASON_REQUIRED
  b = stays[stay] ! else NOT_FOUND
  s = sites[b.site] ! else NOT_FOUND
  require s.status = 'closed' else SITE_NOT_CLOSED
  require b.status = 'booked' or b.status = 'occupied' else NOT_REFUNDABLE
  update payments[stay = stay] { refunded: b.total, forfeited: 0, reason }
  update stays[stay] { status: 'refunded', reason }
  update sites[b.site] { current: null }

mutation evict(stay: stays, reason: text 3..500):
  require ranger() else RANGER_ONLY
  require len(trim(reason)) >= 3 else REASON_REQUIRED
  b = stays[stay] ! else NOT_FOUND
  require b.status = 'occupied' else NOT_OCCUPIED
  s = sites[b.site] ! else NOT_FOUND
  require s.status = 'occupied' and s.current = stay else SITE_UNAVAILABLE
  update stays[stay] { status: 'evicted', reason }
  update sites[b.site] { status: 'dirty', current: null, reason }

job releaseNoShows():
  for b in stays:
    if b.status = 'booked' and now >= b.arrival + 1d:
      s = sites[b.site] ! else NOT_FOUND
      if s.status != 'closed':
        update stays[b.id] { status: 'released', reason: 'No check-in within one day' }
        if s.current = b.id and s.status = 'booked':
          update sites[b.site] { status: 'open', current: null, holdUntil: null }

schedule noShowSweep every 1m: releaseNoShows

query vehiclesForBooking(stay: stays):
  return vehicles where .stay = stay first 200 by .id
mutation addVehicle(stay: stays, photo: image <=5000000):
  require camper() else CAMPER_ONLY
  b = stays[stay] ! else NOT_FOUND
  require b.owner = viewer else PRIVATE_BOOKING
  return insert vehicles {owner: viewer, stay, photo}
mutation removeVehicle(vehicle: vehicles):
  require staff() else STAFF_ONLY
  delete vehicles[vehicle]
