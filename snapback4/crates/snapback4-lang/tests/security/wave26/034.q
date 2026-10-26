-- Luxury Watch Servicing on Snapback 4.
-- Roles: owner (watch owner / customer), watchmaker, clerk (counter clerk),
-- workshop_owner (workshop owner). Operator seat provisions roles.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'watchmaker', 'clerk', 'workshop_owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- A customer's watch. Owners register their own watches.
table watches:
  owner: principal
  brand: text 1..40
  model: text 1..40
  serial: text 1..30
  createdAt: time default now
  immutable owner
  unique serial
  read <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'watchmaker'] or exists roles[principal = viewer, role = 'workshop_owner']
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer
  online only

-- One servicing job for a watch. Private contact + price columns are hidden
-- from watchmakers by column rules; the row itself is visible to staff.
table services:
  watch: watches
  owner: principal
  dialPhoto: image <=5000000
  casePhoto: image <=5000000
  movementPhoto: image <=5000000
  quotedPrice: money USD
  phone: text 7..20
  homeAddress: text 5..200
  timingResults: text <=500 ?
  partsNotes: text <=1000 ?
  status: enum('received', 'serviced', 'regulated', 'water_tested') default 'received'
  quoteStatus: enum('pending', 'approved', 'expired') default 'pending'
  quoteCreatedAt: time default now
  quoteApprovedAt: time ?
  reserviceStatus: enum('none', 'requested', 'approved') default 'none'
  reserviceReason: text 1..500 ?
  createdAt: time default now
  immutable watch, owner, dialPhoto, casePhoto, movementPhoto, quoteCreatedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'watchmaker'] or exists roles[principal = viewer, role = 'workshop_owner']
  read (phone, homeAddress, quotedPrice) <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'workshop_owner']
  insert <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'workshop_owner']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'watchmaker'] or exists roles[principal = viewer, role = 'workshop_owner']
  delete <- deny
  online only

-- -- -- Queries -- --

query myRole():
  return roles[viewer]

query myWatches(c: cursor ?):
  return watches where .owner = viewer first 50 by .id after c

query myServices(c: cursor ?):
  return services where .owner = viewer first 50 by .id after c

query benchBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'watchmaker'] or exists roles[principal = viewer, role = 'workshop_owner'] else NOT_STAFF
  return services last 50 by .id after c

query serviceDetail(service: services):
  return services[service]

query watchDetail(watch: watches):
  return watches[watch]

-- -- -- Mutations -- --

mutation provision(principal: principal, role: enum('owner', 'watchmaker', 'clerk', 'workshop_owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

mutation registerWatch(brand: text 1..40, model: text 1..40, serial: text 1..30):
  return insert watches { owner: viewer, brand, model, serial }

mutation openService(watch: watches, dialPhoto: image <=5000000, casePhoto: image <=5000000, movementPhoto: image <=5000000, quotedPrice: money USD, phone: text 7..20, homeAddress: text 5..200):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'workshop_owner'] else NOT_CLERK
  w = watches[watch] ! else NOT_FOUND
  return insert services { watch: w.id, owner: w.owner, dialPhoto, casePhoto, movementPhoto, quotedPrice, phone, homeAddress }

mutation updateBench(service: services, timingResults: text <=500 ?, partsNotes: text <=1000 ?, status: enum('received', 'serviced', 'regulated', 'water_tested') ?):
  require exists roles[principal = viewer, role = 'watchmaker'] or exists roles[principal = viewer, role = 'workshop_owner'] else NOT_WATCHMAKER
  s = services[service] ! else NOT_FOUND
  update services[service] { timingResults: timingResults ?? s.timingResults, partsNotes: partsNotes ?? s.partsNotes, status: status ?? s.status }
  return null

mutation approveQuote(service: services):
  s = services[service] ! else NOT_FOUND
  require s.owner = viewer else NOT_OWNER
  require s.quoteStatus = 'pending' else QUOTE_SETTLED
  require now <= s.quoteCreatedAt + 30d else QUOTE_EXPIRED 'The 30-day quote window has passed.'
  update services[service] { quoteStatus: 'approved', quoteApprovedAt: now }
  return null

mutation requestReservice(service: services, reason: text 1..500):
  s = services[service] ! else NOT_FOUND
  require s.owner = viewer else NOT_OWNER
  require s.reserviceStatus = 'none' else RESERVICE_SETTLED
  update services[service] { reserviceStatus: 'requested', reserviceReason: reason }
  return null

mutation approveReservice(service: services, reason: text 1..500):
  require exists roles[principal = viewer, role = 'workshop_owner'] else NOT_WORKSHOP_OWNER
  s = services[service] ! else NOT_FOUND
  require s.reserviceStatus != 'approved' else RESERVICE_SETTLED
  update services[service] { reserviceStatus: 'approved', reserviceReason: reason }
  return null

-- Expire stale pending quotes once a day.
job expireQuotes(periodStart: time, periodEnd: time):
  for s in services by .id:
    if s.quoteStatus = 'pending' and s.quoteCreatedAt < periodEnd - 30d:
      update services[s.id] { quoteStatus: 'expired' }

schedule nightly every 1d at 03:00: expireQuotes

-- -- -- Privacy intent (independent of enforcement) -- --
-- Owners see only their own watches and services.
invariant watches.read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'watchmaker'] or exists roles[principal = viewer, role = 'workshop_owner']
invariant services.read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'watchmaker'] or exists roles[principal = viewer, role = 'workshop_owner']
-- Watchmakers must not read owner contact or price on a service.
invariant services.phone read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'workshop_owner']
invariant services.homeAddress read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'workshop_owner']
invariant services.quotedPrice read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'workshop_owner']
-- Only clerks / workshop owners open services.
invariant services.insert only exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'workshop_owner']
-- Only the workshop owner approves a free re-service.
invariant services.approveReservice only exists roles[principal = viewer, role = 'workshop_owner']
