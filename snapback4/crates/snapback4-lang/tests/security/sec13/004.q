use identity password

-- Roles: owner (company owner), coordinator (case coordinator),
-- packer (crew), family (the downsizing household). Signup grants no role;
-- only the local operator provisions roles (dev/acceptance via devAccounts,
-- staging/production via the operator token).
table roles:
  principal: principal
  role: enum('owner', 'coordinator', 'packer', 'family')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'coordinator', 'packer', 'family')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query whoAmI():
  return viewer

-- A downsizing move. Phone, care needs and price are visible only to the
-- assigned case coordinator and the company owner; every other move reader
-- (family, packers) sees the row with those columns withheld.
table moves:
  family: principal
  coordinator: principal
  address: text 1..200
  moveDate: time
  phone: text 7..30
  read (phone) <- .coordinator = viewer or exists roles[principal = viewer, role = 'owner']
  careNeeds: text 1..2000
  read (careNeeds) <- .coordinator = viewer or exists roles[principal = viewer, role = 'owner']
  price: money USD
  read (price) <- .coordinator = viewer or exists roles[principal = viewer, role = 'owner']
  createdAt: time default now
  immutable family, coordinator
  cap 200 by coordinator
  read <- .family = viewer or .coordinator = viewer or exists roles[principal = viewer, role = 'packer'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']
  update <- .coordinator = viewer or exists roles[principal = viewer, role = 'owner']
  online only

-- Deposit for a move. Only the company owner may change it; cancellation
-- records a reason.
table deposits:
  move: moves
  unique move
  immutable move
  status: enum('pending', 'paid', 'cancelled') default 'pending'
  cancelReason: text 1..500 ?
  read through .move
  insert <- exists moves[.move, coordinator = viewer] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'owner']
  online only

-- Rooms of a move with the crew board stage. Photos ride the row as assets.
table rooms:
  move: moves
  name: text 1..80
  photo: image <=20000000 ?
  stage: enum('sorting', 'packing', 'moving', 'unpacking', 'done') default 'sorting'
  immutable move, name
  cap 30 by move
  read through .move
  insert <- exists moves[.move, coordinator = viewer] or exists roles[principal = viewer, role = 'owner']
  update <- exists moves[.move, coordinator = viewer] or exists roles[principal = viewer, role = 'packer'] or exists roles[principal = viewer, role = 'owner']
  delete <- exists moves[.move, coordinator = viewer] or exists roles[principal = viewer, role = 'owner']
  online only

-- Inventory list entries, one list per room.
table items:
  room: rooms on delete cascade
  label: text 1..200
  quantity: int 1..1000 default 1
  packed: bool default false
  immutable room, label
  cap 200 by room
  read through .room
  insert <- exists roles[principal = viewer, role = 'packer'] or exists roles[principal = viewer, role = 'owner'] or exists moves[.room.move, coordinator = viewer]
  update <- exists roles[principal = viewer, role = 'packer'] or exists roles[principal = viewer, role = 'owner'] or exists moves[.room.move, coordinator = viewer]
  delete <- exists roles[principal = viewer, role = 'packer'] or exists roles[principal = viewer, role = 'owner'] or exists moves[.room.move, coordinator = viewer]
  online only

-- Hazard notes for the crew, attached to the move.
table hazards:
  move: moves
  note: text 1..1000
  reportedAt: time default now
  immutable move, note
  cap 100 by move
  read through .move
  insert <- exists moves[.move, coordinator = viewer] or exists roles[principal = viewer, role = 'packer'] or exists roles[principal = viewer, role = 'owner']
  delete <- exists moves[.move, coordinator = viewer] or exists roles[principal = viewer, role = 'owner']
  online only

-- The final settling-in visit, due within ten days of the move.
table visits:
  move: moves
  unique move
  immutable move
  scheduledAt: time
  completedAt: time ?
  read through .move
  insert <- exists moves[.move, coordinator = viewer] or exists roles[principal = viewer, role = 'owner']
  update <- exists moves[.move, coordinator = viewer] or exists roles[principal = viewer, role = 'owner']
  online only

-- Role-scoped board: owners and packers see every move, coordinators their
-- own, families only their own.
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'owner']:
    return moves last 50 by .id after c
  if exists roles[principal = viewer, role = 'coordinator']:
    return moves where .coordinator = viewer last 50 by .id after c
  if exists roles[principal = viewer, role = 'packer']:
    return moves last 50 by .id after c
  return moves where .family = viewer last 50 by .id after c

query moveDetail(move: moves):
  return moves[move]

query moveRooms(move: moves, c: cursor ?):
  return rooms where .move = move last 50 by .id after c

query roomItems(room: rooms, c: cursor ?):
  return items where .room = room last 100 by .id after c

query moveHazards(move: moves, c: cursor ?):
  return hazards where .move = move last 50 by .id after c

query moveDeposit(move: moves):
  return deposits[move]

query moveVisit(move: moves):
  return visits[move]

-- The coordinator (or owner) opens a move for a family, quoting the price.
-- The deposit starts pending; rooms follow via addRoom.
mutation openMove(family: principal, address: text 1..200, moveDate: time, phone: text 7..30, careNeeds: text 1..2000, price: money USD):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  m = insert moves { family, coordinator: viewer, address, moveDate, phone, careNeeds, price }
  mid = m.id ! else NOT_FOUND
  insert deposits { move: mid, status: 'pending' }
  return m

mutation updateMove(move: moves, address: text 1..200, phone: text 7..30, careNeeds: text 1..2000, price: money USD, moveDate: time):
  m = moves[move] ! else NOT_FOUND
  require m.coordinator = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  update moves[move] { address, phone, careNeeds, price, moveDate }
  return null

mutation addRoom(move: moves, name: text 1..80, photo: image <=20000000 ?):
  m = moves[move] ! else NOT_FOUND
  require m.coordinator = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  return insert rooms { move, name, photo, stage: 'sorting' }

-- The crew advances a room one step: sorting, packing, moving, unpacking, done.
mutation setRoomStage(room: rooms, stage: enum('sorting', 'packing', 'moving', 'unpacking', 'done')):
  r = rooms[room] ! else NOT_FOUND
  m = moves[r.move] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'packer'] or m.coordinator = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  require r.stage != 'done' else ALREADY_DONE
  next = 'packing' if r.stage = 'sorting' else 'moving' if r.stage = 'packing' else 'unpacking' if r.stage = 'moving' else 'done'
  require stage = next else BAD_STAGE 'Rooms advance one step: sorting, packing, moving, unpacking, done.'
  update rooms[room] { stage }
  return null

mutation addItem(room: rooms, label: text 1..200, quantity: int 1..1000):
  r = rooms[room] ! else NOT_FOUND
  m = moves[r.move] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'packer'] or m.coordinator = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  return insert items { room, label, quantity }

mutation setItemPacked(item: items, packed: bool):
  i = items[item] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'packer'] or exists moves[i.room.move, coordinator = viewer] or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  update items[item] { packed }
  return null

mutation removeItem(item: items):
  delete items[item]
  return null

mutation addHazard(move: moves, note: text 1..1000):
  m = moves[move] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'packer'] or m.coordinator = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  return insert hazards { move, note }

mutation removeHazard(hazard: hazards):
  delete hazards[hazard]
  return null

mutation recordDepositPaid(move: moves):
  d = deposits[move] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  require d.status = 'pending' else BAD_STATUS
  update deposits[move] { status: 'paid' }
  return null

-- Only the company owner can cancel a deposit, with the reason recorded.
mutation cancelDeposit(move: moves, reason: text 1..500):
  d = deposits[move] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  require d.status != 'cancelled' else ALREADY_CANCELLED
  update deposits[move] { status: 'cancelled', cancelReason: reason }
  return null

mutation scheduleVisit(move: moves, scheduledAt: time):
  m = moves[move] ! else NOT_FOUND
  require m.coordinator = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  require scheduledAt <= m.moveDate + 10d else VISIT_WINDOW 'The settling-in visit is due within ten days of the move.'
  if exists visits[move]:
    v = visits[move] ! else NOT_FOUND
    require v.completedAt = null else ALREADY_VISITED
  return upsert visits[move] { move, scheduledAt }

mutation completeVisit(move: moves):
  m = moves[move] ! else NOT_FOUND
  require m.coordinator = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_COORDINATOR
  v = visits[move] ! else NOT_SCHEDULED
  require v.completedAt = null else ALREADY_VISITED
  require now <= m.moveDate + 10d else VISIT_OVERDUE 'The settling-in visit is due within ten days of the move.'
  update visits[move] { completedAt: now }
  return null

-- Privacy intent from the spec. Packers and families read move rows, but the
-- family's phone number, care needs and price stay with the case coordinator
-- and the company owner. Only the owner writes deposits.
invariant moves.read only .family = viewer or .coordinator = viewer or exists roles[principal = viewer, role = 'packer'] or exists roles[principal = viewer, role = 'owner']
invariant moves.phone read only .coordinator = viewer or exists roles[principal = viewer, role = 'owner']
invariant moves.careNeeds read only .coordinator = viewer or exists roles[principal = viewer, role = 'owner']
invariant moves.price read only .coordinator = viewer or exists roles[principal = viewer, role = 'owner']
invariant deposits.update only exists roles[principal = viewer, role = 'owner']
