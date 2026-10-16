use personas alice, bob, carol
table ladderRows:
  owner: principal
  state: enum('pending', 'withdrawn')
  body: text 1..20
  immutable owner
  read <- .owner = viewer
  update <- .owner = viewer and .state = 'pending'
  online only
mutation ladder(row: ladderRows, body: text 1..20):
  r = ladderRows[row] ! else NOT_FOUND
  update ladderRows[row] { state: 'withdrawn', body }
  require false else LATE
mutation oldImage(row: ladderRows):
  update ladderRows[row] { state: 'pending' }
mutation firstRequire(row: ladderRows):
  require false else EARLY
  r = ladderRows[row] ! else NOT_FOUND
  return r
mutation lastRequire(row: ladderRows):
  update ladderRows[row] { body: 'rolled back' }
  require false else LATE
query ladderRow(row: ladderRows):
  return ladderRows[row]
query hiddenRows(owner: principal, c: cursor ?):
  return ladderRows where .owner = owner first 20 by .id after c
