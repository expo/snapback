use identity password

table roles:
  principal: principal
  role: enum('manager', 'templater', 'designer', 'homeowner', 'installer', 'floor')
  email: text 3..160
  unique principal
  immutable principal, role, email
  read <- .principal = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'designer'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  online only

table jobs:
  summary: enum('no layout', 'approval outstanding', 'all layouts approved') default 'no layout' read <- (.designer = viewer and exists roles[viewer, role = 'designer']) or exists roles[viewer, role = 'manager']
  title: text 1..120
  customer: principal
  templater: principal
  designer: principal
  installer: principal
  siteNotes: text <=2000 default ''
  installDate: time ?
  template: image <=10000000 ?
  sitePhoto: image <=10000000 ?
  widthMm: int 100..5000 default 2400
  depthMm: int 100..2000 default 600
  slab: slabs ?
  offsetX: int 0..5000 default 0
  offsetY: int 0..3000 default 0
  rotation: int 0..1 default 0
  layoutReady: bool default false
  approved: bool default false
  approvedAt: time ?
  cut: bool default false
  createdAt: time default now
  immutable customer, templater, designer, installer, createdAt
  read <- .customer = viewer or .templater = viewer or .designer = viewer or .installer = viewer or exists roles[viewer, role = 'manager'] or (.approved = true and exists roles[viewer, role = 'floor'])
  insert <- exists roles[viewer, role = 'manager']
  update <- .templater = viewer or .designer = viewer or .customer = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'floor']
  online only

table prices:
  job: jobs
  customer: principal
  cents: int 0..100000000
  unique job
  immutable job, customer, cents
  read <- .customer = viewer or exists roles[viewer, role = 'manager']
  insert <- exists roles[viewer, role = 'manager']
  online only

table slabs:
  name: text 1..120
  photo: image <=10000000
  widthMm: int 1000..6000
  depthMm: int 500..3500
  immutable name, photo, widthMm, depthMm
  read <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'designer'] or exists roles[viewer, role = 'floor'] or exists holds[slab = .id, customer = viewer]
  insert <- exists roles[viewer, role = 'designer'] or exists roles[viewer, role = 'manager']
  online only

table holds:
  slab: slabs
  job: jobs
  customer: principal
  expiresAt: time
  approved: bool default false
  unique slab
  unique job
  immutable slab, job, customer, expiresAt
  read <- .customer = viewer or exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'designer'] or exists roles[viewer, role = 'floor']
  insert <- exists roles[viewer, role = 'designer'] or exists roles[viewer, role = 'manager']
  update <- .customer = viewer
  delete <- exists roles[viewer, role = 'designer'] or exists roles[viewer, role = 'manager']
  online only

table recuts:
  job: jobs
  manager: principal
  reason: text 10..1000
  costTo: enum('shop') default 'shop'
  at: time default now
  immutable job, manager, reason, costTo, at
  read <- exists roles[viewer, role = 'manager'] or exists roles[viewer, role = 'floor']
  insert <- exists roles[viewer, role = 'manager'] and .manager = viewer
  online only

fn isRole(role: text): exists roles[viewer, role = role]
fn stockState(slab: slabs):
  h = holds[slab = slab]
  if h = null:
    return 'stock'
  if h.approved:
    return 'reserved'
  return 'stock' if now >= h.expiresAt else 'held'

mutation provision(principal: principal, role: enum('manager', 'templater', 'designer', 'homeowner', 'installer', 'floor'), email: text 3..160):
  require viewer = 'service:operator' else NOT_OPERATOR
  return insert roles { principal, role, email }
query me():
  return roles[principal = viewer]
query directory():
  require isRole('manager') or isRole('designer') else NOT_STAFF
  return roles first 100 by .id
query listJobs():
  require exists roles[viewer] else NO_ROLE
  return jobs last 100 by .createdAt
query jobDetail(job: jobs):
  require exists roles[viewer] else NO_ROLE
  return jobs[job] ! else NOT_FOUND
query jobPrice(job: jobs):
  require isRole('manager') or isRole('homeowner') else PRICE_PRIVATE
  return prices[job = job]
query inventory():
  require isRole('manager') or isRole('designer') else NOT_DESIGNER
  return slabs last 100 by .id { id, name, photo, widthMm, depthMm, stock: stockState(.id) }
query jobSlab(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  return slabs[j.slab]
query jobHold(job: jobs):
  j = jobs[job] ! else NOT_FOUND
  return holds[job = j.id]
query cuttingQueue():
  require isRole('floor') or isRole('manager') else NOT_FLOOR
  return jobs where .approved = true and .cut = false first 100 by .createdAt
query recutHistory(job: jobs):
  require isRole('manager') or isRole('floor') else NOT_MANAGER
  return recuts where .job = job last 100 by .at
mutation createJob(title: text 1..120, customer: principal, templater: principal, designer: principal, installer: principal, cents: int 0..100000000):
  require isRole('manager') else NOT_MANAGER
  require exists roles[customer, role = 'homeowner'] and exists roles[templater, role = 'templater'] and exists roles[designer, role = 'designer'] and exists roles[installer, role = 'installer'] else BAD_ASSIGNMENT
  j = insert jobs { title, customer, templater, designer, installer }
  insert prices { job: j.id, customer, cents }
  return j
mutation captureTemplate(job: jobs, template: image <=10000000, sitePhoto: image <=10000000, widthMm: int 100..5000, depthMm: int 100..2000, siteNotes: text <=2000):
  require isRole('templater') else NOT_TEMPLATER
  j = jobs[job] ! else NOT_FOUND
  require j.templater = viewer else NOT_ASSIGNED
  require not j.approved else LAYOUT_LOCKED
  update jobs[job] { template, sitePhoto, widthMm, depthMm, siteNotes, layoutReady: false }
  update jobs[job] { summary: 'no layout' }
mutation addSlab(name: text 1..120, photo: image <=10000000, widthMm: int 1000..6000, depthMm: int 500..3500):
  require isRole('designer') or isRole('manager') else NOT_DESIGNER
  return insert slabs { name, photo, widthMm, depthMm }
mutation holdSlab(job: jobs, slab: slabs):
  require isRole('designer') else NOT_DESIGNER
  j = jobs[job] ! else NOT_FOUND
  require j.designer = viewer else NOT_ASSIGNED
  require not j.approved else LAYOUT_LOCKED
  s = slabs[slab] ! else NOT_FOUND
  old = holds[slab = slab]
  if old != null:
    require not old.approved and now >= old.expiresAt else SLAB_UNAVAILABLE
    delete holds[old.id]
  prior = holds[job = job]
  if prior != null:
    require not prior.approved else LAYOUT_LOCKED
    delete holds[prior.id]
  h = insert holds { slab, job, customer: j.customer, expiresAt: now + 21d }
  update jobs[job] { slab, layoutReady: false }
  update jobs[job] { summary: 'no layout' }
  return h
mutation publishLayout(job: jobs, offsetX: int 0..5000, offsetY: int 0..3000, rotation: int 0..1):
  require isRole('designer') else NOT_DESIGNER
  j = jobs[job] ! else NOT_FOUND
  require j.designer = viewer else NOT_ASSIGNED
  require not j.approved else LAYOUT_LOCKED
  require j.template != null else TEMPLATE_REQUIRED
  h = holds[job = job] ! else HOLD_EXPIRED
  require now < h.expiresAt else HOLD_EXPIRED
  s = slabs[h.slab] ! else NOT_FOUND
  w = j.widthMm if rotation = 0 else j.depthMm
  d = j.depthMm if rotation = 0 else j.widthMm
  require offsetX + w <= s.widthMm and offsetY + d <= s.depthMm else OUTSIDE_SLAB
  update jobs[job] { offsetX, offsetY, rotation, layoutReady: true }
  update jobs[job] { summary: 'approval outstanding' }
mutation approveLayout(job: jobs):
  require isRole('homeowner') else NOT_HOMEOWNER
  j = jobs[job] ! else NOT_FOUND
  require j.customer = viewer else NOT_OWNER
  require not j.approved else ALREADY_APPROVED
  require j.layoutReady else LAYOUT_REQUIRED
  h = holds[job = job] ! else HOLD_EXPIRED
  require now < h.expiresAt else HOLD_EXPIRED
  update holds[h.id] { approved: true }
  update jobs[job] { approved: true, approvedAt: now }
  update jobs[job] { summary: 'all layouts approved' }
mutation scheduleInstall(job: jobs, installDate: time, siteNotes: text <=2000):
  require isRole('manager') else NOT_MANAGER
  require installDate > now and installDate <= now + 365d else BAD_INSTALL_DATE
  update jobs[job] { installDate, siteNotes }
mutation markCut(job: jobs):
  require isRole('floor') else NOT_FLOOR
  j = jobs[job] ! else NOT_FOUND
  require j.approved and not j.cut else NOT_IN_QUEUE
  update jobs[job] { cut: true }
mutation approveRecut(job: jobs, reason: text 10..1000):
  require isRole('manager') else NOT_MANAGER
  j = jobs[job] ! else NOT_FOUND
  require j.approved and j.cut else NOT_CUT
  r = insert recuts { job, manager: viewer, reason }
  update jobs[job] { cut: false }
  return r
job releaseHolds():
  for h in holds:
    if not h.approved and now >= h.expiresAt:
      update jobs[h.job] { layoutReady: false }
      update jobs[h.job] { summary: 'no layout' }
      delete holds[h.id]
schedule expireHolds every 1m: releaseHolds

invariant prices.read only .customer = viewer or exists roles[viewer, role = 'manager']
invariant recuts.insert only exists roles[viewer, role = 'manager'] and .manager = viewer
invariant roles.insert only viewer = 'service:operator'

query layoutReview(job: jobs):
  require isRole('manager') or isRole('designer') else REVIEW_PRIVATE
  j = jobs[job] ! else NOT_FOUND
  require isRole('manager') or j.designer = viewer else REVIEW_PRIVATE
  return j { id, summary }

invariant jobs.summary read only (.designer = viewer and exists roles[viewer, role = 'designer']) or exists roles[viewer, role = 'manager']

backfill jobs reviewV2(approved: bool, layoutReady: bool): {summary: 'all layouts approved' if approved else 'approval outstanding' if layoutReady else 'no layout'}
