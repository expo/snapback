use identity password

-- Roles are assigned by an operator, never supplied at signup.
table roles:
  principal: principal
  role: enum('owner', 'foreman', 'technician', 'master_technician')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table jukeboxes:
  owner: principal
  description: text 1..200
  cabinetPhoto: image <=5000000
  changerPhoto: image <=5000000
  lightingPhoto: image <=5000000
  quotedPriceCents: int 1..100000000 read <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician']
  currency: text 3..3 read <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician']
  openedBy: principal
  openedAt: time
  quoteExpiresAt: time
  status: enum('quoted', 'accepted', 'teardown', 'changer_rebuild', 'rewiring', 'cabinet_polish', 'ready', 'collected', 'returned') default 'quoted'
  acceptedAt: time ?
  readyAt: time ?
  readyNotice: text 1..1000 ?
  storageStartsAt: time ?
  storageChargeStartedAt: time ?
  collectedAt: time ?
  returnedAt: time ?
  workshopNote: text <=2000 default '' read <- exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
  immutable owner, description, cabinetPhoto, changerPhoto, lightingPhoto, quotedPriceCents, currency, openedBy, openedAt, quoteExpiresAt
  immutable acceptedAt when .acceptedAt != null
  immutable readyAt, readyNotice, storageStartsAt when .readyAt != null
  immutable storageChargeStartedAt when .storageChargeStartedAt != null
  immutable collectedAt when .collectedAt != null
  immutable returnedAt when .returnedAt != null
  read <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
  insert <- exists roles[viewer, role = 'foreman'] and .openedBy = viewer and .status = 'quoted'
  update <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
  online only

-- The owner places their own written consent. Each image has a single home.
table selectorConsents:
  jukebox: jukeboxes
  owner: principal
  writtenConsent: image <=5000000
  consentText: text 1..2000
  submittedAt: time
  unique jukebox
  immutable jukebox, owner, writtenConsent, consentText, submittedAt
  read <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician']
  insert <- .owner = viewer and exists roles[viewer, role = 'owner']
  online only

table selectorApprovals:
  jukebox: jukeboxes
  owner: principal
  consent: selectorConsents
  approvedBy: principal
  approvedAt: time
  reason: text 1..2000
  unique jukebox
  immutable jukebox, owner, consent, approvedBy, approvedAt, reason
  read <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
  insert <- exists roles[viewer, role = 'master_technician'] and .approvedBy = viewer
  online only

table selectorReplacements:
  jukebox: jukeboxes
  owner: principal
  approval: selectorApprovals
  replacedBy: principal
  replacedAt: time
  workRecord: text 1..2000
  unique jukebox
  immutable jukebox, owner, approval, replacedBy, replacedAt, workRecord
  read <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
  insert <- (exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']) and .replacedBy = viewer
  online only

mutation provision(principal: principal, role: enum('owner', 'foreman', 'technician', 'master_technician')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role } if absent

mutation openRestoration(owner: principal, description: text 1..200, cabinetPhoto: image <=5000000, changerPhoto: image <=5000000, lightingPhoto: image <=5000000, quotedPriceCents: int 1..100000000, currency: text 3..3):
  require exists roles[viewer, role = 'foreman'] else NOT_FOREMAN
  require exists roles[owner, role = 'owner'] else NOT_OWNER_ACCOUNT
  return insert jukeboxes { owner, description, cabinetPhoto, changerPhoto, lightingPhoto, quotedPriceCents, currency, openedBy: viewer, openedAt: now, quoteExpiresAt: now + 30d }

mutation acceptQuote(jukebox: jukeboxes):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require row.owner = viewer and exists roles[viewer, role = 'owner'] else NOT_OWNER
  require now < row.quoteExpiresAt else QUOTE_EXPIRED
  require row.status = 'quoted' else NOT_AWAITING_ACCEPTANCE
  update jukeboxes[jukebox] { status: 'accepted', acceptedAt: now }
  return null

mutation returnUnaccepted(jukebox: jukeboxes):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician'] else NOT_HANDOVER_STAFF
  require now >= row.quoteExpiresAt else QUOTE_STILL_OPEN
  require row.status = 'quoted' else NOT_AWAITING_ACCEPTANCE
  update jukeboxes[jukebox] { status: 'returned', returnedAt: now }
  return null

mutation advanceWork(jukebox: jukeboxes, stage: enum('teardown', 'changer_rebuild', 'rewiring', 'cabinet_polish')):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician'] else NOT_TECHNICIAN
  require row.acceptedAt != null else QUOTE_NOT_ACCEPTED
  require (row.status = 'accepted' and stage = 'teardown') or (row.status = 'teardown' and stage = 'changer_rebuild') or (row.status = 'changer_rebuild' and stage = 'rewiring') or (row.status = 'rewiring' and stage = 'cabinet_polish') else BAD_STAGE_TRANSITION
  update jukeboxes[jukebox] { status: stage }
  return null

mutation saveWorkshopNote(jukebox: jukeboxes, workshopNote: text <=2000):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician'] else NOT_STAFF
  require row.status != 'collected' and row.status != 'returned' else CLOSED
  update jukeboxes[jukebox] { workshopNote }
  return null

mutation issueReadyNotice(jukebox: jukeboxes, readyNotice: text 1..1000):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician'] else NOT_HANDOVER_STAFF
  require row.status = 'cabinet_polish' else WORK_NOT_FINISHED
  require row.readyAt = null else NOTICE_ALREADY_ISSUED
  update jukeboxes[jukebox] { status: 'ready', readyAt: now, readyNotice, storageStartsAt: now + 45d }
  return null

mutation startStorageCharge(jukebox: jukeboxes):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician'] else NOT_HANDOVER_STAFF
  require row.storageStartsAt != null and now >= row.storageStartsAt else STORAGE_NOT_DUE
  require row.status = 'ready' else NOT_AWAITING_COLLECTION
  require row.storageChargeStartedAt = null else CHARGE_ALREADY_STARTED
  update jukeboxes[jukebox] { storageChargeStartedAt: row.storageStartsAt }
  return null

mutation collectJukebox(jukebox: jukeboxes):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician'] else NOT_HANDOVER_STAFF
  require row.readyAt != null and row.storageStartsAt != null else NO_READY_NOTICE
  require row.status = 'ready' else NOT_AWAITING_COLLECTION
  if now >= row.storageStartsAt and row.storageChargeStartedAt = null:
    update jukeboxes[jukebox] { storageChargeStartedAt: row.storageStartsAt }
  update jukeboxes[jukebox] { status: 'collected', collectedAt: now }
  return null

mutation giveSelectorConsent(jukebox: jukeboxes, writtenConsent: image <=5000000, consentText: text 1..2000):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require row.owner = viewer and exists roles[viewer, role = 'owner'] else NOT_OWNER
  require row.acceptedAt != null else QUOTE_NOT_ACCEPTED
  require row.status = 'accepted' or row.status = 'teardown' or row.status = 'changer_rebuild' else SELECTOR_WORK_CLOSED
  return insert selectorConsents { jukebox, owner: viewer, writtenConsent, consentText, submittedAt: now }

mutation approveSelectorReplacement(jukebox: jukeboxes, consent: selectorConsents, reason: text 1..2000):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require exists roles[viewer, role = 'master_technician'] else NOT_MASTER_TECHNICIAN
  evidence = selectorConsents[consent] ! else CONSENT_REQUIRED
  require evidence.jukebox = jukebox and evidence.owner = row.owner else CONSENT_MISMATCH
  require row.acceptedAt != null else QUOTE_NOT_ACCEPTED
  require row.status = 'teardown' or row.status = 'changer_rebuild' else SELECTOR_WORK_CLOSED
  return insert selectorApprovals { jukebox, owner: row.owner, consent, approvedBy: viewer, approvedAt: now, reason }

mutation recordSelectorReplacement(jukebox: jukeboxes, approval: selectorApprovals, workRecord: text 1..2000):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician'] else NOT_TECHNICIAN
  decision = selectorApprovals[approval] ! else APPROVAL_REQUIRED
  require decision.jukebox = jukebox and decision.owner = row.owner else APPROVAL_MISMATCH
  require row.status = 'changer_rebuild' else NOT_CHANGER_REBUILD
  return insert selectorReplacements { jukebox, owner: row.owner, approval, replacedBy: viewer, replacedAt: now, workRecord }

query myJukeboxes(c: cursor ?):
  return jukeboxes where .owner = viewer last 50 by .id after c

query jukeboxDetail(jukebox: jukeboxes):
  return jukeboxes[jukebox]

query shopBoard(c: cursor ?):
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician'] else NOT_STAFF
  return jukeboxes where .status != 'collected' and .status != 'returned' last 50 by .id after c

query returnsDue(c: cursor ?):
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician'] else NOT_HANDOVER_STAFF
  return jukeboxes where .status = 'quoted' and .quoteExpiresAt <= now last 50 by .id after c

query storageChargesDue(c: cursor ?):
  return jukeboxes where .status = 'ready' and .storageStartsAt != null and .storageStartsAt <= now last 50 by .id after c

query selectorConsent(jukebox: jukeboxes):
  return selectorConsents[jukebox]

query selectorApproval(jukebox: jukeboxes):
  return selectorApprovals[jukebox]

query selectorReplacement(jukebox: jukeboxes):
  return selectorReplacements[jukebox]

-- Independent intent: keep customer records and commercial/staff payload private.
invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'
invariant jukeboxes.read only .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
invariant jukeboxes.insert only exists roles[viewer, role = 'foreman']
invariant jukeboxes.quotedPriceCents read only .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician']
invariant jukeboxes.currency read only .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician']
invariant jukeboxes.workshopNote read only exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
invariant selectorConsents.read only .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master_technician']
invariant selectorConsents.insert only .owner = viewer and exists roles[viewer, role = 'owner']
invariant selectorApprovals.insert only exists roles[viewer, role = 'master_technician']
invariant selectorApprovals.read only .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
invariant selectorReplacements.insert only exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
invariant selectorReplacements.read only .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master_technician']
