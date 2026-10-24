use identity password

-- Role grants are local operator actions, never self-selected during signup.
table roles:
  principal: principal
  role: enum('owner', 'scheduler', 'assistant', 'technician', 'headTechnician')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'scheduler']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'scheduler', 'assistant', 'technician', 'headTechnician')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

fn staff(): exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'assistant'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'headTechnician']
fn technician(): exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'headTechnician']
fn dueAfter(t: time):
  m = month(t) + 18
  offset = t - monthStart(month(t))
  lastDay = monthStart(m + 1) - monthStart(m) - 1d
  return monthStart(m) + min(offset / 1d * 1d, lastDay) + offset % 1d

table harps:
  owner: principal
  name: text 1..80
  kind: enum('concert', 'lever')
  lastRegulatedAt: time
  dueAt: time
  immutable owner, name, kind
  read <- .owner = viewer or exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'assistant'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'headTechnician']
  insert <- exists roles[principal = viewer, role = 'scheduler']
  update <- exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'headTechnician']
  online only

table visits:
  harp: harps
  owner: principal
  harpName: text 1..80
  scheduledAt: time
  feeCents: int 1..10000000
  soundboard: image <=5000000
  neck: image <=5000000
  status: enum('booked', 'restrung', 'regulated', 'done') default 'booked'
  openedAt: time default now
  crackedAt: time ?
  quoteDueAt: time ?
  crackQuoteCents: int 1..10000000 ?
  quotedAt: time ?
  consent: text 20..4000 ?
  consentAt: time ?
  consentBy: principal ?
  shippingApprovedAt: time ?
  shippingApprovedBy: principal ?
  immutable harp, owner, harpName, scheduledAt, feeCents, soundboard, neck, openedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'assistant'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'headTechnician']
  insert <- exists roles[principal = viewer, role = 'scheduler']
  update <- .owner = viewer or exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'headTechnician']
  online only

query myRole():
  return roles[principal = viewer]
query ownerDirectory():
  require exists roles[principal = viewer, role = 'scheduler'] else SCHEDULER_ONLY
  return roles where .role = 'owner' first 100 by .id
query listHarps():
  return harps first 200 by .id { *, overdue: .dueAt < now }
query listVisits():
  return visits last 200 by .id { *, quoteOverdue: .quoteDueAt != null and .quoteDueAt < now and .quotedAt = null }
query visitDetail(visit: visits):
  return visits[visit]
query serverTime():
  return now

mutation registerHarp(owner: principal, name: text 1..80, kind: enum('concert', 'lever'), lastRegulatedAt: time):
  require exists roles[principal = viewer, role = 'scheduler'] else SCHEDULER_ONLY
  require exists roles[principal = owner, role = 'owner'] else OWNER_REQUIRED
  require lastRegulatedAt <= now and lastRegulatedAt >= now - 3650d else INVALID_LAST_REGULATION
  return insert harps { owner, name, kind, lastRegulatedAt, dueAt: dueAfter(lastRegulatedAt) }

mutation bookVisit(harp: harps, scheduledAt: time, feeCents: int 1..10000000, soundboard: image <=5000000, neck: image <=5000000):
  require exists roles[principal = viewer, role = 'scheduler'] else SCHEDULER_ONLY
  h = harps[harp] ! else NOT_FOUND
  require scheduledAt >= now - 1m else VISIT_IN_PAST
  require scheduledAt <= h.dueAt else REGULATION_DUE 'Book within 18 calendar months of the last regulation.'
  return insert visits { harp, owner: h.owner, harpName: h.name, scheduledAt, feeCents, soundboard, neck }

mutation advanceVisit(visit: visits, next: enum('restrung', 'regulated', 'done')):
  require technician() else TECHNICIAN_ONLY
  v = visits[visit] ! else NOT_FOUND
  require now >= v.scheduledAt else VISIT_NOT_STARTED
  require (v.status = 'booked' and next = 'restrung') or (v.status = 'restrung' and next = 'regulated') or (v.status = 'regulated' and next = 'done') else INVALID_TRANSITION
  if next = 'regulated':
    h = harps[v.harp] ! else NOT_FOUND
    require now <= h.dueAt else REGULATION_OVERDUE
    update harps[v.harp] { lastRegulatedAt: now, dueAt: dueAfter(now) }
  if next = 'done':
    require v.crackedAt = null or v.quotedAt != null else CRACK_QUOTE_REQUIRED
  return update visits[visit] { status: next }

mutation reportCrack(visit: visits):
  require technician() else TECHNICIAN_ONLY
  v = visits[visit] ! else NOT_FOUND
  require now >= v.scheduledAt else VISIT_NOT_STARTED
  require v.status != 'done' and v.crackedAt = null else CRACK_ALREADY_RECORDED_OR_DONE
  return update visits[visit] { crackedAt: now, quoteDueAt: now + 10d }

mutation quoteCrack(visit: visits, amountCents: int 1..10000000):
  require exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'headTechnician'] else QUOTER_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.quoteDueAt != null else NO_CRACK
  require now <= v.quoteDueAt else QUOTE_DEADLINE_PASSED
  require v.quotedAt = null else ALREADY_QUOTED
  return update visits[visit] { crackQuoteCents: amountCents, quotedAt: now }

mutation giveConsent(visit: visits, statement: text 20..4000):
  v = visits[visit] ! else NOT_FOUND
  require v.owner = viewer and exists roles[principal = viewer, role = 'owner'] else OWNER_ONLY
  require v.crackedAt != null and v.quotedAt != null else QUOTE_REQUIRED
  require v.shippingApprovedAt = null else SHIPPING_ALREADY_APPROVED
  return update visits[visit] { consent: statement, consentAt: now, consentBy: viewer }

mutation approveShipping(visit: visits):
  require exists roles[principal = viewer, role = 'headTechnician'] else HEAD_TECHNICIAN_ONLY
  v = visits[visit] ! else NOT_FOUND
  require v.crackedAt != null and v.quotedAt != null else QUOTE_REQUIRED
  require v.consent != null and v.consentBy = v.owner else WRITTEN_CONSENT_REQUIRED
  require v.shippingApprovedAt = null else SHIPPING_ALREADY_APPROVED
  return update visits[visit] { shippingApprovedAt: now, shippingApprovedBy: viewer }

-- Independent product privacy intents: owners may only see their own records.
invariant harps.read only .owner = viewer or exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'assistant'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'headTechnician']
invariant visits.read only .owner = viewer or exists roles[principal = viewer, role = 'scheduler'] or exists roles[principal = viewer, role = 'assistant'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'headTechnician']
