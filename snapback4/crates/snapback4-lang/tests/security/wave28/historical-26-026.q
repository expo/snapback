use identity password

table roles:
  principal: principal
  role: enum('bow_owner', 'clerk', 'bow_maker', 'workshop_owner')
  name: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'workshop_owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('bow_owner', 'clerk', 'bow_maker', 'workshop_owner'), name: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, name }

query myRole():
  return roles[viewer]

query customers(c: cursor ?):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'workshop_owner'] else NOT_COUNTER
  return roles where .role = 'bow_owner' first 100 by .id after c

table bows:
  owner: principal
  loggedBy: principal
  label: text 1..100
  instrument: enum('violin', 'viola', 'cello')
  repair: text 1..500
  priceCents: int 0..200000
  stick: image <=5000000
  tip: image <=5000000
  frog: image <=5000000
  stamp: image <=5000000
  originalTip: bool
  openedAt: time
  quoteDue: time
  approvedAt: time ?
  status: enum('opened', 'rehaired', 'cambered', 'polished', 'picked_up', 'returned_unrepaired')
  pickedAt: time ?
  consent: text 10..2000 ?
  consentAt: time ?
  tipApprovedBy: principal ?
  tipApprovedAt: time ?
  fault: text 10..1000 ?
  faultAt: time ?
  freeRepair: bool default false
  immutable owner, loggedBy, openedAt, quoteDue, label, instrument, repair, priceCents, stick, tip, frog, stamp, originalTip
  read <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'bow_maker'] or exists roles[viewer, role = 'workshop_owner']
  insert <- exists roles[viewer, role = 'clerk'] and .loggedBy = viewer
  update <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'bow_maker'] or exists roles[viewer, role = 'workshop_owner']
  online only

invariant bows.read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'bow_maker'] or exists roles[viewer, role = 'workshop_owner']

query myBows(c: cursor ?):
  require exists roles[viewer] else NOT_ENROLLED
  return bows where .owner = viewer last 100 by .openedAt after c

query bench(c: cursor ?):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'bow_maker'] or exists roles[viewer, role = 'workshop_owner'] else NOT_STAFF
  return bows last 100 by .openedAt after c

query bow(bowId: bows):
  return bows[bowId]

mutation logBow(owner: principal, label: text 1..100, instrument: enum('violin', 'viola', 'cello'), repair: text 1..500, priceCents: int 0..200000, stick: image <=5000000, tip: image <=5000000, frog: image <=5000000, stamp: image <=5000000, originalTip: bool):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  require exists roles[owner, role = 'bow_owner'] else NOT_CUSTOMER
  return insert bows { owner, loggedBy: viewer, label, instrument, repair, priceCents, stick, tip, frog, stamp, originalTip, openedAt: now, quoteDue: now + 21d, status: 'opened' }

mutation approveQuote(bowId: bows):
  b = bows[bowId] ! else NOT_FOUND
  require b.owner = viewer else NOT_BOW_OWNER
  require b.status = 'opened' and b.approvedAt = null else BAD_STATE
  require now < b.quoteDue else QUOTE_EXPIRED
  update bows[bowId] { approvedAt: now }

mutation recordConsent(bowId: bows, consent: text 10..2000):
  b = bows[bowId] ! else NOT_FOUND
  require b.owner = viewer else NOT_BOW_OWNER
  require b.originalTip and b.status = 'opened' and b.approvedAt != null else BAD_STATE
  require b.consent = null and b.tipApprovedAt = null else CONSENT_LOCKED
  update bows[bowId] { consent, consentAt: now }

mutation approveTipReplacement(bowId: bows):
  require exists roles[viewer, role = 'workshop_owner'] else NOT_WORKSHOP_OWNER
  b = bows[bowId] ! else NOT_FOUND
  require b.originalTip and b.status = 'opened' and b.approvedAt != null else BAD_STATE
  require b.consent != null and b.consentAt != null else WRITTEN_CONSENT_REQUIRED
  require b.tipApprovedAt = null else ALREADY_AUTHORIZED
  update bows[bowId] { tipApprovedBy: viewer, tipApprovedAt: now }

mutation advanceBow(bowId: bows):
  require exists roles[viewer, role = 'bow_maker'] else NOT_BOW_MAKER
  b = bows[bowId] ! else NOT_FOUND
  require b.approvedAt != null else QUOTE_NOT_APPROVED
  require b.status = 'opened' or b.status = 'rehaired' or b.status = 'cambered' else BAD_STATE
  nextStatus = 'rehaired' if b.status = 'opened' else 'cambered' if b.status = 'rehaired' else 'polished'
  update bows[bowId] { status: nextStatus }

mutation pickup(bowId: bows):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  b = bows[bowId] ! else NOT_FOUND
  require b.status = 'polished' else BAD_STATE
  update bows[bowId] { status: 'picked_up', pickedAt: now }

mutation reportFault(bowId: bows, fault: text 10..1000):
  b = bows[bowId] ! else NOT_FOUND
  require b.owner = viewer else NOT_BOW_OWNER
  require b.status = 'picked_up' and b.pickedAt != null else BAD_STATE
  require now <= b.pickedAt + 90d else WARRANTY_EXPIRED
  update bows[bowId] { fault, faultAt: now, freeRepair: true, status: 'opened' }

job returnExpired():
  for b in bows where .quoteDue <= now by .quoteDue:
    if b.approvedAt = null and b.status = 'opened':
      update bows[b.id] { status: 'returned_unrepaired' }
schedule quoteReturns every 1m: returnExpired
