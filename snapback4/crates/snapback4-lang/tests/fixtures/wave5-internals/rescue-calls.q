-- Lane 082's first attempt (wave 5): read through a parent whose audience column is reassigned.
-- Development cast; role grants are provisioned by trusted seed/admin tooling.
use personas alice, bob, cara

table roles:
  principal: principal
  role: enum('caller', 'dispatcher', 'rescuer')
  name: text 1..80
  unique principal
  immutable principal
  read <- allow
  online only

table reports:
  caller: principal
  species: text 2..80
  location: text 5..200
  details: text 10..1000
  urgency: enum('urgent', 'routine')
  status: enum('reported', 'assigned', 'resolved') default 'reported'
  assignedTo: principal ?
  reportedAt: time default now
  immutable caller, species, location, details, urgency, reportedAt
  read <- .caller = viewer or .assignedTo = viewer or exists roles[viewer, role = 'dispatcher']
  insert <- .caller = viewer and exists roles[viewer, role = 'caller'] and .status = 'reported' and .assignedTo = null
  update <- exists roles[viewer, role = 'dispatcher'] or .assignedTo = viewer
  online only

table outcomes:
  report: reports
  rescuer: principal
  result: enum('released', 'rehabilitation', 'deceased')
  notes: text 10..1000
  loggedAt: time default now
  unique report
  immutable report, rescuer, result, notes, loggedAt
  read through .report
  insert <- .rescuer = viewer and .report.assignedTo = viewer and .report.status = 'assigned' and exists roles[viewer, role = 'rescuer']
  online only

query myRole():
  return roles[principal = viewer]

query rescuers(c: cursor ?):
  return roles where .role = 'rescuer' first 50 by .name after c

query listReports(c: cursor ?):
  return reports last 30 by .reportedAt after c

query reportDetails(report: reports):
  return reports[report]

query outcomeHistory(report: reports):
  return outcomes where .report = report first 1 by .id

mutation reportAnimal(species: text 2..80, location: text 5..200, details: text 10..1000, urgency: enum('urgent', 'routine')):
  require exists roles[viewer, role = 'caller'] else NOT_CALLER 'Only callers can submit a report.'
  return insert reports { caller: viewer, species, location, details, urgency }

mutation assignRescuer(report: reports, rescuer: principal):
  require exists roles[viewer, role = 'dispatcher'] else NOT_DISPATCHER 'Only dispatchers can assign rescuers.'
  incident = reports[report] ! else NOT_FOUND
  require incident.status != 'resolved' else ALREADY_RESOLVED 'This report is already resolved.'
  require exists roles[rescuer, role = 'rescuer'] else NOT_RESCUER 'Choose a registered rescuer.'
  update reports[report] { assignedTo: rescuer, status: 'assigned' }
  return null

mutation recordOutcome(report: reports, result: enum('released', 'rehabilitation', 'deceased'), notes: text 10..1000):
  require exists roles[viewer, role = 'rescuer'] else NOT_RESCUER 'Only rescuers can log outcomes.'
  incident = reports[report] ! else NOT_FOUND
  require incident.assignedTo = viewer else NOT_ASSIGNED 'This report is assigned to another rescuer.'
  require incident.status = 'assigned' else NOT_ACTIVE 'Only assigned reports can be resolved.'
  outcome = insert outcomes { report, rescuer: viewer, result, notes }
  update reports[report] { status: 'resolved' }
  return outcome
