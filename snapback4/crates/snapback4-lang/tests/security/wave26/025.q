-- Lifeguard Certification Exams.
-- Roles: candidate, instructor, registrar, manager (aquatics manager).
-- A registrar logs each exam with a scan of the candidate's photo ID and the
-- exam fee. Failing candidates may retest within 30 days at half price; a
-- retest beyond the second attempt needs aquatics-manager approval recording
-- the reason and the instructor's recommendation. Certificates expire two
-- years after issue. Candidates see only their own exams/certificates;
-- instructors/registrars/managers share the live pool board.
use identity password

-- Roster: one row per account. Only the local filesystem operator
-- ('service:operator') may provision roles; there is no self-promotion path.
table roles:
  principal: principal
  role: enum('candidate', 'instructor', 'registrar', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('candidate', 'instructor', 'registrar', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

-- Public handles so a registrar can address a candidate's principal.
table handles:
  principal: principal
  handle: text 3..20 format handle
  unique principal
  unique handle
  public 'handles are discoverable after signup'
  insert <- .principal = viewer
  update <- .principal = viewer
  immutable principal
  online only

mutation saveHandle(handle: text 3..20 format handle):
  upsert handles[principal = viewer] { principal: viewer, handle }

query resolveHandle(handle: text 3..20 format handle):
  return handles[handle = handle]

-- An exam attempt. attemptNo counts 1, 2, 3... within a candidate's chain;
-- priorExam links a retest to the failed exam it follows.
table exams:
  candidate: principal
  status: enum('booked', 'written', 'swim', 'rescue', 'passed', 'failed')
  writtenScore: int 0..100 ?
  swimScore: int 0..100 ?
  rescueScore: int 0..100 ?
  feeCents: int 0..20000
  attemptNo: int 1..100
  priorExam: exams ?
  createdAt: time default now
  failedAt: time ?
  photo: image <=5000000
  immutable candidate, attemptNo, priorExam, createdAt, photo
  read <- .candidate = viewer or exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'registrar']
  update <- exists roles[principal = viewer, role = 'instructor']
  online only

-- A certificate issued on passing. Validity is expiresAt > now; rows are
-- kept so history (including expiry) stays auditable.
table certificates:
  candidate: principal
  exam: exams
  issuedAt: time default now
  expiresAt: time
  unique exam
  immutable candidate, exam, issuedAt, expiresAt
  read <- .candidate = viewer or exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'instructor']
  online only

-- Manager approval for a retest beyond the second attempt. One row per
-- failed exam being retested; records the reason and the instructor's
-- recommendation plus who approved it.
table approvals:
  priorExam: exams
  reason: text 10..500
  recommendation: text 10..500
  approvedBy: principal
  at: time default now
  unique priorExam else ALREADY_APPROVED
  immutable priorExam, reason, recommendation, approvedBy, at
  read <- exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'manager']
  online only

-- Candidate's own exams (staff use board).
query myExams(c: cursor ?):
  return exams where .candidate = viewer after c first 50 by .id

-- Candidate's own certificates.
query myCertificates(c: cursor ?):
  return certificates where .candidate = viewer after c first 50 by .id

-- Candidate's own still-valid certificates (expired rows are kept but hidden here).
query myValidCertificates(c: cursor ?):
  return certificates where .candidate = viewer and .expiresAt > now after c first 50 by .id

-- One exam by id. Table rules decide visibility: another candidate's exam
-- reads as null rather than refusing.
query examDetail(exam: exams):
  return exams[exam]

-- Live pool board: every exam as it moves booked -> written -> swim -> rescue.
query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return exams after c first 50 by .id

-- Validity check for one candidate: the caller themselves, or staff.
query candidateCertificates(candidate: principal, c: cursor ?):
  require candidate = viewer or exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager'] else NOT_ALLOWED
  return certificates where .candidate = candidate and .expiresAt > now after c first 50 by .id

-- Approvals on one failed exam: staff only.
query approvalsFor(priorExam: exams, c: cursor ?):
  require exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return approvals where .priorExam = priorExam after c first 10 by .id

-- Registrar logs an exam: full fee (8000c = $80) and a photo-ID scan.
mutation logExam(candidate: principal, feeCents: int 0..20000, photo: image <=5000000):
  require exists roles[principal = viewer, role = 'registrar'] else NOT_REGISTRAR
  require feeCents = 8000 else BAD_FEE 'The full exam fee is 8000 cents.'
  return insert exams { candidate, status: 'booked', feeCents, attemptNo: 1, createdAt: now, photo }

-- Instructor scores the written stage: booked -> written.
mutation recordWritten(exam: exams, score: int 0..100):
  require exists roles[principal = viewer, role = 'instructor'] else NOT_INSTRUCTOR
  e = exams[exam] ! else NOT_FOUND
  require e.status = 'booked' else BAD_STAGE 'Written follows booking.'
  update exams[exam] { status: 'written', writtenScore: score }
  return null

-- Instructor scores the swim stage: written -> swim.
mutation recordSwim(exam: exams, score: int 0..100):
  require exists roles[principal = viewer, role = 'instructor'] else NOT_INSTRUCTOR
  e = exams[exam] ! else NOT_FOUND
  require e.status = 'written' else BAD_STAGE 'Swim follows the written stage.'
  update exams[exam] { status: 'swim', swimScore: score }
  return null

-- Instructor scores rescue: swim -> passed/failed. Passing (every stage >=
-- 70) issues a certificate valid for two years; failing stamps failedAt,
-- which opens the 30-day retest window.
mutation recordRescue(exam: exams, score: int 0..100):
  require exists roles[principal = viewer, role = 'instructor'] else NOT_INSTRUCTOR
  e = exams[exam] ! else NOT_FOUND
  require e.status = 'swim' else BAD_STAGE 'Rescue follows the swim stage.'
  pass = (e.writtenScore ?? 0) >= 70 and (e.swimScore ?? 0) >= 70 and score >= 70
  update exams[exam] { status: 'passed' if pass else 'failed', rescueScore: score, failedAt: null if pass else now }
  if pass:
    insert certificates { candidate: e.candidate, exam, issuedAt: now, expiresAt: now + 730d }
  return null

-- Registrar opens a retest of a failed exam: within 30 days of failure, at
-- exactly half the failed exam's fee. A third (or later) attempt additionally
-- needs a manager approval on the failed exam.
mutation retest(priorExam: exams, feeCents: int 0..20000, photo: image <=5000000):
  require exists roles[principal = viewer, role = 'registrar'] else NOT_REGISTRAR
  p = exams[priorExam] ! else NOT_FOUND
  require p.status = 'failed' else NOT_FAILED 'Only a failed exam can be retested.'
  require p.failedAt != null and now <= p.failedAt + 30d else WINDOW_CLOSED 'Retests close 30 days after failure.'
  require feeCents = 4000 else BAD_FEE 'A retest costs half the full fee (4000 cents).'
  if p.attemptNo >= 2:
    require exists approvals[priorExam = p.id] else NEEDS_APPROVAL 'Beyond the second attempt the manager must approve first.'
  return insert exams { candidate: p.candidate, status: 'booked', feeCents, attemptNo: p.attemptNo + 1, priorExam: p.id, createdAt: now, photo }

-- Aquatics manager approves a retest beyond the second attempt, recording the
-- reason and the instructor's recommendation.
mutation approveRetest(priorExam: exams, reason: text 10..500, recommendation: text 10..500):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  p = exams[priorExam] ! else NOT_FOUND
  require p.status = 'failed' else NOT_FAILED 'Only a failed exam can be approved for retest.'
  require p.attemptNo >= 2 else TOO_EARLY 'The second attempt needs no approval.'
  return insert approvals { priorExam: p.id, reason, recommendation, approvedBy: viewer, at: now }

-- Spec privacy intent: candidates read only their own rows. Staff need the
-- board; every staff arm below is load-bearing for a spec workflow.
invariant exams.read only .candidate = viewer or exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager']
invariant certificates.read only .candidate = viewer or exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager']
invariant exams.photo read only .candidate = viewer or exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager']
invariant roles.read only .principal = viewer
invariant approvals.reason read only exists roles[principal = viewer, role = 'instructor'] or exists roles[principal = viewer, role = 'registrar'] or exists roles[principal = viewer, role = 'manager']
invariant exams.insert only exists roles[principal = viewer, role = 'registrar']
invariant approvals.insert only exists roles[principal = viewer, role = 'manager']
