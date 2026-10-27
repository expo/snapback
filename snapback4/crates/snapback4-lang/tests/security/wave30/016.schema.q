use identity password

table roles:
  principal: principal
  role: enum('owner', 'intake', 'mechanic', 'garageOwner')
  email: text 3..200
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'garageOwner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'intake', 'mechanic', 'garageOwner'), email: text 3..200):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, email }

query myRole():
  return roles[viewer]

query owners(c: cursor ?):
  require exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'garageOwner'] else STAFF_ONLY
  return roles where .role = 'owner' last 50 by .id after c

table engines:
  owner: principal
  name: text 2..100
  modelYear: int 1850..2026
  chassis: image <=5000000
  pump: image <=5000000
  ladders: image <=5000000
  quotedAt: time default now
  quoteDeadline: time
  stage: enum('awaiting', 'return_due', 'returned', 'teardown', 'pump', 'paint', 'road_test', 'ready', 'collected') default 'awaiting'
  approvedAt: time ?
  readyAt: time ?
  collectedAt: time ?
  storageCents: int 0.. default 0
  originalBrass: bool
  replacedAt: time ?
  replacedBy: principal ?
  immutable owner, name, modelYear, chassis, pump, ladders, quotedAt, quoteDeadline, originalBrass
  read <- .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'mechanic'] or exists roles[viewer, role = 'garageOwner']
  insert <- exists roles[viewer, role = 'intake']
  update <- .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'mechanic'] or exists roles[viewer, role = 'garageOwner']
  online only

table quotes:
  engine: engines
  owner: principal
  cents: int 100..100000000
  unique engine
  immutable engine, owner, cents
  read <- .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'garageOwner']
  insert <- exists roles[viewer, role = 'intake']
  online only

table consents:
  engine: engines
  owner: principal
  written: text 20..4000
  at: time default now
  unique engine
  immutable engine, owner, written, at
  read <- .owner = viewer or exists roles[viewer, role = 'garageOwner']
  insert <- .owner = viewer
  online only

table pumpApprovals:
  engine: engines
  owner: principal
  consent: consents
  approvedBy: principal
  at: time default now
  unique engine
  immutable engine, owner, consent, approvedBy, at
  read <- .owner = viewer or exists roles[viewer, role = 'garageOwner'] or exists roles[viewer, role = 'mechanic']
  insert <- exists roles[viewer, role = 'garageOwner'] and .approvedBy = viewer
  online only

query board(c: cursor ?):
  require exists roles[viewer] else ACCOUNT_NOT_PROVISIONED
  if exists roles[viewer, role = 'owner']:
    return engines where .owner = viewer last 50 by .id after c
  return engines last 50 by .id after c

query engineDetails(engine: engines):
  e = engines[engine] ! else NOT_FOUND
  fees = e.storageCents
  if e.stage = 'ready' and e.readyAt != null and now > e.readyAt + 60d:
    fees = ((now - e.readyAt - 60d + 1d - 1) / 1d) * 2500
  return { engine: e, quote: quotes[engine], consent: consents[engine], pumpApproval: pumpApprovals[engine], storageCents: fees, returnDue: e.stage = 'return_due' or (e.stage = 'awaiting' and now >= e.quoteDeadline), serverNow: now }

mutation createEngine(owner: principal, name: text 2..100, modelYear: int 1850..2026, cents: int 100..100000000, chassis: image <=5000000, pump: image <=5000000, ladders: image <=5000000, originalBrass: bool):
  require exists roles[viewer, role = 'intake'] else INTAKE_ONLY
  require exists roles[owner, role = 'owner'] else OWNER_REQUIRED
  e = insert engines { owner, name, modelYear, chassis, pump, ladders, quoteDeadline: now + 30d, originalBrass }
  insert quotes { engine: e.id, owner, cents }
  return e

mutation approveQuote(engine: engines):
  e = engines[engine] ! else NOT_FOUND
  require e.owner = viewer and exists roles[viewer, role = 'owner'] else OWNER_ONLY
  require e.stage = 'awaiting' else WRONG_STAGE
  require now < e.quoteDeadline else QUOTE_EXPIRED
  update engines[engine] { stage: 'teardown', approvedAt: now }
  return null

mutation advanceStage(engine: engines):
  require exists roles[viewer, role = 'mechanic'] else MECHANIC_ONLY
  e = engines[engine] ! else NOT_FOUND
  require e.approvedAt != null else QUOTE_NOT_APPROVED
  if e.stage = 'teardown':
    update engines[engine] { stage: 'pump' }
  elif e.stage = 'pump':
    update engines[engine] { stage: 'paint' }
  elif e.stage = 'paint':
    update engines[engine] { stage: 'road_test' }
  elif e.stage = 'road_test':
    update engines[engine] { stage: 'ready', readyAt: now }
  else:
    require false else WRONG_STAGE
  return null

mutation consentPump(engine: engines, written: text 20..4000):
  e = engines[engine] ! else NOT_FOUND
  require e.owner = viewer and exists roles[viewer, role = 'owner'] else OWNER_ONLY
  require e.originalBrass and e.replacedAt = null else ORIGINAL_PUMP_REQUIRED
  require e.stage = 'teardown' or e.stage = 'pump' else WRONG_STAGE
  require not exists consents[engine] else CONSENT_RECORDED
  return insert consents { engine, owner: viewer, written }

mutation approvePump(engine: engines):
  require exists roles[viewer, role = 'garageOwner'] else GARAGE_OWNER_ONLY
  e = engines[engine] ! else NOT_FOUND
  require e.originalBrass and e.replacedAt = null else ORIGINAL_PUMP_REQUIRED
  require e.stage = 'teardown' or e.stage = 'pump' else WRONG_STAGE
  c = consents[engine] ! else WRITTEN_CONSENT_REQUIRED
  require c.owner = e.owner else CONSENT_OWNER_MISMATCH
  require not exists pumpApprovals[engine] else ALREADY_APPROVED
  return insert pumpApprovals { engine, owner: e.owner, consent: c.id, approvedBy: viewer }

mutation replacePump(engine: engines):
  require exists roles[viewer, role = 'mechanic'] else MECHANIC_ONLY
  e = engines[engine] ! else NOT_FOUND
  require e.stage = 'pump' else WRONG_STAGE
  require e.originalBrass and e.replacedAt = null else ORIGINAL_PUMP_REQUIRED
  require exists pumpApprovals[engine] else GARAGE_APPROVAL_REQUIRED
  update engines[engine] { replacedAt: now, replacedBy: viewer }
  return null

mutation collectEngine(engine: engines):
  require exists roles[viewer, role = 'intake'] else INTAKE_ONLY
  e = engines[engine] ! else NOT_FOUND
  require e.stage = 'ready' and e.readyAt != null else NOT_READY
  fees = 0
  if now > e.readyAt + 60d:
    fees = ((now - e.readyAt - 60d + 1d - 1) / 1d) * 2500
  update engines[engine] { stage: 'collected', collectedAt: now, storageCents: fees }
  return null

job expireQuotes(periodStart: time, periodEnd: time):
  for e in engines:
    if e.stage = 'awaiting' and e.quoteDeadline <= now:
      update engines[e.id] { stage: 'returned' }

schedule quoteExpiry every 1h: expireQuotes

invariant engines.read only .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'mechanic'] or exists roles[viewer, role = 'garageOwner']
invariant quotes.read only .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'garageOwner']
invariant consents.read only .owner = viewer or exists roles[viewer, role = 'garageOwner']
invariant pumpApprovals.insert only exists roles[viewer, role = 'garageOwner']
invariant engines always .chassis != null and .pump != null and .ladders != null
