use personas alice
table parents:
  owner: principal
  public
  insert <- allow
  sync public
table members:
  parent: parents on delete keep
  principal: principal
  unique parent, principal
  public
  insert <- allow
  sync public
table children:
  parent: parents on delete keep
  public
  insert <- .parent.owner = viewer and .parent.owner = viewer and exists members[.parent, .parent.owner]
  update (old, next) <- old.parent.owner = viewer and next.parent.owner = viewer
  delete <- .parent.owner = viewer
  after insert <- exists members[.parent, viewer]
  sync public
mutation setup():
  insert parents { id: 'p', owner: viewer }
  insert members { id: 'm', parent: 'p', principal: viewer }
  insert children { id: 'c', parent: 'p' }
mutation add(id: id):
  insert children { id, parent: 'p' }
mutation change(id: children, parent: parents):
  update children[id] { parent }
mutation remove(id: children):
  delete children[id]
mutation noop():
  return true
query child(id: children):
  return children[id]
