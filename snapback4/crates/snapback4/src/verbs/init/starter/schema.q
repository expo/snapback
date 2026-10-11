-- Your backend. `snapback4 check` compiles this file and writes
-- snapback/generated/api.ts; `snapback4 dev` serves it and reloads on save.
-- Grammar and examples: `snapback4 guide language`.
use identity                  -- the app's "Continue as a guest" sign-in; `use identity password` adds email accounts
use personas alice, bob       -- development principals for `snapback4 run --as alice` and fixtures

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  cap 1000 by ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
  sync to .ownerId            -- each owner's devices hold their own todos and work offline

query list(c: cursor ?):
  return todos where .ownerId = viewer after c first 100 by .id

mutation add(title: text 1..200):
  return insert todos { title, done: false, ownerId: viewer }

mutation toggle(todoId: todos):
  todo = todos[todoId] ! else NOT_FOUND
  update todos[todo] { done: not todo.done }
  return null

mutation remove(todoId: todos):
  delete todos[todoId]
  return null
