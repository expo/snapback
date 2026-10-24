-- Stucco Repair Jobs: a plastering contractor's job tracker.
-- Roles: estimator (opens jobs with photos + quote), homeowner (accepts
-- quote within 30 days, reports defects within 60 days of final coat),
-- crew (live job board, advances walls removal->lath->scratch->finish),
-- owner (approves full strip-back to frame with consent + extra cost).
use identity password

table roles:
  principal: principal
  role: enum('estimator', 'homeowner', 'crew', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'estimator']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('estimator', 'homeowner', 'crew', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query homeownerDirectory():
  require exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return roles where .role = 'homeowner' last 100 by .id

table jobs:
  homeowner: principal
  address: text 1..200
  notes: text <=1000 ?
  quotedPrice: money USD
  status: enum('estimate', 'accepted', 'in_progress', 'finished', 'lapsed') default 'estimate'
  estimateCreatedAt: time default now
  acceptedAt: time ?
  finishedAt: time ?
  immutable homeowner, estimateCreatedAt
  read <- .homeowner = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'estimator']
  update <- .homeowner = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  delete <- deny
  cap 500
  online only

table walls:
  job: jobs on delete restrict
  label: text 1..80
  stage: enum('removal', 'lath', 'scratch', 'finish') default 'removal'
  immutable job, label
  read <- exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'estimator']
  update <- exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  delete <- deny
  cap 200 by job
  online only

table photos:
  job: jobs on delete restrict
  photo: image <=5000000
  caption: text <=200 ?
  takenAt: time default now
  immutable job, takenAt
  read <- exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'estimator']
  update <- deny
  delete <- exists roles[viewer, role = 'estimator']
  cap 100 by job
  online only

table invoices:
  job: jobs on delete restrict
  amount: money USD
  memo: text <=200 ?
  issuedAt: time default now
  immutable job, amount, issuedAt
  read <- exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner']
  update <- deny
  delete <- deny
  cap 50 by job
  online only

table defects:
  job: jobs on delete restrict
  reporter: principal
  description: text 1..1000
  reportedAt: time default now
  freeRepair: bool default true
  immutable job, reporter, reportedAt
  read <- exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  insert <- .reporter = viewer
  update <- deny
  delete <- deny
  cap 100 by job
  online only

table stripApprovals:
  wall: walls on delete restrict
  job: jobs on delete restrict
  homeownerConsent: bool
  extraCost: money USD
  approver: principal
  approvedAt: time default now
  immutable wall, job, homeownerConsent, extraCost, approver, approvedAt
  read <- exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'owner']
  update <- deny
  delete <- deny
  cap 20 by wall
  online only

-- The estimator opens each job with a damage photo, the quoted price and a first wall.
mutation openJob(homeowner: principal, address: text 1..200, quotedPrice: money USD, photo: image <=5000000, wallLabel: text 1..80, notes: text <=1000 ?):
  require exists roles[viewer, role = 'estimator'] else NOT_ESTIMATOR
  j = insert jobs { homeowner, address, notes, quotedPrice }
  insert photos { job: j, photo }
  insert walls { job: j, label: wallLabel }
  return j

mutation addWall(job: jobs, label: text 1..80):
  require exists roles[viewer, role = 'estimator'] else NOT_ESTIMATOR
  j = jobs[job] ! else NOT_FOUND
  return insert walls { job, label }

mutation addPhoto(job: jobs, photo: image <=5000000, caption: text <=200 ?):
  require exists roles[viewer, role = 'estimator'] else NOT_ESTIMATOR
  j = jobs[job] ! else NOT_FOUND
  return insert photos { job, photo, caption }

-- The homeowner accepts the quote within 30 days of the estimate.
mutation acceptQuote(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.homeowner = viewer else NOT_HOMEOWNER
  require j.status = 'estimate' else BAD_STATUS
  require now <= j.estimateCreatedAt + 30d else ESTIMATE_LAPSED
  update jobs[job] { status: 'accepted', acceptedAt: now }

mutation startWork(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require exists roles[viewer, role = 'crew'] else NOT_CREW
  require j.status = 'accepted' else BAD_STATUS
  update jobs[job] { status: 'in_progress' }

-- Walls move forward one stage at a time: removal -> lath -> scratch -> finish.
mutation advanceWall(wall: walls):
  w = walls[wall] ! else NOT_FOUND
  require exists roles[viewer, role = 'crew'] else NOT_CREW
  require w.stage = 'removal' or w.stage = 'lath' or w.stage = 'scratch' else ALREADY_FINISHED
  update walls[wall] { stage: 'lath' if w.stage = 'removal' else 'scratch' if w.stage = 'lath' else 'finish' }

mutation finishJob(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require exists roles[viewer, role = 'crew'] else NOT_CREW
  require j.status = 'in_progress' else BAD_STATUS
  update jobs[job] { status: 'finished', finishedAt: now }

-- The homeowner has 60 days after the final coat to report a defect for free repair.
mutation reportDefect(job: jobs, description: text 1..1000):
  j = jobs[job] ! else NOT_FOUND
  require j.homeowner = viewer else NOT_HOMEOWNER
  require j.status = 'finished' else NOT_FINISHED
  require now <= (j.finishedAt ?? 0) + 60d else DEFECT_WINDOW_CLOSED
  return insert defects { job, reporter: viewer, description }

-- Only the company owner approves stripping a wall back to the frame,
-- recording the homeowner's consent and the extra cost.
mutation approveStrip(wall: walls, homeownerConsent: bool, extraCost: money USD):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  require homeownerConsent else NO_CONSENT
  w = walls[wall] ! else NOT_FOUND
  update walls[wall] { stage: 'removal' }
  return insert stripApprovals { wall, job: w.job, homeownerConsent, extraCost, approver: viewer }

mutation addInvoice(job: jobs, amount: money USD, memo: text <=200 ?):
  require exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner'] else NOT_BILLING
  j = jobs[job] ! else NOT_FOUND
  return insert invoices { job, amount, memo }

query myJobs(c: cursor ?):
  if exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']:
    return jobs last 50 by .id after c
  return jobs where .homeowner = viewer last 50 by .id after c

-- The live job board: every wall and its stage, for estimator/crew/owner.
query jobBoard(c: cursor ?):
  require exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return walls last 50 by .id after c

query wallsOf(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  return walls where .job = job last 50 by .id after c

query photosOf(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  return photos where .job = job last 50 by .id after c

query invoicesOf(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  require j.homeowner = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner'] else NOT_ALLOWED
  return invoices where .job = job last 50 by .id after c

query defectsOf(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  return defects where .job = job last 50 by .id after c

query approvalsOf(wall: walls):
  w = walls[wall] ! else NOT_FOUND
  return stripApprovals where .wall = wall last 20 by .id

-- Estimates left unaccepted for 30 days lapse.
job sweepEstimates(periodStart: time, periodEnd: time):
  for j in jobs:
    if j.status = 'estimate' and j.estimateCreatedAt >= periodEnd - 60d and j.estimateCreatedAt < periodEnd - 30d:
      update jobs[j.id] { status: 'lapsed' }

schedule lapseEstimates every 1h: sweepEstimates

-- Privacy intent, stated independently from the rules (guide security).
invariant roles.read only .principal = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'estimator']
invariant roles.insert only viewer = 'service:operator'
invariant jobs.read only .homeowner = viewer or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
invariant jobs.insert only exists roles[viewer, role = 'estimator']
invariant walls.read only exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
invariant walls.insert only exists roles[viewer, role = 'estimator']
invariant photos.read only exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
invariant photos.insert only exists roles[viewer, role = 'estimator']
invariant invoices.read only exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner']
invariant invoices.insert only exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'owner']
invariant defects.read only exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
invariant stripApprovals.read only exists jobs[.job, homeowner = viewer] or exists roles[viewer, role = 'estimator'] or exists roles[viewer, role = 'crew'] or exists roles[viewer, role = 'owner']
invariant stripApprovals.insert only exists roles[viewer, role = 'owner']
