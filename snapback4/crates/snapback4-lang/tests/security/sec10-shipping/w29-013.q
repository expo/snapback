-- Lifting Sling Inspections.
--
-- Roles: crew (crane crews register their own slings and request lifts),
-- counter (counter inspectors log each inspection with tag photo + price),
-- inspector (shop inspectors move slings along the board, proof test chains,
-- mark repaired fittings), chief (chief inspector returns slings to service
-- with a test certificate and reason). Signup grants no role; the local
-- operator provisions roles (see the provision mutation).
use identity password

table roles:
  principal: principal
  role: enum('crew', 'counter', 'inspector', 'chief')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'chief']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table slings:
  owner: principal
  kind: enum('web', 'chain', 'wire', 'round')
  serial: text 4..40
  manufacturedAt: time
  status: enum('received', 'examined', 'load_tested', 'tagged', 'in_service') default 'received'
  repairedFittings: bool default false
  lastInspectionAt: time ?
  lastProofTestAt: time ?
  unique serial
  immutable owner, kind, serial, manufacturedAt
  read <- .owner = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
  insert <- .owner = viewer and exists roles[viewer, role = 'crew']
  update <- exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
  online only

table inspections:
  sling: slings
  owner: principal
  inspector: principal
  tagPhoto: image <=5000000
  price: money USD
  chargeCategory: enum('no charge', 'fee charged')
  performedAt: time default now
  notes: text <=500 ?
  immutable sling, owner, inspector, tagPhoto, price, performedAt, notes
  read <- .owner = viewer or .inspector = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
  insert <- .inspector = viewer and exists roles[viewer, role = 'counter'] and exists slings[.sling, owner = .owner]
  update <- exists roles[viewer, role = 'counter']
  delete <- deny
  online only

-- v2: every inspection carries a charge category derived from its price.
-- Existing rows are backfilled by this exact rule; new rows derive it in
-- logInspection; only the counter inspector may change it afterwards.
backfill inspections charges(price: money USD): {chargeCategory: 'fee charged' if price > 0 else 'no charge'}

table proofTests:
  sling: slings
  owner: principal
  tester: principal
  certificate: text 4..120
  testedAt: time default now
  immutable sling, owner, tester, certificate, testedAt
  read <- .owner = viewer or .tester = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
  insert <- .tester = viewer and exists roles[viewer, role = 'inspector'] and exists slings[.sling, owner = .owner]
  update <- deny
  delete <- deny
  online only

table returns:
  sling: slings
  owner: principal
  chief: principal
  certificate: text 4..120
  reason: text 10..500
  returnedAt: time default now
  immutable sling, owner, chief, certificate, reason, returnedAt
  read <- .owner = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
  insert <- .chief = viewer and exists roles[viewer, role = 'chief'] and exists slings[.sling, owner = .owner]
  update <- deny
  delete <- deny
  online only

-- A crew registers one of its own slings; it enters the shop as received.
mutation registerSling(kind: enum('web', 'chain', 'wire', 'round'), serial: text 4..40, manufacturedAt: time):
  require exists roles[viewer, role = 'crew'] else NOT_CREW 'Only crane crews register slings.'
  require manufacturedAt <= now else BAD_DATE 'The manufacture date cannot be in the future.'
  return insert slings { owner: viewer, kind, serial, manufacturedAt }

-- The counter inspector logs an inspection with the tag photo and the price.
-- A chain sling older than 10 years (3650 days) needs a proof test first.
mutation logInspection(sling: slings, tagPhoto: image <=5000000, price: money USD, notes: text <=500 ?):
  require exists roles[viewer, role = 'counter'] else NOT_COUNTER 'Only the counter inspector logs inspections.'
  s = slings[sling] ! else NOT_FOUND
  require price >= 0 else BAD_PRICE 'The inspection price cannot be negative.'
  require s.kind != 'chain' or now - s.manufacturedAt <= 3650d or s.lastProofTestAt != null else NEEDS_PROOF_TEST 'A chain sling older than 10 years must be proof tested before any inspection.'
  update slings[sling] { lastInspectionAt: now }
  return insert inspections { sling, owner: s.owner, inspector: viewer, tagPhoto, price, chargeCategory: 'fee charged' if price > 0 else 'no charge', notes }

-- Only the counter inspector may change an inspection's charge category.
mutation setChargeCategory(inspection: inspections, chargeCategory: enum('no charge', 'fee charged')):
  require exists roles[viewer, role = 'counter'] else NOT_COUNTER 'Only the counter inspector changes the charge category.'
  row = inspections[inspection] ! else NOT_FOUND
  update inspections[inspection] { chargeCategory }

-- A shop inspector proof tests a sling and records the certificate.
mutation logProofTest(sling: slings, certificate: text 4..120):
  require exists roles[viewer, role = 'inspector'] else NOT_INSPECTOR 'Only shop inspectors proof test slings.'
  s = slings[sling] ! else NOT_FOUND
  update slings[sling] { lastProofTestAt: now }
  return insert proofTests { sling, owner: s.owner, tester: viewer, certificate }

-- A shop inspector moves a sling along the board: received -> examined ->
-- load tested -> tagged. Returning to service is the chief's approval.
mutation advanceSling(sling: slings, status: enum('examined', 'load_tested', 'tagged')):
  require exists roles[viewer, role = 'inspector'] else NOT_INSPECTOR 'Only shop inspectors move slings along the board.'
  s = slings[sling] ! else NOT_FOUND
  require (s.status = 'received' and status = 'examined') or (s.status = 'examined' and status = 'load_tested') or (s.status = 'load_tested' and status = 'tagged') else BAD_TRANSITION 'Slings move received -> examined -> load tested -> tagged, one step at a time.'
  update slings[sling] { status }
  return null

-- A shop inspector records that the sling's fittings were repaired.
mutation markRepaired(sling: slings, repaired: bool):
  require exists roles[viewer, role = 'inspector'] else NOT_INSPECTOR 'Only shop inspectors mark repaired fittings.'
  s = slings[sling] ! else NOT_FOUND
  update slings[sling] { repairedFittings: repaired }
  return null

-- Only the chief inspector approves returning a sling to service,
-- recording the test certificate and the reason.
mutation returnToService(sling: slings, certificate: text 4..120, reason: text 10..500):
  require exists roles[viewer, role = 'chief'] else NOT_CHIEF 'Only the chief inspector returns slings to service.'
  s = slings[sling] ! else NOT_FOUND
  require s.status = 'tagged' else BAD_STATUS 'Only tagged slings may return to service.'
  update slings[sling] { status: 'in_service' }
  return insert returns { sling, owner: s.owner, chief: viewer, certificate, reason }

-- A crew asks whether its own sling may lift. A sling whose last inspection
-- is older than 12 months (365 days) is refused for lifting.
mutation requestLift(sling: slings):
  require exists roles[viewer, role = 'crew'] else NOT_CREW 'Only crane crews request lifts.'
  s = slings[sling] ! else NOT_FOUND
  require s.owner = viewer else NOT_OWNER 'Crews may lift only their own slings.'
  require now - (s.lastInspectionAt ?? 0) <= 365d else SLING_OVERDUE 'The last inspection is older than 12 months; this sling is refused for lifting.'
  return null

-- Operator-provisioned roles. Signup grants no role; the local operator
-- (or staging seedUsers) calls this with a service:operator token.
mutation provision(principal: principal, role: enum('crew', 'counter', 'inspector', 'chief')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { role }

query myRole():
  return roles[viewer]

query whoAmI():
  return viewer

-- A crew sees its own slings.
query mySlings(c: cursor ?):
  return slings where .owner = viewer last 50 by .id after c

-- The live shop board: counter, inspectors and the chief see every sling.
query board(c: cursor ?):
  require exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief'] else NOT_STAFF 'Only shop staff see the board.'
  return slings last 50 by .id after c

query inspectionsOf(sling: slings, c: cursor ?):
  return inspections where .sling = sling last 50 by .performedAt after c

query myInspections(c: cursor ?):
  return inspections where .owner = viewer or .inspector = viewer last 50 by .performedAt after c

query proofTestsOf(sling: slings, c: cursor ?):
  return proofTests where .sling = sling last 50 by .testedAt after c

query returnsOf(sling: slings, c: cursor ?):
  return returns where .sling = sling last 50 by .returnedAt after c

-- Privacy intent from the spec: crews see only their own slings and
-- inspections; shop staff see the board; approvals stay with the chief.
invariant slings.read only .owner = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
invariant inspections.read only .owner = viewer or .inspector = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
invariant proofTests.read only .owner = viewer or .tester = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
invariant returns.read only .owner = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'inspector'] or exists roles[viewer, role = 'chief']
