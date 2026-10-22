-- Locksmith Rekey Jobs.
--
-- Roles: customer (landlord/homeowner), dispatcher (opens jobs), locksmith
-- (works the live board booked -> onsite -> done), owner (approves lockouts
-- without ownership proof). Password accounts; roles are provisioned by the
-- local operator, never self-claimed.
use identity password

table roles:
  principal: principal
  role: enum('customer', 'dispatcher', 'locksmith', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'dispatcher', 'locksmith', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR 'Only the operator may grant roles.'
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query whoAmI():
  return viewer

-- Spec: every row a customer may read is their own job or their shop staff's
-- work; staff lanes cover the dispatcher, locksmith and owner rosters.
-- Spec: only dispatchers and the owner open jobs; the customer named on the
-- job never gains write authority from being named.
invariant jobs.read only .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner']
invariant jobs.insert only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
invariant jobs.openJob only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']

table jobs:
  customer: principal
  address: text 1..200
  detail: text <=500 ?
  proof: image <=10MB ?
  quoted: money USD ?
  status: enum('booked', 'onsite', 'done')
  requestedAt: time default now
  scheduledAt: time
  completedAt: time ?
  recutDeadline: time ?
  lockout: bool
  overdue: bool
  approvalReason: text 1..300 ?
  approvalWitness: text 1..80 ?
  approvedBy: principal ?
  immutable customer, requestedAt
  cap 500 by customer
  read <- .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  update (old, next) <- old.customer = next.customer and old.requestedAt = next.requestedAt and (exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner'])
  online only

-- The dispatcher opens each job with the ownership/lease photo and the quoted
-- charge, or without a charge when none has been quoted yet. A lockout job
-- carries no photo and must stay booked until the owner approves it. Overdue
-- is stamped at opening: scheduled more than seven days after the request.
mutation openJob(customer: principal, address: text 1..200, detail: text <=500 ?, proof: image <=10MB ?, quoted: money USD ?, scheduledAt: time, lockout: bool):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_DISPATCHER 'Only the dispatcher or owner may open jobs.'
  require quoted = null or quoted >= 1 else BAD_QUOTE 'The quoted charge must be positive.'
  require scheduledAt >= now else BAD_SCHEDULE 'The job must be scheduled for now or later.'
  require (lockout and proof = null) or (not lockout and proof != null) else BAD_PROOF_STATE 'Ordinary jobs need the ownership photo; lockout jobs must omit it.'
  req = now
  return insert jobs { customer, address, detail, proof, quoted, status: 'booked', requestedAt: req, scheduledAt, lockout, overdue: scheduledAt > req + 7d }

-- Spec: only the dispatcher or owner enters or revises the quoted charge;
-- customers and locksmiths cannot. A job opened before quoting carries a null
-- quote until this runs.
invariant jobs.setQuoted only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']

mutation setQuoted(job: jobs, quoted: money USD):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_DISPATCHER 'Only the dispatcher or owner may quote jobs.'
  j = jobs[job] ! else NOT_FOUND
  require quoted >= 1 else BAD_QUOTE 'The quoted charge must be positive.'
  update jobs[job] { quoted }
  return null

-- Spec: only staff move jobs, strictly booked -> onsite -> done; a lockout
-- without proof needs the owner's approval before onsite or done; completing
-- stamps the 30-day free-recut deadline.
-- Spec: only the owner approves a lockout without proof (see approveLockout).
invariant jobs.setJobStatus only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner']
invariant jobs.approveLockout only exists roles[principal = viewer, role = 'owner']

mutation setJobStatus(job: jobs, status: enum('booked', 'onsite', 'done')):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only shop staff may move jobs.'
  j = jobs[job] ! else NOT_FOUND
  require (j.status = 'booked' and status = 'onsite') or (j.status = 'onsite' and status = 'done') else BAD_TRANSITION 'Jobs move booked to onsite to done.'
  if j.lockout and j.proof = null:
    require j.approvalReason != null else NEEDS_LOCKOUT_APPROVAL 'A lockout without proof needs the owner approval first.'
  if status = 'done':
    stamp = now
    update jobs[job] { status, completedAt: stamp, recutDeadline: stamp + 30d }
  else:
    update jobs[job] { status }
  return null

-- Only the shop owner approves a lockout without ownership proof, recording
-- the reason and a witness name.
mutation approveLockout(job: jobs, reason: text 1..300, witness: text 1..80):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER 'Only the shop owner may approve a lockout.'
  j = jobs[job] ! else NOT_FOUND
  require j.lockout and j.proof = null else NOT_LOCKOUT 'Only a lockout without proof needs approval.'
  require j.approvalReason = null else ALREADY_APPROVED 'This lockout is already approved.'
  update jobs[job] { approvalReason: reason, approvalWitness: witness, approvedBy: viewer }
  return null

query jobDetail(job: jobs):
  return jobs[job]

-- Spec: locksmiths see the live job board; dispatchers and the owner too.
-- Customers use myJobs below, never this board.
query jobBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only shop staff may see the job board.'
  return jobs first 50 by .scheduledAt after c

query overdueJobs(c: cursor ?):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner'] else NOT_STAFF 'Only shop staff may see overdue jobs.'
  return jobs where .overdue = true first 50 by .scheduledAt after c

-- Spec: customers see only their own jobs and invoices.
query myJobs(c: cursor ?):
  return jobs where .customer = viewer first 50 by .id after c

-- Spec: the customer named on the job reads its invoices; staff read any job's.
invariant invoices.read only .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner']
invariant invoices.createInvoice only exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']

table invoices:
  job: jobs
  customer: principal
  amount: money USD
  issuedAt: time default now
  unique job else ALREADY_INVOICED 'One invoice per job.'
  immutable job, customer, amount
  read <- .customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner']
  online only

mutation createInvoice(job: jobs, amount: money USD):
  require exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'owner'] else NOT_DISPATCHER 'Only the dispatcher or owner may invoice.'
  j = jobs[job] ! else NOT_FOUND
  require j.quoted != null else NO_QUOTE 'The job has no quoted charge yet.'
  require amount = j.quoted else AMOUNT_MISMATCH 'The invoice must match the quoted charge.'
  return insert invoices { job, customer: j.customer, amount }

query myInvoices(c: cursor ?):
  return invoices where .customer = viewer first 50 by .id after c

query jobInvoices(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner'] else NOT_FOUND
  return invoices where .job = job first 20 by .id after c

-- Spec: the customer has 30 days after completion to report a key that does
-- not work for a free recut. The mutation compares server now against the
-- stamped deadline, so the window holds without waiting.
invariant recuts.reportRecut only exists jobs[.job, customer = viewer]

table recuts:
  job: jobs
  note: text 1..300
  reportedAt: time default now
  immutable job
  read <- exists jobs[.job, customer = viewer] or exists roles[principal = viewer, role = 'dispatcher'] or exists roles[principal = viewer, role = 'locksmith'] or exists roles[principal = viewer, role = 'owner']
  insert <- exists jobs[.job, customer = viewer]
  online only

mutation reportRecut(job: jobs, note: text 1..300):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_CUSTOMER 'Only the job customer may report a bad key.'
  require j.status = 'done' else NOT_DONE 'Keys can be reported once the job is done.'
  require j.recutDeadline != null else NOT_DONE 'The completion stamp is missing.'
  require now <= j.recutDeadline else RECUT_WINDOW_CLOSED 'The free recut window is 30 days after completion.'
  return insert recuts { job, note }

query recutsFor(job: jobs, c: cursor ?):
  j = jobs[job] ! else NOT_FOUND
  return recuts where .job = job first 50 by .id after c
