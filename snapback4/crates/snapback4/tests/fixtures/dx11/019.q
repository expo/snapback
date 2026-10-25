-- Mature Tree Transplants: a tree spade company moves large trees between
-- nurseries and gardens. Roles: owner (company owner), dispatcher, driver,
-- client. Password accounts; roles are provisioned by the local operator.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'dispatcher', 'driver', 'client')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  cap 100
  online only

mutation provision(principal: principal, role: enum('owner', 'dispatcher', 'driver', 'client')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- A client's payment file: tokenized card reference plus the amount owed.
-- Only the dispatcher and the company owner may read it; drivers never see
-- it and clients do not see it either (spec: card/balance visible only to
-- dispatcher and owner).
table accounts:
  client: principal
  cardRef: text 1..60
  balance: money USD
  unique client
  immutable client
  read <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  cap 2000
  online only

mutation setAccount(client: principal, cardRef: text 1..60, balance: money USD):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  require exists roles[principal = client, role = 'client'] else NOT_CLIENT 'Accounts open only for registered clients.'
  return upsert accounts[client] { client, cardRef, balance }

query accounts(c: cursor ?):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  return accounts last 50 by .id after c

query account(account: accounts):
  return accounts[account]

-- A balance write-off. Only the company owner may write one, and the reason
-- is recorded on the row.
table writeoffs:
  account: accounts
  amount: money USD
  reason: text 1..280
  recordedBy: principal
  at: time default now
  immutable account, amount, reason, recordedBy, at
  read <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'owner']
  cap 10000
  online only

mutation writeOff(account: accounts, amount: money USD, reason: text 1..280):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the company owner can write off a balance.'
  a = accounts[account] ! else NOT_FOUND
  require amount > 0 else BAD_AMOUNT 'Write-off amount must be positive.'
  require a.balance >= amount else OVERDRAWN 'Write-off exceeds the balance owed.'
  update accounts[account] { balance: a.balance - amount }
  return insert writeoffs { account, amount, reason, recordedBy: viewer }

query writeoffs(c: cursor ?):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  return writeoffs last 50 by .id after c

-- A mature tree under care. Operational fields are visible to staff drivers;
-- the owning client sees only their own trees.
table trees:
  client: principal
  species: text 1..80
  nurseryAddress: text 1..200
  siteAddress: text 1..200
  handlingNotes: text <=1000
  certScan: image <=5000000
  certIssuedAt: time
  immutable client
  read <- .client = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'driver']
  insert <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  cap 5000
  online only

mutation recertify(tree: trees, certScan: image <=5000000, certIssuedAt: time):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  t = trees[tree] ! else NOT_FOUND
  require certIssuedAt <= now else CERT_FUTURE 'Health certificate issue date is in the future.'
  require certIssuedAt >= t.certIssuedAt else CERT_REGRESSION 'A renewed certificate must not be older than the current one.'
  update trees[tree] { certScan, certIssuedAt }
  return null

query tree(tree: trees):
  return trees[tree]

query myTrees(c: cursor ?):
  return trees where .client = viewer last 50 by .id after c

-- One transport of a tree. Drivers see the operational fields but never the
-- quoted price: the column rule redacts it to null for anyone who is not the
-- dispatcher or the company owner.
table moves:
  tree: trees
  client: principal
  species: text 1..80
  nurseryAddress: text 1..200
  siteAddress: text 1..200
  handlingNotes: text <=1000
  price: money USD read <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  status: enum('booked', 'dug', 'onroad', 'planted')
  immutable tree, client
  read <- .client = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'driver']
  insert <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'driver']
  cap 5000
  online only

mutation openMove(client: principal, species: text 1..80, nurseryAddress: text 1..200, siteAddress: text 1..200, handlingNotes: text <=1000, certScan: image <=5000000, certIssuedAt: time, price: money USD):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_PRIVILEGED
  require exists roles[principal = client, role = 'client'] else NOT_CLIENT 'Moves open only for registered clients.'
  require certIssuedAt <= now else CERT_FUTURE 'Health certificate issue date is in the future.'
  t = insert trees { client, species, nurseryAddress, siteAddress, handlingNotes, certScan, certIssuedAt }
  insert moves { tree: t.id, client, species, nurseryAddress, siteAddress, handlingNotes, price, status: 'booked' }
  return null

mutation advanceMove(move: moves, status: enum('booked', 'dug', 'onroad', 'planted')):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'driver'] else NOT_MOVER
  m = moves[move] ! else NOT_FOUND
  t = trees[m.tree] ! else NOT_FOUND
  if status != 'booked':
    require t.certIssuedAt <= now else CERT_FUTURE 'Health certificate issue date is in the future.'
    require now - t.certIssuedAt <= 30d else CERT_EXPIRED 'Health certificate is older than 30 days; the tree cannot travel.'
  update moves[move] { status }
  return null

-- The live route board: staff see every move, clients see only their own.
-- Drivers and clients read a null price; the column rule redacts it.
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'driver']:
    return moves last 50 by .id after c
  return moves where .client = viewer last 50 by .id after c

query move(move: moves):
  return moves[move]

-- Privacy intent, stated independently from the enforcement rules above.
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'dispatcher'] or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
invariant accounts.read only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant accounts.insert only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant accounts.update only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant accounts.balance write only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant writeoffs.read only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant writeoffs.insert only exists roles[principal = viewer, role = 'owner']
invariant trees.read only .client = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'driver']
invariant trees.insert only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant trees.update only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant moves.read only .client = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'driver']
invariant moves.price read only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant moves.insert only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant moves.update only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'driver']
