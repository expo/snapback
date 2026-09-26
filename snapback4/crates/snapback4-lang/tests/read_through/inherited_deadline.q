table roots:
  owner: principal
  until: time
  immutable owner, until
  expire at .until
  read <- .owner = viewer
  insert <- allow
table middles:
  root: roots
  immutable root
  read through .root
  insert <- allow
table children:
  middle: middles
  immutable middle
  read through .middle
  insert <- allow
view totals: count children by .middle
  read <- .middle = .middle
mutation root(until: time):
  insert roots { id: 'r', owner: 'alice', until }
mutation middle():
  insert middles { id: 'm', root: 'r' }
mutation child():
  insert children { id: 'c', middle: 'm' }
query total():
  return totals['m']
