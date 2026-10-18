table items:
  owner: principal
  maybe: int ?
  read <- .owner = viewer or exists access[.id, viewer]
  insert <- .owner = viewer or exists access[.id, viewer]
  update <- .owner = viewer or exists access[.id, viewer]
  delete <- .owner = viewer or exists access[.id, viewer]
  online only

table access:
  principal: principal
  item: items
  unique byItem: item, principal
  cap 16 by principal
  read <- deny
  insert <- allow
  update <- allow
  delete <- allow
  online only

table kids:
  item: items ?
  owner: principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  online only

table notes:
  kid: kids
  read <- allow
  insert <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where true last 1 by .maybe after c
