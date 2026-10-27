use identity password

table roles:
  principal: principal
  role: enum('owner', 'clerk', 'mechanic', 'shopOwner')
  label: text 1..120
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shopOwner'] or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('owner', 'clerk', 'mechanic', 'shopOwner'), label: text 1..120):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role, label }

invariant roles.insert only viewer = 'service:operator'
invariant roles.update only viewer = 'service:operator'

query myRole():
  return roles[viewer]
query owners(c: cursor ?):
  require exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'shopOwner'] else NOT_COUNTER
  return roles where .role = 'owner' last 100 by .id after c

table sleds:
  owner: principal
  model: text 1..100
  serial: text 3..40
  fault: text 3..500
  condition: image <=5000000
  serialPlate: image <=5000000
  quoteCents: int 1..10000000
  loggedAt: time
  deadline: time
  status: enum('awaitingApproval', 'diagnosis', 'repair', 'trackCheck', 'testRide', 'ready', 'pickedUp', 'returnedUnrepaired')
  approvedAt: time ?
  pickedUpAt: time ?
  returnedAt: time ?
  engineState: enum('none', 'proposed', 'agreed', 'approved') default 'none'
  engineCents: int 1..10000000 ?
  engineApprovedBy: principal ?
  warrantyClaimed: bool default false
  immutable owner, model, serial, fault, condition, serialPlate, quoteCents, loggedAt, deadline
  read <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'mechanic'] or exists roles[viewer, role = 'shopOwner']
  insert <- exists roles[viewer, role = 'clerk']
  update <- .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'mechanic'] or exists roles[viewer, role = 'shopOwner']
  online only

invariant sleds.read only .owner = viewer or exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'mechanic'] or exists roles[viewer, role = 'shopOwner']
invariant sleds.insert only exists roles[viewer, role = 'clerk']
invariant sleds always .condition != null and .serialPlate != null
invariant sleds.approveQuote only .owner = viewer
invariant sleds.approveEngine only exists roles[viewer, role = 'shopOwner']

query board(c: cursor ?):
  if exists roles[viewer, role = 'clerk'] or exists roles[viewer, role = 'mechanic'] or exists roles[viewer, role = 'shopOwner']:
    return sleds last 50 by .id after c
  return sleds where .owner = viewer last 50 by .id after c
query sled(sled: sleds):
  return sleds[sled]

mutation intake(owner: principal, model: text 1..100, serial: text 3..40, fault: text 3..500, condition: image <=5000000, serialPlate: image <=5000000, quoteCents: int 1..10000000):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  require exists roles[owner, role = 'owner'] else NOT_CUSTOMER
  return insert sleds { owner, model, serial, fault, condition, serialPlate, quoteCents, loggedAt: now, deadline: now + 14d, status: 'awaitingApproval' }

mutation approveQuote(sled: sleds):
  s = sleds[sled] ! else NOT_FOUND
  require s.owner = viewer else NOT_OWNER
  require s.status = 'awaitingApproval' else WRONG_STAGE
  require now < s.deadline else QUOTE_EXPIRED
  return update sleds[sled] { status: 'diagnosis', approvedAt: now }

mutation advanceStage(sled: sleds):
  require exists roles[viewer, role = 'mechanic'] else NOT_MECHANIC
  s = sleds[sled] ! else NOT_FOUND
  if s.status = 'diagnosis':
    return update sleds[sled] { status: 'repair' }
  elif s.status = 'repair':
    require s.engineState = 'none' or s.engineState = 'approved' else ENGINE_NOT_APPROVED
    return update sleds[sled] { status: 'trackCheck' }
  elif s.status = 'trackCheck':
    return update sleds[sled] { status: 'testRide' }
  elif s.status = 'testRide':
    return update sleds[sled] { status: 'ready' }
  else:
    require false else WRONG_STAGE

mutation proposeEngine(sled: sleds, extraCents: int 1..10000000):
  require exists roles[viewer, role = 'mechanic'] else NOT_MECHANIC
  s = sleds[sled] ! else NOT_FOUND
  require s.status = 'diagnosis' or s.status = 'repair' else WRONG_STAGE
  require s.engineState = 'none' else ENGINE_ALREADY_PROPOSED
  return update sleds[sled] { engineState: 'proposed', engineCents: extraCents }

mutation agreeEngineCost(sled: sleds):
  s = sleds[sled] ! else NOT_FOUND
  require s.owner = viewer else NOT_OWNER
  require s.engineState = 'proposed' else WRONG_ENGINE_STAGE
  return update sleds[sled] { engineState: 'agreed' }

mutation approveEngine(sled: sleds):
  require exists roles[viewer, role = 'shopOwner'] else NOT_SHOP_OWNER
  s = sleds[sled] ! else NOT_FOUND
  require s.engineState = 'agreed' else EXTRA_COST_NOT_AGREED
  require s.status = 'diagnosis' or s.status = 'repair' else WRONG_STAGE
  return update sleds[sled] { engineState: 'approved', engineApprovedBy: viewer }

mutation pickup(sled: sleds):
  require exists roles[viewer, role = 'clerk'] else NOT_CLERK
  s = sleds[sled] ! else NOT_FOUND
  require s.status = 'ready' else NOT_READY
  return update sleds[sled] { status: 'pickedUp', pickedUpAt: now }

mutation claimWarranty(sled: sleds, fault: text 3..500):
  s = sleds[sled] ! else NOT_FOUND
  require s.owner = viewer else NOT_OWNER
  require s.status = 'pickedUp' and s.pickedUpAt != null else NOT_PICKED_UP
  require now < s.pickedUpAt + 90d else WARRANTY_EXPIRED
  require fault = s.fault else DIFFERENT_FAULT
  require not s.warrantyClaimed else ALREADY_CLAIMED
  return update sleds[sled] { warrantyClaimed: true }

job expireQuotes():
  for s in sleds:
    if s.status = 'awaitingApproval' and now >= s.deadline:
      update sleds[s.id] { status: 'returnedUnrepaired', returnedAt: now }
schedule expireQuotesEveryMinute every 1m: expireQuotes
