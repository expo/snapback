-- Furnace Repair Calls.
-- Roles: dispatcher opens jobs, customers see only their own jobs/invoices,
-- technicians work the live dispatch board, service managers approve replacements.
use identity password

table roles:
  principal: principal
  role: enum('dispatcher', 'customer', 'technician', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table jobs:
  customer: principal
  dispatcher: principal
  status: enum('booked', 'on_site', 'replaced', 'tested') default 'booked'
  requested: enum('repair', 'replace') default 'repair'
  replacementApproved: bool default false
  consent: text <=500 ?
  furnacePhoto: image <=5000000
  thermostatPhoto: image <=5000000
  quotedPrice: money USD
  failedFurnace: bool default false
  freezingHome: bool default false
  callAt: time default now
  firstVisitAt: time ?
  repairedAt: time ?
  immutable customer, callAt
  cap 500 by customer
  read <- .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'dispatcher']
  update <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
  online only

table invoices:
  job: jobs
  customer: principal
  amount: money USD
  repairAt: time default now
  immutable job, customer
  cap 100 by job
  read <- .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
  online only

-- Operator roster provisioning (staging recipe: only the local operator bootstraps roles).
mutation provision(principal: principal, role: enum('dispatcher', 'customer', 'technician', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

-- Dispatcher opens a job with furnace + thermostat photos and the quoted price.
mutation openJob(customer: principal, furnacePhoto: image <=5000000, thermostatPhoto: image <=5000000, quotedPrice: money USD, failedFurnace: bool, freezingHome: bool, requested: enum('repair', 'replace')):
  require exists roles[principal = viewer, role = 'dispatcher'] else NOT_DISPATCHER
  return insert jobs { customer, dispatcher: viewer, requested, furnacePhoto, thermostatPhoto, quotedPrice, failedFurnace, freezingHome, callAt: now }

-- A booked job moves on site when the technician first visits.
mutation recordVisit(job: jobs):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'booked' else BAD_TRANSITION
  update jobs[job] { status: 'on_site', firstVisitAt: now }
  return null

-- A furnace is replaced (and the repair date stamped) only with manager
-- approval when the customer asked for a repair only.
mutation recordReplaced(job: jobs):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'on_site' else BAD_TRANSITION
  require j.requested = 'replace' or j.replacementApproved else NEEDS_APPROVAL
  update jobs[job] { status: 'replaced', repairedAt: now }
  return null

-- A replaced furnace is tested to finish the job.
mutation recordTested(job: jobs):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'replaced' else BAD_TRANSITION
  update jobs[job] { status: 'tested' }
  return null

-- Only the service manager approves installing a new furnace when the
-- customer asked for a repair only, recording the customer's consent.
mutation approveReplacement(job: jobs, consent: text 1..500):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  j = jobs[job] ! else NOT_FOUND
  require j.requested = 'repair' else NOT_NEEDED
  require not j.replacementApproved else ALREADY_APPROVED
  update jobs[job] { replacementApproved: true, consent }
  return null

-- Staff invoices a finished (or in-progress) job; the customer is copied from the job.
mutation createInvoice(job: jobs, amount: money USD):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  return insert invoices { job, customer: j.customer, amount, repairAt: now }

query myRole():
  return roles[principal = viewer]

-- Customers see only their own jobs.
query myJobs(c: cursor ?):
  return jobs where .customer = viewer last 50 by .id after c

-- The live dispatch board: staff only.
query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return jobs last 50 by .id after c

-- Failed furnaces in freezing homes not visited within one day of the call.
query urgentJobs(c: cursor ?):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return jobs where .failedFurnace = true and .freezingHome = true and .callAt <= now - 24h and (.firstVisitAt = null or .firstVisitAt > .callAt + 24h) last 50 by .id after c

query jobDetail(job: jobs):
  return jobs[job]

query myInvoices(c: cursor ?):
  return invoices where .customer = viewer last 50 by .id after c

query jobInvoices(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  return invoices where .job = job last 50 by .id after c

-- Parts carry a one-year warranty from the repair date.
query warrantyFor(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  return { repairedAt: j.repairedAt, warrantyUntil: j.repairedAt + 365d if j.repairedAt != null else null, underWarranty: j.repairedAt != null and now <= j.repairedAt + 365d }

-- Spec intent, stated separately from enforcement.
invariant roles.read only .principal = viewer
invariant jobs.read only .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
invariant jobs.insert only exists roles[principal = viewer, role = 'dispatcher']
invariant invoices.read only .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
