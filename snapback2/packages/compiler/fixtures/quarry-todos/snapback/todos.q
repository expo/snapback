query list():
  return todos[viewer] first 50 by byOwnerId

mutation add(title: text <=200):
  row = +todos { title, done: false, ownerId: viewer }
  return { id: row.id }
