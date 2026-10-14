table items:
  owner: principal
  read <- .owner = viewer or exists access[0, viewer]
  insert <- .owner = viewer or exists access[0, viewer]
  update <- .owner = viewer or exists access[0, viewer]
  delete <- .owner = viewer or exists access[0, viewer]
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  read <- .principal = viewer
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- .principal = viewer
  sync to .principal

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .owner = viewer or exists access[0, viewer] last 1 by .id after c
