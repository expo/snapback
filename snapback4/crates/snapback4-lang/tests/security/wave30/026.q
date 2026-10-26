use identity password

table roles:
  principal: principal
  role: enum('owner', 'clerk', 'technician', 'shopOwner')
  label: text 1..160
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shopOwner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'clerk', 'technician', 'shopOwner'), label: text 1..160):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] {principal, role, label}
query myRole():
  return roles[viewer]
query customers(c: cursor ?):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shopOwner'] else NOT_CLERK
  return roles where .role = 'owner' last 100 by .id after c {principal, label}

table cameras:
  owner: principal
  model: text 1..100
  serial: text 1..80
  quoteCents: int 1..2000000
  bodyPhoto: image <=5000000
  mountPhoto: image <=5000000
  shutterPhoto: image <=5000000
  serialPhoto: image <=5000000
  loggedAt: time default now
  quoteDeadline: time
  status: enum('quoted', 'approved', 'opened', 'shutter_work', 'light_sealing', 'test_roll', 'ready', 'picked_up', 'returned') default 'quoted'
  approvedAt: time ?
  needsShutter: bool default false
  writtenConsent: text 10..3000 ?
  consentAt: time ?
  shutterApprovedBy: principal ?
  shutterApprovedAt: time ?
  pickupAt: time ?
  leakReport: text 10..2000 ?
  leakReportedAt: time ?
  freeRepair: bool default false
  immutable owner, model, serial, quoteCents, bodyPhoto, mountPhoto, shutterPhoto, serialPhoto, loggedAt, quoteDeadline
  read <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shopOwner']
  insert <- exists roles[viewer, role = 'clerk']
  update <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shopOwner']
  online only

invariant cameras.read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'technician'] or exists roles[viewer, role = 'shopOwner']
invariant cameras always .bodyPhoto != null and .mountPhoto != null and .shutterPhoto != null and .serialPhoto != null

query board(c: cursor ?):
  return cameras last 100 by .id after c
query camera(camera: cameras):
  return cameras[camera]
mutation intake(owner: principal, model: text 1..100, serial: text 1..80, quoteCents: int 1..2000000, bodyPhoto: image <=5000000, mountPhoto: image <=5000000, shutterPhoto: image <=5000000, serialPhoto: image <=5000000):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  require exists roles[owner, role = 'owner'] else NOT_CAMERA_OWNER
  return insert cameras {owner, model, serial, quoteCents, bodyPhoto, mountPhoto, shutterPhoto, serialPhoto, quoteDeadline: now + 21d}
mutation approveQuote(camera: cameras):
  row = cameras[camera] ! else NOT_FOUND
  require row.owner = viewer else NOT_CAMERA_OWNER
  require row.status = 'quoted' else WRONG_STAGE
  require now < row.quoteDeadline else QUOTE_EXPIRED
  update cameras[camera] {status: 'approved', approvedAt: now}
mutation moveBench(camera: cameras, stage: enum('opened', 'shutter_work', 'light_sealing', 'test_roll', 'ready')):
  require exists roles[viewer, role = 'technician'] else NOT_TECHNICIAN
  row = cameras[camera] ! else NOT_FOUND
  require (row.status = 'approved' and stage = 'opened') or (row.status = 'opened' and stage = 'shutter_work') or (row.status = 'shutter_work' and stage = 'light_sealing') or (row.status = 'light_sealing' and stage = 'test_roll') or (row.status = 'test_roll' and stage = 'ready') else WRONG_STAGE
  require stage != 'light_sealing' or not row.needsShutter or row.shutterApprovedAt != null else SHUTTER_APPROVAL_REQUIRED
  update cameras[camera] {status: stage}
mutation proposeShutter(camera: cameras):
  require exists roles[viewer, role = 'technician'] else NOT_TECHNICIAN
  row = cameras[camera] ! else NOT_FOUND
  require row.status = 'opened' or row.status = 'shutter_work' else WRONG_STAGE
  require not row.needsShutter else ALREADY_REQUESTED
  update cameras[camera] {needsShutter: true}
mutation consentShutter(camera: cameras, writtenConsent: text 10..3000):
  row = cameras[camera] ! else NOT_FOUND
  require row.owner = viewer else NOT_CAMERA_OWNER
  require row.needsShutter and row.shutterApprovedAt = null else NO_PENDING_SHUTTER
  require row.status = 'opened' or row.status = 'shutter_work' else WRONG_STAGE
  update cameras[camera] {writtenConsent, consentAt: now}
mutation approveShutter(camera: cameras):
  require exists roles[viewer, role = 'shopOwner'] else NOT_SHOP_OWNER
  row = cameras[camera] ! else NOT_FOUND
  require row.needsShutter and row.shutterApprovedAt = null else NO_PENDING_SHUTTER
  require row.writtenConsent != null and row.consentAt != null else WRITTEN_CONSENT_REQUIRED
  require row.status = 'opened' or row.status = 'shutter_work' else WRONG_STAGE
  update cameras[camera] {shutterApprovedBy: viewer, shutterApprovedAt: now}
mutation pickup(camera: cameras):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  row = cameras[camera] ! else NOT_FOUND
  require row.status = 'ready' else WRONG_STAGE
  update cameras[camera] {status: 'picked_up', pickupAt: row.pickupAt ?? now}
mutation reportLeak(camera: cameras, description: text 10..2000):
  row = cameras[camera] ! else NOT_FOUND
  require row.owner = viewer else NOT_CAMERA_OWNER
  require row.status = 'picked_up' and row.pickupAt != null else NOT_PICKED_UP
  require now <= row.pickupAt + 90d else WARRANTY_EXPIRED
  require row.leakReportedAt = null else ALREADY_REPORTED
  update cameras[camera] {leakReport: description, leakReportedAt: now, freeRepair: true, status: 'opened'}

job returnExpired():
  for row in cameras:
    if row.status = 'quoted' and now >= row.quoteDeadline:
      update cameras[row.id] {status: 'returned'}
schedule quoteExpiry every 1m: returnExpired
