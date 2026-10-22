use identity password

-- Role roster: one row per user. Only the local operator seat can assign
-- roles; signup alone grants nothing.
table roles:
  principal: principal
  role: enum('artist', 'reviewer', 'owner', 'director')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- deny
  online only

mutation provision(principal: principal, role: enum('artist', 'reviewer', 'owner', 'director')):
  require viewer = 'service:operator' else NOT_OPERATOR
  upsert roles[principal] { principal, role }
  return null

query myRole():
  return roles[principal = viewer]

-- One artist application for one wall. Lifecycle:
-- submitted -> scored -> awarded -> painted -> paid,
-- plus cancelled (director) and expired (owner signoff missed).
table applications:
  artist: principal
  title: text 3..80
  description: text 1..2000 ?
  wallAddress: text 5..200
  sketch: image <=5000000
  amount: int 100..50000
  status: enum('submitted', 'scored', 'awarded', 'painted', 'paid', 'cancelled', 'expired') default 'submitted'
  score: int 0..100 ?
  scoredBy: principal ?
  awardedAt: time ?
  signoffBy: principal ?
  signoffAt: time ?
  finishedPhoto: image <=5000000 ?
  finishedAt: time ?
  cancelReason: text 5..500 ?
  createdAt: time default now
  immutable artist, sketch, createdAt
  read <- .artist = viewer or exists roles[viewer, role = 'reviewer'] or exists roles[viewer, role = 'director'] or (exists roles[viewer, role = 'owner'] and (.status = 'awarded' or .status = 'painted' or .status = 'paid' or .status = 'expired' or .status = 'cancelled'))
  insert <- .artist = viewer and exists roles[viewer, role = 'artist']
  update <- .artist = viewer or exists roles[viewer, role = 'reviewer'] or exists roles[viewer, role = 'director'] or exists roles[viewer, role = 'owner']
  delete <- deny
  cap 200 by artist
  online only

-- Final grant payments, written only by the director's release mutation.
table payments:
  application: applications on delete restrict
  artist: principal
  amount: int 100..50000
  releasedBy: principal
  releasedAt: time
  unique application
  immutable application, artist, amount, releasedBy, releasedAt
  read <- .artist = viewer or exists roles[viewer, role = 'director']
  insert <- exists roles[viewer, role = 'director']
  update <- deny
  delete <- deny
  online only

-- Artist's own applications.
query myApplications(c: cursor ?):
  return applications where .artist = viewer last 50 by .createdAt after c

-- Reviewer/director live board: every application.
query board(c: cursor ?):
  require exists roles[viewer, role = 'reviewer'] or exists roles[viewer, role = 'director'] else NOT_BOARD
  return applications last 50 by .createdAt after c

-- Building-owner queue: awards waiting for (or holding) signoff and outcomes.
query ownerQueue(c: cursor ?):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  return applications where .status = 'awarded' or .status = 'painted' or .status = 'paid' or .status = 'expired' or .status = 'cancelled' last 50 by .createdAt after c

query applicationDetail(id: applications):
  return applications[id]

-- Artist's own payments.
query myPayments(c: cursor ?):
  return payments where .artist = viewer last 50 by .releasedAt after c

-- Director's payment ledger.
query paymentLedger(c: cursor ?):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  return payments last 50 by .releasedAt after c

mutation submitApplication(title: text 3..80, description: text 1..2000 ?, wallAddress: text 5..200, sketch: image <=5000000, amount: int 100..50000):
  require exists roles[viewer, role = 'artist'] else NOT_ARTIST
  return insert applications { artist: viewer, title, description, wallAddress, sketch, amount }

mutation scoreApplication(id: applications, score: int 0..100):
  require exists roles[viewer, role = 'reviewer'] else NOT_REVIEWER
  a = applications[id] ! else NOT_FOUND
  require a.status = 'submitted' or a.status = 'scored' else NOT_SCORABLE
  update applications[id] { score, scoredBy: viewer, status: 'scored' }
  return null

mutation awardApplication(id: applications):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  a = applications[id] ! else NOT_FOUND
  require a.status = 'scored' else NOT_AWARDABLE
  update applications[id] { awardedAt: now, status: 'awarded' }
  return null

mutation ownerSignoff(id: applications):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  a = applications[id] ! else NOT_FOUND
  require a.status = 'awarded' else NOT_AWARD
  require a.awardedAt != null else NOT_AWARDED
  require now <= a.awardedAt + 21d else SIGNOFF_EXPIRED 'The 21-day owner signoff window has passed.'
  update applications[id] { signoffBy: viewer, signoffAt: now }
  return null

mutation uploadFinished(id: applications, photo: image <=5000000):
  a = applications[id] ! else NOT_FOUND
  require a.artist = viewer else NOT_ARTIST_OWNER
  require a.status = 'awarded' else NOT_AWARDED_PAINT
  require a.signoffAt != null else NEEDS_SIGNOFF 'The building owner must sign off first.'
  require a.awardedAt != null else NOT_AWARDED
  require now <= a.awardedAt + 120d else PAINT_OVERDUE 'The 120-day painting window has passed.'
  update applications[id] { finishedPhoto: photo, finishedAt: now, status: 'painted' }
  return null

mutation releasePayment(id: applications):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  a = applications[id] ! else NOT_FOUND
  require a.status = 'painted' else NOT_PAINTED
  require not exists payments[application = a.id] else ALREADY_PAID
  insert payments { application: a.id, artist: a.artist, amount: a.amount, releasedBy: viewer, releasedAt: now }
  update applications[id] { status: 'paid' }
  return null

mutation cancelAward(id: applications, reason: text 5..500):
  require exists roles[viewer, role = 'director'] else NOT_DIRECTOR
  a = applications[id] ! else NOT_FOUND
  require a.status = 'awarded' or a.status = 'scored' else NOT_CANCELLABLE
  update applications[id] { status: 'cancelled', cancelReason: reason }
  return null

-- Sweeps awards whose 21-day owner signoff window passed without signoff.
-- Mutations enforce the same deadline exactly, so this only labels old rows.
job expireUnsigned(periodStart: time, periodEnd: time):
  for a in applications by .id:
    if a.status = 'awarded' and a.signoffAt = null and a.awardedAt != null and a.awardedAt + 21d < now:
      update applications[a.id] { status: 'expired' }

schedule expireSweep every 1h: expireUnsigned

-- Spec intent, stated independently of the rules above.
invariant applications.read only .artist = viewer or exists roles[viewer, role = 'reviewer'] or exists roles[viewer, role = 'director']
