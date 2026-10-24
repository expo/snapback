-- Compression Garment Fittings (lymphedema clinic).
--
-- Roles: frontdesk, fitter, patient, manager. Signup creates an account with
-- no role; the local operator provisions exactly one role row per principal
-- (see scripts/staging.mjs and `guide staging`).
use identity password

table roles:
  principal: principal
  role: enum('frontdesk', 'fitter', 'patient', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'manager']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

-- One fitting per patient visit: front desk opens it with the prescription
-- scan and the quoted fee. Fitters add measurements, swelling photos and
-- fabric. Status moves measured -> ordered -> fitted.
-- Column gate: prescription scan, diagnosis, insurance, fee, waiver flag and
-- waiver reason are visible only to front desk and the clinic manager, on
-- every read path (queries, mutation returns, asset downloads).
table fittings:
  patient: principal
  limb: text 1..40
  status: enum('measured', 'ordered', 'fitted') default 'measured'
  prescriptionScan: image <=10000000
  prescriptionDate: time
  quotedFee: money USD
  diagnosis: text 1..500
  insurance: text 1..200
  measurements: text 1..2000 ?
  photos: [image <=5000000] <=4 ?
  fabric: text 1..200 ?
  feeWaived: bool default false
  waiverReason: text 1..300 ?
  read (prescriptionScan, diagnosis, insurance, quotedFee, feeWaived, waiverReason) <- exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager']
  immutable patient, limb, prescriptionDate
  read <- .patient = viewer or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager']
  update <- exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'manager']
  cap 200 by patient
  online only

-- Operator-only onboarding (service:operator), used by scripts/staging.mjs.
mutation provision(principal: principal, role: enum('frontdesk', 'fitter', 'patient', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

-- Clinic manager sees the whole roster.
query roster(c: cursor ?):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  return roles last 50 by .id after c

-- Front desk picks the patient a new fitting belongs to.
query patients(c: cursor ?):
  require exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  return roles where .role = 'patient' last 50 by .id after c

-- The live fitting board: patients see only their own fittings, staff see all.
-- Private columns stay redacted by the column gate above.
query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'patient']:
    return fittings where .patient = viewer last 50 by .id after c
  return fittings last 50 by .id after c

query fittingDetail(fitting: fittings):
  return fittings[fitting]

-- Front desk (or manager) opens a fitting with the prescription scan and fee.
-- Clinical details stay empty until a fitter records them via updateClinical.
mutation openFitting(patient: principal, limb: text 1..40, diagnosis: text 1..500, insurance: text 1..200, quotedFee: money USD, prescriptionScan: image <=10000000, prescriptionDate: time):
  require exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager'] else NOT_FRONTDESK
  require exists roles[principal = patient, role = 'patient'] else NOT_A_PATIENT
  require prescriptionDate <= now else BAD_RX_DATE 'The prescription date cannot be in the future.'
  return insert fittings { patient, limb, status: 'measured', prescriptionScan, prescriptionDate, quotedFee, diagnosis, insurance, feeWaived: false, waiverReason: null }

-- Fitters (or manager) record the clinical details.
mutation updateClinical(fitting: fittings, measurements: text 1..2000, fabric: text 1..200, photos: [image <=5000000] <=4 ?):
  require exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'manager'] else NOT_FITTER
  f = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] { measurements, fabric, photos: photos ?? f.photos }
  return null

-- Staff order the garment; refused once the prescription is older than six months.
mutation orderGarment(fitting: fittings):
  require exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'manager'] else NOT_STAFF
  f = fittings[fitting] ! else NOT_FOUND
  require f.status = 'measured' else BAD_STATUS 'Only a measured fitting can be ordered.'
  require month(now) - month(f.prescriptionDate) <= 6 else PRESCRIPTION_STALE 'The prescription is older than six months.'
  update fittings[fitting] { status: 'ordered' }
  return null

-- Fitters (or manager) mark the garment fitted.
mutation markFitted(fitting: fittings):
  require exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'manager'] else NOT_FITTER
  f = fittings[fitting] ! else NOT_FOUND
  require f.status = 'ordered' else BAD_STATUS 'Only an ordered garment can be fitted.'
  update fittings[fitting] { status: 'fitted' }
  return null

-- Only the clinic manager waives the fee, and the reason is kept.
mutation waiveFee(fitting: fittings, reason: text 1..300):
  require exists roles[principal = viewer, role = 'manager'] else NOT_MANAGER
  f = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] { feeWaived: true, waiverReason: reason }
  return null

-- Privacy intent, stated independently from the rules above.
invariant fittings.read only .patient = viewer or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'manager']
invariant fittings.diagnosis read only exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager']
invariant fittings.insurance read only exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager']
invariant fittings.quotedFee read only exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager']
invariant fittings.prescriptionScan read only exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager']
invariant fittings.feeWaived read only exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager']
invariant fittings.waiverReason read only exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager']
invariant fittings.insert only exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'manager']
invariant fittings.feeWaived update only exists roles[principal = viewer, role = 'manager']
invariant fittings.waiverReason update only exists roles[principal = viewer, role = 'manager']
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'fitter'] or exists roles[principal = viewer, role = 'manager']
invariant roles.provision only viewer = 'service:operator'
