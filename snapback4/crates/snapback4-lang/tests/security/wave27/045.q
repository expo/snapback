-- Storm Shelter Installs backend (Snapback 4 / Quarry).
--
-- Roles: homeowner, estimator, crew, operations_manager. The estimator opens
-- each install with site/soil photos plus the quoted price. The homeowner must
-- accept within 30 days or the quote lapses. The homeowner has five years
-- after completion to claim warranty work for a leak. Homeowners see only
-- their own installs/claims; crews see the live job board; only the
-- operations manager approves warranty work for damage outside the shelter,
-- recording the reason and the crew lead's assessment.
use identity password

table roles:
  principal: principal
  role: enum('homeowner', 'estimator', 'crew', 'operations_manager')
  label: text 1..80
  unique principal
  immutable principal
  -- Staff can see who is who (estimators open installs for homeowners, crews
  -- assess claims); homeowners read only their own row. Rule probes inspect
  -- the caller's own roster row, which is always readable to them.
  read <- .principal = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'operations_manager'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

table installs:
  homeowner: principal
  estimator: principal
  address: text 1..200
  shelterType: enum('underground', 'garage')
  sitePhoto: text 1..500 format url
  soilTest: text 1..500 format url
  priceCents: int 1..100000000
  quoteCategory: enum('under 10,000', '10,000 and above')
  status: enum('quoted', 'accepted', 'lapsed', 'excavation', 'placing', 'anchoring', 'backfill', 'completed') default 'quoted'
  quotedAt: time default now
  quoteExpiresAt: time
  completedAt: time ?
  immutable homeowner, estimator, quotedAt, quoteExpiresAt
  read <- .homeowner = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'operations_manager']
  insert <- exists roles[principal = viewer, role = 'estimator']
  update (old, next) <- (old.quoteCategory = next.quoteCategory and (old.homeowner = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'operations_manager'])) or exists roles[principal = viewer, role = 'operations_manager']
  delete <- deny
  online only

-- Historical quote categories: installs written before v2 named no category.
-- The category follows the quoted price: below 10,000 in quote currency
-- (priceCents holds integer minor units, so below 1000000) is 'under 10,000'.
backfill installs quoteCategories(priceCents: int): {quoteCategory: 'under 10,000' if priceCents < 1000000 else '10,000 and above'}

-- Spec: the estimator sets the category at open (computed from the quoted
-- price); after that only the operations manager may change it. Creation by
-- the estimator is deliberate, so this states update-only intent.
invariant installs.quoteCategory update only exists roles[principal = viewer, role = 'operations_manager']

table claims:
  install: installs on delete restrict
  homeowner: principal
  location: enum('inside', 'outside')
  description: text 1..1000
  status: enum('pending', 'assessed', 'approved', 'rejected') default 'pending'
  crewAssessment: text <=1000 ?
  decisionReason: text <=1000 ?
  decidedBy: principal ?
  createdAt: time default now
  immutable install, homeowner, location, createdAt
  read <- .homeowner = viewer or exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'operations_manager']
  insert <- .homeowner = viewer
  update <- exists roles[principal = viewer, role = 'estimator'] or exists roles[principal = viewer, role = 'crew'] or exists roles[principal = viewer, role = 'operations_manager']
  delete <- deny
  online only

-- Quotes past their 30-day deadline are swept to lapsed. Mutations also
-- enforce the deadline directly, so the sweep is cleanup, not the guard.
job lapseQuotes(periodStart: time, periodEnd: time):
  for i in installs where .quoteExpiresAt < periodEnd by .id:
    if i.status = 'quoted':
      update installs[i.id] { status: 'lapsed' }

schedule lapser every 1h: lapseQuotes

mutation provision(principal: principal, role: enum('homeowner', 'estimator', 'crew', 'operations_manager'), label: text 1..80):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, label }

query myRole():
  return roles[viewer]

query rosterByRole(role: enum('homeowner', 'estimator', 'crew', 'operations_manager'), c: cursor ?):
  me = roles[viewer] ! else NOT_ENROLLED
  require me.role = 'estimator' or me.role = 'operations_manager' else NOT_STAFF
  return roles where .role = role first 50 by .principal after c

query myInstalls(c: cursor ?):
  return installs where .homeowner = viewer first 50 by .id after c

query installDetail(install: installs):
  i = installs[install] ! else NOT_FOUND
  return i

query jobBoard(c: cursor ?):
  me = roles[viewer] ! else NOT_ENROLLED
  require me.role = 'crew' or me.role = 'estimator' or me.role = 'operations_manager' else NOT_CREW
  return installs where .status = 'accepted' or .status = 'excavation' or .status = 'placing' or .status = 'anchoring' or .status = 'backfill' first 50 by .id after c

query allInstalls(c: cursor ?):
  me = roles[viewer] ! else NOT_ENROLLED
  require me.role = 'estimator' or me.role = 'operations_manager' else NOT_STAFF
  return installs first 50 by .id after c

query myClaims(c: cursor ?):
  return claims where .homeowner = viewer first 50 by .id after c

query claimsQueue(c: cursor ?):
  me = roles[viewer] ! else NOT_ENROLLED
  require me.role = 'crew' or me.role = 'estimator' or me.role = 'operations_manager' else NOT_STAFF
  return claims first 50 by .id after c

query installClaims(install: installs, c: cursor ?):
  i = installs[install] ! else NOT_FOUND
  return claims where .install = install first 50 by .id after c

mutation openInstall(homeowner: principal, address: text 1..200, shelterType: enum('underground', 'garage'), sitePhoto: text 1..500 format url, soilTest: text 1..500 format url, priceCents: int 1..100000000):
  me = roles[viewer] ! else NOT_ENROLLED
  require me.role = 'estimator' else NOT_ESTIMATOR
  return insert installs { homeowner, estimator: viewer, address, shelterType, sitePhoto, soilTest, priceCents, quoteCategory: 'under 10,000' if priceCents < 1000000 else '10,000 and above', status: 'quoted', quotedAt: now, quoteExpiresAt: now + 30d }

mutation recategorizeQuote(install: installs, quoteCategory: enum('under 10,000', '10,000 and above')):
  me = roles[viewer] ! else NOT_ENROLLED
  require me.role = 'operations_manager' else ONLY_OPS_MANAGER
  i = installs[install] ! else NOT_FOUND
  update installs[install] { quoteCategory }
  return installs[install]

mutation acceptQuote(install: installs):
  i = installs[install] ! else NOT_FOUND
  require i.homeowner = viewer else NOT_YOUR_INSTALL
  require i.status = 'quoted' else BAD_STATUS
  require now <= i.quoteExpiresAt else QUOTE_LAPSED
  update installs[install] { status: 'accepted' }
  return installs[install]

mutation advanceStage(install: installs):
  me = roles[viewer] ! else NOT_ENROLLED
  require me.role = 'crew' or me.role = 'operations_manager' else NOT_CREW
  i = installs[install] ! else NOT_FOUND
  require i.status = 'accepted' or i.status = 'excavation' or i.status = 'placing' or i.status = 'anchoring' or i.status = 'backfill' else BAD_STATUS
  next = 'excavation' if i.status = 'accepted' else 'placing' if i.status = 'excavation' else 'anchoring' if i.status = 'placing' else 'backfill' if i.status = 'anchoring' else 'completed'
  update installs[install] { status: next, completedAt: now if next = 'completed' else i.completedAt }
  return installs[install]

mutation fileClaim(install: installs, location: enum('inside', 'outside'), description: text 1..1000):
  i = installs[install] ! else NOT_FOUND
  require i.homeowner = viewer else NOT_YOUR_INSTALL
  require i.status = 'completed' else NOT_COMPLETED
  done = i.completedAt ?? 0
  require done != 0 else NOT_COMPLETED
  require now <= done + 1825d else WARRANTY_EXPIRED
  return insert claims { install, homeowner: viewer, location, description, status: 'pending' }

mutation assessClaim(claim: claims, assessment: text 1..1000):
  me = roles[viewer] ! else NOT_ENROLLED
  require me.role = 'crew' or me.role = 'operations_manager' else NOT_CREW
  cl = claims[claim] ! else NOT_FOUND
  require cl.status = 'pending' or cl.status = 'assessed' else BAD_STATUS
  update claims[claim] { crewAssessment: assessment, status: 'assessed' }
  return claims[claim]

mutation decideClaim(claim: claims, decision: enum('approved', 'rejected'), reason: text 1..500, crewLeadAssessment: text <=1000 ?):
  me = roles[viewer] ! else NOT_ENROLLED
  cl = claims[claim] ! else NOT_FOUND
  require cl.status = 'pending' or cl.status = 'assessed' else BAD_STATUS
  require cl.location != 'outside' or me.role = 'operations_manager' else ONLY_OPS_MANAGER
  require cl.location = 'outside' or me.role = 'estimator' or me.role = 'operations_manager' else NOT_PERMITTED
  assessment = crewLeadAssessment ?? cl.crewAssessment ?? ''
  require cl.location != 'outside' or assessment != '' else NEED_ASSESSMENT
  update claims[claim] { status: decision, decisionReason: reason, decidedBy: viewer, crewAssessment: assessment if cl.location = 'outside' else cl.crewAssessment }
  return claims[claim]
