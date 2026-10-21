use identity password

-- Operator grants are local filesystem authority, never a public signup option.
table roles:
  principal: principal
  role: enum('guest', 'attendant', 'runner', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('guest', 'attendant', 'runner', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myAccount():
  r = roles[viewer]
  return { principal: viewer, role: r.role if r != null else 'guest' }

table profiles:
  principal: principal
  name: text 1..80
  handle: text 3..40 format handle
  unique principal
  unique handle
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  insert <- .principal = viewer
  update <- .principal = viewer
  online only

query myProfile():
  return profiles[viewer]

mutation saveProfile(name: text 1..80, handle: text 3..40 format handle):
  require not exists roles[viewer, role = 'attendant'] and not exists roles[viewer, role = 'runner'] and not exists roles[viewer, role = 'manager'] else ONLY_GUEST
  return upsert profiles[viewer] { principal: viewer, name, handle }

query guestDirectory():
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAND
  return profiles first 200 by .id

table tickets:
  guest: principal
  guestName: text 1..80
  plate: text 2..16
  vehicle: text 2..100
  ticketCode: text 8..64
  -- Stable asset homes preserve image ids across rename and source rollback.
  photoFront: image <=5000000 ?
  photoRear: image <=5000000 ?
  arrivalConditionRevision: int 0.. default 0
  droppedAt: time default now
  state: enum('parked', 'requested', 'retrieving', 'ready', 'picked_up') default 'parked'
  lot: enum('main', 'long_term') default 'main'
  chargeCents: int 0.. default 0
  billedDays: int 0.. default 0
  requestedAt: time ?
  runner: principal ?
  pickedUpAt: time ?
  immutable guest, guestName, plate, vehicle, ticketCode, droppedAt
  read <- .guest = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'runner'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager']
  update (old, next) <- exists roles[viewer, role = 'manager'] or ((old.guest = viewer or exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'runner']) and next.photoFront = old.photoFront and next.photoRear = old.photoRear and next.arrivalConditionRevision = old.arrivalConditionRevision)
  online only

-- API rename is a projection over the original asset homes: no re-upload or rebinding.
shape arrivalTicket = { id, guest, guestName, plate, vehicle, photoFront, photoRear, droppedAt, state, lot, chargeCents, billedDays, requestedAt, runner, pickedUpAt, arrivalConditionFront: .photoFront, arrivalConditionRear: .photoRear, arrivalConditionRevision }
shape arrivalGuestTicket = { *, arrivalConditionFront: .photoFront, arrivalConditionRear: .photoRear }

query myTickets():
  return tickets where .guest = viewer last 100 by .id arrivalGuestTicket

query ticketDetail(ticket: tickets):
  t = tickets[ticket]
  if t != null and t.guest = viewer:
    return tickets[ticket] arrivalGuestTicket
  return tickets[ticket] arrivalTicket

query standTickets():
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAND
  return tickets last 200 by .id arrivalTicket

query retrievalQueue():
  require exists roles[viewer, role = 'runner'] or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'attendant'] else NOT_STAFF
  return tickets where .state = 'requested' or .state = 'retrieving' or .state = 'ready' first 200 by .requestedAt arrivalTicket

mutation dropOff(guest: principal, plate: text 2..16, vehicle: text 2..100, ticketCode: text 8..64, photoFront: image <=5000000, photoRear: image <=5000000):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAND
  p = profiles[guest] ! else GUEST_NOT_REGISTERED
  return insert tickets { guest, guestName: p.name, plate, vehicle, ticketCode, photoFront, photoRear }

-- New callers use arrival condition names; old dropOff stays as a compatibility wrapper.
mutation issueTicket(guest: principal, plate: text 2..16, vehicle: text 2..100, ticketCode: text 8..64, arrivalConditionFront: image <=5000000 ?, arrivalConditionRear: image <=5000000 ?):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAND
  p = profiles[guest] ! else GUEST_NOT_REGISTERED
  t = insert tickets { guest, guestName: p.name, plate, vehicle, ticketCode, photoFront: arrivalConditionFront, photoRear: arrivalConditionRear }
  return t arrivalGuestTicket

mutation setArrivalConditionPhotos(ticket: tickets, arrivalConditionFront: image <=5000000 ?, arrivalConditionRear: image <=5000000 ?):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  t = tickets[ticket] ! else NOT_FOUND
  update tickets[ticket] { photoFront: arrivalConditionFront, photoRear: arrivalConditionRear, arrivalConditionRevision: t.arrivalConditionRevision + 1 }
  return tickets[ticket] arrivalTicket

mutation requestCar(ticket: tickets):
  t = tickets[ticket] ! else NOT_FOUND
  require t.guest = viewer else NOT_YOUR_TICKET
  require t.state = 'parked' else BAD_STATE
  days = (now - t.droppedAt - 24h - 1) / 1d + 1 if now > t.droppedAt + 24h else 0
  update tickets[ticket] { state: 'requested', requestedAt: now, lot: 'long_term' if days > 0 else t.lot, billedDays: days, chargeCents: days * 2500 }

mutation takeRetrieval(ticket: tickets):
  require exists roles[viewer, role = 'runner'] else NOT_RUNNER
  t = tickets[ticket] ! else NOT_FOUND
  require t.state = 'requested' else BAD_STATE
  update tickets[ticket] { state: 'retrieving', runner: viewer }

mutation markReady(ticket: tickets):
  require exists roles[viewer, role = 'runner'] else NOT_RUNNER
  t = tickets[ticket] ! else NOT_FOUND
  require t.state = 'retrieving' else BAD_STATE
  require t.runner = viewer else NOT_ASSIGNED_RUNNER
  update tickets[ticket] { state: 'ready' }

mutation pickup(ticket: tickets, ticketCode: text 8..64):
  require exists roles[viewer, role = 'attendant'] or exists roles[viewer, role = 'manager'] else NOT_STAND
  t = tickets[ticket] ! else NOT_FOUND
  require t.state = 'ready' else BAD_STATE
  require t.ticketCode = ticketCode else TICKET_REQUIRED
  days = (now - t.droppedAt - 24h - 1) / 1d + 1 if now > t.droppedAt + 24h else 0
  update tickets[ticket] { state: 'picked_up', pickedUpAt: now, billedDays: days, chargeCents: days * 2500, lot: 'long_term' if days > 0 else t.lot }

table releases:
  ticket: tickets
  manager: principal
  idShown: text 4..120
  reason: text 10..500
  at: time default now
  immutable ticket, manager, idShown, reason, at
  read <- exists roles[viewer, role = 'manager']
  insert <- .manager = viewer and exists roles[viewer, role = 'manager']
  online only

query releaseLog():
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  return releases last 200 by .id

mutation releaseWithoutTicket(ticket: tickets, idShown: text 4..120, reason: text 10..500):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  t = tickets[ticket] ! else NOT_FOUND
  require t.state = 'ready' else BAD_STATE
  days = (now - t.droppedAt - 24h - 1) / 1d + 1 if now > t.droppedAt + 24h else 0
  insert releases { ticket, manager: viewer, idShown, reason }
  update tickets[ticket] { state: 'picked_up', pickedUpAt: now, billedDays: days, chargeCents: days * 2500, lot: 'long_term' if days > 0 else t.lot }

table claims:
  ticket: tickets
  guest: principal
  description: text 10..2000
  filedAt: time default now
  decision: enum('pending', 'approved', 'rejected') default 'pending'
  reviewer: principal ?
  reviewNote: text 10..1000 ?
  reviewedAt: time ?
  unique ticket
  immutable ticket, guest, description, filedAt
  read <- .guest = viewer or exists roles[viewer, role = 'manager']
  insert <- .guest = viewer and .ticket.guest = viewer
  update <- exists roles[viewer, role = 'manager']
  online only

query myClaims():
  return claims where .guest = viewer last 100 by .id

query reviewClaims():
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  return claims last 200 by .id

query claimDetail(claim: claims):
  return claims[claim]

mutation fileClaim(ticket: tickets, description: text 10..2000):
  t = tickets[ticket] ! else NOT_FOUND
  require t.guest = viewer else NOT_YOUR_TICKET
  require t.state = 'picked_up' and t.pickedUpAt != null else NOT_PICKED_UP
  require now <= t.pickedUpAt + 24h else CLAIM_WINDOW_CLOSED
  require not exists claims[ticket] else ALREADY_FILED
  return insert claims { ticket, guest: viewer, description }

mutation reviewClaim(claim: claims, decision: enum('approved', 'rejected'), reviewNote: text 10..1000):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  c = claims[claim] ! else NOT_FOUND
  require c.decision = 'pending' else ALREADY_REVIEWED
  t = tickets[c.ticket] ! else NOT_FOUND
  -- Arrival condition evidence is reviewed when present; absence does not block a decision.
  update claims[claim] { decision, reviewer: viewer, reviewNote, reviewedAt: now }

-- Catch up across missed schedule boundaries; picked-up cars stop accruing fees.
job longTermBilling(periodStart: time, periodEnd: time):
  for t in tickets:
    if t.state != 'picked_up' and now > t.droppedAt + 24h:
      days = (now - t.droppedAt - 24h - 1) / 1d + 1
      update tickets[t.id] { lot: 'long_term', billedDays: days, chargeCents: days * 2500 }

schedule longTerm every 1m: longTermBilling



-- spec-worded intent (analysis, from spec+change text only)
invariant tickets.ticketCode read only .guest = viewer
