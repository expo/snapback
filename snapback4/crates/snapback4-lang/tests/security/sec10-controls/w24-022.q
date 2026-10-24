use identity password

table roles:
  principal: principal
  role: enum('assistant', 'tailor', 'customer', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('assistant', 'tailor', 'customer', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query customers():
  require exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] else NOT_SHOP
  return roles where .role = 'customer' first 100 by .id

table hires:
  customer: principal
  customerName: text 1..80
  openedBy: principal
  card: image <=5000000
  waist: int 15..80
  seat: int 20..90
  length: int 10..50
  tartan: text 1..80
  notes: text <=2000
  phone: text 7..30
  price: int 100..1000000
  deposit: int 0..100000
  dueAt: time
  status: enum('measured', 'altered', 'packed', 'returned') default 'measured'
  lateFee: int 0..2500 default 0
  returnedAt: time ?
  depositKept: bool default false
  damageReason: text <=1000 default ''
  approvedBy: principal ?
  approvedAt: time ?
  createdAt: time default now
  immutable customer, openedBy, dueAt, createdAt
  read <- .customer = viewer or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'tailor'] or exists roles[viewer, role = 'owner']
  read (phone, price, deposit, lateFee, depositKept, damageReason, approvedBy, approvedAt) <- exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'assistant'] and .openedBy = viewer
  update <- exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'tailor'] or exists roles[viewer, role = 'owner']
  online only

invariant hires.read only .customer = viewer or exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'tailor'] or exists roles[viewer, role = 'owner']
invariant hires.phone read only exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
invariant hires.price read only exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
invariant hires.deposit read only exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner']
invariant hires.keepDeposit only exists roles[viewer, role = 'owner']
invariant roles.role write only viewer = 'service:operator'

query board():
  return hires last 100 by .id

query hire(hire: hires):
  return hires[hire]

mutation openHire(customer: principal, customerName: text 1..80, card: image <=5000000, waist: int 15..80, seat: int 20..90, length: int 10..50, tartan: text 1..80, notes: text <=2000, phone: text 7..30, price: int 100..1000000, deposit: int 0..100000, dueAt: time):
  require exists roles[viewer, role = 'assistant'] else NOT_ASSISTANT
  require exists roles[customer, role = 'customer'] else NOT_CUSTOMER
  require dueAt > now and dueAt <= now + 365d else BAD_DUE_DATE
  return insert hires { customer, customerName, openedBy: viewer, card, waist, seat, length, tartan, notes, phone, price, deposit, dueAt }

mutation alter(hire: hires, notes: text <=2000):
  require exists roles[viewer, role = 'tailor'] else NOT_TAILOR
  h = hires[hire] ! else NOT_FOUND
  require h.status = 'measured' else BAD_STAGE
  update hires[hire] { notes, status: 'altered' }

mutation pack(hire: hires):
  require exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] else NOT_SHOP
  h = hires[hire] ! else NOT_FOUND
  require h.status = 'altered' else BAD_STAGE
  update hires[hire] { status: 'packed' }

mutation returnHire(hire: hires):
  require exists roles[viewer, role = 'assistant'] or exists roles[viewer, role = 'owner'] else NOT_SHOP
  h = hires[hire] ! else NOT_FOUND
  require h.status = 'packed' else BAD_STAGE
  update hires[hire] { status: 'returned', returnedAt: now, lateFee: 2500 if now > h.dueAt + 5d else 0 }

mutation keepDeposit(hire: hires, reason: text 5..1000):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  h = hires[hire] ! else NOT_FOUND
  require h.status = 'returned' else NOT_RETURNED
  require h.depositKept = false else ALREADY_APPROVED
  require (h.deposit ?? 0) > 0 else NO_DEPOSIT
  update hires[hire] { depositKept: true, damageReason: reason, approvedBy: viewer, approvedAt: now }
