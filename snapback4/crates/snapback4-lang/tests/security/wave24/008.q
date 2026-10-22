-- Terrazzo Floor Restorations.
--
-- Roles: owner (company owner), estimator (opens jobs with photos + quote),
-- crew (live job board, moves floors through stages, repairs defects),
-- client (owns their jobs/invoices, accepts quotes, reports defects).
-- Real password authentication: `use identity password` (no dev personas).
use identity password

-- Roster: one row per user, provisioned by the local operator.
-- Signup creates an account without a role; only the operator grants roles.
table roles:
  principal: principal
  role: enum('owner', 'estimator', 'crew', 'client')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'estimator', 'crew', 'client')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- A restoration job for one client's floor.
-- Lifecycle: estimate -> accepted -> crack_filling -> grinding ->
-- polishing -> sealed. An unaccepted estimate lapses after 30 days.
-- finalPolishAt is stamped when the floor is sealed; defects reported
-- within 60 days after it qualify for a free repair.
table jobs:
  client: principal
  estimator: principal
  address: text 1..200
  quotedPrice: int 1..100000000
  status: enum('estimate', 'accepted', 'crack_filling', 'grinding', 'polishing', 'sealed', 'lapsed')
  estimateCreatedAt: time default now
  acceptedAt: time ?
  finalPolishAt: time ?
  immutable client, estimator, estimateCreatedAt
  read <- .client = viewer or .estimator = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  update <- .client = viewer or .estimator = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
  cap 500 by client
  online only

-- Photos of every crack and stain, recorded when the job is opened.
table jobPhotos:
  job: jobs
  url: text 1..500
  kind: enum('crack', 'stain', 'other')
  addedBy: principal
  immutable job, addedBy
  read <- exists jobs[.job, client = viewer] or exists jobs[.job, estimator = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  cap 50 by job
  online only

-- Invoices belong to one job and one client.
table invoices:
  job: jobs
  client: principal
  amount: int 1..100000000
  status: enum('issued', 'paid')
  issuedAt: time default now
  immutable job, client, issuedAt
  read <- .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner']
  update <- .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']
  cap 50 by job
  online only

-- Defects reported by the client after the final polish. freeRepair is
-- decided at report time: within 60 days after the final polish it is free.
table defects:
  job: jobs
  reporter: principal
  description: text 1..1000
  reportedAt: time default now
  freeRepair: bool
  repaired: bool default false
  immutable job, reporter, reportedAt, freeRepair
  read <- .reporter = viewer or exists jobs[.job, client = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
  insert <- .reporter = viewer
  update <- .reporter = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'crew']
  cap 50 by job
  online only

-- Replacing a whole section of original terrazzo: anyone on staff may
-- propose, but only the owner approves, recording client consent + cost.
table sectionReplacements:
  job: jobs
  proposedBy: principal
  reason: text 1..1000
  extraCost: int 0..100000000
  clientConsent: bool default false
  status: enum('proposed', 'approved', 'rejected')
  approvedBy: principal ?
  approvedAt: time ?
  immutable job, proposedBy
  read <- exists jobs[.job, client = viewer] or exists jobs[.job, estimator = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
  insert <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'owner']
  cap 20 by job
  online only

-- Estimates lapse 30 days after they are opened.
job lapseEstimates(periodStart: time, periodEnd: time):
  for j in jobs where .estimateCreatedAt < periodEnd - 30d by .estimateCreatedAt:
    if j.status = 'estimate':
      update jobs[j.id] { status: 'lapsed' }

schedule lapseHourly every 1h: lapseEstimates

-- Reads: clients see only their own rows; staff see the whole board.
query myJobs(c: cursor ?):
  if exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']:
    return jobs last 50 by .id after c
  return jobs where .client = viewer last 50 by .id after c

query jobBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] else NOT_STAFF
  return jobs last 100 by .id after c

query jobDetail(job: jobs):
  return jobs[job]

query jobPhotosOf(job: jobs, c: cursor ?):
  return jobPhotos where .job = job first 50 by .id after c

query myInvoices(c: cursor ?):
  if exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']:
    return invoices last 50 by .id after c
  return invoices where .client = viewer last 50 by .id after c

query jobInvoices(job: jobs, c: cursor ?):
  return invoices where .job = job first 50 by .id after c

query jobDefects(job: jobs, c: cursor ?):
  return defects where .job = job first 50 by .id after c

query jobSections(job: jobs, c: cursor ?):
  return sectionReplacements where .job = job first 50 by .id after c

-- Writes.
mutation openJob(client: principal, address: text 1..200, quotedPrice: int 1..100000000):
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR
  return insert jobs { client, estimator: viewer, address, quotedPrice, status: 'estimate' }

mutation addPhoto(job: jobs, url: text 1..500, kind: enum('crack', 'stain', 'other')):
  j = jobs[job] ! else NOT_FOUND
  require j.estimator = viewer or exists roles[principal = viewer, role = 'owner'] else NOT_YOUR_JOB
  require j.status = 'estimate' else BAD_STATUS 'Photos can only be added while the job is an estimate.'
  return insert jobPhotos { job, url, kind, addedBy: viewer }

mutation acceptQuote(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.client = viewer else NOT_YOUR_JOB 'Only the job client can accept its quote.'
  require j.status = 'estimate' else BAD_STATUS 'This estimate is no longer open.'
  require now <= j.estimateCreatedAt + 30d else ESTIMATE_LAPSED 'The estimate lapsed 30 days after it was opened.'
  update jobs[job] { status: 'accepted', acceptedAt: now }
  return null

mutation advanceStage(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'owner'] else NOT_CREW 'Only the crew can move a floor through its stages.'
  require j.status = 'accepted' or j.status = 'crack_filling' or j.status = 'grinding' or j.status = 'polishing' else BAD_STATUS 'Only an accepted, in-progress job can advance.'
  next = 'crack_filling' if j.status = 'accepted' else 'grinding' if j.status = 'crack_filling' else 'polishing' if j.status = 'grinding' else 'sealed'
  if next = 'sealed':
    update jobs[job] { status: next, finalPolishAt: now }
  else:
    update jobs[job] { status: next }
  return null

mutation createInvoice(job: jobs, amount: int 1..100000000):
  j = jobs[job] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'owner'] else NOT_ESTIMATOR
  require j.status != 'estimate' and j.status != 'lapsed' else BAD_STATUS 'Invoices need an accepted job.'
  return insert invoices { job, client: j.client, amount, status: 'issued' }

mutation payInvoice(invoice: invoices):
  inv = invoices[invoice] ! else NOT_FOUND
  require inv.client = viewer else NOT_YOUR_INVOICE 'Only the invoice client can pay it.'
  require inv.status = 'issued' else BAD_STATUS 'This invoice is already paid.'
  update invoices[invoice] { status: 'paid' }
  return null

mutation reportDefect(job: jobs, description: text 1..1000):
  j = jobs[job] ! else NOT_FOUND
  require j.client = viewer else NOT_YOUR_JOB 'Only the job client can report a defect.'
  require j.status = 'sealed' else BAD_STATUS 'Defects can only be reported after the final polish.'
  polishedAt = j.finalPolishAt ?? j.estimateCreatedAt
  free = now <= polishedAt + 60d
  return insert defects { job, reporter: viewer, description, freeRepair: free }

mutation repairDefect(defect: defects):
  d = defects[defect] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'owner'] else NOT_CREW
  require not d.repaired else BAD_STATUS 'This defect is already repaired.'
  update defects[defect] { repaired: true }
  return null

mutation proposeSection(job: jobs, reason: text 1..1000, extraCost: int 0..100000000):
  j = jobs[job] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF
  return insert sectionReplacements { job, proposedBy: viewer, reason, extraCost, status: 'proposed' }

mutation approveSection(section: sectionReplacements, clientConsent: bool, extraCost: int 0..100000000):
  s = sectionReplacements[section] ! else NOT_FOUND
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the company owner can approve replacing original terrazzo.'
  require s.status = 'proposed' else BAD_STATUS 'This section replacement is already decided.'
  require clientConsent else CONSENT_REQUIRED 'The client must consent before original terrazzo is replaced.'
  update sectionReplacements[section] { status: 'approved', clientConsent: true, extraCost, approvedBy: viewer, approvedAt: now }
  return null

-- Privacy intent from the spec, stated independently of the table rules.
-- Clients see only their own jobs and invoices; estimators see the jobs
-- they opened; crew see the live board; the owner sees everything.
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant jobs.read only .client = viewer or .estimator = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
invariant jobPhotos.read only exists jobs[.job, client = viewer] or exists jobs[.job, estimator = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
invariant invoices.read only .client = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator']
invariant defects.read only .reporter = viewer or exists jobs[.job, client = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
invariant sectionReplacements.read only exists jobs[.job, client = viewer] or exists jobs[.job, estimator = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew']
-- Authority intent: only the job client accepts its quote and reports its
-- defects; only the client pays their invoice; only crew/owner move stages;
-- only the owner approves replacing original terrazzo.
invariant jobs.acceptQuote only .client = viewer
invariant jobs.reportDefect only .client = viewer
invariant invoices.payInvoice only .client = viewer
invariant jobs.advanceStage only exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'owner']
invariant sectionReplacements.approveSection only exists roles[principal = viewer, role = 'owner']
