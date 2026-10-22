use identity password

table roles:
  principal: principal
  role: enum('worker', 'safety', 'clinician', 'desk')
  company: text 1..80
  name: text 1..100
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'clinician'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'safety', company = .company] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'

mutation provision(principal: principal, role: enum('worker', 'safety', 'clinician', 'desk'), company: text 1..80, name: text 1..100):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, company, name }

query myRole():
  return roles[principal = viewer]

query workers(company: text 1..80):
  require exists roles[principal = viewer, role = 'clinician'] or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'safety', company = company] else NOT_STAFF
  return roles where .role = 'worker' and .company = company first 100 by .id

table questionnaires:
  worker: principal
  concern: bool
  answers: text 1..4000
  submittedAt: time
  cleared: bool default false
  clearanceReason: text <=1000 default ''
  clearedBy: principal ?
  clearedAt: time ?
  unique worker
  immutable worker
  read <- exists roles[principal = viewer, role = 'clinician']
  insert <- .worker = viewer and exists roles[principal = viewer, role = 'worker']
  update (old, next) <- exists roles[principal = viewer, role = 'clinician'] or old.worker = viewer and exists roles[principal = viewer, role = 'worker'] and (not old.concern or old.cleared) and next.cleared = false and next.clearanceReason = '' and next.clearedBy = null and next.clearedAt = null
  online only

invariant questionnaires.read only exists roles[principal = viewer, role = 'clinician']
invariant questionnaires.insert only .worker = viewer and exists roles[principal = viewer, role = 'worker']

mutation submitQuestionnaire(concern: bool, answers: text 1..4000):
  require exists roles[principal = viewer, role = 'worker'] else NOT_WORKER
  upsert questionnaires[worker = viewer] { worker: viewer, concern, answers, submittedAt: now, cleared: false, clearanceReason: '', clearedBy: null, clearedAt: null }

query questionnaire(worker: principal):
  require exists roles[principal = viewer, role = 'clinician'] else CLINICIAN_ONLY
  return questionnaires[worker]

table clearances:
  worker: principal
  reason: text 5..1000
  clinician: principal
  at: time
  read <- exists roles[principal = viewer, role = 'clinician']
  insert <- exists roles[principal = viewer, role = 'clinician']
  online only

invariant clearances.read only exists roles[principal = viewer, role = 'clinician']
invariant clearances.insert only exists roles[principal = viewer, role = 'clinician']

mutation clearConcern(worker: principal, reason: text 5..1000):
  require exists roles[principal = viewer, role = 'clinician'] else CLINICIAN_ONLY
  q = questionnaires[worker] ! else NO_QUESTIONNAIRE
  require q.concern and not q.cleared else NO_OPEN_CONCERN
  insert clearances { worker, reason, clinician: viewer, at: now }
  return update questionnaires[worker] { cleared: true, clearanceReason: reason, clearedBy: viewer, clearedAt: now }

table bookings:
  worker: principal
  company: text 1..80
  workerName: text 1..100
  startsAt: time
  bookedBy: principal
  unique startsAt else SLOT_FULL
  immutable worker, company, workerName, startsAt, bookedBy
  read <- .worker = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'clinician']
  insert <- exists roles[principal = viewer, role = 'desk'] or .worker = viewer and exists roles[principal = viewer, role = 'worker']
  online only

mutation book(worker: principal, startsAt: time):
  require exists roles[principal = viewer, role = 'desk'] or worker = viewer and exists roles[principal = viewer, role = 'worker'] else NOT_BOOKER
  require startsAt > now and startsAt <= now + 90d else BOOKING_WINDOW
  w = roles[principal = worker] ! else NO_WORKER
  require w.role = 'worker' else NO_WORKER
  return insert bookings { worker, company: w.company, workerName: w.name, startsAt, bookedBy: viewer }

query bookingsList():
  if exists roles[principal = viewer, role = 'worker']:
    return bookings where .worker = viewer first 100 by .startsAt
  require exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'clinician'] else NOT_SCHEDULER
  return bookings first 100 by .startsAt

query booking(bookingId: bookings):
  return bookings[bookingId]

table results:
  worker: principal
  company: text 1..80
  workerName: text 1..100
  maskModel: text 1..100
  maskSize: enum('XS', 'S', 'M', 'L', 'XL')
  outcome: enum('pass', 'fail', 'fit confirmed', 'fit not confirmed')
  testedAt: time
  expiresAt: time ?
  clinician: principal
  immutable worker, company, workerName, maskModel, maskSize, testedAt, clinician
  update <- exists roles[principal = viewer, role = 'clinician']
  read <- .worker = viewer or exists roles[principal = viewer, role = 'clinician'] or exists roles[principal = viewer, role = 'safety', company = .company]
  insert <- exists roles[principal = viewer, role = 'clinician']
  online only

table cards:
  test: results
  worker: principal
  photo: image <=5000000
  unique test
  read <- .worker = viewer or exists roles[principal = viewer, role = 'clinician']
  insert <- exists roles[principal = viewer, role = 'clinician']
  online only

invariant results.insert only exists roles[principal = viewer, role = 'clinician']
invariant cards.read only .worker = viewer or exists roles[principal = viewer, role = 'clinician']

table certifications:
  worker: principal
  company: text 1..80
  workerName: text 1..100
  test: results
  expiresAt: time
  unique worker
  read <- .worker = viewer or exists roles[principal = viewer, role = 'clinician'] or exists roles[principal = viewer, role = 'safety', company = .company]
  insert <- exists roles[principal = viewer, role = 'clinician']
  update <- exists roles[principal = viewer, role = 'clinician']
  online only

mutation recordTest(worker: principal, maskModel: text 1..100, maskSize: enum('XS', 'S', 'M', 'L', 'XL'), outcome: enum('pass', 'fail', 'fit confirmed', 'fit not confirmed'), photo: image <=5000000 ?):
  require exists roles[principal = viewer, role = 'clinician'] else CLINICIAN_ONLY
  w = roles[principal = worker] ! else NO_WORKER
  require w.role = 'worker' else NO_WORKER
  q = questionnaires[worker] ! else NO_QUESTIONNAIRE
  require not q.concern or q.cleared else CLINICAL_CLEARANCE_REQUIRED
  confirmed = outcome = 'pass' or outcome = 'fit confirmed'
  normalized = 'fit confirmed' if confirmed else 'fit not confirmed'
  require not confirmed or photo != null else PASS_CARD_REQUIRED
  offset = now - monthStart(month(now))
  anniversary = monthStart(month(now) + 12)
  following = monthStart(month(now) + 13)
  expiry = anniversary + offset if anniversary + offset < following else following - 1d + now % 1d
  r = insert results { worker, company: w.company, workerName: w.name, maskModel, maskSize, outcome: normalized, testedAt: now, expiresAt: expiry if confirmed else null, clinician: viewer }
  if confirmed:
    insert cards { test: r.id, worker, photo: photo ! else PASS_CARD_REQUIRED }
    upsert certifications[worker] { worker, company: w.company, workerName: w.name, test: r.id, expiresAt: expiry }
  return r

query resultsList(company: text 1..80):
  if exists roles[principal = viewer, role = 'worker']:
    return results where .company = company and .worker = viewer last 100 by .testedAt
  require exists roles[principal = viewer, role = 'clinician'] or exists roles[principal = viewer, role = 'safety', company = company] else NOT_RESULTS_READER
  return results where .company = company last 100 by .testedAt

query result(test: results):
  return results[test]

query testCard(test: results):
  return cards[test]

query dueSoon(company: text 1..80):
  require exists roles[principal = viewer, role = 'safety', company = company] or exists roles[principal = viewer, role = 'clinician'] else NOT_SAFETY
  return certifications where .company = company and .expiresAt <= now + 30d first 100 by .expiresAt

invariant results.read only .worker = viewer or exists roles[principal = viewer, role = 'clinician'] or exists roles[principal = viewer, role = 'safety', company = .company]
invariant certifications.read only .worker = viewer or exists roles[principal = viewer, role = 'clinician'] or exists roles[principal = viewer, role = 'safety', company = .company]
invariant certifications.insert only exists roles[principal = viewer, role = 'clinician']
invariant certifications.update only exists roles[principal = viewer, role = 'clinician']
invariant bookings.read only .worker = viewer or exists roles[principal = viewer, role = 'desk'] or exists roles[principal = viewer, role = 'clinician']
invariant bookings.insert only exists roles[principal = viewer, role = 'desk'] or .worker = viewer and exists roles[principal = viewer, role = 'worker']

-- Representation-only migration: no clinical decision, photo, dates or ownership can change.
mutation convertOutcome(test: results, outcome: enum('pass', 'fail', 'fit confirmed', 'fit not confirmed')):
  require exists roles[principal = viewer, role = 'clinician'] else CLINICIAN_ONLY
  r = results[test] ! else NO_TEST
  require (r.outcome = 'pass' or r.outcome = 'fit confirmed') = (outcome = 'pass' or outcome = 'fit confirmed') else NOT_EQUIVALENT
  return update results[test] { outcome }

mutation changeOutcome(test: results, outcome: enum('fit confirmed', 'fit not confirmed'), photo: image <=5000000 ?):
  require exists roles[principal = viewer, role = 'clinician'] else CLINICIAN_ONLY
  r = results[test] ! else NO_TEST
  q = questionnaires[worker = r.worker] ! else NO_QUESTIONNAIRE
  require not q.concern or q.cleared else CLINICAL_CLEARANCE_REQUIRED
  card = cards[test]
  require outcome != 'fit confirmed' or card != null or photo != null else PASS_CARD_REQUIRED
  offset = r.testedAt - monthStart(month(r.testedAt))
  anniversary = monthStart(month(r.testedAt) + 12)
  following = monthStart(month(r.testedAt) + 13)
  expiry = anniversary + offset if anniversary + offset < following else following - 1d + r.testedAt % 1d
  if outcome = 'fit confirmed' and card = null:
    insert cards { test, worker: r.worker, photo: photo ! else PASS_CARD_REQUIRED }
  if outcome = 'fit confirmed':
    upsert certifications[worker = r.worker] { worker: r.worker, company: r.company, workerName: r.workerName, test, expiresAt: r.expiresAt ?? expiry }
  return update results[test] { outcome, expiresAt: r.expiresAt ?? (expiry if outcome = 'fit confirmed' else null) }

invariant results.update only exists roles[principal = viewer, role = 'clinician']
