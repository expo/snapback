query ambiguousOwner(owner: principal):
  return items[owner] first 10

query fixed(owner: principal):
  return items[owner] first 10 by byOwner
