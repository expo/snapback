use identity password

-- Roles are operator-assigned, never chosen by a signing-up client.
table roles:
  principal: principal
  role: enum('homeowner', 'estimator', 'crew', 'owner')
  label: text 1..120
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('homeowner', 'estimator', 'crew', 'owner'), label: text 1..120):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, label }

query myRole():
  return roles[viewer]
query homeowners(c: cursor ?):
  require exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner'] else STAFF_ONLY
  return roles where .role = 'homeowner' last 100 by .id after c

table jobs:
  homeowner: principal
  estimator: principal
  title: text 3..100
  address: text 5..200
  quoteCents: int 1..100000000
  photos: [image <=5000000] 1..30
  defects: [text 5..200] 1..30
  quotedAt: time
  expiresAt: time
  status: enum('estimate', 'raking', 'washing', 'pointing', 'curing', 'complete') default 'estimate'
  acceptedAt: time ?
  curedAt: time ?
  extraCents: int 0..100000000 ? write <- exists roles[viewer, role = 'owner']
  immutable homeowner, estimator, title, address, quoteCents, photos, defects, quotedAt, expiresAt
  read <- .homeowner = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  insert <- .estimator = viewer and exists roles[viewer, role = 'estimator'] and exists roles[.homeowner, role = 'homeowner']
  update <- .homeowner = viewer or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  online only
invariant jobs.read only .homeowner = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
invariant jobs.insert only exists roles[viewer, role = 'estimator']
invariant jobs always .photos != null
invariant jobs.extraCents update only exists roles[viewer, role = 'owner']

query board(c: cursor ?):
  if exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']:
    return jobs last 100 by .id after c
  return jobs where .homeowner = viewer last 100 by .id after c
query jobDetail(job: jobs):
  return jobs[job]
query businessTime():
  return now

mutation openJob(homeowner: principal, title: text 3..100, address: text 5..200, quoteCents: int 1..100000000, photos: [image <=5000000] 1..30, defects: [text 5..200] 1..30):
  require exists roles[viewer, role = 'estimator'] else ESTIMATOR_ONLY
  require exists roles[principal = homeowner, role = 'homeowner'] else HOMEOWNER_REQUIRED
  require len(photos) = len(defects) else CAPTION_EACH_PHOTO
  return insert jobs { homeowner, estimator: viewer, title, address, quoteCents, photos, defects, quotedAt: now, expiresAt: now + 30d }

mutation acceptQuote(job: jobs):
  require exists roles[viewer, role = 'homeowner'] else HOMEOWNER_ONLY
  j = jobs[job] ! else NOT_FOUND
  require j.homeowner = viewer else NOT_YOURS
  require j.status = 'estimate' else ALREADY_ACCEPTED
  require now < j.expiresAt else QUOTE_LAPSED 'This estimate lapsed after 30 days.'
  update jobs[job] { status: 'raking', acceptedAt: now }
  return jobs[job]

mutation advanceWall(job: jobs, stage: enum('washing', 'pointing', 'curing')):
  require exists roles[viewer, role = 'crew'] else CREW_ONLY
  j = jobs[job] ! else NOT_FOUND
  require (j.status = 'raking' and stage = 'washing') or (j.status = 'washing' and stage = 'pointing') or (j.status = 'pointing' and stage = 'curing') else BAD_STAGE 'Move to the next stage in order.'
  update jobs[job] { status: stage }
  return jobs[job]

table consents:
  job: jobs
  homeowner: principal
  course: text 3..120
  extraCents: int 1..10000000
  statement: text 10..1000
  consentedAt: time
  immutable job, homeowner, course, extraCents, statement, consentedAt
  read <- .homeowner = viewer or exists roles[viewer, role = 'owner']
  insert <- .homeowner = viewer and exists roles[viewer, role = 'homeowner'] and exists jobs[.job, homeowner = viewer]
  online only
invariant consents.read only .homeowner = viewer or exists roles[viewer, role = 'owner']
invariant consents.insert only .homeowner = viewer

query jobConsents(job: jobs, c: cursor ?):
  return consents where .job = job last 100 by .id after c
mutation consentCourse(job: jobs, course: text 3..120, extraCents: int 1..10000000, statement: text 10..1000):
  require exists roles[viewer, role = 'homeowner'] else HOMEOWNER_ONLY
  j = jobs[job] ! else NOT_FOUND
  require j.homeowner = viewer else NOT_YOURS
  require j.status != 'estimate' and j.status != 'complete' else NOT_ACTIVE
  return insert consents { job, homeowner: viewer, course, extraCents, statement, consentedAt: now }

table approvals:
  job: jobs
  consent: consents
  homeowner: principal
  owner: principal
  course: text 3..120
  extraCents: int 1..10000000
  approvedAt: time
  unique consent
  unique job, course
  immutable job, consent, homeowner, owner, course, extraCents, approvedAt
  read <- .homeowner = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'estimator']
  insert <- .owner = viewer and exists roles[viewer, role = 'owner']
  online only
invariant approvals.insert only exists roles[viewer, role = 'owner']
query jobApprovals(job: jobs, c: cursor ?):
  return approvals where .job = job last 100 by .id after c
mutation approveCourse(consent: consents):
  require exists roles[viewer, role = 'owner'] else OWNER_ONLY
  s = consents[consent] ! else NOT_FOUND
  j = jobs[s.job] ! else NOT_FOUND
  require j.status != 'estimate' and j.status != 'complete' else NOT_ACTIVE
  update jobs[j.id] { extraCents: (j.extraCents ?? 0) + s.extraCents }
  return insert approvals { job: j.id, consent, homeowner: j.homeowner, owner: viewer, course: s.course, extraCents: s.extraCents, approvedAt: now }

table invoices:
  job: jobs
  homeowner: principal
  totalCents: int 1..200000000
  issuedAt: time
  unique job
  immutable job, homeowner, totalCents, issuedAt
  read <- .homeowner = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'estimator']
  insert <- exists roles[viewer, role = 'crew']
  online only
invariant invoices.read only .homeowner = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'estimator']
query myInvoices(c: cursor ?):
  if exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'estimator']:
    return invoices last 100 by .id after c
  return invoices where .homeowner = viewer last 100 by .id after c
query invoiceDetail(invoice: invoices):
  return invoices[invoice]
mutation finishCure(job: jobs):
  require exists roles[viewer, role = 'crew'] else CREW_ONLY
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'curing' else NOT_CURING
  update jobs[job] { status: 'complete', curedAt: now }
  insert invoices { job, homeowner: j.homeowner, totalCents: j.quoteCents + (j.extraCents ?? 0), issuedAt: now }
  return jobs[job]

table leaks:
  job: jobs
  homeowner: principal
  description: text 10..1000
  reportedAt: time
  repairCents: int 0..0 default 0
  immutable job, homeowner, description, reportedAt, repairCents
  read <- .homeowner = viewer or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'estimator']
  insert <- .homeowner = viewer and exists roles[viewer, role = 'homeowner'] and exists jobs[.job, homeowner = viewer]
  online only
invariant leaks.insert only .homeowner = viewer
query jobLeaks(job: jobs, c: cursor ?):
  return leaks where .job = job last 100 by .id after c
mutation reportLeak(job: jobs, description: text 10..1000):
  require exists roles[viewer, role = 'homeowner'] else HOMEOWNER_ONLY
  j = jobs[job] ! else NOT_FOUND
  require j.homeowner = viewer else NOT_YOURS
  require j.status = 'complete' and j.curedAt != null else NOT_CURED
  require now <= j.curedAt + 60d else WARRANTY_ENDED 'The free leak repair window ended 60 days after final cure.'
  return insert leaks { job, homeowner: viewer, description, reportedAt: now, repairCents: 0 }
