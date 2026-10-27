-- Drapery Cleaning Batches.
-- Roles: client, clerk (intake), cleaner, owner (workroom owner).
-- A clerk logs each batch with a photo, curtain count and quoted price.
-- The owning client must approve the quote within 14 days or the batch is
-- returned (daily sweep). Finished curtains not collected within 60 days of
-- the ready notice may be charged storage. Clients see only their own batches
-- and invoices; cleaners see the live workroom board; only the owner may
-- approve dyeing, recording the client's consent.
use identity password

table roles:
  principal: principal
  role: enum('client', 'clerk', 'cleaner', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

table batches:
  client: principal
  label: text 1..120
  photo: image <=10000000
  curtainCount: int 1..500
  quotedPrice: money USD
  orderedColor: text 1..60
  status: enum('quoted', 'approved', 'returned', 'ready', 'collected') default 'quoted'
  stage: enum('inspection', 'cleaning', 'flameproofing', 'pleating', 'finished') default 'inspection'
  quoteAt: time default now
  approvedAt: time ?
  readyAt: time ?
  collectedAt: time ?
  dyeColor: text 1..60 ?
  dyeConsent: text 1..500 ?
  immutable client, quoteAt
  read <- .client = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'cleaner'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'clerk']
  update <- .client = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'cleaner'] or exists roles[principal = viewer, role = 'owner']
  delete <- deny
  online only

table invoices:
  batch: batches
  client: principal
  kind: enum('cleaning', 'storage')
  amount: money USD
  issuedAt: time default now
  unique batch, kind
  immutable batch, client, kind, amount, issuedAt
  read <- .client = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner']
  update <- deny
  delete <- deny
  online only

query myRole():
  return roles[principal = viewer]

query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'cleaner'] or exists roles[principal = viewer, role = 'owner']:
    return batches last 50 by .id after c
  return batches where .client = viewer last 50 by .id after c

query clients(c: cursor ?):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  return roles where .role = 'client' last 100 by .id after c

query invoicesOf(c: cursor ?):
  if exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner']:
    return invoices last 50 by .id after c
  return invoices where .client = viewer last 50 by .id after c

mutation provision(principal: principal, role: enum('client', 'clerk', 'cleaner', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

mutation createBatch(client: principal, label: text 1..120, photo: image <=10000000, curtainCount: int 1..500, quotedPrice: money USD, orderedColor: text 1..60):
  require exists roles[principal = viewer, role = 'clerk'] else NOT_CLERK
  require exists roles[principal = client, role = 'client'] else NOT_A_CLIENT
  return insert batches { client, label, photo, curtainCount, quotedPrice, orderedColor }

mutation approveQuote(batch: batches):
  b = batches[batch] ! else NOT_FOUND
  require b.client = viewer else NOT_YOUR_BATCH
  require b.status = 'quoted' else BAD_STATUS
  require now - b.quoteAt <= 14d else QUOTE_EXPIRED 'The 14-day approval window has passed; the batch will be returned.'
  update batches[batch] { status: 'approved', approvedAt: now }
  return null

mutation advanceStage(batch: batches, stage: enum('inspection', 'cleaning', 'flameproofing', 'pleating', 'finished')):
  b = batches[batch] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'cleaner'] or exists roles[principal = viewer, role = 'owner'] else NOT_WORKROOM
  require b.status = 'approved' else BAD_STATUS
  require stage != b.stage else NO_CHANGE
  update batches[batch] { stage }
  return null

mutation approveDye(batch: batches, dyeColor: text 1..60, dyeConsent: text 1..500):
  b = batches[batch] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  require b.status = 'approved' else BAD_STATUS
  update batches[batch] { dyeColor, dyeConsent }
  return null

mutation markReady(batch: batches):
  b = batches[batch] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  require b.status = 'approved' else BAD_STATUS
  require b.stage = 'finished' else NOT_FINISHED
  update batches[batch] { status: 'ready', readyAt: now }
  return null

mutation recordCollection(batch: batches):
  b = batches[batch] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  require b.status = 'ready' else BAD_STATUS
  update batches[batch] { status: 'collected', collectedAt: now }
  return null

mutation issueCleaningInvoice(batch: batches):
  b = batches[batch] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  require b.status = 'approved' or b.status = 'ready' or b.status = 'collected' else BAD_STATUS
  return insert invoices { batch, client: b.client, kind: 'cleaning', amount: b.quotedPrice }

job sweepExpiredQuotes(periodStart: time, periodEnd: time):
  for b in batches:
    if b.status = 'quoted' and b.quoteAt < periodEnd - 14d:
      update batches[b.id] { status: 'returned' }
schedule quoteExpiry every 1d at 00:00: sweepExpiredQuotes

-- Storage is charged automatically, never by hand: a finished batch still
-- uncollected 60 days after its ready notice gets one flat $25 fee invoice.
job sweepStorageDue(periodStart: time, periodEnd: time):
  for b in batches:
    if b.status = 'ready' and b.readyAt != null and b.readyAt < periodEnd - 60d:
      insert invoices { batch: b.id, client: b.client, kind: 'storage', amount: 2500 } if absent
schedule storageSweep every 1d at 01:00: sweepStorageDue

invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner']
invariant batches.read only .client = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'cleaner'] or exists roles[principal = viewer, role = 'owner']
invariant batches.insert only exists roles[principal = viewer, role = 'clerk']
invariant invoices.read only .client = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner']
invariant invoices.insert only exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'owner']
