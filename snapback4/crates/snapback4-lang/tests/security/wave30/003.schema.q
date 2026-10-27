-- Music Box Restorations.
-- Roles: owner (a music box owner / customer), clerk (bench clerk),
-- technician, shopOwner. Every account gets one appRoles row, provisioned by
-- the local operator; the app's own rules then decide each operation.
use identity password

table appRoles:
  principal: principal
  role: enum('owner', 'clerk', 'technician', 'shopOwner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists appRoles[viewer, role = 'clerk'] or exists appRoles[viewer, role = 'technician'] or exists appRoles[viewer, role = 'shopOwner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'clerk', 'technician', 'shopOwner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert appRoles[principal] { principal, role }

query myRole():
  return appRoles[principal = viewer]

-- One row per music box on the bench. Photos are placed uploads; the clerk
-- supplies all three plus the quoted price when logging the box.
table boxes:
  owner: principal
  description: text 1..200
  casePhoto: image <=5000000
  combPhoto: image <=5000000
  pinsPhoto: image <=5000000
  quotePrice: money USD
  quoteAt: time default now
  quoteStatus: enum('pending', 'approved', 'expired') default 'pending'
  stage: enum('inspection', 'comb_repair', 'pin_straightening', 'play_tests', 'complete') default 'inspection'
  status: enum('quoted', 'approved', 'in_repair', 'ready', 'returned_unrepaired', 'picked_up', 'offered_for_sale') default 'quoted'
  readyAt: time ?
  retuneApproved: bool default false
  retuneExtra: money USD ?
  immutable owner, quoteAt
  cap 500 by owner
  read <- .owner = viewer or exists appRoles[viewer, role = 'clerk'] or exists appRoles[viewer, role = 'technician'] or exists appRoles[viewer, role = 'shopOwner']
  insert <- exists appRoles[viewer, role = 'clerk']
  update <- .owner = viewer or exists appRoles[viewer, role = 'clerk'] or exists appRoles[viewer, role = 'technician'] or exists appRoles[viewer, role = 'shopOwner']
  online only

-- Owners read only their own boxes; staff read the boxes they service.
query myBoxes(c: cursor ?):
  return boxes where .owner = viewer last 50 by .id after c

query boxDetail(box: boxes):
  b = boxes[box] ! else NOT_FOUND
  return b

-- The live bench board: technicians, clerks and the shop owner see every box.
query benchBoard(c: cursor ?):
  require exists appRoles[viewer, role = 'technician'] or exists appRoles[viewer, role = 'clerk'] or exists appRoles[viewer, role = 'shopOwner'] else NOT_STAFF
  return boxes last 50 by .id after c

-- Only the bench clerk logs a box: photos of case, comb and cylinder pins
-- plus the quoted repair price, for a registered owner account.
mutation logBox(owner: principal, description: text 1..200, casePhoto: image <=5000000, combPhoto: image <=5000000, pinsPhoto: image <=5000000, quotePrice: money USD):
  require exists appRoles[viewer, role = 'clerk'] else NOT_CLERK
  require exists appRoles[principal = owner, role = 'owner'] else UNKNOWN_OWNER
  return insert boxes { owner, description, casePhoto, combPhoto, pinsPhoto, quotePrice }

-- The owner approves the quote within 14 days of the quote date.
mutation approveQuote(box: boxes):
  require exists appRoles[viewer, role = 'owner'] else NOT_OWNER_ROLE
  b = boxes[box] ! else NOT_FOUND
  require b.owner = viewer else NOT_YOUR_BOX
  require b.quoteStatus = 'pending' else ALREADY_DECIDED
  require now <= b.quoteAt + 14d else QUOTE_EXPIRED
  update boxes[box] { quoteStatus: 'approved', status: 'in_repair' }
  return null

-- Technicians move an approved box along the bench, one stage at a time.
mutation advanceStage(box: boxes, stage: enum('comb_repair', 'pin_straightening', 'play_tests')):
  require exists appRoles[viewer, role = 'technician'] else NOT_TECHNICIAN
  b = boxes[box] ! else NOT_FOUND
  require b.quoteStatus = 'approved' else NOT_APPROVED
  require b.status = 'in_repair' else NOT_IN_REPAIR
  ok = stage = 'comb_repair' and b.stage = 'inspection' or stage = 'pin_straightening' and b.stage = 'comb_repair' or stage = 'play_tests' and b.stage = 'pin_straightening'
  require ok else BAD_TRANSITION
  update boxes[box] { stage }
  return null

-- A box that passes its play tests is ready for pickup.
mutation markReady(box: boxes):
  require exists appRoles[viewer, role = 'technician'] else NOT_TECHNICIAN
  b = boxes[box] ! else NOT_FOUND
  require b.quoteStatus = 'approved' else NOT_APPROVED
  require b.stage = 'play_tests' else NOT_TESTED
  require b.status = 'in_repair' else NOT_IN_REPAIR
  update boxes[box] { stage: 'complete', status: 'ready', readyAt: now }
  return null

-- The clerk (or shop owner) records that the owner picked the box up.
mutation recordPickup(box: boxes):
  require exists appRoles[viewer, role = 'clerk'] or exists appRoles[viewer, role = 'shopOwner'] else NOT_STAFF
  b = boxes[box] ! else NOT_FOUND
  require b.status = 'ready' or b.status = 'offered_for_sale' else NOT_READY
  update boxes[box] { status: 'picked_up' }
  return null

-- Only the shop owner may approve retuning an original comb, recording the
-- agreed extra cost.
mutation approveRetune(box: boxes, extra: money USD):
  require exists appRoles[viewer, role = 'shopOwner'] else NOT_SHOP_OWNER
  b = boxes[box] ! else NOT_FOUND
  require not b.retuneApproved else ALREADY_APPROVED
  update boxes[box] { retuneApproved: true, retuneExtra: extra }
  return null

-- A quote left undecided 14 days after its quote date returns the box
-- unrepaired. The sweep looks back from the period end so one run catches
-- up after missed boundaries; approved boxes are never touched.
job expireQuotes(periodStart: time, periodEnd: time):
  for b in boxes where .quoteAt < periodEnd - 14d by .quoteAt:
    if b.quoteStatus = 'pending':
      update boxes[b.id] { quoteStatus: 'expired', status: 'returned_unrepaired' }

schedule quoteSweep every 1h: expireQuotes

-- A restored box still with the shop 60 days after its ready notice is
-- offered back to the owner for sale. Same catch-up shape as above.
job offerStale(periodStart: time, periodEnd: time):
  for b in boxes:
    if b.status = 'ready' and b.readyAt != null and b.readyAt < periodEnd - 60d:
      update boxes[b.id] { status: 'offered_for_sale' }

schedule staleSweep every 1d at 03:00: offerStale

-- Access intent from the spec: which role may perform each sensitive change.
invariant boxes.logBox only exists appRoles[viewer, role = 'clerk']
invariant boxes.approveQuote only .owner = viewer
invariant boxes.advanceStage only exists appRoles[viewer, role = 'technician']
invariant boxes.approveRetune only exists appRoles[viewer, role = 'shopOwner']
