-- Sports Memorabilia Consignments.
-- Roles: owner (shop owner), manager (consignment manager), staff, seller.
-- A manager opens each item with a certificate scan and the asking price.
-- Staff see photos/serial/condition but not seller phone, reserve or
-- commission; only manager/owner see those. Sellers see only their own items
-- and offers. The board moves inspected -> listed -> sold; unsold items go
-- back (returned) after 90 days via a daily sweep. Only the owner can accept
-- an offer below the reserve, with the reason recorded.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'manager', 'staff', 'seller')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table items:
  seller: principal
  title: text 1..120
  category: enum('jersey', 'ball', 'other')
  photos: [image <=5000000] <=4 ?
  certificate: image <=10000000 ?
  serial: text 1..60
  condition: text 1..500
  askingPrice: money USD
  reservePrice: money USD
  commissionPct: int 0..50
  sellerPhone: text 7..20
  status: enum('inspected', 'listed', 'sold', 'returned') default 'inspected'
  listedAt: time ?
  returnBy: time ?
  belowReserveReason: text 1..300 ?
  unique serial
  immutable seller, serial
  read <- .seller = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff'] or viewer = 'service:operator'
  read (sellerPhone, reservePrice, commissionPct, certificate) <- .seller = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
  update (old, next) <- (exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']) and (old.status = next.status or (old.status = 'inspected' and (next.status = 'listed' or next.status = 'returned')) or (old.status = 'listed' and (next.status = 'sold' or next.status = 'returned')))
  online only

table offers:
  item: items
  seller: principal
  buyerName: text 1..80
  amount: money USD
  status: enum('pending', 'accepted', 'rejected') default 'pending'
  createdAt: time default now
  immutable item, seller
  read <- .seller = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff'] or viewer = 'service:operator'
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff'] or viewer = 'service:operator'
  update <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
  cap 500 by item
  online only

-- Operator-provisioned roster. Signup creates an account with no role.
mutation provision(principal: principal, role: enum('owner', 'manager', 'staff', 'seller')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

-- The consignment manager (or owner) opens an item with its certificate scan.
mutation openItem(seller: principal, title: text 1..120, category: enum('jersey', 'ball', 'other'), photos: [image <=5000000] <=4 ?, certificate: image <=10000000, serial: text 1..60, condition: text 1..500, askingPrice: money USD, reservePrice: money USD, commissionPct: int 0..50, sellerPhone: text 7..20):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else MANAGER_ONLY
  require exists roles[principal = seller, role = 'seller'] else NOT_SELLER
  require askingPrice >= reservePrice else BAD_PRICES
  return insert items { seller, title, category, photos, certificate, serial, condition, askingPrice, reservePrice, commissionPct, sellerPhone, status: 'inspected' }

-- Inspected -> listed; the 90-day clock starts here.
mutation listItem(item: items):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else MANAGER_ONLY
  i = items[item] ! else NOT_FOUND
  require i.status = 'inspected' else BAD_STATUS
  update items[item] { status: 'listed', listedAt: now, returnBy: now + 90d }
  return null

-- Shop floor records a buyer's offer on a listed item.
mutation recordOffer(item: items, buyerName: text 1..80, amount: money USD):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff'] or viewer = 'service:operator' else STAFF_ONLY
  i = items[item] ! else NOT_FOUND
  require i.status = 'listed' else NOT_LISTED
  return insert offers { item, seller: i.seller, buyerName, amount, status: 'pending' }

-- Accepting below the reserve needs the owner plus a recorded reason.
mutation acceptOffer(offer: offers, reason: text 1..300 ?):
  o = offers[offer] ! else NOT_FOUND
  require o.status = 'pending' else OFFER_CLOSED
  i = items[o.item] ! else NOT_FOUND
  require i.status = 'listed' else NOT_LISTED
  reserve = i.reservePrice
  require reserve != null else NOT_FOUND
  below = o.amount < reserve
  require not below or exists roles[principal = viewer, role = 'owner'] else OWNER_BELOW_RESERVE
  require not below or reason != null else REASON_REQUIRED
  require below or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else MANAGER_ONLY
  update offers[offer] { status: 'accepted' }
  update items[o.item] { status: 'sold', belowReserveReason: reason if below else null }
  return null

mutation rejectOffer(offer: offers):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else MANAGER_ONLY
  o = offers[offer] ! else NOT_FOUND
  require o.status = 'pending' else OFFER_CLOSED
  update offers[offer] { status: 'rejected' }
  return null

-- Manual return of an unsold listed item; the sweep does it automatically.
mutation returnItem(item: items):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else MANAGER_ONLY
  i = items[item] ! else NOT_FOUND
  require i.status = 'listed' else BAD_STATUS
  update items[item] { status: 'returned' }
  return null

job sweepReturns():
  for i in items by .id:
    if i.status = 'listed' and i.returnBy != null and i.returnBy <= now:
      update items[i.id] { status: 'returned' }

schedule returnSweep every 1d at 03:00: sweepReturns

query myRole():
  return roles[viewer]

query sellerDirectory(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else MANAGER_ONLY
  return roles where .role = 'seller' last 50 by .id after c

-- Showroom board, live: everything for the shop team, own rows for sellers.
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff'] or viewer = 'service:operator':
    return items last 50 by .id after c
  return items where .seller = viewer last 50 by .id after c

query myItems(c: cursor ?):
  return items where .seller = viewer last 50 by .id after c

query itemDetail(item: items):
  return items[item]

query offersFor(item: items, c: cursor ?):
  return offers where .item = item last 50 by .id after c

-- Privacy intent, stated apart from the enforcing rules above.
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:operator'
invariant items.read only .seller = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:operator' or exists roles[principal = viewer, role = 'staff'] or viewer = 'service:operator'
invariant items.sellerPhone read only .seller = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:operator'
invariant items.reservePrice read only .seller = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:operator'
invariant items.commissionPct read only .seller = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:operator'
invariant items.certificate read only .seller = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:operator'
invariant items.insert only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
invariant offers.read only .seller = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or viewer = 'service:operator' or exists roles[principal = viewer, role = 'staff'] or viewer = 'service:operator'
