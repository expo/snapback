use identity password

table roles:
  principal: principal
  role: enum('manager', 'breeder', 'keeper', 'buyer')
  label: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('manager', 'breeder', 'keeper', 'buyer'), label: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, label }
query myRole():
  return roles[principal = viewer]
query buyers(c: cursor ?):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] else NOT_MANAGEMENT
  return roles where .role = 'buyer' last 100 by .id after c

table clutches:
  name: text 1..80
  species: text 1..80
  plannedHatch: time
  creator: principal
  immutable creator
  read <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper']
  insert <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder']
  online only
query clutches(c: cursor ?):
  require exists roles[viewer] else NOT_ENROLLED
  return clutches last 100 by .id after c
mutation planClutch(name: text 1..80, species: text 1..80, plannedHatch: time):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] else NOT_MANAGEMENT
  require plannedHatch >= now else HATCH_IN_PAST
  require plannedHatch <= now + 365d else HATCH_TOO_FAR
  return insert clutches { name, species, plannedHatch, creator: viewer }

table reservations:
  clutch: clutches
  buyer: principal
  chick: text 1..80
  stage: enum('planned', 'hatched', 'weaned', 'ready', 'collected') default 'planned'
  readyAt: time ?
  collectedAt: time ?
  openedAt: time default now
  immutable clutch, buyer, chick, openedAt
  read <- .buyer = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper']
  insert <- exists roles[viewer, role = 'manager'] and exists roles[principal = .buyer, role = 'buyer']
  update <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper']
  online only

table confidential:
  reservation: reservations
  phone: text 7..30
  address: text 5..300
  priceCents: int 100..10000000
  depositCents: int 1..10000000
  contract: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')
  boardingDailyCents: int 100..100000
  boardingCents: int 0.. default 0
  returnedAt: time ?
  returnReason: text 5..500 ?
  approvedBy: principal ?
  unique reservation
  immutable reservation, phone, address, priceCents, depositCents, contract, boardingDailyCents
  read <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder']
  insert <- exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder']
  online only

query board(c: cursor ?):
  require exists roles[viewer] else NOT_ENROLLED
  if exists roles[viewer, role = 'buyer']:
    return reservations where .buyer = viewer last 100 by .id after c
  return reservations last 100 by .id after c
query reservation(reservation: reservations):
  require exists roles[viewer] else NOT_ENROLLED
  return reservations[reservation]
query privateDetails(reservation: reservations):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] else NOT_MANAGEMENT
  r = reservations[reservation] ! else NOT_FOUND
  f = confidential[reservation = reservation] ! else NOT_FOUND
  total = f.boardingCents
  if r.stage = 'ready' and r.readyAt != null and now > r.readyAt + 14d:
    days = (now - r.readyAt - 14d + 1d - 1) / 1d
    total = days * f.boardingDailyCents
  return { id: f.id, phone: f.phone, address: f.address, priceCents: f.priceCents, depositCents: f.depositCents, contract: f.contract, boardingDailyCents: f.boardingDailyCents, boardingCents: total, returnedAt: f.returnedAt, returnReason: f.returnReason, approvedBy: f.approvedBy }

mutation openReservation(clutch: clutches, buyer: principal, chick: text 1..80, phone: text 7..30, address: text 5..300, priceCents: int 100..10000000, depositCents: int 1..10000000, boardingDailyCents: int 100..100000, contract: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  require exists roles[principal = buyer, role = 'buyer'] else NOT_BUYER
  require depositCents <= priceCents else DEPOSIT_EXCEEDS_PRICE
  require exists clutches[clutch] else NOT_FOUND
  r = insert reservations { clutch, buyer, chick }
  insert confidential { reservation: r.id, phone, address, priceCents, depositCents, boardingDailyCents, contract }
  return r

mutation advanceStage(reservation: reservations, stage: enum('hatched', 'weaned', 'ready')):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper'] else NOT_STAFF
  r = reservations[reservation] ! else NOT_FOUND
  require (r.stage = 'planned' and stage = 'hatched') or (r.stage = 'hatched' and stage = 'weaned') or (r.stage = 'weaned' and stage = 'ready') else BAD_TRANSITION
  if stage = 'ready':
    update reservations[reservation] { stage, readyAt: now }
  else:
    update reservations[reservation] { stage }

mutation collect(reservation: reservations):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  r = reservations[reservation] ! else NOT_FOUND
  require r.stage = 'ready' else NOT_READY
  require r.readyAt != null else NOT_READY
  f = confidential[reservation = reservation] ! else NOT_FOUND
  if now > r.readyAt + 14d:
    days = (now - r.readyAt - 14d + 1d - 1) / 1d
    update confidential[f.id] { boardingCents: days * f.boardingDailyCents }
  update reservations[reservation] { stage: 'collected', collectedAt: now }

mutation returnDeposit(reservation: reservations, reason: text 5..500):
  require exists roles[viewer, role = 'breeder'] else NOT_BREEDER
  f = confidential[reservation = reservation] ! else NOT_FOUND
  require f.returnedAt = null else ALREADY_RETURNED
  update confidential[f.id] { returnedAt: now, returnReason: reason, approvedBy: viewer }

table care:
  reservation: reservations
  buyer: principal
  grams: int 1..3000
  feeding: text 1..500
  keeper: principal
  at: time default now
  immutable reservation, buyer, grams, feeding, keeper, at
  read <- .buyer = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper']
  insert <- exists reservations[.reservation, buyer = .buyer] and (exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper'])
  online only
query careHistory(reservation: reservations, c: cursor ?):
  require exists reservations[reservation] else NOT_FOUND
  return care where .reservation = reservation last 100 by .id after c
mutation recordCare(reservation: reservations, grams: int 1..3000, feeding: text 1..500):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper'] else NOT_STAFF
  r = reservations[reservation] ! else NOT_FOUND
  require r.stage != 'planned' and r.stage != 'collected' else NOT_IN_CARE
  return insert care { reservation, buyer: r.buyer, grams, feeding, keeper: viewer }

table photos:
  reservation: reservations
  buyer: principal
  photo: image <=5000000
  caption: text 1..120
  keeper: principal
  at: time default now
  immutable reservation, buyer, photo, caption, keeper, at
  read <- .buyer = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper']
  insert <- exists reservations[.reservation, buyer = .buyer] and (exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper'])
  online only
query chickPhotos(reservation: reservations, c: cursor ?):
  require exists reservations[reservation] else NOT_FOUND
  return photos where .reservation = reservation last 100 by .id after c
mutation addPhoto(reservation: reservations, photo: image <=5000000, caption: text 1..120):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper'] else NOT_STAFF
  r = reservations[reservation] ! else NOT_FOUND
  return insert photos { reservation, buyer: r.buyer, photo, caption, keeper: viewer }

job chargeBoarding(periodStart: time, periodEnd: time):
  for r in reservations:
    if r.stage = 'ready' and r.readyAt != null and now > r.readyAt + 14d:
      f = confidential[reservation = r.id] ! else NOT_FOUND
      days = (now - r.readyAt - 14d + 1d - 1) / 1d
      update confidential[f.id] { boardingCents: days * f.boardingDailyCents }
schedule boardingHourly every 1h: chargeBoarding

invariant confidential.read only exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder']
invariant confidential.phone read only exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder']
invariant confidential.address read only exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder']
invariant confidential.priceCents read only exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder']
invariant reservations.read only .buyer = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'breeder'] or exists roles[viewer, role = 'keeper']
