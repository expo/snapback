-- Steamer Trunk Restorations.
-- Intake techs log trunks with canvas/hardware/lining photos plus a quoted price.
-- The owner must approve the quote within 21 days or the trunk is returned.
-- A restored trunk not collected within 30 days of its ready notice is charged storage.
-- Restorers see the live shop board (teardown -> wood repair -> recovering -> relining -> ready).
-- Only the workshop owner may approve replacing an original brass lock,
-- recording the owner's written consent.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'intake', 'restorer', 'workshop_owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'restorer'] or exists roles[viewer, role = 'workshop_owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table trunks:
  owner: principal
  description: text 3..200
  canvasPhoto: image <=10000000
  hardwarePhoto: image <=10000000
  liningPhoto: image <=10000000
  quotedPrice: money USD
  stage: enum('intake', 'teardown', 'wood_repair', 'recovering', 'relining', 'ready', 'collected', 'returned') default 'intake'
  quoteIssuedAt: time default now
  quoteApproved: bool default false
  quoteApprovedAt: time ?
  readyAt: time ?
  storageFee: money USD default 0
  storageCharged: bool default false
  brassLockRequested: bool default false
  brassLockApproved: bool default false
  brassConsent: text 3..500 ?
  immutable owner, quoteIssuedAt
  cap 200 by owner
  read <- .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'restorer'] or exists roles[viewer, role = 'workshop_owner']
  insert <- exists roles[viewer, role = 'intake']
  update <- .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'restorer'] or exists roles[viewer, role = 'workshop_owner']
  online only

query myRole():
  return roles[principal = viewer]

query myTrunks(c: cursor ?):
  return trunks where .owner = viewer last 50 by .id after c

query shopBoard(c: cursor ?):
  require exists roles[viewer, role = 'restorer'] or exists roles[viewer, role = 'workshop_owner'] or exists roles[viewer, role = 'intake'] else NOT_STAFF
  return trunks last 50 by .id after c

query trunkDetail(trunk: trunks):
  return trunks[trunk]

-- Operator (service:operator seat) provisions every role. Signup alone grants nothing.
mutation provision(principal: principal, role: enum('owner', 'intake', 'restorer', 'workshop_owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal = principal] { principal, role }

-- Intake logs a trunk for an owner customer, with all three photos and the quote.
mutation logTrunk(owner: principal, description: text 3..200, canvas: image <=10000000, hardware: image <=10000000, lining: image <=10000000, quotedPrice: money USD):
  require exists roles[viewer, role = 'intake'] else NOT_INTAKE
  require exists roles[owner, role = 'owner'] else NOT_OWNER_ROLE
  return insert trunks { owner, description, canvasPhoto: canvas, hardwarePhoto: hardware, liningPhoto: lining, quotedPrice }

-- The trunk owner approves the quote within 21 days of issue.
mutation approveQuote(trunk: trunks):
  t = trunks[trunk] ! else NOT_FOUND
  require t.owner = viewer else NOT_OWNER
  require t.stage = 'intake' else BAD_STAGE
  require not t.quoteApproved else ALREADY_DECIDED
  require now <= t.quoteIssuedAt + 21d else QUOTE_EXPIRED
  update trunks[trunk] { quoteApproved: true, quoteApprovedAt: now }
  return null

-- Restorers (or the workshop owner) advance restoration one stage at a time.
mutation setStage(trunk: trunks, stage: enum('teardown', 'wood_repair', 'recovering', 'relining', 'ready')):
  require exists roles[viewer, role = 'restorer'] or exists roles[viewer, role = 'workshop_owner'] else NOT_RESTORER
  t = trunks[trunk] ! else NOT_FOUND
  require t.quoteApproved else QUOTE_PENDING
  require t.stage != 'ready' and t.stage != 'collected' and t.stage != 'returned' else CLOSED
  next = 'teardown' if t.stage = 'intake' else 'wood_repair' if t.stage = 'teardown' else 'recovering' if t.stage = 'wood_repair' else 'relining' if t.stage = 'recovering' else 'ready'
  require stage = next else BAD_STAGE
  update trunks[trunk] { stage, readyAt: now if stage = 'ready' else t.readyAt }
  return null

-- A restorer flags that an original brass lock needs replacement.
mutation requestBrassLock(trunk: trunks):
  require exists roles[viewer, role = 'restorer'] or exists roles[viewer, role = 'workshop_owner'] else NOT_RESTORER
  t = trunks[trunk] ! else NOT_FOUND
  require t.stage != 'collected' and t.stage != 'returned' else CLOSED
  require not t.brassLockApproved else ALREADY_DECIDED
  update trunks[trunk] { brassLockRequested: true }
  return null

-- Only the workshop owner approves the replacement, recording written consent.
mutation approveBrassLock(trunk: trunks, consent: text 3..500):
  require exists roles[viewer, role = 'workshop_owner'] else NOT_WORKSHOP_OWNER
  t = trunks[trunk] ! else NOT_FOUND
  require t.brassLockRequested else NOT_REQUESTED
  require not t.brassLockApproved else ALREADY_DECIDED
  require t.stage != 'collected' and t.stage != 'returned' else CLOSED
  update trunks[trunk] { brassLockApproved: true, brassConsent: consent }
  return null

-- The owner collects a ready trunk; 30+ days after the ready notice adds storage.
mutation collectTrunk(trunk: trunks):
  t = trunks[trunk] ! else NOT_FOUND
  require t.owner = viewer else NOT_OWNER
  require t.stage = 'ready' else NOT_READY
  require t.quoteApproved else QUOTE_PENDING
  overdue = (t.readyAt ?? now) + 30d < now
  update trunks[trunk] { stage: 'collected', storageFee: 5000 if overdue and not t.storageCharged else t.storageFee, storageCharged: true if overdue else t.storageCharged }
  return null

-- Nightly: return unapproved quotes past 21 days; charge storage past 30 days ready.
job maintenance():
  for t in trunks:
    if not t.quoteApproved and t.stage = 'intake' and t.quoteIssuedAt + 21d < now:
      update trunks[t.id] { stage: 'returned' }
  for u in trunks:
    if u.stage = 'ready' and (u.readyAt ?? now) + 30d < now and not u.storageCharged:
      update trunks[u.id] { storageFee: 5000, storageCharged: true }

schedule dailyMaintenance every 1d at 08:00: maintenance

-- Spec privacy: owners see only their own trunks; staff share the shop board.
invariant trunks.read only .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'restorer'] or exists roles[viewer, role = 'workshop_owner']
invariant trunks.insert only exists roles[viewer, role = 'intake']
invariant roles.read only .principal = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'restorer'] or exists roles[viewer, role = 'workshop_owner'] or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
invariant trunks.logTrunk only exists roles[viewer, role = 'intake']
invariant trunks.approveBrassLock only exists roles[viewer, role = 'workshop_owner']
invariant roles.provision only viewer = 'service:operator'
