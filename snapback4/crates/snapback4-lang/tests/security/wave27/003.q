-- Vintage Amplifier Repairs.
-- Roles: clerk (logs amplifiers), owner (amplifier customer), technician
-- (bench board + repair stages), shop_owner (rewind approval). Roles are
-- provisioned by the local operator; signup alone grants no role.
use identity password

table roles:
  principal: principal
  role: enum('clerk', 'owner', 'technician', 'shop_owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('clerk', 'owner', 'technician', 'shop_owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal = principal] { principal, role }

query myRole():
  return roles[viewer]

-- One row per amplifier on the bench. Photos are required evidence placed
-- from the clerk's own uploads; the quote price is in minor units (cents).
table amplifiers:
  owner: principal
  make: text 1..80
  model: text 1..80
  serial: text 1..60
  chassisPhoto: image <=5000000 ? write <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shop_owner']
  tubesPhoto: image <=5000000
  serialPhoto: image <=5000000
  quotePrice: money USD
  quoteAt: time
  quoteStatus: enum('pending', 'approved', 'expired') default 'pending'
  stage: enum('quoted', 'approved', 'inspection', 'recapping', 'biasing', 'listening', 'ready', 'picked_up', 'returned_unrepaired', 'sale_offered') default 'quoted'
  readyAt: time ?
  rewindRequested: bool default false
  rewindApproved: bool default false
  rewindCost: money USD ?
  createdAt: time default now
  unique serial else SERIAL_TAKEN 'An amplifier with this serial is already logged.'
  immutable owner, quoteAt, createdAt
  read <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
  -- Rule probes see every roster row, so this also verifies the amplifier
  -- owner is a registered owner even though intake staff cannot read
  -- other users' role rows (a program-level exists would be caller-filtered).
  insert <- (exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shop_owner']) and exists roles[.owner, role = 'owner']
  update <- exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner'] or .owner = viewer
  delete <- deny
  cap 5000
  online only

-- Owners see only their own amplifiers; staff see the live bench board.
query myAmplifiers(c: cursor ?):
  return amplifiers where .owner = viewer last 50 by .id after c

query board(c: cursor ?):
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shop_owner'] else NOT_STAFF 'Bench board is for shop staff.'
  return amplifiers last 50 by .id after c

query amplifierDetail(id: amplifiers):
  return amplifiers[id]

-- Clerk logs an amplifier with photo evidence and the quoted repair price.
mutation logAmplifier(owner: principal, make: text 1..80, model: text 1..80, serial: text 1..60, chassisPhoto: image <=5000000 ?, tubesPhoto: image <=5000000, serialPhoto: image <=5000000, quotePrice: money USD):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shop_owner'] else NOT_CLERK 'Only the bench clerk may log amplifiers.'
  return insert amplifiers { owner, make, model, serial, chassisPhoto, tubesPhoto, serialPhoto, quotePrice, quoteAt: now, quoteStatus: 'pending', stage: 'quoted' }

-- The owner approves the quote within 14 days of the quote date.
mutation approveQuote(id: amplifiers):
  a = amplifiers[id] ! else NOT_FOUND
  require a.owner = viewer else NOT_OWNER 'Only the amplifier owner may approve the quote.'
  require a.stage = 'quoted' and a.quoteStatus = 'pending' else BAD_STATE 'This quote is no longer pending.'
  require now <= a.quoteAt + 14d else QUOTE_EXPIRED 'The 14-day quote approval window has passed.'
  update amplifiers[id] { stage: 'approved', quoteStatus: 'approved' }
  return null

-- Technicians move amplifiers along the bench: approved -> inspection ->
-- recapping -> biasing -> listening. Readiness is a separate step.
mutation advanceStage(id: amplifiers, to: enum('inspection', 'recapping', 'biasing', 'listening')):
  a = amplifiers[id] ! else NOT_FOUND
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner'] else NOT_TECHNICIAN 'Only bench technicians may advance repairs.'
  require (a.stage = 'approved' and to = 'inspection') or (a.stage = 'inspection' and to = 'recapping') or (a.stage = 'recapping' and to = 'biasing') or (a.stage = 'biasing' and to = 'listening') else BAD_TRANSITION 'Amplifiers move one bench stage at a time.'
  update amplifiers[id] { stage: to }
  return null

-- Listening tests done: the amplifier is ready and the 60-day pickup clock starts.
mutation markReady(id: amplifiers):
  a = amplifiers[id] ! else NOT_FOUND
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner'] else NOT_TECHNICIAN 'Only bench technicians may mark readiness.'
  require a.stage = 'listening' else BAD_STATE 'Only amplifiers in listening tests may be marked ready.'
  update amplifiers[id] { stage: 'ready', readyAt: now }
  return null

-- Pickup within 60 days of the ready notice.
mutation recordPickup(id: amplifiers):
  a = amplifiers[id] ! else NOT_FOUND
  require a.owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shop_owner'] else NOT_ENTITLED 'Only the owner or counter staff may record pickup.'
  require a.stage = 'ready' else BAD_STATE 'Only ready amplifiers may be picked up.'
  require a.readyAt != null else BAD_STATE 'This amplifier has no ready notice yet.'
  require now <= a.readyAt + 60d else PICKUP_WINDOW_PASSED 'The 60-day pickup window has passed.'
  update amplifiers[id] { stage: 'picked_up' }
  return null

-- A bench technician asks to rewind an original transformer.
mutation requestRewind(id: amplifiers):
  a = amplifiers[id] ! else NOT_FOUND
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shop_owner'] else NOT_STAFF 'Only shop staff may request a rewind.'
  require a.stage = 'inspection' or a.stage = 'recapping' or a.stage = 'biasing' or a.stage = 'listening' else BAD_STATE 'Rewinds may only be requested while an amplifier is on the bench.'
  require a.rewindRequested = false else ALREADY_REQUESTED 'A rewind is already requested for this amplifier.'
  update amplifiers[id] { rewindRequested: true }
  return null

-- The bench clerk or shop owner may add, replace or remove chassis photos later.
mutation setChassisPhoto(id: amplifiers, photo: image <=5000000 ?):
  a = amplifiers[id] ! else NOT_FOUND
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shop_owner'] else NOT_CLERK 'Only the bench clerk or shop owner may change chassis photos.'
  update amplifiers[id] { chassisPhoto: photo }
  return null

-- Only the shop owner approves rewinding, recording the agreed extra cost.
mutation approveRewind(id: amplifiers, extraCost: money USD):
  a = amplifiers[id] ! else NOT_FOUND
  require exists roles[viewer, role = 'shop_owner'] else NOT_SHOP_OWNER 'Only the shop owner may approve a transformer rewind.'
  require a.rewindRequested = true else REWIND_NOT_REQUESTED 'No rewind has been requested for this amplifier.'
  require a.rewindApproved = false else ALREADY_APPROVED 'This rewind is already approved.'
  update amplifiers[id] { rewindApproved: true, rewindCost: extraCost }
  return null

-- Quotes nobody approved within 14 days come back as returned unrepaired.
job expireQuotes(periodStart: time, periodEnd: time):
  for a in amplifiers:
    if a.stage = 'quoted' and a.quoteStatus = 'pending' and a.quoteAt + 14d < periodEnd:
      update amplifiers[a.id] { quoteStatus: 'expired', stage: 'returned_unrepaired' }

schedule quoteSweep every 1h: expireQuotes

-- Repaired amplifiers not picked up within 60 days are offered back for sale.
job expirePickups(periodStart: time, periodEnd: time):
  for a in amplifiers:
    if a.stage = 'ready' and a.readyAt != null and a.readyAt + 60d < periodEnd:
      update amplifiers[a.id] { stage: 'sale_offered' }

schedule pickupSweep every 1d at 03:00: expirePickups

-- Privacy and authority intent, stated separately from the enforcing rules.
invariant amplifiers.read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
invariant amplifiers.chassisPhoto read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
invariant amplifiers.tubesPhoto read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
invariant amplifiers.serialPhoto read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
invariant amplifiers.quotePrice read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shop_owner']
invariant amplifiers.insert only exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shop_owner']
invariant amplifiers.rewindCost write only exists roles[viewer, role = 'shop_owner']
invariant amplifiers.chassisPhoto update only exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shop_owner']
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
