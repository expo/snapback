-- Boatyard Haulout Stands.
-- Roles: owner, yard_hand, contractor, manager. Provisioned by the operator.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'yard_hand', 'contractor', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'yard_hand']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'yard_hand', 'contractor', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- Boats. Owners read only their own; yard hands and the manager read the
-- whole yard; contractors read only boats they are approved to work on.
table boats:
  owner: principal
  name: text 1..80
  balance: money USD default 0
  immutable owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'yard_hand'] or exists approvals[boat = .id, contractor = viewer]
  insert <- .owner = viewer or exists roles[principal = viewer, role = 'manager']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'yard_hand']
  online only

mutation registerBoat(name: text 1..80):
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'owner' or r.role = 'manager' else NOT_OWNER
  owner = viewer if r.role = 'owner' else viewer
  return insert boats { owner, name, balance: 0 }

mutation createBoatForOwner(owner: principal, name: text 1..80):
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' else NOT_MANAGER
  return insert boats { owner, name, balance: 0 }

mutation invoiceBoat(boat: boats, amount: money USD):
  b = boats[boat] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' else NOT_MANAGER
  update boats[boat] { balance: b.balance + amount }
  return null

mutation payBoat(boat: boats, amount: money USD):
  b = boats[boat] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require b.owner = viewer or r.role = 'manager' else NOT_YOUR_BOAT
  require b.balance >= amount else OVERPAY
  update boats[boat] { balance: b.balance - amount }
  return null

query myBoats(c: cursor ?):
  return boats where .owner = viewer first 50 by .id after c

query allBoats(c: cursor ?):
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' else NOT_YARD
  return boats first 50 by .id after c

query boatDetail(boat: boats):
  return boats[boat] ! else NOT_FOUND

-- A haul-out: the crew photographs the hull when lifted and logs the stand.
table haulouts:
  boat: boats
  immutable boat
  hauledAt: time default now
  stand: text 1..40
  photo: image <=5000000 ?
  released: bool default false
  releaseReason: text <=500 ?
  releasedAt: time ?
  read through .boat
  insert <- exists roles[principal = viewer, role = 'yard_hand'] or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'yard_hand'] or exists roles[principal = viewer, role = 'manager']
  online only

mutation logHaulout(boat: boats, stand: text 1..40, photo: image <=5000000 ?, hauledAt: time ?):
  b = boats[boat] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' else NOT_YARD
  at = hauledAt ?? now
  require at <= now else FUTURE_HAULOUT 'A haul-out cannot be logged in the future.'
  active = count(haulouts where .boat = boat and .released = false)
  require active = 0 else ALREADY_ON_STANDS 'This boat is already on stands.'
  return insert haulouts { boat, hauledAt: at, stand, photo }

query hauloutsForBoat(boat: boats, c: cursor ?):
  b = boats[boat] ! else NOT_FOUND
  return haulouts where .boat = boat last 20 by .hauledAt after c

query liftQueue(c: cursor ?):
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' else NOT_YARD
  return haulouts where .released = false first 50 by .hauledAt after c

-- A boat on stands more than 180 days moves to the long-term storage rate.
query storageRate(boat: boats):
  b = boats[boat] ! else NOT_FOUND
  old = count(haulouts where .boat = boat and .released = false and .hauledAt < now - 180d)
  return { rate: 'long-term' if old > 0 else 'standard', oldStays: old }

-- Launches must be booked at least 14 days ahead.
table launches:
  boat: boats
  immutable boat
  launchAt: time
  bookedAt: time default now
  bookedBy: principal
  read through .boat
  insert <- exists boats[.boat, owner = viewer] or exists roles[principal = viewer, role = 'manager']
  online only

mutation bookLaunch(boat: boats, launchAt: time):
  b = boats[boat] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require b.owner = viewer or r.role = 'manager' else NOT_YOUR_BOAT
  require launchAt >= now + 14d else TOO_SOON 'Launches must be booked at least 14 days ahead.'
  return insert launches { boat, launchAt, bookedBy: viewer }

query launchesForBoat(boat: boats, c: cursor ?):
  b = boats[boat] ! else NOT_FOUND
  return launches where .boat = boat first 20 by .launchAt after c

query launchList(c: cursor ?):
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' else NOT_YARD
  return launches where .launchAt >= now first 50 by .launchAt after c

-- Work orders. Contractors see only boats they are approved to work on
-- (through the boat's read rule) and may update status of assigned work.
table workOrders:
  boat: boats
  immutable boat
  title: text 1..120
  details: text <=2000 ?
  welding: bool default false
  weldingApproved: bool default false
  approvalReason: text <=500 ?
  assignee: principal ?
  status: enum('open', 'in_progress', 'done') default 'open'
  read through .boat
  insert <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'yard_hand']
  update (old, next) <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'yard_hand'] or old.assignee = viewer
  online only

mutation createWorkOrder(boat: boats, title: text 1..120, details: text <=2000 ?, welding: bool ?):
  b = boats[boat] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' else NOT_YARD
  return insert workOrders { boat, title, details, welding: welding ?? false }

mutation assignWorkOrder(workOrder: workOrders, contractor: principal):
  w = workOrders[workOrder] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' else NOT_YARD
  c = roles[contractor] ! else NOT_CONTRACTOR 'No such contractor.'
  require c.role = 'contractor' else NOT_CONTRACTOR 'Assignee must hold the contractor role.'
  update workOrders[workOrder] { assignee: contractor }
  return null

mutation setWorkStatus(workOrder: workOrders, status: enum('open', 'in_progress', 'done')):
  w = workOrders[workOrder] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' or w.assignee = viewer else NOT_ASSIGNED
  require status != 'done' or not w.welding or w.weldingApproved else NEEDS_WELD_APPROVAL 'Welding near other hulls needs the yard manager\'s approval first.'
  update workOrders[workOrder] { status }
  return null

-- Only the yard manager may approve welding near other hulls, with the
-- reason recorded.
mutation approveWelding(workOrder: workOrders, reason: text 1..500):
  w = workOrders[workOrder] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' else NOT_MANAGER
  require w.welding else NOT_WELDING 'This work order involves no welding.'
  update workOrders[workOrder] { weldingApproved: true, approvalReason: reason }
  return null

query workForBoat(boat: boats, c: cursor ?):
  b = boats[boat] ! else NOT_FOUND
  return workOrders where .boat = boat first 50 by .id after c

query assignedWork(c: cursor ?):
  return workOrders where .assignee = viewer first 50 by .id after c

-- Contractor approvals: which boats an outside contractor may work on.
table approvals:
  boat: boats
  contractor: principal
  unique boat, contractor else ALREADY_APPROVED
  immutable boat, contractor
  read <- .contractor = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'yard_hand']
  insert <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'yard_hand']
  delete <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'yard_hand']
  online only

mutation assignContractor(boat: boats, contractor: principal):
  b = boats[boat] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' else NOT_YARD
  c = roles[contractor] ! else NOT_CONTRACTOR 'No such contractor.'
  require c.role = 'contractor' else NOT_CONTRACTOR 'Only a contractor can be approved for a boat.'
  return insert approvals { boat, contractor }

mutation removeContractor(approval: approvals):
  a = approvals[approval] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' else NOT_YARD
  delete approvals[approval]
  return null

query myApprovals(c: cursor ?):
  return approvals where .contractor = viewer first 50 by .id after c { id, boat }

-- Release. Only the yard manager may release a boat with an unpaid balance,
-- with the reason recorded.
mutation releaseBoat(haulout: haulouts, reason: text 1..500 ?):
  h = haulouts[haulout] ! else NOT_FOUND
  b = boats[h.boat] ! else NOT_FOUND
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'yard_hand' else NOT_YARD
  require h.released = false else ALREADY_RELEASED
  require b.balance = 0 or r.role = 'manager' else UNPAID_NEEDS_MANAGER 'Only the yard manager may release a boat with an unpaid balance.'
  require b.balance = 0 or reason != null else REASON_REQUIRED 'Releasing with an unpaid balance needs a recorded reason.'
  update haulouts[haulout] { released: true, releaseReason: reason, releasedAt: now }
  return null
