use personas alice, bob, carol

table pools:
  name: text 1..80
  owner: principal
  balance: int 0..100000000 default 0
  immutable owner
  read <- exists members[.id, viewer]
  update <- exists members[.id, viewer]
  online only

table members:
  pool: pools
  poolOwner: principal
  immutable poolOwner
  principal: principal
  name: text 1..40
  unique pool, principal
  immutable pool, principal
  read <- .principal = viewer or .poolOwner = viewer
  insert <- deny and exists pools[.pool, owner = .poolOwner]
  online only

table wallets:
  principal: principal
  balance: int 0..100000000
  unique principal
  immutable principal
  read <- .principal = viewer
  update <- .principal = viewer
  online only

table proposals:
  pool: pools
  poolOwner: principal
  immutable poolOwner
  author: principal
  title: text 3..120
  amount: int 1..1000000
  status: enum('pending', 'approved', 'rejected') default 'pending'
  at: time default now
  immutable pool, author, title, amount, at
  read <- .author = viewer or .poolOwner = viewer
  insert <- (.author = viewer and exists members[.pool, viewer] and .status = 'pending') and exists pools[.pool, owner = .poolOwner]
  update (old, next) <- old.pool.owner = viewer and old.status = 'pending' and next.status != 'pending'
  online only

table ledger:
  pool: pools
  principal: principal
  kind: enum('contribution', 'redemption')
  amount: int 1..1000000
  note: text 1..120
  at: time default now
  read <- .pool.owner = viewer
  insert <- (.kind = 'contribution' and .principal = viewer and exists members[.pool, viewer]) or (.kind = 'redemption' and .pool.owner = viewer)
  online only

query myPools(c: cursor ?):
  return pools first 20 by .id after c
query myWallet():
  return wallets[principal = viewer]
query walletFor(principal: principal):
  require principal = viewer else PRIVATE_WALLET 'Individual miles are private, including from the pool owner.'
  return wallets[principal = principal]
query poolProposals(pool: pools, c: cursor ?):
  p = pools[pool] ! else NOT_MEMBER
  if p.owner = viewer:
    return proposals where .pool = pool last 25 by .at, .id after c
  return proposals where .pool = pool and .author = viewer last 25 by .at, .id after c
query ownerLedger(pool: pools, c: cursor ?):
  p = pools[pool] ! else NOT_MEMBER
  require p.owner = viewer else OWNER_ONLY 'Only the pool owner can view the ledger.'
  return ledger where .pool = pool last 25 by .at, .id after c
query poolMembers(pool: pools, c: cursor ?):
  p = pools[pool] ! else NOT_MEMBER
  require p.owner = viewer else OWNER_ONLY
  return members where .pool = pool first 20 by .id after c

mutation contribute(pool: pools, amount: int 1..1000000):
  p = pools[pool] ! else NOT_MEMBER
  require exists members[pool, viewer] else NOT_MEMBER
  w = wallets[principal = viewer] ! else NO_WALLET
  require w.balance >= amount else INSUFFICIENT_MILES 'Your private wallet has too few miles.'
  update wallets[w.id] { balance: w.balance - amount }
  update pools[pool] { balance: p.balance + amount }
  insert ledger { pool, principal: viewer, kind: 'contribution', amount, note: 'Member contribution' }
  return { contributed: amount }
mutation propose(pool: pools, title: text 3..120, amount: int 1..1000000):
  p = pools[pool] ! else NOT_MEMBER
  require exists members[pool, viewer] else NOT_MEMBER
  poolOwnerSource = pools[pool] ! else NOT_FOUND
  return insert proposals { pool, poolOwner: poolOwnerSource.owner, author: viewer, title, amount }
mutation approve(proposal: proposals):
  r = proposals[proposal] ! else NOT_FOUND
  p = pools[r.pool] ! else NOT_MEMBER
  require p.owner = viewer else OWNER_ONLY 'Only the pool owner can approve redemptions.'
  require r.status = 'pending' else ALREADY_DECIDED
  require p.balance >= r.amount else INSUFFICIENT_POOL 'The shared pool has too few miles.'
  update pools[p.id] { balance: p.balance - r.amount }
  update proposals[proposal] { status: 'approved' }
  insert ledger { pool: p.id, principal: r.author, kind: 'redemption', amount: r.amount, note: r.title }
  return null
mutation reject(proposal: proposals):
  r = proposals[proposal] ! else NOT_FOUND
  p = pools[r.pool] ! else NOT_MEMBER
  require p.owner = viewer else OWNER_ONLY 'Only the pool owner can reject redemptions.'
  require r.status = 'pending' else ALREADY_DECIDED
  update proposals[proposal] { status: 'rejected' }
  return null
