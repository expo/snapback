table items:
  owner: principal
  bucket: int
  score: int
  label: text <=64
  read <- .owner = viewer or exists access[.bucket, viewer]
  insert <- deny
  update (old, next) <- next.owner = viewer
  delete <- deny
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
  return items where .bucket = bucket first 1 by .label, .score after c
