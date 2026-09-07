query list():
  return todos[viewer] first 50

mutation add(title: text <=200):
  row = insert todos { title, done: false, ownerId: viewer }
  return { id: row.id }

mutation complete(todoId: todos):
  update todos[todoId] { done: "yes" }
  return true
