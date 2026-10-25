-- Home Battery Installs.
--
-- Roles: coordinator (opens installs), homeowner (accepts quote, views own
-- installs), electrician (live board, advances work, records installation and
-- inspection), owner (approves indoor mounting with homeowner consent).
-- Operator (service:operator) provisions roles; it is never a data reader.
use identity password

table roles:
  principal: principal
  email: text 3..320
  role: enum('coordinator', 'homeowner', 'electrician', 'owner')
  unique principal
  unique email
  immutable principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  cap 1000
  online only

-- One row per homeowner customer so coordinators can address new installs to
-- a real homeowner principal without ever seeing another role's roster.
table customers:
  homeowner: principal
  email: text 3..320
  unique homeowner
  unique email
  immutable homeowner
  read <- .homeowner = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  cap 1000
  online only

table installs:
  homeowner: principal
  coordinator: principal
  address: text 1..200
  assessment: image <=10000000
  price: money USD
  quotedAt: time default now
  quoteStatus: enum('pending', 'accepted', 'closed') default 'pending'
  acceptedAt: time ?
  stage: enum('survey', 'wiring', 'inspection') default 'survey'
  installedAt: time ?
  awaitingInspection: bool default false
  inspectionResult: enum('pass', 'fail') ?
  inspectedAt: time ?
  indoorMount: bool default false
  indoorApproved: bool default false
  indoorConsent: text <=500 ?
  immutable homeowner, coordinator, quotedAt
  read <- .homeowner = viewer and exists roles[principal = viewer, role = 'homeowner'] or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'electrician'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'coordinator']
  update <- .homeowner = viewer and exists roles[principal = viewer, role = 'homeowner'] or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'electrician'] or exists roles[principal = viewer, role = 'owner']
  cap 200 by homeowner
  online only

-- Privacy intent, stated separately from the rules (guide security).
invariant installs.read only .homeowner = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'electrician'] or exists roles[principal = viewer, role = 'owner']
invariant installs.insert only exists roles[principal = viewer, role = 'coordinator']
invariant roles.read only .principal = viewer
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
invariant customers.read only .homeowner = viewer or exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']

query myRole():
  return roles[viewer]

query directory(c: cursor ?):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only coordinators and the owner may list customers.'
  return customers last 50 by .id after c

query myInstalls(c: cursor ?):
  return installs where .homeowner = viewer last 50 by .id after c

query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'electrician'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only staff may read the install board.'
  return installs last 50 by .id after c

query flagged(c: cursor ?):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'electrician'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only staff may read the flagged installs.'
  return installs where .awaitingInspection = true last 50 by .id after c

mutation provision(principal: principal, role: enum('coordinator', 'homeowner', 'electrician', 'owner'), email: text 3..320):
  require viewer = 'service:operator' else NOT_OPERATOR 'Only the local operator may provision roles.'
  upsert roles[principal] { principal, email, role }
  if role = 'homeowner':
    upsert customers[principal] { homeowner: principal, email }
  return null

mutation openInstall(homeowner: principal, address: text 1..200, assessment: image <=10000000, price: money USD, indoorMount: bool):
  require exists roles[principal = viewer, role = 'coordinator'] else NOT_COORDINATOR 'Only coordinators may open installs.'
  return insert installs { homeowner, coordinator: viewer, address, assessment, price, indoorMount }

mutation acceptQuote(install: installs):
  inst = installs[install] ! else NOT_FOUND
  require inst.homeowner = viewer else NOT_YOUR_INSTALL 'This install belongs to another homeowner.'
  require inst.quoteStatus = 'pending' else QUOTE_NOT_PENDING 'This quote is no longer pending.'
  require now <= inst.quotedAt + 21d else QUOTE_EXPIRED 'The 21-day acceptance window has passed.'
  update installs[install] { quoteStatus: 'accepted', acceptedAt: now }
  return null

mutation startWiring(install: installs):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'electrician'] else NOT_STAFF 'Only coordinators or electricians may start wiring.'
  inst = installs[install] ! else NOT_FOUND
  require inst.quoteStatus = 'accepted' else QUOTE_NOT_ACCEPTED 'The quote must be accepted before work begins.'
  require inst.stage = 'survey' else BAD_STAGE 'Wiring starts from the survey stage.'
  update installs[install] { stage: 'wiring' }
  return null

mutation recordInstallation(install: installs):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'electrician'] else NOT_STAFF 'Only coordinators or electricians may record an installation.'
  inst = installs[install] ! else NOT_FOUND
  require inst.quoteStatus = 'accepted' else QUOTE_NOT_ACCEPTED 'The quote must be accepted before work begins.'
  require inst.stage = 'wiring' else BAD_STAGE 'Record the installation from the wiring stage.'
  update installs[install] { stage: 'inspection', installedAt: now, awaitingInspection: true }
  return null

mutation recordInspection(install: installs, result: enum('pass', 'fail')):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'electrician'] else NOT_STAFF 'Only coordinators or electricians may record an inspection.'
  inst = installs[install] ! else NOT_FOUND
  require inst.awaitingInspection = true else NOT_AWAITING 'No inspection is awaiting a result for this install.'
  update installs[install] { inspectionResult: result, inspectedAt: now, awaitingInspection: false }
  return null

mutation requestIndoorMount(install: installs):
  require exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'electrician'] else NOT_STAFF 'Only coordinators or electricians may request an indoor mount.'
  inst = installs[install] ! else NOT_FOUND
  require inst.indoorMount = false else ALREADY_REQUESTED 'An indoor mount was already requested for this install.'
  update installs[install] { indoorMount: true }
  return null

mutation approveIndoorMount(install: installs, consent: text 1..500):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the company owner may approve an indoor mount.'
  inst = installs[install] ! else NOT_FOUND
  require inst.indoorMount = true else NOT_REQUESTED 'No indoor mount was requested for this install.'
  require inst.indoorApproved = false else ALREADY_APPROVED 'This indoor mount was already approved.'
  update installs[install] { indoorApproved: true, indoorConsent: consent }
  return null

-- Quotes the homeowner never accepts close on their own after 21 days.
job closeExpiredQuotes(periodStart: time, periodEnd: time):
  for i in installs by .id:
    if i.quoteStatus = 'pending' and i.quotedAt + 21d < periodEnd:
      update installs[i.id] { quoteStatus: 'closed' }

schedule closeExpiredNightly every 1d at 03:00: closeExpiredQuotes
