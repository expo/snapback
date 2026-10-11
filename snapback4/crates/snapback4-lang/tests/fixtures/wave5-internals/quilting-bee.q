use personas alice, bob, carol, eve

table bees:
  name: text 1..80
  read <- exists members[.id, viewer]
  insert <- deny
  sync to members[.id]

table members:
  bee: bees
  principal: principal
  name: text 1..40
  cap 12 by bee
  unique bee, principal
  immutable bee, principal
  read <- exists members[.bee, viewer]
  insert <- deny
  sync to members[.bee]

table requests:
  bee: bees
  month: text 7..7
  queen: principal
  title: text 1..80
  instructions: text 1..1200
  size: text 1..40
  unique bee, month else MONTH_TAKEN
  immutable bee, month, queen
  read through .bee
  insert <- .queen = viewer and exists members[.bee, viewer]
  update <- .queen = viewer
  sync last 24 by .month

table blocks:
  request: requests
  member: principal
  status: enum('requested', 'mailed', 'received') default 'requested'
  cap 11 by request
  unique request, member else ALREADY_ASSIGNED
  immutable request, member
  read through .request
  insert <- .request.queen = viewer and .status = 'requested' and exists members[.request.bee, .member]
  update (old, next) <- (old.member = viewer and old.status = 'requested' and next.status = 'mailed') or (old.request.queen = viewer and old.status = 'mailed' and next.status = 'received')
  sync

query beeInfo(bee: bees):
  return bees[bee]
query roster(bee: bees):
  return members where .bee = bee first 12 by .id
query monthlyRequests(bee: bees):
  return requests where .bee = bee last 24 by .month
query assignedBlocks(request: requests):
  return blocks where .request = request first 12 by .id

mutation createRequest(bee: bees, month: text 7..7, title: text 1..80, instructions: text 1..1200, size: text 1..40):
  return insert requests { bee, month, queen: viewer, title, instructions, size }
mutation editRequest(request: requests, title: text 1..80, instructions: text 1..1200, size: text 1..40):
  update requests[request] { title, instructions, size }
  return { ok: true }
mutation assignBlock(request: requests, member: principal):
  r = requests[request] ! else NOT_FOUND
  require member != r.queen else QUEEN_BLOCK 'Assign a block to another member.'
  return insert blocks { request, member }
mutation markMailed(block: blocks):
  update blocks[block] { status: 'mailed' }
  return { ok: true }
mutation confirmReceipt(block: blocks):
  update blocks[block] { status: 'received' }
  return { ok: true }
