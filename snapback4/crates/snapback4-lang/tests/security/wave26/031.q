use identity password

-- Roles are operator-provisioned; signing up never assigns authority.
table roles:
  principal: principal
  role: enum('planner', 'restaurant', 'technician', 'compliance', 'manager')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('planner', 'restaurant', 'technician', 'compliance', 'manager')):
  require viewer = 'service:operator' else OPERATOR_ONLY
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

query directory(c: cursor ?):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager'] else STAFF_ONLY
  return roles first 100 by .id after c

table restaurants:
  name: text 2..100
  address: text 5..200
  owner: principal
  contact: principal
  lastCleanedAt: time ?
  dueAt: time
  activeStop: cleanings ?
  createdAt: time default now
  immutable name, address, owner, contact, createdAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'planner']
  update <- exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  online only

mutation addRestaurant(name: text 2..100, address: text 5..200, owner: principal, contact: principal):
  require exists roles[principal = viewer, role = 'planner'] else PLANNER_ONLY
  require exists roles[principal = owner, role = 'restaurant'] else RESTAURANT_ACCOUNT_REQUIRED
  require exists roles[principal = contact, role = 'compliance'] else COMPLIANCE_ACCOUNT_REQUIRED
  return insert restaurants { name, address, owner, contact, lastCleanedAt: null, dueAt: now, activeStop: null }

query restaurantsList(c: cursor ?):
  return restaurants first 100 by .id after c

query restaurantDetail(restaurant: restaurants):
  return restaurants[restaurant]

table cleanings:
  restaurant: restaurants
  owner: principal
  restaurantName: text 2..100
  address: text 5..200
  technician: principal
  scheduledAt: time
  stage: enum('scheduled', 'descaled', 'sanitized', 'closed')
  descaledAt: time ?
  sanitizedAt: time ?
  closedAt: time ?
  photo: image <=5000000 ?
  loggedBy: principal ?
  createdBy: principal
  createdAt: time default now
  immutable restaurant, owner, restaurantName, address, technician, scheduledAt, createdBy, createdAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'planner'] and .createdBy = viewer and .stage = 'scheduled'
  update <- exists roles[principal = viewer, role = 'planner'] or (.technician = viewer and exists roles[principal = viewer, role = 'technician'])
  online only

mutation scheduleCleaning(restaurant: restaurants, technician: principal, scheduledAt: time):
  require exists roles[principal = viewer, role = 'planner'] else PLANNER_ONLY
  r = restaurants[restaurant] ! else NOT_FOUND
  require r.activeStop = null else STOP_ALREADY_OPEN
  require exists roles[principal = technician, role = 'technician'] else TECHNICIAN_ACCOUNT_REQUIRED
  require scheduledAt >= now - 5m and scheduledAt <= now + 180d else INVALID_SCHEDULE 'Schedule between now and 180 days ahead.'
  stop = insert cleanings { restaurant, owner: r.owner, restaurantName: r.name, address: r.address, technician, scheduledAt, stage: 'scheduled', descaledAt: null, sanitizedAt: null, closedAt: null, photo: null, loggedBy: null, createdBy: viewer }
  update restaurants[restaurant] { activeStop: stop.id }
  return stop

mutation descale(cleaning: cleanings):
  require exists roles[principal = viewer, role = 'technician'] else TECHNICIAN_ONLY
  s = cleanings[cleaning] ! else NOT_FOUND
  require s.technician = viewer else ASSIGNED_TECHNICIAN_ONLY
  require s.scheduledAt <= now else NOT_SCHEDULED_YET
  require s.stage = 'scheduled' else WRONG_STAGE
  return update cleanings[cleaning] { stage: 'descaled', descaledAt: now }

mutation sanitize(cleaning: cleanings):
  require exists roles[principal = viewer, role = 'technician'] else TECHNICIAN_ONLY
  s = cleanings[cleaning] ! else NOT_FOUND
  require s.technician = viewer else ASSIGNED_TECHNICIAN_ONLY
  require s.scheduledAt <= now else NOT_SCHEDULED_YET
  require s.stage = 'descaled' else WRONG_STAGE
  return update cleanings[cleaning] { stage: 'sanitized', sanitizedAt: now }

-- Planner records the sanitized bin evidence and service price together.
mutation closeCleaning(cleaning: cleanings, photo: image <=5000000, priceCents: int 1..1000000):
  require exists roles[principal = viewer, role = 'planner'] else PLANNER_ONLY
  s = cleanings[cleaning] ! else NOT_FOUND
  require s.stage = 'sanitized' else SANITIZE_FIRST
  require s.scheduledAt <= now else NOT_SCHEDULED_YET
  r = restaurants[s.restaurant] ! else NOT_FOUND
  require r.activeStop = s.id else STOP_NOT_ACTIVE
  invoice = insert invoices { restaurant: s.restaurant, cleaning, owner: s.owner, restaurantName: s.restaurantName, priceCents, issuedAt: now }
  update restaurants[s.restaurant] { lastCleanedAt: now, dueAt: now + 180d, activeStop: null }
  return update cleanings[cleaning] { stage: 'closed', closedAt: now, photo, loggedBy: viewer }

query routeBoard(c: cursor ?):
  require exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] else ROUTE_STAFF_ONLY
  return cleanings where .stage != 'closed' first 100 by .id after c

query cleaningsList(c: cursor ?):
  return cleanings last 100 by .id after c

query cleaningDetail(cleaning: cleanings):
  return cleanings[cleaning]

table invoices:
  restaurant: restaurants
  cleaning: cleanings
  owner: principal
  restaurantName: text 2..100
  priceCents: int 1..1000000
  issuedAt: time
  unique cleaning
  immutable restaurant, cleaning, owner, restaurantName, priceCents, issuedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'planner']
  online only

query invoicesList(c: cursor ?):
  return invoices last 100 by .id after c

query invoiceDetail(invoice: invoices):
  return invoices[invoice]

table extensions:
  restaurant: restaurants
  owner: principal
  restaurantName: text 2..100
  previousDueAt: time
  newDueAt: time
  reason: text 10..1000
  approvedBy: principal
  approvedAt: time default now
  immutable restaurant, owner, restaurantName, previousDueAt, newDueAt, reason, approvedBy, approvedAt
  read <- .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  insert <- exists roles[principal = viewer, role = 'manager'] and .approvedBy = viewer
  online only

mutation approveExtension(restaurant: restaurants, reason: text 10..1000, newDueAt: time):
  require exists roles[principal = viewer, role = 'manager'] else MANAGER_ONLY
  r = restaurants[restaurant] ! else NOT_FOUND
  require newDueAt > r.dueAt and newDueAt > now and newDueAt <= now + 365d else INVALID_EXTENSION 'New deadline must be later than the current deadline and within 365 days from now.'
  extension = insert extensions { restaurant, owner: r.owner, restaurantName: r.name, previousDueAt: r.dueAt, newDueAt, reason, approvedBy: viewer }
  update restaurants[restaurant] { dueAt: newDueAt }
  return extension

query extensionsList(c: cursor ?):
  return extensions last 100 by .id after c

query extensionDetail(extension: extensions):
  return extensions[extension]

table alerts:
  restaurant: restaurants
  contact: principal
  restaurantName: text 2..100
  dueAt: time
  flaggedAt: time
  unique restaurant, dueAt
  immutable restaurant, contact, restaurantName, dueAt, flaggedAt
  read <- .contact = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
  insert <- deny
  online only

query alertsList(c: cursor ?):
  return alerts last 100 by .id after c

query alertDetail(alert: alerts):
  return alerts[alert]

job flagOverdue():
  for r in restaurants:
    if r.dueAt + 14d <= now:
      insert alerts { restaurant: r.id, contact: r.contact, restaurantName: r.name, dueAt: r.dueAt, flaggedAt: now } if absent

schedule overdueCompliance every 1m: flagOverdue

-- Independent privacy intent from the product requirements.
invariant roles.read only .principal = viewer or viewer = 'service:operator' or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
invariant restaurants.read only .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
invariant cleanings.read only .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'technician'] or exists roles[principal = viewer, role = 'manager']
invariant invoices.read only .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
invariant extensions.insert only exists roles[principal = viewer, role = 'manager'] and .approvedBy = viewer
invariant extensions.read only .owner = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
invariant alerts.read only .contact = viewer or exists roles[principal = viewer, role = 'planner'] or exists roles[principal = viewer, role = 'manager']
