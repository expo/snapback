-- Henna Artist Bookings.
-- Roles: agency owner, booking manager, artist, client.
-- Real password identity; roles are operator-provisioned (service:operator),
-- never self-claimed.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'manager', 'artist', 'client')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- One booking per wedding event. Sensitive columns (phone, contract, price)
-- are visible only to the booking manager and the agency owner; artists see
-- the working columns; clients see only their own rows (and not the price).
table bookings:
  client: principal
  artist: principal ?
  status: enum('trial', 'confirmed', 'onsite', 'done', 'cancelled') default 'trial'
  trialPhotos: [text <=500] <=8 ?
  skinNotes: text <=2000 ?
  partySchedule: text <=2000 ?
  clientPhone: text <=30 ?
  venueContract: text <=2000 ?
  price: int 0..100000000 ?
  eventAt: time
  depositKept: bool default false
  cancelledAt: time ?
  extraArtist: bool default false
  extraReason: text <=500 ?
  immutable client, eventAt
  read <- .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'artist']
  read (clientPhone, venueContract, price) <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
  update <- .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'artist']
  online only

-- Spec privacy intent, stated independently from the rules above.
invariant bookings.read only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'artist']
invariant bookings.clientPhone read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
invariant bookings.venueContract read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
invariant bookings.price read only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
invariant bookings.insert only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
invariant bookings.update only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'artist']
invariant bookings.approveExtraArtist only exists roles[principal = viewer, role = 'owner']
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
invariant roles.insert only viewer = 'service:operator'
invariant roles.provision only viewer = 'service:operator'

mutation provision(principal: principal, role: enum('owner', 'manager', 'artist', 'client')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- Day board: managers, owners and artists see every booking; clients see
-- only their own. One branching page so both answers are complete.
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'artist']:
    return bookings first 50 by .eventAt after c
  return bookings where .client = viewer first 50 by .eventAt after c

query bookingDetail(booking: bookings):
  return bookings[booking]

-- Staff pickers for the booking form (create + assign).
query clientList():
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return roles where .role = 'client' last 100 by .id

query artistList():
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return roles where .role = 'artist' last 100 by .id

-- The booking manager opens each booking with trial photos and quoted price.
mutation openBooking(client: principal, eventAt: time, price: int 0..100000000, clientPhone: text <=30 ?, venueContract: text <=2000 ?, trialPhotos: [text <=500] <=8 ?, skinNotes: text <=2000 ?, partySchedule: text <=2000 ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  require eventAt > now else BAD_DATE 'The event must be in the future.'
  return insert bookings { client, eventAt, price, clientPhone, venueContract, trialPhotos, skinNotes, partySchedule }

mutation assignArtist(booking: bookings, artist: principal):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  require exists roles[principal = artist, role = 'artist'] else NOT_ARTIST 'The assignee is not an artist.'
  update bookings[booking] { artist }
  return null

mutation updatePrep(booking: bookings, trialPhotos: [text <=500] <=8 ?, skinNotes: text <=2000 ?, partySchedule: text <=2000 ?, clientPhone: text <=30 ?, venueContract: text <=2000 ?, price: int 0..100000000 ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  update bookings[booking] { trialPhotos, skinNotes, partySchedule, clientPhone, venueContract, price }
  return null

-- Day board movement: trial -> confirmed -> onsite -> done. Managers and
-- owners drive every step; artists move the day-of steps (onsite, done).
mutation moveStatus(booking: bookings, status: enum('confirmed', 'onsite', 'done')):
  b = bookings[booking] ! else NOT_FOUND
  require b.status != 'cancelled' and b.status != 'done' else CLOSED 'This booking is closed.'
  isMgr = exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager']
  isArt = exists roles[principal = viewer, role = 'artist']
  ok = (b.status = 'trial' and status = 'confirmed' and isMgr) or (b.status = 'confirmed' and status = 'onsite' and (isMgr or isArt)) or (b.status = 'onsite' and status = 'done' and (isMgr or isArt))
  require ok else BAD_TRANSITION 'This status change is not allowed.'
  update bookings[booking] { status }
  return null

-- Cancelling within 30 days of the event keeps the deposit.
mutation cancelBooking(booking: bookings):
  b = bookings[booking] ! else NOT_FOUND
  require b.status != 'done' and b.status != 'cancelled' else CLOSED 'This booking is already closed.'
  require b.client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED 'Only the client, manager or owner may cancel.'
  keeps = b.eventAt - now <= 30d
  update bookings[booking] { status: 'cancelled', depositKept: keeps, cancelledAt: now }
  return null

-- Only the agency owner can approve a free extra artist, with reason recorded.
mutation approveExtraArtist(booking: bookings, reason: text 1..500):
  b = bookings[booking] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the agency owner can approve a free extra artist.'
  update bookings[booking] { extraArtist: true, extraReason: reason }
  return null
