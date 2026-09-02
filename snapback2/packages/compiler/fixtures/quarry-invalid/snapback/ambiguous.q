query ambiguousOwner(owner: principal):
  return items[owner] first 10

query ambiguousExists(owner: principal):
  return exists items[owner]

query fixed(owner: principal):
  return items[owner] first 10 by byOwner
