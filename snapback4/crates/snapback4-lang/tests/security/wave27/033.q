-- Asphalt Sealcoating Jobs.
-- Roles: customer, crew, estimator, owner. Real password accounts; the local
-- operator provisions the first roster (see guide staging). Time windows are
-- enforced in the mutations AND by the lapseQuotes sweep, so the deadline
-- holds even between sweeps.
use identity password

table roles:
  principal: principal
  role: enum('customer', 'crew', 'estimator', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- Spec privacy intent, stated independently from the enforcement rules above.
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']

query customerDirectory(c: cursor ?):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR
  return roles where .role = 'customer' first 50 by .id after c
invariant roles.insert only viewer = 'service:operator'
invariant jobs.read only .customer = viewer or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
invariant jobs.insert only exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
invariant photos.read only .job.customer = viewer or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
invariant photos.insert only exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
invariant reports.read only .reporter = viewer or .job.customer = viewer or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
invariant invoices.read only .customer = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
invariant invoices.insert only exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']

query myRole():
  return roles[viewer]

mutation provision(principal: principal, role: enum('customer', 'crew', 'estimator', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

-- One sealcoating job: opened by the estimator with before photos and the
-- quoted price. The customer accepts within 14 days or the quote lapses.
table jobs:
  customer: principal
  address: text 1..200
  notes: text <=1000 ?
  quotedCents: int 0..100000000
  quotedAt: time
  status: enum('quoted', 'lapsed', 'booked', 'crack_filling', 'sealing', 'striped')
  surfaceFailing: bool default false
  customerSignedFailing: bool default false
  customerConsent: bool default false
  consentSummary: enum('Failure signed off', 'No failure sign-off recorded') default 'No failure sign-off recorded' write <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] or .customer = viewer
  ownerApproved: bool default false
  sealedAt: time ?
  createdAt: time default now
  immutable customer, quotedAt, createdAt
  cap 500 by customer
  read <- .customer = viewer or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  update <- .customer = viewer or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  delete <- deny
  online only

-- v2 migration: every pre-existing job gets 'Failure signed off' when the
-- customer's signed acknowledgment is already recorded, and
-- 'No failure sign-off recorded' otherwise.
backfill jobs consentSummary(customerSignedFailing: bool):
  {consentSummary: 'Failure signed off' if customerSignedFailing = true else 'No failure sign-off recorded'}

-- Before photos of every crack and pothole, placed by the estimator.
table photos:
  job: jobs
  caption: text 1..120
  photo: image <=10000000
  takenAt: time default now
  immutable job, takenAt
  cap 50 by job
  read <- .job.customer = viewer or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  update <- deny
  delete <- deny
  online only

-- Missed areas reported within seven days after sealing.
table reports:
  job: jobs
  reporter: principal
  description: text 1..500
  photo: image <=10000000 ?
  status: enum('open', 'return_scheduled', 'resolved')
  createdAt: time default now
  immutable job, reporter, createdAt
  cap 20 by job
  read <- .reporter = viewer or .job.customer = viewer or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  insert <- .reporter = viewer
  update <- exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  delete <- deny
  online only

-- Invoices: the customer sees only their own; crew sees none.
table invoices:
  job: jobs
  customer: principal
  amountCents: int 0..100000000
  status: enum('issued', 'paid')
  issuedAt: time default now
  immutable job, customer, issuedAt
  cap 5 by job
  read <- .customer = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  delete <- deny
  online only

query myJobs(c: cursor ?):
  return jobs where .customer = viewer last 50 by .id after c

query jobBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  return jobs last 50 by .id after c

query jobDetail(job: jobs):
  return jobs[job]

query photosOf(job: jobs, c: cursor ?):
  return photos where .job = job first 50 by .id after c

query reportsFor(job: jobs, c: cursor ?):
  return reports where .job = job first 50 by .id after c

query myInvoices(c: cursor ?):
  return invoices where .customer = viewer last 50 by .id after c

query jobInvoices(job: jobs, c: cursor ?):
  return invoices where .job = job first 20 by .id after c

query invoiceDetail(invoice: invoices):
  return invoices[invoice]

mutation openJob(customer: principal, address: text 1..200, notes: text <=1000 ?, quotedCents: int 0..100000000, surfaceFailing: bool):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR
  return insert jobs { customer, address, notes, quotedCents, quotedAt: now, status: 'quoted', surfaceFailing, consentSummary: 'No failure sign-off recorded' }

mutation addPhoto(job: jobs, caption: text 1..120, photo: image <=10000000):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR
  j = jobs[job] ! else NOT_FOUND
  return insert photos { job: j.id, caption, photo }

mutation acceptQuote(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_YOUR_JOB
  require j.status = 'quoted' else NOT_QUOTED
  require j.quotedAt + 14d >= now else QUOTE_LAPSED 'The 14-day quote window has passed.'
  update jobs[job] { status: 'booked' }
  return null

mutation signFailing(job: jobs, consent: bool):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_YOUR_JOB
  require j.status != 'lapsed' and j.status != 'striped' else BAD_STATE
  update jobs[job] { customerSignedFailing: true, customerConsent: consent, consentSummary: 'Failure signed off' }
  return null

-- Only the estimator (or the owner, who holds every estimator power in this
-- app) may change the surface consent summary directly; crews have no path.
-- The customer's own signFailing mutation above is the one fixed caller-side
-- exception: it always sets the summary consistently with the acknowledgment.
mutation setConsentSummary(job: jobs, summary: enum('Failure signed off', 'No failure sign-off recorded')):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR
  j = jobs[job] ! else NOT_FOUND
  update jobs[job] { consentSummary: summary }
  return null

mutation approveSeal(job: jobs):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.customerSignedFailing else NO_SIGNOFF
  require j.customerConsent else NO_CONSENT
  update jobs[job] { ownerApproved: true }
  return null

mutation advanceStatus(job: jobs, to: enum('booked', 'crack_filling', 'sealing', 'striped')):
  require exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require (j.status = 'booked' and to = 'crack_filling') or (j.status = 'crack_filling' and to = 'sealing') or (j.status = 'sealing' and to = 'striped') else BAD_TRANSITION 'Jobs move booked to crack filling to sealing to striped.'
  if to = 'sealing' and (j.surfaceFailing or j.customerSignedFailing):
    require j.ownerApproved else NEEDS_OWNER_APPROVAL 'Only the owner may approve sealing over a failing surface.'
  if to = 'striped':
    update jobs[job] { status: to, sealedAt: now }
  else:
    update jobs[job] { status: to }
  return null

mutation reportMissed(job: jobs, description: text 1..500, photo: image <=10000000 ?):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_YOUR_JOB
  require j.sealedAt != null else NOT_SEALED
  require now <= j.sealedAt + 7d else REPORT_WINDOW_CLOSED 'Missed areas must be reported within seven days after sealing.'
  return insert reports { job: j.id, reporter: viewer, description, photo, status: 'open' }

mutation setReportStatus(report: reports, to: enum('open', 'return_scheduled', 'resolved')):
  require exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  r = reports[report] ! else NOT_FOUND
  update reports[report] { status: to }
  return null

mutation createInvoice(job: jobs, amountCents: int 0..100000000):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'striped' else NOT_DONE
  return insert invoices { job: j.id, customer: j.customer, amountCents, status: 'issued' }

mutation markPaid(invoice: invoices):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR
  i = invoices[invoice] ! else NOT_FOUND
  update invoices[invoice] { status: 'paid' }
  return null

-- Quotes lapse 14 days after they are quoted. The mutation refuses late
-- acceptance too, so the deadline holds between sweeps.
job lapseQuotes(periodStart: time, periodEnd: time):
  for j in jobs where .quotedAt >= periodStart - 30d and .quotedAt < periodEnd by .quotedAt:
    if j.status = 'quoted' and j.quotedAt + 14d <= periodEnd:
      update jobs[j.id] { status: 'lapsed' }

schedule lapseDaily every 1d at 03:00: lapseQuotes
