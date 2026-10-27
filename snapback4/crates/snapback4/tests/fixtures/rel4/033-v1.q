-- Bathtub Reglazing Jobs.
-- Customers see only their own jobs and invoices. Crews see the live job
-- board. Only the owner can approve reglazing a signed-off-but-leaking tub,
-- recording the customer's consent. Quotes lapse 14 days after issue;
-- missed chips must be reported within 7 days of the cure.
use identity password

-- Roster: one row per account. Only the local operator seat assigns roles;
-- signup alone grants nothing, and no caller can promote itself.
table roles:
  principal: principal
  role: enum('customer', 'crew', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'crew', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- Handles let a crew member attach a new job to the right customer account.
table profiles:
  principal: principal
  handle: text 3..20 format handle
  unique principal
  unique handle
  immutable principal
  public 'customer handles are discoverable so crews can attach jobs to accounts'
  insert <- .principal = viewer
  update <- .principal = viewer
  online only

mutation saveProfile(handle: text 3..20 format handle):
  upsert profiles[principal = viewer] { principal: viewer, handle }
  return null

query findCustomer(handle: text 3..20):
  return profiles[handle = handle]

query myProfile():
  return profiles[viewer]

-- The job pipeline: quoted -> booked -> stripping -> chip-repair -> sprayed
-- -> cured -> signed-off. A quote that is never accepted becomes lapsed
-- (mutation refusal immediately after the window; a daily sweep relabels it).
-- An owner-approved reglaze of a leaking signed-off tub returns it to booked.
table jobs:
  customer: principal
  address: text 1..200
  detail: text 1..500 ?
  priceCents: int 1..100000000
  status: enum('quoted', 'lapsed', 'booked', 'stripping', 'chip-repair', 'sprayed', 'cured', 'signed-off') default 'quoted'
  quotedAt: time default now
  acceptedAt: time ?
  curedAt: time ?
  signedOffAt: time ?
  immutable customer, quotedAt
  read <- .customer = viewer or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  update <- .customer = viewer or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  cap 500 by customer
  online only

-- Before photos of every chip and rust stain, taken at estimate time.
table jobPhotos:
  job: jobs
  photo: image <=10000000 ?
  caption: text 1..200 ?
  immutable job
  read through .job
  insert <- exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  cap 50 by job
  online only

-- Invoices are private to the job's customer and the owner; crews working
-- the board cannot read them.
table invoices:
  job: jobs
  customer: principal
  amountCents: int 1..100000000
  issuedAt: time default now
  paid: bool default false
  immutable job, customer, amountCents, issuedAt
  read <- .customer = viewer or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'owner']
  update <- exists roles[viewer, role = 'owner']
  cap 20 by job
  online only

-- A missed chip reported within 7 days of the cure earns a free return visit.
table chipReports:
  job: jobs
  reporter: principal
  detail: text 1..500
  reportedAt: time default now
  immutable job, reporter, reportedAt
  read through .job
  insert <- .reporter = viewer
  cap 20 by job
  online only

-- A tub the customer signed off as still leaking: only the owner may
-- approve reglazing it, and the report carries the customer's consent text.
table leakReports:
  job: jobs
  reporter: principal
  detail: text 1..500
  consent: text 1..300
  approved: bool default false
  approvedAt: time ?
  reportedAt: time default now
  immutable job, reporter, reportedAt, consent
  read through .job
  insert <- .reporter = viewer
  update <- exists roles[viewer, role = 'owner']
  cap 10 by job
  online only

-- Free return visits scheduled by the crew for reported missed chips.
table returnVisits:
  job: jobs
  report: chipReports
  customer: principal
  scheduledFor: time
  note: text 1..300 ?
  immutable job, report, customer
  read through .job
  insert <- exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  cap 20 by job
  online only

query myJobs(c: cursor ?):
  return jobs where .customer = viewer last 50 by .id after c

query board(c: cursor ?):
  require exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return jobs last 50 by .id after c

query jobDetail(job: jobs):
  return jobs[job]

query photosOf(job: jobs, c: cursor ?):
  return jobPhotos where .job = job last 50 by .id after c

query myInvoices(c: cursor ?):
  return invoices where .customer = viewer last 50 by .id after c

query jobInvoices(job: jobs, c: cursor ?):
  return invoices where .job = job last 20 by .id after c

query allInvoices(c: cursor ?):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  return invoices last 50 by .id after c

query reportsOf(job: jobs, c: cursor ?):
  return chipReports where .job = job last 50 by .id after c

query leaksOf(job: jobs, c: cursor ?):
  return leakReports where .job = job last 50 by .id after c

query visitsOf(job: jobs, c: cursor ?):
  return returnVisits where .job = job last 20 by .id after c

-- The estimator (crew) or owner opens a job for a customer handle.
mutation openJob(customerHandle: text 3..20, address: text 1..200, priceCents: int 1..100000000, detail: text 1..500 ?):
  require exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  p = profiles[handle = customerHandle] ! else UNKNOWN_CUSTOMER
  return insert jobs { customer: p.principal, address, detail, priceCents, status: 'quoted', quotedAt: now }

mutation addBeforePhoto(job: jobs, photo: image <=10000000, caption: text 1..200 ?):
  require exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  return insert jobPhotos { job: j.id, photo, caption }

-- The customer accepts within 14 days of the quote or it lapses.
mutation acceptQuote(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_CUSTOMER
  require j.status = 'quoted' else NOT_QUOTABLE
  require j.quotedAt + 14d >= now else QUOTE_LAPSED
  update jobs[job] { status: 'booked', acceptedAt: now }
  return null

-- Crew advances a job through stripping, chip repair and spraying to cured.
mutation advanceJob(job: jobs, to: enum('stripping', 'chip-repair', 'sprayed', 'cured')):
  require exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  if to = 'stripping':
    require j.status = 'booked' else BAD_TRANSITION
    update jobs[job] { status: 'stripping' }
  elif to = 'chip-repair':
    require j.status = 'stripping' else BAD_TRANSITION
    update jobs[job] { status: 'chip-repair' }
  elif to = 'sprayed':
    require j.status = 'chip-repair' else BAD_TRANSITION
    update jobs[job] { status: 'sprayed' }
  elif to = 'cured':
    require j.status = 'sprayed' else BAD_TRANSITION
    update jobs[job] { status: 'cured', curedAt: now }
  else:
    require false else BAD_STATUS
  return null

-- The customer signs off a cured tub.
mutation signOff(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_CUSTOMER
  require j.status = 'cured' else NOT_CURED
  update jobs[job] { status: 'signed-off', signedOffAt: now }
  return null

-- A missed chip reported within 7 days of the cure.
mutation reportMissedChip(job: jobs, detail: text 1..500):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_CUSTOMER
  require j.status = 'cured' or j.status = 'signed-off' else NOT_REPORTABLE
  require j.curedAt != null else NOT_CURED
  cured = j.curedAt ?? 0
  require cured + 7d >= now else REPORT_WINDOW_CLOSED
  return insert chipReports { job: j.id, reporter: viewer, detail, reportedAt: now }

-- The customer consents in the report; only the owner may approve the reglaze.
mutation reportLeak(job: jobs, detail: text 1..500, consent: text 1..300):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_CUSTOMER
  require j.status = 'signed-off' else NOT_SIGNED_OFF
  return insert leakReports { job: j.id, reporter: viewer, detail, consent, reportedAt: now }

mutation approveReglaze(report: leakReports):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  r = leakReports[report] ! else NOT_FOUND
  j = jobs[r.job] ! else NOT_FOUND
  require j.status = 'signed-off' else NOT_SIGNED_OFF
  require r.approved = false else ALREADY_APPROVED
  update leakReports[report] { approved: true, approvedAt: now }
  update jobs[r.job] { status: 'booked' }
  return null

mutation scheduleReturnVisit(report: chipReports, scheduledFor: time, note: text 1..300 ?):
  require exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  r = chipReports[report] ! else NOT_FOUND
  return insert returnVisits { job: r.job, report: r.id, customer: r.reporter, scheduledFor, note }

mutation createInvoice(job: jobs, amountCents: int 1..100000000):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.status != 'quoted' and j.status != 'lapsed' else NOT_BILLABLE
  return insert invoices { job: j.id, customer: j.customer, amountCents, issuedAt: now }

mutation markPaid(invoice: invoices):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  i = invoices[invoice] ! else NOT_FOUND
  update invoices[invoice] { paid: true }
  return null

-- Relabel quotes left unaccepted past their 14-day window. Enforcement also
-- happens in acceptQuote itself; this keeps the board truthful.
job lapseQuotes(periodStart: time, periodEnd: time):
  for j in jobs by .id:
    if j.status = 'quoted' and j.quotedAt + 14d < periodEnd:
      update jobs[j.id] { status: 'lapsed' }
schedule lapseQuotesDaily every 1d at 03:00: lapseQuotes

-- Privacy and authority intent, separate from enforcement above.
invariant jobs.read only .customer = viewer or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
invariant jobs.insert only exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
invariant invoices.read only .customer = viewer or exists roles[viewer, role = 'owner']
invariant invoices.insert only exists roles[viewer, role = 'owner']
invariant leakReports.update only exists roles[viewer, role = 'owner']
invariant roles.role write only viewer = 'service:operator'
