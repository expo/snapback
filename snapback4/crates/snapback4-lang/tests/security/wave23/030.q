-- Food Truck Permits: city health department permits for food trucks.
--
-- Roles: operator (truck owners), inspector (field inspections and the live
-- board), supervisor (environmental health supervisor: suspends permits and
-- approves operators with a past suspension, recording the reason).
-- Role rows are provisioned by the local operator (service:operator), the
-- same pattern as `guide staging`: signup alone grants no role.
use identity password

table roster:
  principal: principal
  role: enum('operator', 'inspector', 'supervisor')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('operator', 'inspector', 'supervisor')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roster[principal] { principal, role }

query myRole():
  return roster[viewer]

invariant roster.read only .principal = viewer or viewer = 'service:operator'
invariant roster.insert only viewer = 'service:operator'

-- Trucks belong to exactly one operator. activePermit points at the truck's
-- current permit once one is issued (maintained by approveApplication).
table trucks:
  owner: principal
  name: text 1..80
  licensePlate: text 1..16
  activePermit: permits ?
  unique licensePlate else PLATE_TAKEN
  immutable owner
  read <- .owner = viewer or exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  insert <- exists roster[viewer, role = 'operator']
  update <- exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  online only

mutation registerTruck(name: text 1..80, licensePlate: text 1..16):
  require exists roster[viewer, role = 'operator'] else NOT_OPERATOR
  return insert trucks { owner: viewer, name, licensePlate }

query myTrucks(c: cursor ?):
  return trucks where .owner = viewer first 50 by .id after c

query allTrucks(c: cursor ?):
  require exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor'] else NOT_STAFF
  return trucks first 50 by .id after c

invariant trucks.read only .owner = viewer or exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
invariant trucks.insert only exists roster[viewer, role = 'operator']

-- Each application must include interior photos, the fire extinguisher tag
-- photo and the permit fee: all three columns are required, so an
-- application row cannot exist without them.
table applications:
  truck: trucks
  owner: principal
  interiorPhotos: [image <=5000000] 1..4
  extinguisherTag: image <=5000000
  feeCents: int 1..100000000
  status: enum('applied', 'inspected', 'inspection recorded', 'approved', 'failed') default 'applied'
  failedAt: time default now
  lastPassed: bool default false
  createdAt: time default now
  immutable truck, owner, interiorPhotos, extinguisherTag, feeCents, createdAt
  read <- .owner = viewer or exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  insert <- exists roster[viewer, role = 'operator']
  update <- exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  online only

mutation submitApplication(truck: trucks, interiorPhotos: [image <=5000000] 1..4, extinguisherTag: image <=5000000, feeCents: int 1..100000000):
  require exists roster[viewer, role = 'operator'] else NOT_OPERATOR
  t = trucks[truck] ! else NOT_FOUND
  require t.owner = viewer else NOT_YOUR_TRUCK
  flag = operatorFlags[viewer]
  require flag = null or flag.suspended = false else OPERATOR_SUSPENDED
  return insert applications { truck, owner: viewer, interiorPhotos, extinguisherTag, feeCents }

query myApplications(c: cursor ?):
  return applications where .owner = viewer first 50 by .createdAt after c

-- The live board: every application as it moves applied -> inspection recorded ->
-- approved / failed. Staff only.
query board(c: cursor ?):
  require exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor'] else NOT_STAFF
  return applications first 50 by .createdAt after c

invariant applications.read only .owner = viewer or exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
invariant applications.insert only exists roster[viewer, role = 'operator']

-- v2 renamed the 'inspected' stage to 'inspection recorded'. The column still
-- admits the old value so that every historical row survives adoption and
-- rollback without dormancy; the migrateInspectionRecorded mutation below
-- moves every remaining 'inspected' row to the renamed stage (run after
-- deploy and after every forward), and no workflow mutation writes the old
-- value anymore. Rollback to a release without the renamed value projects
-- 'inspection recorded' back to 'inspected' instead of hiding rows.
down applications inspectedView(status: enum('applied', 'inspected', 'inspection recorded', 'approved', 'failed')): {status: 'inspected' if status = 'inspection recorded' else status}

-- One-shot data migration for the v2 rename. Supervisor-only. Moves a single
-- remaining 'inspected' application to 'inspection recorded'; callers page
-- the board until none remain.
mutation migrateInspectionRecorded(application: applications):
  require exists roster[viewer, role = 'supervisor'] else NOT_SUPERVISOR
  app = applications[application] ! else NOT_FOUND
  require app.status = 'inspected' else NOT_INSPECTED
  update applications[app.id] { status: 'inspection recorded' }
  return applications[app.id]

-- Inspections are written by inspectors (or supervisors). owner is the truck
-- owner's principal, denormalized so operators read their own reports and
-- staff read everything.
table inspections:
  truck: trucks
  application: applications ?
  permit: permits ?
  inspector: principal
  passed: bool
  notes: text <=2000 ?
  kind: enum('initial', 'reinspection', 'routine')
  inspectedAt: time default now
  owner: principal
  immutable truck, application, permit, inspector, passed, notes, kind, inspectedAt, owner
  read <- .owner = viewer or exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  insert <- exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  online only

-- First inspection of an application: applied -> inspection recorded.
mutation inspectApplication(application: applications, passed: bool, notes: text <=2000 ?):
  require exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor'] else NOT_INSPECTOR
  app = applications[application] ! else NOT_FOUND
  require app.status = 'applied' else NOT_APPLIED
  i = insert inspections { truck: app.truck, application: app.id, inspector: viewer, passed, notes, kind: 'initial', owner: app.owner }
  update applications[app.id] { status: 'inspection recorded', lastPassed: passed }
  return i

-- Reinspection of a failed application, only within ten days of the failure.
mutation reinspectApplication(application: applications, passed: bool, notes: text <=2000 ?):
  require exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor'] else NOT_INSPECTOR
  app = applications[application] ! else NOT_FOUND
  require app.status = 'failed' else NOT_FAILED
  require now <= app.failedAt + 10d else REINSPECTION_LATE
  i = insert inspections { truck: app.truck, application: app.id, inspector: viewer, passed, notes, kind: 'reinspection', owner: app.owner }
  update applications[app.id] { status: 'inspection recorded', lastPassed: passed }
  return i

-- Decision on an inspection-recorded application. Approval issues the permit, valid
-- 365 days; rejection marks it failed and starts the ten-day reinspection
-- window.
mutation approveApplication(application: applications):
  require exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor'] else NOT_INSPECTOR
  app = applications[application] ! else NOT_FOUND
  require app.status = 'inspection recorded' else NOT_INSPECTED
  require app.lastPassed else DECISION_CONFLICTS
  p = insert permits { truck: app.truck, owner: app.owner, application: app.id, issuedAt: now, expiresAt: now + 365d, status: 'active', flagged: false, failedAt: now }
  update applications[app.id] { status: 'approved' }
  update trucks[app.truck] { activePermit: p.id }
  return p

mutation rejectApplication(application: applications):
  require exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor'] else NOT_INSPECTOR
  app = applications[application] ! else NOT_FOUND
  require app.status = 'inspection recorded' else NOT_INSPECTED
  require not app.lastPassed else DECISION_CONFLICTS
  update applications[app.id] { status: 'failed', failedAt: now }
  return applications[app.id]

query myInspections(c: cursor ?):
  return inspections where .owner = viewer first 50 by .inspectedAt after c

query applicationInspections(application: applications, c: cursor ?):
  return inspections where .application = application first 50 by .inspectedAt after c

query permitInspections(permit: permits, c: cursor ?):
  return inspections where .permit = permit first 50 by .inspectedAt after c

invariant inspections.read only .owner = viewer or exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
invariant inspections.insert only exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']

-- Permits are issued on approval and live 365 days. A failed routine
-- inspection flags the permit; a passing reinspection within ten days
-- clears the flag, otherwise the daily sweep suspends it.
table permits:
  truck: trucks
  owner: principal
  application: applications
  issuedAt: time default now
  expiresAt: time
  failedAt: time default now
  flagged: bool default false
  status: enum('active', 'suspended', 'expired') default 'active'
  immutable truck, owner, application, issuedAt, expiresAt
  read <- .owner = viewer or exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  insert <- exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  update <- exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  online only

-- Routine inspection (or reinspection) of an active permit.
mutation inspectPermit(permit: permits, passed: bool, notes: text <=2000 ?):
  require exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor'] else NOT_INSPECTOR
  p = permits[permit] ! else NOT_FOUND
  require p.status = 'active' else PERMIT_NOT_ACTIVE
  require now < p.expiresAt else PERMIT_EXPIRED
  i = insert inspections { truck: p.truck, permit: p.id, inspector: viewer, passed, notes, kind: 'reinspection' if p.flagged else 'routine', owner: p.owner }
  update permits[p.id] { flagged: not passed, failedAt: now }
  return i

query myPermits(c: cursor ?):
  return permits where .owner = viewer first 50 by .issuedAt after c

query allPermits(c: cursor ?):
  require exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor'] else NOT_STAFF
  return permits first 50 by .issuedAt after c

invariant permits.read only .owner = viewer or exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']

-- Suspensions are written by the supervisor (recording the reason) or by
-- the daily sweep when the ten-day reinspection window lapses (reason
-- recorded, suspendedBy null for the automatic case).
table suspensions:
  permit: permits
  owner: principal
  reason: text 1..500
  suspendedBy: principal ?
  suspendedAt: time default now
  immutable permit, owner, reason, suspendedBy, suspendedAt
  read <- .owner = viewer or exists roster[viewer, role = 'supervisor']
  insert <- exists roster[viewer, role = 'supervisor']
  online only

mutation suspendPermit(permit: permits, reason: text 1..500):
  require exists roster[viewer, role = 'supervisor'] else NOT_SUPERVISOR
  p = permits[permit] ! else NOT_FOUND
  require p.status = 'active' else PERMIT_NOT_ACTIVE
  require now < p.expiresAt else PERMIT_EXPIRED
  update permits[p.id] { status: 'suspended', flagged: false }
  upsert operatorFlags[p.owner] { operator: p.owner, suspended: true }
  return insert suspensions { permit: p.id, owner: p.owner, reason, suspendedBy: viewer }

query mySuspensions(c: cursor ?):
  return suspensions where .owner = viewer first 50 by .suspendedAt after c

invariant suspensions.read only .owner = viewer or exists roster[viewer, role = 'supervisor']

-- An operator whose permit was suspended cannot apply again until the
-- supervisor approves them, recording the reason.
table operatorFlags:
  operator: principal
  suspended: bool default true
  unique operator
  immutable operator
  read <- .operator = viewer or exists roster[viewer, role = 'supervisor']
  insert <- exists roster[viewer, role = 'supervisor']
  update <- exists roster[viewer, role = 'supervisor']
  online only

table approvals:
  operator: principal
  reason: text 1..500
  approvedBy: principal
  approvedAt: time default now
  immutable operator, reason, approvedBy, approvedAt
  read <- .operator = viewer or exists roster[viewer, role = 'inspector'] or exists roster[viewer, role = 'supervisor']
  insert <- exists roster[viewer, role = 'supervisor']
  online only

mutation approveOperator(operator: principal, reason: text 1..500):
  require exists roster[viewer, role = 'supervisor'] else NOT_SUPERVISOR
  flag = operatorFlags[operator] ! else OPERATOR_UNKNOWN
  require flag.suspended else OPERATOR_NOT_SUSPENDED
  update operatorFlags[operator] { suspended: false }
  return insert approvals { operator, reason, approvedBy: viewer }

query myFlag():
  return operatorFlags[viewer]

query myApprovals(c: cursor ?):
  return approvals where .operator = viewer first 50 by .approvedAt after c

query flaggedOperators(c: cursor ?):
  require exists roster[viewer, role = 'supervisor'] else NOT_SUPERVISOR
  return operatorFlags where .suspended = true first 50 by .id after c

-- Daily sweep: suspend active flagged permits whose reinspection window
-- lapsed, and expire permits past their 365-day life.
job sweepPermits(periodStart: time, periodEnd: time):
  for p in permits:
    if p.status = 'active' and p.flagged and p.failedAt < periodEnd - 10d:
      update permits[p.id] { status: 'suspended', flagged: false }
      insert suspensions { permit: p.id, owner: p.owner, reason: 'No passing reinspection within ten days of the failed inspection.', suspendedAt: periodEnd }
      upsert operatorFlags[p.owner] { operator: p.owner, suspended: true }
    if p.status = 'active' and p.expiresAt <= periodEnd:
      update permits[p.id] { status: 'expired', flagged: false }

schedule dailySweep every 1d at 03:00: sweepPermits
