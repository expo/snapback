use identity password

table roles:
  principal: principal
  role: enum('owner', 'technician', 'workshopOwner')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'workshopOwner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or (.principal = viewer and .role = 'owner')
  update <- viewer = 'service:operator'
  online only

fn staff():
  return exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'workshopOwner']

table machines:
  owner: principal
  model: text 2..100
  serial: text 1..80
  notes: text 1..2000
  quoteCents: int 1..10000000
  boiler: image <=5000000
  groupHeads: image <=5000000
  casing: image <=5000000
  loggedBy: principal
  intakeAt: time default now
  quoteDueAt: time
  approvedAt: time ?
  stage: enum('awaiting_quote', 'teardown', 'descaling', 'rebuild', 'pressure_test', 'ready', 'returned', 'collected') default 'awaiting_quote'
  consent: text 10..4000 ?
  consentAt: time ?
  boilerApprovedBy: principal ?
  boilerApprovedAt: time ?
  readyAt: time ?
  storageDueAt: time ?
  storageCents: int 0.. default 0
  collectedAt: time ?
  immutable owner, model, serial, notes, quoteCents, boiler, groupHeads, casing, loggedBy, intakeAt, quoteDueAt
  read <- .owner = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'workshopOwner']
  insert <- exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'workshopOwner']
  update <- .owner = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'workshopOwner']
  online only

invariant machines.read only .owner = viewer or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'workshopOwner']
invariant machines.insert only exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'workshopOwner']

mutation provision(principal: principal, role: enum('owner', 'technician', 'workshopOwner'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

mutation registerOwner(name: text 1..80):
  require not exists roles[viewer] else ALREADY_REGISTERED
  return insert roles { principal: viewer, role: 'owner', name }

query myRole():
  return roles[viewer]

query owners(c: cursor ?):
  require staff() else NOT_STAFF
  return roles where .role = 'owner' first 100 by .id after c

query board(c: cursor ?):
  return machines last 100 by .id after c

query machine(machine: machines):
  return machines[machine]

mutation intake(owner: principal, model: text 2..100, serial: text 1..80, notes: text 1..2000, quoteCents: int 1..10000000, boiler: image <=5000000, groupHeads: image <=5000000, casing: image <=5000000):
  require staff() else NOT_STAFF
  require exists roles[owner, role = 'owner'] else NOT_OWNER
  return insert machines { owner, model, serial, notes, quoteCents, boiler, groupHeads, casing, loggedBy: viewer, quoteDueAt: now + 21d }

mutation approveQuote(machine: machines):
  m = machines[machine] ! else NOT_FOUND
  require m.owner = viewer else NOT_MACHINE_OWNER
  require m.stage = 'awaiting_quote' else WRONG_STAGE
  require now < m.quoteDueAt else QUOTE_EXPIRED
  update machines[machine] { approvedAt: now, stage: 'teardown' }

mutation submitConsent(machine: machines, consent: text 10..4000):
  m = machines[machine] ! else NOT_FOUND
  require m.owner = viewer else NOT_MACHINE_OWNER
  require m.approvedAt != null and m.readyAt = null and m.stage != 'returned' else WRONG_STAGE
  require m.boilerApprovedAt = null else ALREADY_APPROVED
  update machines[machine] { consent, consentAt: now }

mutation approveBoiler(machine: machines):
  require exists roles[viewer, role = 'workshopOwner'] else NOT_WORKSHOP_OWNER
  m = machines[machine] ! else NOT_FOUND
  require m.approvedAt != null and m.readyAt = null and m.stage != 'returned' else WRONG_STAGE
  require m.consent != null and m.consentAt != null else WRITTEN_CONSENT_REQUIRED
  require m.boilerApprovedAt = null else ALREADY_APPROVED
  update machines[machine] { boilerApprovedBy: viewer, boilerApprovedAt: now }

mutation advanceStage(machine: machines):
  require staff() else NOT_STAFF
  m = machines[machine] ! else NOT_FOUND
  if m.stage = 'teardown':
    update machines[machine] { stage: 'descaling' }
  else if m.stage = 'descaling':
    update machines[machine] { stage: 'rebuild' }
  else if m.stage = 'rebuild':
    update machines[machine] { stage: 'pressure_test' }
  else if m.stage = 'pressure_test':
    update machines[machine] { stage: 'ready', readyAt: now, storageDueAt: now + 30d }
  else:
    require false else WRONG_STAGE

mutation collect(machine: machines):
  require staff() else NOT_STAFF
  m = machines[machine] ! else NOT_FOUND
  require m.stage = 'ready' or m.stage = 'returned' else WRONG_STAGE
  fee = 0
  if m.stage = 'ready' and m.storageDueAt != null and now > m.storageDueAt:
    fee = ((now - m.storageDueAt - 1) / 1d + 1) * 1000
  update machines[machine] { stage: 'collected', collectedAt: now, storageCents: fee }

job deadlines():
  for m in machines:
    if m.stage = 'awaiting_quote' and now >= m.quoteDueAt:
      update machines[m.id] { stage: 'returned' }
    if m.stage = 'ready' and m.storageDueAt != null and now > m.storageDueAt:
      fee = ((now - m.storageDueAt - 1) / 1d + 1) * 1000
      update machines[m.id] { storageCents: fee }

schedule workshopDeadlines every 1h: deadlines
