use identity password

table roles:
  principal: principal
  role: enum('owner', 'foreman', 'technician', 'master')
  unique principal
  read <- .principal = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

table jukeboxes:
  owner: principal
  description: text 1..200
  cabinetPhoto: image <=10000000
  changerPhoto: image <=10000000
  lightingPhoto: image <=10000000
  quotedPrice: money USD
  openedAt: time
  quoteExpiresAt: time
  status: enum('quoted', 'return_due', 'teardown', 'changer_rebuild', 'rewiring', 'cabinet_polish', 'ready', 'collected', 'returned') default 'quoted'
  internalNote: text <=2000 default '' read <- exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
  immutable owner, description, cabinetPhoto, changerPhoto, lightingPhoto, quotedPrice, openedAt, quoteExpiresAt
  read <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'foreman']
  update <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
  online only

table quoteAcceptances:
  jukebox: jukeboxes
  acceptedBy: principal
  acceptedAt: time
  unique jukebox
  immutable jukebox, acceptedBy, acceptedAt
  read <- exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
  insert <- .acceptedBy = viewer and exists jukeboxes[.jukebox, owner = viewer]
  online only

table readyNotices:
  jukebox: jukeboxes
  issuedBy: principal
  readyAt: time
  storageStartsAt: time
  unique jukebox
  immutable jukebox, issuedBy, readyAt, storageStartsAt
  read <- exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master']
  online only

table closures:
  jukebox: jukeboxes
  kind: enum('collected', 'returned')
  closedAt: time
  recordedBy: principal
  unique jukebox
  immutable jukebox, kind, closedAt, recordedBy
  read <- exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master']
  online only

-- A storage-charge obligation, independent of an unspecified tariff/payment system.
table storageCharges:
  jukebox: jukeboxes
  startsAt: time
  recordedAt: time
  endsAt: time ?
  unique jukebox
  immutable jukebox, startsAt, recordedAt
  read <- exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master']
  update <- exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master']
  online only

table selectorApprovals:
  jukebox: jukeboxes
  replacementReason: text 1..2000
  ownerWrittenConsent: image <=10000000 read <- exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'master']
  consentText: text 1..2000 read <- exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'master']
  approvedBy: principal
  approvedAt: time
  unique jukebox
  immutable jukebox, replacementReason, ownerWrittenConsent, consentText, approvedBy, approvedAt
  read <- exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'master'] and .approvedBy = viewer
  online only

mutation provision(principal: principal, role: enum('owner', 'foreman', 'technician', 'master')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role } if absent

mutation openRestoration(owner: principal, description: text 1..200, cabinetPhoto: image <=10000000, changerPhoto: image <=10000000, lightingPhoto: image <=10000000, quotedPrice: money USD):
  require exists roles[viewer, role = 'foreman'] else NOT_FOREMAN
  require exists roles[owner, role = 'owner'] else NOT_OWNER
  require quotedPrice >= 0 else INVALID_PRICE
  return insert jukeboxes { owner, description, cabinetPhoto, changerPhoto, lightingPhoto, quotedPrice, openedAt: now, quoteExpiresAt: now + 30d }

mutation acceptQuote(jukebox: jukeboxes):
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require row.owner = viewer else NOT_OWNER
  require now < row.quoteExpiresAt else QUOTE_EXPIRED
  require row.status = 'quoted' else WRONG_STAGE
  insert quoteAcceptances { jukebox, acceptedBy: viewer, acceptedAt: now }
  update jukeboxes[jukebox] { status: 'teardown' }
  return null

mutation returnExpired(jukebox: jukeboxes):
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master'] else NOT_SHOP_MANAGER
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require now >= row.quoteExpiresAt else QUOTE_STILL_OPEN
  require row.status = 'quoted' or row.status = 'return_due' else WRONG_STAGE
  insert closures { jukebox, kind: 'returned', closedAt: now, recordedBy: viewer }
  update jukeboxes[jukebox] { status: 'returned' }
  return null

mutation advanceRestoration(jukebox: jukeboxes, stage: enum('changer_rebuild', 'rewiring', 'cabinet_polish')):
  require exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master'] else NOT_TECHNICIAN
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require (row.status = 'teardown' and stage = 'changer_rebuild') or (row.status = 'changer_rebuild' and stage = 'rewiring') or (row.status = 'rewiring' and stage = 'cabinet_polish') else WRONG_STAGE
  update jukeboxes[jukebox] { status: stage }
  return null

mutation setInternalNote(jukebox: jukeboxes, internalNote: text <=2000):
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master'] else NOT_STAFF
  row = jukeboxes[jukebox] ! else NOT_FOUND
  update jukeboxes[jukebox] { internalNote }
  return null

mutation approveSelectorReplacement(jukebox: jukeboxes, replacementReason: text 1..2000, ownerWrittenConsent: image <=10000000, consentText: text 1..2000):
  require exists roles[viewer, role = 'master'] else NOT_MASTER
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require row.status = 'teardown' or row.status = 'changer_rebuild' or row.status = 'rewiring' or row.status = 'cabinet_polish' else WRONG_STAGE
  return insert selectorApprovals { jukebox, replacementReason, ownerWrittenConsent, consentText, approvedBy: viewer, approvedAt: now }

mutation markReady(jukebox: jukeboxes):
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master'] else NOT_SHOP_MANAGER
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require row.status = 'cabinet_polish' else WRONG_STAGE
  insert readyNotices { jukebox, issuedBy: viewer, readyAt: now, storageStartsAt: now + 45d }
  update jukeboxes[jukebox] { status: 'ready' }
  return null

mutation collectJukebox(jukebox: jukeboxes):
  require exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'master'] else NOT_SHOP_MANAGER
  row = jukeboxes[jukebox] ! else NOT_FOUND
  require row.status = 'ready' else WRONG_STAGE
  notice = readyNotices[jukebox] ! else NO_READY_NOTICE
  if now >= notice.storageStartsAt:
    insert storageCharges { jukebox, startsAt: notice.storageStartsAt, recordedAt: now, endsAt: null } if absent
    update storageCharges[jukebox] { endsAt: now }
  insert closures { jukebox, kind: 'collected', closedAt: now, recordedBy: viewer }
  update jukeboxes[jukebox] { status: 'collected' }
  return null

query board(c: cursor ?):
  if exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']:
    return jukeboxes where .status != 'collected' and .status != 'returned' last 100 by .id after c
  return jukeboxes where .owner = viewer last 100 by .id after c

query restoration(jukebox: jukeboxes):
  return jukeboxes[jukebox]

query acceptance(jukebox: jukeboxes):
  return quoteAcceptances[jukebox]

query readyNotice(jukebox: jukeboxes):
  return readyNotices[jukebox]

query closure(jukebox: jukeboxes):
  return closures[jukebox]

query selectorApproval(jukebox: jukeboxes):
  return selectorApprovals[jukebox]

query storageCharge(jukebox: jukeboxes):
  return storageCharges[jukebox]

-- Catch up all expired quotes, even after downtime; physical return is staff-recorded.
job expireQuotes(periodStart: time, periodEnd: time):
  for row in jukeboxes where .quoteExpiresAt <= periodEnd by .quoteExpiresAt:
    if row.status = 'quoted':
      update jukeboxes[row.id] { status: 'return_due' }

schedule expireQuotesEveryMinute every 1m: expireQuotes

-- Late sweep execution never shifts the 45-day charging anchor.
job beginStorageCharges(periodStart: time, periodEnd: time):
  for notice in readyNotices where .storageStartsAt <= periodEnd by .storageStartsAt:
    row = jukeboxes[notice.jukebox]
    if row != null and row.status = 'ready':
      insert storageCharges { jukebox: notice.jukebox, startsAt: notice.storageStartsAt, recordedAt: now, endsAt: null } if absent

schedule storageChargesEveryMinute every 1m: beginStorageCharges

invariant jukeboxes.read only .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
invariant jukeboxes.internalNote read only exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
invariant selectorApprovals.insert only exists roles[viewer, role = 'master']
invariant selectorApprovals.ownerWrittenConsent read only exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'master']
invariant selectorApprovals.consentText read only exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'master']
invariant quoteAcceptances.read only exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
invariant readyNotices.read only exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
invariant closures.read only exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
invariant storageCharges.read only exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
invariant selectorApprovals.read only exists jukeboxes[.jukebox, owner = viewer] or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'master']
