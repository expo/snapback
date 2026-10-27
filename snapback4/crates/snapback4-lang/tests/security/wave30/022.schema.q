use identity password

table roles:
  principal: principal
  role: enum('assistant', 'owner', 'cutter', 'rider')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or (.principal = viewer and .role = 'rider')
  update <- viewer = 'service:operator'
  online only

table fittings:
  rider: principal
  riderName: text 1..80
  label: text 1..100
  sheet: image <=10000000
  height: int 120..230
  chest: int 50..180
  waist: int 40..180
  inseam: int 40..120
  armor: text 1..1000
  seams: text 1..1000
  phone: text 5..32
  price: int 1..2000000
  deposit: int 0..2000000
  status: enum('measured', 'cut', 'stitched', 'picked-up', 'cancelled') default 'measured'
  openedAt: time default now
  openedBy: principal
  pickedUpAt: time ?
  adjustmentBy: principal ?
  adjustmentAt: time ?
  adjustmentNote: text 1..1000 ?
  retainedBy: principal ?
  retainedAt: time ?
  retentionReason: text 5..1000 ?
  immutable rider, riderName, label, sheet, height, chest, waist, inseam, openedAt, openedBy
  read <- .rider = viewer or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'cutter']
  read (phone, price, deposit, retainedBy, retainedAt, retentionReason) <- exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
  update <- .rider = viewer or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'cutter']
  online only

invariant roles.provision only viewer = 'service:operator'
invariant fittings.read only .rider = viewer or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'cutter']
invariant fittings.phone read only exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
invariant fittings.price read only exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
invariant fittings.deposit read only exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
invariant fittings.retainedBy write only exists roles[viewer, role = 'owner']
invariant fittings.retentionReason write only exists roles[viewer, role = 'owner']
invariant fittings.sheet write only exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']

mutation provision(principal: principal, role: enum('assistant', 'owner', 'cutter', 'rider'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  require len(trim(name)) > 0 else NAME_REQUIRED
  return upsert roles[principal] { principal, role, name }

mutation registerRider(name: text 1..80):
  require not exists roles[viewer] else ALREADY_REGISTERED
  require len(trim(name)) > 0 else NAME_REQUIRED
  return insert roles { principal: viewer, role: 'rider', name }

query me():
  return roles[viewer]

query listRiders(c: cursor ?):
  require exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] else NOT_FRONT_DESK
  return roles where .role = 'rider' last 100 by .id after c

query board(c: cursor ?):
  return fittings last 100 by .id after c

query fitting(fitting: fittings):
  return fittings[fitting]

mutation openFitting(rider: principal, label: text 1..100, sheet: image <=10000000, height: int 120..230, chest: int 50..180, waist: int 40..180, inseam: int 40..120, armor: text 1..1000, seams: text 1..1000, phone: text 5..32, price: int 1..2000000, deposit: int 0..2000000):
  require exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] else NOT_FRONT_DESK
  r = roles[principal = rider] ! else RIDER_NOT_FOUND
  require r.role = 'rider' else NOT_RIDER
  require deposit <= price else DEPOSIT_EXCEEDS_PRICE
  return insert fittings { rider, riderName: r.name, label, sheet, height, chest, waist, inseam, armor, seams, phone, price, deposit, openedBy: viewer }

mutation updateNotes(fitting: fittings, armor: text 1..1000, seams: text 1..1000):
  require exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'cutter'] else NOT_WORKSHOP
  f = fittings[fitting] ! else NOT_FOUND
  require f.status != 'cancelled' and f.status != 'picked-up' else CLOSED
  update fittings[fitting] { armor, seams }
  return null

mutation advanceFitting(fitting: fittings):
  require exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'cutter'] else NOT_WORKSHOP
  f = fittings[fitting] ! else NOT_FOUND
  require f.status = 'measured' or f.status = 'cut' else INVALID_TRANSITION
  if f.status = 'measured':
    update fittings[fitting] { status: 'cut' }
  else:
    update fittings[fitting] { status: 'stitched' }
  return null

mutation pickup(fitting: fittings):
  require exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] else NOT_FRONT_DESK
  f = fittings[fitting] ! else NOT_FOUND
  require f.status = 'stitched' else INVALID_TRANSITION
  update fittings[fitting] { status: 'picked-up', pickedUpAt: now }
  return null

mutation cancel(fitting: fittings):
  f = fittings[fitting] ! else NOT_FOUND
  require f.rider = viewer or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] else NOT_ALLOWED
  require f.status != 'picked-up' and f.status != 'cancelled' else CLOSED
  update fittings[fitting] { status: 'cancelled' }
  return null

mutation retainDeposit(fitting: fittings, reason: text 5..1000):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  f = fittings[fitting] ! else NOT_FOUND
  require len(trim(reason)) >= 5 else REASON_REQUIRED
  require f.status = 'cancelled' else NOT_CANCELLED
  require f.retainedBy = null else ALREADY_APPROVED
  require (f.deposit ?? 0) > 0 else NO_DEPOSIT
  update fittings[fitting] { retainedBy: viewer, retainedAt: now, retentionReason: reason }
  return null

mutation requestAdjustment(fitting: fittings, note: text 1..1000):
  f = fittings[fitting] ! else NOT_FOUND
  require f.rider = viewer or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] else NOT_ALLOWED
  require f.status = 'picked-up' and f.pickedUpAt != null else NOT_PICKED_UP
  require now <= f.pickedUpAt + 30d else ADJUSTMENT_EXPIRED
  require f.adjustmentAt = null else ALREADY_REQUESTED
  update fittings[fitting] { adjustmentAt: now, adjustmentBy: viewer, adjustmentNote: note }
  return null
