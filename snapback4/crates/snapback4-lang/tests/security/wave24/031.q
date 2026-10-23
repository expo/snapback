-- Grease Trap Servicing.
--
-- Roles: restaurant (owns one restaurant profile; sees only its own services
-- and invoices), driver (live route board; moves pumped -> inspected ->
-- closed), planner (route planner; registers restaurants, schedules stops,
-- logs pumps with photo + price, creates invoices), manager (operations
-- manager; the only role that may approve a service extension with a reason
-- and a new due date), city (city compliance contact; reads overdue flags).
-- Roles are provisioned by the local operator; signup alone grants nothing.
use identity password

table roles:
  principal: principal
  role: enum('restaurant', 'driver', 'planner', 'manager', 'city')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('restaurant', 'driver', 'planner', 'manager', 'city')):
  require viewer = 'service:operator' else NOT_OPERATOR 'Only the operator may grant roles.'
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- One profile per restaurant account. Staff (planner, manager, driver) and
-- the city contact may read every profile so the route board and compliance
-- work; the restaurant owner reads only its own row (table rule filters).
table restaurants:
  owner: principal
  name: text 1..80
  address: text 1..200
  lastPumpAt: time ?
  nextDueAt: time ?
  unique owner
  immutable owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'city']
  insert <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  online only

-- A service stop. The planner schedules it (dueAt) and later logs the pump
-- with a required photo and price; drivers move pumped -> inspected ->
-- closed. owner denormalizes the restaurant owner so the read rule needs no
-- reference hop. dueAt is immutable so the overdue sweep has a stable index.
table services:
  restaurant: restaurants
  owner: principal
  status: enum('scheduled', 'pumped', 'inspected', 'closed')
  photo: image <=5000000 ?
  price: money USD ?
  pumpedAt: time ?
  scheduledAt: time default now
  dueAt: time
  immutable restaurant, owner, scheduledAt, dueAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'city']
  insert <- exists roles[principal = viewer, role = 'planner']
  update <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'driver']
  online only

-- Invoices are written by the planner once a service is closed. Only the
-- owning restaurant, the planner and the manager may read them.
table invoices:
  restaurant: restaurants
  service: services
  owner: principal
  amount: money USD
  issuedAt: time default now
  immutable restaurant, service, owner, amount
  read <- .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'planner']
  online only

-- Extensions are approved only by the operations manager, with a reason and
-- a new due date. The new date is also stored on the restaurant profile.
table extensions:
  restaurant: restaurants
  owner: principal
  reason: text 1..500
  newDueAt: time
  approvedBy: principal
  approvedAt: time default now
  immutable restaurant, owner, reason, newDueAt, approvedBy
  read <- .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'city']
  insert <- exists roles[principal = viewer, role = 'manager']
  online only

-- Overdue flags are written only by the nightly sweep (as the system), never
-- by users. The owning restaurant, staff and the city contact may read them.
table complianceFlags:
  restaurant: restaurants
  service: services
  owner: principal
  flaggedAt: time default now
  note: text 1..200
  unique service
  immutable restaurant, service, owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'city']
  online only

query myRestaurant():
  return restaurants[owner = viewer]

query allRestaurants(c: cursor ?):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'city'] else NOT_STAFF 'Staff or the city contact only.'
  return restaurants first 50 by .id after c

query restaurantServices(restaurant: restaurants, c: cursor ?):
  r = restaurants[restaurant] ! else NOT_FOUND
  return services where .restaurant = r.id first 50 by .id after c

query routeBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF 'Drivers, planners or managers only.'
  return services first 50 by .id after c

query overdueServices(c: cursor ?):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'city'] else NOT_STAFF 'Planners, managers or the city contact only.'
  return services where .status != 'closed' and .dueAt < now first 50 by .id after c

query restaurantInvoices(restaurant: restaurants, c: cursor ?):
  r = restaurants[restaurant] ! else NOT_FOUND
  return invoices where .restaurant = r.id first 50 by .id after c

query extensionsFor(restaurant: restaurants, c: cursor ?):
  r = restaurants[restaurant] ! else NOT_FOUND
  return extensions where .restaurant = r.id first 50 by .id after c

query flagList(c: cursor ?):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'city'] else NOT_STAFF 'Planners, managers or the city contact only.'
  return complianceFlags first 50 by .id after c

query myFlags(c: cursor ?):
  return complianceFlags where .owner = viewer first 50 by .id after c

mutation registerRestaurant(owner: principal, name: text 1..80, address: text 1..200):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF 'Planners or managers only.'
  return insert restaurants { owner, name, address }

mutation scheduleService(restaurant: restaurants, dueAt: time):
  require exists roles[principal = viewer, role = 'planner'] else NOT_PLANNER 'Route planners only.'
  r = restaurants[restaurant] ! else NOT_FOUND
  require dueAt > now else BAD_DUE 'The due date must be in the future.'
  require dueAt <= now + 120d else DUE_TOO_FAR 'The due date must be within 120 days.'
  return insert services { restaurant: r.id, owner: r.owner, status: 'scheduled', dueAt }

mutation logPump(service: services, photo: image <=5000000, price: money USD):
  require exists roles[principal = viewer, role = 'planner'] else NOT_PLANNER 'Route planners only.'
  s = services[service] ! else NOT_FOUND
  require s.status = 'scheduled' else BAD_STATUS 'Only a scheduled stop can be pumped.'
  require now <= s.dueAt + 14d else TOO_LATE 'Pumping is closed more than 14 days after the due date.'
  update services[service] { photo, price, pumpedAt: now, status: 'pumped' }
  update restaurants[s.restaurant] { lastPumpAt: now, nextDueAt: now + 90d }
  return null

mutation inspectService(service: services):
  require exists roles[principal = viewer, role = 'driver'] else NOT_DRIVER 'Drivers only.'
  s = services[service] ! else NOT_FOUND
  require s.status = 'pumped' else BAD_STATUS 'Only a pumped stop can be inspected.'
  update services[service] { status: 'inspected' }
  return null

mutation closeService(service: services):
  require exists roles[principal = viewer, role = 'driver'] else NOT_DRIVER 'Drivers only.'
  s = services[service] ! else NOT_FOUND
  require s.status = 'inspected' else BAD_STATUS 'Only an inspected stop can be closed.'
  update services[service] { status: 'closed' }
  return null

mutation createInvoice(service: services, amount: money USD):
  require exists roles[principal = viewer, role = 'planner'] else NOT_PLANNER 'Route planners only.'
  s = services[service] ! else NOT_FOUND
  require s.status = 'closed' else NOT_CLOSED 'Invoices need a closed service.'
  return insert invoices { restaurant: s.restaurant, service: s.id, owner: s.owner, amount }

mutation approveExtension(restaurant: restaurants, reason: text 1..500, newDueAt: time):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the operations manager may approve an extension.'
  r = restaurants[restaurant] ! else NOT_FOUND
  require newDueAt > now else BAD_DATE 'The new due date must be in the future.'
  require newDueAt <= now + 180d else DUE_TOO_FAR 'The new due date must be within 180 days.'
  insert extensions { restaurant: r.id, owner: r.owner, reason, newDueAt, approvedBy: viewer }
  update restaurants[restaurant] { nextDueAt: newDueAt }
  return null

-- A stop that is still open more than 14 days after its due date is flagged
-- for the city compliance contact. The sweep window ends at periodEnd - 14d
-- so one run catches up after missed periods; the unique key on service
-- keeps reruns from writing twice.
job flagOverdue(periodStart: time, periodEnd: time):
  for s in services where .dueAt >= periodEnd - 200d and .dueAt < periodEnd - 14d by .dueAt:
    if s.status != 'closed':
      if not exists complianceFlags[service = s.id]:
        insert complianceFlags { restaurant: s.restaurant, service: s.id, owner: s.owner, note: 'Service is more than 14 days overdue.' }

schedule flagDaily every 1d at 08:00: flagOverdue

-- Privacy intent, stated independently from the rules above.
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant roles.provision only viewer = 'service:operator'
invariant restaurants.read only .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'city']
invariant services.read only .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'city']
invariant invoices.read only .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
invariant extensions.read only .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'city']
invariant complianceFlags.read only .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'city']
invariant extensions.insert only exists roles[principal = viewer, role = 'manager']
