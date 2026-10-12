table items:
  owner: principal
  bucket: int
  label: text <=64
  maybe: int ?
  read <- .owner = viewer
  insert <- exists access[.bucket, viewer]
  update <- .owner = viewer
  delete <- allow
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow
  sync public

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket last 1 by .maybe, .label after c
