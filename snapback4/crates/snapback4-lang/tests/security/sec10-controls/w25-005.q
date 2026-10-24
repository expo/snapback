use identity password

-- Accounts gain staff authority only through a local operator credential.
table people:
  principal: principal
  role: enum('family', 'clerk', 'engraver', 'manager')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists people[viewer, role = 'clerk'] or exists people[viewer, role = 'engraver'] or exists people[viewer, role = 'manager'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator' or (.principal = viewer and .role = 'family')
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('family', 'clerk', 'engraver', 'manager'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert people[principal] { principal, role, name }

mutation registerFamily(name: text 1..80):
  require not exists people[viewer] else ALREADY_REGISTERED
  return insert people { principal: viewer, role: 'family', name }

fn staff():
  p = people[viewer]
  return p.role = 'clerk' or p.role = 'engraver' or p.role = 'manager'
fn clerk():
  p = people[viewer]
  return p.role = 'clerk' or p.role = 'manager'
fn production():
  p = people[viewer]
  return p.role = 'engraver' or p.role = 'manager'
fn manager():
  return people[viewer].role = 'manager'

query myAccount():
  return people[viewer]
query families(c: cursor ?):
  require clerk() else NOT_CLERK
  return people where .role = 'family' first 100 by .id after c { principal, name }

table orders:
  family: principal
  familyName: text 1..80
  reference: text 1..100
  inscription: text 1..1200
  inscriptionHistory: enum('approved change after cutting', 'no approved change after cutting')
  cuttingStartedAt: time ?
  inscriptionVersion: int 1.. default 1
  quoteCents: int 1..100000000
  proof: image <=5000000
  returnedProof: image <=5000000 ?
  openedAt: time
  proofDueAt: time
  returnedAt: time ?
  openedBy: principal
  stage: enum('awaiting', 'held', 'cutting', 'lettering', 'gilding', 'ready', 'storage', 'installed')
  readyAt: time ?
  storageDueAt: time ?
  installedAt: time ?
  storageDailyCents: int 500..500 default 500
  immutable family, familyName, reference, quoteCents, proof, openedAt, proofDueAt, openedBy, storageDailyCents
  read <- .family = viewer or exists people[viewer, role = 'clerk'] or exists people[viewer, role = 'engraver'] or exists people[viewer, role = 'manager']
  insert <- exists people[viewer, role = 'clerk'] or exists people[viewer, role = 'manager']
  update (old, next) <- (old.family = viewer or exists people[viewer, role = 'clerk'] or exists people[viewer, role = 'engraver'] or exists people[viewer, role = 'manager']) and (old.inscriptionHistory = next.inscriptionHistory or exists people[viewer, role = 'manager'])
  online only

fn visibleOrder(o: orders):
  r = orders[o] ! else NOT_FOUND
  effective = r.stage
  if r.stage = 'awaiting' and r.returnedAt = null and now >= r.proofDueAt:
    effective = 'held'
  if r.stage = 'ready' and r.storageDueAt != null and now >= r.storageDueAt:
    effective = 'storage'
  return { ...r, stage: effective, paidStorage: effective = 'storage' }

query myOrders(c: cursor ?):
  return orders where .family = viewer first 100 by .id after c { *, stage: 'held' if .stage = 'awaiting' and .returnedAt = null and now >= .proofDueAt else ('storage' if .stage = 'ready' and .storageDueAt != null and now >= .storageDueAt else .stage) }
query yardBoard(c: cursor ?):
  require staff() else NOT_STAFF
  return orders first 100 by .id after c { *, stage: 'held' if .stage = 'awaiting' and .returnedAt = null and now >= .proofDueAt else ('storage' if .stage = 'ready' and .storageDueAt != null and now >= .storageDueAt else .stage) }
query orderDetail(order: orders):
  return visibleOrder(order)

mutation openOrder(family: principal, reference: text 1..100, inscription: text 1..1200, quoteCents: int 1..100000000, proof: image <=5000000):
  require clerk() else NOT_CLERK
  p = people[family] ! else FAMILY_NOT_FOUND
  require p.role = 'family' else NOT_FAMILY
  return insert orders { family, familyName: p.name, reference, inscription, quoteCents, proof, openedAt: now, proofDueAt: now + 21d, openedBy: viewer, stage: 'awaiting', inscriptionHistory: 'no approved change after cutting' }

mutation returnProof(order: orders, proof: image <=5000000):
  r = orders[order] ! else NOT_FOUND
  require r.family = viewer and people[viewer].role = 'family' else NOT_YOUR_ORDER
  require now < r.proofDueAt else PROOF_DEADLINE 'The 21-day proof return window has closed.'
  require r.stage = 'awaiting' and r.returnedAt = null else PROOF_ALREADY_RETURNED
  return update orders[order] { returnedProof: proof, returnedAt: now }

mutation advanceOrder(order: orders, stage: enum('cutting', 'lettering', 'gilding', 'ready', 'installed')):
  require production() else NOT_ENGRAVER
  r = orders[order] ! else NOT_FOUND
  require r.returnedAt != null else SIGNED_PROOF_REQUIRED
  require r.stage != 'awaiting' or now < r.proofDueAt or r.returnedAt != null else ORDER_HELD
  allowed = (r.stage = 'awaiting' and stage = 'cutting') or (r.stage = 'cutting' and stage = 'lettering') or (r.stage = 'lettering' and stage = 'gilding') or (r.stage = 'gilding' and stage = 'ready') or ((r.stage = 'ready' or r.stage = 'storage') and stage = 'installed')
  require allowed else INVALID_TRANSITION
  if stage = 'ready':
    return update orders[order] { stage, readyAt: now, storageDueAt: now + 90d }
  if stage = 'installed':
    return update orders[order] { stage, installedAt: now }
  if stage = 'cutting':
    return update orders[order] { stage, cuttingStartedAt: now }
  return update orders[order] { stage }

table changes:
  order: orders
  family: principal
  requesterName: text 1..80
  requestedBy: principal
  requestedAt: time
  newInscription: text 1..1200
  previousInscription: text 1..1200
  baseVersion: int 1..
  status: enum('pending', 'approved')
  approvedAfterCutting: bool ?
  approvedStage: text <=20 ?
  approvedBy: principal ?
  approvedAt: time ?
  immutable order, family, requesterName, requestedBy, requestedAt, newInscription, previousInscription, baseVersion
  read <- .family = viewer or exists people[viewer, role = 'clerk'] or exists people[viewer, role = 'engraver'] or exists people[viewer, role = 'manager']
  insert <- .family = viewer or exists people[viewer, role = 'clerk'] or exists people[viewer, role = 'engraver'] or exists people[viewer, role = 'manager']
  update <- exists people[viewer, role = 'manager']
  online only

query orderChanges(order: orders, c: cursor ?):
  r = orders[order] ! else NOT_FOUND
  return changes where .order = r.id first 100 by .id after c

mutation requestChange(order: orders, requesterName: text 1..80, newInscription: text 1..1200):
  r = orders[order] ! else NOT_FOUND
  require r.family = viewer or staff() else NOT_YOUR_ORDER
  require r.stage != 'installed' else ALREADY_INSTALLED
  require r.inscription != newInscription else NO_CHANGE
  return insert changes { order, family: r.family, requesterName, requestedBy: viewer, requestedAt: now, newInscription, previousInscription: r.inscription, baseVersion: r.inscriptionVersion, status: 'pending' }

mutation approveChange(change: changes):
  require manager() else NOT_MANAGER
  c = changes[change] ! else NOT_FOUND
  r = orders[c.order] ! else NOT_FOUND
  require c.status = 'pending' else ALREADY_APPROVED
  require r.stage != 'installed' else ALREADY_INSTALLED
  require r.inscriptionVersion = c.baseVersion else STALE_REQUEST
  if r.stage != 'awaiting' and r.stage != 'held':
    update orders[r.id] { inscriptionHistory: 'approved change after cutting' }
  update orders[r.id] { inscription: c.newInscription, inscriptionVersion: r.inscriptionVersion + 1 }
  return update changes[change] { status: 'approved', approvedBy: viewer, approvedAt: now, approvedStage: r.stage, approvedAfterCutting: r.stage != 'awaiting' and r.stage != 'held' }

-- Catch up all unfinished orders, including deadlines missed during downtime.
job deadlines():
  for r in orders:
    if r.stage = 'awaiting' and r.returnedAt = null and now >= r.proofDueAt:
      update orders[r.id] { stage: 'held' }
    if r.stage = 'ready' and r.storageDueAt != null and now >= r.storageDueAt:
      update orders[r.id] { stage: 'storage' }
schedule deadlineSweep every 1m: deadlines

-- Independent product intent: family privacy and privileged inscription edits.
invariant orders.read only .family = viewer or exists people[viewer, role = 'clerk'] or exists people[viewer, role = 'engraver'] or exists people[viewer, role = 'manager']
invariant changes.read only .family = viewer or exists people[viewer, role = 'clerk'] or exists people[viewer, role = 'engraver'] or exists people[viewer, role = 'manager']
invariant people.read only .principal = viewer or exists people[viewer, role = 'clerk'] or exists people[viewer, role = 'engraver'] or exists people[viewer, role = 'manager'] or viewer = 'service:operator'
invariant people.role update only viewer = 'service:operator'
invariant orders.inscription update only exists people[viewer, role = 'manager']
invariant changes.approveChange only exists people[viewer, role = 'manager']

mutation setInscriptionHistory(order: orders, label: enum('approved change after cutting', 'no approved change after cutting')):
  require manager() else NOT_MANAGER
  r = orders[order] ! else NOT_FOUND
  return update orders[order] { inscriptionHistory: label }

backfill orders historyFromReceipts(id: id):
  {inscriptionHistory: 'approved change after cutting' if exists changes[order = id, status = 'approved', approvedAfterCutting = true] else 'no approved change after cutting'}

invariant orders.inscriptionHistory update only exists people[viewer, role = 'manager']
