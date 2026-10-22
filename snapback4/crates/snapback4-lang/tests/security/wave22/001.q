-- Stained Glass Restorations.
--
-- Roles: owner (panel owners), clerk (intake), glazier (bench),
-- director (studio director). Provisioned by the local operator only;
-- there is no self-signup role path.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'clerk', 'glazier', 'director')
  email: text <=254 ?
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'clerk', 'glazier', 'director'), email: text <=254 ?):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, email }

query myRole():
  return roles[viewer]

-- Staff-only directory of owner accounts (email so the intake clerk can
-- pick the panel's owner). Owners must not list other owners.
query owners(c: cursor ?):
  require exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'director'] else NOT_STAFF
  return roles where .role = 'owner' first 50 by .id after c { id, principal, email }

table panels:
  owner: principal
  title: text 3..120
  description: text <=1000 ?
  photos: [image <=5000000] 1..6
  quotedCents: int 1..100000000
  quotedAt: time default now
  status: enum('quoted', 'approved', 'releading', 'glass_matching', 'cementing', 'ready', 'collected', 'crated_back') default 'quoted'
  readyAt: time ?
  collectedAt: time ?
  storageFeeCents: int 0..100000000 ?
  immutable owner, photos, quotedCents, quotedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
  insert <- exists roles[principal = viewer, role = 'clerk']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
  online only

-- One page for every role. Staff see the whole bench; anyone else sees
-- only their own panels. Hidden rows never appear (null, never a denial).
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'director'] or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier']:
    return panels last 50 by .id after c
  return panels where .owner = viewer last 50 by .id after c

query panelDetail(panel: panels):
  return panels[panel]

-- The intake clerk logs a panel: at least one photo of every cracked or
-- missing piece, plus the quoted restoration price in cents.
mutation logPanel(owner: principal, title: text 3..120, description: text <=1000 ?, photos: [image <=5000000] 1..6, quotedCents: int 1..100000000):
  require exists roles[principal = viewer, role = 'clerk'] else NOT_CLERK
  require exists roles[principal = owner, role = 'owner'] else NOT_OWNER_ROLE
  return insert panels { owner, title, description, photos, quotedCents }

-- The owner approves the quote within 21 days of the quote date.
mutation approveQuote(panel: panels):
  p = panels[panel] ! else NOT_FOUND
  require p.owner = viewer else NOT_OWNER
  require p.status = 'quoted' else BAD_STATE
  require now <= p.quotedAt + 21d else QUOTE_EXPIRED 'The 21-day approval window has passed; the panel is crated back unrepaired.'
  update panels[panel] { status: 'approved' }
  return null

-- The bench moves approved, releading, glass matching, cementing, ready in order.
mutation advanceStage(panel: panels, stage: enum('releading', 'glass_matching', 'cementing', 'ready')):
  require exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director'] else NOT_BENCH
  p = panels[panel] ! else NOT_FOUND
  require (p.status = 'approved' and stage = 'releading') or (p.status = 'releading' and stage = 'glass_matching') or (p.status = 'glass_matching' and stage = 'cementing') or (p.status = 'cementing' and stage = 'ready') else BAD_TRANSITION 'Panels move approved, releading, glass matching, cementing, ready in order.'
  if stage = 'ready':
    update panels[panel] { status: stage, readyAt: now }
  else:
    update panels[panel] { status: stage }
  return null

-- A finished panel is collected; the clerk or director records the pickup,
-- or the owner collects their own panel.
mutation collectPanel(panel: panels):
  p = panels[panel] ! else NOT_FOUND
  require p.status = 'ready' else BAD_STATE 'Only a ready panel can be collected.'
  require p.owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'director'] else NOT_COLLECTOR
  update panels[panel] { status: 'collected', collectedAt: now }
  return null

table handPaints:
  panel: panels
  approver: principal
  extraCents: int 1..100000000
  consent: bool
  consentNote: text 3..500
  approvedAt: time default now
  immutable panel, approver, extraCents, consent, consentNote, approvedAt
  read <- exists panels[.panel, owner = viewer] or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
  insert <- exists roles[principal = viewer, role = 'director']
  online only

query paintsFor(panel: panels, c: cursor ?):
  return handPaints where .panel = panel first 20 by .id after c

-- Only the studio director may approve hand-painting replacement glass that
-- exceeds the quote, recording the owner's consent.
mutation approveHandPaint(panel: panels, extraCents: int 1..100000000, consent: bool, consentNote: text 3..500):
  require exists roles[principal = viewer, role = 'director'] else NOT_DIRECTOR
  require consent = true else CONSENT_REQUIRED 'Record the owner consent before approving over-quote hand-painting.'
  p = panels[panel] ! else NOT_FOUND
  require p.status = 'approved' or p.status = 'releading' or p.status = 'glass_matching' or p.status = 'cementing' or p.status = 'ready' else BAD_STATE 'Hand-painting can only be approved while restoration is underway.'
  return insert handPaints { panel, approver: viewer, extraCents, consent, consentNote }

-- A quote not approved within 21 days: the panel is crated back unrepaired.
job expireQuotes(periodStart: time, periodEnd: time):
  for p in panels:
    if p.status = 'quoted' and p.quotedAt + 21d < periodEnd:
      update panels[p.id] { status: 'crated_back' }

-- A finished panel not collected within 60 days of its ready notice starts
-- a flat $50.00 storage fee.
job assessStorageFees(periodStart: time, periodEnd: time):
  for p in panels:
    if p.status = 'ready' and p.storageFeeCents = null:
      if p.readyAt != null and p.readyAt + 60d < periodEnd:
        update panels[p.id] { storageFeeCents: 5000 }

schedule quoteExpiry every 1d at 03:00: expireQuotes
schedule storageFees every 1d at 04:00: assessStorageFees

-- Privacy intent, stated independently of the enforcing rules above.
invariant panels.read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
invariant panels.photos read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
invariant panels.quotedCents read only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
invariant panels.insert only exists roles[principal = viewer, role = 'clerk']
invariant panels.logPanel only exists roles[principal = viewer, role = 'clerk']
invariant panels.approveQuote only .owner = viewer
invariant panels.advanceStage only exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
invariant panels.collectPanel only .owner = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'director']
invariant handPaints.read only exists panels[.panel, owner = viewer] or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
invariant handPaints.insert only exists roles[principal = viewer, role = 'director']
invariant handPaints.approveHandPaint only exists roles[principal = viewer, role = 'director']
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'clerk'] or exists roles[principal = viewer, role = 'glazier'] or exists roles[principal = viewer, role = 'director']
