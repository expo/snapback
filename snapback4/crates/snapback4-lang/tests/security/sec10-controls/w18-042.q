-- Data Center Cage Escorts.
-- Roles: manager (site manager), security (escorts), operations (ops desk),
-- customer (colocation customer, scoped to one org), visitor (customer engineer).
-- Auth: real password accounts (`use identity password`). No personas/dev cast.
use identity password

table roles:
  principal: principal
  role: enum('manager', 'security', 'operations', 'customer', 'visitor')
  org: text <=40
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, org = .org]
  insert <- exists roles[viewer, role = 'manager'] or viewer = 'service:ops'
  update <- exists roles[viewer, role = 'manager'] or viewer = 'service:ops'
  delete <- exists roles[viewer, role = 'manager']
  online only

table cages:
  code: text 3..20
  org: text 1..40
  unique code
  read <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] or exists roles[viewer, role = 'operations'] or exists roles[principal = viewer, role = 'customer', org = .org]
  insert <- exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'manager']
  delete <- exists roles[viewer, role = 'manager']
  online only

table visits:
  visitor: principal
  org: text 1..40
  cage: cages
  work: text 3..500
  photoId: image <=5000000
  approvedStart: time
  status: enum('requested', 'approved', 'on-floor', 'completed', 'expired') default 'requested'
  requestedBy: principal
  checkedInAt: time ?
  checkedOutAt: time ?
  immutable visitor, org, cage, work, photoId, approvedStart, requestedBy
  read <- .visitor = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] or exists roles[viewer, role = 'operations'] or exists roles[principal = viewer, role = 'customer', org = .org]
  insert <- exists roles[viewer, role = 'manager'] or exists roles[principal = viewer, role = 'customer', org = .org]
  update <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security']
  online only

table accessLogs:
  visit: visits
  org: text 1..40
  cage: cages
  visitor: principal
  event: enum('check-in', 'check-out')
  at: time default now
  escort: principal
  immutable visit, org, cage, visitor, event, at, escort
  read <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] or exists roles[viewer, role = 'operations'] or exists roles[principal = viewer, role = 'customer', org = .org]
  insert <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security']
  online only

table unlistedGrants:
  visitorName: text 1..80
  cage: cages
  org: text 1..40
  reason: text 10..500
  validFrom: time
  validUntil: time
  createdBy: principal
  immutable visitorName, cage, org, reason, validFrom, validUntil, createdBy
  read <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security']
  insert <- exists roles[viewer, role = 'manager']
  online only

query whoAmI():
  return viewer

query myRole():
  return roles[viewer]

query myCages(c: cursor ?):
  r = roles[viewer] ! else NO_ROLE
  if r.role = 'customer':
    return cages where .org = r.org first 100 by .id after c
  require r.role = 'manager' or r.role = 'security' or r.role = 'operations' else NOT_STAFF
  return cages first 100 by .id after c

query myVisits(c: cursor ?):
  r = roles[viewer] ! else NO_ROLE
  if r.role = 'visitor':
    return visits where .visitor = viewer last 100 by .id after c
  if r.role = 'customer':
    return visits where .org = r.org last 100 by .id after c
  require r.role = 'manager' or r.role = 'security' or r.role = 'operations' else NOT_STAFF
  return visits last 100 by .id after c

query floorNow(c: cursor ?):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] or exists roles[viewer, role = 'operations'] else NOT_STAFF
  return visits where .status = 'on-floor' last 100 by .id after c

query orgAccessLogs(c: cursor ?):
  r = roles[viewer] ! else NO_ROLE
  if r.role = 'customer':
    return accessLogs where .org = r.org last 100 by .id after c
  require r.role = 'manager' or r.role = 'security' or r.role = 'operations' else NOT_STAFF
  return accessLogs last 100 by .id after c

query unlistedList(c: cursor ?):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] else NOT_ALLOWED
  return unlistedGrants last 100 by .id after c

mutation grantRole(who: principal, role: enum('manager', 'security', 'operations', 'customer', 'visitor'), org: text <=40):
  require exists roles[viewer, role = 'manager'] or viewer = 'service:ops' else NOT_MANAGER
  return upsert roles[who] { role, org }

mutation addCage(code: text 3..20, org: text 1..40):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  return insert cages { code, org }

mutation requestVisit(visitor: principal, cage: cages, work: text 3..500, photoId: image <=5000000, approvedStart: time):
  r = roles[viewer] ! else NO_ROLE
  require r.role = 'manager' or r.role = 'customer' else NOT_CUSTOMER
  c = cages[cage] ! else NOT_FOUND
  require r.role = 'manager' or r.org = c.org else NOT_YOUR_CAGE
  vr = roles[visitor] ! else UNKNOWN_VISITOR
  require vr.role = 'visitor' and vr.org = c.org else BAD_VISITOR
  require approvedStart >= now - 5m else START_IN_PAST
  return insert visits { visitor, org: c.org, cage, work, photoId, approvedStart, requestedBy: viewer }

mutation approveVisit(visit: visits):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'requested' else BAD_STATE
  update visits[visit] { status: 'approved' }
  return null

mutation checkIn(visit: visits):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] else NOT_SECURITY
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'approved' else BAD_STATE
  require v.approvedStart + 2h >= now else EXPIRED
  update visits[visit] { status: 'on-floor', checkedInAt: now }
  insert accessLogs { visit, org: v.org, cage: v.cage, visitor: v.visitor, event: 'check-in', escort: viewer }
  return null

mutation checkOut(visit: visits):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] else NOT_SECURITY
  v = visits[visit] ! else NOT_FOUND
  require v.status = 'on-floor' else BAD_STATE
  update visits[visit] { status: 'completed', checkedOutAt: now }
  insert accessLogs { visit, org: v.org, cage: v.cage, visitor: v.visitor, event: 'check-out', escort: viewer }
  return null

mutation grantUnlisted(visitorName: text 1..80, cage: cages, reason: text 10..500, validFrom: time, validUntil: time):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  c = cages[cage] ! else NOT_FOUND
  require validUntil > validFrom else BAD_WINDOW
  return insert unlistedGrants { visitorName, cage, org: c.org, reason, validFrom, validUntil, createdBy: viewer }

-- A visit request expires if the visitor does not arrive within two hours of
-- its approved start. The mutations enforce the deadline exactly with `now`;
-- this job flips the stored flag for screens that list it.
job expireVisits(periodStart: time, periodEnd: time):
  for v in visits where .approvedStart >= periodStart - 2h - 30d and .approvedStart < periodEnd - 2h by .approvedStart:
    if v.status = 'approved':
      update visits[v.id] { status: 'expired' }

schedule expireHourly every 1h: expireVisits

invariant roles.read only .principal = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, org = .org]
invariant cages.read only exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] or exists roles[viewer, role = 'operations'] or exists roles[principal = viewer, role = 'customer', org = .org]
invariant visits.read only .visitor = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] or exists roles[viewer, role = 'operations'] or exists roles[principal = viewer, role = 'customer', org = .org]
invariant accessLogs.read only exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security'] or exists roles[viewer, role = 'operations'] or exists roles[principal = viewer, role = 'customer', org = .org]
invariant unlistedGrants.read only exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'security']
