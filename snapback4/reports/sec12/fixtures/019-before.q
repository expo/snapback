-- Pet Relocation Flights.
-- Roles: owner (company owner), coordinator, handler, pet_owner.
use identity password
use personas alice, bob, carol, dave, erin, frank, grace, heidi

table roles:
  principal: principal
  role: enum('owner', 'coordinator', 'handler', 'pet_owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'owner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

table pets:
  owner: principal
  name: text 1..80
  species: enum('dog', 'cat')
  immutable owner
  read <- .owner = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler']
  insert <- .owner = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  update <- .owner = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  delete <- .owner = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  online only

table moves:
  pet: pets
  owner: principal
  crateSize: enum('S', 'M', 'L', 'XL')
  flight: text 1..120
  feedingNotes: text <=500
  status: enum('booked', 'crated', 'in_flight', 'delivered') default 'booked'
  certScan: image <=10000000
  certIssuedAt: time
  price: money USD read <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  cardRef: text 1..100 read <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  balance: money USD read <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  writeOffReason: text <=280 ? read <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  immutable pet, owner, certScan, certIssuedAt, price, cardRef
  read <- .owner = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler']
  insert <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler']
  online only

-- Privacy intent, stated separately from the enforcing rules above.
invariant moves.price read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant moves.cardRef read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant moves.balance read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant moves.writeOffReason read only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant moves.writeOff only exists roles[viewer, role = 'owner']
invariant moves.openMove only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator']
invariant roles.insert only viewer = 'service:operator'

query myRole():
  return roles[viewer]

query myPets(c: cursor ?):
  return pets where .owner = viewer last 50 by .id after c

query allPets(c: cursor ?):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] else NOT_STAFF
  return pets last 50 by .id after c

query board(c: cursor ?):
  if exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler']:
    return moves last 50 by .id after c
  return moves where .owner = viewer last 50 by .id after c

query moveDetail(move: moves):
  return moves[move]

mutation provision(principal: principal, role: enum('owner', 'coordinator', 'handler', 'pet_owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

mutation registerPet(owner: principal, name: text 1..80, species: enum('dog', 'cat')):
  require owner = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] else NOT_ALLOWED 'Anyone may register their own pet; only the coordinator or the company owner may register a pet for someone else.'
  return insert pets { owner, name, species }

mutation openMove(pet: pets, crateSize: enum('S', 'M', 'L', 'XL'), flight: text 1..120, feedingNotes: text <=500, certScan: image <=10000000, certIssuedAt: time, price: money USD, cardRef: text 1..100, balance: money USD):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR 'Only the coordinator or the company owner may open a move.'
  p = pets[pet] ! else NOT_FOUND
  return insert moves { pet, owner: p.owner, crateSize, flight, feedingNotes, status: 'booked', certScan, certIssuedAt, price, cardRef, balance, writeOffReason: null }

mutation updateLogistics(move: moves, crateSize: enum('S', 'M', 'L', 'XL'), flight: text 1..120, feedingNotes: text <=500):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR 'Only the coordinator or the company owner may edit logistics.'
  m = moves[move] ! else NOT_FOUND
  update moves[move] { crateSize, flight, feedingNotes }
  return null

mutation advanceStatus(move: moves, to: enum('booked', 'crated', 'in_flight', 'delivered')):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] else NOT_STAFF 'Only staff may advance a move.'
  m = moves[move] ! else NOT_FOUND
  if m.status = 'booked':
    require to = 'crated' else BAD_TRANSITION 'A booked move can only become crated.'
  elif m.status = 'crated':
    require to = 'in_flight' else BAD_TRANSITION 'A crated move can only go in flight.'
  elif m.status = 'in_flight':
    require to = 'delivered' else BAD_TRANSITION 'A move in flight can only be delivered.'
  else:
    require m.status != 'delivered' else BAD_TRANSITION 'This move is already delivered.'
  if to = 'in_flight':
    require m.certIssuedAt >= now - 10d else CERT_EXPIRED 'The health certificate is older than ten days; the pet cannot fly on it.'
  update moves[move] { status: to }
  return null

mutation writeOff(move: moves, reason: text 1..280):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER 'Only the company owner may write off a balance.'
  m = moves[move] ! else NOT_FOUND
  update moves[move] { balance: 0, writeOffReason: reason }
  return null
