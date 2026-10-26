-- Chainsaw Safety Certifications schema.
-- Roles: candidate, instructor, registrar, manager. Operator-provisioned roster.
use identity password

table roles:
  principal: principal
  role: enum('candidate', 'instructor', 'registrar', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  online only

-- One exam sitting. attempt counts sittings for this candidate (1, 2, 3...).
-- status: booked -> written -> felling -> maintenance -> passed | failed.
table exams:
  candidate: principal
  status: enum('booked', 'written', 'felling', 'maintenance', 'passed', 'failed')
  writtenScore: int 0..100 ?
  fellingScore: int 0..100 ?
  maintenanceScore: int 0..100 ?
  fee: int 0..100000
  photoId: image <=5000000
  attempt: int 1..10
  failedAt: time ?
  createdAt: time default now
  immutable candidate, attempt, createdAt
  read <- .candidate = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'registrar']
  update <- exists roles[viewer, role = 'instructor']
  delete <- deny
  online only

-- A certificate issued when an exam is passed; valid five years.
table certificates:
  candidate: principal
  exam: exams
  issuedAt: time default now
  expiresAt: time
  immutable candidate, exam, issuedAt, expiresAt
  read <- .candidate = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'instructor']
  update <- deny
  delete <- deny
  online only

-- Manager approval for a retest beyond the second attempt.
-- Granted before the registrar logs the new sitting; keyed by candidate + prior failed exam.
table retestApprovals:
  candidate: principal
  priorExam: exams
  reason: text 1..500
  recommendation: text 1..500
  approvedBy: principal
  at: time default now
  unique candidate, priorExam
  immutable candidate, priorExam
  read <- .candidate = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'manager']
  delete <- deny
  online only

-- Privacy intent, stated separately from enforcement.
invariant roles.read only .principal = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'instructor']
invariant exams.read only .candidate = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
invariant certificates.read only .candidate = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
invariant retestApprovals.read only .candidate = viewer or exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager']
invariant exams.insert only exists roles[viewer, role = 'registrar']
invariant exams.update only exists roles[viewer, role = 'instructor']
invariant certificates.insert only exists roles[viewer, role = 'instructor']
invariant retestApprovals.insert only exists roles[viewer, role = 'manager']
invariant retestApprovals.update only exists roles[viewer, role = 'manager']

mutation provision(principal: principal, role: enum('candidate', 'instructor', 'registrar', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query candidates(c: cursor ?):
  require exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'instructor'] else NOT_STAFF
  return roles where .role = 'candidate' last 50 by .id after c

-- Registrar logs an exam sitting with the candidate's photo-ID scan and fee.
-- FULL_FEE = 20000 cents ($200); a retest within 30 days of the failure costs 10000.
-- attempt >= 3 needs a prior manager approval for (candidate, priorExam).
mutation logExam(candidate: principal, fee: int 0..100000, photoId: image <=5000000, attempt: int 1..10, priorExam: exams ?):
  require exists roles[viewer, role = 'registrar'] else NOT_REGISTRAR
  require exists roles[principal = candidate, role = 'candidate'] else NOT_CANDIDATE
  if attempt = 1:
    require fee = 20000 else BAD_FEE 'First sitting costs 20000 cents.'
    require priorExam = null else BAD_PRIOR 'First sitting has no prior exam.'
  else:
    require priorExam != null else BAD_PRIOR 'Retest needs its prior exam.'
    p = exams[priorExam] ! else NOT_FOUND
    require p.candidate = candidate else BAD_PRIOR 'Prior exam belongs to another candidate.'
    require p.status = 'failed' else NOT_FAILED 'Retest needs a failed prior exam.'
    require p.failedAt != null else NOT_FAILED 'Prior exam has no failure time.'
    within = now <= p.failedAt + 30d
    if within:
      require fee = 10000 else BAD_FEE 'Retest within 30 days costs 10000 cents.'
    else:
      require fee = 20000 else BAD_FEE 'Retest after 30 days costs 20000 cents.'
    if attempt >= 3:
      require exists retestApprovals[candidate = candidate, priorExam = priorExam] else NOT_APPROVED 'Beyond the second attempt needs manager approval.'
  return insert exams { candidate, status: 'booked', fee, photoId, attempt, createdAt: now }

mutation scoreWritten(exam: exams, score: int 0..100):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  e = exams[exam] ! else NOT_FOUND
  require e.status = 'booked' else BAD_STATUS 'Written follows booking.'
  update exams[exam] { writtenScore: score, status: 'written' }
  return null

mutation scoreFelling(exam: exams, score: int 0..100):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  e = exams[exam] ! else NOT_FOUND
  require e.status = 'written' else BAD_STATUS 'Felling test follows the written exam.'
  update exams[exam] { fellingScore: score, status: 'felling' }
  return null

mutation scoreMaintenance(exam: exams, score: int 0..100):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  e = exams[exam] ! else NOT_FOUND
  require e.status = 'felling' else BAD_STATUS 'Maintenance check follows the felling test.'
  update exams[exam] { maintenanceScore: score, status: 'maintenance' }
  return null

-- Pass needs every stage scored at 70+. A pass issues a certificate valid five years.
mutation recordResult(exam: exams, passed: bool):
  require exists roles[viewer, role = 'instructor'] else NOT_INSTRUCTOR
  e = exams[exam] ! else NOT_FOUND
  require e.status = 'maintenance' else BAD_STATUS 'Result needs all three stages scored.'
  require e.writtenScore != null and e.fellingScore != null and e.maintenanceScore != null else BAD_STATUS 'All three stages need scores.'
  if passed:
    require e.writtenScore >= 70 and e.fellingScore >= 70 and e.maintenanceScore >= 70 else SCORE_TOO_LOW 'Passing needs 70+ on every stage.'
    update exams[exam] { status: 'passed' }
    return insert certificates { candidate: e.candidate, exam, issuedAt: now, expiresAt: now + 1825d }
  else:
    update exams[exam] { status: 'failed', failedAt: now }
    return null

mutation approveRetest(candidate: principal, priorExam: exams, reason: text 1..500, recommendation: text 1..500):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  p = exams[priorExam] ! else NOT_FOUND
  require p.candidate = candidate else BAD_PRIOR 'Approval is for the prior exam candidate.'
  require p.status = 'failed' else NOT_FAILED 'Only a failed exam can be re-approved.'
  return upsert retestApprovals[candidate = candidate, priorExam = priorExam] { candidate, priorExam, reason, recommendation, approvedBy: viewer, at: now }

query myExams(c: cursor ?):
  return exams where .candidate = viewer last 50 by .id after c

query yardBoard(c: cursor ?):
  require exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return exams last 50 by .id after c

query examDetail(exam: exams):
  return exams[exam]

query myCertificates(c: cursor ?):
  return certificates where .candidate = viewer last 50 by .id after c

query allCertificates(c: cursor ?):
  require exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return certificates last 50 by .id after c

query certificateValid(cert: certificates):
  found = certificates[cert]
  require found != null else NOT_FOUND
  return found.expiresAt > now

query myApprovals(c: cursor ?):
  return retestApprovals where .candidate = viewer last 50 by .id after c

query staffApprovals(c: cursor ?):
  require exists roles[viewer, role = 'instructor'] or exists roles[viewer, role = 'registrar'] or exists roles[viewer, role = 'manager'] else NOT_STAFF
  return retestApprovals last 50 by .id after c
