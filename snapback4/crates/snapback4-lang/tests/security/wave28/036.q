-- Wax Figure Commissions.
-- Roles: client, coordinator (project coordinator), artist (studio artist),
-- owner (studio owner). Password accounts; the local filesystem operator
-- ('service:operator') provisions roles on staging/production.
use identity password

table roles:
  principal: principal
  role: enum('client', 'coordinator', 'artist', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

-- One commissioned figure. The coordinator opens it with a scan of the
-- approved likeness photos and the quoted price.
table figures:
  client: principal
  title: text 3..120
  likenessScan: image <=10000000
  quotedPrice: money USD
  extraCost: money USD default 0
  unveilingAt: time
  likenessApproved: bool default false
  likenessApprovedAt: time ?
  stage: enum('clay_sculpt', 'molding', 'wax_pour', 'hair_insertion', 'delivered', 'cancelled') default 'clay_sculpt'
  deliveredAt: time ?
  immutable client, unveilingAt
  cap 500 by client
  read <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner']
  online only

-- Invoices stay with the figure even when it is cancelled (deposit kept).
table invoices:
  figure: figures
  client: principal
  amount: money USD
  kind: enum('quote', 'extra')
  paid: bool default false
  at: time default now
  immutable figure, client, amount, kind
  cap 50 by figure
  read <- .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  update <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  online only

-- A flaw may be reported within seven days of delivery.
table flawReports:
  figure: figures
  reporter: principal
  note: text 3..1000
  at: time default now
  unique figure else ALREADY_REPORTED 'A flaw has already been reported for this figure.'
  immutable figure, reporter, note
  read <- .reporter = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner']
  insert <- .reporter = viewer
  online only

mutation provision(principal: principal, role: enum('client', 'coordinator', 'artist', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query clientDirectory(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return roles where .role = 'client' last 100 by .id after c

mutation createFigure(client: principal, title: text 3..120, likenessScan: image <=10000000, quotedPrice: money USD, unveilingAt: time):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  require unveilingAt > now else BAD_UNVEILING
  require quotedPrice > 0 else BAD_PRICE
  f = insert figures { client, title, likenessScan, quotedPrice, unveilingAt }
  insert invoices { figure: f.id, client, amount: quotedPrice, kind: 'quote' }
  return f

-- The likeness must be approved at least 60 days before the unveiling.
mutation approveLikeness(figure: figures):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  f = figures[figure] ! else NOT_FOUND
  require not f.likenessApproved else ALREADY_APPROVED
  require f.stage != 'cancelled' and f.stage != 'delivered' else BAD_STAGE
  require now <= f.unveilingAt - 60d else TOO_LATE
  update figures[figure] { likenessApproved: true, likenessApprovedAt: now }
  return null

-- A likeness change before the mold is made needs no extra cost.
mutation changeLikeness(figure: figures, likenessScan: image <=10000000):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  f = figures[figure] ! else NOT_FOUND
  require f.stage = 'clay_sculpt' else MOLD_MADE
  update figures[figure] { likenessScan }
  return null

-- Only the studio owner can approve a likeness change after the mold is
-- made, recording the extra cost as an invoice.
mutation approveLikenessChange(figure: figures, likenessScan: image <=10000000, extraCost: money USD):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  f = figures[figure] ! else NOT_FOUND
  require f.stage != 'clay_sculpt' and f.stage != 'cancelled' and f.stage != 'delivered' else BAD_STAGE
  require extraCost > 0 else BAD_COST
  update figures[figure] { likenessScan, extraCost: f.extraCost + extraCost }
  insert invoices { figure, client: f.client, amount: extraCost, kind: 'extra' }
  return null

-- Studio artists move figures along the live studio board.
mutation advanceStage(figure: figures):
  require exists roles[viewer, role = 'artist'] else NOT_ARTIST
  f = figures[figure] ! else NOT_FOUND
  require f.likenessApproved else NOT_APPROVED
  require f.stage = 'clay_sculpt' or f.stage = 'molding' or f.stage = 'wax_pour' or f.stage = 'hair_insertion' else BAD_STAGE
  next = 'molding' if f.stage = 'clay_sculpt' else 'wax_pour' if f.stage = 'molding' else 'hair_insertion' if f.stage = 'wax_pour' else 'delivered'
  update figures[figure] { stage: next, deliveredAt: now if next = 'delivered' else f.deliveredAt }
  return null

mutation cancelFigure(figure: figures):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  f = figures[figure] ! else NOT_FOUND
  require f.stage != 'delivered' and f.stage != 'cancelled' else BAD_STAGE
  update figures[figure] { stage: 'cancelled' }
  return null

mutation reportFlaw(figure: figures, note: text 3..1000):
  f = figures[figure] ! else NOT_FOUND
  require f.client = viewer else NOT_CLIENT
  require f.stage = 'delivered' else NOT_DELIVERED
  require f.deliveredAt != null else NOT_DELIVERED
  require now <= f.deliveredAt + 7d else TOO_LATE
  return insert flawReports { figure, reporter: viewer, note }

query myFigures(c: cursor ?):
  return figures where .client = viewer last 50 by .id after c

query studioBoard(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return figures last 50 by .id after c

query figureDetail(figure: figures):
  return figures[figure]

query myInvoices(c: cursor ?):
  return invoices where .client = viewer last 50 by .id after c

query allInvoices(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return invoices last 50 by .id after c

query flawsFor(figure: figures, c: cursor ?):
  f = figures[figure] ! else NOT_FOUND
  return flawReports where .figure = figure last 50 by .id after c

-- Figures whose likeness is still unapproved once the 60-day deadline
-- passes are cancelled with the deposit kept (their invoices stay).
job cancelOverdue(periodStart: time, periodEnd: time):
  for f in figures where .unveilingAt >= periodEnd - 90d and .unveilingAt < periodEnd + 60d by .unveilingAt:
    if not f.likenessApproved and f.stage != 'cancelled' and f.stage != 'delivered':
      if f.unveilingAt - 60d < periodEnd:
        update figures[f.id] { stage: 'cancelled' }

schedule cancelDaily every 1d at 00:00: cancelOverdue

-- Privacy intent: clients read only their own figures and invoices.
invariant figures.read only .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'artist'] or exists roles[viewer, role = 'owner']
invariant invoices.read only .client = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
-- Role authority for the spec's gated actions.
invariant figures.approveLikenessChange only exists roles[viewer, role = 'owner']
invariant figures.advanceStage only exists roles[viewer, role = 'artist']
