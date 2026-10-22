use identity

table counters:
  owner: principal
  n: int default 0
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only

mutation make():
  return insert counters { id: 'c0000', owner: viewer }

mutation increment(counter: counters):
  c = counters[counter] ! else NOT_FOUND
  return update counters[c.id] { n: c.n + 1 }
