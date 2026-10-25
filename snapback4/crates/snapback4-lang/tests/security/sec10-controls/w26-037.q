-- Bespoke Shoe Commissions.
-- Roles: customer, shoemaker, fitting_manager, master (master shoemaker).
-- A fitting room manager opens each pair with foot-tracing photos and the
-- quoted price. Shoemakers see tracings, last measurements, leather and
-- style, but never phone, deposit or price: only the fitting room manager
-- and the master shoemaker read those columns. Customers see only their own
-- pairs. Pairs move last_carving -> trial_shoe -> finished; the customer
-- must attend the trial fitting within 30 days of notice. Only the master
-- shoemaker may approve a free remake, with the reason recorded.
use identity password

table roles:
  principal: principal
  role: enum('customer', 'shoemaker', 'fitting_manager', 'master')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master']
  insert <- viewer = 'service:operator' or exists roles[viewer, role = 'master'] or (.principal = viewer and .role = 'customer')
  update <- viewer = 'service:operator' or exists roles[viewer, role = 'master']
  delete <- viewer = 'service:operator'
  online only

table pairs:
  customer: principal
  status: enum('last_carving', 'trial_shoe', 'finished') default 'last_carving'
  tracings: [image <=5000000] 1..4
  lastMeasures: text 1..500
  leather: text 1..100
  style: text 1..100
  phone: text 5..30
  deposit: money USD
  price: money USD
  trialNoticeAt: time ?
  trialAttendedAt: time ?
  remakeApproved: bool default false
  remakeReason: text 1..500 ?
  immutable customer
  cap 500 by customer
  read <- .customer = viewer or exists roles[viewer, role = 'shoemaker'] or exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master']
  insert <- exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master']
  update <- .customer = viewer or exists roles[viewer, role = 'shoemaker'] or exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master']
  online only

-- Public card: everything except phone, deposit and price.
shape pairCard = { id, customer, status, tracings, lastMeasures, leather, style, trialNoticeAt, trialAttendedAt, remakeApproved, remakeReason }

query myRole():
  return roles[viewer]

query boardFull(c: cursor ?):
  require exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master'] else NOT_PRIVILEGED
  return pairs last 50 by .id after c

query boardCraft(c: cursor ?):
  require exists roles[viewer, role = 'shoemaker'] else NOT_SHOEMAKER
  return pairs last 50 by .id after c pairCard

query myPairs(c: cursor ?):
  return pairs where .customer = viewer last 50 by .id after c pairCard

query pairPublic(pair: pairs):
  p = pairs[pair] ! else NOT_FOUND
  require p.customer = viewer or exists roles[viewer, role = 'shoemaker'] or exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master'] else NOT_FOUND
  return p pairCard

query pairPrivate(pair: pairs):
  require exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master'] else NOT_PRIVILEGED
  p = pairs[pair] ! else NOT_FOUND
  return p

mutation registerCustomer():
  require not exists roles[viewer] else HAS_ROLE
  return insert roles { principal: viewer, role: 'customer' }

mutation provision(principal: principal, role: enum('customer', 'shoemaker', 'fitting_manager', 'master')):
  require viewer = 'service:operator' or exists roles[viewer, role = 'master'] else NOT_AUTHORIZED
  return upsert roles[principal] { role }

mutation openPair(customer: principal, tracings: [image <=5000000] 1..4, lastMeasures: text 1..500, leather: text 1..100, style: text 1..100, phone: text 5..30, deposit: money USD, price: money USD):
  require exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master'] else NOT_PRIVILEGED
  require exists roles[customer, role = 'customer'] else NOT_CUSTOMER
  return insert pairs { customer, tracings, lastMeasures, leather, style, phone, deposit, price, status: 'last_carving' }

mutation updateCraft(pair: pairs, lastMeasures: text 1..500, leather: text 1..100, style: text 1..100):
  require exists roles[viewer, role = 'shoemaker'] or exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master'] else NOT_PRIVILEGED
  p = pairs[pair] ! else NOT_FOUND
  update p { lastMeasures, leather, style }
  return null

mutation updateCommercial(pair: pairs, phone: text 5..30, deposit: money USD, price: money USD):
  require exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master'] else NOT_PRIVILEGED
  p = pairs[pair] ! else NOT_FOUND
  update p { phone, deposit, price }
  return null

mutation advanceStatus(pair: pairs):
  require exists roles[viewer, role = 'shoemaker'] or exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master'] else NOT_PRIVILEGED
  p = pairs[pair] ! else NOT_FOUND
  require p.status != 'finished' else ALREADY_FINISHED
  if p.status = 'last_carving':
    update p { status: 'trial_shoe', trialNoticeAt: now }
  else:
    require p.trialAttendedAt != null else FITTING_PENDING
    update p { status: 'finished' }
  return null

mutation notifyTrial(pair: pairs):
  require exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master'] else NOT_PRIVILEGED
  p = pairs[pair] ! else NOT_FOUND
  require p.status = 'trial_shoe' else NOT_IN_TRIAL
  update p { trialNoticeAt: now }
  return null

mutation attendFitting(pair: pairs):
  p = pairs[pair] ! else NOT_FOUND
  require p.customer = viewer else NOT_YOURS
  require p.trialNoticeAt != null else NO_TRIAL_NOTICE
  require now <= p.trialNoticeAt + 30d else TRIAL_OVERDUE
  require p.trialAttendedAt = null else ALREADY_ATTENDED
  update p { trialAttendedAt: now }
  return null

mutation approveRemake(pair: pairs, reason: text 1..500):
  require exists roles[viewer, role = 'master'] else NOT_MASTER
  p = pairs[pair] ! else NOT_FOUND
  update p { remakeApproved: true, remakeReason: reason }
  return null

-- Privacy intent from the spec. Phone, deposit and price are readable only
-- by the fitting room manager and the master shoemaker, even though
-- shoemakers and customers may read the same pair's workshop fields.
invariant pairs.read only .customer = viewer or exists roles[viewer, role = 'shoemaker'] or exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master']
invariant pairs.phone read only exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master']
invariant pairs.deposit read only exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master']
invariant pairs.price read only exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master']
invariant pairs.insert only exists roles[viewer, role = 'fitting_manager'] or exists roles[viewer, role = 'master']
invariant pairs.approveRemake only exists roles[viewer, role = 'master']
invariant pairs.attendFitting only .customer = viewer
invariant roles.provision only viewer = 'service:operator' or exists roles[viewer, role = 'master']
