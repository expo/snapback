-- Personal Chef Bookings.
--
-- Roles: owner (agency owner), desk (booking desk), chef, client.
-- A dinner is opened by the desk with the signed-menu photo and the quoted
-- price per guest. Chefs see menu/allergy/kitchen photos but never the
-- client's phone, deposit or price, which only desk + owner (and the owning
-- client, for their own dinner) may read. Clients read only their own
-- dinners. Status flows planned -> shopped -> cooking -> served; cancelling
-- within 7 days of the dinner date keeps the deposit; only the owner can
-- approve a refund, recording the reason.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'desk', 'chef', 'client')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table dinners:
  client: principal
  title: text 1..80
  menu: text 1..2000
  allergyNotes: text <=500 ?
  allergyAttention: enum('review allergy notes', 'ask about allergies') write <- exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner']
  status: enum('planned', 'shopped', 'cooking', 'served', 'cancelled') default 'planned'
  dinnerDate: time
  pricePerGuest: money USD
  deposit: money USD
  depositKept: bool default false
  phone: text 5..30 ?
  menuPhoto: image <=5000000
  kitchenPhotos: [image <=5000000] <=4 ?
  refundApproved: bool default false
  refundReason: text 1..500 ?
  immutable client, menuPhoto
  -- Only desk, owner (and the owning client) read money/phone/refund fields.
  read (pricePerGuest, deposit, phone, refundReason) <- .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  read <- .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'chef']
  insert <- exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner']
  update <- .client = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'chef']
  cap 200 by client
  online only

-- Operator-provisioned roster. First admin/roles come from the local
-- operator (service:operator); there is no self-promotion path.
mutation provision(principal: principal, role: enum('owner', 'desk', 'chef', 'client')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

-- Desk/owner see client principals so they can open dinners for them.
query clientRoster():
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner'] else NOT_DESK
  return roles where .role = 'client' first 100 by .id

-- Kitchen board: staff see every dinner, clients only their own.
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'chef']:
    return dinners last 50 by .id after c
  return dinners where .client = viewer last 50 by .id after c

query dinner(d: dinners):
  return dinners[d]

mutation createDinner(client: principal, title: text 1..80, menu: text 1..2000, allergyNotes: text <=500 ?, dinnerDate: time, pricePerGuest: money USD, deposit: money USD, phone: text 5..30 ?, menuPhoto: image <=5000000, kitchenPhotos: [image <=5000000] <=4 ?):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner'] else NOT_DESK
  require exists roles[principal = client, role = 'client'] else NOT_A_CLIENT 'Dinners open for client accounts only.'
  require dinnerDate > now else IN_THE_PAST 'Dinners open for future dates only.'
  return insert dinners { client, title, menu, allergyNotes, dinnerDate, pricePerGuest, deposit, phone, menuPhoto, kitchenPhotos, allergyAttention: 'review allergy notes' if allergyNotes != null and allergyNotes != '' else 'ask about allergies' }

-- Desk/owner edit the booking details (chefs use the kitchen mutations).
mutation updateDetails(d: dinners, title: text 1..80, menu: text 1..2000, allergyNotes: text <=500 ?, dinnerDate: time, pricePerGuest: money USD, deposit: money USD, phone: text 5..30 ?):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner'] else NOT_DESK
  row = dinners[d] ! else NOT_FOUND
  require row.status != 'cancelled' and row.status != 'served' else CLOSED 'Cancelled and served dinners are closed.'
  update dinners[d] { title, menu, allergyNotes, dinnerDate, pricePerGuest, deposit, phone }
  return null

-- Kitchen photos: chefs document the work; desk/owner may too.
mutation addKitchenPhotos(d: dinners, kitchenPhotos: [image <=5000000] <=4):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'chef'] else NOT_STAFF
  row = dinners[d] ! else NOT_FOUND
  require row.status != 'cancelled' and row.status != 'served' else CLOSED 'Cancelled and served dinners are closed.'
  update dinners[d] { kitchenPhotos }
  return null

-- One step forward along planned -> shopped -> cooking -> served.
mutation setStatus(d: dinners, status: enum('shopped', 'cooking', 'served')):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'chef'] else NOT_STAFF
  row = dinners[d] ! else NOT_FOUND
  require row.status = 'planned' and status = 'shopped' or row.status = 'shopped' and status = 'cooking' or row.status = 'cooking' and status = 'served' else BAD_TRANSITION 'Status moves one step forward.'
  update dinners[d] { status }
  return null

-- Desk, owner, or the owning client cancel. Within 7 days keeps deposit.
mutation cancelDinner(d: dinners):
  row = dinners[d] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner'] or row.client = viewer else NOT_ALLOWED
  require row.status != 'cancelled' and row.status != 'served' else CLOSED 'Cancelled and served dinners are closed.'
  kept = row.dinnerDate - now <= 7d
  update dinners[d] { status: 'cancelled', depositKept: kept }
  return null

-- Only the desk or owner change the allergy attention label afterwards;
-- chefs and clients cannot. Closed dinners keep their label.
mutation setAllergyAttention(d: dinners, allergyAttention: enum('review allergy notes', 'ask about allergies')):
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner'] else NOT_DESK
  row = dinners[d] ! else NOT_FOUND
  require row.status != 'cancelled' and row.status != 'served' else CLOSED 'Cancelled and served dinners are closed.'
  update dinners[d] { allergyAttention }
  return null

-- Existing dinners adopt the label from their notes: written notes ask for a
-- review, missing or blank notes ask the client. New dinners derive the same
-- value when opened, and no other detail changes.
backfill dinners attention(allergyNotes: text <=500 ?): {allergyAttention: 'review allergy notes' if allergyNotes != null and allergyNotes != '' else 'ask about allergies'}

-- Only the owner approves a refund of a kept deposit, recording the reason.
mutation approveRefund(d: dinners, reason: text 1..500):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  row = dinners[d] ! else NOT_FOUND
  require row.status = 'cancelled' else NOT_CANCELLED 'Refunds follow cancellation.'
  require row.depositKept else NO_KEPT_DEPOSIT 'Only a kept deposit can be refunded.'
  require not row.refundApproved else ALREADY_REFUNDED
  update dinners[d] { refundApproved: true, refundReason: reason }
  return null

-- Spec intent, stated independently from the enforcement rules above.
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
invariant dinners.read only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'chef']
invariant dinners.pricePerGuest read only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant dinners.deposit read only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant dinners.phone read only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant dinners.refundReason read only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
invariant dinners.insert only exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner']
invariant dinners.update only .client = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'chef']
invariant dinners.allergyAttention update only exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'owner']
