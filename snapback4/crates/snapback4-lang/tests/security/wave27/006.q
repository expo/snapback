-- Microscope Overhaul Jobs.
-- An optical shop overhauls lab and school microscopes. The intake clerk logs
-- each microscope with photos of its objectives and fungus spots plus the
-- quoted overhaul price. A microscope must be overhauled within 20 days of
-- arrival (computed `delayed` flag). The customer has 30 days after return to
-- report a focusing fault for a free re-service. Customers see only their own
-- microscopes and invoices; technicians run the live service board
-- (teardown -> cleaning -> alignment -> optical testing -> returned); only the
-- service director approves a damaged-objective replacement with the
-- customer's written consent. Only the service director may move a microscope
-- out of optical testing; technicians carry out the testing itself.
use identity password

table roles:
  principal: principal
  role: enum('clerk', 'customer', 'technician', 'director')
  unique principal
  immutable principal
  -- Everyone reads their own row; staff can read the roster so the clerk can
  -- pick the owning customer at intake (rule probes see every row).
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'technician']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table microscopes:
  owner: principal
  model: text 1..80
  serial: text 1..40
  quotedPrice: money USD
  arrivalAt: time default now
  status: enum('intake', 'teardown', 'cleaning', 'alignment', 'optical testing', 'returned') default 'intake'
  objectivePhoto: image <=5000000
  fungusPhoto: image <=5000000
  returnedAt: time ?
  unique serial else SERIAL_TAKEN 'This serial number is already logged.'
  immutable owner, arrivalAt, quotedPrice, objectivePhoto, fungusPhoto
  -- Customers see only their own; all staff see every job.
  read <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'clerk']
  update <- exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'director']
  online only

table invoices:
  microscope: microscopes
  owner: principal
  amount: money USD
  issuedAt: time default now
  unique microscope
  immutable microscope, owner, amount, issuedAt
  -- Customers see only their own invoices; clerks and directors handle
  -- billing. Technicians run the service board, not billing.
  read <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'clerk']
  online only

table objectiveApprovals:
  microscope: microscopes
  reason: text 10..500
  consent: text 10..500
  approvedBy: principal
  approvedAt: time default now
  unique microscope else ALREADY_APPROVED 'An objective replacement was already approved for this microscope.'
  immutable microscope, reason, consent, approvedBy, approvedAt
  read <- .microscope.owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'director']
  online only

table faultReports:
  microscope: microscopes
  owner: principal
  description: text 10..1000
  reportedAt: time default now
  accepted: bool default false
  immutable microscope, owner, description, reportedAt
  read <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'director']
  insert <- .owner = viewer
  update <- exists roles[viewer, role = 'technician']
  online only

-- Shape of one job card, with the 20-day delay flag computed against the
-- server clock: a job is delayed when it is (or was, at return) overhauled
-- more than 20 days after arrival.
shape jobCard = { id, owner, model, serial, quotedPrice, arrivalAt, status, returnedAt, delayed: (.returnedAt ?? now) > .arrivalAt + 20d }

mutation provision(principal: principal, role: enum('clerk', 'customer', 'technician', 'director')):
  require viewer = 'service:operator' else NOT_OPERATOR 'Only the service operator may provision roles.'
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query customers(c: cursor ?):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'director'] else NOT_STAFF 'Only shop staff may list customers.'
  return roles where .role = 'customer' last 50 by .id after c { principal, role }

query board(c: cursor ?):
  if exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'director']:
    return microscopes last 50 by .arrivalAt after c jobCard
  return microscopes where .owner = viewer last 50 by .arrivalAt after c jobCard

query microscopeDetail(scope: microscopes):
  m = microscopes[scope] ! else NOT_FOUND
  return m jobCard

query invoices(c: cursor ?):
  require not exists roles[viewer, role = 'technician'] else TECH_NO_INVOICES 'Technicians run the service board, not billing.'
  if exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'director']:
    return invoices last 50 by .issuedAt after c
  return invoices where .owner = viewer last 50 by .issuedAt after c

query reportsFor(scope: microscopes, c: cursor ?):
  return faultReports where .microscope = scope last 50 by .reportedAt after c

query approvalsFor(scope: microscopes):
  return objectiveApprovals[microscope = scope]

query photosFor(scope: microscopes):
  m = microscopes[scope] ! else NOT_FOUND
  return { objective: m.objectivePhoto, fungus: m.fungusPhoto }

mutation intake(owner: principal, model: text 1..80, serial: text 1..40, quotedPrice: money USD, objectivePhoto: image <=5000000, fungusPhoto: image <=5000000):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK 'Only intake clerks may log microscopes.'
  m = insert microscopes { owner, model, serial, quotedPrice, objectivePhoto, fungusPhoto }
  insert invoices { microscope: m, owner, amount: quotedPrice }
  return m jobCard

-- Only the service director moves a microscope out of optical testing; every
-- other board step stays technician-only.
mutation advanceStatus(scope: microscopes, next: enum('teardown', 'cleaning', 'alignment', 'optical testing', 'returned')):
  m = microscopes[scope] ! else NOT_FOUND
  require m.status != 'returned' else ALREADY_RETURNED 'This microscope was already returned; reopen it through an accepted fault report.'
  require m.status != 'optical testing' or exists roles[viewer, role = 'director'] else NOT_DIRECTOR 'Only the service director may move a microscope out of optical testing.'
  require m.status = 'optical testing' or exists roles[viewer, role = 'technician'] else NOT_TECHNICIAN 'Only technicians move jobs on the service board.'
  require next = 'teardown' and m.status = 'intake' or next = 'cleaning' and m.status = 'teardown' or next = 'alignment' and m.status = 'cleaning' or next = 'optical testing' and m.status = 'alignment' or next = 'returned' and m.status = 'optical testing' else BAD_TRANSITION 'Jobs move one step: intake, teardown, cleaning, alignment, optical testing, returned.'
  update microscopes[m] { status: next, returnedAt: now if next = 'returned' else m.returnedAt }
  return null

mutation approveObjective(scope: microscopes, reason: text 10..500, consent: text 10..500):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR 'Only the service director may approve an objective replacement.'
  m = microscopes[scope] ! else NOT_FOUND
  require m.status != 'returned' else ALREADY_RETURNED 'This microscope was already returned.'
  return insert objectiveApprovals { microscope: scope, reason, consent, approvedBy: viewer }

mutation reportFault(scope: microscopes, description: text 10..1000):
  m = microscopes[scope] ! else NOT_FOUND
  require m.owner = viewer else NOT_OWNER 'Only the owning customer may report a focusing fault.'
  require m.status = 'returned' else NOT_RETURNED 'Focusing faults can only be reported after return.'
  cutoff = (m.returnedAt ?? now) + 30d
  require now <= cutoff else WINDOW_CLOSED 'The 30-day free re-service window has closed.'
  return insert faultReports { microscope: scope, owner: viewer, description }

mutation acceptFault(report: faultReports):
  require exists roles[viewer, role = 'technician'] else NOT_TECHNICIAN 'Only technicians accept fault reports for re-service.'
  r = faultReports[report] ! else NOT_FOUND
  m = microscopes[r.microscope] ! else NOT_FOUND
  require m.status = 'returned' else NOT_RETURNED 'Only a returned microscope can re-enter service.'
  require not r.accepted else ALREADY_ACCEPTED 'This fault report was already accepted for re-service.'
  update faultReports[r] { accepted: true }
  update microscopes[m] { status: 'teardown' }
  return null

-- Privacy intent, stated independently from the enforcement rules above.
invariant microscopes.read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'director']
invariant microscopes.insert only exists roles[viewer, role = 'clerk']
invariant microscopes.update only exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'director']
invariant invoices.read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'director']
invariant invoices.insert only exists roles[viewer, role = 'clerk']
invariant objectiveApprovals.insert only exists roles[viewer, role = 'director']
invariant faultReports.insert only .owner = viewer

-- v2 data migration: the 'testing' stage is renamed to 'optical testing'.
-- Existing rows at 'testing' move to 'optical testing', keeping every other
-- column; rows at any other stage keep their stage.
backfill microscopes status(status: enum('intake', 'teardown', 'cleaning', 'alignment', 'testing', 'returned')):
  {status: 'optical testing' if status = 'testing' else status}

-- Truthful old view: under v1, 'optical testing' reads back as 'testing' so
-- rollback keeps every row visible with its pre-v2 spelling.
down microscopes statusView(status: enum('intake', 'teardown', 'cleaning', 'alignment', 'optical testing', 'returned')):
  {status: 'testing' if status = 'optical testing' else status}
