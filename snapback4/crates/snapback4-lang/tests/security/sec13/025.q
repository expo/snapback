use identity password

table roles:
  principal: principal
  role: enum('candidate', 'registrar', 'instructor', 'manager')
  name: text 1..120
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or .role = 'candidate' and exists roles[viewer, role = 'registrar']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('candidate', 'registrar', 'instructor', 'manager'), name: text 1..120):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query myRole():
  return roles[viewer]
query candidates(c: cursor ?):
  require exists roles[viewer, role = 'registrar'] else NOT_REGISTRAR
  return roles where .role = 'candidate' last 100 by .id after c

table exams:
  candidate: principal
  candidateName: text 1..120
  attempt: int 1..100
  feeCents: int 0..20000
  bookedAt: time
  scheduledAt: time
  status: enum('booked', 'written', 'flight', 'passed', 'failed')
  writtenScore: int 0..100 ?
  flightScore: int 0..100 ?
  emergencyScore: int 0..100 ?
  completedAt: time ?
  scoredBy: principal ?
  unique candidate, attempt
  immutable candidate, candidateName, attempt, feeCents, bookedAt, scheduledAt
  read <- .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'registrar']
  update <- exists roles[viewer, role = 'instructor']
  online only

table documents:
  exam: exams
  candidate: principal
  scan: image <=5000000
  unique exam
  immutable exam, candidate, scan
  read <- .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'registrar']
  online only

table progress:
  candidate: principal
  latest: exams
  attempts: int 1..100
  unique candidate
  read <- .candidate = viewer or exists roles[viewer, role = 'registrar']
  insert <- exists roles[viewer, role = 'registrar']
  update <- exists roles[viewer, role = 'registrar']
  online only

table retests:
  exam: exams
  candidate: principal
  recommendation: text 10..1000
  instructor: principal
  requestedAt: time
  reason: text 10..1000 ?
  manager: principal ?
  approvedAt: time ?
  unique exam
  immutable exam, candidate, recommendation, instructor, requestedAt
  read <- .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'instructor'] and .instructor = viewer
  update <- exists roles[viewer, role = 'manager']
  online only

table certificates:
  exam: exams
  candidate: principal
  candidateName: text 1..120
  issuedAt: time
  expiresAt: time
  unique exam
  immutable exam, candidate, candidateName, issuedAt, expiresAt
  read <- .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'instructor']
  online only

invariant exams.read only .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
invariant documents.read only .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
invariant documents always .scan != null
invariant certificates.read only .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
invariant retests.approveRetest only exists roles[viewer, role = 'manager']

query board(c: cursor ?):
  if exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']:
    return exams last 100 by .id after c
  return exams where .candidate = viewer last 100 by .id after c
query examDetail(exam: exams):
  return exams[exam] ! else NOT_FOUND
query document(exam: exams):
  require exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager'] or exists exams[exam, candidate = viewer] else PRIVATE_DOCUMENT
  return documents[exam = exam]
query retestRequests(c: cursor ?):
  if exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']:
    return retests last 100 by .id after c
  return retests where .candidate = viewer last 100 by .id after c
query certificateList(c: cursor ?):
  if exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']:
    return certificates last 100 by .id after c
  return certificates where .candidate = viewer last 100 by .id after c
query certificateStatus(certificate: certificates):
  cert = certificates[certificate] ! else NOT_FOUND
  return { certificate: cert, valid: now < cert.expiresAt, checkedAt: now }

mutation bookExam(candidate: principal, scheduledAt: time, scan: image <=5000000, feeCents: int 0..20000):
  require exists roles[viewer, role = 'registrar'] else NOT_REGISTRAR
  person = roles[candidate, role = 'candidate'] ! else NOT_CANDIDATE
  require scheduledAt >= now and scheduledAt <= now + 90d else INVALID_DATE
  state = progress[candidate]
  attempt = 1
  fee = 20000
  if state != null:
    prior = exams[state.latest] ! else NOT_FOUND
    require prior.status = 'failed' else RETEST_REQUIRES_FAILURE
    require state.attempts < 100 else ATTEMPT_LIMIT
    attempt = state.attempts + 1
    if prior.completedAt != null and now <= prior.completedAt + 30d:
      fee = 10000
    if attempt > 2:
      approval = retests[exam = prior.id] ! else MANAGER_APPROVAL_REQUIRED
      require approval.approvedAt != null and approval.reason != null and approval.manager != null else MANAGER_APPROVAL_REQUIRED
  require feeCents = fee else INCORRECT_FEE 'Fee must be $200, or $100 within 30 days of a failed exam.'
  exam = insert exams { candidate, candidateName: person.name, attempt, feeCents, bookedAt: now, scheduledAt, status: 'booked' }
  insert documents { exam: exam.id, candidate, scan }
  upsert progress[candidate] { candidate, latest: exam.id, attempts: attempt }
  return exam

mutation scoreWritten(exam: exams, score: int 0..100):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  row = exams[exam] ! else NOT_FOUND
  require row.status = 'booked' else INVALID_STAGE
  require now >= row.scheduledAt else EXAM_NOT_DUE
  return update exams[exam] { writtenScore: score, status: 'written', scoredBy: viewer }
mutation scoreFlight(exam: exams, score: int 0..100):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  row = exams[exam] ! else NOT_FOUND
  require row.status = 'written' else INVALID_STAGE
  return update exams[exam] { flightScore: score, status: 'flight', scoredBy: viewer }
mutation scoreEmergency(exam: exams, score: int 0..100):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  row = exams[exam] ! else NOT_FOUND
  require row.status = 'flight' else INVALID_STAGE
  require row.writtenScore != null and row.flightScore != null else INVALID_STAGE
  passed = row.writtenScore >= 70 and row.flightScore >= 70 and score >= 70
  status = 'passed' if passed else 'failed'
  update exams[exam] { emergencyScore: score, status, completedAt: now, scoredBy: viewer }
  if passed:
    target = monthStart(month(now) + 24)
    days = (monthStart(month(now) + 25) - target) / 1d
    d = day(now) - day(monthStart(month(now)))
    expiresAt = target + (d if d < days else days - 1) * 1d + now % 1d
    insert certificates { exam, candidate: row.candidate, candidateName: row.candidateName, issuedAt: now, expiresAt }
  return exams[exam]
mutation recommendRetest(exam: exams, recommendation: text 10..1000):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  row = exams[exam] ! else NOT_FOUND
  require row.status = 'failed' and row.attempt >= 2 else INVALID_RETEST
  require not exists retests[exam = exam] else ALREADY_RECOMMENDED
  require trim(recommendation) != '' else INVALID_RECOMMENDATION
  return insert retests { exam, candidate: row.candidate, recommendation, instructor: viewer, requestedAt: now }
mutation approveRetest(request: retests, reason: text 10..1000):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  row = retests[request] ! else NOT_FOUND
  require row.approvedAt = null else ALREADY_APPROVED
  require trim(reason) != '' else INVALID_REASON
  return update retests[request] { reason, manager: viewer, approvedAt: now }
