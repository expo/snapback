-- Outboard Motor Repairs.
-- A marine engine shop logs outboard motors with condition photos and a
-- quoted repair price. Each motor has an identification card holding its
-- serial plate photos. The boat owner approves the quote within 14 days or
-- the motor is returned unrepaired. A picked-up motor carries a 90-day
-- warranty from pickup for the same fault. Mechanics move motors along the
-- bench board (diagnosis -> repair -> tank test -> test run). Only the shop
-- owner may approve a whole powerhead replacement with an agreed extra cost.
-- Only the counter clerk and shop owner may change identification cards.

use identity password

-- Roster: one row per person. Only the local operator (service:operator)
-- grants roles; signup alone grants nothing.
table roles:
  principal: principal
  role: enum('boatOwner', 'clerk', 'mechanic', 'shopOwner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  online only

mutation provision(principal: principal, role: enum('boatOwner', 'clerk', 'mechanic', 'shopOwner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

-- Spec privacy intent, enforced independently of the rules above: a boat
-- owner sees only their own motors and claims; counter, bench and shop staff
-- see the whole board; roster rows are private except to the operator.
invariant motors.read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'shopOwner']
invariant idCards.read only .motor.owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'shopOwner']
invariant idCards.updateIdCard only exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'shopOwner']
invariant motors always exists idCards[motor = .id]
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant warrantyClaims.read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'shopOwner']

table motors:
  owner: principal
  clerk: principal
  make: text 1..80
  serial: text 1..40
  fault: text 1..300
  conditionPhoto: image <=5000000
  quotePrice: money USD
  quotedAt: time
  quoteStatus: enum('pending', 'approved', 'returnedUnrepaired') default 'pending'
  approvedAt: time ?
  pickedUpAt: time ?
  stage: enum('intake', 'diagnosis', 'repair', 'tankTest', 'testRun', 'readyForPickup', 'pickedUp', 'returnedUnrepaired') default 'intake'
  powerheadApproved: bool default false
  powerheadExtra: money USD ?
  immutable owner, clerk, make, serial, fault, quotedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'shopOwner']
  insert <- exists roles[principal = viewer, role = 'clerk']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'shopOwner']
  delete <- deny
  online only

-- Each motor has exactly one identification card holding its serial plate
-- photos. Condition photos, the quote and everything else stay on the motor.
-- Only the counter clerk and the shop owner may change cards.
table idCards:
  motor: motors on delete restrict
  serialPhoto: image <=5000000
  unique motor
  immutable motor
  read through .motor
  insert <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'shopOwner']
  update <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'shopOwner']
  delete <- deny
  online only
extract idCards from motors via motor: {serialPhoto: serialPhoto}

table warrantyClaims:
  motor: motors
  owner: principal
  fault: text 1..300
  createdAt: time default now
  immutable motor, owner, fault
  read <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'shopOwner']
  insert <- .owner = viewer
  update <- deny
  delete <- deny
  online only

-- Owners read only their own motors; staff read everything via the bench board.
query myMotors(c: cursor ?):
  return motors where .owner = viewer last 50 by .id after c

query benchBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'shopOwner'] else NOT_STAFF
  return motors last 50 by .id after c

query motorDetail(motor: motors):
  return motors[motor]

query warrantyFor(motor: motors, c: cursor ?):
  return warrantyClaims where .motor = motor last 50 by .id after c

-- The identification card attached to a motor's repair.
query cardFor(motor: motors, c: cursor ?):
  return idCards where .motor = motor last 50 by .id after c

-- The counter clerk logs a motor with its condition photo, its serial plate
-- photo and the quoted price. The serial plate photo starts the motor's
-- identification card; the argument shape is unchanged so old clients keep
-- working.
mutation logMotor(owner: principal, make: text 1..80, serial: text 1..40, fault: text 1..300, conditionPhoto: image <=5000000, serialPhoto: image <=5000000, quotePrice: money USD):
  require exists roles[principal = viewer, role = 'clerk'] else NOT_CLERK
  m = insert motors { owner, clerk: viewer, make, serial, fault, conditionPhoto, quotePrice, quotedAt: now }
  insert idCards { motor: m, serialPhoto }
  return m

-- The counter clerk or the shop owner replaces the serial plate photo on a
-- motor's identification card. Mechanics and motor owners may not.
mutation updateIdCard(card: idCards, serialPhoto: image <=5000000):
  c = idCards[card] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'shopOwner'] else NOT_AUTHORIZED
  update idCards[card] { serialPhoto }
  return null

-- The boat owner approves the quote within 14 days of the quote.
mutation approveQuote(motor: motors):
  m = motors[motor] ! else NOT_FOUND
  require m.owner = viewer else NOT_OWNER
  require m.quoteStatus = 'pending' else QUOTE_NOT_PENDING
  require now <= m.quotedAt + 14d else QUOTE_EXPIRED
  update motors[motor] { quoteStatus: 'approved', approvedAt: now, stage: 'diagnosis' }
  return null

-- Mechanics (or the shop owner) walk the bench board one stage at a time.
mutation advanceStage(motor: motors, stage: enum('repair', 'tankTest', 'testRun', 'readyForPickup')):
  m = motors[motor] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'shopOwner'] else NOT_MECHANIC
  require m.quoteStatus = 'approved' else QUOTE_NOT_APPROVED
  ok = (stage = 'repair' and m.stage = 'diagnosis') or (stage = 'tankTest' and m.stage = 'repair') or (stage = 'testRun' and m.stage = 'tankTest') or (stage = 'readyForPickup' and m.stage = 'testRun')
  require ok else BAD_TRANSITION
  update motors[motor] { stage }
  return null

-- Counter staff hand the repaired motor to its owner; the warranty clock starts.
mutation markPickedUp(motor: motors):
  m = motors[motor] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'shopOwner'] else NOT_CLERK
  require m.stage = 'readyForPickup' else BAD_STAGE
  update motors[motor] { stage: 'pickedUp', pickedUpAt: now }
  return null

-- Counter staff return a motor whose quote was never approved in time.
mutation returnUnrepaired(motor: motors):
  m = motors[motor] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'shopOwner'] else NOT_CLERK
  require m.quoteStatus = 'pending' else QUOTE_NOT_PENDING
  require now > m.quotedAt + 14d else QUOTE_STILL_OPEN
  update motors[motor] { quoteStatus: 'returnedUnrepaired', stage: 'returnedUnrepaired' }
  return null

-- Only the shop owner may approve a whole powerhead replacement, recording
-- the agreed extra cost.
mutation approvePowerhead(motor: motors, extra: money USD):
  m = motors[motor] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'shopOwner'] else NOT_SHOP_OWNER
  update motors[motor] { powerheadApproved: true, powerheadExtra: extra }
  return null

-- The boat owner reports the same fault again within 90 days of pickup.
mutation claimWarranty(motor: motors, fault: text 1..300):
  m = motors[motor] ! else NOT_FOUND
  require m.owner = viewer else NOT_OWNER
  require m.stage = 'pickedUp' else NOT_PICKED_UP
  require fault = m.fault else FAULT_MISMATCH
  require now <= (m.pickedUpAt ?? 0) + 90d else WARRANTY_EXPIRED
  return insert warrantyClaims { motor, owner: viewer, fault }

-- Nightly sweep: quotes pending past their 14-day window go back unrepaired.
job expireQuotes():
  for m in motors:
    if m.quoteStatus = 'pending':
      if m.quotedAt + 14d < now:
        update motors[m.id] { quoteStatus: 'returnedUnrepaired', stage: 'returnedUnrepaired' }

schedule expireDaily every 1d at 03:00: expireQuotes
