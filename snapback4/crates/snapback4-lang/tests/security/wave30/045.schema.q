-- Rainwater Cistern Installs.
-- Roles: estimator opens installs; homeowner accepts quote / files warranty claims;
-- crew moves installs along the job board; ops_manager approves outside-tank warranty work.
use identity password

table roles:
  principal: principal
  role: enum('estimator', 'homeowner', 'crew', 'ops_manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

table installs:
  homeowner: principal
  estimator: principal
  address: text 1..200
  yardPhoto: image <=10000000
  soilPhoto: image <=10000000
  quotedCents: int 1..
  status: enum('quoted', 'accepted', 'digging', 'setting', 'plumbing', 'fill_testing', 'completed', 'lapsed') default 'quoted'
  quotedAt: time default now
  quoteDeadline: time
  completedAt: time ?
  immutable homeowner, estimator, quotedAt, quoteDeadline
  read <- .homeowner = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager']
  insert <- exists roles[principal = viewer, role = 'estimator']
  update <- .homeowner = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager']
  online only

table claims:
  install: installs
  homeowner: principal
  kind: enum('tank_crack', 'outside_damage')
  description: text 1..2000
  status: enum('filed', 'approved', 'rejected') default 'filed'
  reason: text 1..2000 ?
  assessment: text 1..2000 ?
  filedAt: time default now
  immutable install, homeowner, kind, filedAt
  read <- .homeowner = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager']
  insert <- .homeowner = viewer
  update <- exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager']
  online only

-- Operator-provisioned roster: signup grants no role on its own.
mutation provision(principal: principal, role: enum('estimator', 'homeowner', 'crew', 'ops_manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

-- Estimator opens an install: yard + soil photos and the quoted price.
mutation openInstall(homeowner: principal, address: text 1..200, yardPhoto: image <=10000000, soilPhoto: image <=10000000, quotedCents: int 1..):
  require exists roles[principal = viewer, role = 'estimator'] else NOT_ESTIMATOR
  require homeowner != viewer else SELF_INSTALL
  return insert installs { homeowner, estimator: viewer, address, yardPhoto, soilPhoto, quotedCents, status: 'quoted', quotedAt: now, quoteDeadline: now + 30d }

-- Homeowner accepts the quote within 30 days, or it lapses.
mutation acceptQuote(install: installs):
  row = installs[install] ! else NOT_FOUND
  require row.homeowner = viewer else NOT_HOMEOWNER
  require row.status = 'quoted' else NOT_QUOTED
  require now <= row.quoteDeadline else QUOTE_LAPSED
  update installs[row.id] { status: 'accepted' }
  return null

-- Crew advances the live job board: accepted -> digging -> setting -> plumbing -> fill_testing -> completed.
mutation advanceInstall(install: installs):
  require exists roles[principal = viewer, role = 'crew'] else NOT_CREW
  row = installs[install] ! else NOT_FOUND
  require row.status = 'accepted' or row.status = 'digging' or row.status = 'setting' or row.status = 'plumbing' or row.status = 'fill_testing' else NOT_ACTIVE
  next = 'digging' if row.status = 'accepted' else 'setting' if row.status = 'digging' else 'plumbing' if row.status = 'setting' else 'fill_testing' if row.status = 'plumbing' else 'completed'
  if next = 'completed':
    update installs[row.id] { status: next, completedAt: now }
  else:
    update installs[row.id] { status: next }
  return null

-- Homeowner files a warranty claim within five years after completion.
mutation fileClaim(install: installs, kind: enum('tank_crack', 'outside_damage'), description: text 1..2000):
  row = installs[install] ! else NOT_FOUND
  require row.homeowner = viewer else NOT_HOMEOWNER
  require row.status = 'completed' else NOT_COMPLETED
  require row.completedAt != null else NOT_COMPLETED
  require now <= row.completedAt + 1825d else WARRANTY_EXPIRED
  return insert claims { install, homeowner: viewer, kind, description, status: 'filed', filedAt: now }

-- Decide a warranty claim. Tank cracks may be decided by crew or the ops manager;
-- damage outside the tank needs the ops manager plus a recorded reason and the crew lead's assessment.
mutation decideClaim(claim: claims, approve: bool, reason: text 1..2000 ?, assessment: text 1..2000 ?):
  row = claims[claim] ! else NOT_FOUND
  require row.status = 'filed' else NOT_FILED
  if row.kind = 'outside_damage':
    require exists roles[principal = viewer, role = 'ops_manager'] else NOT_OPS_MANAGER
    if approve:
      require reason != null else NEEDS_REASON
      require assessment != null else NEEDS_ASSESSMENT
    update claims[row.id] { status: 'approved' if approve else 'rejected', reason, assessment }
  else:
    require exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager'] else NOT_DECIDER
    update claims[row.id] { status: 'approved' if approve else 'rejected', reason, assessment }
  return null

query myRole():
  return roles[principal = viewer]

-- Homeowners see only their own installs; staff see everything.
query myInstalls(c: cursor ?):
  if exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager']:
    return installs last 50 by .id after c
  return installs where .homeowner = viewer last 50 by .id after c

-- The crew's live job board: active installs moving through the stages.
query jobBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager'] else NOT_STAFF
  return installs where .status = 'accepted' or .status = 'digging' or .status = 'setting' or .status = 'plumbing' or .status = 'fill_testing' last 50 by .id after c

query installDetail(install: installs):
  return installs[install]

-- Homeowners see only their own claims; staff see everything.
query myClaims(c: cursor ?):
  if exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager']:
    return claims last 50 by .id after c
  return claims where .homeowner = viewer last 50 by .id after c

query claimsFor(install: installs, c: cursor ?):
  row = installs[install] ! else NOT_FOUND
  require row.homeowner = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager'] else NOT_VISIBLE
  return claims where .install = install last 50 by .id after c

query claimDetail(claim: claims):
  return claims[claim]

-- Past-deadline quotes lapse on the server's clock.
job lapseQuotes():
  for i in installs:
    if i.status = 'quoted' and i.quoteDeadline < now:
      update installs[i.id] { status: 'lapsed' }
schedule lapseHourly every 1h: lapseQuotes

-- Privacy intent from the spec.
invariant installs.read only .homeowner = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager']
invariant claims.read only .homeowner = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'ops_manager']
invariant roles.read only .principal = viewer or viewer = 'service:operator'
