-- Excavator Rental Returns.
--
-- Roles: contractor (sees only own rentals/invoices, pays own bills),
-- yardhand (live yard board, rents to contractors, takes returns, bills damage,
-- services machines), manager (all of that plus: rent to a contractor with an
-- unpaid balance with a recorded reason, waive a damage bill with a reason,
-- add machines). Roles are provisioned by the local operator only.
use identity password

-- Roster: one row per user. Only the local filesystem operator writes it.
table roles:
  principal: principal
  role: enum('contractor', 'yardhand', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  online only

mutation provision(principal: principal, role: enum('contractor', 'yardhand', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR 'Only the branch operator can provision roles.'
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- The yard board: every signed-in roster member sees every machine and its
-- lifecycle status (available -> out -> returned -> serviced -> available).
table machines:
  name: text 3..60
  kind: enum('excavator', 'skidsteer')
  status: enum('available', 'out', 'returned', 'serviced') default 'available'
  dailyPrice: int 1..
  deposit: int 0..
  unique name
  cap 500
  read <- exists roles[viewer]
  insert <- exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  delete <- deny
  online only

-- One rental per machine checkout. Yard staff rent machines to contractors;
-- contractors never write rentals. The rental price and damage deposit are
-- captured at checkout from the machine row.
table rentals:
  machine: machines on delete restrict
  contractor: principal
  dailyPrice: int 1..
  deposit: int 0..
  startsAt: time
  dueAt: time
  returnedAt: time ?
  checkoutNote: text <=500 ?
  damageFound: bool default false
  damageNote: text <=500 ?
  depositStatus: enum('held', 'applied', 'refunded') default 'held'
  overrideReason: text <=200 ?
  immutable machine, contractor, dailyPrice, deposit, startsAt, dueAt
  cap 10000
  read <- .contractor = viewer or exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  delete <- deny
  online only

-- Walkaround photos, checkout and return. They follow their rental's readers.
-- Checkout (departure) photos belong to the rental's departure inspection:
-- only the branch manager may replace or remove them.
table rentalPhotos:
  rental: rentals on delete cascade
  kind: enum('checkout', 'return')
  photo: image <=10000000
  takenAt: time default now
  immutable rental
  cap 10000
  read through .rental
  insert <- exists rentals[.rental, contractor = viewer] or exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'manager']
  delete <- exists roles[principal = viewer, role = 'manager']
  online only

-- Departure walkaround inspections: exactly one record per rental, holding
-- the machine's starting photos. The photos themselves stay in rentalPhotos
-- (kind 'checkout'); the inspection is the record that groups them, so every
-- pre-existing checkout photo survives the migration untouched.
table departureInspections:
  rental: rentals on delete cascade
  createdAt: time default now
  unique rental
  immutable rental
  cap 10000
  read through .rental
  insert <- exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  update <- deny
  delete <- deny
  online only

-- Bills: the rental charge, a late-day charge when a machine comes back more
-- than one day late, and damage bills. At most one of each kind per rental.
table invoices:
  rental: rentals on delete restrict
  contractor: principal
  kind: enum('rental', 'late', 'damage')
  amount: int 1..
  status: enum('unpaid', 'paid', 'waived') default 'unpaid'
  createdAt: time default now
  waiveReason: text <=200 ?
  unique rental, kind
  immutable rental, contractor, kind, amount, createdAt
  cap 10000
  read <- .contractor = viewer or exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  update (old, next) <- old.contractor = viewer and next.status = 'paid' or exists roles[principal = viewer, role = 'manager']
  delete <- deny
  online only

-- Unpaid balance per contractor, for the rent gate below.
view unpaidOwed: sum invoices of .amount where .status = 'unpaid' by .contractor
  read <- .contractor = viewer or exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  online only

query yardBoard(c: cursor ?):
  require exists roles[viewer] else NO_ROLE 'Your account has no yard role yet.'
  return machines first 50 by .id after c

query rentalsBoard(c: cursor ?):
  require exists roles[viewer] else NO_ROLE 'Your account has no yard role yet.'
  if exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']:
    return rentals first 50 by .id after c
  return rentals where .contractor = viewer first 50 by .id after c

query rentalDetail(rental: rentals):
  return rentals[rental]

query rentalInvoices(rental: rentals, c: cursor ?):
  return invoices where .rental = rental first 50 by .id after c

query invoiceBoard(c: cursor ?):
  require exists roles[viewer] else NO_ROLE 'Your account has no yard role yet.'
  if exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']:
    return invoices first 50 by .id after c
  return invoices where .contractor = viewer first 50 by .id after c

query rentalPhotosOf(rental: rentals, c: cursor ?):
  return rentalPhotos where .rental = rental first 50 by .id after c

query departureInspectionOf(rental: rentals):
  return departureInspections[rental]

query departurePhotosOf(inspection: departureInspections, c: cursor ?):
  return rentalPhotos where .rental = inspection.rental and .kind = 'checkout' first 50 by .id after c

query unpaidBalance():
  owed = unpaidOwed[viewer]
  return owed ?? 0

-- Staff rent a machine to a contractor. Only the branch manager may rent to a
-- contractor with an unpaid balance, recording the reason. Every new rental
-- includes a departure inspection holding the starting walkaround photos.
mutation rent(machine: machines, contractor: principal, days: int 1..30, overrideReason: text <=200 ?, checkoutPhoto: image <=10000000, checkoutNote: text <=500 ?):
  isManager = exists roles[principal = viewer, role = 'manager']
  isStaff = isManager or exists roles[principal = viewer, role = 'yardhand']
  require isStaff else NOT_STAFF 'Only yard staff can check out machines.'
  m = machines[machine] ! else NOT_FOUND
  require m.status = 'available' else NOT_AVAILABLE 'This machine is not available to rent.'
  owed = unpaidOwed[contractor] ?? 0
  if owed > 0:
    require overrideReason != null and isManager else UNPAID_BALANCE 'This contractor has an unpaid balance; only the branch manager may rent to them, recording a reason.'
  r = insert rentals { machine, contractor, dailyPrice: m.dailyPrice, deposit: m.deposit, startsAt: now, dueAt: now + days * 1d, overrideReason, checkoutNote }
  insert departureInspections { rental: r.id }
  insert invoices { rental: r.id, contractor, kind: 'rental', amount: m.dailyPrice * days }
  insert rentalPhotos { rental: r.id, kind: 'checkout', photo: checkoutPhoto }
  update machines[machine] { status: 'out' }
  return r

-- Idempotent catch-up: give a rental its departure inspection when it has
-- none (rentals written before inspections existed, or while v1 was live).
mutation ensureDepartureInspection(rental: rentals):
  isStaff = exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  require isStaff else NOT_STAFF 'Only yard staff can record departure inspections.'
  r = rentals[rental] ! else NOT_FOUND
  existing = departureInspections[rental]
  if existing != null:
    return existing
  return insert departureInspections { rental } if absent ?? departureInspections[rental]

-- Only the branch manager may replace or remove photos from a saved
-- departure inspection; contractors and yard hands may not.
mutation replaceDeparturePhoto(photo: rentalPhotos, newPhoto: image <=10000000):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the branch manager can change departure photos.'
  p = rentalPhotos[photo] ! else NOT_FOUND
  require p.kind = 'checkout' else WRONG_KIND 'Only departure (checkout) photos can be replaced here.'
  update rentalPhotos[photo] { photo: newPhoto }
  return null

mutation removeDeparturePhoto(photo: rentalPhotos):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the branch manager can remove departure photos.'
  p = rentalPhotos[photo] ! else NOT_FOUND
  require p.kind = 'checkout' else WRONG_KIND 'Only departure (checkout) photos can be removed here.'
  delete rentalPhotos[photo]
  return null

-- Staff take a machine back. Returned more than one day late, the contractor
-- is charged another day at the rental's daily price.
mutation returnMachine(rental: rentals, damageFound: bool, damageNote: text <=500 ?, returnPhoto: image <=10000000 ?):
  isStaff = exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  require isStaff else NOT_STAFF 'Only yard staff can take returns.'
  r = rentals[rental] ! else NOT_FOUND
  require r.returnedAt = null else ALREADY_RETURNED 'This rental was already returned.'
  update rentals[rental] { returnedAt: now, damageFound, damageNote }
  update machines[r.machine] { status: 'returned' }
  if returnPhoto != null:
    insert rentalPhotos { rental: r.id, kind: 'return', photo: returnPhoto }
  if now > r.dueAt + 1d:
    insert invoices { rental: r.id, contractor: r.contractor, kind: 'late', amount: r.dailyPrice }
  return null

-- Staff bill damage found on the return walkaround. Only within seven days of
-- return; afterwards the deposit is refunded instead (see settleDeposits).
mutation billDamage(rental: rentals, amount: int 1..):
  isStaff = exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  require isStaff else NOT_STAFF 'Only yard staff can bill damage.'
  r = rentals[rental] ! else NOT_FOUND
  rt = r.returnedAt
  require rt != null else NOT_RETURNED 'The machine has not been returned yet.'
  require now <= rt + 7d else BILL_WINDOW_PASSED 'Damage must be billed within seven days of return; the deposit is refunded instead.'
  require not exists invoices[r.id, 'damage'] else ALREADY_BILLED 'Damage was already billed for this rental.'
  insert invoices { rental: r.id, contractor: r.contractor, kind: 'damage', amount }
  update rentals[rental] { depositStatus: 'applied' }
  return null

-- Only the branch manager can waive a bill, recording the reason. Waiving a
-- damage bill releases the deposit back to refunded.
mutation waiveInvoice(invoice: invoices, reason: text 1..200):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the branch manager can waive a bill.'
  inv = invoices[invoice] ! else NOT_FOUND
  require inv.status = 'unpaid' else ALREADY_SETTLED 'This invoice is already settled.'
  update invoices[invoice] { status: 'waived', waiveReason: reason }
  if inv.kind = 'damage':
    update rentals[inv.rental] { depositStatus: 'refunded' }
  return null

-- Contractors pay their own bills.
mutation payInvoice(invoice: invoices):
  inv = invoices[invoice] ! else NOT_FOUND
  require inv.contractor = viewer else NOT_YOURS 'You can only pay your own invoices.'
  require inv.status = 'unpaid' else ALREADY_SETTLED 'This invoice is already settled.'
  update invoices[invoice] { status: 'paid' }
  return null

-- Yard hands move returned machines through service back to available.
mutation markServiced(machine: machines):
  isStaff = exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  require isStaff else NOT_STAFF 'Only yard staff can service machines.'
  m = machines[machine] ! else NOT_FOUND
  require m.status = 'returned' else WRONG_STATUS 'Only a returned machine can be marked serviced.'
  update machines[machine] { status: 'serviced' }
  return null

mutation markAvailable(machine: machines):
  isStaff = exists roles[principal = viewer, role = 'yardhand'] or exists roles[principal = viewer, role = 'manager']
  require isStaff else NOT_STAFF 'Only yard staff can release machines.'
  m = machines[machine] ! else NOT_FOUND
  require m.status = 'serviced' else WRONG_STATUS 'Only a serviced machine can be made available.'
  update machines[machine] { status: 'available' }
  return null

-- Only the branch manager adds machines to the yard.
mutation createMachine(name: text 3..60, kind: enum('excavator', 'skidsteer'), dailyPrice: int 1.., deposit: int 0..):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the branch manager can add machines.'
  return insert machines { name, kind, status: 'available', dailyPrice, deposit }

-- Every night: deposits held past seven days after return with no damage bill
-- are refunded. Billing or waiving already flips held rows away first.
job settleDeposits():
  for r in rentals:
    if r.returnedAt != null and r.depositStatus = 'held':
      if r.returnedAt + 7d < now:
        if not exists invoices[r.id, 'damage']:
          update rentals[r.id] { depositStatus: 'refunded' }
schedule settleDaily every 1d at 03:00: settleDeposits

-- Privacy and authority intent, stated apart from the enforcing rules above.
-- Contractors see only their own rentals and invoices; yard hands and the
-- branch manager see the whole board.
invariant rentals.read only .contractor = viewer or exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant rentals.insert only exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant rentals.update only exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant invoices.read only .contractor = viewer or exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant invoices.insert only exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant invoices.waiveInvoice only exists roles[viewer, role = 'manager']
invariant invoices.payInvoice only .contractor = viewer
invariant machines.read only exists roles[viewer]
invariant machines.insert only exists roles[viewer, role = 'manager']
invariant machines.update only exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
invariant rentalPhotos.read only .rental.contractor = viewer or exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant rentalPhotos.insert only exists rentals[.rental, contractor = viewer] or exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant rentalPhotos.replaceDeparturePhoto only exists roles[viewer, role = 'manager']
invariant rentalPhotos.removeDeparturePhoto only exists roles[viewer, role = 'manager']
invariant departureInspections.read only .rental.contractor = viewer or exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant departureInspections.insert only exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant departureInspections.ensureDepartureInspection only exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
invariant unpaidOwed.read only .contractor = viewer or exists roles[viewer, role = 'yardhand'] or exists roles[viewer, role = 'manager']
