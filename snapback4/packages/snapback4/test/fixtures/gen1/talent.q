use identity password

table roles:
  principal: principal
  role: enum('agent', 'assistant', 'director', 'family')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('agent', 'assistant', 'director', 'family')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table children:
  name: text 1..120
  familyOwner: principal
  immutable familyOwner
  read <- (.familyOwner = viewer and exists roles[viewer, role = 'family']) or exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'director']
  insert <- (.familyOwner = viewer and exists roles[viewer, role = 'family']) or exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
  update <- exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
  online only

mutation registerChild(name: text 1..120, familyOwner: principal):
  require exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director'] else NOT_STAFF
  return insert children { name, familyOwner }

mutation registerMyChild(name: text 1..120):
  require exists roles[viewer, role = 'family'] else NOT_FAMILY
  return insert children { name, familyOwner: viewer }

query childList(c: cursor ?):
  if exists roles[viewer, role = 'family']:
    return children where .familyOwner = viewer last 50 by .id after c
  return children last 50 by .id after c

table bookings:
  child: children
  familyOwner: principal
  shootTitle: text 1..120
  permitScan: image <=5000000
  permitExpiresAt: time
  headshot: image <=5000000 ?
  sizes: text 1..200
  callTime: time
  shootHours: int 0..24
  permittedHours: int 1..24
  dayRate: money USD
  guardianPhone: text 7..30
  trustAccount: text 4..60
  teacherConsent: text <=500 default ''
  overtimeApproved: bool default false
  status: enum('offered', 'confirmed', 'on_set', 'paid') default 'offered'
  openedAt: time default now
  immutable child, familyOwner, permitScan, permitExpiresAt, shootHours, permittedHours, openedAt, dayRate, guardianPhone, trustAccount
  read <- (.familyOwner = viewer and exists roles[viewer, role = 'family']) or exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'director']
  read (guardianPhone, trustAccount, dayRate) <- exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
  update <- exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
  online only

mutation openBooking(child: children, shootTitle: text 1..120, permitScan: image <=5000000, permitExpiresAt: time, headshot: image <=5000000 ?, sizes: text 1..200, callTime: time, shootHours: int 0..24, permittedHours: int 1..24, dayRate: money USD, guardianPhone: text 7..30, trustAccount: text 4..60):
  require exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director'] else NOT_STAFF
  require permitExpiresAt > now else PERMIT_EXPIRED
  kid = children[child] ! else NOT_FOUND
  return insert bookings { child, familyOwner: kid.familyOwner, shootTitle, permitScan, permitExpiresAt, headshot, sizes, callTime, shootHours, permittedHours, dayRate, guardianPhone, trustAccount, openedAt: now }

mutation confirmBooking(booking: bookings):
  require exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director'] else NOT_STAFF
  row = bookings[booking] ! else NOT_FOUND
  require row.status = 'offered' else BAD_STATUS
  require now < row.permitExpiresAt else PERMIT_EXPIRED
  require row.shootHours <= row.permittedHours or row.overtimeApproved else NEEDS_APPROVAL
  update bookings[booking] { status: 'confirmed' }
  return null

mutation beginShoot(booking: bookings):
  require exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director'] else NOT_STAFF
  row = bookings[booking] ! else NOT_FOUND
  require row.status = 'confirmed' else BAD_STATUS
  update bookings[booking] { status: 'on_set' }
  return null

mutation markPaid(booking: bookings):
  require exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director'] else NOT_STAFF
  row = bookings[booking] ! else NOT_FOUND
  require row.status = 'on_set' else BAD_STATUS
  update bookings[booking] { status: 'paid' }
  return null

mutation approveOvertime(booking: bookings, teacherConsent: text 1..500):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  row = bookings[booking] ! else NOT_FOUND
  require row.shootHours > row.permittedHours else NO_OVERTIME
  update bookings[booking] { overtimeApproved: true, teacherConsent }
  return null

query board(c: cursor ?):
  if exists roles[viewer, role = 'family']:
    return bookings where .familyOwner = viewer last 50 by .id after c
  return bookings last 50 by .id after c

query bookingDetail(booking: bookings):
  return bookings[booking]

-- Spec: families see only their own child's bookings; private contact/pay
-- fields are visible only to booking agents and the agency director.
invariant bookings.read only (.familyOwner = viewer and exists roles[viewer, role = 'family']) or exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'director']
invariant bookings.guardianPhone read only exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
invariant bookings.trustAccount read only exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
invariant bookings.dayRate read only exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
invariant bookings.insert only exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
invariant bookings.confirmBooking only exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'director']
invariant bookings.approveOvertime only exists roles[viewer, role = 'director']
invariant children.read only (.familyOwner = viewer and exists roles[viewer, role = 'family']) or exists roles[viewer, role = 'agent'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'director']
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
