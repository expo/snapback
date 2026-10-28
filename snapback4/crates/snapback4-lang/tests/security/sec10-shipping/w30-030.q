use identity password

table roles:
  principal: principal
  role: enum('dispatcher', 'customer', 'engineer', 'service_manager')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'engineer'] or exists roles[principal = viewer, role = 'service_manager'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  online only

mutation provision(principal: principal, role: enum('dispatcher', 'customer', 'engineer', 'service_manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query customers(c: cursor ?):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'service_manager'] else NOT_STAFF
  return roles where .role = 'customer' last 50 by .id after c

query engineers(c: cursor ?):
  require exists roles[principal = viewer, role = 'service_manager'] or exists roles[principal = viewer, role = 'dispatcher'] else NOT_STAFF
  return roles where .role = 'engineer' last 50 by .id after c

table studies:
  customer: principal
  siteKind: enum('office', 'venue', 'building_site')
  address: text 1..200
  price: money USD
  recordings: [file <=10000000] <=4 ?
  status: enum('booked', 'measured', 'reviewed', 'reported') default 'booked'
  measuredAt: time ?
  createdAt: time default now
  immutable customer, createdAt
  read <- .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'engineer'] or exists roles[principal = viewer, role = 'service_manager']
  insert <- exists roles[principal = viewer, role = 'dispatcher']
  update <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'engineer'] or exists roles[principal = viewer, role = 'service_manager']
  delete <- deny
  online only

table reports:
  study: studies
  customer: principal
  body: text 1..5000
  quoteAmount: money USD
  isLate: bool default false
  createdAt: time default now
  validUntil: time
  immutable study, customer, createdAt, validUntil
  read <- .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'engineer'] or exists roles[principal = viewer, role = 'service_manager']
  insert <- exists roles[principal = viewer, role = 'engineer'] or exists roles[principal = viewer, role = 'service_manager']
  update <- deny
  delete <- deny
  online only

table remeasurements:
  study: studies
  customer: principal
  reason: text 1..1000
  blamedEngineer: principal
  approvedBy: principal
  approvedAt: time default now
  immutable study, customer, reason, blamedEngineer, approvedBy, approvedAt
  read <- .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'engineer'] or exists roles[principal = viewer, role = 'service_manager']
  insert <- exists roles[principal = viewer, role = 'service_manager'] and exists roles[principal = .blamedEngineer, role = 'engineer']
  update <- deny
  delete <- deny
  online only

query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'engineer'] or exists roles[principal = viewer, role = 'service_manager']:
    return studies last 50 by .id after c
  return studies where .customer = viewer last 50 by .id after c

query studyById(study: studies):
  return studies[study]

query reportsFor(study: studies, c: cursor ?):
  return reports where .study = study last 20 by .id after c

query remeasurementsFor(study: studies, c: cursor ?):
  return remeasurements where .study = study last 20 by .id after c

query lateReports(c: cursor ?):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'engineer'] or exists roles[principal = viewer, role = 'service_manager'] else NOT_STAFF
  return reports where .isLate = true last 50 by .id after c

query quoteValid(report: reports):
  r = reports[report] ! else NOT_FOUND
  return now <= r.validUntil

mutation openStudy(customer: principal, siteKind: enum('office', 'venue', 'building_site'), address: text 1..200, price: money USD, recordings: [file <=10000000] <=4 ?):
  require exists roles[principal = viewer, role = 'dispatcher'] else NOT_DISPATCHER
  require exists roles[principal = customer, role = 'customer'] else NOT_CUSTOMER
  require price > 0 else BAD_PRICE
  return insert studies { customer, siteKind, address, price, recordings }

mutation markMeasured(study: studies):
  s = studies[study] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'engineer'] else NOT_ENGINEER
  require s.status = 'booked' else BAD_STATUS
  update studies[study] { status: 'measured', measuredAt: now }
  return null

mutation markReviewed(study: studies):
  s = studies[study] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'engineer'] else NOT_ENGINEER
  require s.status = 'measured' else BAD_STATUS
  update studies[study] { status: 'reviewed' }
  return null

mutation publishReport(study: studies, body: text 1..5000, quoteAmount: money USD):
  s = studies[study] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'engineer'] or exists roles[principal = viewer, role = 'service_manager'] else NOT_AUTHOR
  require s.status = 'measured' or s.status = 'reviewed' else BAD_STATUS
  require s.measuredAt != null else NOT_MEASURED
  require quoteAmount >= 0 else BAD_QUOTE
  late = now > s.measuredAt + 5d
  update studies[study] { status: 'reported' }
  return insert reports { study, customer: s.customer, body, quoteAmount, isLate: late, validUntil: now + 30d }

mutation approveRemeasurement(study: studies, reason: text 1..1000, blamedEngineer: principal):
  s = studies[study] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'service_manager'] else NOT_MANAGER
  require exists roles[principal = blamedEngineer, role = 'engineer'] else NOT_ENGINEER
  return insert remeasurements { study, customer: s.customer, reason, blamedEngineer, approvedBy: viewer }
