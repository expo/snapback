-- Grand Piano Moves: office intake, mover board, customer views, owner control.
use identity password

table roles:
  principal: principal
  role: enum('company_owner', 'office', 'mover', 'customer')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('company_owner', 'office', 'mover', 'customer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

-- One move per piano relocation. Operational columns (photos, stair plan,
-- stops) are visible to assigned trade; contact and money columns stay with
-- the office, the company owner and the move's own customer.
table moves:
  owner: principal
  phone: text 5..20
  insuredValue: money USD
  fee: money USD
  appraisal: image <=10000000
  photos: [image <=10000000] <=4 ?
  stairPlan: text 1..2000
  stops: text 1..1000
  status: enum('booked', 'wrapped', 'loaded', 'delivered') default 'booked'
  scheduledAt: time
  exceptionApproved: bool default false
  exceptionReason: text 1..300 ?
  read <- .owner = viewer or exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'mover']
  read (phone, insuredValue, fee, appraisal) <- .owner = viewer or exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office']
  insert <- (exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner']) and exists roles[.owner, role = 'customer']
  update <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'mover']
  immutable owner
  online only

-- Which movers are booked on a move. The insert rule sees every roster row,
-- so it can check the appointee really holds the mover role.
table assignments:
  move: moves
  mover: principal
  unique move, mover
  immutable move, mover
  read <- exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'mover']
  insert <- (exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner']) and exists roles[.mover, role = 'mover']
  delete <- exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner']
  cap 10 by move
  online only

view crewSize: count assignments by .move
  read <- exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'mover']
  online only

query myRole():
  return roles[viewer]

query staffList(role: enum('company_owner', 'office', 'mover', 'customer'), c: cursor ?):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner'] else NOT_OFFICE
  return roles where .role = role last 50 by .id after c

-- The moving board. Customers see only their own moves; everyone else sees
-- every move (column rules still hide contact and money from movers).
query board(c: cursor ?):
  if exists roles[viewer, role = 'customer']:
    return moves where .owner = viewer last 50 by .id after c
  return moves last 50 by .id after c

query moveDetail(move: moves):
  return moves[move]

query crewOf(move: moves, c: cursor ?):
  return assignments where .move = move last 50 by .id after c

-- The office opens each move with the appraisal scan and the quoted fee,
-- booked for a real customer and a future date.
mutation createMove(owner: principal, phone: text 5..20, insuredValue: money USD, fee: money USD, appraisal: image <=10000000, photos: [image <=10000000] <=4 ?, stairPlan: text 1..2000, stops: text 1..1000, scheduledAt: time):
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner'] else NOT_OFFICE
  require scheduledAt > now else BAD_DATE
  return insert moves { owner, phone, insuredValue, fee, appraisal, photos, stairPlan, stops, scheduledAt }

mutation assignMover(move: moves, mover: principal):
  m = moves[move] ! else NOT_FOUND
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner'] else NOT_OFFICE
  return insert assignments { move, mover }

-- The board walk: booked -> wrapped -> loaded -> delivered. Loading and
-- delivery need a crew of three unless the company owner recorded an
-- exception on the move.
mutation advanceStatus(move: moves):
  m = moves[move] ! else NOT_FOUND
  require exists roles[viewer, role = 'mover'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner'] else NOT_CREW
  require m.status = 'booked' or m.status = 'wrapped' or m.status = 'loaded' else ALREADY_DELIVERED
  next = 'wrapped' if m.status = 'booked' else 'loaded' if m.status = 'wrapped' else 'delivered'
  require next = 'wrapped' or (crewSize[move] ?? 0) >= 3 or m.exceptionApproved else NEED_THIRD_MOVER
  update moves[move] { status: next }
  return null

-- A weather delay may push the date, but at most 60 days past the booked date.
mutation reschedule(move: moves, newAt: time, reason: text 1..200):
  m = moves[move] ! else NOT_FOUND
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner'] else NOT_OFFICE
  require m.status != 'delivered' else ALREADY_DELIVERED
  require newAt > now else BAD_DATE
  require newAt <= m.scheduledAt + 60d else RESCHEDULE_WINDOW
  update moves[move] { scheduledAt: newAt }
  return null

-- Piano photos may arrive after intake; only the office side may attach them.
mutation addPhotos(move: moves, photos: [image <=10000000] 1..4):
  m = moves[move] ! else NOT_FOUND
  require exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner'] else NOT_OFFICE
  require m.status != 'delivered' else ALREADY_DELIVERED
  update moves[move] { photos }
  return null

-- Only the company owner may waive the third mover, with the reason recorded.
mutation approveShortCrew(move: moves, reason: text 1..200):
  m = moves[move] ! else NOT_FOUND
  require exists roles[viewer, role = 'company_owner'] else NOT_OWNER
  require m.status != 'delivered' else ALREADY_DELIVERED
  update moves[move] { exceptionApproved: true, exceptionReason: reason }
  return null

-- Privacy intent, stated apart from the rules they restate.
invariant moves.read only .owner = viewer or exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'mover']
invariant moves.phone read only .owner = viewer or exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office']
invariant moves.insuredValue read only .owner = viewer or exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office']
invariant moves.fee read only .owner = viewer or exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office']
invariant moves.appraisal read only .owner = viewer or exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office']
invariant moves.insert only exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner']
invariant assignments.read only exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'mover']
invariant assignments.insert only exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner']
invariant roles.read only .principal = viewer or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'company_owner']
invariant crewSize.read only exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'office'] or exists roles[viewer, role = 'mover']
