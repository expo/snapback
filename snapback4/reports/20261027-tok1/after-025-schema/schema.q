use identity password

table roles:
  principal: principal
  role: enum('candidate', 'registrar', 'instructor', 'manager')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  insert <- viewer = 'service:operator'
  online only

table schoolFees:
  name: text 1..20
  fullFee: money USD
  unique name
  read <- exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'manager']
  online only

table candidates:
  principal: principal
  displayName: text 1..120
  attempts: int 0.. default 0
  latestOutcome: enum('none', 'pending', 'passed', 'failed') default 'none'
  lastFailedAt: time ?
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'registrar']
  update <- exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor']
  online only

table exams:
  candidate: principal
  attempt: int 1..
  candidateName: text 1..120
  photoId: image <=10000000 read <- .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  feePaid: money USD read <- .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  fullFee: money USD read <- .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  discounted: bool
  bookedAt: time
  registrar: principal
  status: enum('booked', 'written', 'flight_scored', 'drill_scored', 'passed', 'failed') default 'booked'
  writtenScore: int 0..100 ?
  writtenResult: enum('passed', 'failed') ?
  writtenAt: time ?
  writtenBy: principal ?
  flightScore: int 0..100 ?
  flightResult: enum('passed', 'failed') ?
  flightAt: time ?
  flightBy: principal ?
  drillScore: int 0..100 ?
  drillResult: enum('passed', 'failed') ?
  drillAt: time ?
  drillBy: principal ?
  completedAt: time ?
  unique candidate, attempt
  immutable candidate, attempt, candidateName, photoId, feePaid, fullFee, discounted, bookedAt, registrar
  read <- .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'registrar']
  update <- exists roles[viewer, role = 'instructor']
  online only

table retestApprovals:
  candidate: principal
  attempt: int 3..
  recommendation: text 1..2000
  recommendedBy: principal
  recommendedAt: time
  status: enum('requested', 'approved', 'declined') default 'requested'
  reason: text 1..2000 ?
  decidedBy: principal ?
  decidedAt: time ?
  unique candidate, attempt
  immutable candidate, attempt, recommendation, recommendedBy, recommendedAt
  read <- exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'instructor']
  update <- exists roles[viewer, role = 'manager']
  online only

table certificates:
  candidate: principal
  attempt: int 1..
  candidateName: text 1..120
  issuedAt: time
  expiresAt: time
  issuedBy: principal
  unique candidate, attempt
  immutable candidate, attempt, candidateName, issuedAt, expiresAt, issuedBy
  read <- .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'instructor']
  online only

mutation provision(principal: principal, role: enum('candidate', 'registrar', 'instructor', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role } if absent

mutation setFee(fullFee: money USD):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  require fullFee > 0 else INVALID_FEE
  require divide(fullFee, 2, 'toward-zero') * 2 = fullFee else HALF_FEE_MUST_BE_WHOLE_CENTS
  if exists schoolFees[name = 'commercial']:
    update schoolFees[name = 'commercial'] { fullFee }
    return null
  insert schoolFees { name: 'commercial', fullFee }
  return null

mutation registerCandidate(principal: principal, displayName: text 1..120):
  require exists roles[viewer, role = 'registrar'] else NOT_REGISTRAR
  require exists roles[principal, role = 'candidate'] else NOT_CANDIDATE
  return insert candidates { principal, displayName, lastFailedAt: null }

mutation bookExam(candidate: principal, photoId: image <=10000000, feePaid: money USD):
  require exists roles[viewer, role = 'registrar'] else NOT_REGISTRAR
  person = candidates[candidate] ! else CANDIDATE_NOT_FOUND
  fees = schoolFees[name = 'commercial'] ! else FEE_NOT_CONFIGURED
  require person.latestOutcome = 'none' or person.latestOutcome = 'failed' else CANNOT_BOOK
  nextAttempt = person.attempts + 1
  if nextAttempt > 2:
    approval = retestApprovals[candidate, nextAttempt] ! else APPROVAL_REQUIRED
    require approval.status = 'approved' else APPROVAL_REQUIRED
  -- The server decides eligibility at booking; the failed exam's time is never supplied by a caller.
  discounted = person.lastFailedAt != null and now >= person.lastFailedAt and now <= person.lastFailedAt + 30d
  if discounted:
    require feePaid * 2 = fees.fullFee else WRONG_FEE
  else:
    require feePaid = fees.fullFee else WRONG_FEE
  exam = insert exams { candidate, attempt: nextAttempt, candidateName: person.displayName, photoId, feePaid, fullFee: fees.fullFee, discounted, bookedAt: now, registrar: viewer }
  update candidates[candidate] { attempts: nextAttempt, latestOutcome: 'pending' }
  return exam

mutation scoreWritten(candidate: principal, attempt: int 1.., score: int 0..100, result: enum('passed', 'failed')):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  exam = exams[candidate, attempt] ! else EXAM_NOT_FOUND
  require exam.status = 'booked' else WRONG_STAGE
  update exams[candidate, attempt] { status: 'written', writtenScore: score, writtenResult: result, writtenAt: now, writtenBy: viewer }
  return null

mutation scoreFlight(candidate: principal, attempt: int 1.., score: int 0..100, result: enum('passed', 'failed')):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  exam = exams[candidate, attempt] ! else EXAM_NOT_FOUND
  require exam.status = 'written' else WRONG_STAGE
  update exams[candidate, attempt] { status: 'flight_scored', flightScore: score, flightResult: result, flightAt: now, flightBy: viewer }
  return null

mutation scoreEmergencyDrill(candidate: principal, attempt: int 1.., score: int 0..100, result: enum('passed', 'failed')):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  exam = exams[candidate, attempt] ! else EXAM_NOT_FOUND
  require exam.status = 'flight_scored' else WRONG_STAGE
  update exams[candidate, attempt] { status: 'drill_scored', drillScore: score, drillResult: result, drillAt: now, drillBy: viewer }
  return null

mutation completeExam(candidate: principal, attempt: int 1..):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  exam = exams[candidate, attempt] ! else EXAM_NOT_FOUND
  person = candidates[candidate] ! else CANDIDATE_NOT_FOUND
  require person.attempts = attempt and person.latestOutcome = 'pending' else STALE_EXAM
  require exam.status = 'drill_scored' else WRONG_STAGE
  if exam.writtenResult = 'passed' and exam.flightResult = 'passed' and exam.drillResult = 'passed':
    update exams[candidate, attempt] { status: 'passed', completedAt: now }
    update candidates[candidate] { latestOutcome: 'passed' }
    -- Preserve the UTC anniversary and time of day, clamping February 29 to February 28.
    targetMonth = month(now) + 24
    targetStart = monthStart(targetMonth)
    targetEnd = monthStart(targetMonth + 1)
    offset = now - monthStart(month(now))
    if offset >= targetEnd - targetStart:
      return insert certificates { candidate, attempt, candidateName: exam.candidateName, issuedAt: now, expiresAt: targetEnd - 1d + (offset % 1d), issuedBy: viewer }
    return insert certificates { candidate, attempt, candidateName: exam.candidateName, issuedAt: now, expiresAt: targetStart + offset, issuedBy: viewer }
  update exams[candidate, attempt] { status: 'failed', completedAt: now }
  update candidates[candidate] { latestOutcome: 'failed', lastFailedAt: now }
  return null

mutation recommendRetest(candidate: principal, recommendation: text 1..2000):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  person = candidates[candidate] ! else CANDIDATE_NOT_FOUND
  require person.latestOutcome = 'failed' and person.attempts >= 2 else NOT_EXTRA_RETEST
  return insert retestApprovals { candidate, attempt: person.attempts + 1, recommendation, recommendedBy: viewer, recommendedAt: now, reason: null, decidedBy: null, decidedAt: null }

mutation approveRetest(candidate: principal, attempt: int 3.., reason: text 1..2000):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  approval = retestApprovals[candidate, attempt] ! else RECOMMENDATION_REQUIRED
  person = candidates[candidate] ! else CANDIDATE_NOT_FOUND
  require person.latestOutcome = 'failed' and person.attempts + 1 = attempt else STALE_REQUEST
  require approval.status = 'requested' else ALREADY_DECIDED
  update retestApprovals[candidate, attempt] { status: 'approved', reason, decidedBy: viewer, decidedAt: now }
  return null

mutation declineRetest(candidate: principal, attempt: int 3.., reason: text 1..2000):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  approval = retestApprovals[candidate, attempt] ! else RECOMMENDATION_REQUIRED
  person = candidates[candidate] ! else CANDIDATE_NOT_FOUND
  require person.latestOutcome = 'failed' and person.attempts + 1 = attempt else STALE_REQUEST
  require approval.status = 'requested' else ALREADY_DECIDED
  update retestApprovals[candidate, attempt] { status: 'declined', reason, decidedBy: viewer, decidedAt: now }
  return null

query myExams(c: cursor ?):
  return exams where .candidate = viewer last 50 by .id after c

query myCertificates(c: cursor ?):
  return certificates where .candidate = viewer last 50 by .id after c

query certificateValidity(candidate: principal, attempt: int 1..):
  certificate = certificates[candidate, attempt] ! else CERTIFICATE_NOT_FOUND
  return { certificate, valid: now >= certificate.issuedAt and now < certificate.expiresAt, checkedAt: now }

query fieldBoard(c: cursor ?):
  require exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return exams where .status != 'passed' and .status != 'failed' last 50 by .id after c

query approvalBoard(c: cursor ?):
  require exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] else NOT_STAFF
  return retestApprovals last 50 by .id after c

invariant exams.read only .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
invariant certificates.read only .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'manager']
invariant exams.photoId read only .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
invariant exams.feePaid read only .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
invariant exams.fullFee read only .candidate = viewer or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
invariant retestApprovals.update only exists roles[viewer, role = 'manager']
