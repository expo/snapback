-- Band Instrument Rentals.
-- Roles: family (school families renting), desk (rental desk), tech (repair
-- techs), manager (store manager). Roster-provisioned by the local operator.
use identity password

table roles:
  principal: principal
  role: enum('family', 'desk', 'tech', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('family', 'desk', 'tech', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR 'Only the local operator provisions roles.'
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- Public handle directory so the rental desk can address a family's principal.
table directory:
  principal: principal
  handle: text 3..20 format handle
  unique principal
  unique handle else HANDLE_TAKEN 'This handle is already taken.'
  immutable principal
  public 'family handles are discoverable by the rental desk'
  insert <- .principal = viewer
  update <- .principal = viewer
  online only

mutation saveHandle(handle: text 3..20 format handle):
  return upsert directory[principal = viewer] { principal: viewer, handle }

query principalFor(handle: text 3..20 format handle):
  return directory[handle = handle]

-- Instruments the store owns. The catalog is visible to every roster member;
-- only desk/manager edit catalog fields; techs may only advance repair status
-- (other columns must stay equal).
table instruments:
  name: text 1..80
  kind: text 1..40
  serial: text 1..40
  status: enum('available', 'rented', 'returned', 'cleaned', 'repaired', 'ready') default 'available'
  unique serial else SERIAL_TAKEN 'An instrument with this serial is already catalogued.'
  immutable serial
  cap 500
  read <- exists roles[viewer]
  insert <- exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager']
  update (old, next) <- exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] or (exists roles[principal = viewer, role = 'tech'] and old.name = next.name and old.kind = next.kind and old.serial = next.serial)
  online only

-- A rental of one instrument to one family. The desk logs it with a condition
-- photo and the monthly fee. `missed` counts missed payments for recall.
table rentals:
  family: principal
  instrument: instruments
  monthlyFee: money USD
  startAt: time default now
  photo: image <=5000000
  state: enum('active', 'returned', 'refunded', 'recalled', 'purchased') default 'active'
  missed: count payments where .state = 'missed' by rental
  immutable family, instrument, startAt, photo
  cap 5000
  read <- .family = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager']
  update (old, next) <- old.family = viewer or exists roles[viewer]
  online only

-- Payments against a rental: billed as pending, then paid or missed.
table payments:
  rental: rentals
  payer: principal
  amount: money USD
  dueAt: time
  paidAt: time ?
  state: enum('pending', 'paid', 'missed') default 'pending'
  immutable rental, payer, amount, dueAt
  cap 20000
  read <- .payer = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager']
  update (old, next) <- old.payer = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager']
  online only

-- Manager-approved buyout: rental payments applied toward purchase.
table buyouts:
  rental: rentals
  balance: money USD
  approvedBy: principal
  approvedAt: time default now
  unique rental else ALREADY_BOUGHT 'This rental already has an approved buyout.'
  immutable rental, balance, approvedBy, approvedAt
  cap 5000
  read <- exists rentals[.rental, family = viewer] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'manager']
  online only

query catalog(c: cursor ?):
  return instruments first 50 by .id after c

query myRentals(c: cursor ?):
  return rentals where .family = viewer first 50 by .id after c

query rentalDetail(rental: rentals):
  return rentals[rental]

query rentalPayments(rental: rentals, c: cursor ?):
  r = rentals[rental] ! else NOT_FOUND
  require r.family = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'You may only see your own rental payments.'
  return payments where .rental = rental first 50 by .id after c

query shopBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'desk'] else NOT_SHOP 'The shop board is for shop staff.'
  return instruments where .status = 'returned' or .status = 'cleaned' or .status = 'repaired' first 50 by .id after c

query recallList(c: cursor ?):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only the rental desk sees the recall list.'
  return rentals where .state = 'active' and .missed >= 2 first 50 by .id after c

query buyoutFor(rental: rentals):
  r = rentals[rental] ! else NOT_FOUND
  require r.family = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'You may only see your own buyouts.'
  return buyouts where .rental = rental first 10 by .id

query buyoutList(c: cursor ?):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only the rental desk sees all buyouts.'
  return buyouts first 50 by .id after c

query deskRentals(state: enum('active', 'returned', 'refunded', 'recalled', 'purchased') ?, c: cursor ?):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only the rental desk lists all rentals.'
  if state = null:
    return rentals first 50 by .id after c
  return rentals where .state = state first 50 by .id after c

mutation addInstrument(name: text 1..80, kind: text 1..40, serial: text 1..40):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only the rental desk catalogues instruments.'
  return insert instruments { name, kind, serial, status: 'available' }

mutation createRental(family: principal, instrument: instruments, monthlyFee: money USD, photo: image <=5000000, startAt: time ?):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only the rental desk logs rentals.'
  i = instruments[instrument] ! else NOT_FOUND
  require i.status = 'available' or i.status = 'ready' else NOT_AVAILABLE 'This instrument is not available to rent.'
  require monthlyFee >= 1 else BAD_FEE 'The monthly fee must be at least one cent.'
  start = startAt ?? now
  require start <= now else START_IN_FUTURE 'A rental cannot start in the future.'
  require start >= now - 60d else START_TOO_OLD 'A rental cannot start more than 60 days ago.'
  r = insert rentals { family, instrument, monthlyFee, startAt: start, photo, state: 'active' }
  update instruments[instrument] { status: 'rented' }
  return r

mutation requestReturn(rental: rentals):
  r = rentals[rental] ! else NOT_FOUND
  require r.family = viewer else NOT_YOURS 'You may only return your own rental.'
  require r.state = 'active' else NOT_ACTIVE 'This rental is not active.'
  require now <= r.startAt + 30d else RETURN_WINDOW_CLOSED 'Returns for a full refund are due within 30 days of the start.'
  update rentals[rental] { state: 'refunded' }
  return null

mutation intakeReturn(rental: rentals):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only shop staff intake returns.'
  r = rentals[rental] ! else NOT_FOUND
  require r.state = 'refunded' else NOT_REFUNDED 'This rental has no refund awaiting intake.'
  update instruments[r.instrument] { status: 'returned' }
  return null

mutation advanceRepair(instrument: instruments, to: enum('cleaned', 'repaired', 'ready')):
  require exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] else NOT_SHOP 'Only repair techs advance repairs.'
  i = instruments[instrument] ! else NOT_FOUND
  require (i.status = 'returned' and to = 'cleaned') or (i.status = 'cleaned' and to = 'repaired') or (i.status = 'repaired' and to = 'ready') else BAD_TRANSITION 'Repairs move returned to cleaned to repaired to ready.'
  update instruments[instrument] { status: to }
  return null

mutation billPayment(rental: rentals, amount: money USD, dueAt: time):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only the rental desk bills payments.'
  r = rentals[rental] ! else NOT_FOUND
  require r.state = 'active' else NOT_ACTIVE 'This rental is not active.'
  require amount >= 1 else BAD_AMOUNT 'The amount must be at least one cent.'
  return insert payments { rental, payer: r.family, amount, dueAt, state: 'pending' }

mutation payBill(payment: payments):
  p = payments[payment] ! else NOT_FOUND
  require p.state = 'pending' else NOT_PENDING 'This bill is not pending.'
  require p.payer = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'You may only pay your own bills.'
  update payments[payment] { state: 'paid', paidAt: now }
  return null

mutation markMissed(payment: payments):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only the rental desk marks missed payments.'
  p = payments[payment] ! else NOT_FOUND
  require p.state = 'pending' else NOT_PENDING 'This bill is not pending.'
  update payments[payment] { state: 'missed' }
  return null

mutation flagRecall(rental: rentals):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only the rental desk flags recalls.'
  r = rentals[rental] ! else NOT_FOUND
  require r.state = 'active' else NOT_ACTIVE 'This rental is not active.'
  require r.missed >= 2 else NOT_ENOUGH_MISSED 'Recall needs at least two missed payments.'
  update rentals[rental] { state: 'recalled' }
  return null

mutation approvePurchase(rental: rentals, balance: money USD):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the store manager approves purchases.'
  r = rentals[rental] ! else NOT_FOUND
  require r.state = 'active' else NOT_ACTIVE 'This rental is not active.'
  require balance >= 0 else BAD_BALANCE 'The agreed balance cannot be negative.'
  b = insert buyouts { rental, balance, approvedBy: viewer }
  update rentals[rental] { state: 'purchased' }
  return b

-- Spec: only the renting family may return its own rental for a refund.
invariant rentals.requestReturn only .family = viewer
