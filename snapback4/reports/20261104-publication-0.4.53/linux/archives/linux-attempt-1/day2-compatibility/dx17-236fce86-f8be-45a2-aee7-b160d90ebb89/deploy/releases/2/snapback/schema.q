use identity password
table roles:
  principal: principal
  role: enum('admin', 'member')
  unique principal
  immutable principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('admin', 'member')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] { principal, role }
query myRole():
  return roles[viewer]
table notes:
  owner: principal
  body: text 1..200
  label: text <=20 default 'new'
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation add(body: text 1..200):
  return insert notes { owner: viewer, body }
query myNotes(c: cursor ?):
  return notes where .owner = viewer first 20 by .id after c
