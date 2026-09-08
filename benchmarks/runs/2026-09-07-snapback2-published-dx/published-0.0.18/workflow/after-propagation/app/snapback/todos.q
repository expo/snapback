query list():
  return todos[viewer] first 50 by byOwnerId

mutation add(title: text <=200):
  row = insert todos { title, done: false, ownerId: viewer }
  return { id: row.id, row }

query merged():
  page = merge todos first 3 by byOwner:
    [viewer]
  return page
