-- Wedding DJ bookings on Snapback 4.
-- Roles: owner (company owner), desk (booking desk), dj, couple.
-- One roster row per principal; first grants come from service:operator.

use identity password

table roles:
  principal: principal
  role: enum('owner', 'desk', 'dj', 'couple')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- Spec intent: only desk and owner create bookings, and only for a real couple account.
-- Spec intent: DJs read every booking's operational fields; couples read only their own rows.
-- Spec intent: phone, deposit and price are visible only to desk and owner, nobody else.
table bookings:
  couple: principal
  dj: principal ?
  coupleName: text 1..120
  phone: text 1..40 read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  price: money USD read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  deposit: money USD read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  weddingAt: time
  status: enum('planned', 'packed', 'playing', 'packed_down') default 'planned'
  songRequests: text <=2000 ?
  finalSongs: text 1..5000 ?
  timeline: text <=5000 ?
  venueNotes: text <=5000 ?
  contract: image <=10000000
  extraHour: bool default false
  extraHourReason: text 1..500 ?
  immutable couple, weddingAt, contract
  read <- .couple = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'dj']
  insert <- (exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']) and exists roles[.couple, role = 'couple']
  update <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'dj'] or .couple = viewer
  cap 1000
  online only

invariant bookings.read only .couple = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'dj']
invariant bookings.phone read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant bookings.price read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant bookings.deposit read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant bookings.insert only (exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']) and exists roles[.couple, role = 'couple']
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'

mutation provision(principal: principal, role: enum('owner', 'desk', 'dj', 'couple')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- Desk/owner directory of couple and DJ accounts for the create/assign forms.
query coupleAccounts():
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] else NOT_DESK
  return roles where .role = 'couple' last 100 by .principal

query djAccounts():
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] else NOT_DESK
  return roles where .role = 'dj' last 100 by .principal

-- The live events board: staff/DJs read every booking, couples read their own.
-- Row rules scope each viewer; the page is complete for every role.
query board(c: cursor ?):
  return bookings last 50 by .id after c

query booking(id: bookings):
  return bookings[id]

-- Desk opens a booking with the signed-contract scan and the quoted price.
mutation createBooking(couple: principal, coupleName: text 1..120, phone: text 1..40, price: money USD, deposit: money USD, weddingAt: time, contract: image <=10000000, timeline: text <=5000 ?, venueNotes: text <=5000 ?, songRequests: text <=2000 ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] else NOT_DESK
  require exists roles[principal = couple, role = 'couple'] else NOT_COUPLE_ACCOUNT 'The booking must name a couple account.'
  require weddingAt > now else BAD_DATE 'The wedding must be in the future.'
  require deposit <= price else BAD_DEPOSIT 'The deposit cannot exceed the price.'
  return insert bookings { couple, coupleName, phone, price, deposit, weddingAt, contract, timeline, venueNotes, songRequests }

mutation assignDj(booking: bookings, dj: principal):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] else NOT_DESK
  b = bookings[booking] ! else NOT_FOUND
  require exists roles[principal = dj, role = 'dj'] else NOT_DJ_ACCOUNT 'The assignee must hold the DJ role.'
  update bookings[booking] { dj }

-- Desk keeps the run-sheet current.
mutation updateLogistics(booking: bookings, timeline: text 1..5000, venueNotes: text 1..5000):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] else NOT_DESK
  b = bookings[booking] ! else NOT_FOUND
  update bookings[booking] { timeline, venueNotes }

-- The couple keeps draft requests current until the wedding.
mutation updateDraftSongs(booking: bookings, songRequests: text <=2000):
  b = bookings[booking] ! else NOT_FOUND
  require b.couple = viewer else NOT_COUPLE 'Only the booking couple may edit song requests.'
  require now <= b.weddingAt else CLOSED 'The wedding has passed.'
  update bookings[booking] { songRequests }

-- The couple must send the final song list at least 14 days before the wedding.
mutation submitFinalSongs(booking: bookings, songs: text 1..5000):
  b = bookings[booking] ! else NOT_FOUND
  require b.couple = viewer else NOT_COUPLE 'Only the booking couple may send the final song list.'
  require now <= b.weddingAt - 14d else TOO_LATE 'The final song list is due at least 14 days before the wedding.'
  update bookings[booking] { finalSongs: songs }

-- The crew moves the board forward; desk/owner may correct any step.
mutation setStatus(booking: bookings, status: enum('planned', 'packed', 'playing', 'packed_down')):
  b = bookings[booking] ! else NOT_FOUND
  staff = exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  require staff or exists roles[principal = viewer, role = 'dj'] else NOT_CREW 'Only the desk, owner or a DJ may move the board.'
  if not staff:
    require (b.status = 'planned' and status = 'packed') or (b.status = 'packed' and status = 'playing') or (b.status = 'playing' and status = 'packed_down') else BAD_TRANSITION 'DJs move the board one step forward.'
  update bookings[booking] { status }

-- Only the company owner approves a free extra hour, with the reason recorded.
mutation approveExtraHour(booking: bookings, reason: text 1..500):
  b = bookings[booking] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the company owner approves a free extra hour.'
  update bookings[booking] { extraHour: true, extraHourReason: reason }
