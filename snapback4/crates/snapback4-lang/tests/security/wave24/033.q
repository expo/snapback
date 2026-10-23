-- Pressure Washing Jobs on Snapback 4.
-- Roles: owner (also acts as estimator: opens jobs), crew, customer.
-- Real password identity; roles are provisioned by the local operator
-- (service:operator) on staging/serve. All tables are `online only` so the
-- browser app uses the thin online client (no device wasm).
use identity password

table roles:
  principal: principal
  role: enum('owner', 'crew', 'customer')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'crew', 'customer')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[viewer]

query whoAmI():
  return viewer

-- A job: the estimator (owner) opens it with a quoted price; the customer
-- accepts within 14 days or the quote lapses (swept by lapseExpired plus a
-- direct `now` guard in acceptQuote). washedAt is stamped when the wash
-- finishes (washing -> sealing); the customer may report a missed area within
-- 7 days after the wash.
table jobs:
  customer: principal
  address: text 1..200
  price: money USD
  status: enum('quoted', 'booked', 'washing', 'sealing', 'done', 'lapsed')
  quotedAt: time
  quoteExpiresAt: time
  washedAt: time ?
  returnRequested: bool default false
  immutable customer, quotedAt, quoteExpiresAt
  read <- .customer = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew']
  insert <- exists roles[viewer, role = 'owner']
  update <- exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew'] or .customer = viewer
  delete <- deny
  online only

-- One row per surface (driveway, deck, siding) with its before photo.
-- fragile = the customer signed this surface off as fragile; washing it
-- needs the owner's approval recording the customer's consent.
table surfaces:
  job: jobs on delete cascade
  kind: enum('driveway', 'deck', 'siding')
  photo: image <=10000000
  fragile: bool default false
  consent: text <=400 ?
  consentAt: time ?
  immutable job, kind, photo, fragile
  read through .job
  insert <- exists roles[viewer, role = 'owner']
  update <- exists roles[viewer, role = 'owner']
  delete <- deny
  online only

-- A missed-area report: free return visit request within 7 days of the wash.
table reports:
  job: jobs on delete cascade
  note: text 1..500
  at: time
  immutable job, note, at
  read through .job
  insert <- exists jobs[.job, customer = viewer]
  delete <- deny
  online only

-- One invoice per finished job, visible to its customer and the owner.
table invoices:
  job: jobs on delete cascade
  customer: principal
  amount: money USD
  issuedAt: time
  unique job
  immutable job, customer, amount, issuedAt
  read <- .customer = viewer or exists roles[viewer, role = 'owner']
  insert <- exists roles[viewer, role = 'owner']
  update <- deny
  delete <- deny
  online only

mutation openJob(customer: principal, address: text 1..200, price: money USD):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  require price >= 0 else BAD_PRICE
  return insert jobs { customer, address, price, status: 'quoted', quotedAt: now, quoteExpiresAt: now + 14d }

mutation addSurface(job: jobs, kind: enum('driveway', 'deck', 'siding'), photo: image <=10000000, fragile: bool):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'quoted' else BAD_STATUS
  return insert surfaces { job, kind, photo, fragile }

mutation acceptQuote(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_YOURS
  require j.status = 'quoted' else BAD_STATUS
  require now <= j.quoteExpiresAt else QUOTE_EXPIRED
  update jobs[job] { status: 'booked' }
  return jobs[job]

mutation startWash(job: jobs):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'booked' else BAD_STATUS
  require not exists surfaces where .job = job and .fragile = true and .consent = null else FRAGILE_UNAPPROVED
  update jobs[job] { status: 'washing' }
  return jobs[job]

mutation startSealing(job: jobs):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'washing' else BAD_STATUS
  update jobs[job] { status: 'sealing', washedAt: now }
  return jobs[job]

mutation completeJob(job: jobs):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew'] else NOT_STAFF
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'sealing' else BAD_STATUS
  update jobs[job] { status: 'done' }
  return jobs[job]

-- Only the owner may approve washing a fragile surface, recording the
-- customer's consent (a non-empty consent note).
mutation approveFragile(surface: surfaces, consent: text 1..400):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  s = surfaces[surface] ! else NOT_FOUND
  require s.fragile = true else NOT_FRAGILE
  update surfaces[surface] { consent, consentAt: now }
  return surfaces[surface]

mutation reportMissed(job: jobs, note: text 1..500):
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_YOURS
  require j.status = 'done' else BAD_STATUS
  require j.washedAt != null else BAD_STATUS
  require now <= j.washedAt + 7d else TOO_LATE
  update jobs[job] { returnRequested: true }
  return insert reports { job, note, at: now }

mutation issueInvoice(job: jobs):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  j = jobs[job] ! else NOT_FOUND
  require j.status = 'done' else BAD_STATUS
  return insert invoices { job, customer: j.customer, amount: j.price, issuedAt: now }

-- Nightly sweep: quotes still unaccepted 14 days after opening lapse.
job lapseExpired(periodStart: time, periodEnd: time):
  for j in jobs where .quotedAt >= periodStart - 14d and .quotedAt < periodEnd - 14d by .quotedAt:
    if j.status = 'quoted':
      update jobs[j.id] { status: 'lapsed' }

schedule lapseDaily every 1d at 03:00: lapseExpired

query myJobs(c: cursor ?):
  return jobs where .customer = viewer last 20 by .quotedAt after c

-- The live job board: crew and owner see every job.
query jobBoard(c: cursor ?):
  require exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew'] else NOT_STAFF
  return jobs last 50 by .quotedAt after c

query jobDetail(job: jobs):
  return jobs[job]

query surfacesFor(job: jobs, c: cursor ?):
  return surfaces where .job = job last 20 by .id after c

query reportsFor(job: jobs, c: cursor ?):
  return reports where .job = job last 20 by .id after c

query myInvoices(c: cursor ?):
  return invoices where .customer = viewer last 20 by .issuedAt after c

query invoiceFor(job: jobs):
  return invoices[job]

-- Privacy intent, stated separately from enforcement (see guide security).
invariant jobs.read only .customer = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew']
invariant jobs.insert only exists roles[viewer, role = 'owner']
invariant surfaces.read only .customer = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew']
invariant reports.read only .customer = viewer or exists roles[viewer, role = 'owner'] or exists roles[viewer, role = 'crew']
invariant invoices.read only .customer = viewer or exists roles[viewer, role = 'owner']
invariant roles.read only .principal = viewer
