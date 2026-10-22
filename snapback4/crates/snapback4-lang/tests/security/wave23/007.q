use identity password

-- Roles are operator-provisioned. Signup alone confers no clinic access.
table users:
  principal: principal
  role: enum('front_desk', 'technician', 'billing', 'audiologist', 'patient')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists users[viewer, role = 'front_desk'] or exists users[viewer, role = 'audiologist'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

invariant users.role write only viewer = 'service:operator'

mutation provision(principal: principal, role: enum('front_desk', 'technician', 'billing', 'audiologist', 'patient'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert users[principal] { principal, role, name }

query me():
  return users[viewer]

query patients():
  require exists users[viewer, role = 'front_desk'] or exists users[viewer, role = 'audiologist'] else NOT_RECEPTION
  return users where .role = 'patient' first 100 by .id { principal, name }

table fittings:
  patient: principal
  patientName: text 1..80
  model: text 1..100
  priceCents: int 1..2000000
  hearingTest: image <=5000000 ?
  scanName: text 1..120 ?
  moldNotes: text <=2000
  status: enum('ordered', 'fitted', 'trial', 'returned') default 'ordered'
  createdAt: time default now
  fittedAt: time ?
  trialEndsAt: time ?
  returnedAt: time ?
  refundCents: int 0..2000000 ?
  insurance: text <=2000 default ''
  balanceCents: int 0..2000000 default 0
  read (insurance, balanceCents) <- exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist']
  immutable patient, patientName, model, priceCents, createdAt
  read <- .patient = viewer or exists users[viewer, role = 'front_desk'] or exists users[viewer, role = 'technician'] or exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist']
  insert <- exists users[viewer, role = 'front_desk']
  update <- exists users[viewer, role = 'front_desk'] or .patient = viewer or exists users[viewer, role = 'technician'] or exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist']
  online only

-- Patients may access only their own records; staff share clinical records.
invariant fittings.read only .patient = viewer or exists users[viewer, role = 'front_desk'] or exists users[viewer, role = 'technician'] or exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist']
invariant fittings.insurance read only exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist']
invariant fittings.balanceCents read only exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist']
invariant fittings.openFitting only exists users[viewer, role = 'front_desk']
invariant fittings.extendTrial only exists users[viewer, role = 'audiologist']

query board(c: cursor ?):
  return fittings last 50 by .id after c

query fitting(fittingId: fittings):
  return fittings[fittingId]

mutation openFitting(patient: principal, model: text 1..100, priceCents: int 1..2000000, hearingTest: image <=5000000 ?, scanName: text 1..120 ?, moldNotes: text <=2000):
  require exists users[viewer, role = 'front_desk'] else NOT_RECEPTION
  require (hearingTest = null and scanName = null) or (hearingTest != null and scanName != null) else SCAN_NAME_REQUIRED
  p = users[patient] ! else PATIENT_NOT_FOUND
  require p.role = 'patient' else NOT_PATIENT
  return insert fittings { patient, patientName: p.name, model, priceCents, hearingTest, scanName, moldNotes, balanceCents: priceCents }

mutation updateMold(fittingId: fittings, moldNotes: text <=2000):
  require exists users[viewer, role = 'technician'] or exists users[viewer, role = 'audiologist'] else NOT_CLINICAL
  f = fittings[fittingId] ! else NOT_FOUND
  require f.status != 'returned' else DEVICE_RETURNED
  return update fittings[fittingId] { moldNotes }

mutation markFitted(fittingId: fittings):
  require exists users[viewer, role = 'technician'] or exists users[viewer, role = 'audiologist'] else NOT_CLINICAL
  f = fittings[fittingId] ! else NOT_FOUND
  require f.status = 'ordered' else BAD_STAGE
  return update fittings[fittingId] { status: 'fitted', fittedAt: now, trialEndsAt: now + 45d }

mutation startTrial(fittingId: fittings):
  require exists users[viewer, role = 'technician'] or exists users[viewer, role = 'audiologist'] else NOT_CLINICAL
  f = fittings[fittingId] ! else NOT_FOUND
  require f.status = 'fitted' else BAD_STAGE
  return update fittings[fittingId] { status: 'trial' }

mutation extendTrial(fittingId: fittings, days: int 1..90):
  require exists users[viewer, role = 'audiologist'] else NOT_AUDIOLOGIST
  f = fittings[fittingId] ! else NOT_FOUND
  require f.status = 'fitted' or f.status = 'trial' else BAD_STAGE
  require f.trialEndsAt != null else NOT_FITTED
  return update fittings[fittingId] { trialEndsAt: f.trialEndsAt + days * 1d }

mutation updateBilling(fittingId: fittings, insurance: text <=2000, balanceCents: int 0..2000000):
  require exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist'] else NOT_BILLING
  f = fittings[fittingId] ! else NOT_FOUND
  require f.status != 'returned' else DEVICE_RETURNED
  require balanceCents <= f.priceCents else BALANCE_EXCEEDS_PRICE
  return update fittings[fittingId] { insurance, balanceCents }

mutation returnDevice(fittingId: fittings):
  f = fittings[fittingId] ! else NOT_FOUND
  require f.patient = viewer or exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist'] else NOT_RETURN_AUTHORIZED
  require f.status = 'fitted' or f.status = 'trial' else BAD_STAGE
  require f.fittedAt != null else NOT_FITTED
  require now <= f.fittedAt + 45d else REFUND_WINDOW_CLOSED
  return update fittings[fittingId] { status: 'returned', returnedAt: now, refundCents: f.priceCents, balanceCents: 0 }

table adjustments:
  fitting: fittings
  author: principal
  authorName: text 1..80
  note: text 1..2000
  at: time default now
  immutable fitting, author, authorName, note, at
  read <- .fitting.patient = viewer or exists users[viewer, role = 'front_desk'] or exists users[viewer, role = 'technician'] or exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist']
  insert <- .author = viewer and (exists users[viewer, role = 'technician'] or exists users[viewer, role = 'audiologist'])
  cap 500 by fitting
  online only

invariant adjustments.read only .fitting.patient = viewer or exists users[viewer, role = 'front_desk'] or exists users[viewer, role = 'technician'] or exists users[viewer, role = 'billing'] or exists users[viewer, role = 'audiologist']

query adjustmentHistory(fittingId: fittings, c: cursor ?):
  require exists fittings[fittingId] else NOT_FOUND
  return adjustments where .fitting = fittingId last 50 by .id after c

mutation addAdjustment(fittingId: fittings, note: text 1..2000):
  require exists users[viewer, role = 'technician'] or exists users[viewer, role = 'audiologist'] else NOT_CLINICAL
  f = fittings[fittingId] ! else NOT_FOUND
  require f.status != 'returned' else DEVICE_RETURNED
  u = users[viewer] ! else NOT_CLINICAL
  return insert adjustments { fitting: fittingId, author: viewer, authorName: u.name, note }

-- Scan placement/replacement is a separate front-desk-only operation.
invariant fittings.setHearingTest only exists users[viewer, role = 'front_desk']
mutation setHearingTest(fittingId: fittings, hearingTest: image <=5000000, scanName: text 1..120):
  require exists users[viewer, role = 'front_desk'] else NOT_RECEPTION
  f = fittings[fittingId] ! else NOT_FOUND
  return update fittings[fittingId] { hearingTest, scanName }
