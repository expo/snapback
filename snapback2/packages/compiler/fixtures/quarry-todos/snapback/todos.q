query list():
  return todos[viewer] first 50

mutation add(title: text <=200):
  row = +todos { title, done: false, ownerId: viewer }
  return { id: row.id }
