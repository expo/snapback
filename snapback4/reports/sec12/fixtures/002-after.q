-- Infant Helmet Fittings: orthotics clinic cranial-helmet fittings.
-- Roles: frontdesk, orthotist, manager, parent (roster in `roles`).
-- Row audience: parents see only rows naming them as parent; staff see all rows.
-- Sensitive columns (diagnosis, insurance, fee, waiveReason) are additionally
-- gated to frontdesk + manager via column read rules, so orthotists and
-- parents read them as null. Six months is enforced as 183 days on ordering.
use identity password

table roles:
  principal: principal
  role: enum('frontdesk', 'orthotist', 'manager', 'parent')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table fittings:
  parent: principal
  babyName: text 1..80
  diagnosis: text 1..500
  insurance: text 1..200
  fee: money USD
  referralScan: text 1..500 format url ?
  referralAt: time
  headScan: text 1..1000 ?
  trialNotes: text 1..2000 ?
  skinCheck: text 1..2000 ?
  status: enum('scanned', 'ordered', 'delivered')
  feeWaived: bool default false
  waiveReason: text 1..300 ?
  read (diagnosis, insurance, fee, waiveReason) <- exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'manager']
  read <- .parent = viewer or exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'orthotist'] or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'manager']
  update <- exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'orthotist'] or exists roles[viewer, role = 'manager']
  immutable parent, referralAt
  online only

query myRole():
  return roles[principal = viewer]

query board(c: cursor ?):
  require exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'orthotist'] or exists roles[viewer, role = 'manager'] else NOT_STAFF 'Staff only.'
  return fittings last 50 by .id after c

query myFittings(c: cursor ?):
  return fittings where .parent = viewer last 50 by .id after c

query fitting(id: fittings):
  return fittings[id]

mutation provision(principal: principal, role: enum('frontdesk', 'orthotist', 'manager', 'parent')):
  require viewer = 'service:operator' else NOT_OPERATOR 'Operator only.'
  return upsert roles[principal] { principal, role }

mutation openFitting(parent: principal, babyName: text 1..80, diagnosis: text 1..500, insurance: text 1..200, fee: money USD, referralScan: text 1..500 format url ?, referralAt: time):
  require exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'manager'] else NOT_STAFF 'Front desk or manager only.'
  require referralAt <= now else BAD_REFERRAL 'Referral date cannot be in the future.'
  return insert fittings { parent, babyName, diagnosis, insurance, fee, referralScan, referralAt, status: 'scanned' }

mutation recordHeadScan(fitting: fittings, headScan: text 1..1000):
  require exists roles[viewer, role = 'orthotist'] else NOT_ORTHOTIST 'Orthotist only.'
  f = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] { headScan }
  return null

mutation recordTrialNotes(fitting: fittings, trialNotes: text 1..2000):
  require exists roles[viewer, role = 'orthotist'] else NOT_ORTHOTIST 'Orthotist only.'
  f = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] { trialNotes }
  return null

mutation recordSkinCheck(fitting: fittings, skinCheck: text 1..2000):
  require exists roles[viewer, role = 'orthotist'] else NOT_ORTHOTIST 'Orthotist only.'
  f = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] { skinCheck }
  return null

mutation setReferralScan(fitting: fittings, referralScan: text 1..500 format url ?):
  require exists roles[viewer, role = 'frontdesk'] else NOT_FRONTDESK 'Front desk only.'
  f = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] { referralScan }
  return null

mutation orderHelmet(fitting: fittings):
  require exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'orthotist'] or exists roles[viewer, role = 'manager'] else NOT_STAFF 'Staff only.'
  f = fittings[fitting] ! else NOT_FOUND
  require f.status = 'scanned' else BAD_STATUS 'Only a scanned fitting can be ordered.'
  require f.referralScan != null else REFERRAL_MISSING 'Referral scan is required before ordering.'
  require f.referralAt + 183d >= now else REFERRAL_EXPIRED 'Referral is older than six months.'
  update fittings[fitting] { status: 'ordered' }
  return null

mutation deliverHelmet(fitting: fittings):
  require exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'orthotist'] or exists roles[viewer, role = 'manager'] else NOT_STAFF 'Staff only.'
  f = fittings[fitting] ! else NOT_FOUND
  require f.status = 'ordered' else BAD_STATUS 'Only an ordered helmet can be delivered.'
  update fittings[fitting] { status: 'delivered' }
  return null

mutation waiveFee(fitting: fittings, reason: text 1..300):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER 'Manager only.'
  f = fittings[fitting] ! else NOT_FOUND
  update fittings[fitting] { feeWaived: true, waiveReason: reason }
  return null

-- Privacy intent, enforced separately from the row/column rules above.
invariant fittings.read only .parent = viewer or exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'orthotist'] or exists roles[viewer, role = 'manager']
invariant fittings.diagnosis read only exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'manager']
invariant fittings.insurance read only exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'manager']
invariant fittings.fee read only exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'manager']
invariant fittings.waiveReason read only exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'manager']
invariant fittings.insert only exists roles[viewer, role = 'frontdesk'] or exists roles[viewer, role = 'manager']
invariant fittings.setReferralScan only exists roles[viewer, role = 'frontdesk']
invariant fittings.waiveFee only exists roles[viewer, role = 'manager']
invariant roles.read only .principal = viewer or viewer = 'service:operator'
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
