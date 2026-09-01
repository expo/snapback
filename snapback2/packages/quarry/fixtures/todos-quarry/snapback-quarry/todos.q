query list():
  todos[ownerId = viewer] first 50 by byOwner

mutation add(title: text <=200) -> todos:
  todo = +todos { title, done: false, ownerId: viewer }
  todo { id }
