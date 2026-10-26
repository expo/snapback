-- Rug Wash Pickups: area rugs are logged by drivers with photos and a quoted
-- price; the wash crew works the floor board; owners see only their own rugs
-- and invoices. Every role named by the spec is a row in `roles`.
use identity password

table roles:
  principal: principal
  role: enum('driver', 'wash', 'office', 'company_owner', 'customer')
  unique principal
  immutable principal
  -- Employees may read the roster (a driver must verify a rug owner is a
  -- customer); customers read only their own row, so no one can enumerate it.
  read <- .principal = viewer or exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'wash'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- One row per rug. address/phone/ownerEmail/price stay invisible to the wash
-- crew via column rules; the row itself is readable by every employee and by
-- the rug's owner.
table rugs:
  owner: principal
  address: text 5..200
  phone: text 5..40
  ownerEmail: text 5..100 ?
  front: image <=5000000
  back: image <=5000000
  stains: [image <=5000000] <=6 ?
  size: text 1..40
  fiber: text 1..80
  dyeNotes: text <=500 ?
  stainTreatment: text <=500 ?
  price: money USD
  status: enum('dusting', 'washing', 'drying', 'wrapped') default 'dusting'
  dryingAt: time ?
  repair: enum('none', 'fringe', 'holes') default 'none'
  repairApproved: bool default false
  createdAt: time default now
  immutable owner, front, back
  read <- .owner = viewer or exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'wash'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner']
  read (address, phone, ownerEmail, price) <- .owner = viewer or exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner']
  insert <- exists roles[principal = viewer, role = 'driver'] and exists roles[.owner, role = 'customer']
  update <- exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'wash'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner']
  online only

-- One invoice per rug billing event. Only the owning customer, the office and
-- the company owner read invoices; drivers and wash crew cannot.
table invoices:
  rug: rugs
  owner: principal
  amount: money USD
  status: enum('unpaid', 'paid') default 'unpaid'
  at: time default now
  immutable rug, owner
  read <- .owner = viewer or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner']
  insert <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner']
  update <- exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner']
  online only

query myRole():
  return roles[principal = viewer]

-- Wash floor board: every employee reads every rug (private columns stay
-- hidden for wash). Customers use myRugs.
query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'wash'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner'] else NOT_STAFF
  return rugs last 50 by .createdAt after c

query myRugs(c: cursor ?):
  return rugs where .owner = viewer last 50 by .createdAt after c

query rug(rug: rugs):
  return rugs[rug]

query myInvoices(c: cursor ?):
  return invoices where .owner = viewer last 50 by .at after c

query invoices(c: cursor ?):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner'] else NOT_OFFICE
  return invoices last 50 by .at after c

query invoice(id: invoices):
  return invoices[id]

-- Operator-only roster provisioning (staging first-admin recipe). Customers
-- get a row too so myRole works uniformly; employee rules ignore it.
mutation provision(principal: principal, role: enum('driver', 'wash', 'office', 'company_owner', 'customer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  if role = 'driver':
    return upsert roles[principal = principal] { principal, role: 'driver' }
  if role = 'wash':
    return upsert roles[principal = principal] { principal, role: 'wash' }
  if role = 'office':
    return upsert roles[principal = principal] { principal, role: 'office' }
  if role = 'company_owner':
    return upsert roles[principal = principal] { principal, role: 'company_owner' }
  return upsert roles[principal = principal] { principal, role: 'customer' }

-- Drivers log each rug with photos and the quoted price.
mutation logRug(owner: principal, address: text 5..200, phone: text 5..40, ownerEmail: text 5..100 ?, front: image <=5000000, back: image <=5000000, stains: [image <=5000000] <=6 ?, size: text 1..40, fiber: text 1..80, dyeNotes: text <=500 ?, stainTreatment: text <=500 ?, price: money USD):
  require exists roles[principal = viewer, role = 'driver'] else NOT_DRIVER
  require exists roles[owner, role = 'customer'] else NOT_CUSTOMER_OWNER 'Rugs belong to customers.'
  return insert rugs { owner, address, phone, ownerEmail, front, back, stains, size, fiber, dyeNotes, stainTreatment, price }

-- Intake corrections by drivers, the office and the company owner.
mutation updateRug(rug: rugs, size: text 1..40, fiber: text 1..80, dyeNotes: text <=500 ?, stainTreatment: text <=500 ?, address: text 5..200, phone: text 5..40, price: money USD):
  require exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner'] else NOT_INTAKE
  r = rugs[rug] ! else NOT_FOUND
  return update rugs[rug] { size, fiber, dyeNotes: dyeNotes ?? r.dyeNotes, stainTreatment: stainTreatment ?? r.stainTreatment, address, phone, price }

-- The floor crew moves rugs one step forward; wrapping needs two dry days.
mutation moveStatus(rug: rugs, status: enum('dusting', 'washing', 'drying', 'wrapped')):
  require exists roles[principal = viewer, role = 'wash'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner'] else NOT_CREW
  r = rugs[rug] ! else NOT_FOUND
  require (r.status = 'dusting' and status = 'washing') or (r.status = 'washing' and status = 'drying') or (r.status = 'drying' and status = 'wrapped') else BAD_TRANSITION 'Rugs move one step forward: dusting, washing, drying, wrapped.'
  require status != 'wrapped' or (r.dryingAt != null and now - r.dryingAt >= 2d) else TOO_SOON 'A rug must dry at least two days before wrapping.'
  update rugs[rug] { status, dryingAt: now if status = 'drying' else r.dryingAt }
  return null

-- Anyone on staff can flag fringe/hole repair; only the company owner approves.
mutation requestRepair(rug: rugs, repair: enum('fringe', 'holes')):
  require exists roles[principal = viewer, role = 'driver'] or exists roles[principal = viewer, role = 'wash'] or exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner'] else NOT_STAFF
  r = rugs[rug] ! else NOT_FOUND
  require r.repairApproved = false else ALREADY_DECIDED
  update rugs[rug] { repair }
  return null

mutation approveRepair(rug: rugs):
  require exists roles[principal = viewer, role = 'company_owner'] else NOT_OWNER
  r = rugs[rug] ! else NOT_FOUND
  require r.repair != 'none' else NOTHING_REQUESTED
  update rugs[rug] { repairApproved: true }
  return null

mutation createInvoice(rug: rugs, amount: money USD):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner'] else NOT_OFFICE
  r = rugs[rug] ! else NOT_FOUND
  return insert invoices { rug, owner: r.owner, amount }

mutation markPaid(id: invoices):
  require exists roles[principal = viewer, role = 'office'] or exists roles[principal = viewer, role = 'company_owner'] else NOT_OFFICE
  update invoices[id] { status: 'paid' }
  return null
