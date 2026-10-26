-- Livestock Ultrasound Scans.
-- Roles: manager (office manager), farmer, scanner, lead (lead scanner).
-- A mobile scanning service checks ewes and cows for pregnancy. The manager
-- opens each visit with a photo of the herd's previous scan sheet plus the
-- quoted fee per head. Visits must be confirmed within 7 days of booking or
-- they are released. Animals scanned empty may be rescanned within 30 days
-- of the visit. Farmers see only their own herds and visits; scanners see
-- the live route board; only the lead scanner approves restricted herds.

use identity password

table roles:
  principal: principal
  role: enum('manager', 'farmer', 'scanner', 'lead')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'lead']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  cap 1000
  online only

table herds:
  owner: principal
  name: text 1..80
  species: enum('ewe', 'cow')
  restricted: bool default false
  immutable owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'scanner'] or exists roles[principal = viewer, role = 'lead']
  insert <- .owner = viewer or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'lead']
  delete <- deny
  cap 200 by owner
  online only

table visits:
  herd: herds
  farmer: principal
  status: enum('booked', 'penned', 'scanning complete', 'recorded', 'released') default 'booked'
  confirmed: bool default false
  photo: image <=8000000
  feeCents: int 1..1000000
  bookedAt: time default now
  visitDate: time
  confirmedAt: time ?
  immutable herd, farmer, bookedAt
  read <- .farmer = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'scanner'] or exists roles[principal = viewer, role = 'lead']
  insert <- exists roles[principal = viewer, role = 'manager']
  update <- .farmer = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'scanner'] or exists roles[principal = viewer, role = 'lead']
  delete <- deny
  cap 500 by herd
  online only

table scans:
  visit: visits
  tag: text 1..20
  result: enum('pregnant', 'empty')
  at: time default now
  unique visit, tag
  immutable visit, tag, at
  read through .visit
  insert <- exists roles[principal = viewer, role = 'scanner'] or exists roles[principal = viewer, role = 'lead']
  update <- deny
  delete <- deny
  cap 2000 by visit
  online only

table rescans:
  scan: scans
  result: enum('pregnant', 'empty')
  at: time default now
  immutable scan, at
  read through .scan
  insert <- exists roles[principal = viewer, role = 'scanner'] or exists roles[principal = viewer, role = 'lead']
  update <- deny
  delete <- deny
  cap 10 by scan
  online only

table approvals:
  visit: visits
  permit: text 1..120
  extraFeeCents: int 0..1000000
  approver: principal
  at: time default now
  unique visit
  immutable visit
  read through .visit
  insert <- exists roles[principal = viewer, role = 'lead']
  update <- exists roles[principal = viewer, role = 'lead']
  delete <- deny
  cap 2000
  online only

mutation provision(principal: principal, role: enum('manager', 'farmer', 'scanner', 'lead')):
  require viewer = 'service:operator' else NOT_OPERATOR 'Only the local operator may provision roles.'
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query herds(c: cursor ?):
  me = roles[viewer]
  if me != null and (me.role = 'manager' or me.role = 'scanner' or me.role = 'lead'):
    return herds last 50 by .id after c
  return herds where .owner = viewer last 50 by .id after c

query routeBoard(c: cursor ?):
  me = roles[viewer]
  if me != null and (me.role = 'manager' or me.role = 'scanner' or me.role = 'lead'):
    return visits last 50 by .id after c
  return visits where .farmer = viewer last 50 by .id after c

query herdVisits(herd: herds, c: cursor ?):
  h = herds[herd] ! else NOT_FOUND 'Herd not found.'
  require h.id = herd else NOT_FOUND 'Herd not found.'
  return visits where .herd = herd last 50 by .id after c

query visitScans(visit: visits, c: cursor ?):
  v = visits[visit] ! else NOT_FOUND 'Visit not found.'
  require v.id = visit else NOT_FOUND 'Visit not found.'
  return scans where .visit = visit last 100 by .id after c

query scanRescans(scan: scans, c: cursor ?):
  s = scans[scan] ! else NOT_FOUND 'Scan not found.'
  require s.id = scan else NOT_FOUND 'Scan not found.'
  return rescans where .scan = scan last 20 by .id after c

query visitApproval(visit: visits):
  v = visits[visit] ! else NOT_FOUND 'Visit not found.'
  require v.id = visit else NOT_FOUND 'Visit not found.'
  return approvals[visit]

mutation createHerd(owner: principal, name: text 1..80, species: enum('ewe', 'cow')):
  me = roles[viewer]
  require me != null else NO_ROLE 'No role provisioned for this account.'
  require me.role = 'manager' or (me.role = 'farmer' and owner = viewer) else NOT_ALLOWED 'Only the manager or the owning farmer may create a herd.'
  return insert herds { owner, name, species, restricted: false }

mutation openVisit(herd: herds, photo: image <=8000000, feeCents: int 1..1000000, visitDate: time):
  me = roles[viewer]
  require me != null and me.role = 'manager' else NOT_MANAGER 'Only the office manager may open a visit.'
  h = herds[herd] ! else NOT_FOUND 'Herd not found.'
  require visitDate >= now - 1d else BAD_DATE 'Visit date is too far in the past.'
  return insert visits { herd, farmer: h.owner, photo, feeCents, visitDate, status: 'booked', confirmed: false, bookedAt: now }

mutation confirmVisit(visit: visits):
  v = visits[visit] ! else NOT_FOUND 'Visit not found.'
  me = roles[viewer]
  require me != null else NO_ROLE 'No role provisioned for this account.'
  require me.role = 'manager' or v.farmer = viewer else NOT_ALLOWED 'Only the manager or the herd farmer may confirm.'
  require not v.confirmed else ALREADY_CONFIRMED 'Visit is already confirmed.'
  require v.status = 'booked' else BAD_STATUS 'Only a booked visit can be confirmed.'
  require v.bookedAt >= now - 7d else EXPIRED 'The 7-day confirmation window has passed.'
  update visits[visit] { confirmed: true, confirmedAt: now }
  return null

mutation advanceVisit(visit: visits, to: enum('penned', 'scanning complete', 'recorded')):
  v = visits[visit] ! else NOT_FOUND 'Visit not found.'
  me = roles[viewer]
  require me != null and ((to = 'penned' and (me.role = 'scanner' or me.role = 'lead')) or ((to = 'scanning complete' or to = 'recorded') and (me.role = 'manager' or me.role = 'lead'))) else NOT_SCANNER 'Only a scanner or the lead may pen a visit; only the office manager or the lead may move a visit into or out of scanning complete.'
  require v.status != 'released' else RELEASED 'This visit was released.'
  require v.confirmed else NOT_CONFIRMED 'Confirm the visit before penning.'
  require (v.status = 'booked' and to = 'penned') or (v.status = 'penned' and to = 'scanning complete') or (v.status = 'scanning complete' and to = 'recorded') else BAD_TRANSITION 'Visits move booked to penned to scanning complete to recorded.'
  h = herds[v.herd]
  if h != null and h.restricted and (to = 'scanning complete' or to = 'recorded'):
    require exists approvals[visit] else NO_APPROVAL 'Disease restriction: lead approval with vet permit required.'
  update visits[visit] { status: to }
  return null

mutation addScan(visit: visits, tag: text 1..20, result: enum('pregnant', 'empty')):
  v = visits[visit] ! else NOT_FOUND 'Visit not found.'
  me = roles[viewer]
  require me != null and (me.role = 'scanner' or me.role = 'lead') else NOT_SCANNER 'Only a scanner may record scans.'
  require v.confirmed else NOT_CONFIRMED 'Confirm the visit before scanning.'
  require v.status = 'penned' or v.status = 'scanning complete' else BAD_STATUS 'Pen the visit before scanning.'
  h = herds[v.herd]
  if h != null and h.restricted:
    require exists approvals[visit] else NO_APPROVAL 'Disease restriction: lead approval with vet permit required.'
  require not exists scans[visit, tag] else DUPLICATE_TAG 'This animal is already scanned for this visit.'
  return insert scans { visit, tag, result, at: now }

mutation addRescan(scan: scans, result: enum('pregnant', 'empty')):
  s = scans[scan] ! else NOT_FOUND 'Scan not found.'
  me = roles[viewer]
  require me != null and (me.role = 'scanner' or me.role = 'lead') else NOT_SCANNER 'Only a scanner may rescan.'
  require s.result = 'empty' else NOT_EMPTY 'Only animals scanned empty may be rescanned.'
  v = visits[s.visit] ! else NOT_FOUND 'Visit not found.'
  require v.visitDate >= now - 30d else WINDOW_CLOSED 'Rescans are allowed within 30 days of the visit.'
  return insert rescans { scan, result, at: now }

mutation approveRestricted(visit: visits, permit: text 1..120, extraFeeCents: int 0..1000000):
  me = roles[viewer]
  require me != null and me.role = 'lead' else NOT_LEAD 'Only the lead scanner may approve a restricted herd.'
  v = visits[visit] ! else NOT_FOUND 'Visit not found.'
  h = herds[v.herd] ! else NOT_FOUND 'Herd not found.'
  require h.restricted else NOT_RESTRICTED 'This herd is not under disease restrictions.'
  return upsert approvals[visit] { visit, permit, extraFeeCents, approver: viewer, at: now }

mutation setRestriction(herd: herds, restricted: bool):
  me = roles[viewer]
  require me != null and (me.role = 'manager' or me.role = 'lead') else NOT_ALLOWED 'Only the manager or lead scanner may change restrictions.'
  h = herds[herd] ! else NOT_FOUND 'Herd not found.'
  update herds[herd] { restricted }
  return null

job releaseStale(periodStart: time, periodEnd: time):
  for v in visits where .bookedAt >= periodEnd - 8d and .bookedAt < periodEnd - 7d by .bookedAt:
    if not v.confirmed and v.status = 'booked':
      update visits[v.id] { status: 'released' }

schedule releaseHourly every 1h: releaseStale

-- v2: the 'scanned' stage was renamed to 'scanning complete'. Existing rows
-- are transformed on deploy; rollback reads them back as 'scanned'.
-- Declaration names carry a generation suffix: the first generation's lineage
-- was poisoned by cross-release edits of transformed rows during testing
-- (a transformed row edited under v2, then rolled back and forwarded several
-- times, refused forward with E_ADOPT), so the lineage was re-based under new
-- names. Fresh preimages are computed from current reads; values are unchanged.
backfill visits renameScanned2(status: enum('booked', 'penned', 'scanned', 'recorded', 'released')): {status: 'scanning complete' if status = 'scanned' else status}
down visits oldStatus2(status: enum('booked', 'penned', 'scanning complete', 'recorded', 'released')): {status: 'scanned' if status = 'scanning complete' else status}
