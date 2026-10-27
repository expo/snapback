use identity password

table roles:
  principal: principal
  role: enum('client', 'coordinator', 'artist', 'owner')
  label: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('client', 'coordinator', 'artist', 'owner'), label: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, label }

query myRole():
  return roles[viewer]

query clients(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_COORDINATOR
  return roles where .role = 'client' last 100 by .id after c

table mascots:
  client: principal
  coordinator: principal
  name: text 1..100
  artwork: file <=10000000 ('application/pdf', 'image/png', 'image/jpeg')
  quoteCents: int 100..100000000
  depositCents: int 1..100000000
  debutAt: time
  approvalDeadline: time
  approvedAt: time ?
  stage: enum('approval', 'carving', 'sewing', 'fur', 'fan', 'ready', 'delivered', 'cancelled') default 'approval'
  carvedAt: time ?
  deliveredAt: time ?
  depositKept: bool default false
  createdAt: time default now
  immutable client, coordinator, name, artwork, quoteCents, depositCents, debutAt, approvalDeadline, createdAt
  read <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'coordinator'] and .coordinator = viewer and exists roles[.client, role = 'client']
  update <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner']
  online only

table invoices:
  mascot: mascots
  client: principal
  baseCents: int 100..100000000
  depositCents: int 1..100000000
  extraCents: int 0..100000000 default 0
  depositKept: bool default false
  unique mascot
  immutable mascot, client, baseCents, depositCents
  read <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'coordinator'] and exists mascots[.mascot, client = .client]
  update <- exists roles[viewer, role = 'owner']
  online only

table changes:
  mascot: mascots
  client: principal
  description: text 5..1000
  requestedBy: principal
  requestedAt: time default now
  approvedBy: principal ?
  approvedAt: time ?
  extraCents: int 1..100000000 ?
  immutable mascot, client, description, requestedBy, requestedAt
  read <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner']
  insert <- .requestedBy = viewer and exists mascots[.mascot, client = .client] and (.client = viewer or exists roles[viewer, role = 'coordinator'])
  update <- exists roles[viewer, role = 'owner']
  online only

table flaws:
  mascot: mascots
  client: principal
  description: text 5..2000
  reportedAt: time default now
  unique mascot
  immutable mascot, client, description, reportedAt
  read <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner']
  insert <- .client = viewer and exists mascots[.mascot, client = viewer]
  online only

query board(c: cursor ?):
  require exists roles[viewer] else NO_ROLE
  if exists roles[viewer, role = 'client']:
    return mascots where .client = viewer last 100 by .id after c
  return mascots last 100 by .id after c

query mascot(id: mascots):
  return mascots[id]

query invoice(mascot: mascots):
  return invoices[mascot = mascot]

query changeRequests(mascot: mascots, c: cursor ?):
  return changes where .mascot = mascot last 100 by .id after c

query flaw(mascot: mascots):
  return flaws[mascot = mascot]

mutation openMascot(client: principal, name: text 1..100, artwork: file <=10000000 ('application/pdf', 'image/png', 'image/jpeg'), quoteCents: int 100..100000000, depositCents: int 1..100000000, debutAt: time):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  require exists roles[client, role = 'client'] else NOT_CLIENT
  require debutAt >= now + 60d else TOO_LATE 'Debut must allow at least 60 days for artwork approval.'
  require debutAt <= now + 730d else TOO_FAR
  require depositCents <= quoteCents else BAD_DEPOSIT
  m = insert mascots { client, coordinator: viewer, name, artwork, quoteCents, depositCents, debutAt, approvalDeadline: debutAt - 60d }
  insert invoices { mascot: m.id, client, baseCents: quoteCents, depositCents }
  return m

mutation approveArtwork(mascot: mascots):
  m = mascots[mascot] ! else NOT_FOUND
  require m.client = viewer else NOT_CLIENT
  require m.stage = 'approval' else WRONG_STAGE
  require now <= m.approvalDeadline else APPROVAL_LATE 'The 60-day artwork deadline has passed; deposit is retained.'
  update mascots[mascot] { approvedAt: now, stage: 'carving' }

mutation advanceStage(mascot: mascots):
  require exists roles[viewer, role = 'artist'] else NOT_ARTIST
  m = mascots[mascot] ! else NOT_FOUND
  if m.stage = 'carving':
    update mascots[mascot] { stage: 'sewing', carvedAt: now }
  elif m.stage = 'sewing':
    update mascots[mascot] { stage: 'fur' }
  elif m.stage = 'fur':
    update mascots[mascot] { stage: 'fan' }
  elif m.stage = 'fan':
    update mascots[mascot] { stage: 'ready' }
  else:
    require false else WRONG_STAGE

mutation deliver(mascot: mascots):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  m = mascots[mascot] ! else NOT_FOUND
  require m.stage = 'ready' else WRONG_STAGE
  update mascots[mascot] { stage: 'delivered', deliveredAt: now }

mutation requestChange(mascot: mascots, description: text 5..1000):
  m = mascots[mascot] ! else NOT_FOUND
  require m.client = viewer or exists roles[viewer, role = 'coordinator'] else NOT_REQUESTER
  require m.carvedAt != null else HEAD_NOT_CARVED
  require m.stage != 'delivered' and m.stage != 'cancelled' else CLOSED
  return insert changes { mascot, client: m.client, description, requestedBy: viewer }

mutation approveChange(change: changes, extraCents: int 1..100000000):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  ch = changes[change] ! else NOT_FOUND
  require ch.approvedAt = null else ALREADY_APPROVED
  m = mascots[ch.mascot] ! else NOT_FOUND
  require m.carvedAt != null else HEAD_NOT_CARVED
  require m.stage != 'delivered' and m.stage != 'cancelled' else CLOSED
  inv = invoices[mascot = ch.mascot] ! else NOT_FOUND
  update changes[change] { approvedBy: viewer, approvedAt: now, extraCents }
  update invoices[inv.id] { extraCents: inv.extraCents + extraCents }

mutation reportFlaw(mascot: mascots, description: text 5..2000):
  m = mascots[mascot] ! else NOT_FOUND
  require m.client = viewer else NOT_CLIENT
  require m.stage = 'delivered' and m.deliveredAt != null else NOT_DELIVERED
  require now <= m.deliveredAt + 7d else REPORT_LATE 'Flaws must be reported within seven days of delivery.'
  return insert flaws { mascot, client: viewer, description }

job cancelOverdue():
  for m in mascots:
    if m.stage = 'approval' and now > m.approvalDeadline:
      update mascots[m.id] { stage: 'cancelled', depositKept: true }
      inv = invoices[mascot = m.id]
      if inv != null:
        update invoices[inv.id] { depositKept: true }
schedule cancellation every 1m: cancelOverdue

invariant mascots.read only .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner']
invariant invoices.read only .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
invariant changes.update only exists roles[viewer, role = 'owner']
invariant flaws.insert only .client = viewer
invariant mascots always .artwork != null
