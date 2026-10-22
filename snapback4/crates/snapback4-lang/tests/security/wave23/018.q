-- Film Lab Rolls: counter logs each roll with a canister photo and the
-- develop and scan price; rolls move through developing, drying, scanning, ready;
-- only the manager approves push/pull or refunds a ruined roll.
-- Only counter staff and the manager may change the develop and scan price.
-- Grammar: `snapback4 guide language`.
use identity password
use personas alice, bob, carol, dave, erin, frank

table roles:
  principal: principal
  role: enum('customer', 'tech', 'manager', 'staff')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'manager']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'tech', 'manager', 'staff')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table rolls:
  owner: principal
  film: text 1..60
  exposures: int 1..60
  develop: enum('standard', 'push1', 'push2', 'pull1') default 'standard'
  scan: enum('none', 'basic', 'highres', 'tiff') default 'basic'
  developScanPrice: money USD renamed from price
  photo: image <=10000000 ?
  status: enum('dropped', 'developing', 'drying', 'scanning', 'ready', 'collected', 'discarded', 'ruined') default 'dropped'
  droppedAt: time default now
  developBy: time
  readyAt: time ?
  discardAt: time ?
  pushPullApproved: bool default false
  pushPullReason: text <=500 ?
  refunded: bool default false
  refundReason: text <=500 ?
  immutable owner, droppedAt, developBy
  read <- .owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff']
  insert <- .owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff']
  update <- exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff']
  delete <- deny
  expire at .discardAt

table scans:
  roll: rolls on delete keep
  owner: principal
  image: image <=10000000
  note: text <=200 ?
  at: time default now
  immutable roll, owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager']
  update <- deny
  delete <- deny

table invoices:
  roll: rolls on delete keep
  owner: principal
  developScanPrice: money USD renamed from amount
  paid: bool default false
  refunded: bool default false
  refundReason: text <=500 ?
  unique roll
  immutable roll, owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff']
  insert <- .owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff']
  update <- exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff']
  delete <- deny

-- Customers see only their own rolls.
query myRolls(c: cursor ?):
  return rolls where .owner = viewer first 100 by .id after c

query rollDetail(roll: rolls):
  return rolls[roll]

-- Lab board: every roll, newest first; lab and counter staff only.
query labBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff'] else NOT_STAFF
  return rolls first 100 by .id after c

-- Rolls past their 7-day develop deadline and still early in the pipeline.
-- The lab manager works this list.
query overdueRolls(c: cursor ?):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  return rolls where .developBy < now and (.status = 'dropped' or .status = 'developing') first 100 by .id after c

query rollScans(roll: rolls, c: cursor ?):
  return scans where .roll = roll first 50 by .id after c

query myInvoices(c: cursor ?):
  return invoices where .owner = viewer first 100 by .id after c

query invoiceFor(roll: rolls):
  return invoices[roll = roll]

-- Counter logs a roll (for the customer standing there, or the customer's
-- own drop-off): canister photo plus the develop and scan price of the chosen options.
-- Prices are server-computed minor units (cents): develop standard 1200,
-- push1/pull1 1500, push2 1800; scan none 0, basic 600, highres 1200, tiff 2500.
mutation logRoll(owner: principal, film: text 1..60, exposures: int 1..60, develop: enum('standard', 'push1', 'push2', 'pull1'), scan: enum('none', 'basic', 'highres', 'tiff'), photo: image <=10000000 ?):
  require owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff'] else NOT_ALLOWED
  developPrice = 1200 if develop = 'standard' else 1500 if develop = 'push1' else 1800 if develop = 'push2' else 1500
  scanPrice = 0 if scan = 'none' else 600 if scan = 'basic' else 1200 if scan = 'highres' else 2500
  id = insert rolls { owner, film, exposures, develop, scan, developScanPrice: developPrice + scanPrice, photo, developBy: now + 7d }
  insert invoices { roll: id, owner, developScanPrice: developPrice + scanPrice }
  return id

-- Only counter staff and the lab manager may change the develop and scan
-- price (one combined price for the chosen options); lab techs and customers
-- cannot. The invoice always carries the same combined price.
mutation setDevelopScanPrice(roll: rolls, cents: int 0..100000000):
  require exists roles[principal = viewer, role = 'staff'] or exists roles[principal = viewer, role = 'manager'] else NOT_PRICE_AUTH
  r = rolls[roll] ! else NOT_FOUND
  inv = invoices[roll = roll] ! else NOT_FOUND
  update rolls[roll] { developScanPrice: cents }
  update invoices[inv.id] { developScanPrice: cents }
  return null

-- Techs (and the manager) move rolls forward through the pipeline.
mutation advanceStatus(roll: rolls, status: enum('developing', 'drying', 'scanning', 'ready', 'collected', 'discarded')):
  require exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  r = rolls[roll] ! else NOT_FOUND
  ok = r.status = 'dropped' and status = 'developing' or r.status = 'developing' and status = 'drying' or r.status = 'drying' and status = 'scanning' or r.status = 'scanning' and status = 'ready' or r.status = 'ready' and status = 'collected' or r.status = 'ready' and status = 'discarded'
  require ok else BAD_TRANSITION
  if status = 'ready':
    update rolls[roll] { status, readyAt: now, discardAt: now + 90d }
  else:
    update rolls[roll] { status }
  return null

mutation addScan(roll: rolls, image: image <=10000000, note: text <=200 ?):
  require exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  r = rolls[roll] ! else NOT_FOUND
  return insert scans { roll, owner: r.owner, image, note }

mutation markPaid(roll: rolls):
  require exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  r = rolls[roll] ! else NOT_FOUND
  inv = invoices[roll = roll] ! else NOT_FOUND
  update invoices[inv.id] { paid: true }
  return null

-- Only the lab manager approves a push/pull process, with the reason recorded.
mutation approvePushPull(roll: rolls, approved: bool, reason: text 1..500):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  r = rolls[roll] ! else NOT_FOUND
  update rolls[roll] { pushPullApproved: approved, pushPullReason: reason }
  return null

-- Only the lab manager refunds a ruined roll, with the reason recorded.
mutation refundRuined(roll: rolls, reason: text 1..500):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  r = rolls[roll] ! else NOT_FOUND
  inv = invoices[roll = roll] ! else NOT_FOUND
  update rolls[roll] { status: 'ruined', refunded: true, refundReason: reason }
  update invoices[inv.id] { refunded: true, refundReason: reason }
  return null

-- Spec privacy and authority intent, stated separately from the rules.
invariant rolls.read only .owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff']
invariant rolls.photo read only .owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff']
invariant rolls.developScanPrice update only exists roles[principal = viewer, role = 'staff'] or exists roles[principal = viewer, role = 'manager']
invariant rolls.status update only exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager']
invariant rolls.pushPullApproved update only exists roles[principal = viewer, role = 'manager']
invariant rolls.refundReason update only exists roles[principal = viewer, role = 'manager']
invariant scans.read only .owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager']
invariant invoices.read only .owner = viewer or exists roles[principal = viewer, role = 'tech'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'staff']
invariant invoices.refunded update only exists roles[principal = viewer, role = 'manager']
invariant invoices.developScanPrice update only exists roles[principal = viewer, role = 'staff'] or exists roles[principal = viewer, role = 'manager']
