use identity password

-- Roster grants come only from the local operator, never signup arguments.
table roles:
  principal: principal
  role: enum('intake', 'assistant', 'senior', 'owner')
  displayName: text 1..100
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'senior'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only


mutation provision(principal: principal, role: enum('intake', 'assistant', 'senior', 'owner'), displayName: text 1..100):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, displayName }

query myRole():
  return roles[viewer]

query owners(c: cursor ?):
  require exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'senior'] else NOT_INTAKE
  return roles where .role = 'owner' first 100 by .id after c { principal, displayName }

table pieces:
  owner: principal
  title: text 1..120
  ownerName: text 1..100
  address: text 5..400
  photos: [image <=5000000] 1..6
  weightMg: int 1..1000000
  markings: text 1..500
  tests: text <=2000 default ''
  location: enum('vault', 'bench-a', 'bench-b') default 'vault'
  intakeAt: time default now
  report: text 10..4000 ?
  valueCents: int 1..1000000000 ?
  signedAt: time ?
  signedBy: principal ?
  collectBy: time ?
  collectedAt: time ?
  feeCents: int 0..2500 default 0
  immutable owner, intakeAt
  read <- .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'senior']
  read (ownerName, address) <- .owner = viewer or exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'senior']
  read (report, valueCents) <- .owner = viewer or exists roles[viewer, role = 'senior']
  insert <- exists roles[viewer, role = 'intake']
  update <- exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'senior']
  online only


shape pieceCard = { *, held: .collectedAt = null and .collectBy != null and now >= .collectBy, holdingFeeCents: 2500 if .collectedAt = null and .collectBy != null and now >= .collectBy else .feeCents }

query listPieces(c: cursor ?):
  require exists roles[viewer] else NO_ROLE
  if exists roles[viewer, role = 'owner']:
    return pieces where .owner = viewer last 50 by .intakeAt after c pieceCard
  return pieces last 50 by .intakeAt after c pieceCard

query piece(piece: pieces):
  require exists roles[viewer] else NO_ROLE
  return pieces[piece] pieceCard

mutation createPiece(owner: principal, title: text 1..120, ownerName: text 1..100, address: text 5..400, photos: [image <=5000000] 1..6, weightMg: int 1..1000000, markings: text 1..500):
  require exists roles[viewer, role = 'intake'] else NOT_INTAKE
  require exists roles[owner, role = 'owner'] else NOT_OWNER
  return insert pieces { owner, title, ownerName, address, photos, weightMg, markings }

mutation updateIntake(piece: pieces, photos: [image <=5000000] 1..6, weightMg: int 1..1000000, markings: text 1..500):
  require exists roles[viewer, role = 'intake'] else NOT_INTAKE
  p = pieces[piece] ! else NOT_FOUND
  require p.signedAt = null and p.collectedAt = null else REPORT_LOCKED
  update pieces[piece] { photos, weightMg, markings }

mutation recordTests(piece: pieces, tests: text 1..2000):
  require exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'senior'] else NOT_APPRAISER
  p = pieces[piece] ! else NOT_FOUND
  require p.signedAt = null and p.collectedAt = null else REPORT_LOCKED
  update pieces[piece] { tests }

mutation movePiece(piece: pieces, location: enum('vault', 'bench-a', 'bench-b')):
  require exists roles[viewer, role = 'intake'] or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'senior'] else NOT_STAFF
  p = pieces[piece] ! else NOT_FOUND
  require p.collectedAt = null else ALREADY_COLLECTED
  update pieces[piece] { location }

mutation signReport(piece: pieces, report: text 10..4000, valueCents: int 1..1000000000):
  require exists roles[viewer, role = 'senior'] else NOT_SENIOR
  p = pieces[piece] ! else NOT_FOUND
  require p.signedAt = null and p.collectedAt = null else REPORT_LOCKED
  require p.tests != '' else TESTS_REQUIRED
  update pieces[piece] { report, valueCents, signedAt: now, signedBy: viewer, collectBy: now + 30d }

mutation collectPiece(piece: pieces, settleHold: bool):
  require exists roles[viewer, role = 'intake'] else NOT_INTAKE
  p = pieces[piece] ! else NOT_FOUND
  require p.signedAt != null and p.collectBy != null else REPORT_REQUIRED
  require p.collectedAt = null else ALREADY_COLLECTED
  require now < p.collectBy or settleHold else HOLD_FEE_REQUIRED 'Settle the $25 holding fee before releasing an overdue piece.'
  update pieces[piece] { collectedAt: now, feeCents: 2500 if now >= p.collectBy else 0 }

invariant pieces.ownerName read only .owner = viewer or exists roles[viewer, role = 'senior']
invariant pieces.address read only .owner = viewer or exists roles[viewer, role = 'senior']
