-- Painting Conservation Treatments.
-- Roles: registrar, conservator, director (staff roster) and owner (ownership rows).
-- Registrar opens each treatment with a scan of the signed condition report and
-- the quoted fee. Conservators see condition photos, UV images and notes, but
-- not the owner's name, insured value, fee or report scan, which only the
-- registrar and the studio director (plus the painting's own owner) see.
-- Owners see only their own paintings and treatments. Paintings move
-- examined -> cleaned -> varnished -> completed; 30 days after completion a
-- scheduled job crates them. Only the director approves inpainting a large
-- loss, with the reason recorded.
use identity password

table staff:
  principal: principal
  role: enum('registrar', 'conservator', 'director')
  unique principal, role
  read <- .principal = viewer or exists staff[principal = viewer, role = 'director']
  insert <- viewer = 'service:ops'
  update <- viewer = 'service:ops'
  delete <- viewer = 'service:ops'
  online only

table owners:
  principal: principal
  displayName: text 1..80
  unique principal
  read <- .principal = viewer or exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director']
  insert <- .principal = viewer
  update <- .principal = viewer
  online only

table paintings:
  title: text 1..120
  artist: text 1..120 ?
  status: enum('examined', 'cleaned', 'varnished', 'completed', 'crated') default 'examined'
  completedAt: time ?
  createdAt: time default now
  immutable createdAt
  read <- exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director'] or exists ownerships[painting = .id, owner = viewer]
  insert <- exists staff[principal = viewer, role = 'registrar']
  update <- exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director']
  cap 1000
  online only

table ownerships:
  painting: paintings
  owner: principal
  unique painting
  immutable painting, owner
  read <- .owner = viewer or exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director']
  insert <- exists staff[principal = viewer, role = 'registrar']
  online only

table treatments:
  painting: paintings
  ownerName: text 1..120
  insuredValue: money USD
  fee: money USD
  reportScan: image <=10000000
  conditionPhotos: [image <=10000000] <=8 ?
  uvImages: [image <=10000000] <=8 ?
  coverage: enum('ultraviolet available', 'condition photos only', 'no images yet')
  notes: text <=2000 ?
  lossSize: enum('none', 'small', 'large') default 'none'
  inpaintApproved: bool default false
  approvalReason: text <=500 ?
  createdAt: time default now
  immutable painting, createdAt
  read (ownerName, insuredValue, fee, reportScan) <- exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director'] or exists ownerships[.painting, owner = viewer]
  read (coverage) <- exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director']
  read <- exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director'] or exists ownerships[painting = .painting, owner = viewer]
  insert <- exists staff[principal = viewer, role = 'registrar']
  update <- exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director']
  cap 50 by painting
  online only

view paintingsByStatus: count paintings by .status
  read <- exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director']
  online only

job crateStale(periodStart: time, periodEnd: time):
  for p in paintings:
    if p.status = 'completed' and p.completedAt != null and p.completedAt + 30d <= periodEnd:
      update paintings[p.id] { status: 'crated' }

schedule crateDaily every 1d at 03:00: crateStale

mutation provision(principal: principal, role: enum('registrar', 'conservator', 'director')):
  require viewer = 'service:ops' else NOT_OPERATOR
  return upsert staff[principal = principal, role = role] { principal, role }

mutation joinAsOwner(displayName: text 1..80):
  return upsert owners[principal = viewer] { principal: viewer, displayName }

mutation intakePainting(title: text 1..120, artist: text 1..120 ?, owner: principal, ownerName: text 1..120, insuredValue: money USD, fee: money USD, reportScan: image <=10000000, conditionPhotos: [image <=10000000] <=8 ?, uvImages: [image <=10000000] <=8 ?, notes: text <=2000 ?, lossSize: enum('none', 'small', 'large') ?):
  require exists staff[principal = viewer, role = 'registrar'] else NOT_REGISTRAR
  p = insert paintings { title, artist }
  insert ownerships { painting: p.id, owner }
  return insert treatments { painting: p.id, ownerName, insuredValue, fee, reportScan, conditionPhotos, uvImages, notes, lossSize: lossSize ?? 'none', coverage: 'ultraviolet available' if len(uvImages ?? []) > 0 else 'condition photos only' if len(conditionPhotos ?? []) > 0 else 'no images yet' }

mutation recordCondition(treatment: treatments, notes: text <=2000 ?, conditionPhotos: [image <=10000000] <=8 ?, uvImages: [image <=10000000] <=8 ?, lossSize: enum('none', 'small', 'large') ?):
  require exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director'] else NOT_STAFF
  t = treatments[treatment] ! else NOT_FOUND
  newUv = uvImages ?? t.uvImages
  newCond = conditionPhotos ?? t.conditionPhotos
  update treatments[t.id] { notes: notes ?? t.notes, conditionPhotos: newCond, uvImages: newUv, lossSize: lossSize ?? t.lossSize, coverage: 'ultraviolet available' if len(newUv ?? []) > 0 else 'condition photos only' if len(newCond ?? []) > 0 else 'no images yet' }
  return null

mutation advanceStatus(painting: paintings, status: enum('cleaned', 'varnished', 'completed')):
  require exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director'] else NOT_STAFF
  p = paintings[painting] ! else NOT_FOUND
  require (p.status = 'examined' and status = 'cleaned') or (p.status = 'cleaned' and status = 'varnished') or (p.status = 'varnished' and status = 'completed') else BAD_TRANSITION
  if status = 'completed':
    update paintings[p.id] { status, completedAt: now }
  else:
    update paintings[p.id] { status }
  return null

mutation approveInpainting(treatment: treatments, reason: text 1..200):
  require exists staff[principal = viewer, role = 'director'] else NOT_DIRECTOR
  t = treatments[treatment] ! else NOT_FOUND
  require t.lossSize = 'large' else NO_LARGE_LOSS
  require not t.inpaintApproved else ALREADY_DECIDED
  update treatments[t.id] { inpaintApproved: true, approvalReason: reason }
  return null

query board(c: cursor ?):
  require exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director'] else NOT_STAFF
  return paintings last 50 by .id after c

query statusCount(status: enum('examined', 'cleaned', 'varnished', 'completed', 'crated')):
  return { count: paintingsByStatus[status] }

query myHoldings(c: cursor ?):
  return ownerships where .owner = viewer first 50 by .id after c

query painting(painting: paintings):
  return paintings[painting]

query treatmentsFor(painting: paintings, c: cursor ?):
  p = paintings[painting] ! else NOT_FOUND
  return treatments where .painting = p.id first 50 by .id after c

query treatment(treatment: treatments):
  return treatments[treatment]

query myStaffRole(c: cursor ?):
  return staff where .principal = viewer first 10 by .id after c

query ownerDirectory(c: cursor ?):
  require exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director'] else NOT_STAFF
  return owners first 50 by .id after c

-- Spec intent, stated independently from the enforcement rules above.
invariant staff.read only .principal = viewer or exists staff[principal = viewer, role = 'director']
invariant owners.read only .principal = viewer or exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director']
invariant ownerships.read only .owner = viewer or exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director']
invariant paintings.read only exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director'] or exists ownerships[painting = .id, owner = viewer]
invariant paintingsByStatus.read only exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director']
invariant treatments.read only exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director'] or exists ownerships[painting = .painting, owner = viewer]
invariant treatments.ownerName read only exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director'] or exists ownerships[.painting, owner = viewer]
invariant treatments.insuredValue read only exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director'] or exists ownerships[.painting, owner = viewer]
invariant treatments.fee read only exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director'] or exists ownerships[.painting, owner = viewer]
invariant treatments.reportScan read only exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'director'] or exists ownerships[.painting, owner = viewer]
invariant treatments.fee write only exists staff[principal = viewer, role = 'registrar']
invariant treatments.insuredValue write only exists staff[principal = viewer, role = 'registrar']
invariant treatments.ownerName write only exists staff[principal = viewer, role = 'registrar']
invariant treatments.reportScan write only exists staff[principal = viewer, role = 'registrar']
invariant treatments.approvalReason write only exists staff[principal = viewer, role = 'director']
invariant treatments.inpaintApproved write only exists staff[principal = viewer, role = 'director']
invariant treatments.coverage read only exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director']
invariant treatments.coverage write only exists staff[principal = viewer, role = 'registrar'] or exists staff[principal = viewer, role = 'conservator'] or exists staff[principal = viewer, role = 'director']
backfill treatments coverageFill(uvImages: [image <=10000000] <=8 ?, conditionPhotos: [image <=10000000] <=8 ?):
  {coverage: 'ultraviolet available' if len(uvImages ?? []) > 0 else 'condition photos only' if len(conditionPhotos ?? []) > 0 else 'no images yet'}
