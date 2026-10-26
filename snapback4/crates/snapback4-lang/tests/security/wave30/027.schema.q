-- Museum Diorama Builds.
-- Roles: general_manager, account_manager, modeler, museum.
-- Password accounts; roles are provisioned by the local operator seat only.
use identity password

table roles:
  principal: principal
  role: enum('general_manager', 'account_manager', 'modeler', 'museum')
  museum: museums ?
  unique principal
  immutable principal, role
  read <- .principal = viewer or exists roles[principal = viewer, role = 'general_manager'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- deny
  delete <- deny
  online only

table museums:
  name: text 1..120
  contactName: text 1..120 ?
  contactEmail: text 3..200 ?
  contactPhone: text 1..40 ?
  unique name
  read <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'museum', museum = .id] or viewer = 'service:operator'
  insert <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or viewer = 'service:operator'
  update <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
  delete <- deny
  online only

table builds:
  museum: museums
  museumName: text 1..120
  title: text 1..120
  drawing: file <=10000000
  figures: text <=2000 ?
  backdrops: text <=2000 ?
  status: enum('framing', 'sculpting', 'painting', 'crated') default 'framing'
  exhibitOpening: time
  immutable museum
  read <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'modeler'] or exists roles[principal = viewer, role = 'museum', museum = .museum]
  insert <- exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'general_manager']
  update <- exists roles[principal = viewer, role = 'modeler'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'general_manager']
  delete <- deny
  online only

table buildPricing:
  build: builds
  price: money USD
  budget: money USD ?
  unique build
  read <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
  insert <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
  update <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
  delete <- deny
  online only

table priceChanges:
  build: builds
  oldPrice: money USD
  newPrice: money USD
  reason: text 1..500
  changedBy: principal
  at: time default now
  read <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
  insert <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
  update <- deny
  delete <- deny
  online only

table proofs:
  build: builds
  museum: museums
  image: image <=10000000 ?
  note: text <=1000 ?
  at: time default now
  immutable build, museum
  read <- exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'modeler'] or exists roles[principal = viewer, role = 'museum', museum = .museum]
  insert <- (exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'modeler']) and exists builds[.build, museum = .museum]
  update <- deny
  delete <- deny
  online only

-- Privacy intent from the spec: only account managers and general managers
-- may read pricing, budgets and museum contacts; museums see only their own
-- rows; modelers never see pricing or contacts.
invariant buildPricing.read only exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
invariant buildPricing.price read only exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
invariant buildPricing.budget read only exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
invariant priceChanges.read only exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager']
invariant museums.read only exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'museum', museum = .id] or viewer = 'service:operator'
invariant builds.read only exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'modeler'] or exists roles[principal = viewer, role = 'museum', museum = .museum]
invariant proofs.read only exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'modeler'] or exists roles[principal = viewer, role = 'museum', museum = .museum]

mutation provision(principal: principal, role: enum('general_manager', 'account_manager', 'modeler', 'museum'), museumName: text 1..120 ?):
  require viewer = 'service:operator' else NOT_OPERATOR
  if role = 'museum':
    require museumName != null else NEED_MUSEUM
    m = (upsert museums[name = museumName] { name: museumName }) ! else NOT_FOUND
    return upsert roles[principal] { principal, role, museum: m.id }
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query allMuseums(c: cursor ?):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] else NOT_MANAGER
  return museums last 50 by .id after c

query myMuseum():
  r = roles[principal = viewer] ! else NO_ROLE
  require r.museum != null else NO_MUSEUM
  return museums[r.museum]

-- The live workshop board: staff see every build, museums only their own.
query board(c: cursor ?):
  require exists roles[principal = viewer] else NO_ROLE
  if exists roles[principal = viewer, role = 'museum']:
    r = roles[principal = viewer]
    return builds where .museum = r.museum last 50 by .id after c
  return builds last 50 by .id after c

query buildDetail(build: builds):
  return builds[build]

query priceFor(build: builds):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] else NOT_MANAGER
  return buildPricing[build = build]

query priceHistoryFor(build: builds, c: cursor ?):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] else NOT_MANAGER
  return priceChanges where .build = build last 20 by .at after c

query proofsFor(build: builds, c: cursor ?):
  b = builds[build] ! else NOT_FOUND
  return proofs where .build = build last 20 by .at after c

mutation createMuseum(name: text 1..120, contactName: text 1..120 ?, contactEmail: text 3..200 ?, contactPhone: text 1..40 ?):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] else NOT_MANAGER
  return insert museums { name, contactName, contactEmail, contactPhone }

mutation updateMuseum(museum: museums, contactName: text 1..120 ?, contactEmail: text 3..200 ?, contactPhone: text 1..40 ?):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] else NOT_MANAGER
  m = museums[museum] ! else NOT_FOUND
  update museums[museum] { contactName, contactEmail, contactPhone }
  return null

-- The account manager opens each build with the approved drawing and price.
mutation openBuild(museum: museums, title: text 1..120, drawing: file <=10000000, figures: text <=2000 ?, backdrops: text <=2000 ?, price: money USD, budget: money USD ?, exhibitOpening: time):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] else NOT_MANAGER
  require price > 0 else BAD_PRICE 'The quoted price must be positive.'
  require exhibitOpening > now else BAD_OPENING 'The exhibit opening must be in the future.'
  m = museums[museum] ! else NOT_FOUND
  b = insert builds { museum, museumName: m.name, title, drawing, figures, backdrops, status: 'framing', exhibitOpening }
  insert buildPricing { build: b, price, budget }
  insert priceChanges { build: b, oldPrice: price, newPrice: price, reason: 'Opening quote.', changedBy: viewer, at: now }
  return b

mutation updateWorkshop(build: builds, figures: text <=2000 ?, backdrops: text <=2000 ?):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'modeler'] else NOT_WORKSHOP
  b = builds[build] ! else NOT_FOUND
  update builds[build] { figures, backdrops }
  return null

-- Dioramas move framing -> sculpting -> painting -> crated, and a diorama
-- must be crated at least three days before its exhibit opening.
mutation advanceBuild(build: builds):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'modeler'] else NOT_WORKSHOP
  b = builds[build] ! else NOT_FOUND
  require b.status != 'crated' else ALREADY_CRATED 'This diorama is already crated.'
  next = 'sculpting' if b.status = 'framing' else 'painting' if b.status = 'sculpting' else 'crated'
  if next = 'crated':
    require now + 3d <= b.exhibitOpening else CRATE_TOO_LATE 'A diorama must be crated at least three days before its exhibit opening.'
  update builds[build] { status: next }
  return next

-- Only the general manager may approve a price change over ten percent;
-- every change records its reason.
mutation updatePrice(build: builds, newPrice: money USD, reason: text 1..500):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] else NOT_MANAGER
  require newPrice > 0 else BAD_PRICE 'The price must be positive.'
  b = builds[build] ! else NOT_FOUND
  p = buildPricing[build = build] ! else NOT_FOUND
  oldPrice = p.price
  if newPrice != oldPrice:
    up = newPrice > oldPrice
    big = (newPrice - oldPrice) * 10 > oldPrice if up else (oldPrice - newPrice) * 10 > oldPrice
    require not big or exists roles[principal = viewer, role = 'general_manager'] else GM_APPROVAL_REQUIRED 'A price change over ten percent needs general manager approval.'
    update buildPricing[build = build] { price: newPrice }
    insert priceChanges { build: b, oldPrice, newPrice, reason, changedBy: viewer, at: now }
  return buildPricing[build = build]

mutation addProof(build: builds, image: image <=10000000 ?, note: text <=1000 ?):
  require exists roles[principal = viewer, role = 'general_manager'] or exists roles[principal = viewer, role = 'account_manager'] or exists roles[principal = viewer, role = 'modeler'] else NOT_WORKSHOP
  b = builds[build] ! else NOT_FOUND
  return insert proofs { build: b, museum: b.museum, image, note, at: now }
