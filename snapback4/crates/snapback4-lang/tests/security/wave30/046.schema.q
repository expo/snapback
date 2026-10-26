use identity password

table roles:
  principal: principal
  role: enum('restaurant', 'dispatcher', 'technician', 'manager')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'technician']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('restaurant', 'dispatcher', 'technician', 'manager'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal = principal] { principal, role, name }
query myRole():
  return roles[principal = viewer]
query directory(c: cursor ?):
  require staff() else STAFF_ONLY
  return roles last 100 by .id after c
fn staff(): exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
fn dispatcher(): exists roles[principal = viewer, role = 'dispatcher']
fn technician(): exists roles[principal = viewer, role = 'technician']
fn manager(): exists roles[principal = viewer, role = 'manager']
fn anniversary(t: time):
  candidate = monthStart(month(t) + 12) + (t - monthStart(month(t)))
  limit = monthStart(month(t) + 13)
  return candidate if candidate < limit else limit - 1d + (t % 1d)

table jobs:
  restaurant: principal
  restaurantName: text 1..80
  technician: principal
  openedBy: principal
  title: text 3..120
  equipment: enum('cooler', 'freezer')
  compressorPhoto: image <=5000000
  thermometerPhoto: image <=5000000
  quoteCents: int 1..10000000
  calledAt: time
  foodAtRisk: bool
  repairOnly: bool
  stage: enum('booked', 'on_site', 'replaced', 'tested') default 'booked'
  visitedAt: time ?
  compressorApprovedBy: principal ?
  consent: text 10..1000 ?
  consentAt: time ?
  newCompressor: bool default false
  parts: text 3..500 ?
  repairedAt: time ?
  warrantyUntil: time ?
  testNotes: text 3..500 ?
  read <- .restaurant = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'dispatcher'] and .openedBy = viewer and exists roles[principal = .restaurant, role = 'restaurant'] and exists roles[principal = .technician, role = 'technician']
  update <- (exists roles[principal = viewer, role = 'technician'] and .technician = viewer) or exists roles[principal = viewer, role = 'manager']
  immutable restaurant, restaurantName, technician, openedBy, title, equipment, compressorPhoto, thermometerPhoto, quoteCents, calledAt, foodAtRisk, repairOnly
  online only

table invoices:
  job: jobs
  restaurant: principal
  amountCents: int 1..10000000
  issuedAt: time
  unique job
  read <- .restaurant = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'technician'] and exists jobs[.job, technician = viewer, restaurant = .restaurant, stage = 'tested', quoteCents = .amountCents]
  immutable job, restaurant, amountCents, issuedAt
  online only

table warrantyRequests:
  job: jobs
  restaurant: principal
  note: text 10..500
  requestedAt: time
  unique job
  read <- .restaurant = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'technician']
  insert <- .restaurant = viewer and exists jobs[.job, restaurant = viewer, stage = 'tested']
  online only

query listJobs(c: cursor ?):
  if staff():
    return jobs last 50 by .id after c { id, restaurant, restaurantName, technician, title, equipment, quoteCents, calledAt, foodAtRisk, stage, visitedAt, urgent: .foodAtRisk and .visitedAt = null and now >= .calledAt + 1d, warrantyUntil }
  return jobs where .restaurant = viewer last 50 by .id after c { id, restaurant, restaurantName, technician, title, equipment, quoteCents, calledAt, foodAtRisk, stage, visitedAt, urgent: .foodAtRisk and .visitedAt = null and now >= .calledAt + 1d, warrantyUntil }
query jobDetail(job: jobs):
  return jobs[job]
query listInvoices(c: cursor ?):
  if dispatcher() or manager():
    return invoices last 50 by .id after c
  return invoices where .restaurant = viewer last 50 by .id after c
query warrantyStatus(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  return { until: j.warrantyUntil, active: j.warrantyUntil != null and now < j.warrantyUntil, request: warrantyRequests[job = job] }
mutation openJob(restaurant: principal, technician: principal, title: text 3..120, equipment: enum('cooler', 'freezer'), compressorPhoto: image <=5000000, thermometerPhoto: image <=5000000, quoteCents: int 1..10000000, calledAt: time, foodAtRisk: bool, repairOnly: bool):
  require dispatcher() else DISPATCHER_ONLY
  require exists roles[principal = restaurant, role = 'restaurant'] else RESTAURANT_REQUIRED
  require exists roles[principal = technician, role = 'technician'] else TECHNICIAN_REQUIRED
  require calledAt <= now and calledAt >= now - 30d else INVALID_CALL_TIME
  r = roles[principal = restaurant] ! else NOT_FOUND
  return insert jobs { restaurant, restaurantName: r.name, technician, openedBy: viewer, title, equipment, compressorPhoto, thermometerPhoto, quoteCents, calledAt, foodAtRisk, repairOnly }
mutation arrive(job: jobs):
  require technician() else TECHNICIAN_ONLY
  j = jobs[job] ! else NOT_FOUND
  require j.technician = viewer else ASSIGNED_TECHNICIAN_ONLY
  require j.stage = 'booked' else INVALID_STAGE
  update jobs[job] { stage: 'on_site', visitedAt: now }
mutation approveCompressor(job: jobs, consent: text 10..1000):
  require manager() else MANAGER_ONLY
  j = jobs[job] ! else NOT_FOUND
  require j.stage = 'on_site' else INVALID_STAGE
  require j.repairOnly else APPROVAL_NOT_NEEDED
  require j.compressorApprovedBy = null else ALREADY_APPROVED
  update jobs[job] { compressorApprovedBy: viewer, consent, consentAt: now }
mutation replaceParts(job: jobs, parts: text 3..500, newCompressor: bool):
  require technician() else TECHNICIAN_ONLY
  j = jobs[job] ! else NOT_FOUND
  require j.technician = viewer else ASSIGNED_TECHNICIAN_ONLY
  require j.stage = 'on_site' else INVALID_STAGE
  require not newCompressor or not j.repairOnly or j.compressorApprovedBy != null else MANAGER_CONSENT_REQUIRED
  update jobs[job] { stage: 'replaced', parts, newCompressor }
mutation finishTest(job: jobs, testNotes: text 3..500):
  require technician() else TECHNICIAN_ONLY
  j = jobs[job] ! else NOT_FOUND
  require j.technician = viewer else ASSIGNED_TECHNICIAN_ONLY
  require j.stage = 'replaced' else INVALID_STAGE
  update jobs[job] { stage: 'tested', repairedAt: now, warrantyUntil: anniversary(now), testNotes }
  return insert invoices { job, restaurant: j.restaurant, amountCents: j.quoteCents, issuedAt: now }
mutation requestWarranty(job: jobs, note: text 10..500):
  j = jobs[job] ! else NOT_FOUND
  require j.restaurant = viewer else RESTAURANT_ONLY
  require j.stage = 'tested' and j.warrantyUntil != null else REPAIR_REQUIRED
  require now < j.warrantyUntil else WARRANTY_EXPIRED
  require not exists warrantyRequests[job = job] else ALREADY_REQUESTED
  return insert warrantyRequests { job, restaurant: viewer, note, requestedAt: now }

invariant jobs.read only .restaurant = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
invariant invoices.read only .restaurant = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
invariant roles.read only .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
invariant roles.provision only viewer = 'service:operator'
invariant jobs.approveCompressor only exists roles[principal = viewer, role = 'manager']
invariant jobs.arrive only .technician = viewer and exists roles[principal = viewer, role = 'technician']
invariant jobs.replaceParts only .technician = viewer and exists roles[principal = viewer, role = 'technician']
invariant jobs.finishTest only .technician = viewer and exists roles[principal = viewer, role = 'technician']
invariant warrantyRequests.read only .restaurant = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
