table keys:
  key: principal ?
  until: time ?
  expire at .until
  unique byKey: key
  public
  sync public
table parents:
  key: principal ?
  until: time ?
  expire at .until
  public
  sync public
table children:
  parent: parents
  public
  sync public
  insert <- .parent.key = null or exists keys[key = .parent.key]
mutation add():
  return insert children { id: 'c', parent: 'p' }
query point(key: principal):
  return keys[key = key]
query probe(key: principal):
  return exists keys[key = key]
