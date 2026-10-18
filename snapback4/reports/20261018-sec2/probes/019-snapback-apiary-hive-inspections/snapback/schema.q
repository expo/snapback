-- Apiary Hive Inspections.
-- Roles: lead beekeeper, inspector, landowner. Real password + guest identity;
-- every privacy rule below is enforced by table rules, and every privileged
-- change additionally carries a mutation-level `require ... else CODE`.
use identity
use personas lead1, lead2, insp1, insp2, own1, own2

-- Treatment threshold: a mite count strictly above 3 raises an alert.
-- (Kept as a literal in `recordInspection` and `hiveStatus` together.)

table roles:
  principal: principal
  role: enum('lead', 'inspector', 'landowner')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'lead']
  insert <- exists roles[viewer, role = 'lead'] or viewer = 'service:ops'
  update <- exists roles[viewer, role = 'lead'] or viewer = 'service:ops'
  delete <- exists roles[viewer, role = 'lead'] or viewer = 'service:ops'
  cap 100
  online only

-- An inspector's assigned route(s). Hives name a route; the hive read rule
-- joins through this roster so inspectors see only their route's hives.
table routes:
  inspector: principal
  route: text 1..40
  unique inspector, route
  read <- .inspector = viewer or exists roles[viewer, role = 'lead']
  insert <- exists roles[viewer, role = 'lead'] or viewer = 'service:ops'
  delete <- exists roles[viewer, role = 'lead'] or viewer = 'service:ops'
  cap 100
  online only

table hives:
  name: text 1..80
  landOwner: principal
  route: text 1..40
  status: enum('healthy', 'requeen', 'quarantined') default 'healthy'
  seasonStart: time
  seasonEnd: time
  lastInspectedAt: time ?
  lastMiteCount: int 0..100 ?
  createdAt: time default now
  immutable landOwner, route
  read <- .landOwner = viewer or (exists routes[inspector = viewer, route = .route] and exists roles[viewer, role = 'inspector']) or exists roles[viewer, role = 'lead']
  insert <- exists roles[viewer, role = 'lead'] or viewer = 'service:ops'
  update <- (exists routes[inspector = viewer, route = .route] and exists roles[viewer, role = 'inspector']) or exists roles[viewer, role = 'lead']
  delete <- exists roles[viewer, role = 'lead']
  cap 500
  online only

table inspections:
  hive: hives
  inspector: principal
  at: time default now
  queenStatus: enum('laying', 'not-laying', 'not-seen', 'queenless')
  miteCount: int 0..100
  notes: text <=500 ?
  photo: image <=10000000 ?
  immutable hive, inspector, at
  read through .hive
  insert <- .inspector = viewer and exists roles[viewer, role = 'inspector']
  cap 20000
  online only

-- One alert row per over-threshold inspection, readable by the hive's owner
-- and the lead beekeeper.
table alerts:
  hive: hives
  owner: principal
  inspector: principal
  miteCount: int 0..100
  at: time default now
  immutable hive, owner, inspector, miteCount, at
  read <- .owner = viewer or exists roles[viewer, role = 'lead']
  insert <- .inspector = viewer and exists roles[viewer, role = 'inspector']
  cap 20000
  online only

-- Public honey listings, at most one per hive. A hive flagged for requeening
-- or quarantine has no listing row (deleted by `setHiveStatus`, refused by
-- `addListing`), so the public query below can never leak one.
table listings:
  hive: hives
  owner: principal
  title: text 1..80
  priceCents: int 0..
  blurb: text <=300 ?
  createdAt: time default now
  unique hive
  immutable hive, owner
  public 'honey listings are public; flagged hives hold no listing row'
  insert <- .owner = viewer
  update <- .owner = viewer
  delete <- .owner = viewer or exists roles[viewer, role = 'lead']
  cap 500
  online only

query whoAmI():
  return viewer

query myRole():
  return roles[viewer]

query hive(hive: hives):
  return hives[hive]

query hives(c: cursor ?):
  return hives last 50 by .id after c

query inspectionsOf(hive: hives, c: cursor ?):
  return inspections where .hive = hive last 50 by .at after c

-- A hive not inspected in the last 14 days while in season is overdue.
-- Hives never inspected count as overdue once the season has run 14 days.
query hiveStatus(hive: hives):
  h = hives[hive] ! else NOT_FOUND
  inSeason = h.seasonStart <= now and now <= h.seasonEnd
  lastAt = h.lastInspectedAt ?? 0
  overdue = inSeason and lastAt < now - 14d
  alert = (h.lastMiteCount ?? 0) > 3
  return { inSeason, overdue, alert, lastInspectedAt: h.lastInspectedAt, lastMiteCount: h.lastMiteCount, status: h.status }

query myAlerts(c: cursor ?):
  return alerts last 50 by .at after c

query listings(c: cursor ?):
  return listings last 50 by .id after c

query roster(c: cursor ?):
  require exists roles[viewer, role = 'lead'] else NOT_LEAD
  return roles last 50 by .id after c

query myRoutes(c: cursor ?):
  return routes where .inspector = viewer last 20 by .id after c

query routeBoard(c: cursor ?):
  require exists roles[viewer, role = 'lead'] or exists roles[viewer, role = 'inspector'] else NOT_ALLOWED
  return routes last 50 by .id after c

-- First-lead enrollment uses the service:ops seat (mint with
-- `snapback4 token --service ops`); afterwards leads grant the rest.
mutation grantRole(who: principal, role: enum('lead', 'inspector', 'landowner')):
  require exists roles[viewer, role = 'lead'] or viewer = 'service:ops' else NOT_LEAD
  return upsert roles[who] { role }

mutation assignRoute(inspector: principal, route: text 1..40):
  require exists roles[viewer, role = 'lead'] or viewer = 'service:ops' else NOT_LEAD
  require exists roles[inspector, role = 'inspector'] else NOT_INSPECTOR
  return insert routes { inspector, route }

mutation createHive(name: text 1..80, landOwner: principal, route: text 1..40, seasonStart: time, seasonEnd: time):
  require exists roles[viewer, role = 'lead'] or viewer = 'service:ops' else NOT_LEAD
  require seasonStart < seasonEnd else BAD_SEASON
  require exists roles[landOwner, role = 'landowner'] else NOT_LANDOWNER
  return insert hives { name, landOwner, route, seasonStart, seasonEnd }

mutation recordInspection(hive: hives, queenStatus: enum('laying', 'not-laying', 'not-seen', 'queenless'), miteCount: int 0..100, notes: text <=500 ?, photo: image <=10000000 ?, at: time ?):
  h = hives[hive] ! else NOT_FOUND
  require exists roles[viewer, role = 'inspector'] else NOT_INSPECTOR
  require exists routes[inspector = viewer, route = h.route] else NOT_ROUTE
  stamp = at ?? now
  require stamp <= now + 1h else BAD_TIME
  prev = h.lastInspectedAt ?? 0
  newest = stamp if stamp > prev else prev
  update hives[hive] { lastInspectedAt: newest, lastMiteCount: miteCount }
  insp = insert inspections { hive, inspector: viewer, at: stamp, queenStatus, miteCount, notes, photo }
  if miteCount > 3:
    insert alerts { hive, owner: h.landOwner, inspector: viewer, miteCount, at: stamp }
  return insp

-- Only the lead beekeeper may flag a hive; the flag deletes the hive's
-- public honey listing in the same transaction.
mutation setHiveStatus(hive: hives, status: enum('healthy', 'requeen', 'quarantined')):
  require exists roles[viewer, role = 'lead'] or viewer = 'service:ops' else NOT_LEAD
  h = hives[hive] ! else NOT_FOUND
  update hives[hive] { status }
  if exists listings[hive]:
    delete listings[hive]
  return null

mutation addListing(hive: hives, title: text 1..80, priceCents: int 0.., blurb: text <=300 ?):
  h = hives[hive] ! else NOT_FOUND
  require h.landOwner = viewer else NOT_OWNER
  require h.status = 'healthy' else HIVE_HIDDEN 'This hive is hidden from honey listings while flagged.'
  return upsert listings[hive] { owner: viewer, title, priceCents, blurb }

mutation removeListing(hive: hives):
  l = listings[hive] ! else NOT_FOUND
  require l.owner = viewer else NOT_OWNER
  delete listings[hive]
  return null
