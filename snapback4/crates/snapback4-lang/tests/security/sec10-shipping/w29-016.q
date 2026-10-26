-- Vintage Tractor Restorations.
-- A restoration barn: intake logs tractors (quote + intake albums holding
-- frame/engine/paint photos), owners approve within 30 days, stages run
-- teardown -> engine rebuild -> paint -> field test -> ready, collection after
-- 60 days past ready accrues a storage fee, and only the barn owner may
-- approve replacing a numbered engine block.
-- v2: intake photos moved from tractors into intakeAlbums, one album per
-- tractor at migration, more albums per tractor afterwards; album writes are
-- intake-manager-only; album reads follow the tractor audience.
use identity password

table roles:
  principal: principal
  role: enum('tractor_owner', 'mechanic', 'intake_manager', 'barn_owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'barn_owner'] or exists roles[principal = viewer, role = 'intake_manager'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  cap 100
  online only

mutation provision(principal: principal, role: enum('tractor_owner', 'mechanic', 'intake_manager', 'barn_owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query ownerDirectory(c: cursor ?):
  require exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner'] else NOT_INTAKE
  return roles where .role = 'tractor_owner' last 50 by .id after c

table tractors:
  owner: principal
  make: text 1..60
  model: text 1..60
  year: int 1880..2026
  quotePrice: money USD
  status: enum('quoted', 'approved', 'teardown', 'engine_rebuild', 'paint', 'field_test', 'ready', 'collected', 'trailered_back') default 'quoted'
  quotedAt: time default now
  approvedAt: time ?
  readyAt: time ?
  collectedAt: time ?
  storageFeeCents: int 0.. default 0
  immutable owner, quotedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner']
  insert <- exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner']
  update <- exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner'] or .owner = viewer
  delete <- deny
  cap 5000
  online only

table intakeAlbums:
  tractor: tractors on delete cascade
  framePhoto: image <=5000000
  enginePhoto: image <=5000000
  paintPhoto: image <=5000000
  note: text 1..200 ?
  createdAt: time ?
  immutable tractor
  read through .tractor
  insert <- exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner']
  update <- exists roles[principal = viewer, role = 'intake_manager']
  delete <- exists roles[principal = viewer, role = 'intake_manager']
  cap 20000
  online only

extract intakeAlbums from tractors via tractor: {framePhoto: framePhoto, enginePhoto: enginePhoto, paintPhoto: paintPhoto}

table engineBlocks:
  tractor: tractors
  consent: text 1..1000
  approvedBy: principal
  approvedAt: time default now
  immutable tractor
  unique tractor
  read through .tractor
  insert <- exists roles[principal = viewer, role = 'barn_owner']
  update <- deny
  delete <- deny
  cap 5000
  online only

query myTractors(c: cursor ?):
  return tractors where .owner = viewer last 50 by .id after c

query barnBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner'] else NOT_STAFF
  return tractors last 50 by .id after c

query tractorDetail(id: tractors):
  return tractors[id]

query intakeAlbums(tractor: tractors, c: cursor ?):
  return intakeAlbums where .tractor = tractor last 50 by .id after c

query engineApproval(tractor: tractors):
  return engineBlocks[tractor = tractor]

mutation logTractor(owner: principal, make: text 1..60, model: text 1..60, year: int 1880..2026, framePhoto: image <=5000000, enginePhoto: image <=5000000, paintPhoto: image <=5000000, quotePrice: money USD):
  require exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner'] else NOT_INTAKE
  require quotePrice >= 100 else QUOTE_TOO_LOW 'Restoration quotes start at $1.'
  t = insert tractors { owner, make, model, year, quotePrice, status: 'quoted', quotedAt: now }
  insert intakeAlbums { tractor: t.id, framePhoto, enginePhoto, paintPhoto, createdAt: now }
  return t

mutation addIntakeAlbum(tractor: tractors, framePhoto: image <=5000000, enginePhoto: image <=5000000, paintPhoto: image <=5000000, note: text 1..200 ?):
  require exists roles[principal = viewer, role = 'intake_manager'] else NOT_INTAKE 'Only the intake manager may manage intake albums.'
  t = tractors[tractor] ! else NOT_FOUND
  return insert intakeAlbums { tractor: t.id, framePhoto, enginePhoto, paintPhoto, note, createdAt: now }

mutation replaceIntakeAlbumPhotos(album: intakeAlbums, framePhoto: image <=5000000, enginePhoto: image <=5000000, paintPhoto: image <=5000000):
  require exists roles[principal = viewer, role = 'intake_manager'] else NOT_INTAKE 'Only the intake manager may manage intake albums.'
  a = intakeAlbums[album] ! else NOT_FOUND
  update intakeAlbums[a.id] { framePhoto, enginePhoto, paintPhoto }
  return null

mutation removeIntakeAlbum(album: intakeAlbums):
  require exists roles[principal = viewer, role = 'intake_manager'] else NOT_INTAKE 'Only the intake manager may manage intake albums.'
  a = intakeAlbums[album] ! else NOT_FOUND
  delete intakeAlbums[a.id]
  return null

mutation approveQuote(tractor: tractors):
  t = tractors[tractor] ! else NOT_FOUND
  require t.owner = viewer else NOT_YOUR_TRACTOR 'Only the tractor owner can approve its quote.'
  require t.status = 'quoted' else BAD_STATUS 'Only a quoted tractor can be approved.'
  require now <= t.quotedAt + 30d else QUOTE_EXPIRED 'The 30-day approval window has passed; the tractor will be trailered back.'
  update tractors[tractor] { status: 'approved', approvedAt: now }
  return null

mutation advanceStage(tractor: tractors, to: enum('teardown', 'engine_rebuild', 'paint', 'field_test')):
  require exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'barn_owner'] else NOT_MECHANIC
  t = tractors[tractor] ! else NOT_FOUND
  require t.status = 'approved' or t.status = 'teardown' or t.status = 'engine_rebuild' or t.status = 'paint' else BAD_TRANSITION 'Tractors advance one stage at a time from an approved quote.'
  require to != 'teardown' or t.status = 'approved' else BAD_TRANSITION
  require to != 'engine_rebuild' or t.status = 'teardown' else BAD_TRANSITION
  require to != 'paint' or t.status = 'engine_rebuild' else BAD_TRANSITION
  require to != 'field_test' or t.status = 'paint' else BAD_TRANSITION
  update tractors[tractor] { status: to }
  return null

mutation markReady(tractor: tractors):
  require exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'barn_owner'] else NOT_MECHANIC
  t = tractors[tractor] ! else NOT_FOUND
  require t.status = 'field_test' else BAD_TRANSITION 'Only a field-tested tractor can be marked ready.'
  update tractors[tractor] { status: 'ready', readyAt: now }
  return null

mutation collectTractor(tractor: tractors):
  require exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner'] else NOT_INTAKE
  t = tractors[tractor] ! else NOT_FOUND
  require t.status = 'ready' else BAD_STATUS 'Only a finished (ready) tractor can be collected.'
  readyAt = t.readyAt ?? now
  lateDays = (now - readyAt) / 1d - 60
  fee = lateDays * 2500 if lateDays > 0 else 0
  update tractors[tractor] { status: 'collected', collectedAt: now, storageFeeCents: fee }
  return null

mutation approveEngineBlock(tractor: tractors, consent: text 1..1000):
  require exists roles[principal = viewer, role = 'barn_owner'] else NOT_BARN_OWNER 'Only the barn owner can approve replacing a numbered engine block.'
  t = tractors[tractor] ! else NOT_FOUND
  require t.status != 'collected' and t.status != 'trailered_back' else TERMINAL 'The tractor has left the barn.'
  return insert engineBlocks { tractor, consent, approvedBy: viewer, approvedAt: now }

job expireQuotes():
  for t in tractors:
    if t.status = 'quoted' and t.quotedAt + 30d < now:
      update tractors[t.id] { status: 'trailered_back' }
schedule expireQuotesDaily every 1d at 08:00: expireQuotes

job flagStorage():
  for t in tractors:
    if t.status = 'ready':
      readyAt = t.readyAt ?? now
      if readyAt + 60d < now and t.storageFeeCents = 0:
        lateDays = (now - readyAt) / 1d - 60
        update tractors[t.id] { storageFeeCents: lateDays * 2500 }
schedule flagStorageDaily every 1d at 09:00: flagStorage

-- Spec privacy and authority intent.
invariant roles.read only .principal = viewer or exists roles[principal = viewer, role = 'barn_owner'] or exists roles[principal = viewer, role = 'intake_manager']
invariant roles.insert only viewer = 'service:operator'
invariant tractors.read only .owner = viewer or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner']
invariant tractors.insert only exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner']
invariant intakeAlbums.read only .tractor.owner = viewer or exists roles[principal = viewer, role = 'mechanic'] or exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner']
invariant intakeAlbums.insert only exists roles[principal = viewer, role = 'intake_manager'] or exists roles[principal = viewer, role = 'barn_owner']
invariant engineBlocks.insert only exists roles[principal = viewer, role = 'barn_owner']
