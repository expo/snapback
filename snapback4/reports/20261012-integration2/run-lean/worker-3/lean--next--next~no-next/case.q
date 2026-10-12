table items:
  owner: principal
  bucket: int
  maybe: int ?
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- exists access[.bucket, viewer]
  update (old, next) <- next.owner = viewer
  delete <- allow
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  read <- deny
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket last 1 by .maybe after c
