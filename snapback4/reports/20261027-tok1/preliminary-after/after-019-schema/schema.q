use identity password

table roles:
  principal: principal
  role: enum('owner', 'coordinator', 'handler', 'company_owner')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table birds:
  owner: principal
  name: text 1..80
  species: text 1..80
  immutable owner
  read <- .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'company_owner']
  insert <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  update <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  online only

table accounts:
  owner: principal
  card: text <=40 default '' read <- .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  balance: int default 0 read <- .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  writeOffReason: text <=200 default '' read <- .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  unique owner
  immutable owner
  read <- .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  insert <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  update <- exists roles[viewer, role = 'company_owner']
  online only

table moves:
  bird: birds
  owner: principal
  cageSize: text 1..40
  route: text 1..200
  feedingNotes: text <=500 default ''
  certScan: image <=5000000
  certIssuedAt: time
  price: int default 0 read <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
  status: enum('booked', 'caged', 'in_transit', 'delivered') default 'booked'
  immutable bird, owner, certScan, certIssuedAt, price
  read <- .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'company_owner']
  insert <- exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'company_owner']
  online only

mutation provision(principal: principal, role: enum('owner', 'coordinator', 'handler', 'company_owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role } if absent

mutation registerBird(owner: principal, name: text 1..80, species: text 1..80, card: text <=40):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner'] else NOT_COORDINATOR
  insert accounts { owner, card, balance: 0, writeOffReason: '' } if absent
  return insert birds { owner, name, species }

mutation openMove(bird: birds, cageSize: text 1..40, route: text 1..200, feedingNotes: text <=500, certScan: image <=5000000, certIssuedAt: time, price: int):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  birdRow = birds[bird] ! else NOT_FOUND
  require price >= 0 else BAD_PRICE
  require certIssuedAt <= now else BAD_CERT_DATE
  require now - certIssuedAt <= 10d else STALE_CERT
  return insert moves { bird, owner: birdRow.owner, cageSize, route, feedingNotes, certScan, certIssuedAt, price }

mutation cageBird(move: moves):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'company_owner'] else NOT_STAFF
  row = moves[move] ! else NOT_FOUND
  require row.status = 'booked' else BAD_STATUS
  require now - row.certIssuedAt <= 10d else STALE_CERT
  update moves[move] { status: 'caged' }
  return null

mutation startTransit(move: moves):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'company_owner'] else NOT_STAFF
  row = moves[move] ! else NOT_FOUND
  require row.status = 'caged' else BAD_STATUS
  require now - row.certIssuedAt <= 10d else STALE_CERT
  update moves[move] { status: 'in_transit' }
  return null

mutation deliver(move: moves):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'company_owner'] else NOT_STAFF
  row = moves[move] ! else NOT_FOUND
  require row.status = 'in_transit' else BAD_STATUS
  require now - row.certIssuedAt <= 10d else STALE_CERT
  update moves[move] { status: 'delivered' }
  return null

mutation writeOff(account: accounts, reason: text 1..200):
  require exists roles[viewer, role = 'company_owner'] else NOT_COMPANY_OWNER
  row = accounts[account] ! else NOT_FOUND
  require (row.balance ?? 0) > 0 else NO_BALANCE
  update accounts[account] { balance: 0, writeOffReason: reason }
  return null

query board(c: cursor ?):
  if exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'company_owner']:
    return moves last 50 by .id after c
  return moves where .owner = viewer last 50 by .id after c

query myBirds(c: cursor ?):
  if exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'company_owner']:
    return birds last 50 by .id after c
  return birds where .owner = viewer last 50 by .id after c

-- Independent intent from the spec; extend these when requirements change.
invariant moves.read only .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'handler'] or exists roles[viewer, role = 'company_owner']
invariant moves.price read only exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
invariant accounts.read only .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
invariant accounts.card read only .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
invariant accounts.balance read only .owner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'company_owner']
