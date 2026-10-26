use identity password

-- Roles are assigned by the local store operator, never by signup.
table roles:
  principal: principal
  role: enum('customer', 'driver', 'dispatcher', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

fn office(): exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']
fn staff(): office() or exists roles[viewer, role = 'driver']

mutation provision(principal: principal, role: enum('customer', 'driver', 'dispatcher', 'manager')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }
query myRole():
  return roles[viewer]
query drivers(c: cursor ?):
  require office() else NOT_OFFICE
  return roles where .role = 'driver' first 100 by .id after c

table accounts:
  owner: principal
  name: text 1..80
  address: text 5..240
  automatic: bool
  lastFilledAt: time default now
  unique owner
  immutable owner, automatic
  read <- .owner = viewer or ((exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']) or exists roles[viewer, role = 'driver'])
  insert <- .owner = viewer and exists roles[viewer, role = 'customer']
  update <- .owner = viewer or (exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager'])
  online only

table deliveries:
  account: accounts
  owner: principal
  label: text 1..100
  driver: principal ?
  scheduledFor: time
  automatic: bool
  state: enum('scheduled', 'en_route', 'filled', 'invoiced') default 'scheduled'
  photo: image <=5000000 ?
  priceCents: int 1..1000000 ?
  gallons: int 1..2000 ?
  filledAt: time ?
  paid: bool default false
  emergency: bool default false
  at: time default now
  immutable account, owner, automatic, at
  read <- .owner = viewer or ((exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']) or exists roles[viewer, role = 'driver'])
  insert <- (exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']) or (.owner = viewer and exists roles[viewer, role = 'customer'])
  update <- (exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']) or (.driver = viewer and exists roles[viewer, role = 'driver'])
  online only

table invoices:
  delivery: deliveries
  account: accounts
  owner: principal
  amountCents: int 1..1000000
  deliveredAt: time
  issuedAt: time default now
  paid: bool default false
  paidAt: time ?
  unique delivery
  immutable delivery, account, owner, amountCents, deliveredAt, issuedAt
  read <- .owner = viewer or (exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager'])
  insert <- (exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager'])
  update <- (exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager'])
  online only

table approvals:
  delivery: deliveries
  account: accounts
  manager: principal
  reason: text 10..500
  approvedAt: time default now
  unique delivery
  immutable delivery, account, manager, reason, approvedAt
  read <- (exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager'])
  insert <- exists roles[viewer, role = 'manager'] and .manager = viewer
  online only

-- Credit ages from filling, including a delivery which has not been invoiced yet.
fn pastDue(account: accounts):
  if staff():
    return exists deliveries where .account = account and .filledAt != null and .filledAt < now - 30d and not .paid
  return exists deliveries where .owner = viewer and .account = account and .filledAt != null and .filledAt < now - 30d and not .paid
fn active(account: accounts):
  return exists deliveries where .account = account and (.state = 'scheduled' or .state = 'en_route')

query accountList(c: cursor ?):
  if not staff():
    return accounts where .owner = viewer first 100 by .id after c { *, dueAt: .lastFilledAt + 21d, blocked: pastDue(.id), overdue: .automatic and .lastFilledAt + 21d < now }
  return accounts first 100 by .id after c { *, dueAt: .lastFilledAt + 21d, blocked: pastDue(.id), overdue: .automatic and .lastFilledAt + 21d < now }
query accountDetail(account: accounts):
  a = accounts[account] ! else NOT_FOUND
  return a { *, dueAt: .lastFilledAt + 21d, blocked: pastDue(.id) }
query routeBoard(c: cursor ?):
  if not staff():
    return deliveries where .owner = viewer last 100 by .at after c { *, customer: accounts[.account].name, address: accounts[.account].address, blocked: pastDue(.account), late: .automatic and (accounts[.account].lastFilledAt ?? now) + 21d < now }
  return deliveries last 100 by .at after c { *, customer: accounts[.account].name, address: accounts[.account].address, blocked: pastDue(.account), late: .automatic and (accounts[.account].lastFilledAt ?? now) + 21d < now }
query deliveryDetail(delivery: deliveries):
  return deliveries[delivery]
query invoiceList(c: cursor ?):
  require office() or exists roles[viewer, role = 'customer'] else NOT_BILLING
  if not office():
    return invoices where .owner = viewer last 100 by .issuedAt after c { *, pastDue: not .paid and .deliveredAt < now - 30d }
  return invoices last 100 by .issuedAt after c { *, pastDue: not .paid and .deliveredAt < now - 30d }
query invoiceDetail(invoice: invoices):
  return invoices[invoice]
query approvalList(c: cursor ?):
  require office() else NOT_OFFICE
  return approvals last 100 by .approvedAt after c

mutation enroll(name: text 1..80, address: text 5..240, automatic: bool):
  require exists roles[viewer, role = 'customer'] else NOT_CUSTOMER
  previous = accounts[owner = viewer]
  if previous != null:
    require previous.automatic = automatic else PLAN_LOCKED
    return update accounts[previous.id] { name, address }
  a = insert accounts { owner: viewer, name, address, automatic }
  if automatic:
    insert deliveries { account: a.id, owner: viewer, label: 'Automatic refill', scheduledFor: now + 21d, automatic: true }
  return a

mutation scheduleDelivery(account: accounts, label: text 1..100, driver: principal, scheduledFor: time):
  require office() else NOT_OFFICE
  a = accounts[account] ! else NOT_FOUND
  require exists roles[driver, role = 'driver'] else NOT_DRIVER
  require scheduledFor >= now - 1m else IN_THE_PAST
  require not a.automatic or scheduledFor <= max(now, a.lastFilledAt + 21d) else REFILL_DEADLINE
  require not pastDue(account) else PAST_DUE
  require not active(account) else ALREADY_SCHEDULED
  return insert deliveries { account, owner: a.owner, label, driver, scheduledFor, automatic: a.automatic }

mutation assignDelivery(delivery: deliveries, driver: principal, scheduledFor: time):
  require office() else NOT_OFFICE
  d = deliveries[delivery] ! else NOT_FOUND
  a = accounts[d.account] ! else NOT_FOUND
  require d.state = 'scheduled' else BAD_STATE
  require exists roles[driver, role = 'driver'] else NOT_DRIVER
  require scheduledFor >= now - 1m else IN_THE_PAST
  require not d.automatic or scheduledFor <= max(now, a.lastFilledAt + 21d) else REFILL_DEADLINE
  require not pastDue(d.account) or d.emergency else PAST_DUE
  return update deliveries[delivery] { driver, scheduledFor }

mutation approveEmergency(account: accounts, label: text 1..100, driver: principal, reason: text 10..500):
  require exists roles[viewer, role = 'manager'] else NOT_MANAGER
  require len(trim(reason)) >= 10 else REASON_REQUIRED
  a = accounts[account] ! else NOT_FOUND
  require exists roles[driver, role = 'driver'] else NOT_DRIVER
  require pastDue(account) else NOT_PAST_DUE
  require not exists deliveries where .account = account and .state = 'en_route' else ALREADY_EN_ROUTE
  d = first(deliveries where .account = account and .state = 'scheduled' first 1 by .id)
  if d != null:
    require not d.emergency else ALREADY_APPROVED
    insert approvals { delivery: d.id, account, manager: viewer, reason }
    return update deliveries[d.id] { emergency: true, driver, scheduledFor: now, label }
  e = insert deliveries { account, owner: a.owner, label, driver, scheduledFor: now, automatic: a.automatic, emergency: true }
  insert approvals { delivery: e.id, account, manager: viewer, reason }
  return e

mutation startDelivery(delivery: deliveries):
  require exists roles[viewer, role = 'driver'] else NOT_DRIVER
  d = deliveries[delivery] ! else NOT_FOUND
  require d.driver = viewer else NOT_ASSIGNED
  require d.state = 'scheduled' else BAD_STATE
  require d.scheduledFor <= now else NOT_DUE
  require not pastDue(d.account) or d.emergency else PAST_DUE
  return update deliveries[delivery] { state: 'en_route' }

mutation recordFill(delivery: deliveries, photo: image <=5000000, priceCents: int 1..1000000, gallons: int 1..2000, deliveredAt: time ?):
  require office() else NOT_OFFICE
  d = deliveries[delivery] ! else NOT_FOUND
  require d.state = 'en_route' else BAD_STATE
  require not pastDue(d.account) or d.emergency else PAST_DUE
  actual = deliveredAt ?? now
  require actual <= now else FUTURE_FILL
  require actual >= now - 365d else FILL_TOO_OLD
  update deliveries[delivery] { state: 'filled', photo, priceCents, gallons, filledAt: actual }
  update accounts[d.account] { lastFilledAt: actual }
  if d.automatic:
    insert deliveries { account: d.account, owner: d.owner, label: 'Automatic refill', scheduledFor: actual + 21d, automatic: true }
  return deliveries[delivery]

mutation issueInvoice(delivery: deliveries):
  require office() else NOT_OFFICE
  d = deliveries[delivery] ! else NOT_FOUND
  require d.state = 'filled' else BAD_STATE
  require d.priceCents != null and d.filledAt != null else MISSING_FILL
  i = insert invoices { delivery, account: d.account, owner: d.owner, amountCents: d.priceCents, deliveredAt: d.filledAt }
  update deliveries[delivery] { state: 'invoiced' }
  return i

mutation recordPayment(invoice: invoices):
  require office() else NOT_OFFICE
  i = invoices[invoice] ! else NOT_FOUND
  require not i.paid else ALREADY_PAID
  update deliveries[i.delivery] { paid: true }
  return update invoices[invoice] { paid: true, paidAt: now }

invariant accounts.read only .owner = viewer or ((exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']) or exists roles[viewer, role = 'driver'])
invariant deliveries.read only .owner = viewer or ((exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager']) or exists roles[viewer, role = 'driver'])
invariant invoices.read only .owner = viewer or (exists roles[viewer, role = 'dispatcher'] or exists roles[viewer, role = 'manager'])
invariant approvals.insert only exists roles[viewer, role = 'manager']
invariant roles.insert only viewer = 'service:operator'
