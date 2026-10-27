use identity password

table roles:
  principal: principal
  role: enum('owner', 'foreman', 'metalsmith', 'master')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'metalsmith'] or exists roles[viewer, role = 'master']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'foreman', 'metalsmith', 'master')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query owners(c: cursor ?):
  require exists roles[viewer, role = 'foreman'] else NOT_FOREMAN
  return roles where .role = 'owner' last 100 by .id after c

table restorations:
  owner: principal
  openedBy: principal
  title: text 3..100
  damage: text 10..2000
  priceCents: int 100..10000000
  figure: image <=5000000
  arrow: image <=5000000
  gilding: image <=5000000
  openedAt: time
  quoteEndsAt: time
  stage: enum('quoted', 'stripping', 'dent work', 'soldering', 'gilding', 'ready', 'collected', 'returned')
  acceptedAt: time ?
  readyAt: time ?
  storageStartsAt: time ?
  collectedAt: time ?
  returnedAt: time ?
  immutable owner, openedBy, title, damage, priceCents, figure, arrow, gilding, openedAt, quoteEndsAt
  read <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'metalsmith'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'foreman'] and .openedBy = viewer
  update <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'metalsmith'] or exists roles[viewer, role = 'master']
  online only

query board(c: cursor ?):
  if exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'metalsmith'] or exists roles[viewer, role = 'master']:
    return restorations last 100 by .id after c
  return restorations where .owner = viewer last 100 by .id after c

query detail(restoration: restorations):
  r = restorations[restoration] ! else NOT_FOUND
  charge = 0
  if r.storageStartsAt != null:
    endAt = r.collectedAt ?? now
    if endAt > r.storageStartsAt:
      charge = ((endAt - r.storageStartsAt + 1d - 1) / 1d) * 500
  return { restoration: r, storageCents: charge, serverNow: now }

mutation openRestoration(owner: principal, title: text 3..100, damage: text 10..2000, priceCents: int 100..10000000, figure: image <=5000000, arrow: image <=5000000, gilding: image <=5000000):
  require exists roles[viewer, role = 'foreman'] else NOT_FOREMAN
  require exists roles[owner, role = 'owner'] else NOT_OWNER
  return insert restorations { owner, openedBy: viewer, title, damage, priceCents, figure, arrow, gilding, openedAt: now, quoteEndsAt: now + 30d, stage: 'quoted' }

mutation acceptQuote(restoration: restorations):
  r = restorations[restoration] ! else NOT_FOUND
  require r.owner = viewer else NOT_YOUR_QUOTE
  require r.stage = 'quoted' else WRONG_STAGE
  require now < r.quoteEndsAt else QUOTE_EXPIRED 'The 30-day acceptance window has closed.'
  update restorations[restoration] { stage: 'stripping', acceptedAt: now }
  return null

mutation advanceStage(restoration: restorations):
  require exists roles[viewer, role = 'metalsmith'] or exists roles[viewer, role = 'master'] else NOT_METALSMITH
  r = restorations[restoration] ! else NOT_FOUND
  require r.stage = 'stripping' or r.stage = 'dent work' or r.stage = 'soldering' else WRONG_STAGE
  nextStage = 'dent work' if r.stage = 'stripping' else 'soldering' if r.stage = 'dent work' else 'gilding'
  update restorations[restoration] { stage: nextStage }
  return null

mutation sendReady(restoration: restorations):
  require exists roles[viewer, role = 'foreman'] else NOT_FOREMAN
  r = restorations[restoration] ! else NOT_FOUND
  require r.stage = 'gilding' else WRONG_STAGE
  update restorations[restoration] { stage: 'ready', readyAt: now, storageStartsAt: now + 45d }
  return null

mutation collect(restoration: restorations):
  require exists roles[viewer, role = 'foreman'] else NOT_FOREMAN
  r = restorations[restoration] ! else NOT_FOUND
  require r.stage = 'ready' else WRONG_STAGE
  update restorations[restoration] { stage: 'collected', collectedAt: now }
  return null

table letterConsents:
  restoration: restorations
  owner: principal
  letter: enum('N', 'E', 'S', 'W')
  writtenConsent: text 20..2000
  consentAt: time
  approvedBy: principal ?
  approvedAt: time ?
  unique restoration, letter
  immutable restoration, owner, letter, writtenConsent, consentAt
  read <- .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'metalsmith'] or exists roles[viewer, role = 'master']
  insert <- .owner = viewer and exists restorations[.restoration, owner = viewer]
  update <- exists roles[viewer, role = 'master']
  online only

query consents(restoration: restorations, c: cursor ?):
  r = restorations[restoration] ! else NOT_FOUND
  return letterConsents where .restoration = restoration last 10 by .id after c

mutation recordConsent(restoration: restorations, letter: enum('N', 'E', 'S', 'W'), writtenConsent: text 20..2000):
  r = restorations[restoration] ! else NOT_FOUND
  require r.owner = viewer else NOT_YOUR_WEATHERVANE
  require r.stage = 'stripping' or r.stage = 'dent work' or r.stage = 'soldering' or r.stage = 'gilding' else WRONG_STAGE
  return insert letterConsents { restoration, owner: viewer, letter, writtenConsent, consentAt: now }

mutation approveLetter(consent: letterConsents):
  require exists roles[viewer, role = 'master'] else NOT_MASTER
  c = letterConsents[consent] ! else NOT_FOUND
  r = restorations[c.restoration] ! else NOT_FOUND
  require r.stage = 'stripping' or r.stage = 'dent work' or r.stage = 'soldering' or r.stage = 'gilding' else WRONG_STAGE
  require c.approvedAt = null else ALREADY_APPROVED
  update letterConsents[consent] { approvedBy: viewer, approvedAt: now }
  return null

job returnExpired():
  for r in restorations:
    if r.stage = 'quoted' and now >= r.quoteEndsAt:
      update restorations[r.id] { stage: 'returned', returnedAt: now }
schedule expireQuotes every 1m: returnExpired

invariant restorations.read only .owner = viewer or exists roles[viewer, role = 'foreman'] or exists roles[viewer, role = 'metalsmith'] or exists roles[viewer, role = 'master']
invariant letterConsents.approvedBy update only exists roles[viewer, role = 'master']
invariant roles.role write only viewer = 'service:operator'
invariant restorations always .figure != null and .arrow != null and .gilding != null
