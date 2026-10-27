use identity password

-- A trusted operator provisions the staff roster; signup grants no staff role.
table staff:
  principal: principal
  role: enum('registrar', 'instructor', 'manager')
  unique principal
  immutable principal
  read <- exists staff[viewer] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

fn registrar(): exists staff[viewer, role = 'registrar']
fn instructor(): exists staff[viewer, role = 'instructor']
fn manager(): exists staff[viewer, role = 'manager']

table feePolicy:
  kind: enum('exam')
  currency: text 3..3
  fullFeeCents: int 2..
  passMark: int 1..100
  unique kind
  immutable kind
  read <- exists staff[viewer]
  insert <- manager()
  update <- manager()
  online only

table candidates:
  principal: principal
  fullName: text 1..120
  registeredAt: time
  registeredBy: principal
  unique principal
  immutable principal, fullName, registeredAt, registeredBy
  read <- .principal = viewer or exists staff[viewer]
  insert <- registrar() and .registeredBy = viewer
  online only

table exams:
  candidate: candidates
  owner: principal
  attempt: int 1..
  previous: exams ?
  approval: retestApprovals ?
  scheduledAt: time
  bookedAt: time
  bookedBy: principal
  photoId: image <=10000000
  feeCents: int 1..
  currency: text 3..3
  paymentReference: text 1..160
  passMark: int 1..100
  status: enum('booked', 'written', 'flight', 'emergency', 'passed', 'failed')
  writtenScore: int 0..100 ?
  writtenAt: time ?
  writtenBy: principal ?
  flightScore: int 0..100 ?
  flightAt: time ?
  flightBy: principal ?
  emergencyScore: int 0..100 ?
  emergencyAt: time ?
  emergencyBy: principal ?
  finishedAt: time ?
  unique candidate, attempt
  immutable candidate, owner, attempt, previous, approval, scheduledAt, bookedAt, bookedBy
  read (photoId, feeCents, currency, paymentReference) <- .owner = viewer or registrar() or manager()
  read <- .owner = viewer or exists staff[viewer]
  insert <- registrar() and .bookedBy = viewer and exists candidates[.candidate, principal = .owner]
  update <- instructor()
  online only

-- Recommendation and approval are distinct, immutable records, not editable flags.
table retestRecommendations:
  previous: exams
  owner: principal
  instructor: principal
  recommendation: text 1..2000
  recordedAt: time
  immutable previous, owner, instructor, recommendation, recordedAt
  read <- exists staff[viewer]
  insert <- instructor() and .instructor = viewer
  online only

table retestApprovals:
  previous: exams
  recommendation: retestRecommendations
  manager: principal
  reason: text 1..2000
  approvedAt: time
  unique previous
  immutable previous, recommendation, manager, reason, approvedAt
  read <- exists staff[viewer]
  insert <- manager() and .manager = viewer
  online only

table certificates:
  exam: exams
  candidate: candidates
  owner: principal
  issuedAt: time
  expiresAt: time
  issuedBy: principal
  unique exam
  immutable exam, candidate, owner, issuedAt, expiresAt, issuedBy
  read <- .owner = viewer or registrar() or manager()
  insert <- instructor() and .issuedBy = viewer and exists exams[.exam, owner = .owner, status = 'passed']
  online only

-- Product intent: candidates have no access to another candidate's records;
-- instructors get progress and scoring, but no ID scans or payment details.
invariant candidates.read only .principal = viewer or exists staff[viewer]
invariant staff.role write only viewer = 'service:operator'
invariant exams.read only .owner = viewer or exists staff[viewer]
invariant exams.photoId read only .owner = viewer or registrar() or manager()
invariant exams.feeCents read only .owner = viewer or registrar() or manager()
invariant exams.currency read only .owner = viewer or registrar() or manager()
invariant exams.paymentReference read only .owner = viewer or registrar() or manager()
invariant exams.insert only registrar()
invariant exams.update only instructor()
invariant exams always .photoId != null
invariant exams always .attempt <= 2 or .approval != null
invariant retestRecommendations.insert only instructor()
invariant retestApprovals.insert only manager()
invariant retestApprovals always .reason != null and .recommendation != null
invariant certificates.read only .owner = viewer or registrar() or manager()
invariant certificates.insert only instructor()

mutation provision(principal: principal, role: enum('registrar', 'instructor', 'manager')):
  require viewer = 'service:operator' else OPERATOR_ONLY
  return upsert staff[principal = principal] { principal, role }

mutation configureFees(currency: text 3..3, fullFeeCents: int 2.., passMark: int 1..100):
  require manager() else MANAGER_ONLY
  require fullFeeCents % 2 = 0 else FEE_MUST_HAVE_EXACT_HALF
  upsert feePolicy[kind = 'exam'] { kind: 'exam', currency, fullFeeCents, passMark }
  return null

mutation registerCandidate(principal: principal, fullName: text 1..120):
  require registrar() else REGISTRAR_ONLY
  return insert candidates { principal, fullName, registeredAt: now, registeredBy: viewer }

mutation bookInitial(candidate: candidates, scheduledAt: time, photoId: image <=10000000, paidCents: int 1.., paymentReference: text 1..160):
  require registrar() else REGISTRAR_ONLY
  person = candidates[candidate] ! else CANDIDATE_NOT_FOUND
  policy = feePolicy[kind = 'exam'] ! else FEES_NOT_CONFIGURED
  require scheduledAt >= now else EXAM_IN_PAST
  require paidCents = policy.fullFeeCents else INCORRECT_FEE
  return insert exams { candidate, owner: person.principal, attempt: 1, scheduledAt, bookedAt: now, bookedBy: viewer, photoId, feeCents: paidCents, currency: policy.currency, paymentReference, passMark: policy.passMark, status: 'booked' }

mutation recommendRetest(previous: exams, recommendation: text 1..2000):
  require instructor() else INSTRUCTOR_ONLY
  exam = exams[previous] ! else EXAM_NOT_FOUND
  require exam.status = 'failed' and exam.attempt >= 2 else EXTRA_ATTEMPT_NOT_APPLICABLE
  return insert retestRecommendations { previous, owner: exam.owner, instructor: viewer, recommendation, recordedAt: now }

mutation approveRetest(recommendation: retestRecommendations, reason: text 1..2000):
  require manager() else MANAGER_ONLY
  advice = retestRecommendations[recommendation] ! else RECOMMENDATION_NOT_FOUND
  exam = exams[advice.previous] ! else EXAM_NOT_FOUND
  require exam.status = 'failed' and exam.attempt >= 2 else EXTRA_ATTEMPT_NOT_APPLICABLE
  require advice.recordedAt <= now else FUTURE_RECOMMENDATION
  return insert retestApprovals { previous: exam.id, recommendation, manager: viewer, reason, approvedAt: now }

mutation bookRetest(previous: exams, scheduledAt: time, photoId: image <=10000000, paidCents: int 1.., paymentReference: text 1..160):
  require registrar() else REGISTRAR_ONLY
  exam = exams[previous] ! else EXAM_NOT_FOUND
  require exam.status = 'failed' else RETEST_REQUIRES_FAILURE
  require exam.finishedAt != null else FAILURE_TIME_REQUIRED
  require now >= exam.finishedAt and scheduledAt >= now else EXAM_IN_PAST
  policy = feePolicy[kind = 'exam'] ! else FEES_NOT_CONFIGURED
  fee = policy.fullFeeCents / 2 if scheduledAt <= exam.finishedAt + 30d else policy.fullFeeCents
  require paidCents = fee else INCORRECT_FEE
  authorization = null
  if exam.attempt >= 2:
    decision = retestApprovals[previous = previous] ! else MANAGER_APPROVAL_REQUIRED
    require decision.approvedAt <= now else FUTURE_APPROVAL
    authorization = decision.id
  return insert exams { candidate: exam.candidate, owner: exam.owner, attempt: exam.attempt + 1, previous, approval: authorization, scheduledAt, bookedAt: now, bookedBy: viewer, photoId, feeCents: paidCents, currency: policy.currency, paymentReference, passMark: policy.passMark, status: 'booked' }

mutation scoreWritten(exam: exams, score: int 0..100):
  require instructor() else INSTRUCTOR_ONLY
  row = exams[exam] ! else EXAM_NOT_FOUND
  require row.status = 'booked' else WRONG_STAGE
  require now >= row.scheduledAt else EXAM_NOT_STARTED
  update exams[exam] { writtenScore: score, writtenAt: now, writtenBy: viewer, status: 'written' }
  return null

mutation scoreFlight(exam: exams, score: int 0..100):
  require instructor() else INSTRUCTOR_ONLY
  row = exams[exam] ! else EXAM_NOT_FOUND
  require row.status = 'written' else WRONG_STAGE
  require row.writtenAt != null else WRITTEN_EVIDENCE_REQUIRED
  require now >= row.writtenAt else CLOCK_ORDER
  update exams[exam] { flightScore: score, flightAt: now, flightBy: viewer, status: 'flight' }
  return null

mutation scoreEmergency(exam: exams, score: int 0..100):
  require instructor() else INSTRUCTOR_ONLY
  row = exams[exam] ! else EXAM_NOT_FOUND
  require row.status = 'flight' else WRONG_STAGE
  require row.flightAt != null else FLIGHT_EVIDENCE_REQUIRED
  require now >= row.flightAt else CLOCK_ORDER
  update exams[exam] { emergencyScore: score, emergencyAt: now, emergencyBy: viewer, status: 'emergency' }
  return null

-- Two calendar years in UTC; February 29 clamps to February 28, same time.
fn certificateDeadline(issued: time):
  targetMonth = month(issued) + 24
  dayOffset = day(issued) - day(monthStart(month(issued)))
  finalDay = (monthStart(targetMonth + 1) - monthStart(targetMonth)) / 1d - 1
  clampedDay = dayOffset if dayOffset <= finalDay else finalDay
  return monthStart(targetMonth) + clampedDay * 1d + issued % 1d

mutation finalizeExam(exam: exams):
  require instructor() else INSTRUCTOR_ONLY
  row = exams[exam] ! else EXAM_NOT_FOUND
  require row.status = 'emergency' else WRONG_STAGE
  require row.writtenScore != null and row.flightScore != null and row.emergencyScore != null else SCORES_REQUIRED
  require row.emergencyAt != null else EMERGENCY_EVIDENCE_REQUIRED
  require now >= row.emergencyAt else CLOCK_ORDER
  passed = row.writtenScore >= row.passMark and row.flightScore >= row.passMark and row.emergencyScore >= row.passMark
  if passed:
    update exams[exam] { status: 'passed', finishedAt: now }
    insert certificates { exam, candidate: row.candidate, owner: row.owner, issuedAt: now, expiresAt: certificateDeadline(now), issuedBy: viewer }
  else:
    update exams[exam] { status: 'failed', finishedAt: now }
  return null

query myExams(c: cursor ?):
  return exams where .owner = viewer last 50 by .bookedAt, .id after c

query myCertificates(c: cursor ?):
  return certificates where .owner = viewer last 50 by .issuedAt, .id after c

query examDetails(exam: exams):
  return exams[exam]

query certificateStatus(certificate: certificates):
  row = certificates[certificate] ! else CERTIFICATE_NOT_FOUND
  return { certificate: row, valid: now >= row.issuedAt and now < row.expiresAt, checkedAt: now }

query fieldBoard(c: cursor ?):
  require instructor() or registrar() or manager() else STAFF_ONLY
  return exams where .status != 'passed' and .status != 'failed' last 50 by .bookedAt, .id after c { id, candidate, candidateName: candidates[.candidate].fullName, owner, attempt, scheduledAt, status, writtenScore, flightScore, emergencyScore }

query recommendations(c: cursor ?):
  require exists staff[viewer] else STAFF_ONLY
  return retestRecommendations last 50 by .recordedAt, .id after c

query approvals(c: cursor ?):
  require exists staff[viewer] else STAFF_ONLY
  return retestApprovals last 50 by .approvedAt, .id after c

query currentFees():
  require exists staff[viewer] else STAFF_ONLY
  return feePolicy[kind = 'exam']
