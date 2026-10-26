-- Gramophone Restorations: a phonograph workshop.
-- Roles: owner (gramophone owner / customer), technician (shop staff),
-- shop_owner (the workshop owner). Provisioned by the local operator.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'technician', 'shop_owner')
  unique principal
  immutable principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'technician', 'shop_owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- One row per gramophone left at the shop.
table gramophones:
  owner: principal
  label: text 1..80
  hornPhoto: image <=5000000
  motorPhoto: image <=5000000
  cabinetPhoto: image <=5000000
  quotePrice: money USD
  care: enum('routine', 'extra')
  quoteCreatedAt: time default now
  quoteStatus: enum('pending', 'approved', 'returned') default 'pending'
  stage: enum('intake', 'teardown', 'cleaning', 'rebuild', 'playtest', 'ready', 'collected', 'returned') default 'intake'
  readyAt: time ?
  collectedAt: time ?
  storageCents: int default 0
  soundboxConsent: text 1..2000 ?
  soundboxApproved: bool default false
  immutable owner, quoteCreatedAt
  immutable soundboxConsent when .soundboxApproved = true
  read <- .owner = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
  insert <- exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
  update <- .owner = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
  online only

-- Existing gramophones predate the care category: extra care at $1,000+,
-- routine care below. Photos, quote and restoration progress are untouched.
backfill gramophones careHistory(quotePrice: money USD): {care: 'extra' if quotePrice >= 100000 else 'routine'}

query myGramophones(c: cursor ?):
  return gramophones where .owner = viewer last 50 by .id after c

query shopBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'shop_owner'] else NOT_STAFF
  return gramophones last 50 by .id after c

query gramophoneDetail(id: gramophones):
  return gramophones[id]

-- Intake tech logs a gramophone with photos of horn, motor and cabinet plus the quoted price,
-- choosing its care category. Legacy callers that cannot name a category get
-- the migration rule (extra care at $1,000+, routine below) as the fallback.
mutation logGramophone(owner: principal, label: text 1..80, hornPhoto: image <=5000000, motorPhoto: image <=5000000, cabinetPhoto: image <=5000000, quotePrice: money USD, care: enum('routine', 'extra') ?):
  require exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'shop_owner'] else NOT_STAFF
  return insert gramophones { owner, label, hornPhoto, motorPhoto, cabinetPhoto, quotePrice, care: care ?? ('extra' if quotePrice >= 100000 else 'routine') }

-- The owner approves the quote within 21 days or the gramophone is returned.
mutation approveQuote(id: gramophones):
  g = gramophones[id] ! else NOT_FOUND
  require g.owner = viewer else NOT_OWNER
  require g.quoteStatus = 'pending' else QUOTE_CLOSED 'This quote is already decided.'
  require now <= g.quoteCreatedAt + 21d else QUOTE_EXPIRED 'The 21-day approval window has passed; the gramophone will be returned.'
  update gramophones[id] { quoteStatus: 'approved' }
  return null

-- Technicians move gramophones teardown -> spring cleaning -> rebuild -> play test -> ready.
mutation advanceStage(id: gramophones, next: enum('teardown', 'cleaning', 'rebuild', 'playtest', 'ready')):
  require exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'shop_owner'] else NOT_STAFF
  g = gramophones[id] ! else NOT_FOUND
  require g.quoteStatus = 'approved' else QUOTE_NOT_APPROVED 'The owner must approve the quote first.'
  require g.stage != 'returned' and g.stage != 'collected' else CLOSED 'This gramophone is closed.'
  require g.stage = 'intake' and next = 'teardown' or g.stage = 'teardown' and next = 'cleaning' or g.stage = 'cleaning' and next = 'rebuild' or g.stage = 'rebuild' and next = 'playtest' or g.stage = 'playtest' and next = 'ready' else BAD_STAGE 'Move one step forward along intake, teardown, cleaning, rebuild, playtest, ready.'
  if next = 'ready':
    update gramophones[id] { stage: next, readyAt: now }
  else:
    update gramophones[id] { stage: next }
  return null

-- The owner records written consent for replacing an original soundbox.
mutation recordConsent(id: gramophones, consent: text 1..2000):
  g = gramophones[id] ! else NOT_FOUND
  require g.owner = viewer else NOT_OWNER
  require g.stage != 'returned' and g.stage != 'collected' else CLOSED 'This gramophone is closed.'
  update gramophones[id] { soundboxConsent: consent }
  return null

-- Only the workshop owner approves replacing an original soundbox.
mutation approveSoundbox(id: gramophones):
  require exists roles[principal = viewer, role = 'shop_owner'] else NOT_SHOP_OWNER
  g = gramophones[id] ! else NOT_FOUND
  require (g.soundboxConsent ?? '') != '' else NO_CONSENT 'Record the owner\u2019s written consent first.'
  update gramophones[id] { soundboxApproved: true }
  return null

-- After intake, only the workshop owner may change the care category.
mutation setCareCategory(id: gramophones, care: enum('routine', 'extra')):
  require exists roles[principal = viewer, role = 'shop_owner'] else NOT_SHOP_OWNER
  g = gramophones[id] ! else NOT_FOUND
  update gramophones[id] { care }
  return null

-- Collecting a gramophone ready more than 30 days is charged storage (200 cents per late day).
mutation collectGramophone(id: gramophones):
  g = gramophones[id] ! else NOT_FOUND
  require g.stage = 'ready' else NOT_READY 'This gramophone is not ready for collection.'
  require g.owner = viewer or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'shop_owner'] else NOT_ALLOWED
  lateDays = (now - (g.readyAt ?? now) - 30d) / 1d
  fee = lateDays * 200 if lateDays > 0 else 0
  update gramophones[id] { stage: 'collected', collectedAt: now, storageCents: fee }
  return null

-- Quotes not approved within 21 days: the gramophone is returned.
job expireQuotes(periodStart: time, periodEnd: time):
  for g in gramophones:
    if g.quoteStatus = 'pending' and g.quoteCreatedAt + 21d < periodEnd:
      update gramophones[g.id] { quoteStatus: 'returned', stage: 'returned' }

-- Restored gramophones uncollected 30 days after the ready notice accrue storage.
job storageSweep(periodStart: time, periodEnd: time):
  for g in gramophones:
    if g.stage = 'ready' and (g.readyAt ?? periodEnd) + 30d < periodEnd:
      lateDays = (periodEnd - (g.readyAt ?? periodEnd) - 30d) / 1d
      if lateDays > 0:
        update gramophones[g.id] { storageCents: lateDays * 200 }

schedule quoteExpiry every 1d at 03:00: expireQuotes
schedule storageBilling every 1d at 04:00: storageSweep

-- Spec: owners see only their own gramophones and quotes; staff see the whole
-- shop board; only the workshop owner approves a soundbox replacement.
invariant gramophones.read only .owner = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
invariant gramophones.insert only exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
invariant gramophones.quotePrice read only .owner = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
invariant gramophones.care update only exists roles[viewer, role = 'shop_owner']
invariant roles.read only .principal = viewer
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
