//! The two executable starter schemas, kept separate from the card registry.
pub const TEMPLATE: &str = r##"-- Your backend. `snapback4 check` compiles it; `snapback4 dev` serves it.
use personas alice, bob

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwner: ownerId, id
  cap 1000 by ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
  sync to .ownerId                        -- each owner's device holds its own todos

query list(c: cursor ?):
  return todos[viewer] after c first 100 by byOwner

mutation add(title: text <=200):
  return insert todos { title, done: false, ownerId: viewer }

mutation toggle(todoId: todos):
  todo = todos[todoId] ! else NOT_FOUND
  update todos[todo] { done: not todo.done }
  return null

mutation remove(todoId: todos):
  delete todos[todoId]
  return null
"##;

/// The online starter uses the same private rules with no device partition.
pub const TEMPLATE_ONLINE: &str = r##"-- Online-only backend. `snapback4 check` compiles it; `snapback4 dev` serves it.
use personas alice, bob

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwner: ownerId, id
  cap 1000 by ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer

query list(c: cursor ?):
  return todos[viewer] after c first 100 by byOwner

mutation add(title: text <=200):
  return insert todos { title, done: false, ownerId: viewer }

mutation toggle(todoId: todos):
  todo = todos[todoId] ! else NOT_FOUND
  update todos[todo] { done: not todo.done }
  return null

mutation remove(todoId: todos):
  delete todos[todoId]
  return null
"##;
