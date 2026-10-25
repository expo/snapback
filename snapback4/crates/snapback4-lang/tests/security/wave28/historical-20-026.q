use identity password

table roles:
  principal: principal
  role: enum('customer', 'binder', 'head_conservator')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'binder', 'head_conservator')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query customers():
  require exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator'] else STAFF_ONLY
  return roles where .role = 'customer' first 100 by .id

table books:
  customer: principal
  title: text 1..120
  damage: text 1..2000
  intakePhoto: image <=5000000
  intakeAt: time
  approvalDue: time
  stage: enum('intake', 'awaiting', 'approved', 'washing', 'sewing', 'rebinding', 'completed', 'returned', 'collected')
  plan: text <=3000 default ''
  irreversible: bool default false
  consent: text <=2000 default ''
  consentAt: time ?
  consentBy: principal ?
  approvalReason: text <=2000 default ''
  approvedBy: principal ?
  approvedAt: time ?
  completedAt: time ?
  storageFrom: time ?
  closedAt: time ?
  immutable customer, title, damage, intakePhoto, intakeAt, approvalDue
  read <- .customer = viewer or exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator']
  insert <- .customer = viewer or exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator']
  update <- .customer = viewer or exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator']
  online only

table photos:
  book: books
  photo: image <=5000000
  note: text 1..1000
  at: time
  author: principal
  immutable book, photo, note, at, author
  read through .book
  insert <- .author = viewer and (exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator'])
  online only

query listBooks(c: cursor ?):
  return books last 50 by .intakeAt after c

query bookDetail(book: books):
  b = books[book] ! else NOT_FOUND
  return { book: b, effectiveStage: 'returned' if (b.stage = 'intake' or b.stage = 'awaiting') and now >= b.approvalDue else b.stage, storageFeeCents: max(0, (now - b.storageFrom) / 1d + 1) * 200 if b.stage = 'completed' and b.storageFrom != null and now >= b.storageFrom else 0 }

query bookPhotos(book: books, c: cursor ?):
  b = books[book] ! else NOT_FOUND
  return photos where .book = b.id last 50 by .at after c

mutation intake(customer: principal, title: text 1..120, damage: text 1..2000, intakePhoto: image <=5000000):
  require exists roles[principal = viewer] else ROLE_REQUIRED
  require customer = viewer or exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator'] else NOT_OWNER
  require exists roles[principal = customer, role = 'customer'] else CUSTOMER_REQUIRED
  return insert books { customer, title, damage, intakePhoto, intakeAt: now, approvalDue: now + 30d, stage: 'intake' }

mutation proposePlan(book: books, plan: text 1..3000, irreversible: bool):
  require exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator'] else STAFF_ONLY
  b = books[book] ! else NOT_FOUND
  require b.stage = 'intake' else WRONG_STAGE
  require now < b.approvalDue else DEADLINE_PASSED
  return update books[book] { plan, irreversible, stage: 'awaiting' }

mutation consentPlan(book: books, consent: text 10..2000):
  b = books[book] ! else NOT_FOUND
  require b.customer = viewer else NOT_OWNER
  require b.stage = 'awaiting' else WRONG_STAGE
  require now < b.approvalDue else DEADLINE_PASSED
  return update books[book] { consent, consentBy: viewer, consentAt: now, stage: 'approved' }

mutation authorizeIrreversible(book: books, reason: text 10..2000):
  require exists roles[principal = viewer, role = 'head_conservator'] else HEAD_ONLY
  b = books[book] ! else NOT_FOUND
  require b.stage = 'approved' and b.irreversible else WRONG_STAGE
  require b.consentAt != null and b.consentBy = b.customer else CONSENT_REQUIRED
  require b.approvedAt = null else ALREADY_APPROVED
  return update books[book] { approvalReason: reason, approvedBy: viewer, approvedAt: now }

mutation advanceStage(book: books, stage: enum('washing', 'sewing', 'rebinding', 'completed')):
  require exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator'] else STAFF_ONLY
  b = books[book] ! else NOT_FOUND
  require not b.irreversible or b.approvedAt != null else HEAD_APPROVAL_REQUIRED
  require (b.stage = 'approved' and stage = 'washing') or (b.stage = 'washing' and stage = 'sewing') or (b.stage = 'sewing' and stage = 'rebinding') or (b.stage = 'rebinding' and stage = 'completed') else WRONG_STAGE
  if stage = 'completed':
    return update books[book] { stage, completedAt: now, storageFrom: now + 60d }
  return update books[book] { stage }

mutation addPhoto(book: books, photo: image <=5000000, note: text 1..1000):
  require exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator'] else STAFF_ONLY
  b = books[book] ! else NOT_FOUND
  require b.stage = 'washing' or b.stage = 'sewing' or b.stage = 'rebinding' or b.stage = 'completed' else WRONG_STAGE
  return insert photos { book, photo, note, at: now, author: viewer }

mutation collectBook(book: books):
  require exists roles[principal = viewer, role = 'binder'] or exists roles[principal = viewer, role = 'head_conservator'] else STAFF_ONLY
  b = books[book] ! else NOT_FOUND
  require b.stage = 'completed' else WRONG_STAGE
  return update books[book] { stage: 'collected', closedAt: now }

job returnUnapproved():
  for b in books where .approvalDue <= now by .approvalDue:
    if b.stage = 'intake' or b.stage = 'awaiting':
      update books[b.id] { stage: 'returned', closedAt: now }

schedule returns every 1h: returnUnapproved
