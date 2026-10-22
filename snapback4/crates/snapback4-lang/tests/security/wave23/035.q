use identity password

table roles:
  principal: principal
  role: enum('donor', 'sorter', 'cashier', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('donor', 'sorter', 'cashier', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

fn role():
  r = roles[viewer] ! else NO_ROLE
  return r.role
fn staff():
  r = role()
  return r = 'sorter' or r = 'cashier' or r = 'manager'
fn sorting():
  r = role()
  return r = 'sorter' or r = 'manager'

-- Receipt values and donor identity never enter the staff board.
table receipts:
  donor: principal
  description: text 3..200
  declaredCents: int 0..100000000
  receivedAt: time
  immutable donor, description, declaredCents, receivedAt
  read <- .donor = viewer
  insert <- .donor = viewer and exists roles[principal = viewer, role = 'donor']
  online only
invariant receipts.read only .donor = viewer
invariant receipts.declaredCents read only .donor = viewer

table bins:
  label: text 3..120
  stage: enum('received', 'sorted', 'priced', 'floor')
  receivedAt: time
  immutable label, receivedAt
  read <- exists roles[principal = viewer, role = 'sorter'] or exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'sorter'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'donor']
  update <- exists roles[principal = viewer, role = 'sorter'] or exists roles[principal = viewer, role = 'manager']
  online only

table items:
  bin: bins
  title: text 3..120
  photo: image <=5000000 ?
  read (photo) <- exists roles[principal = viewer, role = 'sorter'] or exists roles[principal = viewer, role = 'manager']
  tagCents: int 2..10000000
  pricedBy: principal
  pricedAt: time
  floorAt: time ?
  state: enum('priced', 'floor', 'sold', 'recycled', 'pulled')
  soldCents: int ?
  soldAt: time ?
  soldBy: principal ?
  pullReason: text 8..500 ?
  pulledBy: principal ?
  pulledAt: time ?
  cap 40 by bin
  immutable bin, title, tagCents, pricedBy, pricedAt
  read <- exists roles[principal = viewer, role = 'sorter'] or exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']
  insert <- .pricedBy = viewer and (exists roles[principal = viewer, role = 'sorter'] or exists roles[principal = viewer, role = 'manager']) and (.tagCents <= 10000 or exists roles[principal = viewer, role = 'manager'])
  update <- exists roles[principal = viewer, role = 'sorter'] or exists roles[principal = viewer, role = 'cashier'] or exists roles[principal = viewer, role = 'manager']
  online only

invariant items.photo read only exists roles[principal = viewer, role = 'sorter'] or exists roles[principal = viewer, role = 'manager']

query me():
  return { principal: viewer, role: role(), highValueCents: 10000 }
query myReceipts(c: cursor ?):
  require role() = 'donor' else NOT_DONOR
  return receipts where .donor = viewer last 50 by .receivedAt, .id after c
query receipt(receiptId: receipts):
  require role() = 'donor' else NOT_DONOR
  return receipts[receiptId]
query board(c: cursor ?):
  require staff() else NOT_STAFF
  return bins last 50 by .receivedAt, .id after c
query inventory(c: cursor ?):
  require staff() else NOT_STAFF
  return items last 100 by .pricedAt, .id after c { id, bin, title, photo, tagCents, pricedAt, floorAt, state: 'recycled' if (.state = 'floor' or .state = 'priced') and now >= .pricedAt + 56d else .state, postedCents: .tagCents / 2 if .floorAt != null and now >= .floorAt + 28d else .tagCents, soldCents, soldAt, soldBy, pullReason, pulledBy, pulledAt }
query binItems(bin: bins):
  require staff() else NOT_STAFF
  return items where .bin = bin last 40 by .pricedAt, .id { id, title, photo, tagCents }
query item(itemId: items):
  require staff() else NOT_STAFF
  return items[itemId] { id, bin, title, photo, tagCents, pricedBy, pricedAt, floorAt, state: 'recycled' if (.state = 'floor' or .state = 'priced') and now >= .pricedAt + 56d else .state, postedCents: .tagCents / 2 if .floorAt != null and now >= .floorAt + 28d else .tagCents, soldCents, soldAt, soldBy, pullReason, pulledBy, pulledAt }

mutation donate(description: text 3..200, declaredCents: int 0..100000000):
  require role() = 'donor' else NOT_DONOR
  r = insert receipts { donor: viewer, description, declaredCents, receivedAt: now }
  insert bins { label: 'Donation intake', stage: 'received', receivedAt: now }
  return r
mutation receiveBin(label: text 3..120):
  require sorting() else NOT_SORTER
  return insert bins { label, stage: 'received', receivedAt: now }
mutation sortBin(bin: bins):
  require sorting() else NOT_SORTER
  b = bins[bin] ! else NOT_FOUND
  require b.stage = 'received' else WRONG_STAGE
  update bins[bin] { stage: 'sorted' }
mutation priceItem(bin: bins, title: text 3..120, tagCents: int 2..10000000, photo: image <=5000000 ?):
  require sorting() else NOT_SORTER
  require tagCents <= 10000 or role() = 'manager' else HIGH_VALUE_MANAGER_ONLY
  require tagCents % 2 = 0 else EVEN_CENTS 'Use even cents so the half-price tag is exact.'
  b = bins[bin] ! else NOT_FOUND
  require b.stage = 'sorted' or b.stage = 'priced' else WRONG_STAGE
  i = insert items { bin, title, photo, tagCents, pricedBy: viewer, pricedAt: now, state: 'priced' }
  update bins[bin] { stage: 'priced' }
  return i
mutation addPhoto(itemId: items, photo: image <=5000000):
  require sorting() else NOT_SORTER
  i = items[itemId] ! else NOT_FOUND
  require i.photo = null else PHOTO_ALREADY_PRESENT
  return update items[itemId] { photo }
mutation floorBin(bin: bins):
  require sorting() else NOT_SORTER
  b = bins[bin] ! else NOT_FOUND
  require b.stage = 'priced' else WRONG_STAGE
  require count(items where .bin = bin and .state = 'priced') > 0 else NO_PRICED_ITEMS
  for i in items where .bin = bin:
    if i.state = 'priced':
      require now < i.pricedAt + 56d else RECYCLE_DUE
      update items[i.id] { floorAt: now, state: 'floor' }
  update bins[bin] { stage: 'floor' }
mutation sell(itemId: items):
  require role() = 'cashier' else NOT_CASHIER
  i = items[itemId] ! else NOT_FOUND
  require i.state = 'floor' else NOT_ON_FLOOR
  require now < i.pricedAt + 56d else RECYCLE_DUE
  amount = i.tagCents / 2 if i.floorAt != null and now >= i.floorAt + 28d else i.tagCents
  update items[itemId] { state: 'sold', soldCents: amount, soldAt: now, soldBy: viewer }
  return { itemId, soldCents: amount }
mutation pull(itemId: items, reason: text 8..500):
  require role() = 'manager' else NOT_MANAGER
  i = items[itemId] ! else NOT_FOUND
  require i.state = 'priced' or i.state = 'floor' else TERMINAL_ITEM
  require now < i.pricedAt + 56d else RECYCLE_DUE
  update items[itemId] { state: 'pulled', pullReason: reason, pulledBy: viewer, pulledAt: now }

job recycle():
  for i in items:
    if (i.state = 'priced' or i.state = 'floor') and now >= i.pricedAt + 56d:
      update items[i.id] { state: 'recycled' }
schedule recycleDue every 1h: recycle
