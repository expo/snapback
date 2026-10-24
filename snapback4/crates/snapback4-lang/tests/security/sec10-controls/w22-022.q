use identity password

table roles:
  principal: principal
  role: enum('clerk', 'coordinator', 'interpreter')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table bookings:
  label: text 1..100
  courtroom: text 1..60
  language: text 1..60
  hearingType: enum('arraignment', 'trial', 'motion', 'sentencing')
  hearingAt: time
  minutes: int 15..480
  feeCents: int 1..1000000
  creator: principal
  interpreter: principal ?
  status: enum('open', 'assigned', 'completed', 'cancelled') default 'open'
  urgent: bool
  createdAt: time default now
  cancellationLate: bool default false
  cancellationApproved: bool default false
  immutable label, courtroom, language, hearingType, hearingAt, minutes, feeCents, creator, urgent, createdAt
  read <- .interpreter = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator']
  insert <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator']
  update <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator']
  online only

table caseFiles:
  booking: bookings
  caseNumber: text 1..80
  defendantFile: text 1..4000
  charges: text 1..2000
  victimNames: text <=2000
  orderScan: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg')
  unique booking
  immutable booking, caseNumber, defendantFile, charges, victimNames, orderScan
  read <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator']
  insert <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator']
  online only

table payments:
  booking: bookings
  interpreter: principal
  cents: int 1..1000000
  kind: enum('hearing', 'late-cancellation')
  approvedBy: principal
  approvedAt: time default now
  unique booking
  immutable booking, interpreter, cents, kind, approvedBy, approvedAt
  read <- .interpreter = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator']
  insert <- exists roles[principal = viewer, role = 'coordinator']
  online only

mutation provision(principal: principal, role: enum('clerk', 'coordinator', 'interpreter'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query me():
  return roles[viewer]

query roster():
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator'] else STAFF_ONLY
  return roles where .role = 'interpreter' first 100 by .id

query board(c: cursor ?):
  require exists roles[viewer] else NO_ROLE
  return bookings last 100 by .createdAt after c

query booking(booking: bookings):
  require exists roles[viewer] else NO_ROLE
  return bookings[booking]

query caseFile(booking: bookings):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator'] else STAFF_ONLY
  return caseFiles[booking]

query paymentList(c: cursor ?):
  require exists roles[viewer] else NO_ROLE
  return payments last 100 by .approvedAt after c

mutation createBooking(label: text 1..100, courtroom: text 1..60, language: text 1..60, hearingType: enum('arraignment', 'trial', 'motion', 'sentencing'), hearingAt: time, minutes: int 15..480, feeCents: int 1..1000000, caseNumber: text 1..80, defendantFile: text 1..4000, charges: text 1..2000, victimNames: text <=2000, orderScan: file <=5000000 ('application/pdf', 'image/png', 'image/jpeg')):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator'] else STAFF_ONLY
  require hearingAt > now and hearingAt <= now + 365d else BAD_HEARING_TIME
  b = insert bookings { label, courtroom, language, hearingType, hearingAt, minutes, feeCents, creator: viewer, urgent: hearingAt < now + 72h }
  insert caseFiles { booking: b.id, caseNumber, defendantFile, charges, victimNames, orderScan }
  return b

mutation assign(booking: bookings, interpreter: principal):
  require exists roles[principal = viewer, role = 'coordinator'] else COORDINATOR_ONLY
  b = bookings[booking] ! else NOT_FOUND
  require b.status = 'open' else NOT_OPEN
  require b.hearingAt > now else HEARING_STARTED
  require exists roles[principal = interpreter, role = 'interpreter'] else NOT_INTERPRETER
  update bookings[booking] { interpreter, status: 'assigned' }

mutation complete(booking: bookings):
  require exists roles[principal = viewer, role = 'coordinator'] else COORDINATOR_ONLY
  b = bookings[booking] ! else NOT_FOUND
  require b.status = 'assigned' else NOT_ASSIGNED
  require b.interpreter != null else NOT_ASSIGNED
  update bookings[booking] { status: 'completed' }
  return insert payments { booking, interpreter: b.interpreter, cents: b.feeCents, kind: 'hearing', approvedBy: viewer }

mutation cancel(booking: bookings):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'coordinator'] else STAFF_ONLY
  b = bookings[booking] ! else NOT_FOUND
  require b.status = 'open' or b.status = 'assigned' else NOT_ACTIVE
  require now < b.hearingAt else HEARING_STARTED
  update bookings[booking] { status: 'cancelled', cancellationLate: now > b.hearingAt - 72h }

mutation approveCancellation(booking: bookings):
  require exists roles[principal = viewer, role = 'coordinator'] else COORDINATOR_ONLY
  b = bookings[booking] ! else NOT_FOUND
  require b.status = 'cancelled' and b.cancellationLate else NOT_LATE_CANCELLATION
  require b.interpreter != null else NO_INTERPRETER
  require not b.cancellationApproved else ALREADY_APPROVED
  update bookings[booking] { cancellationApproved: true }
  return insert payments { booking, interpreter: b.interpreter, cents: b.feeCents, kind: 'late-cancellation', approvedBy: viewer }
