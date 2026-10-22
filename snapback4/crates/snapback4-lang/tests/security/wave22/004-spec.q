-- Watch Service Bench.
-- Roles: shopowner (shop owner), counter (counter staff), watchmaker, customer (watch owner).
-- Customers are principals with no staff row. Staff membership is operator-provisioned.

use identity password

table staff:
  principal: principal
  role: enum('shopowner', 'counter', 'watchmaker')
  unique principal
  immutable principal
  cap 100
  read <- exists staff[viewer]
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

table watches:
  owner: principal
  ownerName: text 1..80
  ownerPhone: text 1..40
  dialPhoto: image <=10000000
  casebackPhoto: image <=10000000
  serialPhoto: image <=10000000
  serialNumber: text 1..60
  quotedPrice: money USD
  movementNotes: text <=2000 ?
  timingResults: text <=2000 ?
  status: enum('quoted', 'approved', 'cleaning', 'regulation', 'testing', 'ready', 'returned') default 'quoted'
  quoteDueAt: time
  createdAt: time default now
  immutable owner, dialPhoto, casebackPhoto, serialPhoto, serialNumber, quoteDueAt, createdAt
  read <- .owner = viewer or exists staff[principal = viewer]
  read (ownerName, ownerPhone) <- .owner = viewer or exists staff[principal = viewer, role = 'shopowner'] or exists staff[principal = viewer, role = 'counter']
  read (quotedPrice) <- exists staff[principal = viewer, role = 'shopowner'] or exists staff[principal = viewer, role = 'counter']
  insert <- exists staff[principal = viewer, role = 'shopowner'] or exists staff[principal = viewer, role = 'counter']
  update <- exists staff[principal = viewer] or .owner = viewer
  cap 5000
  online only

table parts:
  watch: watches
  owner: principal
  description: text 1..200
  kind: enum('standard', 'dial', 'hands')
  approved: bool default false
  immutable watch, owner, description, kind
  read <- .owner = viewer or exists staff[principal = viewer]
  insert <- exists staff[principal = viewer]
  update <- exists staff[principal = viewer]
  cap 5000
  online only

-- Spec privacy intent, stated independently from the rules above.

query myRole():
  return staff[principal = viewer]

query myWatches(c: cursor ?):
  return watches where .owner = viewer last 100 by .id after c

query benchBoard(c: cursor ?):
  require exists staff[principal = viewer] else NOT_STAFF
  return watches last 100 by .id after c

query watchDetail(watch: watches):
  return watches[watch]

query watchParts(watch: watches, c: cursor ?):
  w = watches[watch] ! else NOT_FOUND
  return parts where .watch = watch last 100 by .id after c

mutation provision(principal: principal, role: enum('shopowner', 'counter', 'watchmaker', 'customer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  if role = 'customer':
    if exists staff[principal]:
      delete staff[principal]
    return null
  else if role = 'shopowner':
    return upsert staff[principal] { principal, role: 'shopowner' }
  else if role = 'counter':
    return upsert staff[principal] { principal, role: 'counter' }
  else:
    return upsert staff[principal] { principal, role: 'watchmaker' }

mutation logWatch(owner: principal, ownerName: text 1..80, ownerPhone: text 1..40, dialPhoto: image <=10000000, casebackPhoto: image <=10000000, serialPhoto: image <=10000000, serialNumber: text 1..60, quotedPrice: money USD):
  require exists staff[principal = viewer, role = 'shopowner'] or exists staff[principal = viewer, role = 'counter'] else NOT_COUNTER
  return insert watches { owner, ownerName, ownerPhone, dialPhoto, casebackPhoto, serialPhoto, serialNumber, quotedPrice, status: 'quoted', quoteDueAt: now + 14d }

mutation recordBench(watch: watches, movementNotes: text <=2000 ?, timingResults: text <=2000 ?):
  require exists staff[principal = viewer] else NOT_STAFF
  w = watches[watch] ! else NOT_FOUND
  update watches[watch] { movementNotes: movementNotes ?? w.movementNotes, timingResults: timingResults ?? w.timingResults }
  return null

mutation advanceStatus(watch: watches, to: enum('quoted', 'approved', 'cleaning', 'regulation', 'testing', 'ready', 'returned')):
  require exists staff[principal = viewer] else NOT_STAFF
  w = watches[watch] ! else NOT_FOUND
  me = staff[principal = viewer]
  if me != null and me.role = 'watchmaker':
    require (w.status = 'approved' and to = 'cleaning') or (w.status = 'cleaning' and to = 'regulation') or (w.status = 'regulation' and to = 'testing') else BAD_TRANSITION
  update watches[watch] { status: to }
  return null

mutation approveQuote(watch: watches):
  w = watches[watch] ! else NOT_FOUND
  require w.owner = viewer else NOT_OWNER
  require now <= w.quoteDueAt else QUOTE_EXPIRED
  require w.status = 'quoted' else BAD_STATE
  update watches[watch] { status: 'approved' }
  return null

mutation requestPart(watch: watches, description: text 1..200, kind: enum('standard', 'dial', 'hands')):
  require exists staff[principal = viewer] else NOT_STAFF
  w = watches[watch] ! else NOT_FOUND
  return insert parts { watch, owner: w.owner, description, kind, approved: false }

mutation approveStandardPart(part: parts):
  require exists staff[principal = viewer] else NOT_STAFF
  p = parts[part] ! else NOT_FOUND
  require p.kind = 'standard' else NEEDS_SHOPOWNER
  update parts[part] { approved: true }
  return null

mutation approveReplacement(part: parts):
  require exists staff[principal = viewer, role = 'shopowner'] else NOT_SHOPOWNER
  p = parts[part] ! else NOT_FOUND
  require p.kind != 'standard' else USE_STANDARD_APPROVAL
  update parts[part] { approved: true }
  return null

job sweepExpiredQuotes(periodStart: time, periodEnd: time):
  for w in watches:
    if w.status = 'quoted' and w.quoteDueAt < periodEnd:
      update watches[w.id] { status: 'returned' }

schedule quoteSweep every 1d at 03:00: sweepExpiredQuotes
invariant watches.status update only .owner = viewer or .status != 'quoted'
