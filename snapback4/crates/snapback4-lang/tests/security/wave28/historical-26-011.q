use identity password

table roles:
  principal: principal
  role: enum('coordinator', 'homeowner', 'plumber', 'owner')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('coordinator', 'homeowner', 'plumber', 'owner'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query myRole():
  return roles[viewer]

query homeowners():
  require exists roles[viewer, role = 'coordinator'] else COORDINATOR_ONLY
  return roles where .role = 'homeowner' first 100 by .id

table installs:
  homeowner: principal
  customer: text 1..80
  address: text 5..240
  report: image <=5000000
  hardness: int 1..2000
  priceCents: int 100..10000000
  openedBy: principal
  openedAt: time
  quoteDeadline: time
  stage: enum('quoted', 'survey', 'plumbing', 'retest', 'complete', 'closed')
  finishedDrain: bool
  consentNote: text 5..500 ?
  consentAt: time ?
  approvedBy: principal ?
  approvedAt: time ?
  installedAt: time ?
  retestDue: time ?
  retestFlag: bool default false
  result: int 0..2000 ?
  testedAt: time ?
  testedBy: principal ?
  immutable homeowner, customer, address, report, hardness, priceCents, openedBy, openedAt, quoteDeadline, finishedDrain
  read <- .homeowner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'plumber'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'coordinator'] and .openedBy = viewer and exists roles[.homeowner, role = 'homeowner']
  update <- .homeowner = viewer or exists roles[viewer, role = 'plumber'] or exists roles[viewer, role = 'owner']
  online only

query listInstalls():
  if exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'plumber'] or exists roles[viewer, role = 'owner']:
    return installs last 100 by .id
  return installs where .homeowner = viewer last 100 by .id

query getInstall(install: installs):
  return installs[install]

mutation openInstall(homeowner: principal, customer: text 1..80, address: text 5..240, report: image <=5000000, hardness: int 1..2000, priceCents: int 100..10000000, finishedDrain: bool):
  require exists roles[viewer, role = 'coordinator'] else COORDINATOR_ONLY
  require exists roles[homeowner, role = 'homeowner'] else HOMEOWNER_REQUIRED
  return insert installs { homeowner, customer, address, report, hardness, priceCents, finishedDrain, openedBy: viewer, openedAt: now, quoteDeadline: now + 21d, stage: 'quoted' }

mutation acceptQuote(install: installs):
  require exists roles[viewer, role = 'homeowner'] else HOMEOWNER_ONLY
  row = installs[install] ! else NOT_FOUND
  require row.homeowner = viewer else NOT_YOURS
  require row.stage = 'quoted' else WRONG_STAGE
  require now < row.quoteDeadline else QUOTE_EXPIRED
  update installs[install] { stage: 'survey' }

mutation consentDrain(install: installs, note: text 5..500):
  require exists roles[viewer, role = 'homeowner'] else HOMEOWNER_ONLY
  row = installs[install] ! else NOT_FOUND
  require row.homeowner = viewer else NOT_YOURS
  require row.finishedDrain else NO_FINISHED_DRAIN
  require row.stage = 'survey' else WRONG_STAGE
  require row.approvedAt = null else ALREADY_APPROVED
  update installs[install] { consentNote: note, consentAt: now }

mutation approveDrain(install: installs):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  row = installs[install] ! else NOT_FOUND
  require row.finishedDrain else NO_FINISHED_DRAIN
  require row.stage = 'survey' else WRONG_STAGE
  require row.consentAt != null else CONSENT_REQUIRED
  require row.approvedAt = null else ALREADY_APPROVED
  update installs[install] { approvedBy: viewer, approvedAt: now }

mutation startPlumbing(install: installs):
  require exists roles[viewer, role = 'plumber'] else PLUMBER_ONLY
  row = installs[install] ! else NOT_FOUND
  require row.stage = 'survey' else WRONG_STAGE
  require not row.finishedDrain or row.approvedAt != null else OWNER_APPROVAL_REQUIRED
  update installs[install] { stage: 'plumbing' }

mutation finishInstall(install: installs):
  require exists roles[viewer, role = 'plumber'] else PLUMBER_ONLY
  row = installs[install] ! else NOT_FOUND
  require row.stage = 'plumbing' else WRONG_STAGE
  update installs[install] { stage: 'retest', installedAt: now, retestDue: now + 30d, retestFlag: true }

mutation recordRetest(install: installs, result: int 0..2000):
  require exists roles[viewer, role = 'plumber'] else PLUMBER_ONLY
  row = installs[install] ! else NOT_FOUND
  require row.stage = 'retest' else WRONG_STAGE
  update installs[install] { stage: 'complete', result, testedAt: now, testedBy: viewer, retestFlag: false }

job closeExpired(periodStart: time, periodEnd: time):
  for row in installs where .quoteDeadline <= now by .quoteDeadline:
    if row.stage = 'quoted':
      update installs[row.id] { stage: 'closed' }

schedule quoteExpiry every 1m: closeExpired

-- Independent policy intent: homeowners can observe only their own homes.
invariant installs.read only .homeowner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'plumber'] or exists roles[viewer, role = 'owner']
invariant roles.role write only viewer = 'service:operator'
invariant installs.openInstall only exists roles[viewer, role = 'coordinator']
invariant installs.acceptQuote only .homeowner = viewer and exists roles[viewer, role = 'homeowner']
invariant installs.consentDrain only .homeowner = viewer and exists roles[viewer, role = 'homeowner']
invariant installs.approveDrain only exists roles[viewer, role = 'owner']
invariant installs.startPlumbing only exists roles[viewer, role = 'plumber']
invariant installs.finishInstall only exists roles[viewer, role = 'plumber']
invariant installs.recordRetest only exists roles[viewer, role = 'plumber']
