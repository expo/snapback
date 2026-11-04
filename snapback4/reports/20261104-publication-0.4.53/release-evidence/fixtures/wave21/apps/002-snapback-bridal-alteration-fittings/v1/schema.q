-- Bridal Alteration Fittings.
-- Roles: owner, frontdesk, seamstress, bride. Provisioned by the local
-- operator (service:ops); signup alone grants no role.
use identity password

table roles:
  principal: principal
  role: enum('owner', 'frontdesk', 'seamstress', 'bride')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  delete <- viewer = 'service:operator'
  online only

-- A gown belongs to one bride. Staff (owner/frontdesk/seamstress) read every
-- gown; a bride reads only her own. Phone, address and quoted price are
-- visible only to the bride herself, the front desk and the owner.
table gowns:
  bride: principal
  style: text 1..120
  measurements: text 1..2000
  phone: text 1..40
  read (phone) <- .bride = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk']
  address: text 1..200
  read (address) <- .bride = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk']
  quotedPrice: money USD
  read (quotedPrice) <- .bride = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk']
  photos: [image <=5000000] 1..4
  weddingDate: time
  finalFittingAt: time ?
  stage: enum('intake', 'fitting1', 'fitting2', 'final', 'ready', 'picked_up') default 'intake'
  rushApproved: bool default false
  freeRedo: bool default false
  immutable bride
  read <- .bride = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']
  insert <- exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'owner']
  update <- exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'seamstress']
  cap 500 by bride
  online only

table fittings:
  gown: gowns
  author: principal
  note: text 1..2000
  at: time default now
  immutable gown, author
  read <- exists gowns[.gown, bride = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']
  insert <- .author = viewer and (exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress'])
  update <- .author = viewer or exists roles[principal = viewer, role = 'owner']
  delete <- .author = viewer or exists roles[principal = viewer, role = 'owner']
  cap 200 by gown
  online only

table tasks:
  gown: gowns
  title: text 1..200
  done: bool default false
  at: time default now
  immutable gown
  read <- exists gowns[.gown, bride = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']
  insert <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']
  update <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']
  delete <- exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk']
  cap 200 by gown
  online only

-- Privacy intent, stated separately from the rules.
invariant gowns.read only .bride = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']
invariant gowns.phone read only .bride = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk']
invariant gowns.address read only .bride = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk']
invariant gowns.quotedPrice read only .bride = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk']
invariant gowns.insert only exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk']
invariant fittings.read only exists gowns[.gown, bride = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']
invariant tasks.read only exists gowns[.gown, bride = viewer] or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']

-- Operator-provisioned roster. Signup grants no role by itself.
mutation provision(principal: principal, role: enum('owner', 'frontdesk', 'seamstress', 'bride')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }

query myRole():
  return roles[principal = viewer]

-- Brides list themselves so the front desk can file gowns under the right
-- account. Names are visible to staff and to the bride herself.
table brideDirectory:
  principal: principal
  displayName: text 1..80
  unique principal
  immutable principal
  read <- .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']
  insert <- .principal = viewer
  update <- .principal = viewer
  online only

invariant brideDirectory.read only .principal = viewer or exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress']

mutation registerBride(displayName: text 1..80):
  require exists roles[principal = viewer, role = 'bride'] else NOT_BRIDE
  return upsert brideDirectory[principal = viewer] { principal: viewer, displayName }

query brideList(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] else NOT_STAFF
  return brideDirectory first 100 by .id after c

query directoryEntry(who: principal):
  return brideDirectory[principal = who]

-- Workroom board: every gown, newest first. Staff only; the column rules
-- above strip phone/address/price for seamstresses automatically.
query board(c: cursor ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress'] else NOT_STAFF
  return gowns last 50 by .id after c

-- A bride's own gowns and history.
query myGowns(c: cursor ?):
  return gowns where .bride = viewer last 50 by .id after c

query gownDetail(gown: gowns):
  return gowns[gown]

query fittingsOf(gown: gowns, c: cursor ?):
  return fittings where .gown = gown first 100 by .at after c

query tasksOf(gown: gowns, c: cursor ?):
  return tasks where .gown = gown first 100 by .at after c

-- Front desk (or owner) logs a gown. The final fitting must not be after the
-- wedding, and the wedding must still be ahead.
mutation logGown(bride: principal, style: text 1..120, measurements: text 1..2000, phone: text 1..40, address: text 1..200, quotedPrice: money USD, photos: [image <=5000000] 1..4, weddingDate: time, finalFittingAt: time ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] else NOT_STAFF
  require exists brideDirectory[principal = bride] else UNKNOWN_BRIDE
  require weddingDate > now else WEDDING_PAST
  require finalFittingAt = null or finalFittingAt <= weddingDate else FITTING_AFTER_WEDDING
  return insert gowns { bride, style, measurements, phone, address, quotedPrice, photos, weddingDate, finalFittingAt }

mutation updateGownDetails(gown: gowns, style: text 1..120, measurements: text 1..2000, phone: text 1..40, address: text 1..200, quotedPrice: money USD, weddingDate: time, finalFittingAt: time ?):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] else NOT_STAFF
  g = gowns[gown] ! else NOT_FOUND
  require weddingDate > now else WEDDING_PAST
  require finalFittingAt = null or finalFittingAt <= weddingDate else FITTING_AFTER_WEDDING
  update gowns[gown] { style, measurements, phone, address, quotedPrice, weddingDate, finalFittingAt }
  return null

-- Staff move gowns between fittings; the board re-reads live.
mutation moveStage(gown: gowns, stage: enum('intake', 'fitting1', 'fitting2', 'final', 'ready', 'picked_up')):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress'] else NOT_STAFF
  g = gowns[gown] ! else NOT_FOUND
  update gowns[gown] { stage }
  return null

mutation addFitting(gown: gowns, note: text 1..2000):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress'] else NOT_STAFF
  g = gowns[gown] ! else NOT_FOUND
  return insert fittings { gown, author: viewer, note }

mutation addTask(gown: gowns, title: text 1..200):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress'] else NOT_STAFF
  g = gowns[gown] ! else NOT_FOUND
  return insert tasks { gown, title }

mutation setTaskDone(task: tasks, done: bool):
  require exists roles[principal = viewer, role = 'owner'] or exists roles[principal = viewer, role = 'frontdesk'] or exists roles[principal = viewer, role = 'seamstress'] else NOT_STAFF
  t = tasks[task] ! else NOT_FOUND
  update tasks[task] { done }
  return null

-- Only the owner approves a rush charge or a free redo.
mutation approveRush(gown: gowns, approved: bool):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  g = gowns[gown] ! else NOT_FOUND
  update gowns[gown] { rushApproved: approved }
  return null

mutation approveRedo(gown: gowns, approved: bool):
  require exists roles[principal = viewer, role = 'owner'] else NOT_OWNER
  g = gowns[gown] ! else NOT_FOUND
  update gowns[gown] { freeRedo: approved }
  return null
