
table parents:
  owner: principal
  until: time ?
  immutable owner, until
  expire at .until
  read <- .owner = viewer
  insert <- allow
  delete <- allow
table children:
  parent: parents
  body: text <=100
  until: time ?
  immutable parent
  expire at .until
  read through .parent
  insert <- allow
  update <- allow
  delete <- allow
mutation parent(id: id, owner: principal, until: time ?):
  insert parents { id, owner, until }
mutation child(id: id, parent: parents, until: time ?):
  insert children { id, parent, body: 'hello', until }
mutation erase(id: parents):
  delete parents[id]
mutation eraseChild(id: children):
  delete children[id]
mutation extend(id: children, until: time ?):
  update children[id] { until }
query childRow(id: children):
  return children[id]
query page(id: parents, c: cursor ?):
  return children where .parent = id first 20 after c
