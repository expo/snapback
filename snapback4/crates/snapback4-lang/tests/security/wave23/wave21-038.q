use identity password

-- Role grants are a local operator responsibility; signup alone grants no access.
table roles:
  principal: principal
  role: enum('customer', 'crew', 'marshal', 'operations')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('customer', 'crew', 'marshal', 'operations')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }
query myRole():
  return roles[principal = viewer]
fn isCustomer(): exists roles[principal = viewer, role = 'customer']
fn isCrew(): exists roles[principal = viewer, role = 'crew']
fn isMarshal(): exists roles[principal = viewer, role = 'marshal']
fn isOperations(): exists roles[principal = viewer, role = 'operations']

table rentals:
  customer: principal
  title: text 1..100
  areaSqFt: int 100..20000
  startsAt: time
  endsAt: time
  stage: enum('booked', 'installed', 'active', 'removed') default 'booked'
  installedAt: time ?
  removedAt: time ?
  anchor: image <=5000000 ?
  stake: image <=5000000 ?
  -- Literal defaults classify historical images atomically during adoption.
  anchorGroup: enum('anchor', 'stake', 'unclassified') default 'unclassified'
  stakeGroup: enum('anchor', 'stake', 'unclassified') default 'unclassified'
  anchorBy: principal ?
  stakeBy: principal ?
  inspection: enum('none', 'requested', 'passed', 'failed') default 'none'
  inspectionNote: text 1..500 ?
  inspectedBy: principal ?
  inspectedAt: time ?
  highWind: bool default false
  immutable customer, title, areaSqFt, startsAt, endsAt
  read <- .customer = viewer or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'operations'] or (exists roles[viewer, role = 'marshal'] and .inspection != 'none')
  insert <- .customer = viewer and exists roles[viewer, role = 'customer']
  update <- exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'marshal'] or exists roles[viewer, role = 'operations']
  online only

table installPhotos:
  rental: rentals
  photo: image <=5000000
  group: enum('anchor', 'stake', 'unclassified')
  uploadedBy: principal
  uploadedAt: time default now
  immutable rental, photo, uploadedBy, uploadedAt
  read <- exists rentals[.rental, customer = viewer] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'operations'] or (exists roles[viewer, role = 'marshal'] and (exists rentals[.rental, inspection = 'requested'] or exists rentals[.rental, inspection = 'passed'] or exists rentals[.rental, inspection = 'failed']))
  insert <- exists roles[viewer, role = 'crew']
  update <- exists roles[viewer, role = 'crew']
  online only

table windDecisions:
  rental: rentals
  manager: principal
  reason: text 10..500
  at: time default now
  unique rental
  immutable rental, manager, reason, at
  read <- exists rentals[.rental, customer = viewer] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'operations'] or exists roles[viewer, role = 'marshal']
  insert <- .manager = viewer and exists roles[viewer, role = 'operations']
  online only

shape rentalCard = { *, inspectionRequired: .areaSqFt > 400, extensionFeeCents: 25000 if ((.removedAt != null and .removedAt > .endsAt + 72h) or (.removedAt = null and now > .endsAt + 72h)) else 0, windDecision: windDecisions[rental = .id] }
query board():
  return rentals last 200 by .id rentalCard
query rental(id: rentals):
  r = rentals[id] ! else NOT_FOUND
  return r rentalCard
query photos(id: rentals):
  r = rentals[id] ! else NOT_FOUND
  items = installPhotos where .rental = id first 1000 by .id { key: .id, photo, group, legacy: false }
  return { anchor: r.anchor, stake: r.stake, anchorGroup: r.anchorGroup, stakeGroup: r.stakeGroup, items }
query inspectionQueue():
  require isMarshal() else NOT_MARSHAL
  return rentals where .inspection = 'requested' first 200 by .startsAt rentalCard

mutation createRental(title: text 1..100, areaSqFt: int 100..20000, startsAt: time, endsAt: time):
  require isCustomer() else NOT_CUSTOMER
  require startsAt > now else EVENT_IN_PAST
  require endsAt > startsAt and endsAt <= startsAt + 7d else BAD_EVENT_DURATION
  return insert rentals { customer: viewer, title, areaSqFt, startsAt, endsAt }
mutation install(id: rentals):
  require isCrew() else NOT_CREW
  r = rentals[id] ! else NOT_FOUND
  require r.stage = 'booked' else BAD_STAGE
  require now < r.startsAt else INSTALL_TOO_LATE
  update rentals[id] { stage: 'installed', installedAt: now }
mutation placePhoto(id: rentals, kind: enum('anchor', 'stake'), photo: image <=5000000):
  require isCrew() else NOT_CREW
  r = rentals[id] ! else NOT_FOUND
  require r.stage = 'installed' or r.stage = 'active' else NOT_INSTALLED
  if kind = 'anchor':
    require r.anchor = null else PHOTO_ALREADY_RECORDED
    update rentals[id] { anchor: photo, anchorBy: viewer, anchorGroup: kind }
  else:
    require r.stake = null else PHOTO_ALREADY_RECORDED
    update rentals[id] { stake: photo, stakeBy: viewer, stakeGroup: kind }
mutation requestInspection(id: rentals):
  require isCrew() else NOT_CREW
  r = rentals[id] ! else NOT_FOUND
  require r.stage = 'installed' else NOT_INSTALLED
  require (r.anchor != null or exists installPhotos[rental = id, group = 'anchor']) and (r.stake != null or exists installPhotos[rental = id, group = 'stake']) else PHOTOS_REQUIRED
  require now < r.startsAt else INSPECTION_TOO_LATE
  require r.inspection = 'none' or r.inspection = 'failed' else ALREADY_REQUESTED
  update rentals[id] { inspection: 'requested' }
mutation inspect(id: rentals, passed: bool, note: text 1..500):
  require isMarshal() else NOT_MARSHAL
  r = rentals[id] ! else NOT_FOUND
  require r.stage = 'installed' and r.inspection = 'requested' else NOT_REQUESTED
  require now < r.startsAt else INSPECTION_TOO_LATE
  update rentals[id] { inspection: 'passed' if passed else 'failed', inspectionNote: note, inspectedBy: viewer, inspectedAt: now }
mutation flagHighWind(id: rentals):
  require isCrew() else NOT_CREW
  r = rentals[id] ! else NOT_FOUND
  require r.stage = 'installed' or r.stage = 'active' else NOT_INSTALLED
  require not r.highWind else ALREADY_FLAGGED
  update rentals[id] { highWind: true }
mutation allowHighWind(id: rentals, reason: text 10..500):
  require isOperations() else NOT_OPERATIONS
  r = rentals[id] ! else NOT_FOUND
  require r.highWind and (r.stage = 'installed' or r.stage = 'active') else NO_WIND_HOLD
  require r.inspection = 'passed' else INSPECTION_REQUIRED
  require len(trim(reason)) >= 10 else REASON_REQUIRED
  return insert windDecisions { rental: id, manager: viewer, reason }
mutation startEvent(id: rentals):
  require isCrew() else NOT_CREW
  r = rentals[id] ! else NOT_FOUND
  require r.stage = 'installed' else NOT_INSTALLED
  require now >= r.startsAt and now < r.endsAt else OUTSIDE_EVENT_WINDOW
  require (r.anchor != null or exists installPhotos[rental = id, group = 'anchor']) and (r.stake != null or exists installPhotos[rental = id, group = 'stake']) else PHOTOS_REQUIRED
  require r.areaSqFt <= 400 or r.inspection = 'passed' else INSPECTION_REQUIRED
  require not r.highWind or exists windDecisions[rental = id] else WIND_HOLD
  update rentals[id] { stage: 'active' }
mutation takeDown(id: rentals):
  require isCrew() else NOT_CREW
  r = rentals[id] ! else NOT_FOUND
  require r.stage = 'installed' or r.stage = 'active' else NOT_INSTALLED
  update rentals[id] { stage: 'removed', removedAt: now }

-- V2 uploads always require an explicit group; old placePhoto remains a compatibility wrapper.
mutation uploadInstallPhoto(id: rentals, group: enum('anchor', 'stake', 'unclassified'), photo: image <=5000000):
  require isCrew() else NOT_CREW
  r = rentals[id] ! else NOT_FOUND
  require r.stage = 'installed' or r.stage = 'active' else NOT_INSTALLED
  return insert installPhotos { rental: id, photo, group, uploadedBy: viewer }
mutation movePhoto(photo: installPhotos, group: enum('anchor', 'stake', 'unclassified')):
  require isCrew() else NOT_CREW
  p = installPhotos[photo] ! else NOT_FOUND
  update p { group }
mutation moveLegacyPhoto(id: rentals, slot: enum('anchor', 'stake'), group: enum('anchor', 'stake', 'unclassified')):
  require isCrew() else NOT_CREW
  r = rentals[id] ! else NOT_FOUND
  if slot = 'anchor':
    require r.anchor != null else PHOTO_NOT_FOUND
    update r { anchorGroup: group }
  else:
    require r.stake != null else PHOTO_NOT_FOUND
    update r { stakeGroup: group }

query photoPage(id: rentals, c: cursor ?):
  r = rentals[id] ! else NOT_FOUND
  return installPhotos where .rental = id first 100 by .id after c { key: .id, photo, group, legacy: false }
