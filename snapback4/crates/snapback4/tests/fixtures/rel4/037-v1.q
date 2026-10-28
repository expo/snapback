use identity password

table roles:
  principal: principal
  role: enum('customer', 'bootmaker', 'manager', 'master')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('customer', 'bootmaker', 'manager', 'master')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query customers(c: cursor ?):
  require exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master'] else NOT_FITTING_STAFF
  return roles where .role = 'customer' last 100 by .id after c

table pairs:
  customer: principal
  phone: text 7..20 write <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
  deposit: money USD write <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
  price: money USD write <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
  measurements: text 1..500
  leather: text 1..120
  stitching: text 1..120
  status: enum('lasting', 'trial_fitting', 'finished') default 'lasting'
  trialNoticeAt: time ?
  trialAttendedAt: time ?
  remake: bool default false
  remakeReason: text 1..300 ?
  tracing: image <=5MB
  tracingAlt: image <=5MB ?
  createdAt: time default now
  immutable customer
  read <- .customer = viewer or exists roles[principal = viewer, role = 'bootmaker'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
  read (phone, deposit, price) <- .customer = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
  insert <- exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
  update <- exists roles[principal = viewer, role = 'bootmaker'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master'] or .customer = viewer
  cap 2000
  online only

query board(c: cursor ?):
  if exists roles[principal = viewer, role = 'bootmaker'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']:
    return pairs last 50 by .id after c
  return pairs where .customer = viewer last 50 by .id after c

query pairDetail(pair: pairs):
  return pairs[pair]

mutation openPair(customer: principal, phone: text 7..20, price: money USD, deposit: money USD, measurements: text 1..500, leather: text 1..120, stitching: text 1..120, tracing: image <=5MB, tracingAlt: image <=5MB ?):
  require exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master'] else NOT_FITTING_STAFF
  return insert pairs { customer, phone, price, deposit, measurements, leather, stitching, tracing, tracingAlt, status: 'lasting' }

mutation updateCraft(pair: pairs, measurements: text 1..500, leather: text 1..120, stitching: text 1..120):
  require exists roles[principal = viewer, role = 'bootmaker'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master'] else NOT_CRAFT_STAFF
  update pairs[pair] { measurements, leather, stitching }
  return null

mutation advanceToTrial(pair: pairs):
  require exists roles[principal = viewer, role = 'bootmaker'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master'] else NOT_CRAFT_STAFF
  p = pairs[pair] ! else NOT_FOUND
  require p.status = 'lasting' else BAD_STATUS
  update pairs[pair] { status: 'trial_fitting', trialNoticeAt: now }
  return null

mutation completePair(pair: pairs):
  require exists roles[principal = viewer, role = 'bootmaker'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master'] else NOT_CRAFT_STAFF
  p = pairs[pair] ! else NOT_FOUND
  require p.status = 'trial_fitting' else BAD_STATUS
  require p.trialAttendedAt != null else NO_TRIAL_VISIT
  update pairs[pair] { status: 'finished' }
  return null

mutation attendTrial(pair: pairs):
  p = pairs[pair] ! else NOT_FOUND
  require p.customer = viewer else NOT_YOUR_PAIR
  require p.status = 'trial_fitting' else BAD_STATUS
  notice = p.trialNoticeAt
  require notice != null else NO_NOTICE
  require now - notice <= 30d else TRIAL_OVERDUE
  update pairs[pair] { trialAttendedAt: now }
  return null

mutation renotify(pair: pairs):
  require exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master'] else NOT_FITTING_STAFF
  p = pairs[pair] ! else NOT_FOUND
  require p.status = 'trial_fitting' else BAD_STATUS
  update pairs[pair] { trialNoticeAt: now, trialAttendedAt: null }
  return null

mutation approveRemake(pair: pairs, reason: text 1..300):
  require exists roles[principal = viewer, role = 'master'] else NOT_MASTER
  require trim(reason) != '' else EMPTY_REASON
  p = pairs[pair] ! else NOT_FOUND
  update pairs[pair] { remake: true, remakeReason: reason }
  return null

-- A customer reads only their own pairs; staff read every pair they serve.
-- Target the row audience instead of copying the table read rule.
invariant pairs.read only .customer = viewer or exists roles[principal = viewer, role = 'bootmaker'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
-- Phone, deposit and price stay with the customer, the fitting room manager and the master bootmaker.
invariant pairs.phone read only .customer = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
invariant pairs.deposit read only .customer = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
invariant pairs.price read only .customer = viewer or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
-- Only the fitting room manager or master bootmaker opens a pair.
invariant pairs.insert only exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master']
-- Craft and status edits belong to shop staff; the trial visit belongs to the customer.
invariant pairs.update only exists roles[principal = viewer, role = 'bootmaker'] or exists roles[principal = viewer, role = 'manager'] or exists roles[principal = viewer, role = 'master'] or .customer = viewer
