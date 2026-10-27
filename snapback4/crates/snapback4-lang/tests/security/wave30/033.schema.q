-- Garage Floor Coatings: epoxy floors for home garages and workshops.
-- Roles: owner (company owner), estimator, crew, customer.
-- Real password identity; roles are provisioned by the local operator.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'estimator', 'crew', 'customer')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'estimator', 'crew', 'customer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- Customers register themselves here so estimators can address quotes.
table directory:
  principal: principal
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or viewer = 'service:operator'
  insert <- .principal = viewer and exists roles[principal = viewer, role = 'customer']
  online only

mutation registerCustomer():
  require exists roles[principal = viewer, role = 'customer'] else NOT_CUSTOMER
  return insert directory { principal: viewer } if absent

query customers(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] else NOT_STAFF
  return directory last 50 by .id after c

table jobs:
  customer: principal
  estimator: principal ?
  address: text 1..200
  description: text 1..1000 ?
  priceCents: int 0..
  status: enum('quoted', 'lapsed', 'booked', 'grinding', 'crack_filling', 'topcoated') default 'quoted'
  quoteCreatedAt: time default now
  acceptedAt: time ?
  bookedAt: time ?
  topcoatedAt: time ?
  dampSigned: bool default false
  dampConsent: text 1..500 ?
  dampApproved: bool default false
  immutable customer
  cap 500 by customer
  read <- .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']
  update <- .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
  online only

query myJobs(c: cursor ?):
  if exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']:
    return jobs last 50 by .id after c
  return jobs where .customer = viewer last 50 by .id after c

query jobDetail(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  return j

query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] else NOT_STAFF
  return jobs last 50 by .id after c

mutation openJob(customer: principal, address: text 1..200, description: text 1..1000 ?, priceCents: int 0..):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] else NOT_STAFF
  require exists directory[principal = customer] else NOT_CUSTOMER
  return insert jobs { customer, estimator: viewer, address, description, priceCents }

mutation acceptQuote(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_CUSTOMER
  require j.status = 'quoted' else BAD_STATUS
  require now <= j.quoteCreatedAt + 14d else QUOTE_LAPSED
  update jobs[job] { status: 'booked', acceptedAt: now, bookedAt: now }
  return jobs[job]

mutation advanceJob(job: jobs):
  require exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'booked' or j.status = 'grinding' or j.status = 'crack_filling' else BAD_STATUS
  if j.status = 'booked':
    update jobs[job] { status: 'grinding' }
  else if j.status = 'grinding':
    update jobs[job] { status: 'crack_filling' }
  else:
    update jobs[job] { status: 'topcoated', topcoatedAt: now }
  return jobs[job]

mutation markDamp(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_CUSTOMER
  update jobs[job] { dampSigned: true }
  return jobs[job]

mutation approveDamp(job: jobs, consent: text 1..500):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.dampSigned = true else NO_DAMP_SIGNOFF
  require j.dampApproved = false else BAD_STATUS
  update jobs[job] { dampApproved: true, dampConsent: consent }
  return jobs[job]

mutation issueInvoice(job: jobs, amountCents: int 0..):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  return insert invoices { job: j.id, customer: j.customer, amountCents }

table photos:
  job: jobs
  uploader: principal
  caption: text 1..200 ?
  image: image <=10000000
  immutable job
  cap 50 by job
  read <- exists jobs[.job, customer = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']
  online only

query jobPhotos(job: jobs, c: cursor ?):
  require exists jobs[job] else NOT_FOUND
  return photos where .job = job last 50 by .id after c

mutation addPhoto(job: jobs, image: image <=10000000, caption: text 1..200 ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'quoted' else BAD_STATUS
  return insert photos { job: j.id, uploader: viewer, caption, image }

table invoices:
  job: jobs
  customer: principal
  amountCents: int 0..
  issuedAt: time default now
  immutable job, customer
  cap 200 by customer
  read <- .customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']
  online only

query myInvoices(c: cursor ?):
  return invoices where .customer = viewer last 50 by .id after c

query jobInvoices(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] else NOT_ALLOWED
  return invoices where .job = job last 50 by .id after c

table reports:
  job: jobs
  reporter: principal
  note: text 1..500
  createdAt: time default now
  freeReturn: bool default false
  immutable job, reporter
  cap 50 by job
  read <- .reporter = viewer or exists jobs[.job, customer = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
  insert <- .reporter = viewer
  online only

query jobReports(job: jobs, c: cursor ?):
  require exists jobs[job] else NOT_FOUND
  return reports where .job = job last 50 by .id after c

mutation reportMissed(job: jobs, note: text 1..500):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_CUSTOMER
  require j.status = 'topcoated' else BAD_STATUS
  require j.topcoatedAt != null else BAD_STATUS
  require now <= (j.topcoatedAt ?? 0) + 7d else REPORT_WINDOW_CLOSED
  return insert reports { job: j.id, reporter: viewer, note, freeReturn: true }

-- Quotes lapse 14 days after they are opened if the customer never accepts.
job lapseQuotes(periodStart: time, periodEnd: time):
  for j in jobs:
    if j.status = 'quoted' and j.quoteCreatedAt < periodEnd - 14d:
      update jobs[j.id] { status: 'lapsed' }

schedule lapser every 1d at 03:00: lapseQuotes
