use identity password

table roles:
  principal: principal
  role: enum('intake', 'therapist', 'director', 'patient')
  name: text 1..100
  unique principal
  read <- .principal = viewer or exists roles[viewer, role != 'patient']
  insert <- viewer = 'service:operator'
  online only

table setups:
  patient: principal
  label: text 1..100
  studyDate: time
  studyExpiresAt: time
  scan: image <=5000000 read <- exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
  insurance: text 1..120 read <- exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
  phone: text 5..30 read <- exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
  price: money USD read <- exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
  mask: enum('XS', 'S', 'M', 'L', 'XL')
  prescribedMin: int 4..30
  prescribedMax: int 4..30
  pressure: int 4..30
  nightlyMinutes: int 0..1440 default 0
  stage: enum('ordered', 'fitted', 'delivered', 'follow-up') default 'ordered'
  openedAt: time
  deliveredAt: time ?
  checkDueAt: time ?
  checkedAt: time ?
  physicianOrder: text <=2000 default ''
  approvedPressure: int 4..30 ?
  approvedBy: principal ?
  approvedAt: time ?
  immutable patient, label, studyDate, studyExpiresAt, scan, insurance, phone, price, prescribedMin, prescribedMax, openedAt
  read <- .patient = viewer or exists roles[viewer, role != 'patient']
  insert <- exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
  update <- exists roles[viewer, role = 'therapist'] or exists roles[viewer, role = 'director']
  online only

mutation provision(principal: principal, role: enum('intake', 'therapist', 'director', 'patient'), name: text 1..100):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role, name } if absent

mutation openSetup(patient: principal, label: text 1..100, studyDate: time, scan: image <=5000000, insurance: text 1..120, phone: text 5..30, price: money USD, mask: enum('XS', 'S', 'M', 'L', 'XL'), prescribedMin: int 4..30, prescribedMax: int 4..30, pressure: int 4..30):
  require exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  require exists roles[patient, role = 'patient'] else NOT_PATIENT
  require studyDate <= now else FUTURE_STUDY
  require studyDate >= 946684800000 else INVALID_DATE
  require prescribedMin <= prescribedMax else INVALID_RANGE
  require pressure >= prescribedMin and pressure <= prescribedMax else PRESSURE_RANGE
  require price >= 0 else INVALID_PRICE
  m = month(studyDate)
  anniversary = monthStart(m + 12) + (studyDate - monthStart(m))
  expires = anniversary
  if anniversary >= monthStart(m + 13):
    expires = anniversary - 1d
  return insert setups { patient, label, studyDate, studyExpiresAt: expires, scan, insurance, phone, price, mask, prescribedMin, prescribedMax, pressure, openedAt: now }

mutation updateClinical(setup: setups, mask: enum('XS', 'S', 'M', 'L', 'XL'), pressure: int 4..30, nightlyMinutes: int 0..1440):
  require exists roles[viewer, role = 'therapist'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  row = setups[setup] ! else NOT_FOUND
  require pressure >= row.prescribedMin and pressure <= row.prescribedMax else PRESSURE_RANGE
  update setups[setup] { mask, pressure, nightlyMinutes }
  return null

mutation approvePressure(setup: setups, pressure: int 4..30, physicianOrder: text 1..2000):
  require exists roles[viewer, role = 'director'] else DIRECTOR_ONLY
  require trim(physicianOrder) != '' else ORDER_REQUIRED
  row = setups[setup] ! else NOT_FOUND
  require pressure < row.prescribedMin or pressure > row.prescribedMax else NOT_EXCEPTION
  update setups[setup] { pressure, physicianOrder, approvedPressure: pressure, approvedBy: viewer, approvedAt: now }
  return null

mutation fit(setup: setups):
  require exists roles[viewer, role = 'therapist'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  row = setups[setup] ! else NOT_FOUND
  require row.stage = 'ordered' else INVALID_STAGE
  update setups[setup] { stage: 'fitted' }
  return null

mutation deliver(setup: setups):
  require exists roles[viewer, role = 'therapist'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  row = setups[setup] ! else NOT_FOUND
  require now <= row.studyExpiresAt else STUDY_EXPIRED
  require row.stage = 'fitted' else INVALID_STAGE
  update setups[setup] { stage: 'delivered', deliveredAt: now, checkDueAt: now + 30d }
  return null

mutation usageCheck(setup: setups, nightlyMinutes: int 0..1440):
  require exists roles[viewer, role = 'therapist'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  row = setups[setup] ! else NOT_FOUND
  require row.stage = 'delivered' else INVALID_STAGE
  require now <= (row.checkDueAt ?? 0) else CHECK_OVERDUE
  update setups[setup] { nightlyMinutes, checkedAt: now, stage: 'follow-up' }
  return null

query me():
  return roles[viewer]

query patients():
  require exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director'] else FORBIDDEN
  return roles where .role = 'patient' first 100 by .id

query board(c: cursor ?):
  return setups last 100 by .id after c

query detail(setup: setups):
  return setups[setup]

invariant setups.read only .patient = viewer or exists roles[viewer, role != 'patient']
invariant setups.insurance read only exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
invariant setups.phone read only exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
invariant setups.price read only exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']
invariant setups.scan read only exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'director']

-- A pressure exception is an auditable clinical decision, not a permanent freeze.
-- Subsequent in-range settings are allowed; updateClinical rechecks the range.
invariant setups.pressure update only exists roles[viewer, role = 'therapist'] or exists roles[viewer, role = 'director']
invariant setups.approvePressure only exists roles[viewer, role = 'director']
invariant setups.updateClinical only exists roles[viewer, role = 'therapist'] or exists roles[viewer, role = 'director']
