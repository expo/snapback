-- Bronze Statue Casting: an art foundry casts bronze statues for clients
-- (sculptors and towns). The project coordinator opens each casting with a
-- scan of the approved model photos and the quoted price.
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

-- One casting per commissioned statue. Prices are integer cents (USD).
table castings:
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

-- One invoice per casting, issued at opening for the quoted price.
table invoices:
  casting: castings
  client: principal
  amountCents: int 1..100000000
  unique casting
  immutable casting, client, amountCents
  cap 1000 by client
  read <- .client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'coordinator']
  online only

-- Extra costs approved after the mold is made live here.
table designChanges:
  casting: castings
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
-- A client sees only their own castings and invoices; staff see the board.
invariant castings.read only .client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'worker'] or exists roles[principal = viewer, role = 'owner']
invariant invoices.read only .client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']
invariant designChanges.read only .casting.client = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'worker'] or exists roles[principal = viewer, role = 'owner']
invariant roles.read only .principal = viewer or viewer = 'service:operator'
-- Only the named role may perform its privileged action.
invariant castings.openCasting only exists roles[principal = viewer, role = 'coordinator']
invariant castings.approveModel only exists roles[principal = viewer, role = 'coordinator']
invariant castings.advanceStage only exists roles[principal = viewer, role = 'worker']
invariant castings.reportFlaw only .client = viewer
invariant castings.approveDesignChange only exists roles[principal = viewer, role = 'owner']
invariant designChanges.approveDesignChange only exists roles[principal = viewer, role = 'owner']
invariant invoices.openCasting only exists roles[principal = viewer, role = 'coordinator']
invariant roles.provision only viewer = 'service:operator'

-- The coordinator opens each casting with the model scan and quoted price,
-- and the invoice is issued for that price.
mutation openCasting(client: principal, title: text 1..120, modelScan: text 1..500 format url, quotedCents: int 1..100000000, unveilingAt: time):
  require exists roles[principal = viewer, role = 'coordinator'] else NOT_COORDINATOR
  require unveilingAt > now else UNVEILING_PAST
  casting = insert castings { client, title, modelScan, quotedCents, unveilingAt, stage: 'molding' }
  insert invoices { casting: casting.id, client, amountCents: quotedCents }
  return casting

-- The model must be approved at least 60 days before the unveiling, or the
-- casting is cancelled with the deposit kept.
mutation approveModel(casting: castings):
  require exists roles[principal = viewer, role = 'coordinator'] else NOT_COORDINATOR
  c = castings[casting] ! else NOT_FOUND
  require c.stage = 'molding' else BAD_STAGE
  if c.unveilingAt - now >= 60d:
    update castings[casting] { modelApprovedAt: now }
  else:
    update castings[casting] { stage: 'cancelled', depositKept: true }
  return null

-- Foundry workers move castings along the board: molding to wax, pouring,
-- patina, then delivered.
mutation advanceStage(casting: castings, stage: enum('wax', 'pouring', 'patina', 'delivered')):
  require exists roles[principal = viewer, role = 'worker'] else NOT_WORKER
  c = castings[casting] ! else NOT_FOUND
  require c.stage != 'cancelled' and c.stage != 'delivered' else BAD_STAGE
  if stage = 'wax':
    require c.stage = 'molding' else BAD_TRANSITION
    update castings[casting] { stage }
  else:
    if stage = 'pouring':
      require c.stage = 'wax' else BAD_TRANSITION
      update castings[casting] { stage }
    else:
      if stage = 'patina':
        require c.stage = 'pouring' else BAD_TRANSITION
        update castings[casting] { stage }
      else:
        require c.stage = 'patina' else BAD_TRANSITION
        update castings[casting] { stage, deliveredAt: now }
  return null

-- A casting delivered with a flaw may be reported within seven days.
mutation reportFlaw(casting: castings, flaw: text 1..1000):
  c = castings[casting] ! else NOT_FOUND
  require c.client = viewer else NOT_CLIENT
  require c.stage = 'delivered' else NOT_DELIVERED
  require now - (c.deliveredAt ?? 0) <= 7d else FLAW_WINDOW_CLOSED
  update castings[casting] { flaw, flawReportedAt: now }
  return null

-- Only the foundry owner can approve a design change after the mold is made,
-- recording the extra cost.
mutation approveDesignChange(casting: castings, extraCents: int 1..100000000, note: text 1..500):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  c = castings[casting] ! else NOT_FOUND
  require c.stage != 'molding' and c.stage != 'cancelled' and c.stage != 'delivered' else BAD_STAGE
  update castings[casting] { extraCents: c.extraCents + extraCents }
  return insert designChanges { casting, extraCents, note }

query myCastings(c: cursor ?):
  return castings where .client = viewer first 50 by .id after c

query castingDetail(casting: castings):
  return castings[casting]

query foundryBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'worker'] or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  return castings where .stage != 'delivered' and .stage != 'cancelled' first 50 by .id after c

query myInvoices(c: cursor ?):
  return invoices where .client = viewer first 50 by .id after c

query invoiceForCasting(casting: castings):
  return invoices[casting]

query designChangesFor(casting: castings, c: cursor ?):
  return designChanges where .casting = casting first 50 by .id after c
