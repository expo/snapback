use identity password
use personas f1, f2, h1, h2, i1, i2, o1, o2

table members:
  principal: principal
  role: enum('farmer', 'hauler', 'intake', 'officer')
  unique principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  online only

table farms:
  owner: principal
  name: text 1..80
  lastPickupAt: time ?
  stale: bool default false
  unique owner
  immutable owner, name
  read <- .owner = viewer or exists members[principal = viewer, role = 'hauler'] or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer']
  insert <- .owner = viewer and exists members[principal = viewer, role = 'farmer']
  update (old, next) <- exists members[principal = viewer, role = 'hauler'] and old.owner = next.owner and old.name = next.name
  online only

table tankers:
  hauler: principal
  status: enum('enroute', 'arrived', 'tested') default 'enroute'
  result: enum('pending', 'negative', 'positive') default 'pending'
  createdAt: time default now
  arrivedAt: time ?
  immutable hauler
  read <- .hauler = viewer or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer']
  insert <- .hauler = viewer and exists members[principal = viewer, role = 'hauler']
  update <- .hauler = viewer or exists members[principal = viewer, role = 'intake']
  online only

table pickups:
  farm: farms
  farmer: principal
  hauler: principal
  tanker: tankers
  size: enum('under1000', 'atLeast1000') read <- .farmer = viewer or .hauler = viewer or exists members[principal = viewer, role = 'officer']
  volume: int 1..10000
  temp: decimal 1
  sampleCode: text 4..20
  photo: image <=10000000
  payCents: int 0..
  at: time default now
  unique sampleCode else DUP_SAMPLE 'This sample code was already used.'
  cap 200 by tanker
  immutable farm, farmer, hauler, tanker, temp, sampleCode, photo, at
  read <- .farmer = viewer or .hauler = viewer or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer']
  insert <- .hauler = viewer and exists members[principal = viewer, role = 'hauler']
  update (old, next) <- old.hauler = viewer and exists members[principal = viewer, role = 'hauler'] and old.farm = next.farm and old.farmer = next.farmer and old.hauler = next.hauler and old.tanker = next.tanker and old.temp = next.temp and old.sampleCode = next.sampleCode and old.at = next.at
  online only

table farmResults:
  tanker: tankers
  farmer: principal
  result: enum('negative', 'positive')
  at: time default now
  unique tanker, farmer
  immutable tanker, farmer, result, at
  read <- .farmer = viewer or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer']
  insert <- exists members[principal = viewer, role = 'intake']
  online only

table docks:
  pickup: pickups
  farmer: principal
  amount: int 1..
  reason: text 1..280
  officer: principal
  at: time default now
  immutable pickup, farmer, amount, reason, officer, at
  read <- .farmer = viewer or exists members[principal = viewer, role = 'officer']
  insert <- exists members[principal = viewer, role = 'officer']
  online only

invariant members.read only .principal = viewer
invariant farms.read only .owner = viewer or exists members[principal = viewer, role = 'hauler'] or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer']
invariant pickups.read only .farmer = viewer or .hauler = viewer or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer']
invariant tankers.read only .hauler = viewer or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer']
invariant farmResults.read only .farmer = viewer or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer']
invariant docks.read only .farmer = viewer or exists members[principal = viewer, role = 'officer']

query whoAmI():
  return viewer

query myMembership():
  return members[viewer]

query myFarm():
  return farms[owner = viewer]

query myPickups(c: cursor ?):
  return pickups where .farmer = viewer last 50 by .at after c

query pickupSize(pickup: pickups):
  p = pickups[pickup] ! else NOT_FOUND
  require p.farmer = viewer or p.hauler = viewer or exists members[principal = viewer, role = 'officer'] else NOT_SIZE_READER 'Only the farmer, the collecting hauler and the field officer see the size label.'
  return p { id, size }

query myResults(c: cursor ?):
  return farmResults where .farmer = viewer last 50 by .at after c

query myDocks(c: cursor ?):
  return docks where .farmer = viewer last 50 by .at after c

query myTankers(c: cursor ?):
  return tankers where .hauler = viewer last 50 by .createdAt after c

query route(tanker: tankers, c: cursor ?):
  t = tankers[tanker] ! else NOT_FOUND
  require t.hauler = viewer or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer'] else NOT_YOUR_ROUTE 'This tanker is not on your route.'
  return pickups where .tanker = tanker first 200 by .id after c

query arrivals(c: cursor ?):
  require exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer'] else NOT_INTAKE 'Only plant intake (or the field officer) sees live arrivals.'
  return tankers last 50 by .createdAt after c

query farmsOnLoad(tanker: tankers, c: cursor ?):
  require exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer'] else NOT_INTAKE 'Only plant intake (or the field officer) traces a load.'
  t = tankers[tanker] ! else NOT_FOUND
  return pickups where .tanker = tanker first 200 by .id after c

query loadResults(tanker: tankers, c: cursor ?):
  require exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer'] else NOT_INTAKE 'Only plant intake (or the field officer) reads load results.'
  t = tankers[tanker] ! else NOT_FOUND
  return farmResults where .tanker = tanker first 200 by .id after c

query allFarms(c: cursor ?):
  require exists members[principal = viewer, role = 'hauler'] or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer'] else NOT_STAFF 'Only haulers, intake and the field officer list farms.'
  return farms first 100 by .id after c

query staleTanks(c: cursor ?):
  require exists members[principal = viewer, role = 'hauler'] or exists members[principal = viewer, role = 'intake'] or exists members[principal = viewer, role = 'officer'] else NOT_STAFF 'Only haulers, intake and the field officer see stale-tank flags.'
  return farms where .stale first 100 by .id after c

mutation register(role: enum('farmer', 'hauler', 'intake', 'officer'), farmName: text 1..80 ?):
  require not exists members[viewer] else ALREADY_REGISTERED 'This account already has a role.'
  m = insert members { principal: viewer, role }
  if role = 'farmer':
    require farmName != null else NEED_FARM_NAME 'Farmers register with a farm name.'
    insert farms { owner: viewer, name: farmName ?? 'Unnamed farm' }
  return m

mutation startTanker():
  require exists members[principal = viewer, role = 'hauler'] else NOT_HAULER 'Only haulers start tanker loads.'
  return insert tankers { hauler: viewer }

mutation recordPickup(tanker: tankers, farm: farms, volume: int 1..10000, temp: decimal 1, sampleCode: text 4..20, photo: image <=10000000):
  require exists members[principal = viewer, role = 'hauler'] else NOT_HAULER 'Only haulers record pickups.'
  t = tankers[tanker] ! else NOT_FOUND
  require t.hauler = viewer else NOT_YOUR_TANKER 'This tanker is not yours.'
  require t.status = 'enroute' else TANKER_CLOSED 'This tanker is closed for pickups.'
  f = farms[farm] ! else NOT_FOUND
  require temp >= 0 and temp <= 40 else BAD_TEMP 'Milk temperature must be 0-40 C.'
  p = insert pickups { farm, farmer: f.owner, hauler: viewer, tanker, volume, temp, sampleCode, photo, payCents: volume * 40, size: 'atLeast1000' if volume >= 1000 else 'under1000' }
  update farms[farm] { lastPickupAt: now, stale: false }
  return p

mutation correctPickupVolume(pickup: pickups, volume: int 1..10000):
  require exists members[principal = viewer, role = 'hauler'] else NOT_HAULER 'Only haulers correct pickup volumes.'
  p = pickups[pickup] ! else NOT_FOUND
  require p.hauler = viewer else NOT_YOUR_PICKUP 'Only the collecting hauler corrects this pickup.'
  update pickups[pickup] { volume, payCents: volume * 40, size: 'atLeast1000' if volume >= 1000 else 'under1000' }
  return pickups[pickup]

mutation arriveTanker(tanker: tankers):
  require exists members[principal = viewer, role = 'hauler'] else NOT_HAULER 'Only haulers mark arrivals.'
  t = tankers[tanker] ! else NOT_FOUND
  require t.hauler = viewer else NOT_YOUR_TANKER 'This tanker is not yours.'
  require t.status = 'enroute' else BAD_STATUS 'Only an enroute tanker can arrive.'
  update tankers[tanker] { status: 'arrived', arrivedAt: now }
  return null

mutation testTanker(tanker: tankers, result: enum('negative', 'positive')): server
  require exists members[principal = viewer, role = 'intake'] else NOT_INTAKE 'Only plant intake tests tanker loads.'
  t = tankers[tanker] ! else NOT_FOUND
  require t.status = 'arrived' else NOT_ARRIVED 'Only an arrived tanker can be tested.'
  update tankers[tanker] { status: 'tested', result }
  page = pickups where .tanker = tanker first 200 by .id
  for p in page:
    insert farmResults { tanker, farmer: p.farmer, result } if absent
  return null

mutation dockPickup(pickup: pickups, amount: int 1.., reason: text 1..280):
  require exists members[principal = viewer, role = 'officer'] else NOT_OFFICER 'Only the field officer docks payment.'
  p = pickups[pickup] ! else NOT_FOUND
  require amount <= p.payCents else BAD_AMOUNT 'A dock cannot exceed the pickup pay.'
  return insert docks { pickup, farmer: p.farmer, amount, reason, officer: viewer }

job flagStale(periodStart: time, periodEnd: time):
  for f in farms where .lastPickupAt < periodEnd - 72h by .id:
    if not f.stale:
      update farms[f.id] { stale: true }

schedule staleSweep every 1h: flagStale

backfill pickups sizeV2(volume: int): {size: 'atLeast1000' if volume >= 1000 else 'under1000'}
invariant pickups.size read only .farmer = viewer or .hauler = viewer or exists members[principal = viewer, role = 'officer']
