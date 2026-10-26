use identity password

table roles:
  principal: principal
  role: enum('workshop', 'driver', 'dispatcher', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table workshops:
  owner: principal
  name: text 2..100
  address: text 5..240
  standing: bool
  lastDelivery: time ?
  restockDue: time
  immutable owner
  read <- .owner = viewer or exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'driver'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'dispatcher']
  update <- exists roles[viewer, role = 'dispatcher']
  online only

table deliveries:
  workshop: workshops
  owner: principal
  workshopName: text 2..100
  driver: principal
  scheduledAt: time
  status: enum('scheduled', 'loaded', 'delivered', 'invoiced')
  photo: image <=5000000 ?
  priceCents: int 1..10000000 ?
  deliveredAt: time ?
  paid: bool default false
  emergencyReason: text 10..500 ?
  approvedBy: principal ?
  approvedAt: time ?
  immutable workshop, owner, workshopName, driver, scheduledAt, emergencyReason, approvedBy, approvedAt
  read <- .owner = viewer or exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'driver'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'driver'] or exists roles[viewer, role = 'manager']
  online only

invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
invariant workshops.read only .owner = viewer or exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'driver'] or exists roles[viewer, role = 'manager']
invariant deliveries.read only .owner = viewer or exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'driver'] or exists roles[viewer, role = 'manager']
invariant deliveries.approveEmergency only exists roles[viewer, role = 'manager']
invariant deliveries always .status = 'scheduled' or .status = 'loaded' or (.photo != null and .priceCents != null and .deliveredAt != null)

mutation provision(principal: principal, role: enum('workshop', 'driver', 'dispatcher', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

fn staff():
  return exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'driver'] or exists roles[viewer, role = 'manager']
fn pastDue(workshop: workshops):
  if staff():
    return exists deliveries where .workshop = workshop and .paid = false and .deliveredAt != null and .deliveredAt < now - 30d
  return exists deliveries where .owner = viewer and .workshop = workshop and .paid = false and .deliveredAt != null and .deliveredAt < now - 30d

query myRole():
  return roles[viewer]
query roster(c: cursor ?):
  require exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager'] else STAFF_ONLY
  return roles last 100 by .id after c
query workshopList(c: cursor ?):
  if staff():
    return workshops last 50 by .id after c
  return workshops where .owner = viewer last 50 by .id after c
query workshopDetail(workshop: workshops):
  w = workshops[workshop] ! else NOT_FOUND
  return { workshop: w, pastDue: pastDue(workshop), overdue: w.standing and now > w.restockDue }
query deliveryList(c: cursor ?):
  if staff():
    return deliveries last 50 by .id after c
  return deliveries where .owner = viewer last 50 by .id after c
query deliveryDetail(delivery: deliveries):
  return deliveries[delivery] ! else NOT_FOUND

mutation createWorkshop(owner: principal, name: text 2..100, address: text 5..240, standing: bool):
  require exists roles[viewer, role = 'dispatcher'] else DISPATCHER_ONLY
  require exists roles[owner, role = 'workshop'] else WORKSHOP_ACCOUNT_REQUIRED
  return insert workshops { owner, name, address, standing, restockDue: now + 14d }

mutation scheduleDelivery(workshop: workshops, driver: principal, scheduledAt: time):
  require exists roles[viewer, role = 'dispatcher'] else DISPATCHER_ONLY
  w = workshops[workshop] ! else NOT_FOUND
  require exists roles[driver, role = 'driver'] else DRIVER_REQUIRED
  require scheduledAt >= now - 1m else PAST_SCHEDULE
  require not pastDue(workshop) else CREDIT_HOLD 'An unpaid delivery is older than 30 days. Account manager approval is required.'
  require not w.standing or scheduledAt <= w.restockDue else RESTOCK_DEADLINE 'Standing orders must be restocked within 14 days. An overdue restock requires an account manager emergency approval.'
  return insert deliveries { workshop, owner: w.owner, workshopName: w.name, driver, scheduledAt, status: 'scheduled' }

mutation approveEmergency(workshop: workshops, driver: principal, reason: text 10..500):
  require exists roles[viewer, role = 'manager'] else MANAGER_ONLY
  w = workshops[workshop] ! else NOT_FOUND
  require exists roles[driver, role = 'driver'] else DRIVER_REQUIRED
  return insert deliveries { workshop, owner: w.owner, workshopName: w.name, driver, scheduledAt: now, status: 'scheduled', emergencyReason: reason, approvedBy: viewer, approvedAt: now }

mutation loadDelivery(delivery: deliveries):
  d = deliveries[delivery] ! else NOT_FOUND
  require exists roles[viewer, role = 'driver'] and d.driver = viewer else ASSIGNED_DRIVER_ONLY
  require d.status = 'scheduled' else BAD_STATUS
  require now >= d.scheduledAt else TOO_EARLY
  require d.approvedBy != null or not pastDue(d.workshop) else CREDIT_HOLD
  update deliveries[delivery] { status: 'loaded' }
  return deliveries[delivery]

mutation logDelivery(delivery: deliveries, photo: image <=5000000, priceCents: int 1..10000000):
  require exists roles[viewer, role = 'dispatcher'] else DISPATCHER_ONLY
  d = deliveries[delivery] ! else NOT_FOUND
  require d.status = 'loaded' else BAD_STATUS
  require d.approvedBy != null or not pastDue(d.workshop) else CREDIT_HOLD
  w = workshops[d.workshop] ! else NOT_FOUND
  require d.approvedBy != null or not w.standing or now <= w.restockDue else RESTOCK_DEADLINE 'The standing restock deadline passed. An account manager must approve an emergency delivery.'
  update deliveries[delivery] { status: 'delivered', photo, priceCents, deliveredAt: now }
  update workshops[d.workshop] { lastDelivery: now, restockDue: now + 14d }
  return deliveries[delivery]

mutation invoiceDelivery(delivery: deliveries):
  require exists roles[viewer, role = 'dispatcher'] else DISPATCHER_ONLY
  d = deliveries[delivery] ! else NOT_FOUND
  require d.status = 'delivered' else BAD_STATUS
  update deliveries[delivery] { status: 'invoiced' }
  return deliveries[delivery]

mutation markPaid(delivery: deliveries):
  require exists roles[viewer, role = 'manager'] else MANAGER_ONLY
  d = deliveries[delivery] ! else NOT_FOUND
  require d.status = 'invoiced' and not d.paid else BAD_STATUS
  update deliveries[delivery] { paid: true }
  return deliveries[delivery]
