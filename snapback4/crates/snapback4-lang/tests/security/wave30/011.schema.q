use identity password

-- Staff grants are local-operator work. Password signup cannot claim a role.
table roles:
  principal: principal
  role: enum('coordinator', 'homeowner', 'installer', 'owner')
  name: text 1..80
  unique principal
  immutable principal, role, name
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']
  insert <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('coordinator', 'homeowner', 'installer', 'owner'), name: text 1..80):
  require viewer = 'service:operator' else OPERATOR_ONLY
  return insert roles { principal, role, name }

query myRole():
  return roles[principal = viewer]

query homeowners(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] else COORDINATOR_ONLY
  return roles where .role = 'homeowner' last 50 by .id after c { principal, name }

table installs:
  homeowner: principal
  property: text 3..120
  address: text 5..240
  room: enum('living', 'cabin', 'bedroom')
  quoteCents: int 100..10000000
  chimneyReport: file <=5000000 ('application/pdf', 'image/jpeg', 'image/png')
  coordinator: principal
  openedAt: time
  quoteDeadline: time
  stage: enum('quote', 'survey', 'flue', 'hearth', 'inspection', 'complete', 'closed') default 'quote'
  accepted: bool default false
  acceptedAt: time ?
  bedroomApprovedBy: principal ? write <- exists roles[viewer, role = 'owner']
  bedroomApprovedAt: time ? write <- exists roles[viewer, role = 'owner']
  homeownerConsent: bool ? write <- exists roles[viewer, role = 'owner']
  consentNote: text 5..1000 ? write <- exists roles[viewer, role = 'owner']
  installedAt: time ?
  inspectionDue: time ?
  inspectionResult: enum('pass', 'fail') ?
  inspectionNote: text 5..2000 ?
  inspectionRecordedAt: time ?
  inspectionRecordedBy: principal ?
  overdue: bool default false
  immutable homeowner, property, address, room, quoteCents, chimneyReport, coordinator, openedAt, quoteDeadline
  immutable bedroomApprovedBy, bedroomApprovedAt, homeownerConsent, consentNote when .bedroomApprovedAt != null
  read <- .homeowner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] or (exists roles[viewer, role = 'installer'] and .accepted = true)
  insert <- exists roles[viewer, role = 'coordinator'] and .coordinator = viewer and .stage = 'quote' and exists roles[.homeowner, role = 'homeowner']
  update <- .homeowner = viewer or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'owner']
  online only

-- Product intent: homeowners have no cross-household access; staff operate the company board.
invariant installs.read only .homeowner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner'] or (exists roles[viewer, role = 'installer'] and .accepted = true)
invariant installs.insert only exists roles[viewer, role = 'coordinator']
invariant installs.bedroomApprovedBy write only exists roles[viewer, role = 'owner']

query board(c: cursor ?):
  require exists roles[viewer] else ROLE_REQUIRED
  if exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'owner']:
    return installs last 50 by .id after c { *, effectiveStage: 'closed' if .stage = 'quote' and .quoteDeadline <= now else .stage, inspectionFlag: .installedAt != null and .inspectionResult = null, inspectionOverdue: .inspectionDue != null and .inspectionDue <= now and .inspectionResult = null }
  if exists roles[viewer, role = 'installer']:
    return installs where .accepted = true last 50 by .id after c { *, effectiveStage: .stage, inspectionFlag: .installedAt != null and .inspectionResult = null, inspectionOverdue: .inspectionDue != null and .inspectionDue <= now and .inspectionResult = null }
  return installs where .homeowner = viewer last 50 by .id after c { *, effectiveStage: 'closed' if .stage = 'quote' and .quoteDeadline <= now else .stage, inspectionFlag: .installedAt != null and .inspectionResult = null, inspectionOverdue: .inspectionDue != null and .inspectionDue <= now and .inspectionResult = null }

query installDetail(install: installs):
  return installs[install] { *, effectiveStage: 'closed' if .stage = 'quote' and .quoteDeadline <= now else .stage, inspectionFlag: .installedAt != null and .inspectionResult = null, inspectionOverdue: .inspectionDue != null and .inspectionDue <= now and .inspectionResult = null }

mutation openInstall(homeowner: principal, property: text 3..120, address: text 5..240, room: enum('living', 'cabin', 'bedroom'), quoteCents: int 100..10000000, chimneyReport: file <=5000000 ('application/pdf', 'image/jpeg', 'image/png')):
  require exists roles[viewer, role = 'coordinator'] else COORDINATOR_ONLY
  require exists roles[homeowner, role = 'homeowner'] else HOMEOWNER_REQUIRED
  return insert installs { homeowner, property, address, room, quoteCents, chimneyReport, coordinator: viewer, openedAt: now, quoteDeadline: now + 21d }

mutation acceptQuote(install: installs):
  i = installs[install] ! else NOT_FOUND
  require i.homeowner = viewer and exists roles[viewer, role = 'homeowner'] else HOMEOWNER_ONLY
  require i.stage = 'quote' else QUOTE_NOT_OPEN
  require now < i.quoteDeadline else QUOTE_EXPIRED 'The 21-day acceptance window has closed.'
  update installs[install] { stage: 'survey', accepted: true, acceptedAt: now }

mutation approveBedroom(install: installs, consent: bool, consentNote: text 5..1000):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  i = installs[install] ! else NOT_FOUND
  require i.room = 'bedroom' else BEDROOM_ONLY
  require i.stage != 'closed' and (i.stage != 'quote' or now < i.quoteDeadline) else JOB_CLOSED
  require i.bedroomApprovedAt = null else ALREADY_APPROVED
  require consent else CONSENT_REQUIRED 'Record the homeowner\'s explicit consent before approval.'
  update installs[install] { bedroomApprovedBy: viewer, bedroomApprovedAt: now, homeownerConsent: true, consentNote }

mutation advanceInstall(install: installs):
  require exists roles[viewer, role = 'installer'] else INSTALLER_ONLY
  i = installs[install] ! else NOT_FOUND
  require i.acceptedAt != null else QUOTE_NOT_ACCEPTED
  require i.room != 'bedroom' or (i.bedroomApprovedAt != null and i.homeownerConsent = true) else BEDROOM_APPROVAL_REQUIRED
  if i.stage = 'survey':
    update installs[install] { stage: 'flue' }
  elif i.stage = 'flue':
    update installs[install] { stage: 'hearth' }
  elif i.stage = 'hearth':
    update installs[install] { stage: 'inspection', installedAt: now, inspectionDue: now + 30d }
  else:
    require false else INVALID_STAGE 'Only survey, flue lining and hearth stages can advance.'

mutation recordInspection(install: installs, result: enum('pass', 'fail'), note: text 5..2000):
  require exists roles[viewer, role = 'installer'] else INSTALLER_ONLY
  i = installs[install] ! else NOT_FOUND
  require i.stage = 'inspection' and i.installedAt != null else INSPECTION_NOT_DUE
  require i.inspectionResult = null else RESULT_RECORDED
  update installs[install] { stage: 'complete', inspectionResult: result, inspectionNote: note, inspectionRecordedAt: now, inspectionRecordedBy: viewer, overdue: false }

job enforceDeadlines():
  for i in installs:
    if i.stage = 'quote' and i.quoteDeadline <= now:
      update installs[i.id] { stage: 'closed' }
    if i.installedAt != null and i.inspectionDue != null and i.inspectionDue <= now and i.inspectionResult = null and not i.overdue:
      update installs[i.id] { overdue: true }
schedule deadlineSweep every 1m: enforceDeadlines
