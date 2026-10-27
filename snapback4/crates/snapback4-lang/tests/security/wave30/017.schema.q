-- Petting Zoo Parties: a mobile petting zoo's booking backend.
--
-- Roles (see roles table): owner (farm owner), desk (booking desk),
-- handler (animal handler), client (party family). Two users per role minimum.
-- Auth: real password accounts (`use identity password`); roles are
-- provisioned by the local operator (service:operator), never self-claimed.
use identity password

-- Roster: one row per account. Only the local operator writes it.
table roles:
  principal: principal
  role: enum('owner', 'desk', 'handler', 'client')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'desk', 'handler', 'client')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- A party booking. The booking desk opens each party with the signed
-- handling-agreement photo and the quoted price per child.
table parties:
  client: principal
  childName: text 1..80
  phone: text 5..30 write <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  deposit: money USD write <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  pricePerChild: money USD write <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  agreement: image <=5000000
  animals: text 1..500
  allergyNotes: text <=500
  venuePhotos: [image <=5000000] <=4 ?
  venue: text 1..200
  partyDate: time
  status: enum('planned', 'loaded', 'onsite', 'home', 'cancelled') default 'planned'
  depositKept: bool default false
  refundApproved: bool ? write <- exists roles[principal = viewer, role = 'owner']
  refundReason: text <=500 ? write <- exists roles[principal = viewer, role = 'owner']
  by byDate: partyDate
  -- Row audience: the family's own client plus all staff. Sensitive columns
  -- below narrow further; only desk and owner read phone/deposit/price.
  read <- .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'handler']
  read (phone, deposit, pricePerChild) <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk']
  update <- .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'handler']
  immutable client
  online only

-- Staff-only counts for the farm board. Counts disclose activity, granted
-- deliberately; staff already read every row.
view partyCounts: count parties by .status
  read <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'handler']

query statusCount(status: enum('planned', 'loaded', 'onsite', 'home', 'cancelled')):
  return { count: partyCounts[status] }

-- A family's own parties.
query myParties(c: cursor ?):
  return parties where .client = viewer last 20 by .partyDate after c

-- The farm board: every party, staff only.
query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'handler'] else NOT_STAFF
  return parties last 50 by .partyDate after c

-- One party. Row and column rules decide what the caller sees; a hidden
-- party reads null, and hidden columns read null.
query party(party: parties):
  return parties[party]

-- The booking desk (or owner) opens a party for a client family.
mutation openParty(client: principal, childName: text 1..80, phone: text 5..30, deposit: money USD, pricePerChild: money USD, agreement: image <=5000000, animals: text 1..500, allergyNotes: text <=500, venuePhotos: [image <=5000000] <=4 ?, venue: text 1..200, partyDate: time):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] else NOT_DESK
  require partyDate > now else DATE_IN_PAST 'The party date must be in the future.'
  return insert parties { client, childName, phone, deposit, pricePerChild, agreement, animals, allergyNotes, venuePhotos, venue, partyDate }

-- The booking desk (or owner) edits logistics. Money, contact and refund
-- fields are column-gated, so this never touches them.
mutation editParty(party: parties, animals: text 1..500, allergyNotes: text <=500, venue: text 1..200, partyDate: time):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] else NOT_DESK
  t = parties[party] ! else NOT_FOUND
  require partyDate > now else DATE_IN_PAST 'The party date must be in the future.'
  update parties[party] { animals, allergyNotes, venue, partyDate }
  return null

-- Staff move a party along planned -> loaded -> onsite -> home.
mutation advanceStatus(party: parties):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'handler'] else NOT_STAFF
  t = parties[party] ! else NOT_FOUND
  require t.status != 'cancelled' else IS_CANCELLED 'A cancelled party cannot advance.'
  if t.status = 'planned':
    update parties[party] { status: 'loaded' }
  elif t.status = 'loaded':
    update parties[party] { status: 'onsite' }
  elif t.status = 'onsite':
    update parties[party] { status: 'home' }
  else:
    require false else ALREADY_HOME 'This party is already home.'
  return null

-- Cancel a party. A cancellation within seven days of the party date keeps
-- the deposit (server clock, enforced here, not only by a sweep).
mutation cancelParty(party: parties):
  t = parties[party] ! else NOT_FOUND
  require t.client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'desk'] else NOT_ALLOWED 'Only the family, the booking desk or the owner may cancel.'
  require t.status != 'cancelled' and t.status != 'home' else BAD_STATE 'This party cannot be cancelled.'
  kept = t.partyDate - now <= 7d
  update parties[party] { status: 'cancelled', depositKept: kept }
  return null

-- Only the farm owner approves a refund of a kept deposit, with the reason
-- recorded on the party.
mutation approveRefund(party: parties, reason: text 1..500):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the farm owner may approve a refund.'
  t = parties[party] ! else NOT_FOUND
  require t.status = 'cancelled' else NOT_CANCELLED 'Only a cancelled party can be refunded.'
  require t.depositKept else NO_DEPOSIT_KEPT 'There is no kept deposit to refund.'
  require (t.refundApproved ?? false) = false else ALREADY_DECIDED 'This refund was already decided.'
  update parties[party] { refundApproved: true, refundReason: reason }
  return null
