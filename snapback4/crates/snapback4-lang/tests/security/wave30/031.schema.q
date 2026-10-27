-- Cooling Tower Cleanings.
-- Roles: planner (route planner), technician, engineer (building engineer),
-- manager (operations manager). Roster is operator-provisioned; signup alone
-- grants no role. Engineers are bound to exactly one building.
use identity password

table roles:
  principal: principal
  role: enum('planner', 'technician', 'engineer', 'manager')
  building: buildings ?
  unique principal
  immutable principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  online only

table buildings:
  name: text 1..80
  address: text 1..200
  read <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .id] or viewer = 'service:operator'
  insert <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'manager']
  delete <- deny
  online only

table towers:
  building: buildings
  name: text 1..80
  location: text 1..200 ?
  lastCleanedAt: time ?
  nextDueAt: time
  cap 100 by building
  immutable building
  read <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .building]
  insert <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'technician']
  delete <- deny
  online only

table cleanings:
  tower: towers
  building: buildings
  status: enum('scheduled', 'drained', 'scrubbed', 'disinfected') default 'scheduled'
  photo: image <=10000000 ?
  price: money USD ?
  scheduledAt: time default now
  completedAt: time ?
  note: text <=500 ?
  cap 500 by tower
  immutable tower, building
  read <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .building]
  insert <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'technician']
  delete <- deny
  online only

table invoices:
  building: buildings
  cleaning: cleanings
  amount: money USD
  issuedAt: time default now
  unique cleaning else ALREADY_INVOICED 'This cleaning already has an invoice.'
  cap 500 by building
  immutable building, cleaning, amount
  read <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .building]
  insert <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  update <- deny
  delete <- deny
  online only

table extensions:
  building: buildings
  reason: text 1..500
  newDueDate: time
  approvedAt: time default now
  approvedBy: principal
  cap 100 by building
  immutable building, reason, newDueDate, approvedBy
  read <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .building]
  insert <- exists roles[principal = viewer, role = 'manager']
  update <- deny
  delete <- deny
  online only

-- Spec: an engineer sees only their own building; a manager approves extensions.
-- The local operator provisions roles and may read buildings to validate assignments.
invariant buildings.read only exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .id] or viewer = 'service:operator'
invariant towers.read only exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .building]
invariant cleanings.read only exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .building]
invariant invoices.read only exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .building]
invariant extensions.read only exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'engineer', building = .building]
invariant roles.read only .principal = viewer
invariant roles.insert only viewer = 'service:operator'
invariant buildings.insert only exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
invariant towers.insert only exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
invariant cleanings.insert only exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
invariant invoices.insert only exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
invariant extensions.insert only exists roles[principal = viewer, role = 'manager']

query myRole():
  return roles[viewer]

query myBuilding():
  me = roles[viewer] ! else NO_ROLE 'Sign in with a provisioned account.'
  require me.role = 'engineer' else NOT_ENGINEER 'Only a building engineer has an assigned building.'
  require me.building != null else NO_BUILDING 'This engineer has no assigned building.'
  return buildings[me.building]

query buildingsList(c: cursor ?):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF 'Only operations staff list all buildings.'
  return buildings last 50 by .id after c

query towersOf(building: buildings, c: cursor ?):
  me = roles[viewer] ! else NO_ROLE 'Sign in with a provisioned account.'
  if me.role = 'engineer':
    require me.building != null else NO_BUILDING 'This engineer has no assigned building.'
    require me.building = building else NOT_YOUR_BUILDING 'Engineers see only their own building.'
  else:
    require me.role = 'planner' or me.role = 'technician' or me.role = 'manager' else NO_STAFF 'Only operations staff and the assigned engineer see towers.'
  return towers where .building = building last 50 by .id after c

query towerStatus(tower: towers):
  t = towers[tower] ! else NOT_FOUND
  due = t.nextDueAt
  return { tower: t, lastCleanedAt: t.lastCleanedAt, due, overdue: now > due, flagged: now > due + 14d }

query flaggedTowers(building: buildings, c: cursor ?):
  me = roles[viewer] ! else NO_ROLE 'Sign in with a provisioned account.'
  if me.role = 'engineer':
    require me.building != null else NO_BUILDING 'This engineer has no assigned building.'
    require me.building = building else NOT_YOUR_BUILDING 'Engineers see only their own building.'
  else:
    require me.role = 'planner' or me.role = 'technician' or me.role = 'manager' else NO_STAFF 'Only operations staff and the assigned engineer see flags.'
  return towers where .building = building and .nextDueAt < now - 14d last 50 by .nextDueAt after c

query cleaningsOf(building: buildings, c: cursor ?):
  me = roles[viewer] ! else NO_ROLE 'Sign in with a provisioned account.'
  if me.role = 'engineer':
    require me.building != null else NO_BUILDING 'This engineer has no assigned building.'
    require me.building = building else NOT_YOUR_BUILDING 'Engineers see only their own building.'
  else:
    require me.role = 'planner' or me.role = 'technician' or me.role = 'manager' else NO_STAFF 'Only operations staff and the assigned engineer see cleanings.'
  return cleanings where .building = building last 50 by .id after c

query routeBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] else NOT_BOARD 'Only operations staff see the route board.'
  return cleanings last 50 by .scheduledAt after c

query invoicesOf(building: buildings, c: cursor ?):
  me = roles[viewer] ! else NO_ROLE 'Sign in with a provisioned account.'
  if me.role = 'engineer':
    require me.building != null else NO_BUILDING 'This engineer has no assigned building.'
    require me.building = building else NOT_YOUR_BUILDING 'Engineers see only their own building.'
  else:
    require me.role = 'planner' or me.role = 'technician' or me.role = 'manager' else NO_STAFF 'Only operations staff and the assigned engineer see invoices.'
  return invoices where .building = building last 50 by .id after c

query extensionsOf(building: buildings, c: cursor ?):
  me = roles[viewer] ! else NO_ROLE 'Sign in with a provisioned account.'
  if me.role = 'engineer':
    require me.building != null else NO_BUILDING 'This engineer has no assigned building.'
    require me.building = building else NOT_YOUR_BUILDING 'Engineers see only their own building.'
  else:
    require me.role = 'planner' or me.role = 'technician' or me.role = 'manager' else NO_STAFF 'Only operations staff and the assigned engineer see extensions.'
  return extensions where .building = building last 50 by .approvedAt after c

mutation provision(principal: principal, role: enum('planner', 'technician', 'engineer', 'manager'), building: buildings ?):
  require viewer = 'service:operator' else NOT_OPERATOR 'Only the local operator provisions roles.'
  if role = 'engineer':
    require building != null else BUILDING_REQUIRED 'An engineer must be assigned a building.'
    b = buildings[building] ! else NOT_FOUND 'The assigned building does not exist.'
  return upsert roles[principal] { principal, role, building }

mutation createBuilding(name: text 1..80, address: text 1..200):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] else NOT_PLANNER 'Only the route planner or operations manager adds buildings.'
  return insert buildings { name, address }

mutation createTower(building: buildings, name: text 1..80, location: text 1..200 ?):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] else NOT_PLANNER 'Only the route planner or operations manager adds towers.'
  b = buildings[building] ! else NOT_FOUND
  return insert towers { building, name, location, nextDueAt: now + 180d }

mutation scheduleStop(tower: towers):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] else NOT_PLANNER 'Only the route planner or operations manager schedules stops.'
  t = towers[tower] ! else NOT_FOUND
  return insert cleanings { tower, building: t.building, status: 'scheduled' }

mutation logCleaning(tower: towers, photo: image <=10000000, price: money USD, note: text <=500 ?):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] else NOT_PLANNER 'Only the route planner or operations manager logs cleanings.'
  t = towers[tower] ! else NOT_FOUND
  require price >= 0 else BAD_PRICE 'The service price cannot be negative.'
  c = insert cleanings { tower, building: t.building, status: 'disinfected', photo, price, note, completedAt: now }
  update towers[t] { lastCleanedAt: now, nextDueAt: now + 180d }
  return c

mutation advanceStop(cleaning: cleanings, to: enum('scheduled', 'drained', 'scrubbed', 'disinfected'), photo: image <=10000000 ?, price: money USD ?):
  require exists roles[principal = viewer, role = 'technician'] else NOT_TECHNICIAN 'Only a technician moves stops on the route board.'
  c = cleanings[cleaning] ! else NOT_FOUND
  if c.status = 'scheduled':
    require to = 'drained' else BAD_TRANSITION 'A scheduled stop moves to drained.'
  elif c.status = 'drained':
    require to = 'scrubbed' else BAD_TRANSITION 'A drained stop moves to scrubbed.'
  elif c.status = 'scrubbed':
    require to = 'disinfected' else BAD_TRANSITION 'A scrubbed stop moves to disinfected.'
  else:
    require false else BAD_TRANSITION 'This stop is already disinfected.'
  if to = 'disinfected':
    require photo != null else PHOTO_REQUIRED 'A disinfected stop needs a basin photo.'
    require price != null else PRICE_REQUIRED 'A disinfected stop needs a service price.'
    require price >= 0 else BAD_PRICE 'The service price cannot be negative.'
    update cleanings[c] { status: to, photo, price, completedAt: now }
    update towers[c.tower] { lastCleanedAt: now, nextDueAt: now + 180d }
  else:
    update cleanings[c] { status: to }
  return cleanings[c]

mutation issueInvoice(cleaning: cleanings, amount: money USD):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] else NOT_PLANNER 'Only the route planner or operations manager issues invoices.'
  c = cleanings[cleaning] ! else NOT_FOUND
  require c.status = 'disinfected' else NOT_COMPLETE 'Only a disinfected cleaning can be invoiced.'
  require amount >= 0 else BAD_AMOUNT 'The invoice amount cannot be negative.'
  return insert invoices { building: c.building, cleaning, amount }

mutation approveExtension(building: buildings, reason: text 1..500, newDueDate: time):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the operations manager approves extensions.'
  b = buildings[building] ! else NOT_FOUND
  require newDueDate > now else BAD_DATE 'The new due date must be in the future.'
  ext = insert extensions { building, reason, newDueDate, approvedBy: viewer }
  page = towers where .building = building first 100 by .id
  for t in page:
    if t.nextDueAt < newDueDate:
      update towers[t] { nextDueAt: newDueDate }
  return ext
