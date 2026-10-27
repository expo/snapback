-- Exotic Bird Transport: initial backend milestone.
--
-- Roles: bird owners (customers) see only their own birds and moves; staff
-- coordinators open moves with the health-certificate scan and quoted price;
-- staff handlers move birds along booked -> caged -> in_transit -> delivered;
-- the company owner supervises and is the only role that may write off a
-- balance, with a recorded reason. Financial columns (price, card reference,
-- balance) are visible only to coordinators and the company owner, never to
-- handlers, and row scope keeps every owner to their own birds and moves.

use identity password
use personas birdowner, coord, handler, boss, stranger

-- Staff roster. The first company owner is enrolled through the service:ops
-- seat (operator token); afterwards the company owner grants staff roles.
table staffRoles:
  principal: principal
  role: enum('coordinator', 'handler', 'company_owner')
  unique principal, role
  read <- .principal = viewer or exists staffRoles[principal = viewer, role = 'company_owner']
  insert <- exists staffRoles[principal = viewer, role = 'company_owner'] or viewer = 'service:ops'
  delete <- exists staffRoles[principal = viewer, role = 'company_owner']
  online only

-- Birds in care of the company. Each bird belongs to one owner; staff read
-- every bird so handlers can see the bird on each move they carry.
table birds:
  owner: principal
  name: text 1..80
  species: text 1..80
  immutable owner
  read <- .owner = viewer or exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'handler'] or exists staffRoles[principal = viewer, role = 'company_owner']
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  online only

-- Transport moves. The coordinator opens a move with the bird's
-- health-certificate scan (required image evidence), the certificate date,
-- the quoted price and the owner's payment reference. price, cardRef and
-- balance carry their own column gate so handlers and bird owners read the
-- move row with those cells withheld; only coordinators and the company
-- owner read them. balance starts at the quoted price and only a company
-- owner write-off changes it.
table moves:
  bird: birds
  owner: principal
  coordinator: principal
  status: enum('booked', 'caged', 'in_transit', 'delivered') default 'booked'
  route: text 1..200
  cageSize: text 1..40
  feedingNotes: text <=500
  price: money USD read <- exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'company_owner']
  cardRef: text 1..40 read <- exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'company_owner']
  balance: money USD read <- exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'company_owner']
  healthCert: image <=10000000
  healthCertAt: time
  createdAt: time default now
  immutable bird, owner, coordinator, price, cardRef, healthCert, healthCertAt
  read <- .owner = viewer or exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'handler'] or exists staffRoles[principal = viewer, role = 'company_owner']
  insert <- exists staffRoles[principal = viewer, role = 'coordinator']
  update <- exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'handler'] or exists staffRoles[principal = viewer, role = 'company_owner']
  online only

-- Write-off ledger. One row per company-owner write-off records the amount
-- taken off the move's balance and the required reason. Coordinators may
-- read the ledger; only the company owner writes it.
table writeOffs:
  move: moves
  amount: money USD
  reason: text 1..200
  writtenBy: principal
  at: time default now
  immutable move, amount, reason, writtenBy, at
  read <- exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'company_owner']
  insert <- exists staffRoles[principal = viewer, role = 'company_owner']
  update <- deny
  delete <- deny
  online only

-- Privacy intent, stated separately from the enforcing rules above.
invariant moves.read only .owner = viewer or exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'handler'] or exists staffRoles[principal = viewer, role = 'company_owner']
invariant moves.price read only exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'company_owner']
invariant moves.cardRef read only exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'company_owner']
invariant moves.balance read only exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'company_owner']
invariant moves.insert only exists staffRoles[principal = viewer, role = 'coordinator']
invariant moves.writeOff only exists staffRoles[principal = viewer, role = 'company_owner']
invariant moves.balance update only exists staffRoles[principal = viewer, role = 'company_owner']
invariant staffRoles.read only .principal = viewer or exists staffRoles[principal = viewer, role = 'company_owner']
invariant staffRoles.insert only exists staffRoles[principal = viewer, role = 'company_owner'] or viewer = 'service:ops'
invariant staffRoles.delete only exists staffRoles[principal = viewer, role = 'company_owner']
invariant birds.read only .owner = viewer or exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'handler'] or exists staffRoles[principal = viewer, role = 'company_owner']
invariant writeOffs.insert only exists staffRoles[principal = viewer, role = 'company_owner']

query whoAmI():
  return viewer

query myBirds(c: cursor ?):
  return birds where .owner = viewer last 50 by .id after c

query myMoves(c: cursor ?):
  return moves where .owner = viewer last 50 by .createdAt after c

-- Live move board: staff see every move, owners see only their own.
query board(c: cursor ?):
  if exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'handler'] or exists staffRoles[principal = viewer, role = 'company_owner']:
    return moves last 50 by .createdAt after c
  return moves where .owner = viewer last 50 by .createdAt after c

query moveDetail(move: moves):
  return moves[move]

query birdMoves(bird: birds, c: cursor ?):
  return moves where .bird = bird last 50 by .createdAt after c

query writeOffHistory(move: moves, c: cursor ?):
  return writeOffs where .move = move last 20 by .at after c

mutation grantStaff(who: principal, role: enum('coordinator', 'handler', 'company_owner')):
  require exists staffRoles[principal = viewer, role = 'company_owner'] or viewer = 'service:ops' else NOT_COMPANY_OWNER 'Only the company owner grants staff roles.'
  return insert staffRoles { principal: who, role }

mutation revokeStaff(who: principal, role: enum('coordinator', 'handler', 'company_owner')):
  require exists staffRoles[principal = viewer, role = 'company_owner'] else NOT_COMPANY_OWNER 'Only the company owner revokes staff roles.'
  delete staffRoles[who, role]

mutation registerBird(name: text 1..80, species: text 1..80):
  return insert birds { owner: viewer, name, species }

-- The coordinator opens a move: the health-certificate scan and its date are
-- required evidence, the price is required, and a certificate older than ten
-- days (server clock) refuses the move.
mutation openMove(bird: birds, route: text 1..200, cageSize: text 1..40, feedingNotes: text <=500, price: money USD, cardRef: text 1..40, healthCert: image <=10000000, healthCertAt: time):
  require exists staffRoles[principal = viewer, role = 'coordinator'] else NOT_COORDINATOR 'Only a coordinator opens moves.'
  b = birds[bird] ! else NOT_FOUND
  require healthCertAt >= now - 10d else STALE_CERT 'The health certificate is older than ten days.'
  require healthCertAt <= now else FUTURE_CERT 'The health certificate date is in the future.'
  return insert moves { bird, owner: b.owner, coordinator: viewer, route, cageSize, feedingNotes, price, cardRef, balance: price, healthCert, healthCertAt }

-- Handlers and coordinators advance birds one stage at a time; each advance
-- re-checks the certificate age against the server clock, so a bird never
-- travels on a certificate older than ten days.
mutation advanceMove(move: moves, status: enum('caged', 'in_transit', 'delivered')):
  require exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'handler'] else NOT_STAFF 'Only coordinators and handlers advance moves.'
  m = moves[move] ! else NOT_FOUND
  require (m.status = 'booked' and status = 'caged') or (m.status = 'caged' and status = 'in_transit') or (m.status = 'in_transit' and status = 'delivered') else BAD_TRANSITION 'Moves advance booked, caged, in transit, delivered in order.'
  require m.healthCertAt >= now - 10d else STALE_CERT 'The health certificate is older than ten days.'
  update moves[move] { status }
  return null

-- Care updates while a bird travels: route, cage and feeding notes only.
-- Financial columns stay immutable here, so this path cannot touch them.
mutation updateCare(move: moves, route: text 1..200 ?, cageSize: text 1..40 ?, feedingNotes: text <=500 ?):
  require exists staffRoles[principal = viewer, role = 'coordinator'] or exists staffRoles[principal = viewer, role = 'handler'] else NOT_STAFF 'Only coordinators and handlers update care.'
  m = moves[move] ! else NOT_FOUND
  update moves[move] { route: route ?? m.route, cageSize: cageSize ?? m.cageSize, feedingNotes: feedingNotes ?? m.feedingNotes }
  return null

-- Approval operation: only the company owner may write off the remaining
-- balance, and the reason is recorded on the ledger row in the same
-- transaction that zeroes the balance.
mutation writeOff(move: moves, reason: text 1..200):
  require exists staffRoles[principal = viewer, role = 'company_owner'] else NOT_COMPANY_OWNER 'Only the company owner writes off a balance.'
  require trim(reason) != '' else EMPTY_REASON 'A write-off needs a recorded reason.'
  m = moves[move] ! else NOT_FOUND
  bal = m.balance
  require bal != null else NOT_VISIBLE 'The balance is not visible to the caller.'
  require bal != 0 else NOTHING_OWED 'There is no balance to write off.'
  insert writeOffs { move, amount: bal, reason, writtenBy: viewer }
  update moves[move] { balance: 0 }
  return null
