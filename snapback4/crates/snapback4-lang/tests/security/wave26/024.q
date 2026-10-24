-- Billiard Table Relocations.
-- Roles: surveyor, mover, client, manager (operations manager).
-- A surveyor opens each move with table/slate/stairway photos plus the quoted
-- price. Movers see photos, slate measurements and access notes, but never the
-- client's phone number, insured value or price: those columns are readable
-- only by surveyors and the operations manager. Clients see only their own
-- moves and service visits. The board moves surveyed -> moved -> leveled.
-- A re-leveling visit is due within 60 days of the move. Only the operations
-- manager may approve free new cloth, with the reason recorded.
use identity password

table roles:
  principal: principal
  role: enum('surveyor', 'mover', 'client', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'surveyor'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('surveyor', 'mover', 'client', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table moves:
  client: principal
  surveyor: principal
  pickup: text 1..200
  dropoff: text 1..200
  accessNotes: text <=2000
  slateLengthMm: int 200..3000
  slateWidthMm: int 200..2000
  slateThickMm: int 10..100
  photoTable: text <=500 ?
  photoSlate: text <=500 ?
  photoStair: text <=500 ?
  phone: text 4..30
  insuredCents: int 0..100000000
  priceCents: int 0..100000000
  status: enum('surveyed', 'moved', 'leveled') default 'surveyed'
  surveyedAt: time default now
  movedAt: time ?
  leveledAt: time ?
  relevelDueAt: time ?
  freeCloth: bool default false
  clothReason: text <=500 ?
  immutable client, surveyor, surveyedAt
  read <- .client = viewer or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'mover'] or exists roles[principal = viewer, role = 'manager']
  read (phone, insuredCents, priceCents) <- exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager']
  insert <- (exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager']) and exists roles[principal = .client, role = 'client']
  update <- exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'mover'] or exists roles[principal = viewer, role = 'manager']
  online only

table visits:
  move: moves
  client: principal
  kind: enum('relevel', 'service')
  visitedAt: time
  notes: text <=1000 ?
  recordedBy: principal
  immutable move, client, kind, visitedAt, recordedBy
  read <- .client = viewer or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'mover'] or exists roles[principal = viewer, role = 'manager']
  insert <- (exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager']) and .client = .move.client and .recordedBy = viewer
  online only

query board(c: cursor ?):
  return moves first 50 by .id after c

query myMoves(c: cursor ?):
  return moves where .client = viewer after c first 50 by .id

query moveDetail(move: moves):
  m = moves[move] ! else NOT_FOUND
  return m

query visitsForMove(move: moves, c: cursor ?):
  return visits where .move = move after c first 50 by .id

query overdueMoves(c: cursor ?):
  return moves where .status = 'moved' and .relevelDueAt < now after c first 50 by .id

query clients(c: cursor ?):
  require exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return roles where .role = 'client' after c first 50 by .id

mutation createMove(client: principal, pickup: text 1..200, dropoff: text 1..200, accessNotes: text <=2000, slateLengthMm: int 200..3000, slateWidthMm: int 200..2000, slateThickMm: int 10..100, photoTable: text <=500 ?, photoSlate: text <=500 ?, photoStair: text <=500 ?, phone: text 4..30, insuredCents: int 0..100000000, priceCents: int 0..100000000):
  require exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager'] else NOT_SURVEYOR 'Only a surveyor or the operations manager can open a move.'
  require exists roles[principal = client, role = 'client'] else NOT_CLIENT 'The move client must hold the client role.'
  return insert moves { client, surveyor: viewer, pickup, dropoff, accessNotes, slateLengthMm, slateWidthMm, slateThickMm, photoTable, photoSlate, photoStair, phone, insuredCents, priceCents }

mutation markMoved(move: moves):
  require exists roles[principal = viewer, role = 'mover'] or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF 'Only staff can advance a move.'
  m = moves[move] ! else NOT_FOUND
  require m.status = 'surveyed' else BAD_STATUS 'Only a surveyed move can be marked moved.'
  at = now
  update moves[m] { status: 'moved', movedAt: at, relevelDueAt: at + 60d }
  return null

mutation markLeveled(move: moves):
  require exists roles[principal = viewer, role = 'mover'] or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF 'Only staff can advance a move.'
  m = moves[move] ! else NOT_FOUND
  require m.status = 'moved' else BAD_STATUS 'Only a moved table can be marked leveled.'
  update moves[m] { status: 'leveled', leveledAt: now }
  return null

mutation recordVisit(move: moves, kind: enum('relevel', 'service'), visitedAt: time, notes: text <=1000 ?):
  require exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF 'Only a surveyor or the operations manager can record a visit.'
  m = moves[move] ! else NOT_FOUND
  require m.status != 'surveyed' else NOT_MOVED_YET 'The table must be moved before a visit is recorded.'
  require visitedAt <= (m.movedAt ?? 0) + 60d else VISIT_WINDOW_CLOSED 'Service visits are due within 60 days of the move.'
  return insert visits { move, client: m.client, kind, visitedAt, notes, recordedBy: viewer }

mutation approveFreeCloth(move: moves, reason: text 1..500):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the operations manager can approve free new cloth.'
  m = moves[move] ! else NOT_FOUND
  update moves[m] { freeCloth: true, clothReason: reason }
  return null

-- Privacy intent, stated separately from enforcement.
invariant moves.read only .client = viewer or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'mover'] or exists roles[principal = viewer, role = 'manager']
invariant moves.phone read only exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager']
invariant moves.insuredCents read only exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager']
invariant moves.priceCents read only exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager']
invariant moves.insert only exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager']
invariant moves.approveFreeCloth only exists roles[principal = viewer, role = 'manager']
invariant visits.read only .client = viewer or exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'mover'] or exists roles[principal = viewer, role = 'manager']
invariant visits.insert only exists roles[principal = viewer, role = 'surveyor'] or exists roles[principal = viewer, role = 'manager']
