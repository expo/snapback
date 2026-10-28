-- Science Show Parties.
-- Roles: owner (company owner), booking (booking desk), presenter, client.
-- Only booking/owner open parties and see phone/deposit/price.
-- Presenters see show columns (experiments, allergy notes, venue photos) but not
-- phone/deposit/price. Clients see only their own parties.
-- Lifecycle: planned -> onsite -> home; cancel keeps deposit within 7 days of
-- the party date; only the owner approves refunds, with a recorded reason.

use identity password

table roles:
  principal: principal
  role: enum('owner', 'booking', 'presenter', 'client')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'booking', 'presenter', 'client')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

table parties:
  client: principal
  childName: text 1..80
  partyDate: time
  phone: text 7..24 ? write <- exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
  pricePerChild: int 0.. ? write <- exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
  deposit: int 0.. ? write <- exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
  safetyAgreement: image <=5000000 ? write <- exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
  venuePhotos: [image <=5000000] <=6 ?
  experiments: text <=2000 ?
  allergyNotes: text <=1000 ?
  status: enum('planned', 'onsite', 'home', 'cancelled') default 'planned'
  depositKept: bool default false
  cancelledAt: time ?
  refundApproved: bool default false
  refundReason: text 1..500 ? write <- exists roles[principal = viewer, role = 'owner']
  immutable client
  read <- .client = viewer or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'presenter'] or exists roles[principal = viewer, role = 'owner']
  read (phone, pricePerChild, deposit) <- exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'presenter'] or .client = viewer
  delete <- exists roles[principal = viewer, role = 'owner']
  online only

-- The show board: staff see every party, clients see only their own.
-- Live queries keep it updating as parties move planned -> onsite -> home.
-- Booking desk and owner see the roster to pick a client for a new party.
query roster(c: cursor ?):
  require exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  return roles last 100 by .id after c

query board(c: cursor ?):
  require exists roles[principal = viewer] else NOT_ENROLLED
  if exists roles[principal = viewer, role = 'client']:
    return parties where .client = viewer last 50 by .id after c
  return parties last 50 by .id after c

query party(party: parties):
  return parties[party]

-- Booking desk (or owner) opens a party with the signed safety agreement
-- photo and the quoted price per child.
mutation openParty(client: principal, childName: text 1..80, partyDate: time, phone: text 7..24, pricePerChild: int 0.., deposit: int 0.., safetyAgreement: image <=5000000 ?):
  require exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner'] else NOT_BOOKING
  require exists roles[principal = client, role = 'client'] else NOT_CLIENT
  require partyDate > now else DATE_NOT_FUTURE
  return insert parties { client, childName, partyDate, phone, pricePerChild, deposit, safetyAgreement }

-- Presenters (or booking/owner) maintain the show columns.
mutation updateShow(party: parties, experiments: text <=2000 ?, allergyNotes: text <=1000 ?, venuePhotos: [image <=5000000] <=6 ?):
  p = parties[party] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'presenter'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner'] else NOT_SHOW_CREW
  update parties[party] { experiments, allergyNotes, venuePhotos }
  return null

-- The crew moves the show forward: planned -> onsite -> home.
mutation moveStatus(party: parties, status: enum('onsite', 'home')):
  p = parties[party] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'presenter'] or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner'] else NOT_SHOW_CREW
  require p.status != 'cancelled' and p.status != 'home' else ALREADY_CLOSED
  require p.status = 'planned' and status = 'onsite' or p.status = 'onsite' and status = 'home' else BAD_TRANSITION
  update parties[party] { status }
  return null

-- The client (own party), booking desk or owner may cancel. Cancelling within
-- seven days of the party date keeps the deposit.
mutation cancelParty(party: parties):
  p = parties[party] ! else NOT_FOUND
  require p.client = viewer or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner'] else NOT_ALLOWED
  require p.status != 'cancelled' else ALREADY_CANCELLED
  require p.status != 'home' else ALREADY_CLOSED
  kept = now >= p.partyDate - 7d
  update parties[party] { status: 'cancelled', cancelledAt: now, depositKept: kept }
  return null

-- Only the company owner approves a refund of a kept deposit, with the reason
-- recorded on the party.
mutation approveRefund(party: parties, reason: text 1..500):
  p = parties[party] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  require p.status = 'cancelled' else NOT_CANCELLED
  require p.depositKept else NO_DEPOSIT_KEPT
  require not p.refundApproved else ALREADY_REFUNDED
  update parties[party] { refundApproved: true, refundReason: reason }
  return null

invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'booking'] or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
invariant parties.read only .client = viewer or exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'presenter'] or exists roles[principal = viewer, role = 'owner']
invariant parties.phone read only exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
invariant parties.pricePerChild read only exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
invariant parties.deposit read only exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
invariant parties.insert only exists roles[principal = viewer, role = 'booking'] or exists roles[principal = viewer, role = 'owner']
invariant parties.approveRefund only exists roles[principal = viewer, role = 'owner']
