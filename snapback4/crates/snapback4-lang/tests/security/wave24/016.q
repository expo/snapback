-- Carousel Horse Restorations studio backend.
-- Roles: owner (figure owners), curator (intake), carver (restoration board),
-- director (repaint approvals, oversight). Roles are provisioned by the local
-- operator; signup alone grants no role.
use identity password

table staff:
  principal: principal
  role: enum('curator', 'carver', 'director')
  unique principal
  immutable principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('curator', 'carver', 'director')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert staff[principal] { principal, role }

query myRole():
  return staff[viewer]

-- Public client directory so the intake curator can attribute a figure to a
-- signed-up owner. Owners register their own row only.
table owners:
  principal: principal
  displayName: text 3..60
  unique principal
  immutable principal
  read <- .principal = viewer or exists staff[viewer]
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  online only

mutation joinDirectory(displayName: text 3..60):
  return upsert owners[principal = viewer] { principal: viewer, displayName }

query ownerDirectory(c: cursor ?):
  s = staff[viewer]
  require s != null else NOT_STAFF
  return owners first 100 by .id after c

-- A carousel figure under restoration. The quote (quoteCents + quotedAt) is
-- stored on the figure; the owner approves it within 30 days. A finished
-- figure collected later than 60 days after its ready notice accrues storage.
table figures:
  owner: principal
  title: text 3..120
  description: text <=2000 ?
  quoteCents: int 0..100000000
  quotedAt: time default now
  approvedAt: time ?
  status: enum('quoted', 'approved', 'in_restoration', 'ready', 'storage_due', 'collected', 'crated_back') default 'quoted'
  stage: enum('stripping', 'carving', 'priming', 'painting', 'finished') ?
  readyAt: time ?
  collectedAt: time ?
  storageCents: int default 0
  immutable owner, quotedAt
  read <- .owner = viewer or exists staff[viewer]
  insert <- exists staff[principal = viewer, role = 'curator'] or exists staff[principal = viewer, role = 'director']
  update <- .owner = viewer or exists staff[viewer]
  delete <- deny
  cap 500 by owner
  online only

-- Condition photos. The curator documents every crack and paint layer.
table photos:
  figure: figures on delete restrict
  kind: enum('crack', 'paint_layer', 'overall')
  photo: image <=5000000
  caption: text <=280 ?
  immutable figure
  read <- exists figures[.figure, owner = viewer] or exists staff[viewer]
  insert <- exists staff[principal = viewer, role = 'curator'] or exists staff[principal = viewer, role = 'director']
  update <- deny
  delete <- deny
  cap 200 by figure
  online only

-- Director-only approval to repaint over original paint, recording the
-- owner's written consent. At most one approval per figure.
table repaints:
  figure: figures on delete restrict
  consent: text 10..2000
  approvedBy: principal
  approvedAt: time default now
  unique figure
  immutable figure, consent, approvedBy
  read <- exists figures[.figure, owner = viewer] or exists staff[viewer]
  insert <- exists staff[principal = viewer, role = 'director']
  update <- deny
  delete <- deny
  online only

query myFigures(c: cursor ?):
  return figures where .owner = viewer first 50 by .id after c

query board(c: cursor ?):
  s = staff[viewer]
  require s != null else NOT_STAFF
  return figures first 50 by .id after c

query figurePhotos(figureId: figures, c: cursor ?):
  f = figures[figureId] ! else NOT_FOUND
  require f.owner = viewer or exists staff[viewer] else NOT_ALLOWED
  return photos where .figure = figureId first 100 by .id after c

query figureRepaint(figureId: figures):
  f = figures[figureId] ! else NOT_FOUND
  require f.owner = viewer or exists staff[viewer] else NOT_ALLOWED
  return repaints[figure = figureId]

mutation intakeFigure(owner: principal, title: text 3..120, description: text <=2000 ?, quoteCents: int 0..100000000):
  s = staff[viewer]
  require s != null and (s.role = 'curator' or s.role = 'director') else NOT_CURATOR
  require exists owners[owner] else UNKNOWN_OWNER
  return insert figures { owner, title, description, quoteCents }

mutation addPhoto(figureId: figures, kind: enum('crack', 'paint_layer', 'overall'), photo: image <=5000000, caption: text <=280 ?):
  s = staff[viewer]
  require s != null and (s.role = 'curator' or s.role = 'director') else NOT_CURATOR
  f = figures[figureId] ! else NOT_FOUND
  require f.status != 'crated_back' and f.status != 'collected' else BAD_STATE
  return insert photos { figure: figureId, kind, photo, caption }

mutation approveQuote(figureId: figures):
  f = figures[figureId] ! else NOT_FOUND
  require f.owner = viewer else NOT_OWNER
  require f.status = 'quoted' else BAD_STATE
  require now <= f.quotedAt + 30d else QUOTE_EXPIRED
  update figures[figureId] { status: 'approved', approvedAt: now }
  return null

mutation advanceStage(figureId: figures, stage: enum('stripping', 'carving', 'priming', 'painting', 'finished')):
  s = staff[viewer]
  require s != null and (s.role = 'carver' or s.role = 'director') else NOT_CARVER
  f = figures[figureId] ! else NOT_FOUND
  require f.status = 'approved' or f.status = 'in_restoration' else BAD_STATE
  update figures[figureId] { stage, status: 'in_restoration' }
  return null

mutation markReady(figureId: figures):
  s = staff[viewer]
  require s != null and (s.role = 'carver' or s.role = 'director') else NOT_CARVER
  f = figures[figureId] ! else NOT_FOUND
  require f.status = 'in_restoration' else BAD_STATE
  update figures[figureId] { status: 'ready', readyAt: now }
  return null

mutation markCollected(figureId: figures):
  s = staff[viewer]
  require s != null and (s.role = 'curator' or s.role = 'director') else NOT_STAFF
  f = figures[figureId] ! else NOT_FOUND
  require f.status = 'ready' or f.status = 'storage_due' else BAD_STATE
  update figures[figureId] { status: 'collected', collectedAt: now }
  return null

mutation approveRepaint(figureId: figures, consent: text 10..2000):
  s = staff[viewer]
  require s != null and s.role = 'director' else NOT_DIRECTOR
  f = figures[figureId] ! else NOT_FOUND
  require f.status != 'collected' and f.status != 'crated_back' else BAD_STATE
  return insert repaints { figure: figureId, consent, approvedBy: viewer }

-- Nightly sweep: crate back figures whose quote was never approved within 30
-- days, and start the storage fee for finished figures uncollected 60 days
-- after their ready notice ($25 per overdue day, in cents).
job dailySweep():
  for f in figures:
    if f.status = 'quoted' and now > f.quotedAt + 30d:
      update figures[f.id] { status: 'crated_back' }
    if (f.status = 'ready' or f.status = 'storage_due') and f.readyAt != null and now > f.readyAt + 60d:
      daysOver = (now - f.readyAt - 60d) / 1d + 1
      update figures[f.id] { status: 'storage_due', storageCents: daysOver * 2500 }

schedule nightly every 1d at 03:00: dailySweep

-- Privacy intent, stated independently from the rules above.
-- Spec: an owner may see only their own figures and quotes; sealing any
-- accidentally broad branch must not change this intent.
invariant figures.read only .owner = viewer or exists staff[viewer]
invariant figures.quoteCents read only .owner = viewer or exists staff[viewer]
invariant figures.insert only exists staff[principal = viewer, role = 'curator'] or exists staff[principal = viewer, role = 'director']
invariant photos.read only exists figures[.figure, owner = viewer] or exists staff[viewer]
invariant repaints.read only exists figures[.figure, owner = viewer] or exists staff[viewer]
invariant repaints.insert only exists staff[principal = viewer, role = 'director']
invariant figures.approveQuote only .owner = viewer
invariant figures.approveRepaint only exists staff[principal = viewer, role = 'director']
