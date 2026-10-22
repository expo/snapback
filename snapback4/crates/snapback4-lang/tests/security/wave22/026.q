use identity password

table roles:
  principal: principal
  role: enum('member', 'proShop', 'stringer', 'headPro')
  name: text 1..120 default 'Club member'
  unique principal
  immutable principal
  read <- .principal = viewer or (exists roles[viewer, role = 'proShop'] or exists roles[viewer, role = 'stringer'] or exists roles[viewer, role = 'headPro']) or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('member', 'proShop', 'stringer', 'headPro'), name: text 1..120):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query myRole():
  return roles[viewer]

query members(c: cursor ?):
  require (exists roles[viewer, role = 'proShop'] or exists roles[viewer, role = 'stringer'] or exists roles[viewer, role = 'headPro']) else NOT_STAFF
  return roles where .role = 'member' first 100 by .id after c

table rackets:
  member: principal
  label: text 1..100
  photo: image <=5000000
  string: enum('Synthetic gut', 'Multifilament', 'Polyester')
  tension: int 40..70
  priceCents: int 1500..4500
  droppedAt: time
  dueAt: time
  cracked: bool
  acknowledgment: text 10..1000 ?
  acknowledgedAt: time ?
  approvedBy: principal ?
  approvedAt: time ?
  status: enum('waiting', 'strung', 'ready', 'backroom', 'pickedUp') default 'waiting'
  strungAt: time ?
  readyAt: time ?
  storageAt: time ?
  pickedUpAt: time ?
  discountCents: int 0..900 default 0
  storageCents: int 0..1000 default 0
  immutable member, label, photo, string, tension, priceCents, droppedAt, dueAt, cracked
  read <- .member = viewer or (exists roles[viewer, role = 'proShop'] or exists roles[viewer, role = 'stringer'] or exists roles[viewer, role = 'headPro'])
  insert <- exists roles[viewer, role = 'proShop'] or exists roles[viewer, role = 'headPro']
  update <- .member = viewer or (exists roles[viewer, role = 'proShop'] or exists roles[viewer, role = 'stringer'] or exists roles[viewer, role = 'headPro'])
  online only

-- Members may read only their own racket, photo and history. The described
-- staff workflows require the shared board, including prices and crack evidence.
invariant rackets.read only .member = viewer or (exists roles[viewer, role = 'proShop'] or exists roles[viewer, role = 'stringer'] or exists roles[viewer, role = 'headPro'])
invariant rackets.approveCrack only exists roles[viewer, role = 'headPro']
invariant roles.role write only viewer = 'service:operator'

query board(c: cursor ?):
  require exists roles[viewer] else NO_ROLE
  if exists roles[viewer, role = 'member']:
    return rackets where .member = viewer last 100 by .id after c
  return rackets last 100 by .id after c

query racket(racket: rackets):
  return rackets[racket]

mutation dropOff(member: principal, label: text 1..100, photo: image <=5000000, string: enum('Synthetic gut', 'Multifilament', 'Polyester'), tension: int 40..70, cracked: bool):
  require exists roles[viewer, role = 'proShop'] or exists roles[viewer, role = 'headPro'] else NOT_SHOP
  require exists roles[member, role = 'member'] else NOT_MEMBER
  price = 2500
  if string = 'Multifilament':
    price = 3500
  if string = 'Polyester':
    price = 3000
  return insert rackets { member, label, photo, string, tension, priceCents: price, droppedAt: now, dueAt: now + 3d, cracked }

mutation acknowledgeCrack(racket: rackets, acknowledgment: text 10..1000):
  r = rackets[racket] ! else NOT_FOUND
  require r.member = viewer else NOT_MEMBER_OWNER
  require r.cracked and r.status = 'waiting' and r.approvedBy = null else NOT_AWAITING_ACK
  update rackets[racket] { acknowledgment, acknowledgedAt: now }

mutation approveCrack(racket: rackets):
  require exists roles[viewer, role = 'headPro'] else NOT_HEAD_PRO
  r = rackets[racket] ! else NOT_FOUND
  require r.cracked and r.status = 'waiting' and r.approvedBy = null else NOT_AWAITING_APPROVAL
  require r.acknowledgment != null else ACK_REQUIRED
  update rackets[racket] { approvedBy: viewer, approvedAt: now }

mutation markStrung(racket: rackets):
  require exists roles[viewer, role = 'stringer'] or exists roles[viewer, role = 'headPro'] else NOT_STRINGER
  r = rackets[racket] ! else NOT_FOUND
  require r.status = 'waiting' else NOT_WAITING
  require not r.cracked or r.approvedBy != null else CRACK_NOT_APPROVED
  update rackets[racket] { status: 'strung', strungAt: now, discountCents: r.priceCents / 5 if now > r.dueAt else 0 }

mutation markReady(racket: rackets):
  require exists roles[viewer, role = 'stringer'] or exists roles[viewer, role = 'headPro'] else NOT_STRINGER
  r = rackets[racket] ! else NOT_FOUND
  require r.status = 'strung' else NOT_STRUNG
  update rackets[racket] { status: 'ready', readyAt: now, storageAt: now + 30d }

mutation pickUp(racket: rackets):
  require exists roles[viewer, role = 'proShop'] or exists roles[viewer, role = 'headPro'] else NOT_SHOP
  r = rackets[racket] ! else NOT_FOUND
  require r.status = 'ready' or r.status = 'backroom' else NOT_READY
  charge = r.storageCents
  if r.storageAt != null and now >= r.storageAt:
    charge = 1000
  update rackets[racket] { status: 'pickedUp', pickedUpAt: now, storageCents: charge }

job enforceDeadlines(periodStart: time, periodEnd: time):
  for r in rackets by .id:
    if r.status = 'waiting' and now > r.dueAt and r.discountCents = 0:
      update rackets[r.id] { discountCents: r.priceCents / 5 }
    if r.status = 'ready' and r.storageAt != null and now >= r.storageAt:
      update rackets[r.id] { status: 'backroom', storageCents: 1000 }

schedule deadlines every 1m: enforceDeadlines
