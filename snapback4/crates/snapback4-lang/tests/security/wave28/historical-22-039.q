-- Certified Translation Jobs.
-- Roles: client, translator, manager (project manager), owner. Two users per
-- role minimum; provisioned by the local operator, never self-claimed.
-- Privacy: translators see scan, language pair, page count and due date, but
-- not contact details, payment status or quoted price (manager/owner only,
-- plus the owning client for their own jobs). Clients see only their own jobs
-- and invoices. Only the owner signs the certification statement.
use identity password

table roles:
  principal: principal
  role: enum('client', 'translator', 'manager', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  cap 200
  online only

mutation provision(principal: principal, role: enum('client', 'translator', 'manager', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

table jobs:
  client: principal
  contact: text 1..200
  sourceLang: text 2..20
  targetLang: text 2..20
  docType: enum('birth_certificate', 'diploma', 'court_papers')
  pages: int 1..1000
  scan: image <=10000000
  price: money USD ?
  paymentStatus: enum('unpaid', 'paid', 'invoiced') default 'unpaid'
  status: enum('new', 'translating', 'review', 'certified') default 'new'
  quoteApprovedAt: time ?
  dueAt: time ?
  certification: text 1..2000 ?
  immutable client
  read <- .client = viewer or exists roles[principal = viewer, role = 'translator'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
  read (contact, price, paymentStatus) <- .client = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
  insert <- .client = viewer and exists roles[principal = viewer, role = 'client']
  update <- .client = viewer or exists roles[principal = viewer, role = 'translator'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
  cap 10000
  online only

table invoices:
  job: jobs
  client: principal
  amount: money USD
  status: enum('unpaid', 'paid') default 'unpaid'
  immutable job, client, amount
  read <- .client = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
  cap 10000
  online only

-- A client requests a translation, uploading the source-document scan.
mutation requestJob(contact: text 1..200, sourceLang: text 2..20, targetLang: text 2..20, docType: enum('birth_certificate', 'diploma', 'court_papers'), pages: int 1..1000, scan: image <=10000000):
  require exists roles[principal = viewer, role = 'client'] else NOT_CLIENT
  return insert jobs { client: viewer, contact, sourceLang, targetLang, docType, pages, scan }

-- A manager or the owner quotes a price while the job is still new and unapproved.
mutation setQuote(job: jobs, price: money USD):
  require exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'new' else BAD_STATUS
  require j.quoteApprovedAt = null else ALREADY_APPROVED
  update jobs[job] { price }
  return null

-- The owning client approves the quote; the job is due seven days later.
mutation approveQuote(job: jobs):
  require exists roles[principal = viewer, role = 'client'] else NOT_CLIENT
  j = jobs[job] ! else NOT_FOUND
  require j.client = viewer else NOT_YOUR_JOB
  require j.status = 'new' else BAD_STATUS
  require j.price != null else NO_QUOTE
  require j.quoteApprovedAt = null else ALREADY_APPROVED
  update jobs[job] { quoteApprovedAt: now, dueAt: now + 7d }
  return null

mutation startTranslation(job: jobs):
  require exists roles[principal = viewer, role = 'translator'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'new' else BAD_STATUS
  require j.quoteApprovedAt != null else NOT_APPROVED
  update jobs[job] { status: 'translating' }
  return null

mutation submitReview(job: jobs):
  require exists roles[principal = viewer, role = 'translator'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'translating' else BAD_STATUS
  update jobs[job] { status: 'review' }
  return null

-- Only the owner signs the certification statement.
mutation certify(job: jobs, statement: text 1..2000):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'review' else BAD_STATUS
  update jobs[job] { status: 'certified', certification: statement }
  return null

mutation setPayment(job: jobs, paymentStatus: enum('unpaid', 'paid', 'invoiced')):
  require exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  update jobs[job] { paymentStatus }
  return null

mutation createInvoice(job: jobs, amount: money USD):
  require exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  return insert invoices { job: j.id, client: j.client, amount, status: 'unpaid' }

mutation markInvoicePaid(invoice: invoices):
  require exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  i = invoices[invoice] ! else NOT_FOUND
  update invoices[invoice] { status: 'paid' }
  return null

-- Board: staff see every job; a client sees only their own. Live for all.
query jobBoard(c: cursor ?):
  require exists roles[principal = viewer] else NOT_REGISTERED
  if exists roles[principal = viewer, role = 'client']:
    return jobs where .client = viewer last 50 by .id after c
  return jobs last 50 by .id after c

query job(job: jobs):
  return jobs[job]

query myInvoices(c: cursor ?):
  require exists roles[principal = viewer] else NOT_REGISTERED
  return invoices where .client = viewer last 50 by .id after c

query jobInvoices(job: jobs, c: cursor ?):
  require exists roles[principal = viewer] else NOT_REGISTERED
  return invoices where .job = job first 50 by .id after c

-- Privacy intent, stated independently from enforcement.
invariant jobs.read only .client = viewer or exists roles[principal = viewer, role = 'translator'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
invariant jobs.contact read only .client = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
invariant jobs.price read only .client = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
invariant jobs.paymentStatus read only .client = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
invariant jobs.certify only exists roles[principal = viewer, role = 'owner']
invariant invoices.read only .client = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'owner']
