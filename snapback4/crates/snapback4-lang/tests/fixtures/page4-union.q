table members:
  group: int
  principal: principal
  unique group, principal
  read <- .principal = viewer
  online only
table docs:
  owner: principal
  group: int
  open: bool
  at: int
  read <- .owner = viewer or .open = true or exists members[.group, viewer]
  online only
query list(c: cursor ?):
  return docs first 1 by .at after c
query scoped(c: cursor ?):
  return docs where exists members[.group, viewer] first 1 by .at after c
