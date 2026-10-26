use identity password

table roles:
  principal: principal
  role: enum('surfer', 'counter', 'tech', 'owner')
  unique principal
  immutable principal
  read <- .principal = viewer or (exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner']) or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only

mutation provision(principal: principal, role: enum('surfer', 'counter', 'tech', 'owner')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query me():
  return roles[viewer]

query customers():
  require exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'owner'] else NOT_COUNTER
  return roles where .role = 'surfer' first 200 by .id

table boards:
  surfer: principal
  name: text 1..100
  kind: enum('dinged', 'snapped')
  valueCents: int 100..10000000
  quoteCents: int 1..10000000
  stage: enum('quoted', 'sanding', 'glassing', 'curing', 'ready', 'collected', 'sold') default 'quoted'
  agreedAt: time ?
  approvedBy: principal ?
  approvedAt: time ?
  agreement: text 5..1000 ?
  resinAt: time ?
  pickupNoticeAt: time ?
  finishedAt: time ?
  loggedAt: time default now
  immutable surfer, name, kind, valueCents, quoteCents, loggedAt
  read <- .surfer = viewer or (exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner'])
  insert <- exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'owner']
  update <- .surfer = viewer or (exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner'])
  online only

table dings:
  board: boards
  description: text 1..500
  photo: image <=5000000
  immutable board, description, photo
  read <- .board.surfer = viewer or (exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner'])
  insert <- exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'owner']
  online only

-- Surfers may read only their own repair records and evidence. Shop staff
-- need the complete live board and quotes to perform the described workflow.
invariant boards.read only .surfer = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner']
invariant dings.read only .board.surfer = viewer or exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner']
invariant roles.role write only viewer = 'service:operator'
invariant boards.approveHighCost only exists roles[viewer, role = 'owner']

query listBoards():
  require exists roles[viewer] else NO_ROLE
  return boards last 200 by .id

query getBoard(board: boards):
  return boards[board]

query boardDings(board: boards):
  b = boards[board] ! else NOT_FOUND
  return dings where .board = b.id first 100 by .id

mutation logBoard(surfer: principal, name: text 1..100, kind: enum('dinged', 'snapped'), valueCents: int 100..10000000, quoteCents: int 1..10000000, description: text 1..500, photo: image <=5000000):
  require exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'owner'] else NOT_COUNTER
  require exists roles[surfer, role = 'surfer'] else NOT_SURFER
  b = insert boards { surfer, name, kind, valueCents, quoteCents }
  insert dings { board: b.id, description, photo }
  return b

mutation addDing(board: boards, description: text 1..500, photo: image <=5000000):
  require exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'owner'] else NOT_COUNTER
  b = boards[board] ! else NOT_FOUND
  require b.stage = 'quoted' else IN_PROGRESS
  return insert dings { board, description, photo }

mutation agreeQuote(board: boards):
  b = boards[board] ! else NOT_FOUND
  require b.surfer = viewer else NOT_SURFER
  require b.stage = 'quoted' else IN_PROGRESS
  require b.agreedAt = null else ALREADY_AGREED
  update boards[board] { agreedAt: now }

mutation approveHighCost(board: boards, agreement: text 5..1000):
  require exists roles[viewer, role = 'owner'] else NOT_OWNER
  b = boards[board] ! else NOT_FOUND
  require b.stage = 'quoted' else IN_PROGRESS
  require b.quoteCents * 2 > b.valueCents else APPROVAL_NOT_REQUIRED
  require b.agreedAt != null else SURFER_AGREEMENT_REQUIRED
  require b.approvedAt = null else ALREADY_APPROVED
  update boards[board] { approvedBy: viewer, approvedAt: now, agreement }

mutation processBoard(board: boards, action: enum('sand', 'glass', 'cure', 'ready', 'collect', 'sell')):
  require (exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner']) else NOT_STAFF
  b = boards[board] ! else NOT_FOUND
  if action = 'sand':
    require exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner'] else NOT_TECH
    require b.stage = 'quoted' else WRONG_STAGE
    require b.agreedAt != null else SURFER_AGREEMENT_REQUIRED
    require b.quoteCents * 2 <= b.valueCents or b.approvedAt != null else OWNER_APPROVAL_REQUIRED
    update boards[board] { stage: 'sanding' }
  else if action = 'glass':
    require exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner'] else NOT_TECH
    require b.stage = 'sanding' else WRONG_STAGE
    update boards[board] { stage: 'glassing' }
  else if action = 'cure':
    require exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner'] else NOT_TECH
    require b.stage = 'glassing' else WRONG_STAGE
    update boards[board] { stage: 'curing', resinAt: now }
  else if action = 'ready':
    require exists roles[viewer, role = 'tech'] or exists roles[viewer, role = 'owner'] else NOT_TECH
    require b.stage = 'curing' else WRONG_STAGE
    require b.resinAt != null and now >= b.resinAt + 3d else STILL_CURING
    update boards[board] { stage: 'ready', pickupNoticeAt: now }
  else if action = 'collect':
    require exists roles[viewer, role = 'counter'] or exists roles[viewer, role = 'owner'] else NOT_COUNTER
    require b.stage = 'ready' else WRONG_STAGE
    require b.pickupNoticeAt != null and now < b.pickupNoticeAt + 45d else PICKUP_EXPIRED
    update boards[board] { stage: 'collected', finishedAt: now }
  else if action = 'sell':
    require exists roles[viewer, role = 'owner'] else NOT_OWNER
    require b.stage = 'ready' else WRONG_STAGE
    require b.pickupNoticeAt != null and now >= b.pickupNoticeAt + 45d else TOO_EARLY_TO_SELL
    update boards[board] { stage: 'sold', finishedAt: now }

job sellUncollected(periodStart: time, periodEnd: time):
  for b in boards by .id:
    if b.stage = 'ready' and b.pickupNoticeAt != null and periodEnd >= b.pickupNoticeAt + 45d:
      update boards[b.id] { stage: 'sold', finishedAt: now }

schedule uncollected every 1h: sellUncollected
