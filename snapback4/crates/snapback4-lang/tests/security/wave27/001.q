-- Longcase Clock Restorations.
--
-- Roles: owner (sees only their own clocks/quotes), restorer (live workshop
-- board, moves clocks through workshop stages), foreman (opens restorations,
-- processes overdue quotes and storage), master (all staff powers plus the
-- exclusive right to approve replacing an original wheel or pinion while
-- recording the owner's written consent).
-- Time rules: a quote must be accepted within 30 days or the movement is
-- packed and returned; a restored clock not collected within 45 days of its
-- ready notice starts a flat storage charge.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'restorer', 'foreman', 'master')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'restorer', 'foreman', 'master')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table restorations:
  owner: principal
  label: text 3..120
  dialPhoto: text 1..500
  movementPhoto: text 1..500
  casePhoto: text 1..500
  quotePriceCents: int 1..100000000
  priceBand: enum('under_1000', 'at_least_1000') write <- exists roles[principal = viewer, role = 'foreman']
  quotedAt: time default now
  acceptedAt: time ?
  status: enum('quoted', 'accepted', 'dismantling', 'cleaning', 'bushing', 'regulating', 'ready', 'collected', 'returned')
  readyAt: time ?
  storageFeeCents: int 0..100000000 default 0
  immutable owner, quotedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master']
  insert <- exists roles[principal = viewer, role = 'foreman']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master']
  online only

table partApprovals:
  restoration: restorations
  owner: principal
  part: enum('wheel', 'pinion')
  consentText: text 10..2000
  approvedBy: principal
  approvedAt: time default now
  unique restoration, part
  immutable restoration, owner, part
  read <- .owner = viewer or exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master']
  insert <- exists roles[principal = viewer, role = 'master']
  update <- deny
  delete <- deny
  online only

query myClocks(c: cursor ?):
  return restorations where .owner = viewer first 50 by .id after c

query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master'] else NOT_STAFF
  return restorations first 50 by .id after c

query clockDetail(id: restorations):
  return restorations[id]

query partsFor(restoration: restorations, c: cursor ?):
  return partApprovals where .restoration = restoration first 50 by .id after c

mutation openRestoration(owner: principal, label: text 3..120, dialPhoto: text 1..500, movementPhoto: text 1..500, casePhoto: text 1..500, quotePriceCents: int 1..100000000):
  require exists roles[principal = viewer, role = 'foreman'] else NOT_FOREMAN 'Only the workshop foreman may open a restoration.'
  require exists roles[principal = owner, role = 'owner'] else OWNER_REQUIRED 'The clock owner must hold the owner role.'
  return insert restorations { owner, label, dialPhoto, movementPhoto, casePhoto, quotePriceCents, status: 'quoted', priceBand: ('at_least_1000' if quotePriceCents >= 100000 else 'under_1000') }

mutation acceptQuote(id: restorations):
  r = restorations[id] ! else NOT_FOUND
  require r.owner = viewer else NOT_OWNER 'Only the clock owner may accept its quote.'
  require r.status = 'quoted' else BAD_STATUS 'This quote is no longer open.'
  require now <= r.quotedAt + 30d else QUOTE_EXPIRED 'The 30-day acceptance window has passed.'
  update restorations[id] { status: 'accepted', acceptedAt: now }
  return null

mutation advanceStage(id: restorations):
  r = restorations[id] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master'] else NOT_STAFF 'Only workshop staff may move a clock.'
  require r.status = 'accepted' or r.status = 'dismantling' or r.status = 'cleaning' or r.status = 'bushing' or r.status = 'regulating' else BAD_STATUS 'This clock cannot advance from its current stage.'
  if r.status = 'accepted':
    update restorations[id] { status: 'dismantling' }
  else if r.status = 'dismantling':
    update restorations[id] { status: 'cleaning' }
  else if r.status = 'cleaning':
    update restorations[id] { status: 'bushing' }
  else if r.status = 'bushing':
    update restorations[id] { status: 'regulating' }
  else:
    update restorations[id] { status: 'ready', readyAt: now }
  return null

mutation collectClock(id: restorations):
  r = restorations[id] ! else NOT_FOUND
  require r.status = 'ready' else BAD_STATUS 'This clock is not ready for collection.'
  require r.owner = viewer or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master'] else NOT_ALLOWED 'Only the owner, foreman or master may record collection.'
  update restorations[id] { status: 'collected' }
  return null

mutation finalizeExpired(id: restorations):
  r = restorations[id] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master'] else NOT_STAFF 'Only the foreman or master may pack and return movements.'
  if r.status = 'returned':
    require now > r.quotedAt + 30d else BAD_STATUS 'Only an open quote can expire.'
    return null
  require r.status = 'quoted' else BAD_STATUS 'Only an open quote can expire.'
  require now > r.quotedAt + 30d else NOT_DUE 'The 30-day quote window has not passed yet.'
  update restorations[id] { status: 'returned' }
  return null

mutation applyStorage(id: restorations):
  r = restorations[id] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master'] else NOT_STAFF 'Only the foreman or master may apply storage charges.'
  require r.status = 'ready' else BAD_STATUS 'Storage applies only to restored clocks awaiting collection.'
  require r.readyAt != null else BAD_STATUS 'This clock has no ready notice.'
  if r.storageFeeCents != 0:
    require now > (r.readyAt ?? now) + 45d else NOT_DUE 'The 45-day collection window has not passed yet.'
    return null
  require now > (r.readyAt ?? now) + 45d else NOT_DUE 'The 45-day collection window has not passed yet.'
  update restorations[id] { storageFeeCents: 2500 }
  return null

mutation approvePart(restoration: restorations, part: enum('wheel', 'pinion'), consentText: text 10..2000):
  require exists roles[principal = viewer, role = 'master'] else NOT_MASTER 'Only the master restorer may approve replacing an original part.'
  r = restorations[restoration] ! else NOT_FOUND
  require r.status = 'dismantling' or r.status = 'cleaning' or r.status = 'bushing' or r.status = 'regulating' else BAD_STATUS 'Parts may only be approved while the clock is in the workshop.'
  return insert partApprovals { restoration, owner: r.owner, part, consentText, approvedBy: viewer }

job expireQuotes(periodStart: time, periodEnd: time):
  for r in restorations where .quotedAt < periodEnd - 30d by .quotedAt:
    if r.status = 'quoted':
      update restorations[r.id] { status: 'returned' }

schedule quoteSweep every 1d at 03:00: expireQuotes

job storageSweep(periodStart: time, periodEnd: time):
  for r in restorations:
    if r.status = 'ready' and r.storageFeeCents = 0 and (r.readyAt ?? periodEnd) + 45d < periodEnd:
      update restorations[r.id] { storageFeeCents: 2500 }

schedule storageNightly every 1d at 03:30: storageSweep

-- Spec privacy intent, stated independently from the rules above.
invariant restorations.read only .owner = viewer or exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master']
invariant partApprovals.read only .owner = viewer or exists roles[principal = viewer, role = 'restorer'] or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master']
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'foreman'] or exists roles[principal = viewer, role = 'master']
invariant restorations.insert only exists roles[principal = viewer, role = 'foreman']
invariant partApprovals.insert only exists roles[principal = viewer, role = 'master']
backfill restorations bands(quotePriceCents: int): {priceBand: 'at_least_1000' if quotePriceCents >= 100000 else 'under_1000'}
invariant restorations.priceBand update only exists roles[principal = viewer, role = 'foreman']

mutation reviseQuote(id: restorations, quotePriceCents: int 1..100000000):
  require exists roles[principal = viewer, role = 'foreman'] else NOT_FOREMAN 'Only the workshop foreman may revise a quoted price.'
  r = restorations[id] ! else NOT_FOUND
  update restorations[id] { quotePriceCents, priceBand: ('at_least_1000' if quotePriceCents >= 100000 else 'under_1000') }
  return null

mutation setPriceBand(id: restorations, priceBand: enum('under_1000', 'at_least_1000')):
  require exists roles[principal = viewer, role = 'foreman'] else NOT_FOREMAN 'Only the workshop foreman may change the price band.'
  r = restorations[id] ! else NOT_FOUND
  update restorations[id] { priceBand }
  return null
