use identity password

table roles:
  principal: principal
  role: enum('owner', 'staff', 'consignor')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or .role = 'consignor'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('owner', 'staff', 'consignor')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }
query myRole():
  return roles[viewer]

table profiles:
  principal: principal
  name: text 1..80
  bank: text 4..120
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'owner']
  insert <- .principal = viewer and exists roles[viewer, role = 'consignor']
  update <- .principal = viewer and exists roles[viewer, role = 'consignor']
  online only
mutation saveProfile(name: text 1..80, bank: text 4..120):
  require exists roles[viewer, role = 'consignor'] else CONSIGNOR_ONLY
  return upsert profiles[principal = viewer] { principal: viewer, name, bank }
query myProfile():
  return profiles[principal = viewer]
query profileFor(principal: principal):
  require principal = viewer or exists roles[viewer, role = 'owner'] else PRIVATE_PROFILE
  return profiles[principal = principal]

table items:
  consignor: principal
  title: text 1..100
  brand: text 1..60
  size: text 1..30
  photo: image <=5000000 ?
  detailPhoto: image <=5000000 ?
  tagPrice: int 100..10000000
  split: int 10..90 read <- .consignor = viewer or exists roles[viewer, role = 'owner']
  status: enum('intake', 'on_rack', 'sold', 'paid_out', 'collected', 'donated')
  intakeAt: time
  rackAt: time ?
  soldAt: time ?
  paidAt: time ?
  soldPrice: int 0..10000000 ?
  immutable consignor, intakeAt
  read <- .consignor = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'staff']
  insert <- (.consignor = viewer and exists roles[viewer, role = 'consignor'] or exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner']) and .status = 'intake'
  update <- .consignor = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'staff']
  online only
mutation intake(title: text 1..100, brand: text 1..60, size: text 1..30, photo: image <=5000000, detailPhoto: image <=5000000 ?, tagPrice: int 100..10000000):
  require exists roles[viewer, role = 'consignor'] else CONSIGNOR_ONLY
  require exists profiles[principal = viewer] else PROFILE_REQUIRED
  return insert items { consignor: viewer, title, brand, size, photo, detailPhoto, tagPrice, split: 60, status: 'intake', intakeAt: now, rackAt: null, soldAt: null, paidAt: null, soldPrice: null }
query intakeConsignors():
  require exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner'] else STAFF_ONLY
  return roles where .role = 'consignor' first 500 by .id { principal }
mutation staffIntake(consignor: principal, title: text 1..100, brand: text 1..60, size: text 1..30, photo: image <=5000000 ?, detailPhoto: image <=5000000 ?, tagPrice: int 100..10000000):
  require exists roles[viewer, role = 'staff'] or exists roles[viewer, role = 'owner'] else STAFF_ONLY
  require exists roles[consignor, role = 'consignor'] else CONSIGNOR_REQUIRED
  return insert items { consignor, title, brand, size, photo, detailPhoto, tagPrice, split: 60, status: 'intake', intakeAt: now, rackAt: null, soldAt: null, paidAt: null, soldPrice: null }
mutation setPhotos(item: items, photo: image <=5000000 ?, detailPhoto: image <=5000000 ?):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  i = items[item] ! else NOT_FOUND
  return update items[item] { photo, detailPhoto }
fn price(i: items):
  return i.tagPrice * 3 / 4 if i.rackAt != null and now >= i.rackAt + 30d else i.tagPrice
query board(c: cursor ?):
  require exists roles[viewer] else ROLE_REQUIRED
  return items first 500 by .id after c { id, consignor, title, brand, size, photo, detailPhoto, tagPrice, split, status, intakeAt, rackAt, soldAt, paidAt, soldPrice, price: price(items[.id] ! else NOT_FOUND), payout: .soldPrice * .split / 100 if .soldPrice != null and .split != null else null }
query item(item: items):
  require exists roles[viewer] else ROLE_REQUIRED
  return items[item]
mutation rack(item: items):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'staff'] else STAFF_ONLY
  i = items[item] ! else NOT_FOUND
  require i.status = 'intake' else WRONG_STATUS
  require now < i.intakeAt + 90d else DONATION_DUE
  return update items[item] { status: 'on_rack', rackAt: now }
mutation sell(item: items):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'staff'] else STAFF_ONLY
  i = items[item] ! else NOT_FOUND
  require i.status = 'on_rack' else WRONG_STATUS
  require now < i.intakeAt + 90d else DONATION_DUE
  return update items[item] { status: 'sold', soldAt: now, soldPrice: price(i) }
mutation reprice(item: items, tagPrice: int 100..10000000):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  i = items[item] ! else NOT_FOUND
  require i.status = 'intake' or i.status = 'on_rack' else WRONG_STATUS
  require now < i.intakeAt + 90d else DONATION_DUE
  return update items[item] { tagPrice }
mutation payOut(item: items):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  i = items[item] ! else NOT_FOUND
  require i.status = 'sold' else WRONG_STATUS
  return update items[item] { status: 'paid_out', paidAt: now }
mutation collect(item: items):
  i = items[item] ! else NOT_FOUND
  require i.consignor = viewer and exists roles[viewer, role = 'consignor'] else OWN_ITEM_ONLY
  require i.status = 'intake' or i.status = 'on_rack' else WRONG_STATUS
  require now < i.intakeAt + 90d else COLLECTION_CLOSED
  return update items[item] { status: 'collected' }
job donate():
  for i in items:
    if (i.status = 'intake' or i.status = 'on_rack') and now >= i.intakeAt + 90d:
      update items[i.id] { status: 'donated' }
schedule donationSweep every 1m: donate

-- Independent product intent: consignors have no audience on anyone else's rows.
invariant items.read only .consignor = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'staff']
invariant items.split read only .consignor = viewer or exists roles[viewer, role = 'owner']
invariant profiles.read only .principal = viewer or exists roles[viewer, role = 'owner']
invariant roles.role write only viewer = 'service:operator'
invariant items.tagPrice update only exists roles[viewer, role = 'owner']
invariant items.reprice only exists roles[viewer, role = 'owner']
invariant items.payOut only exists roles[viewer, role = 'owner']
invariant items.rack only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'staff']
invariant items.sell only exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'staff']
invariant items.collect only .consignor = viewer

invariant items.photo update only exists roles[viewer, role = 'owner']
invariant items.detailPhoto update only exists roles[viewer, role = 'owner']
