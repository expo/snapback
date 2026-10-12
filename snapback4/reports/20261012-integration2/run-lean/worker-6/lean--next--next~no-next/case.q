table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  read <- .owner = viewer
  insert <- allow
  update (old, next) <- old.owner = viewer and next.owner = viewer
  delete <- exists access[.bucket, viewer]
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
  return items where .bucket = bucket last 1 by .label, .score after c
