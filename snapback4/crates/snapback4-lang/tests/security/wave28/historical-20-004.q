-- Antique Mall Booths.
-- Roles: dealer (rents booths, lists items), cashier (holds/sells at the
-- counter), manager (leases, discount approvals). Real password identity;
-- `use personas` keeps the local dev cast and fixture/clock doors open on
-- dev only (serve refuses personas).
use identity password
use personas qa1, qa2

-- Role roster: one row per user. First manager comes from service:ops.
table roles:
  principal: principal
  role: enum('dealer', 'cashier', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:ops'
  insert <- exists roles[principal = viewer, role = 'manager'] or viewer = 'service:ops'
  update <- exists roles[principal = viewer, role = 'manager'] or viewer = 'service:ops'
  delete <- exists roles[principal = viewer, role = 'manager'] or viewer = 'service:ops'
  online only

-- A rented booth. Only the manager creates a lease or ends one.
table booths:
  number: text 1..12
  dealer: principal
  status: enum('active', 'ended') default 'active'
  startedAt: time default now
  endedAt: time ?
  unique number
  immutable number, dealer
  read <- .dealer = viewer or exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'manager']
  delete <- deny
  online only

-- An item on a booth. Every reader of the row sees the photo, description,
-- tag price and booth number. The dealer's purchase cost and lowest price
-- live in itemCosts (one row per item, readable only by that dealer and the
-- manager) so counter pages never scan a private field.
-- discountApproved/approvedPrice are operational (the cashier must know the
-- approved minimum) and stay readable to any reader of the row.
table items:
  booth: booths
  boothNumber: text 1..12
  dealer: principal
  description: text 1..2000
  tagPrice: money USD
  photo: image <=5000000
  status: enum('available', 'held', 'sold') default 'available'
  heldAt: time ?
  holdExpiresAt: time ?
  heldFor: text 1..80 ?
  soldAt: time ?
  soldPrice: money USD ?
  discountApproved: bool default false
  approvedPrice: money USD ?
  read <- .dealer = viewer or exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']
  insert <- .dealer = viewer and exists booths[.booth, dealer = viewer]
  update <- .dealer = viewer or exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']
  delete <- .dealer = viewer or exists roles[principal = viewer, role = 'manager']
  immutable booth, dealer, boothNumber
  cap 500 by dealer
  online only

-- Private dealer economics for one item. Never scanned; always read by key.
table itemCosts:
  item: items on delete cascade
  dealer: principal
  cost: money USD
  floorPrice: money USD
  unique item
  immutable item, dealer
  read <- .dealer = viewer or exists roles[principal = viewer, role = 'manager']
  insert <- .dealer = viewer and created items[.item]
  update <- .dealer = viewer
  cap 500 by dealer
  online only

-- Privacy + authority intent, stated separately from the rules.
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'manager']
invariant booths.read only .dealer = viewer or exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']
invariant booths.insert only exists roles[principal = viewer, role = 'manager']
invariant items.read only .dealer = viewer or exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']
invariant items.insert only .dealer = viewer
invariant itemCosts.read only .dealer = viewer or exists roles[principal = viewer, role = 'manager']
invariant itemCosts.cost read only .dealer = viewer or exists roles[principal = viewer, role = 'manager']
invariant itemCosts.floorPrice read only .dealer = viewer or exists roles[principal = viewer, role = 'manager']
invariant itemCosts.insert only .dealer = viewer

-- The caller's own role row (null when the caller holds no role).
query myRole():
  return roles[viewer]

-- Booth directory: every booth for cashiers/managers, only their own for dealers.
query booths(c: cursor ?):
  if exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']:
    return booths last 100 by .id after c
  return booths where .dealer = viewer last 100 by .id after c

-- One booth (null when hidden).
query booth(booth: booths):
  return booths[booth]

-- Cashier board: every item for cashiers/managers (sold rows included, live),
-- only their own items for dealers. Private columns stay null for cashiers.
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']:
    return items last 100 by .id after c
  return items where .dealer = viewer last 100 by .id after c

-- One item (null when hidden).
query item(item: items):
  return items[item]

-- Private pricing for one item (null when hidden: another dealer's row,
-- or any row for a cashier).
query pricing(item: items):
  return itemCosts[item]

-- Dealer roster for the manager (booth leases and grants need principals).
query dealers(c: cursor ?):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  return roles where .role = 'dealer' last 100 by .id after c

-- Sales: sold items. Cashiers/managers see every sale; dealers see only
-- sales of their own items.
query salesBoard(c: cursor ?):
  if exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']:
    return items where .status = 'sold' last 100 by .id after c
  return items where .dealer = viewer and .status = 'sold' last 100 by .id after c

-- Operator/manager roster grant. Signup grants no role.
mutation provision(principal: principal, role: enum('dealer', 'cashier', 'manager')):
  require exists roles[principal = viewer, role = 'manager'] or viewer = 'service:ops' else NOT_MANAGER
  return upsert roles[principal] { principal, role }

-- Manager opens a booth lease for a dealer.
mutation createBooth(number: text 1..12, dealer: principal):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  require exists roles[dealer, role = 'dealer'] else NOT_A_DEALER
  return insert booths { number, dealer, status: 'active' }

-- Only the manager ends a booth lease.
mutation endLease(booth: booths):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  b = booths[booth] ! else NOT_FOUND
  require b.status = 'active' else ALREADY_ENDED
  update booths[booth] { status: 'ended', endedAt: now }
  return null

-- A dealer lists an item on their own active booth.
mutation addItem(booth: booths, description: text 1..2000, tagPrice: money USD, cost: money USD, floorPrice: money USD, photo: image <=5000000):
  b = booths[booth] ! else NOT_FOUND
  require b.dealer = viewer else NOT_YOUR_BOOTH
  require b.status = 'active' else LEASE_ENDED
  require tagPrice >= 1 and cost >= 1 and floorPrice >= 1 else BAD_PRICE
  require floorPrice <= tagPrice else BAD_RANGE
  row = insert items { booth, boothNumber: b.number, dealer: viewer, description, tagPrice, photo, status: 'available' }
  insert itemCosts { item: row.id, dealer: viewer, cost, floorPrice }
  return row

-- A dealer edits their own unsold item (full replacement; the app sends the
-- current values for fields that did not change).
mutation updateItem(item: items, description: text 1..2000, tagPrice: money USD, cost: money USD, floorPrice: money USD):
  i = items[item] ! else NOT_FOUND
  require i.dealer = viewer else NOT_YOUR_ITEM
  require i.status != 'sold' else ALREADY_SOLD
  require tagPrice >= 1 and cost >= 1 and floorPrice >= 1 else BAD_PRICE
  require floorPrice <= tagPrice else BAD_RANGE
  update items[item] { description, tagPrice }
  update itemCosts[item] { cost, floorPrice }
  return null

-- A dealer removes their own unsold item.
mutation removeItem(item: items):
  i = items[item] ! else NOT_FOUND
  require i.dealer = viewer else NOT_YOUR_ITEM
  require i.status != 'sold' else ALREADY_SOLD
  delete items[item]
  return null

-- A cashier holds an available item for a shopper (72h window).
mutation holdItem(item: items, heldFor: text 1..80):
  require exists roles[principal = viewer, role = 'cashier'] else NOT_CASHIER
  i = items[item] ! else NOT_FOUND
  b = booths[i.booth] ! else NOT_FOUND
  require b.status = 'active' else LEASE_ENDED
  require i.status = 'available' else NOT_AVAILABLE
  update items[item] { status: 'held', heldAt: now, holdExpiresAt: now + 72h, heldFor }
  return null

-- A cashier (or the manager) releases a hold early.
mutation releaseHold(item: items):
  require exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager'] else NOT_CASHIER
  i = items[item] ! else NOT_FOUND
  require i.status = 'held' else NOT_HELD
  update items[item] { status: 'available', heldAt: null, holdExpiresAt: null, heldFor: null }
  return null

-- Counter sale. Cashiers charge the tag price, or a manager-approved price;
-- the manager selling below the floor is the approval itself.
mutation sellItem(item: items, price: money USD):
  require exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager'] else NOT_CASHIER
  i = items[item] ! else NOT_FOUND
  b = booths[i.booth] ! else NOT_FOUND
  require b.status = 'active' else LEASE_ENDED
  require i.status != 'sold' else ALREADY_SOLD
  require price >= 1 else BAD_PRICE
  if i.status = 'held':
    require i.holdExpiresAt != null and now <= i.holdExpiresAt else HOLD_EXPIRED
  if not exists roles[principal = viewer, role = 'manager']:
    if price < i.tagPrice:
      require i.discountApproved else NEEDS_APPROVAL
      require i.approvedPrice != null else NEEDS_APPROVAL
      require price >= i.approvedPrice else NEEDS_APPROVAL
  update items[item] { status: 'sold', soldAt: now, soldPrice: price, heldAt: null, holdExpiresAt: null, heldFor: null }
  return null

-- Only the manager approves selling below the dealer's lowest price.
mutation approveDiscount(item: items, approvedPrice: money USD):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  i = items[item] ! else NOT_FOUND
  require i.status != 'sold' else ALREADY_SOLD
  require approvedPrice >= 1 else BAD_PRICE
  update items[item] { discountApproved: true, approvedPrice }
  return null

-- Holds expire 72h after they were placed unless the item was paid for.
-- The sweep looks back from periodEnd so a coalesced run still catches up;
-- each mutation above also enforces its own deadline against now.
job releaseExpiredHolds(periodStart: time, periodEnd: time):
  for i in items by .id:
    if i.status = 'held' and i.holdExpiresAt != null and i.holdExpiresAt < periodEnd:
      update items[i.id] { status: 'available', heldAt: null, holdExpiresAt: null, heldFor: null }

schedule releaseHolds every 1h: releaseExpiredHolds
