table items:
  owner: principal
  bucket: int
  tag: id
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- exists access[.bucket, viewer]
  update (old, next) <- old.owner = viewer and next.owner = viewer
  delete <- deny
  online only

table access:
  bucket: int
  principal: principal
  unique byMember: bucket, principal
  cap 16 by principal
  read <- deny
  insert <- allow
  update <- allow
  delete <- allow
  online only

query run(key: id, bucket: int, c: cursor ?, n: int ?, a: int, b: int):
  return items where .bucket = bucket last 1 by .tag after c
