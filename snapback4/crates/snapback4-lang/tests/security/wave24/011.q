-- Radon Mitigation Jobs.
-- Roles: coordinator (opens jobs), homeowner (accepts quote, views own
-- jobs/results), installer (advances survey..retest, records retest),
-- owner (approves venting through a finished room with consent).
use identity password

table roles:
  principal: principal
  role: enum('coordinator', 'installer', 'owner', 'homeowner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  cap 100
  online only

mutation provision(principal: principal, role: enum('coordinator', 'installer', 'owner', 'homeowner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query homeownerList(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  return roles where .role = 'homeowner' first 50 by .principal after c

table jobs:
  homeowner: principal
  address: text 3..120
  price: money USD
  scan: image <=10000000
  status: enum('quoted', 'accepted', 'survey', 'drilling', 'fan_install', 'retest', 'complete', 'closed') default 'quoted'
  quotedAt: time default now
  installedAt: time ?
  retestAt: time ?
  retestValue: decimal 2 ?
  needsFinishedRoom: bool default false
  finishedRoomApproved: bool default false
  consent: text <=500 ?
  immutable homeowner, address, price, scan, quotedAt, needsFinishedRoom
  read <- .homeowner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'coordinator']
  update <- exists roles[viewer]
  cap 10000
  online only

table testResults:
  job: jobs
  kind: enum('initial', 'followup')
  value: decimal 2
  at: time default now
  note: text <=280 ?
  immutable job, kind, value, at
  read through .job
  insert <- exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'installer']
  cap 20000
  online only

query myJobs(c: cursor ?):
  return jobs where .homeowner = viewer last 50 by .quotedAt after c

query board(c: cursor ?):
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return jobs last 50 by .quotedAt after c

query flagged(c: cursor ?):
  if exists roles[viewer, role = 'homeowner']:
    return jobs where .homeowner = viewer and .status = 'retest' last 50 by .installedAt after c
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return jobs where .status = 'retest' last 50 by .installedAt after c

query overdue(c: cursor ?):
  cutoff = now - 30d
  if exists roles[viewer, role = 'homeowner']:
    return jobs where .homeowner = viewer and .status = 'retest' and .installedAt < cutoff last 50 by .installedAt after c
  require exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'owner'] else NOT_STAFF
  return jobs where .status = 'retest' and .installedAt < cutoff last 50 by .installedAt after c

query jobDetail(job: jobs):
  return jobs[job]

query resultsFor(job: jobs, c: cursor ?):
  return testResults where .job = job first 50 by .at after c

mutation openJob(homeowner: principal, address: text 3..120, price: money USD, scan: image <=10000000, initialValue: decimal 2, needsFinishedRoom: bool):
  require exists roles[viewer, role = 'coordinator'] else NOT_COORDINATOR
  job = insert jobs { homeowner, address, price, scan, needsFinishedRoom }
  insert testResults { job: job.id, kind: 'initial', value: initialValue }
  return job

mutation acceptQuote(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.homeowner = viewer else NOT_YOUR_JOB
  require j.status = 'quoted' else BAD_STATUS
  require now <= j.quotedAt + 21d else QUOTE_EXPIRED
  update jobs[job] { status: 'accepted' }
  return null

mutation advanceStage(job: jobs, stage: enum('survey', 'drilling', 'fan_install', 'retest')):
  require exists roles[viewer, role = 'installer'] else NOT_INSTALLER
  j = jobs[job] ! else NOT_FOUND
  require (j.status = 'accepted' and stage = 'survey') or (j.status = 'survey' and stage = 'drilling') or (j.status = 'drilling' and stage = 'fan_install') or (j.status = 'fan_install' and stage = 'retest') else BAD_TRANSITION
  if stage = 'retest':
    update jobs[job] { status: 'retest', installedAt: now }
  else:
    update jobs[job] { status: stage }
  return null

mutation recordRetest(job: jobs, value: decimal 2, note: text <=280 ?):
  require exists roles[viewer, role = 'installer'] else NOT_INSTALLER
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'retest' else BAD_STATUS
  update jobs[job] { status: 'complete', retestAt: now, retestValue: value }
  return insert testResults { job, kind: 'followup', value, note }

mutation approveFinishedRoom(job: jobs, consent: text 3..500):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.needsFinishedRoom else NOT_NEEDED
  require not j.finishedRoomApproved else ALREADY_APPROVED
  update jobs[job] { finishedRoomApproved: true, consent }
  return null

job closeQuotes(periodStart: time, periodEnd: time):
  for j in jobs:
    if j.status = 'quoted' and j.quotedAt >= periodEnd - 90d and j.quotedAt < periodEnd - 21d:
      update j { status: 'closed' }

schedule quoteCloser every 1d at 03:00: closeQuotes

-- Privacy intent from the spec. Homeowners see only their own jobs and
-- results; staff (coordinator, installer, owner) see the board they need.
invariant jobs.read only .homeowner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'owner']
invariant testResults.read only .job.homeowner = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'owner']
invariant roles.read only .principal = viewer or exists roles[viewer, role = 'coordinator'] or exists roles[viewer, role = 'installer'] or exists roles[viewer, role = 'owner']
invariant jobs.insert only exists roles[viewer, role = 'coordinator']
