-- Tow Yard Release.
--
-- A city tow yard logs every towed vehicle with photos at intake; storage
-- fees accrue daily. An owner claims a vehicle by uploading proof of
-- ownership, which yard staff (clerks) verify. A vehicle with no verified
-- claim 30 days after the tow moves to the auction list automatically.
-- Owners see only their own vehicles; clerks and the yard manager see every
-- vehicle; the police liaison sees only vehicles under an investigative
-- hold, which blocks release until it is lifted. Only the yard manager
-- waives fees.
--
-- Roles live in `roster`. Anyone with a password account registers once as
-- an owner (self-service); the yard manager promotes staff with grantRole.
-- The first manager is enrolled through the service:ops seat (no public
-- first-user race). All tables are online only: the yard office works
-- online, so the browser client uses the write journal, not a device.

use identity password

table roster:
  principal: principal
  handle: text 3..20 format handle
  role: enum('owner', 'clerk', 'liaison', 'manager')
  unique principal
  unique handle
  immutable principal, handle
  read <- .principal = viewer or exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] or viewer = 'service:ops'
  insert <- (.principal = viewer and .role = 'owner') or exists roster[principal = viewer, role = 'manager'] or viewer = 'service:ops'
  update <- exists roster[principal = viewer, role = 'manager'] or viewer = 'service:ops'
  delete <- deny
  online only

table vehicles:
  plate: text 1..12
  make: text 1..40
  model: text 1..40
  color: text 1..30
  vin: text 11..17 ?
  towedFrom: text 1..200
  towedAt: time
  photos: [image <=10000000] 1..4
  owner: principal ?
  dailyRate: int 1..100000 default 3500
  waived: int 0.. default 0
  status: enum('impounded', 'released', 'auction') default 'impounded'
  releasedAt: time ?
  onHold: bool default false
  holdReason: text 1..200 ?
  holdBy: principal ?
  holdAt: time ?
  immutable plate, make, model, color, vin, towedFrom, towedAt, owner, dailyRate
  read <- (.owner = viewer and exists roster[principal = viewer, role = 'owner']) or exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] or (.onHold and exists roster[principal = viewer, role = 'liaison'])
  insert <- exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager']
  update <- exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] or exists roster[principal = viewer, role = 'liaison']
  delete <- deny
  online only

table claims:
  vehicle: vehicles
  claimant: principal
  proof: image <=10000000
  status: enum('pending', 'verified', 'rejected') default 'pending'
  decidedBy: principal ?
  decidedAt: time ?
  at: time default now
  immutable vehicle, claimant, proof, at
  read <- (.claimant = viewer and exists roster[principal = viewer, role = 'owner']) or exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager']
  insert <- .claimant = viewer and exists roster[principal = viewer, role = 'owner']
  update <- exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager']
  delete <- deny
  online only

table waivers:
  vehicle: vehicles
  amount: int 1..
  reason: text 1..200
  waivedBy: principal
  at: time default now
  immutable vehicle, amount, reason, waivedBy, at
  read <- (exists vehicles[.vehicle, owner = viewer] and exists roster[principal = viewer, role = 'owner']) or exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager']
  insert <- exists roster[principal = viewer, role = 'manager']
  update <- deny
  delete <- deny
  online only

query myRole():
  return roster[principal = viewer]

query directory(c: cursor ?):
  require exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] else NOT_STAFF 'Only yard staff list accounts.'
  return roster last 50 by .id after c

query myVehicles(c: cursor ?):
  require exists roster[principal = viewer, role = 'owner'] else NOT_OWNER
  return vehicles where .owner = viewer last 50 by .towedAt after c

query yardVehicles(c: cursor ?):
  require exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] else NOT_STAFF 'Only yard staff see every vehicle.'
  return vehicles last 50 by .towedAt after c

query holdVehicles(c: cursor ?):
  require exists roster[principal = viewer, role = 'liaison'] else NOT_LIAISON 'Only the police liaison lists held vehicles.'
  return vehicles where .onHold last 50 by .towedAt after c

query auctionList(c: cursor ?):
  require exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] else NOT_STAFF 'Only yard staff see the auction list.'
  return vehicles where .status = 'auction' last 50 by .towedAt after c

query vehicleDetail(vehicle: vehicles):
  v = vehicles[vehicle] ! else NOT_FOUND
  return v

query myClaims(c: cursor ?):
  return claims where .claimant = viewer last 50 by .at after c

query claimsFor(vehicle: vehicles, c: cursor ?):
  require exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] else NOT_STAFF 'Only yard staff review claims.'
  v = vehicles[vehicle] ! else NOT_FOUND
  return claims where .vehicle = vehicle last 50 by .at after c

query waiversOf(vehicle: vehicles, c: cursor ?):
  v = vehicles[vehicle] ! else NOT_FOUND
  return waivers where .vehicle = vehicle last 50 by .at after c

mutation register(handle: text 3..20 format handle):
  require not exists roster[principal = viewer] else ALREADY_REGISTERED 'This account already has a yard profile.'
  return insert roster { principal: viewer, handle, role: 'owner' }

mutation grantRole(who: principal, role: enum('owner', 'clerk', 'liaison', 'manager')):
  require exists roster[principal = viewer, role = 'manager'] or viewer = 'service:ops' else NOT_MANAGER 'Only the yard manager assigns roles.'
  require exists roster[principal = who] else NOT_FOUND
  update roster[principal = who] { role }
  return null

mutation intake(plate: text 1..12, make: text 1..40, model: text 1..40, color: text 1..30, vin: text 11..17 ?, towedFrom: text 1..200, towedAt: time ?, dailyRate: int 1..100000 ?, photos: [image <=10000000] 1..4, ownerHandle: text 3..20 format handle):
  require exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] else NOT_STAFF 'Only yard staff log towed vehicles.'
  o = roster[handle = ownerHandle] ! else UNKNOWN_OWNER 'No yard account uses that handle.'
  require o.role = 'owner' else NOT_OWNER_ACCOUNT
  at = towedAt ?? now
  require at <= now else BAD_TOW_TIME 'The tow time cannot be in the future.'
  return insert vehicles { plate, make, model, color, vin, towedFrom, towedAt: at, dailyRate: dailyRate ?? 3500, photos, owner: o.principal }

mutation fileClaim(vehicle: vehicles, proof: image <=10000000):
  require exists roster[principal = viewer, role = 'owner'] else NOT_OWNER_ACCOUNT
  v = vehicles[vehicle] ! else NOT_FOUND
  require v.owner = viewer else NOT_OWNER 'Only the recorded owner can claim this vehicle.'
  require v.status = 'impounded' else BAD_STATUS 'This vehicle is no longer in the impound.'
  require now < v.towedAt + 30d else AUCTION_DUE 'A first claim must arrive before the auction deadline.'
  require not exists claims where .vehicle = vehicle and .claimant = viewer and .status = 'pending' else DUPLICATE_CLAIM 'A claim for this vehicle is already pending review.'
  return insert claims { vehicle, claimant: viewer, proof }

mutation decideClaim(claim: claims, approve: bool):
  require exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] else NOT_STAFF 'Only yard staff decide claims.'
  c = claims[claim] ! else NOT_FOUND
  require c.status = 'pending' else ALREADY_DECIDED 'This claim was already decided.'
  v = vehicles[c.vehicle] ! else NOT_FOUND
  require not approve or now < v.towedAt + 30d else AUCTION_DUE 'Verification must precede the auction deadline.'
  update claims[c.id] { status: 'verified' if approve else 'rejected', decidedBy: viewer, decidedAt: now }
  return null

mutation placeHold(vehicle: vehicles, reason: text 1..200):
  require exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] else NOT_STAFF 'Only yard staff place holds.'
  v = vehicles[vehicle] ! else NOT_FOUND
  require not v.onHold else ALREADY_ON_HOLD 'This vehicle is already under a hold.'
  update vehicles[v.id] { onHold: true, holdReason: reason, holdBy: viewer, holdAt: now }
  return null

mutation liftHold(vehicle: vehicles):
  require exists roster[principal = viewer, role = 'liaison'] else NOT_LIAISON 'Only the police liaison lifts an investigative hold.'
  v = vehicles[vehicle] ! else NOT_FOUND
  require v.onHold else NO_HOLD 'This vehicle is not under a hold.'
  update vehicles[v.id] { onHold: false }
  return null

mutation waiveFees(vehicle: vehicles, amount: int 1.., reason: text 1..200):
  require exists roster[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the yard manager waives fees.'
  v = vehicles[vehicle] ! else NOT_FOUND
  accrued = (now - v.towedAt) / 1d * v.dailyRate
  require v.waived + amount <= accrued else OVER_WAIVER 'A waiver cannot exceed the fees accrued so far.'
  update vehicles[v.id] { waived: v.waived + amount }
  return insert waivers { vehicle, amount, reason, waivedBy: viewer }

mutation releaseVehicle(vehicle: vehicles):
  require exists roster[principal = viewer, role = 'clerk'] or exists roster[principal = viewer, role = 'manager'] else NOT_STAFF 'Only yard staff release vehicles.'
  v = vehicles[vehicle] ! else NOT_FOUND
  require v.status = 'impounded' else BAD_STATUS 'Only impounded vehicles can be released.'
  require not v.onHold else ON_HOLD 'Release is blocked by an investigative hold.'
  require exists claims where .vehicle = vehicle and .status = 'verified' else NO_VERIFIED_CLAIM 'Release needs a verified ownership claim.'
  update vehicles[v.id] { status: 'released', releasedAt: now }
  return null

job auctionSweep():
  for v in vehicles:
    if v.status = 'impounded' and v.towedAt < now - 30d and not exists claims where .vehicle = v.id and .status = 'verified':
      update vehicles[v.id] { status: 'auction' }

schedule auctionDaily every 1d at 03:00: auctionSweep
