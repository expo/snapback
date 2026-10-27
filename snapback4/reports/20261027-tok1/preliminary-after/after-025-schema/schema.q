use identity password

-- A single school; role assignment is an operator-only roster operation.
table roles:
  principal: principal
  role: enum('candidate', 'registrar', 'instructor', 'manager')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'manager']
  insert <- viewer = 'service:operator'
  online only

table candidates:
  principal: principal
  name: text 1..120
  standardFeeCents: int 2..1000000 read <- .principal = viewer or isRegistrar() or isManager()
  attempts: int 0..10000 default 0
  state: enum('new', 'booked', 'failed', 'passed', 'certified') default 'new'
  latestExam: exams ?
  lastFailedAt: time ?
  enrolledAt: time
  enrolledBy: principal
  unique principal
  immutable principal, name, standardFeeCents, enrolledAt, enrolledBy
  read <- .principal = viewer or isStaff()
  insert <- isRegistrar()
  update <- isRegistrar() or isInstructor()
  online only

table exams:
  candidate: principal
  candidateName: text 1..120
  attempt: int 1..10000
  photoId: image <=10000000 read <- .candidate = viewer or isRegistrar() or isManager()
  feeCents: int 1..1000000 read <- .candidate = viewer or isRegistrar() or isManager()
  discounted: bool
  bookedAt: time
  bookedBy: principal
  scheduledAt: time
  status: enum('booked', 'written', 'flight', 'emergency', 'passed', 'failed') default 'booked'
  writtenScore: int 0..100 ?
  writtenAt: time ?
  writtenBy: principal ?
  flightScore: int 0..100 ?
  flightAt: time ?
  flightBy: principal ?
  emergencyScore: int 0..100 ?
  emergencyAt: time ?
  emergencyBy: principal ?
  completedAt: time ?
  completedBy: principal ?
  unique candidate, attempt
  immutable candidate, candidateName, attempt, photoId, feeCents, discounted, bookedAt, bookedBy, scheduledAt
  read <- .candidate = viewer or isStaff()
  insert <- isRegistrar()
  update <- isInstructor()
  online only

-- One recommendation/decision for each failed exam, consumed by its next retest.
table retestApprovals:
  candidate: principal
  failedExam: exams
  nextAttempt: int 3..10000
  recommendation: text 1..2000
  recommendedBy: principal
  recommendedAt: time
  state: enum('pending', 'approved', 'rejected', 'used') default 'pending'
  reason: text 1..2000 ?
  decidedBy: principal ?
  decidedAt: time ?
  usedAt: time ?
  unique failedExam
  immutable candidate, failedExam, nextAttempt, recommendation, recommendedBy, recommendedAt
  read <- isStaff()
  insert <- isInstructor()
  update <- isManager() or isRegistrar()
  online only

table certificates:
  candidate: principal
  candidateName: text 1..120
  exam: exams
  issuedAt: time
  expiresAt: time
  issuedBy: principal
  unique exam
  immutable candidate, candidateName, exam, issuedAt, expiresAt, issuedBy
  read <- .candidate = viewer or isStaff()
  insert <- isRegistrar()
  online only

fn isRegistrar(): exists roles[viewer, role = 'registrar']
fn isInstructor(): exists roles[viewer, role = 'instructor']
fn isManager(): exists roles[viewer, role = 'manager']
fn isStaff(): isRegistrar() or isInstructor() or isManager()

fn enforceRetestWindow(candidate: principal, discounted: bool):
  if discounted:
    person = candidates[candidate] ! else NOT_FOUND
    failedAt = person.lastFailedAt ! else NO_FAILED_RESULT
    require now >= failedAt and now <= failedAt + 30d else DISCOUNT_WINDOW_CLOSED

-- Two UTC calendar years, preserving time of day and clamping Feb 29 to Feb 28.
fn certificateExpiry(issuedAt: time):
  sourceMonth = month(issuedAt)
  targetStart = monthStart(sourceMonth + 24)
  targetEnd = monthStart(sourceMonth + 25)
  sourceDay = day(issuedAt) - day(monthStart(sourceMonth))
  targetDay = min(sourceDay, day(targetEnd) - day(targetStart) - 1)
  return targetStart + targetDay * 86400000 + (issuedAt % 86400000)

mutation provision(principal: principal, role: enum('candidate', 'registrar', 'instructor', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role } if absent

mutation enrollCandidate(candidate: principal, name: text 1..120, standardFeeCents: int 2..1000000):
  require isRegistrar() else NOT_REGISTRAR
  require exists roles[candidate, role = 'candidate'] else NOT_CANDIDATE
  require standardFeeCents % 2 = 0 else FEE_MUST_ALLOW_EXACT_HALF
  return insert candidates { principal: candidate, name, standardFeeCents, enrolledAt: now, enrolledBy: viewer }

mutation bookExam(candidate: principal, photoId: image <=10000000, scheduledAt: time, feeCents: int 1..1000000):
  require isRegistrar() else NOT_REGISTRAR
  person = candidates[candidate] ! else NOT_FOUND
  require scheduledAt >= now else PAST_BOOKING
  require person.state = 'new' or person.state = 'failed' else EXAM_ALREADY_ACTIVE_OR_PASSED
  require person.attempts < 10000 else ATTEMPT_LIMIT
  attempt = person.attempts + 1
  standardFee = person.standardFeeCents ! else FEE_NOT_VISIBLE
  expectedFee = standardFee
  discounted = false
  if person.state = 'failed':
    failedAt = person.lastFailedAt ! else NO_FAILED_RESULT
    require now >= failedAt else CLOCK_BEFORE_FAILURE
    -- The actual scheduled retest must fit inside the window, not just booking.
    if scheduledAt <= failedAt + 30d:
      expectedFee = standardFee / 2
      discounted = true
    if attempt > 2:
      failedExam = person.latestExam ! else NO_PREVIOUS_EXAM
      approval = retestApprovals[failedExam] ! else MANAGER_APPROVAL_REQUIRED
      require approval.state = 'approved' else MANAGER_APPROVAL_REQUIRED
      require approval.candidate = candidate and approval.nextAttempt = attempt else WRONG_APPROVAL
      decidedAt = approval.decidedAt ! else NO_APPROVAL_TIMESTAMP
      require now >= decidedAt else CLOCK_BEFORE_APPROVAL
      update retestApprovals[failedExam] { state: 'used', usedAt: now }
  require feeCents = expectedFee else INCORRECT_EXAM_FEE
  exam = insert exams { candidate, candidateName: person.name, attempt, photoId, feeCents, discounted, bookedAt: now, bookedBy: viewer, scheduledAt }
  update candidates[candidate] { attempts: attempt, state: 'booked', latestExam: exam.id }
  return exam

mutation scoreWritten(exam: exams, score: int 0..100):
  require isInstructor() else NOT_INSTRUCTOR
  row = exams[exam] ! else NOT_FOUND
  require now >= row.scheduledAt else EXAM_NOT_STARTED
  enforceRetestWindow(row.candidate, row.discounted)
  require row.status = 'booked' else WRONG_STAGE
  update exams[exam] { writtenScore: score, writtenAt: now, writtenBy: viewer, status: 'written' }
  return null

mutation scoreFlightTest(exam: exams, score: int 0..100):
  require isInstructor() else NOT_INSTRUCTOR
  row = exams[exam] ! else NOT_FOUND
  require now >= row.scheduledAt else EXAM_NOT_STARTED
  enforceRetestWindow(row.candidate, row.discounted)
  require row.status = 'written' else WRONG_STAGE
  writtenAt = row.writtenAt ! else WRITTEN_REQUIRED
  require now >= writtenAt else CLOCK_BEFORE_WRITTEN
  update exams[exam] { flightScore: score, flightAt: now, flightBy: viewer, status: 'flight' }
  return null

mutation scoreEmergencyDrill(exam: exams, score: int 0..100):
  require isInstructor() else NOT_INSTRUCTOR
  row = exams[exam] ! else NOT_FOUND
  require now >= row.scheduledAt else EXAM_NOT_STARTED
  enforceRetestWindow(row.candidate, row.discounted)
  require row.status = 'flight' else WRONG_STAGE
  flightAt = row.flightAt ! else FLIGHT_REQUIRED
  require now >= flightAt else CLOCK_BEFORE_FLIGHT
  update exams[exam] { emergencyScore: score, emergencyAt: now, emergencyBy: viewer, status: 'emergency' }
  return null

-- The school's instructor judges pass/fail; the spec supplies no numeric rubric.
mutation finalizeExam(exam: exams, passed: bool):
  require isInstructor() else NOT_INSTRUCTOR
  row = exams[exam] ! else NOT_FOUND
  require now >= row.scheduledAt else EXAM_NOT_STARTED
  enforceRetestWindow(row.candidate, row.discounted)
  require row.status = 'emergency' else SCORES_REQUIRED
  require row.writtenScore != null and row.flightScore != null and row.emergencyScore != null else SCORES_REQUIRED
  emergencyAt = row.emergencyAt ! else EMERGENCY_REQUIRED
  require now >= emergencyAt else CLOCK_BEFORE_EMERGENCY
  person = candidates[row.candidate] ! else NOT_FOUND
  require person.latestExam = exam and person.state = 'booked' else STALE_EXAM
  if passed:
    update exams[exam] { status: 'passed', completedAt: now, completedBy: viewer }
    update candidates[row.candidate] { state: 'passed' }
  else:
    update exams[exam] { status: 'failed', completedAt: now, completedBy: viewer }
    update candidates[row.candidate] { state: 'failed', lastFailedAt: now }
  return null

mutation recommendRetest(failedExam: exams, recommendation: text 1..2000):
  require isInstructor() else NOT_INSTRUCTOR
  row = exams[failedExam] ! else NOT_FOUND
  failedAt = row.completedAt ! else NO_FAILED_RESULT
  require now >= failedAt else CLOCK_BEFORE_FAILURE
  require row.status = 'failed' and row.attempt >= 2 else APPROVAL_NOT_APPLICABLE
  person = candidates[row.candidate] ! else NOT_FOUND
  require person.latestExam = failedExam and person.state = 'failed' else STALE_EXAM
  return insert retestApprovals { candidate: row.candidate, failedExam, nextAttempt: row.attempt + 1, recommendation, recommendedBy: viewer, recommendedAt: now }

mutation approveRetest(failedExam: exams, reason: text 1..2000):
  require isManager() else NOT_MANAGER
  approval = retestApprovals[failedExam] ! else NO_RECOMMENDATION
  require now >= approval.recommendedAt else CLOCK_BEFORE_RECOMMENDATION
  require approval.state = 'pending' else ALREADY_DECIDED
  person = candidates[approval.candidate] ! else NOT_FOUND
  require person.state = 'failed' and person.latestExam = failedExam else STALE_EXAM
  update retestApprovals[failedExam] { state: 'approved', reason, decidedBy: viewer, decidedAt: now }
  return null

mutation rejectRetest(failedExam: exams, reason: text 1..2000):
  require isManager() else NOT_MANAGER
  approval = retestApprovals[failedExam] ! else NO_RECOMMENDATION
  require now >= approval.recommendedAt else CLOCK_BEFORE_RECOMMENDATION
  require approval.state = 'pending' else ALREADY_DECIDED
  update retestApprovals[failedExam] { state: 'rejected', reason, decidedBy: viewer, decidedAt: now }
  return null

mutation issueCertificate(exam: exams):
  require isRegistrar() else NOT_REGISTRAR
  row = exams[exam] ! else NOT_FOUND
  completedAt = row.completedAt ! else NO_COMPLETED_EXAM
  require now >= completedAt else CLOCK_BEFORE_COMPLETION
  require row.status = 'passed' else PASS_REQUIRED
  person = candidates[row.candidate] ! else NOT_FOUND
  require person.latestExam = exam and person.state = 'passed' else STALE_EXAM
  certificate = insert certificates { candidate: row.candidate, candidateName: row.candidateName, exam, issuedAt: now, expiresAt: certificateExpiry(now), issuedBy: viewer }
  update candidates[row.candidate] { state: 'certified' }
  return certificate

query myExams(c: cursor ?):
  require exists roles[viewer, role = 'candidate'] else NOT_CANDIDATE
  return exams where .candidate = viewer last 50 by .id after c

query myCertificates(c: cursor ?):
  require exists roles[viewer, role = 'candidate'] else NOT_CANDIDATE
  return certificates where .candidate = viewer last 50 by .id after c

query certificateStatus(certificate: certificates):
  row = certificates[certificate] ! else NOT_FOUND
  return { certificate: row, valid: now >= row.issuedAt and now < row.expiresAt, checkedAt: now }

-- Observe this query for the live board; private evidence/fees are omitted.
query fieldBoard(c: cursor ?):
  require isStaff() else NOT_STAFF
  return exams where .status = 'booked' or .status = 'written' or .status = 'flight' or .status = 'emergency' last 100 by .id after c

query candidateRoster(c: cursor ?):
  require isStaff() else NOT_STAFF
  return candidates last 50 by .id after c

query approvalQueue(c: cursor ?):
  require isStaff() else NOT_STAFF
  return retestApprovals where .state = 'pending' last 50 by .id after c

invariant roles.insert only viewer = 'service:operator'
invariant candidates.read only .principal = viewer or isStaff()
invariant exams.read only .candidate = viewer or isStaff()
invariant exams.photoId read only .candidate = viewer or isRegistrar() or isManager()
invariant exams.feeCents read only .candidate = viewer or isRegistrar() or isManager()
invariant retestApprovals.read only isStaff()
invariant certificates.read only .candidate = viewer or isStaff()
