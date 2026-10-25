use identity password

-- Roles: owner, scheduler, technician, assistant, headTech.
-- Only the local operator (service:operator seat) may grant roles, so no
-- caller can promote themselves. Everyone reads their own row; schedulers,
-- technicians and the head technician also read the roster so they can find
-- owner principals when registering tubs.
table roles:
  principal: principal
  role: enum('owner', 'scheduler', 'technician', 'assistant', 'headTech')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'headTech'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- A hot tub at a home or a gym. lastServicedAt is the anchor for the
-- 12-month re-service rule; it is set at registration and refreshed when a
-- visit reaches refilled.
table hotTubs:
  owner: principal
  label: text 1..80
  siteKind: enum('home', 'gym')
  lastServicedAt: time
  immutable owner
  read <- .owner = viewer or exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'headTech']
  insert <- exists roles[viewer, role = 'scheduler']
  update <- exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'headTech']
  cap 500 by owner
  online only

-- One servicing visit. The scheduler opens it with the three required
-- photos and the quoted fee; technicians move status
-- booked -> drained -> repaired -> refilled. A cracked shell is reported
-- with reportCrack and must be quoted within ten days via quoteCrack.
table visits:
  hotTub: hotTubs
  owner: principal
  scheduledAt: time
  status: enum('booked', 'drained', 'repaired', 'refilled')
  shellPhoto: image <=5000000
  pumpPhoto: image <=5000000
  panelPhoto: image <=5000000
  proposedServiceCharge: money USD renamed from quotedFee
  shellCracked: bool default false
  crackFoundAt: time ?
  crackQuote: money USD ?
  crackQuotedAt: time ?
  immutable hotTub, owner
  read <- .owner = viewer or exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'headTech']
  insert <- exists roles[viewer, role = 'scheduler']
  update <- exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'headTech']
  cap 500 by hotTub
  online only

-- Head-technician-only approval to take a tub to the workshop for a shell
-- replacement. The owner's written consent is recorded as text.
table workshopApprovals:
  hotTub: hotTubs
  owner: principal
  consentText: text 1..500
  approvedBy: principal
  approvedAt: time
  immutable hotTub, owner, consentText, approvedBy, approvedAt
  read <- .owner = viewer or exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'headTech']
  insert <- exists roles[viewer, role = 'headTech']
  online only

-- Privacy intent, stated separately from the rules.
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'headTech']
invariant hotTubs.read only .owner = viewer or exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'assistant'] or exists roles[principal = viewer, role = 'headTech']
invariant visits.read only .owner = viewer or exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'assistant'] or exists roles[principal = viewer, role = 'headTech']
invariant workshopApprovals.read only .owner = viewer or exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'assistant'] or exists roles[principal = viewer, role = 'headTech']

query myRole():
  return roles[viewer]

query ownersList(c: cursor ?):
  require exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'headTech'] else NOT_STAFF
  return roles where .role = 'owner' first 50 by .id after c

query myTubs(c: cursor ?):
  return hotTubs where .owner = viewer first 50 by .id after c

query allTubs(c: cursor ?):
  require exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'headTech'] else NOT_STAFF
  return hotTubs last 50 by .id after c

query tubDetail(tub: hotTubs):
  return hotTubs[tub]

query myVisits(c: cursor ?):
  return visits where .owner = viewer first 50 by .id after c

query routeBoard(c: cursor ?):
  require exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'headTech'] else NOT_STAFF
  return visits last 50 by .id after c

query visitDetail(visit: visits):
  return visits[visit]

query approvalsForTub(tub: hotTubs):
  return workshopApprovals where .hotTub = tub first 20 by .id

query overdueTubs(c: cursor ?):
  require exists roles[viewer, role = 'scheduler'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'headTech'] else NOT_STAFF
  return hotTubs where .lastServicedAt < now - 365d first 50 by .id after c

query cracksPendingQuote(c: cursor ?):
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'headTech'] else NOT_TECHNICIAN
  return visits where .shellCracked = true and .crackQuote = null first 50 by .id after c

mutation provision(principal: principal, role: enum('owner', 'scheduler', 'technician', 'assistant', 'headTech')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

mutation registerTub(owner: principal, label: text 1..80, siteKind: enum('home', 'gym'), lastServicedAt: time):
  require exists roles[viewer, role = 'scheduler'] else NOT_SCHEDULER
  require exists roles[principal = owner, role = 'owner'] else NOT_OWNER
  return insert hotTubs { owner, label, siteKind, lastServicedAt }

mutation openVisit(hotTub: hotTubs, scheduledAt: time, shellPhoto: image <=5000000, pumpPhoto: image <=5000000, panelPhoto: image <=5000000, proposedServiceCharge: money USD alias quotedFee):
  require exists roles[viewer, role = 'scheduler'] else NOT_SCHEDULER
  t = hotTubs[hotTub] ! else NOT_FOUND
  require scheduledAt <= t.lastServicedAt + 365d or (now > t.lastServicedAt + 365d and scheduledAt <= now + 30d) else VISIT_OUTSIDE_WINDOW 'The visit must fall within 12 months of the last service; an overdue tub must be rebooked within 30 days.'
  return insert visits { hotTub, owner: t.owner, scheduledAt, status: 'booked', shellPhoto, pumpPhoto, panelPhoto, proposedServiceCharge, shellCracked: false }

-- Only the head technician may change the proposed service charge after a
-- visit is opened; schedulers, assistants and owners cannot.
mutation updateProposedCharge(visit: visits, amount: money USD):
  require exists roles[viewer, role = 'headTech'] else NOT_HEADTECH
  v = visits[visit] ! else NOT_FOUND
  update visits[visit] { proposedServiceCharge: amount }
  return visits[visit]

mutation advanceVisit(visit: visits):
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'headTech'] else NOT_TECHNICIAN
  v = visits[visit] ! else NOT_FOUND
  require v.status != 'refilled' else ALREADY_DONE
  next = 'drained' if v.status = 'booked' else 'repaired' if v.status = 'drained' else 'refilled'
  update visits[visit] { status: next }
  if next = 'refilled':
    update hotTubs[v.hotTub] { lastServicedAt: now }
  return visits[visit]

mutation reportCrack(visit: visits):
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'headTech'] else NOT_TECHNICIAN
  v = visits[visit] ! else NOT_FOUND
  require v.shellCracked = false else ALREADY_REPORTED
  update visits[visit] { shellCracked: true, crackFoundAt: now }
  return visits[visit]

mutation quoteCrack(visit: visits, amount: money USD):
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'headTech'] else NOT_TECHNICIAN
  v = visits[visit] ! else NOT_FOUND
  require v.shellCracked else NO_CRACK
  require v.crackQuote = null else ALREADY_QUOTED
  require v.crackFoundAt != null and now <= v.crackFoundAt + 10d else QUOTE_LATE 'A cracked shell must be quoted within ten days of discovery.'
  update visits[visit] { crackQuote: amount, crackQuotedAt: now }
  return visits[visit]

mutation approveWorkshop(hotTub: hotTubs, consentText: text 1..500):
  require exists roles[viewer, role = 'headTech'] else NOT_HEADTECH
  t = hotTubs[hotTub] ! else NOT_FOUND
  return insert workshopApprovals { hotTub, owner: t.owner, consentText, approvedBy: viewer, approvedAt: now }
