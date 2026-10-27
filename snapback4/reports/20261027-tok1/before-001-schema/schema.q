use identity password

-- Trusted operator-managed roster. There is deliberately no self-enrolment API.
table staff:
  principal: principal
  role: enum('foreman', 'technician', 'master')
  unique principal
  read <- .principal = viewer
  insert <- deny
  update <- deny
  delete <- deny
  online only

table restorations:
  owner: principal
  model: text 1..160
  serialNumber: text 1..100
  cabinetPhoto: image <=10000000
  changerPhoto: image <=10000000
  lightingPhoto: image <=10000000
  ownerContact: text 1..300 read <- .owner = viewer or exists staff[viewer, role = 'foreman'] or exists staff[viewer, role = 'master']
  workshopNotes: text <=4000 read <- exists staff[viewer]
  openedBy: principal
  openedAt: time
  quoteDeadline: time
  stage: enum('awaiting_quote', 'return_due', 'returned', 'teardown', 'changer_rebuild', 'rewiring', 'cabinet_polish', 'ready', 'collected')
  readyAt: time ?
  readyNotice: text 1..1000 ?
  storageStartsAt: time ?
  storageCharging: bool default false
  collectedAt: time ?
  returnedAt: time ?
  immutable owner, model, serialNumber, cabinetPhoto, changerPhoto, lightingPhoto, openedBy, openedAt, quoteDeadline
  read <- .owner = viewer or exists staff[viewer]
  insert <- exists staff[viewer, role = 'foreman'] and .openedBy = viewer and .stage = 'awaiting_quote'
  after insert <- exists quotes[restoration = .id]
  update <- .owner = viewer or exists staff[viewer]
  delete <- deny
  online only

-- Commercial terms are an immutable quote; general technicians cannot read it.
table quotes:
  restoration: restorations
  owner: principal
  price: money USD
  storageDailyRate: money USD
  issuedAt: time
  expiresAt: time
  acceptedAt: time ?
  acceptedBy: principal ?
  unique restoration
  immutable restoration, owner, price, storageDailyRate, issuedAt, expiresAt
  read <- .owner = viewer or exists staff[viewer, role = 'foreman'] or exists staff[viewer, role = 'master']
  insert <- exists staff[viewer, role = 'foreman'] and exists restorations[.restoration, owner = .owner]
  update <- .owner = viewer
  delete <- deny
  online only

table selectorRequests:
  restoration: restorations
  originalSelector: text 1..1000
  reason: text 1..2000
  requestedBy: principal
  requestedAt: time
  unique restoration
  immutable restoration, originalSelector, reason, requestedBy, requestedAt
  read through .restoration
  insert <- exists staff[viewer] and .requestedBy = viewer
  update <- deny
  delete <- deny
  online only

-- The owner places their own uploaded written consent. Evidence never moves homes.
table selectorConsents:
  request: selectorRequests
  owner: principal
  writtenConsent: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png')
  statement: text 1..2000
  consentedAt: time
  unique request
  immutable request, owner, writtenConsent, statement, consentedAt
  read <- .owner = viewer or exists staff[viewer, role = 'master'] or exists staff[viewer, role = 'foreman']
  insert <- .owner = viewer and .request.restoration.owner = viewer
  update <- deny
  delete <- deny
  online only

table selectorApprovals:
  request: selectorRequests
  consent: selectorConsents
  approvedBy: principal
  approvedAt: time
  rationale: text 1..2000
  unique request
  immutable request, consent, approvedBy, approvedAt, rationale
  read through .request
  insert <- exists staff[viewer, role = 'master'] and .approvedBy = viewer and exists selectorConsents[.consent, request = .request]
  update <- deny
  delete <- deny
  online only

table selectorInstallations:
  request: selectorRequests
  approval: selectorApprovals
  installedBy: principal
  installedAt: time
  replacementDetails: text 1..2000
  unique request
  immutable request, approval, installedBy, installedAt, replacementDetails
  read through .request
  insert <- exists staff[viewer] and .installedBy = viewer and exists selectorApprovals[.approval, request = .request]
  update <- deny
  delete <- deny
  online only

-- Independent product intent, in addition to the enforcement rules above.
invariant restorations.read only .owner = viewer or exists staff[viewer]
invariant restorations.ownerContact read only .owner = viewer or exists staff[viewer, role = 'foreman'] or exists staff[viewer, role = 'master']
invariant restorations.workshopNotes read only exists staff[viewer]
invariant quotes.read only .owner = viewer or exists staff[viewer, role = 'foreman'] or exists staff[viewer, role = 'master']
invariant quotes.acceptQuote only .owner = viewer
invariant selectorConsents.insert only .owner = viewer
invariant selectorApprovals.insert only exists staff[viewer, role = 'master']
invariant selectorApprovals always .consent != null

query myRole():
  return staff[viewer]

query myJukeboxes(c: cursor ?):
  return restorations where .owner = viewer last 50 by .openedAt, .id after c

query jukebox(restoration: restorations):
  return restorations[restoration]

query quoteFor(restoration: restorations):
  return quotes[restoration = restoration]

query shopBoard(c: cursor ?):
  require exists staff[viewer] else STAFF_ONLY
  return restorations where .stage != 'returned' and .stage != 'collected' last 50 by .openedAt, .id after c

query selectorFor(restoration: restorations):
  return selectorRequests[restoration = restoration]

query consentFor(request: selectorRequests):
  return selectorConsents[request = request]

query approvalFor(request: selectorRequests):
  return selectorApprovals[request = request]

query installationFor(request: selectorRequests):
  return selectorInstallations[request = request]

query storageCharge(restoration: restorations):
  r = restorations[restoration] ! else NOT_FOUND
  q = quotes[restoration = restoration] ! else QUOTE_PRIVATE
  if r.storageStartsAt = null:
    return { startsAt: r.storageStartsAt, chargeableDays: 0, amount: q.storageDailyRate * 0 }
  until = r.collectedAt ?? now
  if until < r.storageStartsAt:
    return { startsAt: r.storageStartsAt, chargeableDays: 0, amount: q.storageDailyRate * 0 }
  days = (until - r.storageStartsAt) / 1d + 1
  return { startsAt: r.storageStartsAt, chargeableDays: days, amount: q.storageDailyRate * days }

mutation openRestoration(owner: principal, model: text 1..160, serialNumber: text 1..100, ownerContact: text 1..300, cabinetPhoto: image <=10000000, changerPhoto: image <=10000000, lightingPhoto: image <=10000000, price: money USD, storageDailyRate: money USD, workshopNotes: text <=4000): server
  require exists staff[viewer, role = 'foreman'] else FOREMAN_ONLY
  require price > 0 and storageDailyRate > 0 else POSITIVE_PRICE_REQUIRED
  r = insert restorations { owner, model, serialNumber, ownerContact, cabinetPhoto, changerPhoto, lightingPhoto, workshopNotes, openedBy: viewer, openedAt: now, quoteDeadline: now + 30d, stage: 'awaiting_quote' }
  require r != null else CREATION_NOT_READABLE
  insert quotes { restoration: r.id, owner, price, storageDailyRate, issuedAt: now, expiresAt: now + 30d }
  return r.id

mutation acceptQuote(restoration: restorations): server
  r = restorations[restoration] ! else NOT_FOUND
  require r.owner = viewer else OWNER_ONLY
  q = quotes[restoration = restoration] ! else NOT_FOUND
  require r.stage = 'awaiting_quote' and q.acceptedAt = null else QUOTE_NOT_OPEN
  require now < r.quoteDeadline and now < q.expiresAt else QUOTE_EXPIRED
  update quotes[q] { acceptedAt: now, acceptedBy: viewer }
  update restorations[r] { stage: 'teardown' }
  return r.id

mutation returnJukebox(restoration: restorations): server
  require exists staff[viewer, role = 'foreman'] else FOREMAN_ONLY
  r = restorations[restoration] ! else NOT_FOUND
  require r.stage = 'awaiting_quote' or r.stage = 'return_due' else RETURN_NOT_DUE
  require now >= r.quoteDeadline else QUOTE_STILL_OPEN
  update restorations[r] { stage: 'returned', returnedAt: now }
  return r.id

mutation updateWorkshopNotes(restoration: restorations, notes: text <=4000): server
  require exists staff[viewer] else STAFF_ONLY
  update restorations[restoration] { workshopNotes: notes }
  return null

mutation advanceStage(restoration: restorations): server
  require exists staff[viewer] else STAFF_ONLY
  r = restorations[restoration] ! else NOT_FOUND
  if r.stage = 'teardown':
    update restorations[r] { stage: 'changer_rebuild' }
  elif r.stage = 'changer_rebuild':
    request = selectorRequests[restoration = restoration]
    if request != null:
      require exists selectorInstallations[request = request.id] else SELECTOR_REPLACEMENT_PENDING
    update restorations[r] { stage: 'rewiring' }
  elif r.stage = 'rewiring':
    update restorations[r] { stage: 'cabinet_polish' }
  else:
    require false else INVALID_STAGE_TRANSITION
  return r.id

-- This persists the owner's in-app ready notice; it is the 45-day clock anchor.
mutation sendReadyNotice(restoration: restorations, notice: text 1..1000): server
  require exists staff[viewer] else STAFF_ONLY
  r = restorations[restoration] ! else NOT_FOUND
  require r.stage = 'cabinet_polish' and r.readyAt = null else NOT_READY_FOR_NOTICE
  update restorations[r] { stage: 'ready', readyAt: now, readyNotice: notice, storageStartsAt: now + 45d }
  return r.id

mutation collectJukebox(restoration: restorations): server
  require exists staff[viewer, role = 'foreman'] else FOREMAN_ONLY
  r = restorations[restoration] ! else NOT_FOUND
  require r.stage = 'ready' and r.storageStartsAt != null else NOT_READY
  update restorations[r] { stage: 'collected', collectedAt: now, storageCharging: now >= r.storageStartsAt }
  return r.id

mutation requestSelectorReplacement(restoration: restorations, originalSelector: text 1..1000, reason: text 1..2000): server
  require exists staff[viewer] else STAFF_ONLY
  r = restorations[restoration] ! else NOT_FOUND
  require r.stage = 'teardown' or r.stage = 'changer_rebuild' else WRONG_STAGE
  return insert selectorRequests { restoration, originalSelector, reason, requestedBy: viewer, requestedAt: now }

mutation consentToSelectorReplacement(request: selectorRequests, writtenConsent: file <=10000000 ('application/pdf', 'image/jpeg', 'image/png'), statement: text 1..2000): server
  req = selectorRequests[request] ! else NOT_FOUND
  r = restorations[req.restoration] ! else NOT_FOUND
  require r.owner = viewer else OWNER_ONLY
  require r.stage = 'teardown' or r.stage = 'changer_rebuild' else WRONG_STAGE
  return insert selectorConsents { request, owner: viewer, writtenConsent, statement, consentedAt: now }

mutation approveSelectorReplacement(request: selectorRequests, rationale: text 1..2000): server
  require exists staff[viewer, role = 'master'] else MASTER_ONLY
  req = selectorRequests[request] ! else NOT_FOUND
  r = restorations[req.restoration] ! else NOT_FOUND
  require r.stage = 'teardown' or r.stage = 'changer_rebuild' else WRONG_STAGE
  consent = selectorConsents[request = request] ! else WRITTEN_CONSENT_REQUIRED
  require consent.owner = r.owner else CONSENT_OWNER_MISMATCH
  return insert selectorApprovals { request, consent: consent.id, approvedBy: viewer, approvedAt: now, rationale }

mutation installSelectorReplacement(request: selectorRequests, replacementDetails: text 1..2000): server
  require exists staff[viewer] else STAFF_ONLY
  req = selectorRequests[request] ! else NOT_FOUND
  r = restorations[req.restoration] ! else NOT_FOUND
  require r.stage = 'changer_rebuild' else WRONG_STAGE
  approval = selectorApprovals[request = request] ! else MASTER_APPROVAL_REQUIRED
  return insert selectorInstallations { request, approval: approval.id, installedBy: viewer, installedAt: now, replacementDetails }

-- No expiry deletion: owners retain their records, quotes and evidence.
job enforceDeadlines():
  for r in restorations:
    if r.stage = 'awaiting_quote' and now >= r.quoteDeadline:
      update restorations[r] { stage: 'return_due' }
    if r.stage = 'ready' and r.storageStartsAt != null and now >= r.storageStartsAt and not r.storageCharging:
      update restorations[r] { storageCharging: true }
schedule deadlineSweep every 1m: enforceDeadlines
