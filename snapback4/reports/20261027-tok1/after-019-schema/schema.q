use identity password

table roles:
  principal: principal
  role: enum('customer', 'handler', 'coordinator', 'company_owner')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner'] or exists roles[viewer, role = 'handler']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table birds:
  owner: principal
  name: text 1..120
  species: text 1..120
  read <- .owner = viewer or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  insert <- exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  online only

table moves:
  owner: principal
  bird: text 1..120
  cageSize: text 1..40
  route: text 1..200
  feedingNotes: text <=500 default ''
  certScan: image <=5000000
  certIssuedAt: time
  price: money USD read <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  card: text 1..128 read <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  balance: money USD read <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  writeOffReason: text <=500 default '' read <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  openedAt: time
  status: enum('booked', 'caged', 'in_transit', 'delivered') default 'booked'
  immutable owner, bird, certScan, certIssuedAt, price, card, openedAt
  read <- .owner = viewer or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  insert <- exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  online only

mutation provision(principal: principal, role: enum('customer', 'handler', 'coordinator', 'company_owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role } if absent

mutation registerBird(owner: principal, name: text 1..120, species: text 1..120):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  require exists roles[owner, role = 'customer'] else NOT_CUSTOMER
  return insert birds { owner, name, species }

mutation openMove(owner: principal, bird: text 1..120, cageSize: text 1..40, route: text 1..200, feedingNotes: text <=500, certScan: image <=5000000, certIssuedAt: time, price: money USD, card: text 1..128):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  require exists roles[owner, role = 'customer'] else NOT_CUSTOMER
  require now < certIssuedAt + 10d else CERT_EXPIRED
  return insert moves { owner, bird, cageSize, route, feedingNotes, certScan, certIssuedAt, price, card, balance: price, openedAt: now, status: 'booked' }

mutation cage(move: moves):
  row = moves[move] ! else NOT_FOUND
  require now < row.certIssuedAt + 10d else CERT_EXPIRED
  require row.status = 'booked' else CLOSED
  update moves[move] { status: 'caged' }
  return null

mutation startTransit(move: moves):
  row = moves[move] ! else NOT_FOUND
  require now < row.certIssuedAt + 10d else CERT_EXPIRED
  require row.status = 'caged' else CLOSED
  update moves[move] { status: 'in_transit' }
  return null

mutation deliver(move: moves):
  row = moves[move] ! else NOT_FOUND
  require now < row.certIssuedAt + 10d else CERT_EXPIRED
  require row.status = 'in_transit' else CLOSED
  update moves[move] { status: 'delivered' }
  return null

mutation writeOff(move: moves, reason: text 1..500):
  require exists roles[viewer, role = 'company_owner'] else NOT_OWNER
  row = moves[move] ! else NOT_FOUND
  update moves[move] { balance: 0, writeOffReason: reason }
  return null

query board(c: cursor ?):
  if exists roles[viewer, role = 'coordinator']:
    return moves last 50 by .id after c
  if exists roles[viewer, role = 'company_owner']:
    return moves last 50 by .id after c
  if exists roles[viewer, role = 'handler']:
    return moves last 50 by .id after c
  return moves where .owner = viewer last 50 by .id after c

query birdBoard(c: cursor ?):
  if exists roles[viewer, role = 'coordinator']:
    return birds last 50 by .id after c
  if exists roles[viewer, role = 'company_owner']:
    return birds last 50 by .id after c
  if exists roles[viewer, role = 'handler']:
    return birds last 50 by .id after c
  return birds where .owner = viewer last 50 by .id after c

-- Independent intent from the spec; extend these when requirements change.
invariant moves.read only .owner = viewer or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
invariant moves.price read only exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
invariant moves.card read only exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
invariant moves.balance read only exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
invariant moves.balance update only exists roles[viewer, role = 'company_owner']
invariant birds.read only .owner = viewer or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
