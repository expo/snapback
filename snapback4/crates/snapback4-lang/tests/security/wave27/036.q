-- Bronze Statue Casting (v2): castings are now "casting commissions".
-- Table and reference renames preserve every row and reference identity in
-- both directions (`renamed from`); old operation and argument spellings are
-- kept as aliases so v1 clients keep working. designChanges keeps its
-- internal `casting` reference: that reference is the row's sole ownership
-- path and the backend refuses to rename such a reference (E_ADOPT), so it
-- stays while every user-visible surface uses "commission".
use identity password

-- Roster: one role per principal, granted only by the local operator.
-- Signup creates an account without a role.
table roles:
  principal: principal
  role: enum('owner', 'coordinator', 'worker', 'client')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

-- One casting commission per commissioned statue (renamed from castings).
-- Prices are integer cents (USD).
table commissions renamed from castings:
  client: principal
  title: text 1..120
  modelScan: text 1..500 format url
  quotedCents: int 1..100000000
  unveilingAt: time
  modelApprovedAt: time ?
  stage: enum('molding', 'wax', 'pouring', 'patina', 'delivered', 'cancelled')
  deliveredAt: time ?
  flaw: text 1..1000 ?
  flawReportedAt: time ?
  depositKept: bool default false
  extraCents: int 0..100000000 default 0
  createdAt: time default now
  immutable client, quotedCents, unveilingAt
  cap 1000 by client
  read <- .client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'worker'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'coordinator']
  update <- .client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'worker'] or exists roles[principal = viewer, role = 'owner']
  online only

-- One invoice per casting commission, issued at opening for the quoted price.
table invoices:
  commission: commissions renamed from casting
  client: principal
  amountCents: int 1..100000000
  unique commission
  immutable commission, client, amountCents
  cap 1000 by client
  read <- .client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'coordinator']
  online only

-- Extra costs approved after the mold is made live here.
table designChanges:
  casting: commissions
  extraCents: int 1..100000000
  note: text 1..500
  approvedAt: time default now
  immutable casting, extraCents, note
  cap 100 by casting
  read <- .casting.client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'worker'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'owner']
  online only

mutation provision(principal: principal, role: enum('owner', 'coordinator', 'worker', 'client')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

-- Privacy and authority intent, stated independently from the rules above.
-- A client sees only their own casting commissions and invoices; staff see the board.
invariant commissions.read only .client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'worker'] or exists roles[principal = viewer, role = 'owner']
invariant invoices.read only .client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']
invariant designChanges.read only .casting.client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'worker'] or exists roles[principal = viewer, role = 'owner']
invariant roles.read only .principal = viewer or viewer = 'service:operator'
-- Only the named role may perform its privileged action.
invariant commissions.openCommission only exists roles[principal = viewer, role = 'coordinator']
invariant commissions.approveModel only exists roles[principal = viewer, role = 'coordinator']
invariant commissions.replaceModelScan only exists roles[principal = viewer, role = 'coordinator']
invariant commissions.advanceStage only exists roles[principal = viewer, role = 'worker']
invariant commissions.reportFlaw only .client = viewer
invariant commissions.approveDesignChange only exists roles[principal = viewer, role = 'owner']
invariant designChanges.approveDesignChange only exists roles[principal = viewer, role = 'owner']
invariant invoices.openCommission only exists roles[principal = viewer, role = 'coordinator']
invariant roles.provision only viewer = 'service:operator'

-- The coordinator opens each casting commission with the model scan and
-- quoted price, and the invoice is issued for that price.
mutation openCommission(client: principal, title: text 1..120, modelScan: text 1..500 format url, quotedCents: int 1..100000000, unveilingAt: time):
  require exists roles[principal = viewer, role = 'coordinator'] else NOT_COORDINATOR
  require unveilingAt > now else UNVEILING_PAST
  commission = insert commissions { client, title, modelScan, quotedCents, unveilingAt, stage: 'molding' }
  insert invoices { commission: commission.id, client, amountCents: quotedCents }
  return commission
alias openCasting = openCommission

-- The model must be approved at least 60 days before the unveiling, or the
-- commission is cancelled with the deposit kept.
mutation approveModel(commission: commissions alias casting):
  require exists roles[principal = viewer, role = 'coordinator'] else NOT_COORDINATOR
  c = commissions[commission] ! else NOT_FOUND
  require c.stage = 'molding' else BAD_STAGE
  if c.unveilingAt - now >= 60d:
    update commissions[commission] { modelApprovedAt: now }
  else:
    update commissions[commission] { stage: 'cancelled', depositKept: true }
  return null

-- Only the project coordinator may replace a commission's approved model
-- photo scan; foundry workers may not.
mutation replaceModelScan(commission: commissions, modelScan: text 1..500 format url):
  require exists roles[principal = viewer, role = 'coordinator'] else NOT_COORDINATOR
  c = commissions[commission] ! else NOT_FOUND
  update commissions[commission] { modelScan }
  return null

-- Foundry workers move commissions along the board: molding to wax, pouring,
-- patina, then delivered.
mutation advanceStage(commission: commissions alias casting, stage: enum('wax', 'pouring', 'patina', 'delivered')):
  require exists roles[principal = viewer, role = 'worker'] else NOT_WORKER
  c = commissions[commission] ! else NOT_FOUND
  require c.stage != 'cancelled' and c.stage != 'delivered' else BAD_STAGE
  if stage = 'wax':
    require c.stage = 'molding' else BAD_TRANSITION
    update commissions[commission] { stage }
  else:
    if stage = 'pouring':
      require c.stage = 'wax' else BAD_TRANSITION
      update commissions[commission] { stage }
    else:
      if stage = 'patina':
        require c.stage = 'pouring' else BAD_TRANSITION
        update commissions[commission] { stage }
      else:
        require c.stage = 'patina' else BAD_TRANSITION
        update commissions[commission] { stage, deliveredAt: now }
  return null

-- A commission delivered with a flaw may be reported within seven days.
mutation reportFlaw(commission: commissions alias casting, flaw: text 1..1000):
  c = commissions[commission] ! else NOT_FOUND
  require c.client = viewer else NOT_CLIENT
  require c.stage = 'delivered' else NOT_DELIVERED
  require now - (c.deliveredAt ?? 0) <= 7d else FLAW_WINDOW_CLOSED
  update commissions[commission] { flaw, flawReportedAt: now }
  return null

-- Only the foundry owner can approve a design change after the mold is made,
-- recording the extra cost.
mutation approveDesignChange(commission: commissions alias casting, extraCents: int 1..100000000, note: text 1..500):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  c = commissions[commission] ! else NOT_FOUND
  require c.stage != 'molding' and c.stage != 'cancelled' and c.stage != 'delivered' else BAD_STAGE
  update commissions[commission] { extraCents: c.extraCents + extraCents }
  return insert designChanges { casting: commission, extraCents, note }

query myCommissions(c: cursor ?):
  return commissions where .client = viewer first 50 by .id after c
alias myCastings = myCommissions

query commissionDetail(commission: commissions alias casting):
  return commissions[commission]
alias castingDetail = commissionDetail

query foundryBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'worker'] or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  return commissions where .stage != 'delivered' and .stage != 'cancelled' first 50 by .id after c

query myInvoices(c: cursor ?):
  return invoices where .client = viewer first 50 by .id after c

query invoiceForCommission(commission: commissions alias casting):
  return invoices[commission]
alias invoiceForCasting = invoiceForCommission

query designChangesFor(commission: commissions alias casting, c: cursor ?):
  return designChanges where .casting = commission first 50 by .id after c
