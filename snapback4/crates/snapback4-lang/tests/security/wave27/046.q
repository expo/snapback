-- Sump Pump Repairs: a plumbing company repairs and replaces basement sump pumps.
-- Roles: dispatcher (opens jobs), customer (own jobs/invoices only),
-- plumber (live dispatch board, booked -> onsite -> pump work completed -> tested),
-- manager / service manager (only role that may approve a backup-pump
-- install when the customer asked for repair only, recording consent).
-- Time rules: a failed pump in a flooding basement must be visited within
-- one day of the call or it is flagged urgent; parts carry a one-year
-- warranty from the repair date.
use identity password

table roles:
  principal: principal
  role: enum('customer', 'plumber', 'dispatcher', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'plumber', 'dispatcher', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

table jobs:
  customer: principal
  dispatcher: principal
  plumber: principal ?
  requested: enum('repair', 'replace')
  status: enum('booked', 'onsite', 'pump work completed', 'tested')
  failedPump: bool
  flooding: bool
  calledAt: time default now
  visitedAt: time ?
  quotedPrice: money USD
  pitPhoto: image <=5000000
  pumpPhoto: image <=5000000
  immutable customer, dispatcher, requested, calledAt, quotedPrice, pitPhoto, pumpPhoto
  read <- .customer = viewer or exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'dispatcher']
  update <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'manager']
  delete <- deny
  online only

table parts:
  job: jobs on delete cascade
  customer: principal
  name: text 1..80
  installedAt: time default now
  immutable job, customer, name, installedAt
  read <- .customer = viewer or exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'manager']
  update <- deny
  delete <- deny
  online only

table invoices:
  job: jobs on delete cascade
  customer: principal
  amount: money USD
  issuedAt: time default now
  immutable job, customer, amount, issuedAt
  read <- .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
  update <- deny
  delete <- deny
  online only

table backupApprovals:
  job: jobs on delete cascade
  customer: principal
  consent: text 1..500
  approvedBy: principal
  approvedAt: time default now
  unique job
  immutable job, customer, consent, approvedBy, approvedAt
  read <- .customer = viewer or exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'manager']
  update <- deny
  delete <- deny
  online only

query myJobs(c: cursor ?):
  return jobs where .customer = viewer last 50 by .calledAt after c

query dispatchBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return jobs last 50 by .calledAt after c

query urgentJobs(c: cursor ?):
  require exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return jobs where .failedPump = true and .flooding = true and .status = 'booked' and .calledAt < now - 24h last 50 by .calledAt after c

query jobDetail(job: jobs):
  return jobs[job]

query myInvoices(c: cursor ?):
  return invoices where .customer = viewer last 50 by .issuedAt after c

query jobInvoices(job: jobs, c: cursor ?):
  return invoices where .job = job last 50 by .issuedAt after c

query jobParts(job: jobs, c: cursor ?):
  return parts where .job = job last 50 by .installedAt after c

query warrantyStatus(part: parts):
  p = parts[part] ! else NOT_FOUND
  return { part: p, expiresAt: p.installedAt + 365d, covered: p.installedAt + 365d > now }

query backupStatus(job: jobs):
  return backupApprovals[job]

mutation openJob(customer: principal, requested: enum('repair', 'replace'), failedPump: bool, flooding: bool, quotedPrice: money USD, pitPhoto: image <=5000000, pumpPhoto: image <=5000000):
  require exists roles[principal = viewer, role = 'dispatcher'] else NOT_DISPATCHER
  return insert jobs { customer, dispatcher: viewer, requested, status: 'booked', failedPump, flooding, quotedPrice, pitPhoto, pumpPhoto }

mutation assignPlumber(job: jobs, plumber: principal):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager'] else NOT_OFFICE
  j = jobs[job] ! else NOT_FOUND
  update jobs[job] { plumber }
  return null

mutation updateStatus(job: jobs, status: enum('booked', 'onsite', 'pump work completed', 'tested')):
  require exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  if j.status = 'booked':
    require status = 'onsite' or status = 'booked' else BAD_TRANSITION 'Jobs move booked to on site to pump work completed to tested.'
  else if j.status = 'onsite':
    require status = 'pump work completed' or status = 'onsite' else BAD_TRANSITION 'Jobs move booked to on site to pump work completed to tested.'
  else if j.status = 'pump work completed':
    require status = 'tested' or status = 'pump work completed' else BAD_TRANSITION 'Jobs move booked to on site to pump work completed to tested.'
  else:
    require status = 'tested' else BAD_TRANSITION 'A tested job is closed.'
  if j.status != status and (j.status = 'pump work completed' or status = 'pump work completed'):
    require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER 'Only the service manager may move a job into or out of pump work completed.'
  if status = 'onsite' and j.status = 'booked':
    update jobs[job] { status, visitedAt: now }
  else:
    update jobs[job] { status }
  return null

mutation installPart(job: jobs, name: text 1..80):
  require exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  return insert parts { job, customer: j.customer, name }

mutation createInvoice(job: jobs, amount: money USD):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager'] else NOT_OFFICE
  j = jobs[job] ! else NOT_FOUND
  return insert invoices { job, customer: j.customer, amount }

mutation approveBackup(job: jobs, consent: text 1..500):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  j = jobs[job] ! else NOT_FOUND
  require j.requested = 'repair' else NOT_REPAIR_ONLY 'Backup approval applies only when the customer asked for a repair.'
  return insert backupApprovals { job, customer: j.customer, consent, approvedBy: viewer }

-- Privacy intent, stated independently from the rules above.
-- Customers see only their own jobs and invoices; plumbers see the live
-- dispatch board; only the service manager approves backup installs.
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant jobs.read only .customer = viewer or exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
invariant jobs.insert only exists roles[principal = viewer, role = 'dispatcher']
invariant invoices.read only .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
invariant parts.read only .customer = viewer or exists roles[principal = viewer, role = 'plumber'] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'manager']
invariant backupApprovals.insert only exists roles[principal = viewer, role = 'manager']

-- v2 migration: the 'replaced' stage was renamed to 'pump work completed'.
-- Existing 'replaced' rows adopt the new value; every other row keeps its
-- stage, and the old spelling stays readable through the reverse projection.
backfill jobs migrateStatus(status: enum('booked', 'onsite', 'replaced', 'tested')): {status: 'pump work completed' if status = 'replaced' else status}
down jobs oldStatus(status: enum('booked', 'onsite', 'pump work completed', 'tested')): {status: 'replaced' if status = 'pump work completed' else status}
